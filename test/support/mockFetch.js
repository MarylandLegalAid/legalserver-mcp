const STATUS_TEXT = {
  200: 'OK',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

function createHeaders(headers) {
  const normalized = new Map(
    Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );

  return {
    get(name) {
      return normalized.get(String(name).toLowerCase()) ?? null;
    },
  };
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: STATUS_TEXT[status] || 'Unknown',
    headers: createHeaders({
      'content-type': 'application/json',
      ...headers,
    }),
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
    async arrayBuffer() {
      return Buffer.from(JSON.stringify(body), 'utf8');
    },
  };
}

function textResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: STATUS_TEXT[status] || 'Unknown',
    headers: createHeaders({
      'content-type': 'text/plain',
      ...headers,
    }),
    async json() {
      return JSON.parse(body);
    },
    async text() {
      return body;
    },
    async arrayBuffer() {
      return Buffer.from(body, 'utf8');
    },
  };
}

function binaryResponse(status, body, headers = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: STATUS_TEXT[status] || 'Unknown',
    headers: createHeaders({
      'content-type': 'application/octet-stream',
      'content-length': String(buffer.length),
      ...headers,
    }),
    async json() {
      return JSON.parse(buffer.toString('utf8'));
    },
    async text() {
      return buffer.toString('utf8');
    },
    async arrayBuffer() {
      return buffer;
    },
  };
}

function createSequentialFetch(responses, calls) {
  const queue = [...responses];

  return async function mockFetch(url, options) {
    calls.push({ url, options });

    if (queue.length === 0) {
      throw new Error(`Unexpected fetch call for ${url}`);
    }

    return queue.shift();
  };
}

module.exports = {
  binaryResponse,
  createSequentialFetch,
  jsonResponse,
  textResponse,
};
