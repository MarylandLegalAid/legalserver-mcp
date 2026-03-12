const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolError } = require('../../src/helpers');
const {
  DocumentTextPipeline,
  buildChunks,
  buildSearchHits,
  normalizeDocumentPages,
} = require('../../src/documentText');

function createPipeline(overrides = {}) {
  const downloads = [];
  const extractorCalls = {
    docx: 0,
    pdf: 0,
    splitPdf: 0,
  };
  const client = {
    async downloadBinary(url) {
      downloads.push(url);
      return {
        buffer: Buffer.from('fixture text', 'utf8'),
        contentType: overrides.contentType || 'text/plain',
        contentLength: 12,
      };
    },
  };
  const config = {
    documentOcrProvider: overrides.documentOcrProvider || 'none',
    documentOcrModel: 'gemini-2.5-flash',
  };
  const pipeline = new DocumentTextPipeline({
    client,
    config,
    ocrProvider: overrides.ocrProvider || null,
    extractors: {
      async extractDocxText() {
        extractorCalls.docx += 1;
        return ['Docx body'];
      },
      async extractPdfTextPages() {
        extractorCalls.pdf += 1;
        return overrides.pdfPages || ['Digital PDF text that is definitely longer than one hundred characters. '.repeat(2)];
      },
      async splitPdfIntoSinglePageBuffers() {
        extractorCalls.splitPdf += 1;
        return [
          { pageNumber: 1, mimeType: 'application/pdf', bytes: Buffer.from('page-1') },
          { pageNumber: 2, mimeType: 'application/pdf', bytes: Buffer.from('page-2') },
        ];
      },
      ...(overrides.extractors || {}),
    },
  });

  return {
    client,
    config,
    downloads,
    extractorCalls,
    pipeline,
  };
}

test('canonical document normalization preserves page boundaries and trims noisy whitespace', () => {
  const normalized = normalizeDocumentPages([
    'Line 1 \r\n\r\n\r\nLine\t\t2\x07  ',
    ' Page 2\ttext \n',
  ]);

  assert.equal(normalized.text, 'Line 1\n\nLine 2\n\n Page 2 text\n');
  assert.deepEqual(normalized.pageOffsets, [
    { pageNumber: 1, startChar: 0, endChar: 14 },
    { pageNumber: 2, startChar: 16, endChar: 29 },
  ]);
});

test('chunk builder prefers boundaries and produces deterministic overlap', () => {
  const text = `${'A'.repeat(3900)}\n\n${'B'.repeat(3900)}\n${'C'.repeat(300)}`;
  const chunks = buildChunks(text);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].endChar, 3902);
  assert.equal(chunks[1].startChar, 3502);
  assert.equal(chunks[2].text.includes('C'.repeat(100)), true);
});

test('search hits merge overlapping matches and return snippets', () => {
  const hits = buildSearchHits({
    text: 'aaaa and another aaaa',
    pageOffsets: [{ pageNumber: 1, startChar: 0, endChar: 21 }],
    chunks: [{ chunkIndex: 0, startChar: 0, endChar: 21, text: 'aaaa and another aaaa' }],
    query: 'aa',
  });

  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], {
    chunk_index: 0,
    page_number: 1,
    start_char: 0,
    end_char: 4,
    match_count: 3,
    snippet: 'aaaa and another aaaa',
    snippet_truncated_before: false,
    snippet_truncated_after: false,
  });
});

test('pipeline caches extraction results for repeated calls in one process', async () => {
  const { downloads, pipeline, extractorCalls } = createPipeline();
  const documentRecord = {
    guid: 'doc-1',
    internal_id: 500,
    name: 'notes.txt',
    mime_type: 'text/plain',
    download_url: 'https://example.legalserver.org/modules/document/download.php?id=500',
  };

  const first = await pipeline.getDocumentState({ caseUuid: 'matter-1', documentRecord });
  const second = await pipeline.getDocumentState({ caseUuid: 'matter-1', documentRecord });

  assert.equal(first.textSource, 'plain_text');
  assert.equal(second.textSha256, first.textSha256);
  assert.equal(downloads.length, 1);
  assert.deepEqual(extractorCalls, { docx: 0, pdf: 0, splitPdf: 0 });
});

test('pipeline extracts docx text through the injected extractor', async () => {
  const { pipeline, extractorCalls } = createPipeline({
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-2',
      internal_id: 501,
      name: 'memo.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      download_url: 'https://example.legalserver.org/modules/document/download.php?id=501',
    },
  });

  assert.equal(state.textSource, 'docx_text');
  assert.equal(extractorCalls.docx, 1);
});

