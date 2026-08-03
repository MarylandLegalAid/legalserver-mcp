const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const {
  DocumentTextPipeline,
  locatePageNumber,
  rasterizePdfIntoPageImages,
} = require('../../src/apps/legalserver/documentText');
const { OpenAiOcrProvider } = require('../../src/apps/legalserver/documentText/ocrProviders');
const { createSequentialFetch, jsonResponse } = require('../support/mockFetch');

// pdftoppm ships in the container image (see Dockerfile) and CI installs it, but a developer
// machine may not have poppler-utils. Skip rather than fail there.
function hasPdftoppm() {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

const PDFTOPPM_AVAILABLE = hasPdftoppm();
const skipWithoutPdftoppm = PDFTOPPM_AVAILABLE
  ? false
  : 'requires poppler-utils (pdftoppm) on PATH';

async function createPdf(pageLabels) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const label of pageLabels) {
    const page = pdf.addPage([612, 792]);
    page.drawText(label, { x: 60, y: 700, size: 36, font });
  }

  return Buffer.from(await pdf.save());
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The bug this guards against: the previous implementation emitted single-page *PDFs* with
// mimeType 'application/pdf', which providers then sent as a data:application/pdf URI inside an
// OpenAI-compatible `image_url` part. That part is specified for raster images, so every scanned
// PDF would have failed. The old unit tests hand-built 'image/png' pages and never caught it.
test('rasterizePdfIntoPageImages returns real PNG images, not PDFs', { skip: skipWithoutPdftoppm }, async () => {
  const pages = await rasterizePdfIntoPageImages(await createPdf(['ALPHA', 'BRAVO', 'CHARLIE']), { dpi: 72 });

  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((page) => page.pageNumber), [1, 2, 3]);

  for (const page of pages) {
    assert.equal(page.mimeType, 'image/png');
    assert.ok(page.bytes.length > 0);
    assert.ok(
      page.bytes.subarray(0, 8).equals(PNG_MAGIC),
      `page ${page.pageNumber} is not a PNG — got ${page.bytes.subarray(0, 8).toString('hex')}`,
    );
  }
});

test('rasterizePdfIntoPageImages renders each page separately', { skip: skipWithoutPdftoppm }, async () => {
  const pages = await rasterizePdfIntoPageImages(await createPdf(['ALPHA', 'BRAVO']), { dpi: 72 });

  // Different text on each page must produce different pixels; identical output would mean
  // every page was rendered from the same source page and page attribution is meaningless.
  assert.ok(!pages[0].bytes.equals(pages[1].bytes));
});

test('rasterizePdfIntoPageImages honours the requested DPI', { skip: skipWithoutPdftoppm }, async () => {
  const [low] = await rasterizePdfIntoPageImages(await createPdf(['ALPHA']), { dpi: 72 });
  const [high] = await rasterizePdfIntoPageImages(await createPdf(['ALPHA']), { dpi: 150 });

  assert.ok(high.bytes.length > low.bytes.length);
});

test('rasterizePdfIntoPageImages reports unreadable PDFs as extraction_failed', async () => {
  await assert.rejects(
    () => rasterizePdfIntoPageImages(Buffer.from('this is not a pdf')),
    (error) => {
      assert.equal(error.errorCode, 'extraction_failed');
      assert.equal(error.status, 502);
      return true;
    },
  );
});

// Rasterizing is the expensive half of the OCR path — one pdftoppm process per page. With no
// provider configured the document fails with ocr_unavailable regardless, so the pages must
// never be rendered in the first place.
test('pipeline does not rasterize a scanned PDF when no OCR provider is configured', async () => {
  let rasterizeCalls = 0;

  const pipeline = new DocumentTextPipeline({
    client: {
      async downloadDocumentBinary() {
        return {
          buffer: Buffer.from('%PDF-1.4 fixture'),
          contentType: 'application/pdf',
          contentDisposition: null,
          contentLength: 16,
          filename: 'scan.pdf',
          url: 'https://example.legalserver.org/modules/document/download.php?id=900',
        };
      },
    },
    config: { documentOcrProvider: 'none', documentOcrModel: 'gpt-5.6-luna' },
    ocrProvider: null,
    extractors: {
      async extractPdfTextPages() {
        return ['too short'];
      },
      async rasterizePdfIntoPageImages() {
        rasterizeCalls += 1;
        return [];
      },
    },
  });

  await assert.rejects(
    () => pipeline.getDocumentState({
      caseUuid: 'matter-1',
      documentRecord: {
        guid: 'doc-900',
        internal_id: 900,
        name: 'scan.pdf',
        mime_type: 'application/pdf',
        download_url: 'https://example.legalserver.org/modules/document/download.php?id=900',
      },
    }),
    (error) => {
      assert.equal(error.errorCode, 'ocr_unavailable');
      return true;
    },
  );

  assert.equal(rasterizeCalls, 0);
});

