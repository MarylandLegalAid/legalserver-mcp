#!/usr/bin/env node

require('dotenv').config({
  path: ['.env', '.env.letter-writer'],
  quiet: true,
});

const { loadConfig } = require('./src/apps/legalserver/config');
const { loadLetterWriterConfig } = require('./src/apps/letterWriter/config');
const { startHttpServer } = require('./src/httpServer');

async function main() {
  const config = loadConfig(process.env);
  const letterWriterConfig = loadLetterWriterConfig(process.env);
  const { server } = await startHttpServer({
    config,
    letterWriterConfig,
    fetchImpl: global.fetch,
  });
  console.error(`legal-tools-mcp listening on http://${config.httpHost}:${config.httpPort}`);
  console.error('LegalServer MCP endpoint: /legalserver/mcp');
  if (letterWriterConfig.enabled) {
    console.error('LetterWriter MCP endpoint: /letter-writer/mcp');
  }

  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(`legal-tools-mcp received ${signal}, shutting down`);
    await new Promise((resolve) => server.close(resolve));
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT')
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM')
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
  });

  return new Promise((resolve, reject) => {
    server.once('close', resolve);
    server.once('error', reject);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
