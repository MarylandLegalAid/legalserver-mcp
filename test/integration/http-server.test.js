const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { CANONICAL_TOOL_NAMES, SERVER_VERSION } = require('../../src/constants');
const { createHttpApp } = require('../../src/httpServer');
const { jsonResponse } = require('../support/mockFetch');

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

function createBaseConfig(overrides = {}) {
  return {
    baseUrl: 'https://example.legalserver.org/',
    bearerToken: 'token',
    timeoutMs: 30000,
    documentOcrProvider: 'none',
    documentOcrModel: 'gemini-2.5-flash',
    googleCloudProject: null,
    googleCloudLocation: 'global',
    httpHost: '127.0.0.1',
    httpPort: 3001,
    allowedHosts: null,
    sharedSecret: null,
    sharedSecretHeader: 'x-legalserver-mcp-secret',
    userEmailHeader: 'x-legalserver-user-email',
    ...overrides,
  };
}

function initializePayload() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'legalserver-mcp-http-test',
        version: '1.0.0',
      },
    },
  };
}

function requestWithHost({ port, hostHeader, path = '/healthz', method = 'GET' }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        Host: hostHeader,
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ response, body });
      });
    });

    request.once('error', reject);
    request.end();
  });
}

test('HTTP server exposes an unauthenticated health endpoint', async () => {
  const { app } = createHttpApp({
    config: createBaseConfig(),
    fetchImpl: async () => {
      throw new Error('healthz must not call LegalServer');
    },
  });
  const server = await startServer(app);
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      ok: true,
      service: 'legalserver-mcp',
      version: SERVER_VERSION,
    });
  } finally {
    server.close();
  }
});

test('HTTP server rejects MCP calls when the shared secret header is missing', async () => {
  const { app } = createHttpApp({
    config: createBaseConfig({
      sharedSecret: 'super-secret',
    }),
    fetchImpl: async () => {
      throw new Error('shared-secret guard must run before LegalServer calls');
    },
  });
  const server = await startServer(app);
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(initializePayload()),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.error_code, 'missing_shared_secret');
  } finally {
    server.close();
  }
});

test('HTTP server rejects MCP calls when the shared secret header is invalid', async () => {
  const { app } = createHttpApp({
    config: createBaseConfig({
      sharedSecret: 'super-secret',
    }),
    fetchImpl: async () => {
      throw new Error('shared-secret guard must run before LegalServer calls');
    },
  });
  const server = await startServer(app);
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-legalserver-mcp-secret': 'wrong-secret',
      },
      body: JSON.stringify(initializePayload()),
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error_code, 'invalid_shared_secret');
  } finally {
    server.close();
  }
});

test('HTTP server rejects disallowed Host headers', async () => {
  const { app } = createHttpApp({
    config: createBaseConfig({
      allowedHosts: ['legalserver-mcp', '127.0.0.1'],
    }),
    fetchImpl: async () => {
      throw new Error('host filter must run before LegalServer calls');
    },
  });
  const server = await startServer(app);
  const address = server.address();

  try {
    const { response, body } = await requestWithHost({
      port: address.port,
      hostHeader: 'unexpected-host',
    });
    const payload = JSON.parse(body);

    assert.equal(response.statusCode, 403);
    assert.equal(payload.error.message, 'Invalid Host: unexpected-host');
  } finally {
    server.close();
  }
});

test('HTTP server lists canonical tools and supports current-user task lookup', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    fetchCalls.push(parsed.toString());

    if (parsed.pathname === '/api/v1/users') {
      return jsonResponse(200, {
        page_number: 1,
        page_size: 25,
        total_records: 1,
        total_number_of_pages: 1,
        data: [{
          id: 404,
          user_uuid: 'user-uuid-1',
          first: 'Jordan',
          last: 'Staff',
          email: 'jordan@example.org',
          login: 'jstaff',
          active: true,
          current: true,
          contact_active: true,
        }],
      });
    }

    if (parsed.pathname === '/api/v1/tasks') {
      return jsonResponse(200, {
        page_number: 1,
        page_size: 25,
        total_records: 2,
        total_number_of_pages: 1,
        data: [
          {
            id: 101,
            task_uuid: 'task-uuid-other',
            active: true,
            title: 'Other user task',
            list_date: '2026-03-12',
            due_date: '2026-03-14',
            task_type: 'Follow Up',
            deadline: false,
            completed: false,
            users: {
              all_values: 'Assigned User',
              individual_values: [{
                user_id: 7,
                user_uuid: 'user-uuid-7',
                user_name: 'Assigned User',
              }],
            },
          },
          {
            id: 102,
            task_uuid: 'task-uuid-current',
            active: true,
            title: 'My task',
            list_date: '2026-03-12',
            due_date: '2026-03-14',
            task_type: 'Follow Up',
            deadline: false,
            completed: false,
            users: {
              all_values: 'Jordan Staff',
              individual_values: [{
                user_id: 404,
                user_uuid: 'user-uuid-1',
                user_name: 'Jordan Staff',
              }],
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected HTTP fetch for ${parsed}`);
  };

  const { app } = createHttpApp({
    config: createBaseConfig({
      allowedHosts: ['127.0.0.1'],
      sharedSecret: 'super-secret',
    }),
    fetchImpl,
  });
  const server = await startServer(app);
  const address = server.address();
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`),
    {
      requestInit: {
        headers: {
          'X-LegalServer-User-Email': 'jordan@example.org',
          'X-LegalServer-Mcp-Secret': 'super-secret',
        },
      },
    },
  );
  const client = new Client({
    name: 'legalserver-mcp-http-test',
    version: '1.0.0',
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [...CANONICAL_TOOL_NAMES].sort(),
    );

    const result = await client.callTool({
      name: 'task_list_current_user_on_date',
      arguments: { date: '2026-03-12' },
    });
    const payload = parseToolResult(result);

    assert.equal(payload.ok, true);
    assert.deepEqual(payload.data.map((item) => item.task_uuid), ['task-uuid-current']);
    assert.equal(fetchCalls.filter((url) => url.includes('/api/v1/users')).length, 1);
    assert.equal(fetchCalls.filter((url) => url.includes('/api/v1/tasks')).length, 1);
  } finally {
    await client.close();
    server.close();
  }
});
