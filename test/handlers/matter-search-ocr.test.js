const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('../../src/apps/legalserver/helpers');
const { createDocumentTools } = require('../../src/apps/legalserver/tools/documents');

const TYPED = 'The tenant shall pay rent on the first day of each month under this lease. ';

function findTool(name) {
  return createDocumentTools().find((tool) => tool.name === name);
}

// Documents are described by what the pipeline would find in them, so each test can state a
// matter's typed/scanned mix directly.
function createHarness(documents, { documentOcrMaxPages = 50 } = {}) {
  const ocrCalls = [];

  const client = {
    async getJson() {
      return {
        data: documents.map((document, index) => ({
          guid: `doc-${index + 1}`,
          internal_id: index + 1,
          name: document.name,
          mime_type: document.mimeType,
          date_update: `2026-01-0${index + 1}`,
        })),
      };
    },
  };

  const documentTextPipeline = {
    config: { documentOcrMaxPages },
    async getDocumentState({ documentRecord, allowOcr, ocrPageBudget }) {
      const document = documents[documentRecord.internal_id - 1];
      const scannedPages = document.scannedPages ?? [];
      const canOcr = allowOcr !== false && scannedPages.length <= ocrPageBudget;

      if (scannedPages.length > 0 && canOcr) {
        ocrCalls.push({ name: document.name, pages: scannedPages.length });
      }

      const text = canOcr && document.scannedText ? `${document.text}\n${document.scannedText}` : document.text;

      return {
        canonicalText: text,
        chunks: [{ chunkIndex: 0, startChar: 0, endChar: text.length }],
        pageOffsets: [{ pageNumber: 1, startChar: 0, endChar: text.length }],
        ocrPageNumbers: scannedPages.length > 0 && canOcr ? scannedPages : [],
        pagesMissingText: scannedPages.length > 0 && !canOcr ? scannedPages : [],
      };
    },
  };

  return { client, documentTextPipeline, ocrCalls };
}

function run(args, harness) {
  return findTool('matter_search_document_text').handler({
    client: harness.client,
    documentTextPipeline: harness.documentTextPipeline,
    helpers,
    args: { case_uuid: 'matter-1', ...args },
  });
}

const MATTER = [
  { name: 'Lease_Agreement.pdf', mimeType: 'application/pdf', text: TYPED },
  { name: 'Answer_to_Complaint.pdf', mimeType: 'application/pdf', text: '', scannedPages: [1, 2, 3], scannedText: 'scanned rent clause' },
  { name: 'Client_Photo_ID.jpg', mimeType: 'image/jpeg', text: '' },
  { name: 'Notes.txt', mimeType: 'text/plain', text: 'no keyword here' },
];

test('matter search spends nothing on scanned pages by default', async () => {
  const harness = createHarness(MATTER);
  const result = await run({ query: 'rent' }, harness);

  assert.deepEqual(harness.ocrCalls, [], 'no OCR should happen without include_scanned');
  assert.equal(result.meta.include_scanned, false);
  assert.equal(result.meta.ocr_pages_used, 0);

  // The typed lease is still searched and still produces a hit.
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].name, 'Lease_Agreement.pdf');
});

// The whole point of the design: what was not read is named, with the titles the agent needs to
// judge relevance, rather than dropped silently.
test('matter search names the documents it did not read, with page counts', async () => {
  const harness = createHarness(MATTER);
  const result = await run({ query: 'rent' }, harness);

  // Order follows sortMatterDocumentsForSearch and is asserted elsewhere; what matters here is
  // membership and the page counts.
  const deferred = result.meta.documents_requiring_ocr;
  assert.deepEqual(
    deferred.map((candidate) => [candidate.name, candidate.ocr_page_count]).sort(),
    [['Answer_to_Complaint.pdf', 3], ['Client_Photo_ID.jpg', 1]].sort(),
  );

  for (const candidate of deferred) {
    assert.ok(candidate.document_uuid, 'agent needs an identifier to search the document directly');
    assert.ok('title' in candidate && 'mime_type' in candidate);
  }

  // Prose warning too, so a caller that reads only warnings still learns the search had gaps.
  assert.match(result.warnings.join(' '), /not exhaustive/);
  assert.match(result.warnings.join(' '), /include_scanned/);
});

test('include_scanned reads the scanned pages and reports what it spent', async () => {
  const harness = createHarness(MATTER);
  const result = await run({ query: 'rent', include_scanned: true }, harness);

  assert.deepEqual(harness.ocrCalls, [{ name: 'Answer_to_Complaint.pdf', pages: 3 }]);
  assert.equal(result.meta.include_scanned, true);
  assert.equal(result.meta.ocr_pages_used, 3);
  assert.deepEqual(result.meta.documents_requiring_ocr, []);

  const names = result.data.map((hit) => hit.name).sort();
  assert.deepEqual(names, ['Answer_to_Complaint.pdf', 'Lease_Agreement.pdf']);
});

// A document too big for what is left is deferred whole, not read halfway, so a result is never
// a partial read presented as a complete one.
test('ocr_page_budget defers documents that do not fit rather than truncating them', async () => {
  const harness = createHarness([
    { name: 'Small_Scan.pdf', mimeType: 'application/pdf', text: '', scannedPages: [1], scannedText: 'rent' },
    { name: 'Huge_Scan.pdf', mimeType: 'application/pdf', text: '', scannedPages: [1, 2, 3, 4, 5], scannedText: 'rent' },
  ]);

  const result = await run({ query: 'rent', include_scanned: true, ocr_page_budget: 2 }, harness);

  assert.deepEqual(harness.ocrCalls, [{ name: 'Small_Scan.pdf', pages: 1 }]);
  assert.equal(result.meta.ocr_pages_used, 1);
  assert.deepEqual(
    result.meta.documents_requiring_ocr.map((candidate) => candidate.name),
    ['Huge_Scan.pdf'],
  );
});

// Mixed documents are the common legal filing shape and must not be all-or-nothing at the tool
// level: the typed pages are searchable now, the scanned pages are offered for later.
test('a mixed document contributes hits and still reports its unread pages', async () => {
  const harness = createHarness([
    {
      name: 'Motion_With_Exhibits.pdf',
      mimeType: 'application/pdf',
      text: TYPED,
      scannedPages: [8, 9],
      scannedText: 'exhibit rent ledger',
    },
  ]);

  const result = await run({ query: 'rent' }, harness);

  assert.equal(result.data.length, 1, 'typed pages still searchable');
  assert.deepEqual(
    result.meta.documents_requiring_ocr.map((candidate) => [candidate.name, candidate.ocr_page_count]),
    [['Motion_With_Exhibits.pdf', 2]],
  );
});

test('a matter with no scanned documents reports an empty deferred list and no warning', async () => {
  const harness = createHarness([
    { name: 'Lease_Agreement.pdf', mimeType: 'application/pdf', text: TYPED },
  ]);

  const result = await run({ query: 'rent' }, harness);

  assert.deepEqual(result.meta.documents_requiring_ocr, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.data.length, 1);
});

test('ocr_page_budget rejects nonsense values', async () => {
  const harness = createHarness(MATTER);
  await assert.rejects(
    () => run({ query: 'rent', include_scanned: true, ocr_page_budget: 0 }, harness),
    /ocr_page_budget must be a positive integer/,
  );
});
