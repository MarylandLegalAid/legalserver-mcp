const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
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

function createHttpApp({ runtime, config, fetchImpl, documentTextPipeline, ocrProvider }) {
  const resolvedRuntime = runtime || createMcpRuntime({
    config,
    fetchImpl,
    documentTextPipeline,
    ocrProvider,
  });
  const app = createMcpExpressApp({ host: resolvedRuntime.config.httpHost });

  app.post('/mcp', async (req, res) => {
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
