const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const { SERVER_VERSION } = require('./apps/legalserver/constants');
const { createMcpRuntime, createMcpServer } = require('./apps/legalserver/mcpServer');
const { createSharedSecretMiddleware, mountStatelessMcpRoute } = require('./shared/http');

function createHttpApp({
  runtime,
  config,
  fetchImpl,
  documentTextPipeline,
  ocrProvider,
}) {
  const legalserverRuntime = runtime || createMcpRuntime({
    config,
    fetchImpl,
    documentTextPipeline,
    ocrProvider,
  });

  const app = createMcpExpressApp({
    host: legalserverRuntime.config.httpHost,
    allowedHosts: legalserverRuntime.config.allowedHosts || undefined,
  });
  const legalserverAuth = createSharedSecretMiddleware(legalserverRuntime.config);

  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'legalserver-mcp',
      version: SERVER_VERSION,
      apps: {
        legalserver: true,
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

  return {
    app,
    runtime: legalserverRuntime,
    legalserverRuntime,
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
