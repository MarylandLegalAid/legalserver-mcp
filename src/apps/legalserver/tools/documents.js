const {
  DEFAULT_DOCUMENT_OCR_MAX_PAGES,
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

const MATTER_SEARCH_SKIPPABLE_ERROR_CODES = new Set([
  'document_too_large',
  'extraction_failed',
  'ocr_unavailable',
  'unsupported_media_type',
]);

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
    ocr_page_numbers: state.ocrPageNumbers ?? [],
    // Pages with no extractable text that were not OCR'd. Non-empty means this document's text
    // has holes, so a search that finds nothing is not evidence the term is absent.
    pages_missing_text: state.pagesMissingText ?? [],
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
    warnings: [],
  });
}

function buildSkippedDocumentLabel(metadata) {
  const identifier = metadata.document_id ?? metadata.document_uuid ?? 'unknown';
  const name = metadata.name || metadata.title || 'unnamed document';
  return `${identifier}: ${name}`;
}

function buildOcrCandidate(metadata, ocrPageCount) {
  return {
    document_uuid: metadata.document_uuid,
    document_id: metadata.document_id,
    name: metadata.name,
    title: metadata.title,
    mime_type: metadata.mime_type,
    date_updated: metadata.date_updated,
    ocr_page_count: ocrPageCount,
  };
}

function buildMatterSearchWarnings(skippedDocuments, documentsRequiringOcr = []) {
  const warnings = [];

  // Stated in prose as well as in meta, because a negative result from a search that skipped
  // documents is not the same as the term being absent from the matter.
  if (documentsRequiringOcr.length > 0) {
    const pages = documentsRequiringOcr.reduce((total, candidate) => total + candidate.ocr_page_count, 0);
    warnings.push(
      `${documentsRequiringOcr.length} document(s) contain scanned pages that were not read `
      + `(${pages} page(s) total). This search is not exhaustive. See meta.documents_requiring_ocr, `
      + 'then re-run with include_scanned true or search those documents individually.',
    );
  }

  if (skippedDocuments.length === 0) {
    return warnings;
  }

  const summaryByCode = new Map();

  for (const skipped of skippedDocuments) {
    const current = summaryByCode.get(skipped.errorCode) || {
      count: 0,
      samples: [],
    };

    current.count += 1;
    if (current.samples.length < 3) {
      current.samples.push(buildSkippedDocumentLabel(skipped.metadata));
    }

    summaryByCode.set(skipped.errorCode, current);
  }

  warnings.push(`Skipped ${skippedDocuments.length} documents during matter-wide search.`);

  for (const errorCode of [...summaryByCode.keys()].sort()) {
    const summary = summaryByCode.get(errorCode);
    warnings.push(
      `${errorCode}: ${summary.count} skipped (${summary.samples.join('; ')})`,
    );
  }

  return warnings;
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
        const { caseUuid, documentRecord, documentMetadata } = await resolveDocumentForArgs({
          client,
          helpers,
          args,
        });

        return helpers.successEnvelope({
          data: {
            case_uuid: caseUuid,
            ...documentMetadata,
            download_url: documentRecord.download_url ?? null,
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
      description: 'Search extracted text across all documents on a matter. By default this does NOT read scanned pages: documents containing them are returned in meta.documents_requiring_ocr with names and page counts so you can decide which are worth reading. A result is only exhaustive when that list is empty.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          query: {
            type: 'string',
            description: 'Case-insensitive substring query, minimum 2 characters after trimming.',
          },
          include_scanned: {
            type: 'boolean',
            description: 'Default false. When false, scanned pages are NOT read and the documents '
              + 'containing them are listed in meta.documents_requiring_ocr with their names, titles, '
              + 'and OCR page counts — nothing is omitted silently. Review that list and set this to '
              + 'true (or call document_search_text on the specific documents) when a scanned document '
              + 'looks relevant. Reading scanned pages costs one AI vision call per page.',
          },
          ocr_page_budget: {
            type: 'integer',
            minimum: 1,
            description: 'Only used when include_scanned is true. Caps how many scanned pages this '
              + 'search will read in total. Documents that do not fit in what remains are left in '
              + 'meta.documents_requiring_ocr rather than partially read.',
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
        const includeScanned = args.include_scanned === true;
        const configuredBudget = documentTextPipeline.config?.documentOcrMaxPages
          ?? DEFAULT_DOCUMENT_OCR_MAX_PAGES;
        const requestedBudget = helpers.validatePositiveInteger(
          args.ocr_page_budget,
          configuredBudget,
          'ocr_page_budget',
        );

        const hits = [];
        const skippedDocuments = [];
        const documentsRequiringOcr = [];
        let ocrPagesRemaining = includeScanned ? requestedBudget : 0;
        let ocrPagesUsed = 0;

        for (const record of records) {
          const metadata = mapDocumentRecord(record);

          // An image is OCR-or-nothing and metadata alone says so, so when scanned pages are not
          // wanted it can be reported without spending the download at all.
          if (!includeScanned && metadata.text_strategy === 'ocr') {
            documentsRequiringOcr.push(buildOcrCandidate(metadata, 1));
            continue;
          }

          try {
            const state = await documentTextPipeline.getDocumentState({
              caseUuid,
              documentRecord: record,
              allowOcr: includeScanned,
              ocrPageBudget: includeScanned ? ocrPagesRemaining : 0,
            });

            const ocrPageNumbers = state.ocrPageNumbers ?? [];
            const pagesMissingText = state.pagesMissingText ?? [];

            ocrPagesUsed += ocrPageNumbers.length;
            ocrPagesRemaining -= ocrPageNumbers.length;

            // A mixed document contributes hits from the pages that were readable AND appears in
            // the deferred list for the pages that were not.
            if (pagesMissingText.length > 0) {
              documentsRequiringOcr.push(buildOcrCandidate(metadata, pagesMissingText.length));
            }

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
          } catch (error) {
            if (error instanceof helpers.ToolError && MATTER_SEARCH_SKIPPABLE_ERROR_CODES.has(error.errorCode)) {
              skippedDocuments.push({
                errorCode: error.errorCode,
                metadata,
              });
              continue;
            }

            throw error;
          }
        }

        const paged = helpers.paginateArray(hits, page, pageSize);

        return helpers.successEnvelope({
          data: paged.items,
          page: paged.page,
          pageSize: paged.pageSize,
          totalRecords: paged.totalRecords,
          totalPages: paged.totalPages,
          truncated: false,
          warnings: buildMatterSearchWarnings(skippedDocuments, documentsRequiringOcr),
          meta: {
            include_scanned: includeScanned,
            ocr_pages_used: ocrPagesUsed,
            ocr_page_budget: includeScanned ? requestedBudget : 0,
            // Documents whose scanned pages this search did not read. Empty means the search
            // covered every readable document in the matter.
            documents_requiring_ocr: documentsRequiringOcr,
          },
        });
      },
    },
  ];
}

module.exports = {
  createDocumentTools,
};
