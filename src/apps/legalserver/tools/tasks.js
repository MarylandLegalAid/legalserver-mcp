const {
  CURRENT_USER_RANGE_MAX_DAYS,
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
const {
  currentUserMatchesUserRef,
  readHeaderValue,
  resolveCurrentUser,
} = require('./shared/currentUser');

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

function mapReportBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 't' || normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'f' || normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return value ?? null;
}

function normalizeReportDate(value, helpers) {
  const normalized = helpers.normalizeDateValue(value);
  const match = String(normalized ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
  if (!match) {
    return normalized;
  }

  const [, month, day, year, suffix] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${suffix}`;
}

function mapCurrentUserTaskReportRow(row, helpers) {
  const completed = mapReportBoolean(row.todo_completed ?? row.completed);
  const assignedUserName = row.todo_users_name
    ?? row.todo_users_full_name
    ?? row.user_name
    ?? row.full_name
    ?? row.email
    ?? null;
  const moduleType = row.module_type ?? row.todo_module_type ?? (row.matter_uuid ? 'matter' : null);
  const module = moduleType || row.matter_uuid || row.case_uuid
    ? {
        module_type: moduleType,
        id: row.module_id ?? row.todo_module_id ?? row.matter_id ?? row.case_id ?? null,
        uuid: row.module_uuid ?? row.todo_module_uuid ?? row.matter_uuid ?? row.case_uuid ?? null,
        label: row.case_number
          ?? row.matter_identification_number
          ?? row.module_name
          ?? row.todo_module_name
          ?? row.matter_name
          ?? row.case_title
          ?? null,
      }
    : null;

  return {
    task_uuid: row.todo_unique_id ?? row.unique_id ?? row.task_uuid ?? row.todo_uuid ?? null,
    id: row.todo_id ?? row.id ?? row.task_id ?? null,
    title: row.todo_title ?? row.title ?? row.task_title ?? null,
    active: mapReportBoolean(row.todo_active ?? row.active) ?? (completed === null ? null : !completed),
    completed,
    deadline: mapReportBoolean(row.todo_deadline ?? row.deadline ?? row.is_deadline),
    list_date: normalizeReportDate(
      row.todo_list_date ?? row.list_date ?? row.task_list_date,
      helpers,
    ),
    due_date: normalizeReportDate(row.todo_due_date ?? row.due_date ?? row.date_due, helpers),
    completed_date: normalizeReportDate(
      row.todo_completed_date ?? row.completed_date ?? row.date_completed,
      helpers,
    ),
    task_type: row.todo_task_type
      ?? row.task_type
      ?? row.todo_builtin_lookup_task_type_type_expn
      ?? null,
    deadline_type: row.todo_deadline_type ?? row.deadline_type ?? null,
    users: assignedUserName ? [{ user_uuid: null, id: null, name: assignedUserName }] : [],
    module,
    office: helpers.normalizeOffice(row.todo_office ?? row.office),
    program: row.todo_program ?? row.program ?? null,
    created_by: null,
    completed_by: null,
  };
}

function readCurrentUserEmail({ config, helpers, requestInfo }) {
  const headerName = config?.userEmailHeader || 'x-legalserver-user-email';
  const email = readHeaderValue(requestInfo?.headers, headerName);

  if (!email) {
    throw new helpers.ToolError({
      errorCode: 'missing_user_context',
      message: `This tool requires the ${headerName} request header.`,
      status: 400,
    });
  }

  return email;
}

function extractIsoDatePart(value) {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function taskSummaryKey(item) {
  return item.task_uuid || String(item.id || `${item.title || 'task'}:${item.due_date || item.list_date || ''}`);
}

async function runCurrentUserTaskReportList({
  args,
  client,
  config,
  helpers,
  requestInfo,
  startDate,
  endDate,
}) {
  const email = readCurrentUserEmail({ config, helpers, requestInfo });
  const includeCompleted = args.completed === true;
  const reportUrl = new URL(config.currentUserTasksReportUrl);
  reportUrl.searchParams.delete('filter[todo_completed][boolvalue]');
  reportUrl.searchParams.delete('filter[completed][boolvalue]');
  const response = await client.getReportJson(reportUrl.toString(), {
    query: {
      'filter[todo_users_email]': email,
    },
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  const deduped = new Map();

  for (const row of rows) {
    const mapped = mapCurrentUserTaskReportRow(row, helpers);
    const dueDate = extractIsoDatePart(mapped.due_date);
    if (!dueDate || dueDate < startDate || dueDate > endDate) {
      continue;
    }
    if (!includeCompleted && mapped.completed === true) {
      continue;
    }
    if (args.deadline !== undefined && mapped.deadline !== args.deadline) {
      continue;
    }

    deduped.set(taskSummaryKey(mapped), mapped);
  }

  return buildCurrentUserTaskEnvelope({
    helpers,
    args,
    matches: [...deduped.values()],
    truncated: false,
    warnings: [],
  });
}

function taskBelongsToUser(record, currentUser, helpers) {
  return helpers.normalizeArrayValue(record.users).some((assignedUser) => (
    currentUserMatchesUserRef(currentUser, assignedUser)
  ));
}

function compareTaskSummaries(left, right) {
  const leftListDate = left.list_date || '';
  const rightListDate = right.list_date || '';
  if (leftListDate !== rightListDate) {
    return leftListDate.localeCompare(rightListDate);
  }

  const leftDueDate = left.due_date || '9999-12-31';
  const rightDueDate = right.due_date || '9999-12-31';
  if (leftDueDate !== rightDueDate) {
    return leftDueDate.localeCompare(rightDueDate);
  }

  return String(left.title || '').localeCompare(String(right.title || ''));
}

async function scanCurrentUserTasksOnDate({
  date,
  completed,
  deadline,
  client,
  helpers,
  currentUser,
}) {
  const matches = [];
  let scannedAllPages = false;
  let totalSourcePages = 0;

  for (let scanPage = 1; scanPage <= TASK_CURRENT_USER_SCAN_MAX_PAGES; scanPage += 1) {
    const response = await client.getJson('/api/v1/tasks', {
      query: {
        page_number: scanPage,
        page_size: MAX_PAGE_SIZE,
        list_date: date,
        completed,
        deadline,
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

  return {
    matches,
    scannedAllPages,
    totalSourcePages,
  };
}

function buildCurrentUserTaskEnvelope({ helpers, args, matches, truncated, warnings }) {
  const page = helpers.validatePage(args.page);
  const pageSize = helpers.validatePageSize(args.page_size);
  const sortedMatches = [...matches].sort(compareTaskSummaries);
  const paged = helpers.paginateArray(sortedMatches, page, pageSize);

  return helpers.successEnvelope({
    data: paged.items,
    page: paged.page,
    pageSize: paged.pageSize,
    totalRecords: paged.totalRecords,
    totalPages: paged.totalPages,
    truncated,
    warnings,
  });
}

async function runCurrentUserTaskListOnDate({ args, client, config, helpers, requestInfo }) {
  const date = helpers.validateIsoDate(args.date, 'date');
  if (config?.currentUserTasksReportUrl) {
    return runCurrentUserTaskReportList({
      args,
      client,
      config,
      helpers,
      requestInfo,
      startDate: date,
      endDate: date,
    });
  }

  const currentUser = await resolveCurrentUser({
    client,
    config,
    helpers,
    requestInfo,
  });
  const completed = args.completed === undefined ? false : args.completed;
  const scan = await scanCurrentUserTasksOnDate({
    date,
    completed,
    deadline: args.deadline,
    client,
    helpers,
    currentUser,
  });
  const warnings = [];

  if (!scan.scannedAllPages) {
    warnings.push(`The scan stopped after ${TASK_CURRENT_USER_SCAN_MAX_PAGES} upstream task pages, so counts and next-page hints reflect the scanned window only.`);
  }

  return buildCurrentUserTaskEnvelope({
    helpers,
    args,
    matches: scan.matches,
    truncated: !scan.scannedAllPages,
    warnings,
  });
}

async function runCurrentUserTaskListBetweenDates({ args, client, config, helpers, requestInfo }) {
  if (config?.currentUserTasksReportUrl) {
    const startDate = helpers.validateIsoDate(args.start_date, 'start_date');
    const endDate = helpers.validateIsoDate(args.end_date, 'end_date');
    if (helpers.compareIsoDates(startDate, endDate, 'start_date', 'end_date') > 0) {
      throw new Error('end_date must be on or after start_date');
    }

    return runCurrentUserTaskReportList({
      args,
      client,
      config,
      helpers,
      requestInfo,
      startDate,
      endDate,
    });
  }

  const dateRange = helpers.listInclusiveIsoDates(
    args.start_date,
    args.end_date,
    CURRENT_USER_RANGE_MAX_DAYS,
  );
  const currentUser = await resolveCurrentUser({
    client,
    config,
    helpers,
    requestInfo,
  });
  const completed = args.completed === undefined ? false : args.completed;
  const warnings = [];
  const truncatedDates = [];
  const matches = [];

  for (const date of dateRange.dates) {
    const scan = await scanCurrentUserTasksOnDate({
      date,
      completed,
      deadline: args.deadline,
      client,
      helpers,
      currentUser,
    });

    matches.push(...scan.matches);
    if (!scan.scannedAllPages) {
      truncatedDates.push(date);
    }
  }

  if (truncatedDates.length > 0) {
    warnings.push(`Task scans stopped after ${TASK_CURRENT_USER_SCAN_MAX_PAGES} upstream pages for ${truncatedDates.join(', ')}, so counts and next-page hints reflect only the scanned window for those date(s).`);
  }

  return buildCurrentUserTaskEnvelope({
    helpers,
    args,
    matches,
    truncated: truncatedDates.length > 0,
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
      description: 'List tasks assigned to the current request user on one date. The report-backed path filters by Due Date locally; the legacy API fallback uses LegalServer list date.',
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
    {
      name: 'task_list_current_user_between_dates',
      description: 'List tasks assigned to the current request user across an inclusive date range. The report-backed path filters by Due Date locally; the legacy API fallback uses LegalServer list date.',
      inputSchema: {
        type: 'object',
        properties: {
          start_date: isoDateProperty(`Inclusive start date in YYYY-MM-DD format. The configured report-backed path accepts any range covered by the report; the legacy API fallback is capped at ${CURRENT_USER_RANGE_MAX_DAYS} days.`),
          end_date: isoDateProperty('Inclusive end date in YYYY-MM-DD format.'),
          ...pageProperties(),
          completed: {
            type: 'boolean',
            default: false,
            description: 'Set true to include completed tasks in the range.',
          },
          deadline: {
            type: 'boolean',
            description: 'Optional task/deadline filter for the range.',
          },
        },
        required: ['start_date', 'end_date'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: ({ args, client, config, helpers, requestInfo }) => runCurrentUserTaskListBetweenDates({
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
