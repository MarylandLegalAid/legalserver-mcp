const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const { SERVER_VERSION } = require('./apps/legalserver/constants');
const { createMcpRuntime, createMcpServer } = require('./apps/legalserver/mcpServer');
const {
  createLetterWriterMcpServer,
  createLetterWriterRuntime,
} = require('./apps/letterWriter/mcpServer');
const { createSharedSecretMiddleware, mountStatelessMcpRoute } = require('./shared/http');

function createHttpApp({
  runtime,
  letterWriterRuntime,
  config,
  letterWriterConfig,
  fetchImpl,
  documentTextPipeline,
  ocrProvider,
  s3Client,
  getSignedUrlImpl,
}) {
  const legalserverRuntime = runtime || createMcpRuntime({
    config,
    fetchImpl,
    documentTextPipeline,
    ocrProvider,
  });
  const resolvedLetterWriterConfig = letterWriterConfig || { enabled: false };
  const resolvedLetterWriterRuntime = resolvedLetterWriterConfig.enabled
    ? (letterWriterRuntime || createLetterWriterRuntime({
        config: resolvedLetterWriterConfig,
        s3Client,
        getSignedUrlImpl,
      }))
    : null;

  const app = createMcpExpressApp({
    host: legalserverRuntime.config.httpHost,
    allowedHosts: legalserverRuntime.config.allowedHosts || undefined,
  });
  const legalserverAuth = createSharedSecretMiddleware(legalserverRuntime.config);

  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'legal-tools-mcp',
      version: SERVER_VERSION,
      apps: {
        legalserver: true,
        letter_writer: Boolean(resolvedLetterWriterRuntime),
      },
    });
  });

  const createLegalServer = () => createMcpServer({ runtime: legalserverRuntime });
  mountStatelessMcpRoute({
    app,
    path: '/legalserver/mcp',
    createServer: createLegalServer,
    middleware: legalserverAuth,
  });

  // Preserve the original endpoint during the LibreChat migration.
  mountStatelessMcpRoute({
    app,
    path: '/mcp',
    createServer: createLegalServer,
    middleware: legalserverAuth,
  });

  if (resolvedLetterWriterRuntime) {
    mountStatelessMcpRoute({
      app,
      path: '/letter-writer/mcp',
      createServer: () => createLetterWriterMcpServer({ runtime: resolvedLetterWriterRuntime }),
      middleware: createSharedSecretMiddleware(resolvedLetterWriterRuntime.config),
    });
  }

  return {
    app,
    runtime: legalserverRuntime,
    legalserverRuntime,
    letterWriterRuntime: resolvedLetterWriterRuntime,
  };
}

async function startHttpServer(options) {
  const appRuntime = createHttpApp(options);
  const { app, legalserverRuntime } = appRuntime;

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(
      legalserverRuntime.config.httpPort,
      legalserverRuntime.config.httpHost,
    );
    listener.once('error', reject);
    listener.once('listening', () => {
      listener.removeListener('error', reject);
      resolve(listener);
    });
  });

  return {
    ...appRuntime,
    server,
  };
}

module.exports = {
  createHttpApp,
  startHttpServer,
};
