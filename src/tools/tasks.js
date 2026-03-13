const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('../constants');
const { isoDateProperty, pageProperties, uuidProperty } = require('./shared/schemas');
const {
  normalizeModuleDetail,
  normalizeModuleRef,
  normalizeUserRef,
  runPaginatedSearch,
} = require('./shared/globalDiscovery');

function mapTaskSummary(record, helpers) {
  return {
    task_uuid: record.task_uuid ?? null,
    id: record.id ?? null,
    title: record.title ?? null,
    active: record.active ?? null,
    completed: record.completed ?? null,
    deadline: record.deadline ?? null,
    list_date: helpers.normalizeDateValue(record.list_date),
    due_date: helpers.normalizeDateValue(record.due_date),
    completed_date: helpers.normalizeDateValue(record.completed_date),
    task_type: record.task_type ?? null,
    deadline_type: record.deadline_type ?? null,
    users: helpers.normalizeArrayValue(record.users).map(normalizeUserRef).filter(Boolean),
    module: normalizeModuleRef(record.module),
    office: helpers.normalizeOffice(record.office),
    program: record.program ?? null,
    created_by: normalizeUserRef(record.created_by),
    completed_by: normalizeUserRef(record.completed_by),
  };
}

function mapTaskDetail(record, helpers) {
  return {
    ...mapTaskSummary(record, helpers),
    private: record.private ?? null,
    statute_of_limitations: record.statute_of_limitations ?? null,
    module: normalizeModuleDetail(record.module),
  };
}

function createTaskTools() {
  return [
    {
      name: 'task_search',
      description: 'Search LegalServer tasks and deadlines across matters with explicit filters only.',
      inputSchema: {
        type: 'object',
        properties: {
          ...pageProperties(),
          id: { type: 'integer', description: 'LegalServer task ID.' },
          title: { type: 'string', description: 'Task title filter.' },
          active: { type: 'boolean', description: 'Active task filter.' },
          completed: { type: 'boolean', description: 'Completed task filter.' },
          deadline: { type: 'boolean', description: 'Limit results to tasks or deadlines.' },
          task_type: { type: 'string', description: 'Task type filter.' },
          deadline_type: { type: 'string', description: 'Deadline type filter.' },
          list_date: isoDateProperty('Task list date in YYYY-MM-DD format.'),
          users: { type: 'string', description: 'Assigned user filter.' },
          module: {
            type: 'string',
            enum: ['matter', 'outreach', 'grant', 'event'],
            description: 'Restrict tasks to one linked module type.',
          },
          module_id: { type: 'integer', description: 'Linked module ID used with module.' },
        },
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: ({ args, client, helpers }) => runPaginatedSearch({
        args,
        client,
        helpers,
        pathTemplate: '/api/v1/tasks',
        queryBuilder: (toolArgs) => ({
          id: toolArgs.id,
          title: toolArgs.title,
          active: toolArgs.active,
          completed: toolArgs.completed,
          deadline: toolArgs.deadline,
          task_type: toolArgs.task_type,
          deadline_type: toolArgs.deadline_type,
          list_date: toolArgs.list_date,
          users: toolArgs.users,
          module: toolArgs.module,
          module_id: toolArgs.module_id,
        }),
        mapper: mapTaskSummary,
      }),
    },
    {
      name: 'task_get',
      description: 'Return one LegalServer task or deadline by task UUID.',
      inputSchema: {
        type: 'object',
        properties: {
          task_uuid: uuidProperty('LegalServer task UUID.'),
        },
        required: ['task_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {},
      handler: async ({ args, client, helpers }) => {
        const taskUuid = helpers.normalizeIdentifier(args.task_uuid, 'task_uuid');
        const response = await client.getJson('/api/v1/tasks/{task_uuid}', {
          pathParams: { task_uuid: taskUuid },
        });

        return helpers.successEnvelope({
          data: mapTaskDetail(response.data || {}, helpers),
          page: 1,
          pageSize: 1,
          totalRecords: 1,
          totalPages: 1,
          truncated: false,
          next: null,
        });
      },
    },
    {
      name: 'task_list_on_date',
      description: 'List tasks on one LegalServer list date, defaulting to incomplete tasks only.',
      inputSchema: {
        type: 'object',
        properties: {
          date: isoDateProperty('Task list date in YYYY-MM-DD format.'),
          ...pageProperties(),
          completed: {
            type: 'boolean',
            default: false,
            description: 'Set true to include completed tasks for that date.',
          },
          deadline: {
            type: 'boolean',
            description: 'Optional task/deadline filter for that date.',
          },
        },
        required: ['date'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: ({ args, client, helpers }) => {
        helpers.validateIsoDate(args.date, 'date');

        return runPaginatedSearch({
          args: {
            ...args,
            list_date: args.date,
            completed: args.completed === undefined ? false : args.completed,
          },
          client,
          helpers,
          pathTemplate: '/api/v1/tasks',
          queryBuilder: (toolArgs) => ({
            list_date: toolArgs.list_date,
            completed: toolArgs.completed,
            deadline: toolArgs.deadline,
          }),
          mapper: mapTaskSummary,
        });
      },
    },
  ];
}

module.exports = {
  createTaskTools,
};
