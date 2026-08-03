const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolError } = require('../../src/apps/legalserver/helpers');
const {
  DocumentTextPipeline,
  buildChunks,
  buildSearchHits,
  normalizeDocumentPages,
} = require('../../src/apps/legalserver/documentText');

function createPipeline(overrides = {}) {
  const downloads = [];
  const extractorCalls = {
    docx: 0,
    email: 0,
    pdf: 0,
    rtf: 0,
    rasterizePdf: 0,
  };
  const client = {
    async downloadDocumentBinary(documentRecord) {
      downloads.push({
        guid: documentRecord.guid ?? null,
        internal_id: documentRecord.internal_id ?? null,
        download_url: documentRecord.download_url ?? null,
      });
      return {
        buffer: overrides.downloadBuffer || Buffer.from('fixture text', 'utf8'),
        contentType: overrides.contentType || 'text/plain',
        contentDisposition: overrides.contentDisposition || null,
        contentLength: 12,
        filename: overrides.filename || null,
        url: overrides.url || 'https://example.legalserver.org/modules/document/download.php?unique_id=fixture-doc',
      };
    },
  };
  const config = {
    documentOcrProvider: overrides.documentOcrProvider || 'none',
    documentOcrModel: 'gpt-5.6-luna',
  };
  const defaultExtractors = overrides.useRealTextExtractors ? {} : {
    async extractDocxText() {
      extractorCalls.docx += 1;
      return ['Docx body'];
    },
    async extractEmailTextPages(buffer) {
      extractorCalls.email += 1;
      return [buffer.toString('utf8')];
    },
    async extractPdfTextPages() {
      extractorCalls.pdf += 1;
      return overrides.pdfPages || ['Digital PDF text that is definitely longer than one hundred characters. '.repeat(2)];
    },
    async extractRtfTextPages(buffer) {
      extractorCalls.rtf += 1;
      return [buffer.toString('utf8')];
    },
    async rasterizePdfIntoPageImages() {
      extractorCalls.rasterizePdf += 1;
      return [
        { pageNumber: 1, mimeType: 'image/png', bytes: Buffer.from('page-1') },
        { pageNumber: 2, mimeType: 'image/png', bytes: Buffer.from('page-2') },
      ];
    },
  };
  const pipeline = new DocumentTextPipeline({
    client,
    config,
    ocrProvider: overrides.ocrProvider || null,
    extractors: {
      ...defaultExtractors,
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
  assert.deepEqual(downloads[0], {
    guid: 'doc-1',
    internal_id: 500,
    download_url: 'https://example.legalserver.org/modules/document/download.php?id=500',
  });
  assert.deepEqual(extractorCalls, { docx: 0, email: 0, pdf: 0, rtf: 0, rasterizePdf: 0 });
});

test('pipeline extracts documents successfully with identifiers only and no download_url', async () => {
  const { pipeline } = createPipeline();

  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-identifiers-only',
      internal_id: 509,
      name: 'notes.txt',
      mime_type: 'text/plain',
    },
  });

  assert.equal(state.textSource, 'plain_text');
  assert.equal(state.totalTextChars, 'fixture text'.length);
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

test('pipeline extracts rtf text and reports rtf_text source', async () => {
  const { pipeline, extractorCalls } = createPipeline({
    contentType: 'text/rtf',
    downloadBuffer: Buffer.from('{\\rtf1\\ansi Hello\\par Second line}', 'utf8'),
    useRealTextExtractors: true,
  });
  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-rtf',
      internal_id: 511,
      name: 'report.rtf',
      mime_type: 'text/rtf',
    },
  });

  assert.equal(state.textSource, 'rtf_text');
  assert.equal(state.canonicalText, 'Hello\nSecond line');
  assert.equal(extractorCalls.rtf, 0);
});

