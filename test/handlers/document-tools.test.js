const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('../../src/helpers');
const { DocumentTextPipeline } = require('../../src/documentText');
const { LegalServerClient } = require('../../src/legalserverClient');
const { createToolRegistry } = require('../../src/toolRegistry');
const { createSequentialFetch, jsonResponse, textResponse } = require('../support/mockFetch');

const sampleDocuments = [
  {
    internal_id: 501,
    guid: 'doc-1',
    name: 'lease.pdf',
    title: 'Lease',
    mime_type: 'application/pdf',
    disk_file_size: 4000,
    date_create: '2024-01-04T00:00:00Z',
    date_update: '2024-01-06T00:00:00Z',
    download_url: 'https://example.legalserver.org/modules/document/download.php?id=501',
  },
  {
    internal_id: 502,
    guid: 'doc-2',
    name: 'notes.txt',
    title: 'Notes',
    mime_type: 'text/plain',
    disk_file_size: 100,
    date_create: '2024-01-03T00:00:00Z',
    date_update: '2024-01-05T00:00:00Z',
    download_url: 'https://example.legalserver.org/modules/document/download.php?id=502',
  },
];

const fakeState = {
  canonicalText: 'Lease terms\nRent due monthly.',
  chunks: [{
    chunkIndex: 0,
    pageStart: 1,
    pageEnd: 1,
    startChar: 0,
    endChar: 29,
    text: 'Lease terms\nRent due monthly.',
  }],
  ocrModel: null,
  ocrProvider: null,
  pageCount: 1,
  pageOffsets: [{ pageNumber: 1, startChar: 0, endChar: 29 }],
  textSha256: 'hash-doc-1',
  textSource: 'pdf_text',
  totalTextChars: 29,
  estimatedTokens: 8,
};

function createRegistry({ responses, documentTextPipeline }) {
  const client = new LegalServerClient({
    baseUrl: 'https://example.legalserver.org/',
    bearerToken: 'token',
    timeoutMs: 30000,
    fetchImpl: createSequentialFetch(responses || [], []),
  });

  return createToolRegistry({
    client,
    helpers,
    documentTextPipeline,
  });
}

