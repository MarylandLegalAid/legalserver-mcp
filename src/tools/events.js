const {
  DEFAULT_PAGE_SIZE,
  EVENT_CURRENT_USER_API_FALLBACK_RANGE_MAX_DAYS,
  EVENT_DATE_FALLBACK_MAX_PAGES,
  MAX_PAGE_SIZE,
} = require('../constants');
const { isoDateProperty, pageProperties, uuidProperty } = require('./shared/schemas');
const {
  normalizeMatterRef,
  normalizeOrganizationRef,
  normalizeOutreachRef,
  normalizeUserRef,
  runPaginatedSearch,
} = require('./shared/globalDiscovery');
const { currentUserMatchesUserRef, readHeaderValue, resolveCurrentUser } = require('./shared/currentUser');

function mapEventSummary(record, helpers) {
  const attendees = helpers.normalizeArrayValue(record.attendees).map(normalizeUserRef).filter(Boolean);
  const matters = helpers.normalizeArrayValue(record.matters).map(normalizeMatterRef).filter(Boolean);

  return {
    event_uuid: record.event_uuid ?? null,
    id: record.id ?? null,
    external_id: record.external_id ?? null,
    title: record.title ?? null,
    start_datetime: helpers.normalizeDateValue(record.start_datetime),
    end_datetime: helpers.normalizeDateValue(record.end_datetime),
    all_day_event: record.all_day_event ?? null,
    private_event: record.private_event ?? null,
    front_desk: record.front_desk ?? null,
    location: record.location ?? null,
    courtroom: record.courtroom ?? null,
    court: normalizeOrganizationRef(record.court),
    judge: record.judge ?? null,
    event_type: record.event_type ?? null,
    office: helpers.normalizeOffice(record.office),
    program: record.program ?? null,
    attendee_count: attendees.length,
    matter_count: matters.length,
  };
}

function mapEventDetail(record, helpers) {
  return {
    ...mapEventSummary(record, helpers),
    attendees: helpers.normalizeArrayValue(record.attendees).map(normalizeUserRef).filter(Boolean),
    matters: helpers.normalizeArrayValue(record.matters).map(normalizeMatterRef).filter(Boolean),
    outreaches: helpers.normalizeArrayValue(record.outreaches).map(normalizeOutreachRef).filter(Boolean),
  };
}

