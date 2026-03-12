#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { loadConfig } = require('./src/config');
const { createMcpServer } = require('./src/mcpServer');

async function main() {
  const config = loadConfig(process.env);
  const server = createMcpServer({
    config,
    fetchImpl: global.fetch,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
  const keepAlive = setInterval(() => {}, 1 << 30);
  await new Promise((resolve) => {
    function finish() {
      clearInterval(keepAlive);
      resolve();
    }

    process.stdin.once('close', finish);
    process.stdin.once('end', finish);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
