const { S3Client } = require('@aws-sdk/client-s3');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { TOOLS, createLetter, listLetterheads } = require('./service');

function createLetterWriterRuntime({ config, s3Client, getSignedUrlImpl }) {
  return {
    config,
    s3Client: s3Client || new S3Client({ region: config.region }),
    getSignedUrlImpl,
  };
}

function createLetterWriterMcpServer({ runtime }) {
  const server = new Server(
    {
      name: 'letter-writer-mcp',
      version: '3.0.0',
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (request.params.name === 'list_letterheads') {
        return await listLetterheads();
      }
      if (request.params.name === 'create_letter') {
        return await createLetter(request.params.arguments || {}, runtime);
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  server.runtime = runtime;
  return server;
}

module.exports = {
  createLetterWriterMcpServer,
  createLetterWriterRuntime,
};
