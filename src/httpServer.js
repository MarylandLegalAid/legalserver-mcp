const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { SERVER_VERSION } = require('./constants');
const { ToolError, toErrorEnvelope } = require('./helpers/errors');
const { createMcpRuntime, createMcpServer } = require('./mcpServer');

function writeMethodNotAllowed(res) {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed.',
    },
    id: null,
  }));
}

function writeHttpError(res, status, errorCode, message) {
  res.status(status).json(toErrorEnvelope(new ToolError({
    errorCode,
    message,
    status,
  })));
}

function createSharedSecretMiddleware(config) {
  if (!config.sharedSecret) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const providedSecret = req.get(config.sharedSecretHeader);
    if (!providedSecret || !providedSecret.trim()) {
      writeHttpError(res, 401, 'missing_shared_secret', 'Missing required MCP shared secret header.');
      return;
    }

    if (providedSecret !== config.sharedSecret) {
      writeHttpError(res, 403, 'invalid_shared_secret', 'Invalid MCP shared secret header.');
      return;
    }

    next();
  };
}

function createHttpApp({ runtime, config, fetchImpl, documentTextPipeline, ocrProvider }) {
  const resolvedRuntime = runtime || createMcpRuntime({
    config,
    fetchImpl,
    documentTextPipeline,
    ocrProvider,
  });
  const app = createMcpExpressApp({
    host: resolvedRuntime.config.httpHost,
    allowedHosts: resolvedRuntime.config.allowedHosts || undefined,
  });
  const sharedSecretMiddleware = createSharedSecretMiddleware(resolvedRuntime.config);

  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'legalserver-mcp',
      version: SERVER_VERSION,
    });
  });

  app.post('/mcp', sharedSecretMiddleware, async (req, res) => {
    const server = createMcpServer({ runtime: resolvedRuntime });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const cleanup = () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    };

    res.once('close', cleanup);

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    writeMethodNotAllowed(res);
  });

  app.delete('/mcp', (_req, res) => {
    writeMethodNotAllowed(res);
  });

  return {
    app,
    runtime: resolvedRuntime,
  };
}

async function startHttpServer(options) {
  const { app, runtime } = createHttpApp(options);

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(runtime.config.httpPort, runtime.config.httpHost);
    listener.once('error', reject);
    listener.once('listening', () => {
      listener.removeListener('error', reject);
      resolve(listener);
    });
  });

  return {
    app,
    runtime,
    server,
  };
}

module.exports = {
  createHttpApp,
  startHttpServer,
};
