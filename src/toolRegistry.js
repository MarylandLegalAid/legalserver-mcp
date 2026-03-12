const { createDocumentTools } = require('./tools/documents');
const { createMatterTools } = require('./tools/matters');

function createToolRegistry(context) {
  const tools = [
    ...createMatterTools(),
    ...createDocumentTools(),
  ];
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  async function execute(name, args) {
    const tool = toolMap.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return tool.handler({
      ...context,
      args: args || {},
    });
  }

  return {
    tools,
    toolMap,
    execute,
  };
}

module.exports = {
  createToolRegistry,
};