// A 200-page scan is 200 sequential vision API calls. Without a cap that is a cost, latency,
// and exposure problem, and the failure mode without it is worse than an error: a truncated
// transcription returned as if it were the whole document.
test('pipeline rejects a scanned PDF over the OCR page budget before rasterizing', async () => {
  let rasterizeCalls = 0;
  let ocrCalls = 0;

  const pipeline = new DocumentTextPipeline({
    client: {
      async downloadDocumentBinary() {
        return {
          buffer: Buffer.from('%PDF-1.4 fixture'),
          contentType: 'application/pdf',
          contentDisposition: null,
          contentLength: 16,
          filename: 'huge-scan.pdf',
          url: 'https://example.legalserver.org/modules/document/download.php?id=901',
        };
      },
    },
    config: {
      documentOcrProvider: 'openai',
      documentOcrModel: 'gpt-5.6-luna',
      documentOcrMaxPages: 3,
    },
    ocrProvider: {
      async extractPages(pages) {
        ocrCalls += 1;
        return pages.map((page) => ({ pageNumber: page.pageNumber, text: '' }));
      },
    },
    extractors: {
      async extractPdfTextPages() {
        return ['', '', '', '', ''];
      },
      async rasterizePdfIntoPageImages() {
        rasterizeCalls += 1;
        return [];
      },
    },
  });

  await assert.rejects(
    () => pipeline.getDocumentState({
      caseUuid: 'matter-1',
      documentRecord: {
        guid: 'doc-901',
        internal_id: 901,
        name: 'huge-scan.pdf',
        mime_type: 'application/pdf',
        download_url: 'https://example.legalserver.org/modules/document/download.php?id=901',
      },
    }),
    (error) => {
      assert.equal(error.errorCode, 'document_too_large');
      assert.equal(error.status, 413);
      assert.match(error.message, /5 pages/);
      assert.match(error.message, /3-page limit/);
      return true;
    },
  );

  assert.equal(rasterizeCalls, 0);
  assert.equal(ocrCalls, 0);
});

// Covers the seam that has never run: a real multi-page PDF through real pdftoppm
// rasterization into a real OpenAiOcrProvider, with page assembly and offsets on the far side.
// Only two things are stubbed — the network, and pdf-parse's text extraction, which returns the
// empty pages a scan yields (pdf-parse cannot read synthetic PDFs, and a real scanned binary is
// not something to commit to a public repo). The old tests injected fake extractors AND
// hand-built page objects, which is why the application/pdf mime bug survived as long as it did.
test('scanned PDF flows through rasterization into the OpenAI provider as PNG', { skip: skipWithoutPdftoppm }, async () => {
  const scannedPdf = await createPdf(['', '']);

  const calls = [];
  const fetchImpl = createSequentialFetch([
    jsonResponse(200, { choices: [{ message: { content: 'Transcript of page one.' } }] }),
    jsonResponse(200, { choices: [{ message: { content: 'Transcript of page two.' } }] }),
  ], calls);

  const config = {
    documentOcrProvider: 'openai',
    documentOcrModel: 'gpt-5.6-luna',
    documentOcrMaxPages: 50,
  };

  const pipeline = new DocumentTextPipeline({
    client: {
      async downloadDocumentBinary() {
        return {
          buffer: scannedPdf,
          contentType: 'application/pdf',
          contentDisposition: null,
          contentLength: scannedPdf.length,
          filename: 'scanned.pdf',
          url: 'https://example.legalserver.org/modules/document/download.php?id=902',
        };
      },
    },
    config,
    ocrProvider: new OpenAiOcrProvider({ apiKey: 'sk-test-key', model: config.documentOcrModel, fetchImpl }),
    extractors: {
      async extractPdfTextPages() {
        return ['', ''];
      },
    },
  });

  const state = await pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-902',
      internal_id: 902,
      name: 'scanned.pdf',
      mime_type: 'application/pdf',
      download_url: 'https://example.legalserver.org/modules/document/download.php?id=902',
    },
  });

  assert.equal(state.textSource, 'pdf_ocr');
  assert.equal(state.ocrProvider, 'openai');
  assert.equal(state.ocrModel, 'gpt-5.6-luna');
  assert.equal(state.pageCount, 2);
  assert.match(state.canonicalText, /Transcript of page one\./);
  assert.match(state.canonicalText, /Transcript of page two\./);

  // Page attribution has to survive OCR or citations become useless.
  assert.equal(state.pageOffsets.length, 2);
  assert.equal(locatePageNumber(state.pageOffsets, state.canonicalText.indexOf('page two')), 2);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    const body = JSON.parse(call.options.body);
    // The regression that made OCR impossible: pages must reach the vision API as raster
    // images, never as data:application/pdf.
    assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
    assert.equal(body.store, false);
  }
});