test('pipeline keeps digital PDFs on embedded text and skips OCR', async () => {
  const { pipeline, extractorCalls } = createPipeline({
    contentType: 'application/pdf',
  });
  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-3',
      internal_id: 502,
      name: 'digital.pdf',
      mime_type: 'application/pdf',
      download_url: 'https://example.legalserver.org/modules/document/download.php?id=502',
    },
  });

  assert.equal(state.textSource, 'pdf_text');
  assert.equal(extractorCalls.pdf, 1);
  assert.equal(extractorCalls.splitPdf, 0);
});

test('pipeline falls back to OCR for scanned PDFs and records OCR metadata', async () => {
  const ocrCalls = [];
  const { pipeline, extractorCalls } = createPipeline({
    contentType: 'application/pdf',
    documentOcrProvider: 'vertex_gemini',
    pdfPages: ['too short'],
    ocrProvider: {
      async extractPages(pages) {
        ocrCalls.push(...pages.map((page) => page.pageNumber));
        return [
          { pageNumber: 1, text: 'Scanned page one' },
          { pageNumber: 2, text: 'Scanned page two' },
        ];
      },
    },
  });
  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-4',
      internal_id: 503,
      name: 'scanned.pdf',
      mime_type: 'application/pdf',
      download_url: 'https://example.legalserver.org/modules/document/download.php?id=503',
    },
  });

  assert.equal(state.textSource, 'pdf_ocr');
  assert.equal(state.ocrProvider, 'vertex_gemini');
  assert.equal(extractorCalls.splitPdf, 1);
  assert.deepEqual(ocrCalls, [1, 2]);
});

test('pipeline OCRs supported images', async () => {
  const { pipeline } = createPipeline({
    contentType: 'image/png',
    documentOcrProvider: 'vertex_gemini',
    ocrProvider: {
      async extractPages() {
        return [{ pageNumber: 1, text: 'Image OCR text' }];
      },
    },
  });
  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-5',
      internal_id: 504,
      name: 'image.png',
      mime_type: 'image/png',
      download_url: 'https://example.legalserver.org/modules/document/download.php?id=504',
    },
  });

  assert.equal(state.textSource, 'image_ocr');
  assert.equal(state.totalTextChars, 'Image OCR text'.length);
});

test('pipeline rejects unsupported media types', async () => {
  const { pipeline } = createPipeline({
    contentType: 'application/octet-stream',
  });

  await assert.rejects(
    () => pipeline.getDocumentState({
      caseUuid: 'matter-1',
      documentRecord: {
        guid: 'doc-6',
        internal_id: 505,
        name: 'archive.bin',
        mime_type: 'application/octet-stream',
        download_url: 'https://example.legalserver.org/modules/document/download.php?id=505',
      },
    }),
    (error) => {
      assert.equal(error.errorCode, 'unsupported_media_type');
      assert.equal(error.status, 415);
      return true;
    },
  );
});

test('pipeline fails explicitly when OCR is required but unavailable', async () => {
  const { pipeline } = createPipeline({
    contentType: 'application/pdf',
    pdfPages: ['too short'],
  });

  await assert.rejects(
    () => pipeline.getDocumentState({
      caseUuid: 'matter-1',
      documentRecord: {
        guid: 'doc-7',
        internal_id: 506,
        name: 'scan.pdf',
        mime_type: 'application/pdf',
        download_url: 'https://example.legalserver.org/modules/document/download.php?id=506',
      },
    }),
    (error) => {
      assert.equal(error.errorCode, 'ocr_unavailable');
      assert.equal(error.status, 412);
      return true;
    },
  );
});

test('pipeline surfaces extraction failures from the OCR provider', async () => {
  const { pipeline } = createPipeline({
    contentType: 'image/webp',
    documentOcrProvider: 'vertex_gemini',
    ocrProvider: {
      async extractPages() {
        throw new ToolError({
          errorCode: 'extraction_failed',
          message: 'OCR provider failed',
          status: 502,
        });
      },
    },
  });

  await assert.rejects(
    () => pipeline.getDocumentState({
      caseUuid: 'matter-1',
      documentRecord: {
        guid: 'doc-8',
        internal_id: 507,
        name: 'scan.webp',
        mime_type: 'image/webp',
        download_url: 'https://example.legalserver.org/modules/document/download.php?id=507',
      },
    }),
    /OCR provider failed/,
  );
});

test('pipeline returns empty manifests cleanly when no text is extracted', async () => {
  const { pipeline } = createPipeline({
    extractors: {
      async extractDocxText() {
        return [''];
      },
    },
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-9',
      internal_id: 508,
      name: 'empty.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      download_url: 'https://example.legalserver.org/modules/document/download.php?id=508',
    },
  });

  assert.equal(state.chunks.length, 0);
  assert.equal(state.totalTextChars, 0);
});
