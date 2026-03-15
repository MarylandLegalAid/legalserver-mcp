const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  TASK_CURRENT_USER_SCAN_MAX_PAGES,
} = require('../constants');
const { isoDateProperty, pageProperties, uuidProperty } = require('./shared/schemas');
const {
  normalizeModuleDetail,
  normalizeModuleRef,
  normalizeUserRef,
  runPaginatedSearch,
} = require('./shared/globalDiscovery');
const { resolveCurrentUser } = require('./shared/currentUser');

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

function taskBelongsToUser(record, currentUser, helpers) {
  const assignedUsers = helpers.normalizeArrayValue(record.users).map(normalizeUserRef).filter(Boolean);

  return assignedUsers.some((assignedUser) => (
    (currentUser.user_uuid && assignedUser.user_uuid === currentUser.user_uuid)
    || (
      currentUser.id !== null
      && currentUser.id !== undefined
      && assignedUser.id === currentUser.id
    )
  ));
}

async function runCurrentUserTaskListOnDate({ args, client, config, helpers, requestInfo }) {
  helpers.validateIsoDate(args.date, 'date');

  const currentUser = await resolveCurrentUser({
    client,
    config,
    helpers,
    requestInfo,
  });

  const page = helpers.validatePage(args.page);
  const pageSize = helpers.validatePageSize(args.page_size);
  const completed = args.completed === undefined ? false : args.completed;
  const warnings = [];
  const matches = [];
  let scannedAllPages = false;
  let totalSourcePages = 0;

  for (let scanPage = 1; scanPage <= TASK_CURRENT_USER_SCAN_MAX_PAGES; scanPage += 1) {
    const response = await client.getJson('/api/v1/tasks', {
      query: {
        page_number: scanPage,
        page_size: MAX_PAGE_SIZE,
        list_date: args.date,
        completed,
        deadline: args.deadline,
      },
    });

    const records = Array.isArray(response.data) ? response.data : [];
    totalSourcePages = response.totalPages || 0;

    for (const record of records) {
      if (taskBelongsToUser(record, currentUser, helpers)) {
        matches.push(mapTaskSummary(record, helpers));
      }
    }

    if (totalSourcePages === 0 || scanPage >= totalSourcePages) {
      scannedAllPages = true;
      break;
    }
  }

  const paged = helpers.paginateArray(matches, page, pageSize);
  if (!scannedAllPages) {
    warnings.push(`The scan stopped after ${TASK_CURRENT_USER_SCAN_MAX_PAGES} upstream task pages, so counts and next-page hints reflect the scanned window only.`);
  }

  return helpers.successEnvelope({
    data: paged.items,
    page: paged.page,
    pageSize: paged.pageSize,
    totalRecords: paged.totalRecords,
    totalPages: paged.totalPages,
    truncated: !scannedAllPages,
    warnings,
  });
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
    {
      name: 'task_list_current_user_on_date',
      description: 'List tasks assigned to the current request user on one LegalServer list date.',
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
      handler: ({ args, client, config, helpers, requestInfo }) => runCurrentUserTaskListOnDate({
        args,
        client,
        config,
        helpers,
        requestInfo,
      }),
    },
  ];
}

module.exports = {
  createTaskTools,
};
