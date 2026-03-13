const {
  DEFAULT_PAGE_SIZE,
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
  ];
}

module.exports = {
  createEventTools,
};
