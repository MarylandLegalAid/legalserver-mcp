const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { CANONICAL_TOOL_NAMES } = require('../src/apps/legalserver/constants');
const { createHttpApp } = require('../src/httpServer');

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

async function main() {
  const { app } = createHttpApp({
    config: {
      baseUrl: 'https://example.legalserver.test/',
      bearerToken: 'smoke-token',
      timeoutMs: 30000,
      documentOcrProvider: 'none',
      documentOcrModel: 'gpt-5.6-luna',
      httpHost: '127.0.0.1',
      httpPort: 3001,
      allowedHosts: null,
      sharedSecret: null,
      sharedSecretHeader: 'x-legalserver-mcp-secret',
      userEmailHeader: 'x-legalserver-user-email',
    },
    fetchImpl: async () => {
      throw new Error('Smoke test must not call LegalServer');
    },
  });
  const server = await startServer(app);
  const address = server.address();
  const clientTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/legalserver/mcp`));
  const client = new Client({
    name: 'legalserver-mcp-smoke',
    version: '1.0.0',
  });

  await client.connect(clientTransport);

  const result = await client.listTools();
  const toolNames = result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, [...CANONICAL_TOOL_NAMES].sort());

  console.log(`Smoke test passed: ${toolNames.length} tools advertised.`);

  await client.close();
  server.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
