const { createContactTools } = require('./tools/contacts');
const { createDocumentTools } = require('./tools/documents');
const { createEventTools } = require('./tools/events');
const { createMatterTools } = require('./tools/matters');
const { createOrganizationTools } = require('./tools/organizations');
const { createTaskTools } = require('./tools/tasks');
const { createUserTools } = require('./tools/users');

function createToolRegistry(context) {
  const tools = [
    ...createMatterTools(),
    ...createDocumentTools(),
    ...createTaskTools(),
    ...createEventTools(),
    ...createContactTools(),
    ...createUserTools(),
    ...createOrganizationTools(),
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
