const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createHttpApp } = require('../../src/httpServer');

function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

function createLegalServerConfig() {
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
    sharedSecret: 'legalserver-secret',
    sharedSecretHeader: 'x-legalserver-mcp-secret',
    userEmailHeader: 'x-legalserver-user-email',
  };
}

function createLetterWriterConfig() {
  return {
    enabled: true,
    region: 'us-east-1',
    bucketName: 'letters-test',
    s3Prefix: 'mcp/letters',
    presignExpiresSeconds: 900,
    sharedSecret: 'letter-secret',
    sharedSecretHeader: 'x-letter-writer-secret',
  };
}

test('one HTTP service exposes separately authenticated LegalServer and LetterWriter MCP endpoints', async () => {
  const { app } = createHttpApp({
    config: createLegalServerConfig(),
    letterWriterConfig: createLetterWriterConfig(),
    fetchImpl: async () => {
      throw new Error('tool listing must not call LegalServer');
    },
    s3Client: { send: async () => ({}) },
    getSignedUrlImpl: async () => 'https://download.example.test/signed',
  });
  const server = await startServer(app);
  const { port } = server.address();

  const unauthorizedResponse = await fetch(`http://127.0.0.1:${port}/letter-writer/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-legalserver-mcp-secret': 'legalserver-secret',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    }),
  });
  assert.equal(unauthorizedResponse.status, 401);

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/letter-writer/mcp`),
    { requestInit: { headers: { 'X-Letter-Writer-Secret': 'letter-secret' } } },
  );
  const client = new Client({ name: 'letter-writer-http-test', version: '1.0.0' });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ['create_letter', 'list_letterheads']);

    const result = await client.callTool({ name: 'list_letterheads', arguments: {} });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.default_fallback, 'generic');
    assert.equal(payload.letterheads.length, 13);

    const health = await fetch(`http://127.0.0.1:${port}/healthz`).then((response) => response.json());
    assert.equal(health.apps.legalserver, true);
    assert.equal(health.apps.letter_writer, true);
  } finally {
    await client.close();
    server.close();
  }
});
