#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { loadConfig } = require('./src/config');
const { startHttpServer } = require('./src/httpServer');

async function main() {
  const config = loadConfig(process.env);
  const { server } = await startHttpServer({
    config,
    fetchImpl: global.fetch,
  });
  console.error(`legalserver-mcp listening on http://${config.httpHost}:${config.httpPort}/mcp`);

  await new Promise((resolve, reject) => {
    server.once('close', resolve);
    server.once('error', reject);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
