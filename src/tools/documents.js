const {
  DOCUMENT_CHUNK_OVERLAP_CHARS,
  DOCUMENT_CHUNK_TARGET_CHARS,
  MAX_PAGE_SIZE,
} = require('../constants');
const { buildSearchHits, ensureSearchQuery } = require('../documentText');
const {
  getDocumentLocator,
  listMatterDocuments,
  mapDocumentRecord,
  resolveMatterDocument,
  sortMatterDocumentsForSearch,
} = require('./shared/documentRecords');
const { caseUuidProperty, pageProperties } = require('./shared/schemas');

function documentIdentifierProperties() {
  return {
    document_uuid: {
      type: 'string',
      description: 'LegalServer document UUID from matter_list_documents.',
    },
    document_id: {
      type: 'string',
      description: 'LegalServer internal document ID.',
    },
  };
}

async function resolveDocumentForArgs({ client, helpers, args }) {
  const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');
  const locator = getDocumentLocator({ args, helpers });
  const resolved = await resolveMatterDocument({
    client,
    helpers,
    caseUuid,
    documentUuid: locator.documentUuid,
    documentId: locator.documentId,
  });

  return {
    caseUuid,
    documentRecord: resolved.record,
    documentMetadata: resolved.mapped,
  };
}

function buildManifestData({ caseUuid, metadata, state }) {
  return {
    case_uuid: caseUuid,
    document_uuid: metadata.document_uuid,
    document_id: metadata.document_id,
    name: metadata.name,
    title: metadata.title,
    mime_type: metadata.mime_type,
    size_bytes: metadata.size_bytes,
    text_source: state.textSource,
    ocr_provider: state.ocrProvider,
    ocr_model: state.ocrModel,
    page_count: state.pageCount,
    total_text_chars: state.totalTextChars,
    estimated_tokens: state.estimatedTokens,
    chunk_count: state.chunks.length,
    chunk_target_chars: DOCUMENT_CHUNK_TARGET_CHARS,
    chunk_overlap_chars: DOCUMENT_CHUNK_OVERLAP_CHARS,
    first_chunk_index: state.chunks.length > 0 ? 0 : null,
    last_chunk_index: state.chunks.length > 0 ? state.chunks.length - 1 : null,
    text_sha256: state.textSha256,
  };
}

function buildChunkData({ caseUuid, metadata, chunk, chunkCount, state }) {
  return {
    case_uuid: caseUuid,
    document_uuid: metadata.document_uuid,
    document_id: metadata.document_id,
    chunk_index: chunk.chunkIndex,
    chunk_count: chunkCount,
    page_start: chunk.pageStart,
    page_end: chunk.pageEnd,
    start_char: chunk.startChar,
    end_char: chunk.endChar,
    text: chunk.text,
    text_sha256: state.textSha256,
  };
}

function paginateItems({ helpers, items, page, pageSize }) {
  const paged = helpers.paginateArray(items, page, pageSize);
  return helpers.successEnvelope({
    data: paged.items,
    page: paged.page,
    pageSize: paged.pageSize,
    totalRecords: paged.totalRecords,
    totalPages: paged.totalPages,
    truncated: false,
  });
}

