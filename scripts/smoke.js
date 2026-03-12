const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { CANONICAL_TOOL_NAMES } = require('../src/constants');
const { createMcpServer } = require('../src/mcpServer');

async function main() {
  const server = createMcpServer({
    config: {
      baseUrl: 'https://example.legalserver.test/',
      bearerToken: 'smoke-token',
      timeoutMs: 30000,
    },
    fetchImpl: async () => {
      throw new Error('Smoke test must not call LegalServer');
    },
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: 'legalserver-mcp-smoke',
    version: '1.0.0',
  });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const result = await client.listTools();
  const toolNames = result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, [...CANONICAL_TOOL_NAMES].sort());

  console.log(`Smoke test passed: ${toolNames.length} tools advertised.`);

  await clientTransport.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
