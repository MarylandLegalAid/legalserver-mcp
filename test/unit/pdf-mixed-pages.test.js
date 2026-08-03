const test = require('node:test');
const assert = require('node:assert/strict');
const { DocumentTextPipeline } = require('../../src/apps/legalserver/documentText');

const TYPED_PAGE = 'This page has a real embedded text layer with plenty of characters on it. ';
const SCANNER_NOISE = '  \n ';

// Builds a pipeline over a PDF whose per-page embedded text is given directly, so each test can
// describe the exact typed/scanned mix it cares about.
function createPdfPipeline({ embeddedPages, ocrProvider = null, documentOcrMaxPages = 50 }) {
  const rasterized = [];
  const ocrRequests = [];

  const pipeline = new DocumentTextPipeline({
    client: {
      async downloadDocumentBinary() {
        return {
          buffer: Buffer.from('%PDF-1.4 fixture'),
          contentType: 'application/pdf',
          contentDisposition: null,
          contentLength: 16,
          filename: 'filing.pdf',
          url: 'https://example.legalserver.org/modules/document/download.php?id=700',
        };
      },
    },
    config: {
      documentOcrProvider: ocrProvider ? 'openai' : 'none',
      documentOcrModel: 'gpt-5.6-luna',
      documentOcrMaxPages,
    },
    ocrProvider: ocrProvider && {
      async extractPages(pages) {
        ocrRequests.push(...pages.map((page) => page.pageNumber));
        return pages.map((page) => ({ pageNumber: page.pageNumber, text: `OCR of page ${page.pageNumber}` }));
      },
    },
    extractors: {
      async extractPdfTextPages() {
        return embeddedPages;
      },
      async rasterizePdfIntoPageImages(buffer, options = {}) {
        const pageNumbers = options.pageNumbers
          ?? Array.from({ length: embeddedPages.length }, (_, index) => index + 1);
        rasterized.push(...pageNumbers);
        return pageNumbers.map((pageNumber) => ({
          pageNumber,
          mimeType: 'image/png',
          bytes: Buffer.from(`page-${pageNumber}`),
        }));
      },
    },
  });

  const getState = () => pipeline.getDocumentState({
    caseUuid: 'matter-1',
    documentRecord: {
      guid: 'doc-700',
      internal_id: 700,
      name: 'filing.pdf',
      mime_type: 'application/pdf',
      download_url: 'https://example.legalserver.org/modules/document/download.php?id=700',
    },
  });

  return { getState, rasterized, ocrRequests };
}

// The motion-with-exhibits shape: typed pages followed by scanned ones. Before per-page
// decisions this document cleared the whole-document threshold on its typed pages alone and
// returned the exhibits blank, with no error and no warning.
test('mixed PDF OCRs only the pages that lack a text layer', async () => {
  const { getState, rasterized, ocrRequests } = createPdfPipeline({
    embeddedPages: [TYPED_PAGE, TYPED_PAGE, SCANNER_NOISE, SCANNER_NOISE, TYPED_PAGE],
    ocrProvider: true,
  });

  const state = await getState();

  assert.deepEqual(ocrRequests, [3, 4]);
  assert.deepEqual(rasterized, [3, 4], 'typed pages must not be rasterized');
  assert.deepEqual(state.ocrPageNumbers, [3, 4]);
  assert.deepEqual(state.pagesMissingText, []);
  assert.equal(state.textSource, 'pdf_text_with_ocr');
  assert.equal(state.pageCount, 5);

  // Typed text survives, and the exhibit pages are no longer blank.
  assert.match(state.canonicalText, /real embedded text layer/);
  assert.match(state.canonicalText, /OCR of page 3/);
  assert.match(state.canonicalText, /OCR of page 4/);
});

test('fully digital PDF never calls OCR', async () => {
  const { getState, rasterized, ocrRequests } = createPdfPipeline({
    embeddedPages: [TYPED_PAGE, TYPED_PAGE, TYPED_PAGE],
    ocrProvider: true,
  });

  const state = await getState();

  assert.deepEqual(ocrRequests, []);
  assert.deepEqual(rasterized, []);
  assert.equal(state.textSource, 'pdf_text');
  assert.deepEqual(state.ocrPageNumbers, []);
});

test('fully scanned PDF still reports pdf_ocr across every page', async () => {
  const { getState, ocrRequests } = createPdfPipeline({
    embeddedPages: [SCANNER_NOISE, SCANNER_NOISE, SCANNER_NOISE],
    ocrProvider: true,
  });

  const state = await getState();

  assert.deepEqual(ocrRequests, [1, 2, 3]);
  assert.equal(state.textSource, 'pdf_ocr');
  assert.deepEqual(state.ocrPageNumbers, [1, 2, 3]);
});

// The page budget exists to bound spend. Counting whole documents rather than pages needing OCR
// would reject a 40-page filing that only needs two calls.
test('the OCR page budget counts only pages that need OCR', async () => {
  const embeddedPages = Array.from({ length: 40 }, (_, index) => (index < 38 ? TYPED_PAGE : SCANNER_NOISE));
  const { getState, ocrRequests } = createPdfPipeline({
    embeddedPages,
    ocrProvider: true,
    documentOcrMaxPages: 5,
  });

  const state = await getState();

  assert.deepEqual(ocrRequests, [39, 40]);
  assert.equal(state.pageCount, 40);
});

test('the OCR page budget still rejects a document with too many scanned pages', async () => {
  const { getState } = createPdfPipeline({
    embeddedPages: Array.from({ length: 12 }, () => SCANNER_NOISE),
    ocrProvider: true,
    documentOcrMaxPages: 5,
  });

  await assert.rejects(getState, (error) => {
    assert.equal(error.errorCode, 'document_too_large');
    assert.match(error.message, /12 pages/);
    return true;
  });
});

// With OCR off a mixed document still has usable text, so failing it outright would regress
// those deployments. Returning it silently is what caused the original bug, so the gap is
// reported instead.
test('mixed PDF with OCR disabled returns its text and reports the missing pages', async () => {
  const { getState } = createPdfPipeline({
    embeddedPages: [TYPED_PAGE, SCANNER_NOISE, TYPED_PAGE, SCANNER_NOISE],
    ocrProvider: null,
  });

  const state = await getState();

  assert.equal(state.textSource, 'pdf_text');
  assert.deepEqual(state.pagesMissingText, [2, 4]);
  assert.deepEqual(state.ocrPageNumbers, []);
  assert.match(state.canonicalText, /real embedded text layer/);
});

test('fully scanned PDF with OCR disabled still fails with ocr_unavailable', async () => {
  const { getState } = createPdfPipeline({
    embeddedPages: [SCANNER_NOISE, SCANNER_NOISE],
    ocrProvider: null,
  });

  await assert.rejects(getState, (error) => {
    assert.equal(error.errorCode, 'ocr_unavailable');
    assert.equal(error.status, 412);
    return true;
  });
});
