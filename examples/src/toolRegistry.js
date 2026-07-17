const { caseManagementHandlers, caseManagementSchemas } = require('./skills/caseManagement');
const { inspectionHandlers, inspectionSchemas, INSPECTION_CHECKLIST } = require('./skills/inspection');

let intakeNotesModule = null;
function getIntakeNotesModule() {
  if (!intakeNotesModule) {
    intakeNotesModule = require('./skills/intakeNotes');
  }
  return intakeNotesModule;
}

const allHandlers = {
  ...caseManagementHandlers,
  ...inspectionHandlers,
  create_intake_notes: async (args) => {
    const { factsSummaryHandlers } = getIntakeNotesModule();
    return factsSummaryHandlers.create_intake_notes(args);
  }
};

const intakeNotesSchemas = [
  {
    name: 'create_intake_notes',
    description: "Use ONLY when the user specifically asks for 'Intake Notes'. Do not use for general summaries.",
    parameters: {
      type: 'OBJECT',
      properties: {
        case_uuid: { type: 'STRING' },
        exclude_note_ids: { type: 'ARRAY', items: { type: 'INTEGER' } }
      },
      required: ['case_uuid']
    }
  }
];

const toolDeclarations = [
  ...caseManagementSchemas,
  ...inspectionSchemas,
  ...intakeNotesSchemas
].map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters || tool.inputSchema || { type: 'OBJECT', properties: {} }
}));

module.exports = {
  allHandlers,
  toolDeclarations,
  INSPECTION_CHECKLIST
};