function createDocumentTools() {
  return [
    {
      name: 'matter_list_documents',
      description: 'List document metadata for a matter, including phase 2 text extraction strategy hints.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: 10,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');
        const page = helpers.validatePage(args.page);
        const pageSize = helpers.validatePageSize(args.page_size);
        const records = await listMatterDocuments({ client, caseUuid });
        const paged = helpers.paginateArray(records, page, pageSize);

        return helpers.successEnvelope({
          data: paged.items.map(mapDocumentRecord),
          page: paged.page,
          pageSize: paged.pageSize,
          totalRecords: paged.totalRecords,
          totalPages: paged.totalPages,
          truncated: false,
        });
      },
    },
    {
      name: 'document_get_metadata',
      description: 'Return one matter document metadata record by document UUID or document ID.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...documentIdentifierProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {},
      handler: async ({ client, helpers, args }) => {
        const { caseUuid, documentMetadata } = await resolveDocumentForArgs({
          client,
          helpers,
          args,
        });

        return helpers.successEnvelope({
          data: {
            case_uuid: caseUuid,
            ...documentMetadata,
          },
          page: 1,
          pageSize: 1,
          totalRecords: 1,
          totalPages: 1,
          truncated: false,
          next: null,
        });
      },
    },
    {
      name: 'document_get_text_manifest',
      description: 'Extract document text once, cache it for the process lifetime, and return manifest metadata for chunk retrieval.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...documentIdentifierProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {},
      handler: async ({ client, documentTextPipeline, helpers, args }) => {
        const { caseUuid, documentRecord, documentMetadata } = await resolveDocumentForArgs({
          client,
          helpers,
          args,
        });
        const state = await documentTextPipeline.getDocumentState({
          caseUuid,
          documentRecord,
        });

        return helpers.successEnvelope({
          data: buildManifestData({ caseUuid, metadata: documentMetadata, state }),
          page: 1,
          pageSize: 1,
          totalRecords: 1,
          totalPages: 1,
          truncated: false,
          warnings: state.chunks.length === 0 ? ['No text was extracted from this document.'] : [],
          next: null,
        });
      },
    },
    {
      name: 'document_get_text_chunk',
      description: 'Return one cached text chunk from a document manifest by chunk index.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...documentIdentifierProperties(),
          chunk_index: {
            type: 'integer',
            minimum: 0,
            description: '0-based chunk index from document_get_text_manifest.',
          },
        },
        required: ['case_uuid', 'chunk_index'],
        additionalProperties: false,
      },
      budgetPolicy: {},
      handler: async ({ client, documentTextPipeline, helpers, args }) => {
        const { caseUuid, documentRecord, documentMetadata } = await resolveDocumentForArgs({
          client,
          helpers,
          args,
        });
        const state = await documentTextPipeline.getDocumentState({
          caseUuid,
          documentRecord,
        });
        const chunkIndex = Number(args.chunk_index);
        const chunk = state.chunks[chunkIndex];

        if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !chunk) {
          throw new helpers.ToolError({
            errorCode: 'chunk_out_of_range',
            message: 'chunk_index is outside the available chunk range for this document.',
            status: 400,
          });
        }

        return helpers.successEnvelope({
          data: buildChunkData({
            caseUuid,
            metadata: documentMetadata,
            chunk,
            chunkCount: state.chunks.length,
            state,
          }),
          page: 1,
          pageSize: 1,
          totalRecords: 1,
          totalPages: 1,
          truncated: false,
          next: null,
        });
      },
    },
    {
      name: 'document_search_text',
      description: 'Search one document’s canonical text with deterministic substring matching and paginated snippets.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...documentIdentifierProperties(),
          query: {
            type: 'string',
            description: 'Case-insensitive substring query, minimum 2 characters after trimming.',
          },
          ...pageProperties(),
        },
        required: ['case_uuid', 'query'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: 10,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: async ({ client, documentTextPipeline, helpers, args }) => {
        const { caseUuid, documentRecord } = await resolveDocumentForArgs({
          client,
          helpers,
          args,
        });
        const state = await documentTextPipeline.getDocumentState({
          caseUuid,
          documentRecord,
        });
        const query = ensureSearchQuery(args.query);
        const page = helpers.validatePage(args.page);
        const pageSize = helpers.validatePageSize(args.page_size);
        const hits = buildSearchHits({
          text: state.canonicalText,
          pageOffsets: state.pageOffsets,
          chunks: state.chunks,
          query,
        });

        return paginateItems({
          helpers,
          items: hits,
          page,
          pageSize,
        });
      },
    },
    {
      name: 'matter_search_document_text',
      description: 'Search canonical text across all matter documents in deterministic document order.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          query: {
            type: 'string',
            description: 'Case-insensitive substring query, minimum 2 characters after trimming.',
          },
          ...pageProperties(),
        },
        required: ['case_uuid', 'query'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: 10,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: async ({ client, documentTextPipeline, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');
        const query = ensureSearchQuery(args.query);
        const page = helpers.validatePage(args.page);
        const pageSize = helpers.validatePageSize(args.page_size);
        const records = sortMatterDocumentsForSearch(
          await listMatterDocuments({ client, caseUuid }),
          helpers,
        );
        const hits = [];

        for (const record of records) {
          const metadata = mapDocumentRecord(record);
          const state = await documentTextPipeline.getDocumentState({
            caseUuid,
            documentRecord: record,
          });
          const documentHits = buildSearchHits({
            text: state.canonicalText,
            pageOffsets: state.pageOffsets,
            chunks: state.chunks,
            query,
          }).map((hit) => ({
            ...hit,
            document_uuid: metadata.document_uuid,
            document_id: metadata.document_id,
            name: metadata.name,
            title: metadata.title,
            mime_type: metadata.mime_type,
            date_updated: metadata.date_updated,
          }));

          hits.push(...documentHits);
        }

        return paginateItems({
          helpers,
          items: hits,
          page,
          pageSize,
        });
      },
    },
  ];
}

module.exports = {
  createDocumentTools,
};
