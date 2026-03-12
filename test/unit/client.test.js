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

function createHeaders(headers = {}) {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );

  return {
    get(name) {
      return normalized.get(String(name).toLowerCase()) ?? null;
    },
  };
}

function customBinaryResponse({
  status = 200,
  body = Buffer.from('fixture'),
  headers = {},
  arrayBuffer = true,
  buffer = false,
  reader = false,
  text = false,
}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: {
      200: 'OK',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      429: 'Too Many Requests',
      503: 'Service Unavailable',
    }[status] || 'Unknown',
    headers: createHeaders({
      'content-type': 'application/octet-stream',
      'content-length': String(payload.length),
      ...headers,
    }),
  };

  if (arrayBuffer) {
    response.arrayBuffer = async () => payload;
  }
  if (buffer) {
    response.buffer = async () => payload;
  }
  if (reader) {
    let offset = 0;
    response.body = {
      getReader() {
        return {
          async read() {
            if (offset >= payload.length) {
              return { done: true, value: undefined };
            }

            const value = payload.subarray(offset, Math.min(offset + 3, payload.length));
            offset += value.length;
            return { done: false, value };
          },
        };
      },
    };
  }
  if (text) {
    response.text = async () => payload.toString('utf8');
  }

  return response;
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

test('client builds document download candidates in identifier-first order and de-duplicates metadata URLs', () => {
  const client = createClient(async () => binaryResponse(200, 'unused'));

  const candidates = client.getDocumentDownloadCandidates({
    guid: 'doc-guid-1',
    internal_id: 501,
    download_url: 'https://example.legalserver.org/modules/document/download.php?id=501',
  });

  assert.deepEqual(candidates.map((candidate) => candidate.toString()), [
    'https://example.legalserver.org/modules/document/download.php?unique_id=doc-guid-1',
    'https://example.legalserver.org/modules/document/download.php?id=501',
  ]);
});

test('client downloads documents successfully when download_url is absent', async () => {
  const calls = [];
  const client = createClient(createSequentialFetch([
    binaryResponse(200, Buffer.from('hello world', 'utf8'), {
      'content-type': 'text/plain',
      'content-disposition': 'attachment; filename="notes.txt"',
    }),
  ], calls));

  const result = await client.downloadDocumentBinary({
    guid: 'doc-guid-1',
    internal_id: 501,
    name: 'notes.txt',
  });

  assert.equal(result.buffer.toString('utf8'), 'hello world');
  assert.equal(result.filename, 'notes.txt');
  assert.equal(result.url, 'https://example.legalserver.org/modules/document/download.php?unique_id=doc-guid-1');
  assert.equal(calls[0].options.headers.Accept, '*/*');
});

test('client ignores invalid and cross-origin metadata download URLs when identifiers exist', async () => {
  const calls = [];
  const client = createClient(createSequentialFetch([
    binaryResponse(200, Buffer.from('ok', 'utf8')),
  ], calls));

  await client.downloadDocumentBinary({
    guid: 'doc-guid-1',
    internal_id: 501,
    download_url: 'https://evil.example.com/modules/document/download.php?id=501',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.legalserver.org/modules/document/download.php?unique_id=doc-guid-1');
});

test('client falls back from unique_id to id when the first candidate 404s', async () => {
  const calls = [];
  const client = createClient(createSequentialFetch([
    textResponse(404, 'missing'),
    binaryResponse(200, Buffer.from('recovered', 'utf8')),
  ], calls));

  const result = await client.downloadDocumentBinary({
    guid: 'doc-guid-1',
    internal_id: 501,
  });

  assert.equal(result.buffer.toString('utf8'), 'recovered');
  assert.equal(result.url, 'https://example.legalserver.org/modules/document/download.php?id=501');
  assert.deepEqual(calls.map((call) => call.url), [
    'https://example.legalserver.org/modules/document/download.php?unique_id=doc-guid-1',
    'https://example.legalserver.org/modules/document/download.php?id=501',
  ]);
});

test('client sanitizes HTML download failures', async () => {
  const client = createClient(createSequentialFetch([
    textResponse(503, '<!DOCTYPE html><html><body>oops</body></html>', {
      'content-type': 'text/html',
    }),
  ], []));

  await assert.rejects(
    () => client.downloadDocumentBinary({ guid: 'doc-guid-1' }),
    (error) => {
      assert.equal(error.errorCode, 'service_unavailable');
      assert.equal(error.status, 503);
      assert.equal(error.message, 'LegalServer document download failed with 503 Service Unavailable.');
      assert.equal(error.message.includes('<html'), false);
      return true;
    },
  );
});

test('client reads binary bodies via arrayBuffer, buffer, stream reader, and text fallback', async () => {
  const cases = [
    { response: customBinaryResponse({ body: 'array-buffer-body' }), expected: 'array-buffer-body' },
    { response: customBinaryResponse({ body: 'buffer-body', arrayBuffer: false, buffer: true }), expected: 'buffer-body' },
    { response: customBinaryResponse({ body: 'reader-body', arrayBuffer: false, reader: true }), expected: 'reader-body' },
    { response: customBinaryResponse({ body: 'text-body', arrayBuffer: false, text: true }), expected: 'text-body' },
  ];

  for (const { response, expected } of cases) {
    const client = createClient(createSequentialFetch([response], []));
    const result = await client.downloadDocumentBinary({ guid: 'doc-guid-1' });
    assert.equal(result.buffer.toString('utf8'), expected);
  }
});

test('client maps all-404 candidate failures to a clean extraction error', async () => {
  const client = createClient(createSequentialFetch([
    textResponse(404, 'missing one'),
    textResponse(404, 'missing two'),
  ], []));

  await assert.rejects(
    () => client.downloadDocumentBinary({ guid: 'doc-guid-1', internal_id: 501 }),
    (error) => {
      assert.equal(error.errorCode, 'extraction_failed');
      assert.equal(error.status, 502);
      assert.equal(
        error.message,
        'LegalServer returned document metadata, but no retrievable allowlisted download URL was available for this document.',
      );
      return true;
    },
  );
});

test('client surfaces sanitized authorization failures when all candidates are blocked', async () => {
  const client = createClient(createSequentialFetch([
    textResponse(404, 'missing one'),
    textResponse(403, '<html>forbidden</html>', { 'content-type': 'text/html' }),
  ], []));

  await assert.rejects(
    () => client.downloadDocumentBinary({ guid: 'doc-guid-1', internal_id: 501 }),
    (error) => {
      assert.equal(error.errorCode, 'forbidden');
      assert.equal(error.status, 403);
      assert.equal(error.message, 'LegalServer document download failed with 403 Forbidden.');
      assert.equal(error.message.includes('<html'), false);
      return true;
    },
  );
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
