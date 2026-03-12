const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('../../src/helpers');

test('pagination helpers validate and cap values', () => {
  assert.equal(helpers.validatePage(undefined), 1);
  assert.equal(helpers.validatePageSize(undefined), 10);
  assert.equal(helpers.validatePageSize(999), 25);
  assert.equal(helpers.validateMaxChars(20000), 12000);
  assert.throws(() => helpers.validatePage('abc'), /page must be a positive integer/);
});

test('paginateArray returns slice and total counts', () => {
  const result = helpers.paginateArray([1, 2, 3, 4, 5], 2, 2);
  assert.deepEqual(result, {
    items: [3, 4],
    page: 2,
    pageSize: 2,
    totalRecords: 5,
    totalPages: 3,
  });
});

test('htmlToText flattens markup and previews truncate', () => {
  const text = helpers.htmlToText('<p>Hello&nbsp;<strong>world</strong></p><ul><li>One</li><li>Two</li></ul>');
  assert.equal(text, 'Hello world\n- One\n- Two');

  const preview = helpers.makePreview('x'.repeat(301), 300);
  assert.equal(preview.preview.length, 300);
  assert.equal(preview.truncated, true);
});

test('tool errors keep explicit error codes and statuses in envelopes', () => {
  const envelope = helpers.toErrorEnvelope(new helpers.ToolError({
    errorCode: 'unsupported_media_type',
    message: 'Unsupported document',
    status: 415,
  }));

  assert.equal(envelope.error_code, 'unsupported_media_type');
  assert.equal(envelope.status, 415);
});
