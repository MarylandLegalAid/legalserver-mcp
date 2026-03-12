const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { SERVER_VERSION } = require('./constants');
const { createDocumentTextPipeline } = require('./documentText');
const { createOcrProvider } = require('./documentText/ocrProviders');
const { LegalServerClient } = require('./legalserverClient');
const helpers = require('./helpers');
const { createToolRegistry } = require('./toolRegistry');

function createMcpServer({ config, fetchImpl, documentTextPipeline, ocrProvider }) {
  const client = new LegalServerClient({
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    timeoutMs: config.timeoutMs,
    fetchImpl,
  });
  const pipeline = documentTextPipeline || createDocumentTextPipeline({
    client,
    config,
    ocrProvider: ocrProvider || createOcrProvider(config),
  });

  const registry = createToolRegistry({
    client,
    documentTextPipeline: pipeline,
    helpers,
  });

  const server = new Server(
    {
      name: 'legalserver-mcp',
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const payload = await registry.execute(request.params.name, request.params.arguments || {});
      return helpers.toMcpTextResult(payload, false);
    } catch (error) {
      return helpers.toMcpTextResult(helpers.toErrorEnvelope(error), true);
    }
  });

  server.registry = registry;
  return server;
}

module.exports = {
  createMcpServer,
};