test('document_get_text_manifest returns manifest metadata', async () => {
  const registry = createRegistry({
    responses: [jsonResponse(200, sampleDocuments)],
    documentTextPipeline: {
      async getDocumentState() {
        return fakeState;
      },
    },
  });

  const payload = await registry.execute('document_get_text_manifest', {
    case_uuid: 'matter-uuid-1',
    document_uuid: 'doc-1',
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.data.text_source, 'pdf_text');
  assert.equal(payload.data.chunk_count, 1);
  assert.equal(payload.warnings.length, 0);
});

test('document_get_text_manifest warns on empty text', async () => {
  const registry = createRegistry({
    responses: [jsonResponse(200, sampleDocuments)],
    documentTextPipeline: {
      async getDocumentState() {
        return {
          ...fakeState,
          canonicalText: '',
          chunks: [],
          totalTextChars: 0,
          estimatedTokens: 0,
        };
      },
    },
  });

  const payload = await registry.execute('document_get_text_manifest', {
    case_uuid: 'matter-uuid-1',
    document_uuid: 'doc-1',
  });

  assert.deepEqual(payload.warnings, ['No text was extracted from this document.']);
  assert.equal(payload.data.first_chunk_index, null);
});

test('document_get_text_chunk returns one chunk and validates range', async () => {
  const registry = createRegistry({
    responses: [jsonResponse(200, sampleDocuments), jsonResponse(200, sampleDocuments)],
    documentTextPipeline: {
      async getDocumentState() {
        return fakeState;
      },
    },
  });

  const payload = await registry.execute('document_get_text_chunk', {
    case_uuid: 'matter-uuid-1',
    document_uuid: 'doc-1',
    chunk_index: 0,
  });
  assert.equal(payload.data.text, 'Lease terms\nRent due monthly.');

  await assert.rejects(
    () => registry.execute('document_get_text_chunk', {
      case_uuid: 'matter-uuid-1',
      document_uuid: 'doc-1',
      chunk_index: 9,
    }),
    (error) => {
      assert.equal(error.errorCode, 'chunk_out_of_range');
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test('document_search_text returns paginated hits', async () => {
  const registry = createRegistry({
    responses: [jsonResponse(200, sampleDocuments)],
    documentTextPipeline: {
      async getDocumentState() {
        return fakeState;
      },
    },
  });

  const payload = await registry.execute('document_search_text', {
    case_uuid: 'matter-uuid-1',
    document_uuid: 'doc-1',
    query: 'rent',
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].chunk_index, 0);
});

test('matter_search_document_text searches all documents in deterministic order', async () => {
  const seen = [];
  const registry = createRegistry({
    responses: [jsonResponse(200, sampleDocuments)],
    documentTextPipeline: {
      async getDocumentState({ documentRecord }) {
        seen.push(documentRecord.guid);
        if (documentRecord.guid === 'doc-1') {
          return fakeState;
        }

        return {
          ...fakeState,
          canonicalText: 'Notes without the term.',
          chunks: [{
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            startChar: 0,
            endChar: 23,
            text: 'Notes without the term.',
          }],
          pageOffsets: [{ pageNumber: 1, startChar: 0, endChar: 23 }],
          textSha256: 'hash-doc-2',
          textSource: 'plain_text',
          totalTextChars: 23,
        };
      },
    },
  });

  const payload = await registry.execute('matter_search_document_text', {
    case_uuid: 'matter-uuid-1',
    query: 'rent',
  });

  assert.deepEqual(seen, ['doc-1', 'doc-2']);
  assert.equal(payload.data[0].document_uuid, 'doc-1');
});

test('document tools surface 404 when the document is missing on the matter', async () => {
  const registry = createRegistry({
    responses: [jsonResponse(200, sampleDocuments)],
    documentTextPipeline: {
      async getDocumentState() {
        return fakeState;
      },
    },
  });

  await assert.rejects(
    () => registry.execute('document_get_text_manifest', {
      case_uuid: 'matter-uuid-1',
      document_uuid: 'missing-doc',
    }),
    (error) => {
      assert.equal(error.errorCode, 'not_found');
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test('document tools surface OCR and unsupported media failures from the pipeline', async () => {
  const registry = createRegistry({
    responses: [jsonResponse(200, sampleDocuments), jsonResponse(200, sampleDocuments)],
    documentTextPipeline: {
      async getDocumentState({ documentRecord }) {
        if (documentRecord.guid === 'doc-1') {
          throw new helpers.ToolError({
            errorCode: 'ocr_unavailable',
            message: 'OCR required',
            status: 412,
          });
        }

        throw new helpers.ToolError({
          errorCode: 'unsupported_media_type',
          message: 'Unsupported',
          status: 415,
        });
      },
    },
  });

  await assert.rejects(
    () => registry.execute('document_get_text_manifest', {
      case_uuid: 'matter-uuid-1',
      document_uuid: 'doc-1',
    }),
    /OCR required/,
  );

  await assert.rejects(
    () => registry.execute('document_get_text_manifest', {
      case_uuid: 'matter-uuid-1',
      document_uuid: 'doc-2',
    }),
    /Unsupported/,
  );
});

test('document manifest propagates rate limiting from the LegalServer binary download helper', async () => {
  const client = new LegalServerClient({
    baseUrl: 'https://example.legalserver.org/',
    bearerToken: 'token',
    timeoutMs: 30000,
    fetchImpl: createSequentialFetch([
      jsonResponse(200, sampleDocuments),
      jsonResponse(429, { message: 'Slow down' }, { 'retry-after': '12' }),
    ], []),
  });
  const pipeline = new DocumentTextPipeline({
    client,
    config: {
      documentOcrProvider: 'none',
      documentOcrModel: 'gemini-2.5-flash',
    },
    extractors: {
      async extractDocxText() {
        return ['unused'];
      },
      async extractPdfTextPages() {
        return ['unused'];
      },
      async splitPdfIntoSinglePageBuffers() {
        return [];
      },
    },
  });
  const registry = createToolRegistry({ client, helpers, documentTextPipeline: pipeline });

  await assert.rejects(
    () => registry.execute('document_get_text_manifest', {
      case_uuid: 'matter-uuid-1',
      document_uuid: 'doc-1',
    }),
    (error) => {
      assert.equal(error.errorCode, 'rate_limited');
      assert.equal(error.retryAfter, 12);
      return true;
    },
  );
});

test('document manifest propagates 503 failures from the LegalServer binary download helper', async () => {
  const client = new LegalServerClient({
    baseUrl: 'https://example.legalserver.org/',
    bearerToken: 'token',
    timeoutMs: 30000,
    fetchImpl: createSequentialFetch([
      jsonResponse(200, sampleDocuments),
      textResponse(503, 'Temporary outage'),
    ], []),
  });
  const pipeline = new DocumentTextPipeline({
    client,
    config: {
      documentOcrProvider: 'none',
      documentOcrModel: 'gemini-2.5-flash',
    },
    extractors: {
      async extractDocxText() {
        return ['unused'];
      },
      async extractPdfTextPages() {
        return ['unused'];
      },
      async splitPdfIntoSinglePageBuffers() {
        return [];
      },
    },
  });
  const registry = createToolRegistry({ client, helpers, documentTextPipeline: pipeline });

  await assert.rejects(
    () => registry.execute('document_get_text_manifest', {
      case_uuid: 'matter-uuid-1',
      document_uuid: 'doc-1',
    }),
    (error) => {
      assert.equal(error.errorCode, 'service_unavailable');
      assert.equal(error.status, 503);
      return true;
    },
  );
});
