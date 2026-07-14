const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

function writeMethodNotAllowed(res) {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed.',
    },
    id: null,
  });
}

function createSharedSecretMiddleware({ sharedSecret, sharedSecretHeader }) {
  if (!sharedSecret) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const providedSecret = req.get(sharedSecretHeader);
    if (!providedSecret || !providedSecret.trim()) {
      res.status(401).json({
        ok: false,
        error_code: 'missing_shared_secret',
        message: 'Missing required MCP shared secret header.',
        status: 401,
      });
      return;
    }

    if (providedSecret !== sharedSecret) {
      res.status(403).json({
        ok: false,
        error_code: 'invalid_shared_secret',
        message: 'Invalid MCP shared secret header.',
        status: 403,
      });
      return;
    }

    next();
  };
}

function mountStatelessMcpRoute({ app, path, createServer, middleware }) {
  app.post(path, middleware, async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

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

  app.get(path, (_req, res) => writeMethodNotAllowed(res));
  app.delete(path, (_req, res) => writeMethodNotAllowed(res));
}

module.exports = {
  createSharedSecretMiddleware,
  mountStatelessMcpRoute,
  writeMethodNotAllowed,
};
