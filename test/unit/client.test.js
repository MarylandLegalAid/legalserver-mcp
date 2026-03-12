const test = require('node:test');
const assert = require('node:assert/strict');
const { LegalServerClient, normalizeEnvelope } = require('../../src/legalserverClient');
const { toErrorEnvelope } = require('../../src/helpers');
const { binaryResponse, createSequentialFetch, jsonResponse, textResponse } = require('../support/mockFetch');

function createClient(fetchImpl) {
  return new LegalServerClient({
    baseUrl: 'https://example.legalserver.org/',
    bearerToken: 'token',
    timeoutMs: 30000,
    fetchImpl,
  });
}

test('normalizeEnvelope handles data, full_data, raw array, and raw object', () => {
  assert.deepEqual(normalizeEnvelope({ data: [{ id: 1 }], page_number: 2, page_size: 5, total_records: 11, total_number_of_pages: 3 }), {
    data: [{ id: 1 }],
    page: 2,
    pageSize: 5,
    totalPages: 3,
    totalRecords: 11,
  });
  assert.deepEqual(normalizeEnvelope({ full_data: [{ id: 1 }] }).data, [{ id: 1 }]);
  assert.deepEqual(normalizeEnvelope([{ id: 1 }]).data, [{ id: 1 }]);
  assert.deepEqual(normalizeEnvelope({ id: 1 }).data, { id: 1 });
});

test('client builds allowlisted GET URLs with query params', async () => {
  const calls = [];
  const fetchImpl = createSequentialFetch([
    jsonResponse(200, { data: [{ case_number: '24-0001' }], page_number: 1, page_size: 1, total_records: 1, total_number_of_pages: 1 }),
  ], calls);

  const client = createClient(fetchImpl);
  const result = await client.getJson('/api/v1/matters', {
    query: { case_number: '24-0001', results: 'full', page_size: 1 },
  });

  assert.equal(result.totalRecords, 1);
  assert.match(calls[0].url, /case_number=24-0001/);
  assert.match(calls[0].url, /results=full/);
});

test('client rejects non-allowlisted endpoints', async () => {
  const client = createClient(async () => jsonResponse(200, {}));
  await assert.rejects(() => client.getJson('/api/v1/tasks'), /not allowlisted/);
});

test('client maps LegalServer errors including retry-after', async () => {
  const client = createClient(createSequentialFetch([
    jsonResponse(429, { message: 'Slow down' }, { 'retry-after': '12' }),
  ], []));

  let error;
  try {
    await client.getJson('/api/v1/matters');
  } catch (caughtError) {
    error = caughtError;
  }

  assert.ok(error);
  const envelope = toErrorEnvelope(error);
  assert.equal(envelope.error_code, 'rate_limited');
  assert.equal(envelope.retry_after, 12);
});

test('client parses text error bodies', async () => {
  const client = createClient(createSequentialFetch([
    textResponse(503, 'Temporary outage'),
  ], []));

  let error;
  try {
    await client.getJson('/api/v1/matters');
  } catch (caughtError) {
    error = caughtError;
  }

  assert.ok(error);
  assert.equal(error.message, 'Temporary outage');
});

test('client validates same-origin document download URLs', async () => {
  const client = createClient(async () => binaryResponse(200, 'ok'));

  assert.equal(
    client.validateBinaryDownloadUrl('https://example.legalserver.org/modules/document/download.php?id=1').toString(),
    'https://example.legalserver.org/modules/document/download.php?id=1',
  );

  assert.throws(
    () => client.validateBinaryDownloadUrl('https://evil.example.com/modules/document/download.php?id=1'),
    /allowlisted LegalServer binary endpoint/,
  );
  assert.throws(
    () => client.validateBinaryDownloadUrl('https://example.legalserver.org/not-allowed?id=1'),
    /allowlisted LegalServer binary endpoint/,
  );
});

test('client downloads binary payloads with allowlisted URLs', async () => {
  const calls = [];
  const client = createClient(createSequentialFetch([
    binaryResponse(200, Buffer.from('hello world', 'utf8'), { 'content-type': 'text/plain' }),
  ], calls));

  const result = await client.downloadBinary('https://example.legalserver.org/modules/document/download.php?id=1');

  assert.equal(result.buffer.toString('utf8'), 'hello world');
  assert.equal(calls[0].options.headers.Accept, '*/*');
});

test('client enforces the phase 2 document size limit', async () => {
  const client = createClient(async () => binaryResponse(200, Buffer.alloc(10)));

  await assert.rejects(
    () => client.downloadBinary(
      'https://example.legalserver.org/modules/document/download.php?id=1',
      { expectedSizeBytes: (50 * 1024 * 1024) + 1 },
    ),
    (error) => {
      assert.equal(error.errorCode, 'document_too_large');
      assert.equal(error.status, 413);
      return true;
    },
  );
});