test('pipeline extracts plain-text email and includes selected headers', async () => {
  const { pipeline, extractorCalls } = createPipeline({
    contentType: 'application/mbox',
    downloadBuffer: Buffer.from(
      [
        'From: sender@example.com',
        'To: recipient@example.com',
        'Date: Thu, 12 Mar 2026 10:00:00 -0400',
        'Subject: Rent update',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'The rent is due on the first of the month.',
      ].join('\n'),
      'utf8',
    ),
    useRealTextExtractors: true,
  });
  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-eml-1',
      internal_id: 512,
      name: 'notice.eml',
      mime_type: 'application/mbox',
    },
  });

  assert.equal(state.textSource, 'email_text');
  assert.equal(state.canonicalText.includes('Subject: Rent update'), true);
  assert.equal(state.canonicalText.includes('The rent is due on the first of the month.'), true);
  assert.equal(extractorCalls.email, 0);
});

test('pipeline extracts html-only email bodies as plain text', async () => {
  const { pipeline } = createPipeline({
    contentType: 'message/rfc822',
    downloadBuffer: Buffer.from(
      [
        'From: sender@example.com',
        'To: recipient@example.com',
        'Subject: Hearing notice',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<html><body><p>Hearing is on <strong>Monday</strong>.</p><p>Bring documents.</p></body></html>',
      ].join('\n'),
      'utf8',
    ),
    useRealTextExtractors: true,
  });
  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-eml-2',
      internal_id: 513,
      name: 'notice.eml',
      mime_type: 'message/rfc822',
    },
  });

  assert.equal(state.textSource, 'email_text');
  assert.equal(state.canonicalText.includes('Hearing is on Monday.'), true);
  assert.equal(state.canonicalText.includes('Bring documents.'), true);
});

test('pipeline rejects zero-byte email documents as unsupported', async () => {
  const { pipeline } = createPipeline({
    contentType: 'application/mbox',
    downloadBuffer: Buffer.alloc(0),
    useRealTextExtractors: true,
  });

  await assert.rejects(
    () => pipeline.getDocumentState({
      caseUuid: 'matter-1',
      documentRecord: {
        guid: 'doc-eml-3',
        internal_id: 514,
        name: 'empty.eml',
        mime_type: 'application/mbox',
      },
    }),
    (error) => {
      assert.equal(error.errorCode, 'unsupported_media_type');
      assert.equal(error.status, 415);
      return true;
    },
  );
});

test('pipeline recovers document format from content-disposition when content-type is generic', async () => {
  const { pipeline, extractorCalls } = createPipeline({
    contentType: 'application/octet-stream',
    contentDisposition: 'attachment; filename="fallback.docx"',
    filename: 'fallback.docx',
  });

  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-2b',
      internal_id: 510,
      name: 'mystery.bin',
      mime_type: 'application/octet-stream',
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
  assert.equal(extractorCalls.rasterizePdf, 0);
});

test('pipeline falls back to OCR for scanned PDFs and records OCR metadata', async () => {
  const ocrCalls = [];
  const { pipeline, extractorCalls } = createPipeline({
    contentType: 'application/pdf',
    documentOcrProvider: 'openai',
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
  assert.equal(state.ocrProvider, 'openai');
  assert.equal(extractorCalls.rasterizePdf, 1);
  assert.deepEqual(ocrCalls, [1, 2]);
});

test('pipeline OCRs supported images', async () => {
  const { pipeline } = createPipeline({
    contentType: 'image/png',
    documentOcrProvider: 'openai',
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
      // The message reaches end users through the MCP client, so it must not imply that
      // OCR merely needs configuring.
      assert.match(error.message, /not supported in this release/);
      assert.doesNotMatch(error.message, /DOCUMENT_OCR_PROVIDER/);
      return true;
    },
  );
});

test('pipeline surfaces extraction failures from the OCR provider', async () => {
  const { pipeline } = createPipeline({
    contentType: 'image/webp',
    documentOcrProvider: 'openai',
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
