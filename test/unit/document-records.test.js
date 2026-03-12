const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('../../src/helpers');
const {
  getDocumentTextStrategy,
  mapDocumentRecord,
  sortMatterDocumentsForSearch,
} = require('../../src/tools/shared/documentRecords');

test('document records map text_strategy from mime type or extension', () => {
  assert.equal(getDocumentTextStrategy({ mime_type: 'text/plain', name: 'notes.txt' }), 'direct');
  assert.equal(getDocumentTextStrategy({ mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', name: 'memo.docx' }), 'direct');
  assert.equal(getDocumentTextStrategy({ mime_type: 'application/pdf', name: 'scan.pdf' }), 'direct_or_ocr');
  assert.equal(getDocumentTextStrategy({ mime_type: 'image/jpeg', name: 'photo.jpg' }), 'ocr');
  assert.equal(getDocumentTextStrategy({ mime_type: 'application/octet-stream', name: 'archive.bin' }), 'unsupported');
});

test('document records prefer explicit mime_type over conflicting file extension', () => {
  assert.equal(getDocumentTextStrategy({ mime_type: 'image/png', name: 'scan.pdf' }), 'ocr');
  assert.equal(getDocumentTextStrategy({ mime_type: 'image/jpeg', name: 'scan.pdf' }), 'ocr');
});

test('mapDocumentRecord normalizes document metadata with text_strategy', () => {
  const mapped = mapDocumentRecord({
    guid: 'doc-1',
    internal_id: 501,
    name: 'lease.pdf',
    title: 'Lease',
    mime_type: 'application/pdf; charset=binary',
    disk_file_size: 1200,
    date_create: '2024-01-04T00:00:00Z',
    date_update: '2024-01-05T00:00:00Z',
  });

  assert.deepEqual(mapped, {
    document_uuid: 'doc-1',
    document_id: 501,
    name: 'lease.pdf',
    title: 'Lease',
    mime_type: 'application/pdf',
    size_bytes: 1200,
    estimated_tokens: 300,
    text_strategy: 'direct_or_ocr',
    date_created: '2024-01-04T00:00:00Z',
    date_updated: '2024-01-05T00:00:00Z',
    virus_scanned: null,
    virus_free: null,
    folder_id: null,
  });
});

test('matter document search order sorts by updated desc, created desc, then document id asc', () => {
  const sorted = sortMatterDocumentsForSearch([
    { internal_id: 20, date_update: '2024-01-04T00:00:00Z', date_create: '2024-01-01T00:00:00Z' },
    { internal_id: 10, date_update: '2024-01-05T00:00:00Z', date_create: '2024-01-02T00:00:00Z' },
    { internal_id: 11, date_update: '2024-01-05T00:00:00Z', date_create: '2024-01-02T00:00:00Z' },
    { internal_id: 5, date_update: '2024-01-05T00:00:00Z', date_create: '2024-01-03T00:00:00Z' },
  ], helpers);

  assert.deepEqual(sorted.map((record) => record.internal_id), [5, 10, 11, 20]);
});