function mapCurrentUserEventSummary(record, helpers) {
  return {
    ...mapEventSummary(record, helpers),
    matters: helpers.normalizeArrayValue(record.matters).map(normalizeMatterRef).filter(Boolean),
    outreaches: helpers.normalizeArrayValue(record.outreaches).map(normalizeOutreachRef).filter(Boolean),
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

function mapCurrentUserEventReportRow(row, helpers) {
  return {
    event_uuid: row.unique_id ?? row.event_uuid ?? null,
    id: row.id ?? null,
    external_id: row.external_id ?? null,
    title: row.title ?? null,
    start_datetime: helpers.normalizeDateValue(row.time_start ?? row.start_datetime),
    end_datetime: helpers.normalizeDateValue(row.time_end ?? row.end_datetime),
    all_day_event: mapReportBoolean(row.all_day ?? row.all_day_event),
    private_event: mapReportBoolean(row.private_event),
    front_desk: mapReportBoolean(row.front_desk),
    location: row.location ?? null,
    courtroom: row.courtroom ?? null,
    court: normalizeOrganizationRef(row.court),
    judge: row.judge ?? null,
    event_type: row.event_builtin_lookup_event_type_event_type_expn ?? row.event_type ?? null,
    office: helpers.normalizeOffice(row.office),
    program: row.program ?? null,
    attendee_count: row.email ? 1 : 0,
    matter_count: 0,
    matters: [],
    outreaches: [],
  };
}

function buildEventQuery(toolArgs) {
  return {
    title: toolArgs.title,
    location: toolArgs.location,
    court: toolArgs.court,
    date: toolArgs.date,
    matters: toolArgs.matter,
    external_id: toolArgs.external_id,
  };
}

function buildEventQueryWithoutDate(toolArgs) {
  return {
    title: toolArgs.title,
    location: toolArgs.location,
    court: toolArgs.court,
    matters: toolArgs.matter,
    external_id: toolArgs.external_id,
  };
}

function extractIsoDatePart(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    return null;
  }

  return normalized.slice(0, 10);
}

function eventMatchesDate(record, targetDate) {
  const startDate = extractIsoDatePart(record.start_datetime);
  const endDate = extractIsoDatePart(record.end_datetime);

  if (startDate && endDate) {
    return targetDate >= startDate && targetDate <= endDate;
  }

  return startDate === targetDate || endDate === targetDate;
}

function eventOverlapsDateRange(record, startDate, endDate) {
  const eventStart = extractIsoDatePart(record.start_datetime);
  const eventEnd = extractIsoDatePart(record.end_datetime) || eventStart;

  if (!eventStart && !eventEnd) {
    return false;
  }

  const normalizedStart = eventStart || eventEnd;
  const normalizedEnd = eventEnd || eventStart;

  return normalizedStart <= endDate && normalizedEnd >= startDate;
}

function eventBelongsToCurrentUser(record, helpers, currentUser) {
  return helpers.normalizeArrayValue(record.attendees).some((attendee) => (
    currentUserMatchesUserRef(currentUser, attendee)
  ));
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

function compareCurrentUserEventSummaries(left, right) {
  const leftStart = left.start_datetime || '';
  const rightStart = right.start_datetime || '';
  if (leftStart !== rightStart) {
    return leftStart.localeCompare(rightStart);
  }

  return String(left.title || '').localeCompare(String(right.title || ''));
}

function eventSummaryKey(item) {
  return item.event_uuid || String(item.id || `${item.title || 'event'}:${item.start_datetime || ''}`);
}

function isInvalidDateSearchKeyError(error) {
  const invalidKeys = Array.isArray(error?.details?.invalid_search_keys)
    ? error.details.invalid_search_keys
    : [];

  return error?.status === 400
    && invalidKeys.includes('date');
}

async function runEventDateFallbackSearch({
  args,
  client,
  helpers,
  mapper,
  queryBuilder,
}) {
  const targetDate = args.date;
  const page = helpers.validatePage(args.page);
  const pageSize = helpers.validatePageSize(args.page_size);
  const warnings = [
    `LegalServer rejected the documented event date search key, so results were filtered locally from the newest ${EVENT_DATE_FALLBACK_MAX_PAGES * MAX_PAGE_SIZE} events that matched the remaining server-side filters.`,
  ];
  const matches = [];
  let sourcePages = 0;
  let scannedAllPages = false;

  for (let scanPage = 1; scanPage <= EVENT_DATE_FALLBACK_MAX_PAGES; scanPage += 1) {
    const response = await client.getJson('/api/v1/events', {
      query: {
        page_number: scanPage,
        page_size: MAX_PAGE_SIZE,
        sort: 'desc',
        ...(queryBuilder ? queryBuilder(args) : {}),
      },
    });

    const records = Array.isArray(response.data) ? response.data : [];
    sourcePages = response.totalPages || 0;

    for (const record of records) {
      if (eventMatchesDate(record, targetDate)) {
        matches.push(mapper(record, helpers));
      }
    }

    if (sourcePages === 0 || scanPage >= sourcePages) {
      scannedAllPages = true;
      break;
    }
  }

  const paged = helpers.paginateArray(matches, page, pageSize);
  const truncated = !scannedAllPages;

  if (truncated) {
    warnings.push(`The scan stopped after ${EVENT_DATE_FALLBACK_MAX_PAGES} upstream pages, so counts and next-page hints reflect the scanned window only.`);
  }

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

async function scanCurrentUserEventsOnDate({
  date,
  client,
  helpers,
  currentUser,
}) {
  const matches = [];
  let sourcePages = 0;
  let scannedAllPages = false;

  for (let scanPage = 1; scanPage <= EVENT_DATE_FALLBACK_MAX_PAGES; scanPage += 1) {
    const response = await client.getJson('/api/v1/events', {
      query: {
        page_number: scanPage,
        page_size: MAX_PAGE_SIZE,
        date,
      },
    });

    const records = Array.isArray(response.data) ? response.data : [];
    sourcePages = response.totalPages || 0;

    for (const record of records) {
      if (eventMatchesDate(record, date) && eventBelongsToCurrentUser(record, helpers, currentUser)) {
        matches.push(mapCurrentUserEventSummary(record, helpers));
      }
    }

    if (sourcePages === 0 || scanPage >= sourcePages) {
      scannedAllPages = true;
      break;
    }
  }

  return {
    matches,
    scannedAllPages,
  };
}

async function scanCurrentUserEventsWithLocalDateFilter({
  startDate,
  endDate,
  client,
  helpers,
  currentUser,
}) {
  const matches = [];
  let sourcePages = 0;
  let scannedAllPages = false;

  for (let scanPage = 1; scanPage <= EVENT_DATE_FALLBACK_MAX_PAGES; scanPage += 1) {
    const response = await client.getJson('/api/v1/events', {
      query: {
        page_number: scanPage,
        page_size: MAX_PAGE_SIZE,
        sort: 'desc',
      },
    });

    const records = Array.isArray(response.data) ? response.data : [];
    sourcePages = response.totalPages || 0;

    for (const record of records) {
      if (!eventOverlapsDateRange(record, startDate, endDate)) {
        continue;
      }

      if (!eventBelongsToCurrentUser(record, helpers, currentUser)) {
        continue;
      }

      matches.push(mapCurrentUserEventSummary(record, helpers));
    }

    if (sourcePages === 0 || scanPage >= sourcePages) {
      scannedAllPages = true;
      break;
    }
  }

  return {
    matches,
    scannedAllPages,
  };
}

function buildCurrentUserEventEnvelope({ helpers, args, matches, warnings, truncated }) {
  const deduped = [];
  const seen = new Set();

  for (const item of matches) {
    const key = eventSummaryKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort(compareCurrentUserEventSummaries);

  const page = helpers.validatePage(args.page);
  const pageSize = helpers.validatePageSize(args.page_size);
  const paged = helpers.paginateArray(deduped, page, pageSize);

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

async function runCurrentUserEventListOnDate({ args, client, config, helpers, requestInfo }) {
  const date = helpers.validateIsoDate(args.date, 'date');

  if (config?.currentUserEventsReportUrl) {
    return runCurrentUserEventReportList({
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

  try {
    const scan = await scanCurrentUserEventsOnDate({
      date,
      client,
      helpers,
      currentUser,
    });
    const warnings = [];

    if (!scan.scannedAllPages) {
      warnings.push(`The scan stopped after ${EVENT_DATE_FALLBACK_MAX_PAGES} upstream event pages, so counts and next-page hints reflect the scanned window only.`);
    }

    return buildCurrentUserEventEnvelope({
      helpers,
      args,
      matches: scan.matches,
      warnings,
      truncated: !scan.scannedAllPages,
    });
  } catch (error) {
    if (!isInvalidDateSearchKeyError(error)) {
      throw error;
    }

    const fallback = await scanCurrentUserEventsWithLocalDateFilter({
      startDate: date,
      endDate: date,
      client,
      helpers,
      currentUser,
    });
    const warnings = [
      `LegalServer rejected the documented event date search key, so results were filtered locally from the newest ${EVENT_DATE_FALLBACK_MAX_PAGES * MAX_PAGE_SIZE} events.`,
    ];

    if (!fallback.scannedAllPages) {
      warnings.push(`The scan stopped after ${EVENT_DATE_FALLBACK_MAX_PAGES} upstream pages, so counts and next-page hints reflect the scanned window only.`);
    }

    return buildCurrentUserEventEnvelope({
      helpers,
      args,
      matches: fallback.matches,
      warnings,
      truncated: !fallback.scannedAllPages,
    });
  }
}

async function runCurrentUserEventListBetweenDates({ args, client, config, helpers, requestInfo }) {
  if (config?.currentUserEventsReportUrl) {
    const startDate = helpers.validateIsoDate(args.start_date, 'start_date');
    const endDate = helpers.validateIsoDate(args.end_date, 'end_date');
    if (helpers.compareIsoDates(startDate, endDate, 'start_date', 'end_date') > 0) {
      throw new Error('end_date must be on or after start_date');
    }

    return runCurrentUserEventReportList({
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
    EVENT_CURRENT_USER_API_FALLBACK_RANGE_MAX_DAYS,
  );

  const currentUser = await resolveCurrentUser({
    client,
    config,
    helpers,
    requestInfo,
  });
  const warnings = [];
  const truncatedDates = [];
  const matches = [];

  try {
    for (const date of dateRange.dates) {
      const scan = await scanCurrentUserEventsOnDate({
        date,
        client,
        helpers,
        currentUser,
      });

      matches.push(...scan.matches);
      if (!scan.scannedAllPages) {
        truncatedDates.push(date);
      }
    }
  } catch (error) {
    if (!isInvalidDateSearchKeyError(error)) {
      throw error;
    }

    const fallback = await scanCurrentUserEventsWithLocalDateFilter({
      startDate: dateRange.start_date,
      endDate: dateRange.end_date,
      client,
      helpers,
      currentUser,
    });
    warnings.push(`LegalServer rejected the documented event date search key, so results were filtered locally from the newest ${EVENT_DATE_FALLBACK_MAX_PAGES * MAX_PAGE_SIZE} events in the requested range.`);

    if (!fallback.scannedAllPages) {
      warnings.push(`The scan stopped after ${EVENT_DATE_FALLBACK_MAX_PAGES} upstream pages, so counts and next-page hints reflect the scanned window only.`);
    }

    return buildCurrentUserEventEnvelope({
      helpers,
      args,
      matches: fallback.matches,
      warnings,
      truncated: !fallback.scannedAllPages,
    });
  }

  if (truncatedDates.length > 0) {
    warnings.push(`Event scans stopped after ${EVENT_DATE_FALLBACK_MAX_PAGES} upstream pages for ${truncatedDates.join(', ')}, so counts and next-page hints reflect only the scanned window for those date(s).`);
  }

  return buildCurrentUserEventEnvelope({
    helpers,
    args,
    matches,
    warnings,
    truncated: truncatedDates.length > 0,
  });
}

async function runCurrentUserEventReportList({
  args,
  client,
  config,
  helpers,
  requestInfo,
  startDate,
  endDate,
}) {
  const email = readCurrentUserEmail({
    config,
    helpers,
    requestInfo,
  });

  const response = await client.getReportJson(config.currentUserEventsReportUrl, {
    query: {
      'filter[person_email]': email,
    },
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  const matches = rows
    .filter((row) => eventOverlapsDateRange({
      start_datetime: row.time_start ?? row.start_datetime,
      end_datetime: row.time_end ?? row.end_datetime,
    }, startDate, endDate))
    .map((row) => mapCurrentUserEventReportRow(row, helpers));

  return buildCurrentUserEventEnvelope({
    helpers,
    args,
    matches,
    warnings: [],
    truncated: false,
  });
}

async function runEventSearchWithOptionalDateFallback({
  args,
  client,
  helpers,
  mapper,
  queryBuilder,
  fallbackQueryBuilder,
}) {
  if (args.date) {
    helpers.validateIsoDate(args.date, 'date');
  }

  try {
    return await runPaginatedSearch({
      args,
      client,
      helpers,
      pathTemplate: '/api/v1/events',
      queryBuilder,
      mapper,
    });
  } catch (error) {
    if (!args.date || !isInvalidDateSearchKeyError(error)) {
      throw error;
    }

    return runEventDateFallbackSearch({
      args,
      client,
      helpers,
      mapper,
      queryBuilder: fallbackQueryBuilder,
    });
  }
}

function createEventTools() {
  return [
    {
      name: 'event_search',
      description: 'Search LegalServer events by documented global filters.',
      inputSchema: {
        type: 'object',
        properties: {
          ...pageProperties(),
          title: { type: 'string', description: 'Event title filter.' },
          location: { type: 'string', description: 'Event location filter.' },
          court: { type: 'string', description: 'Court filter.' },
          date: isoDateProperty('Event date in YYYY-MM-DD format.'),
          matter: { type: 'string', description: 'Matter filter mapped to the matters query parameter.' },
          external_id: { type: 'string', description: 'External event ID filter.' },
        },
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: ({ args, client, helpers }) => runEventSearchWithOptionalDateFallback({
        args,
        client,
        helpers,
        mapper: mapEventSummary,
        queryBuilder: buildEventQuery,
        fallbackQueryBuilder: buildEventQueryWithoutDate,
      }),
    },
    {
      name: 'event_get',
      description: 'Return one LegalServer event by event UUID.',
      inputSchema: {
        type: 'object',
        properties: {
          event_uuid: uuidProperty('LegalServer event UUID.'),
        },
        required: ['event_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {},
      handler: async ({ args, client, helpers }) => {
        const eventUuid = helpers.normalizeIdentifier(args.event_uuid, 'event_uuid');
        const response = await client.getJson('/api/v1/events/{event_uuid}', {
          pathParams: { event_uuid: eventUuid },
        });

        return helpers.successEnvelope({
          data: mapEventDetail(response.data || {}, helpers),
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
      name: 'event_list_by_date',
      description: 'List LegalServer events for one specific date.',
      inputSchema: {
        type: 'object',
        properties: {
          date: isoDateProperty('Event date in YYYY-MM-DD format.'),
          ...pageProperties(),
        },
        required: ['date'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: ({ args, client, helpers }) => runEventSearchWithOptionalDateFallback({
        args,
        client,
        helpers,
        mapper: mapEventSummary,
        queryBuilder: (toolArgs) => ({ date: toolArgs.date }),
        fallbackQueryBuilder: () => ({}),
      }),
    },
    {
      name: 'event_list_current_user_on_date',
      description: 'List calendar events for the current request user on one date.',
      inputSchema: {
        type: 'object',
        properties: {
          date: isoDateProperty('Event date in YYYY-MM-DD format.'),
          ...pageProperties(),
        },
        required: ['date'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: ({ args, client, config, helpers, requestInfo }) => runCurrentUserEventListOnDate({
        args,
        client,
        config,
        helpers,
        requestInfo,
      }),
    },
    {
      name: 'event_list_current_user_between_dates',
      description: 'List calendar events for the current request user across an inclusive date range.',
      inputSchema: {
        type: 'object',
        properties: {
          start_date: isoDateProperty(`Inclusive start date in YYYY-MM-DD format. The configured report-backed path accepts any range covered by the report; the legacy API fallback is capped at ${EVENT_CURRENT_USER_API_FALLBACK_RANGE_MAX_DAYS} days.`),
          end_date: isoDateProperty('Inclusive end date in YYYY-MM-DD format.'),
          ...pageProperties(),
        },
        required: ['start_date', 'end_date'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: ({ args, client, config, helpers, requestInfo }) => runCurrentUserEventListBetweenDates({
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
  createEventTools,
};
