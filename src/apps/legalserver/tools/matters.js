const {
  DEFAULT_MAX_CHARS,
  DEFAULT_PAGE_SIZE,
  MATTER_CURRENT_USER_SCAN_MAX_PAGES,
  MAX_MAX_CHARS,
  MAX_PAGE_SIZE,
  PREVIEW_MAX_CHARS,
} = require('../constants');
const { caseUuidProperty, pageProperties } = require('./shared/schemas');
const { currentUserMatchesUserRef, readHeaderValue, resolveCurrentUser } = require('./shared/currentUser');
const { PromiseCache } = require('./shared/promiseCache');

const ACTIVE_CURRENT_USER_MATTER_DISPOSITIONS = ['Open', 'Pending', 'Incomplete Intake', 'Prescreen'];
const ASSIGNMENT_VISIBILITY_ERROR_MESSAGE = 'Matter search results did not include assignments. This tool requires a LegalServer API role that exposes assignment arrays in /api/v1/matters full results.';
const currentUserMatterScanCache = new PromiseCache();

function mapNote(note, helpers) {
  const plainBody = note.is_html ? helpers.htmlToText(note.body) : String(note.body ?? '');
  const preview = helpers.makePreview(plainBody, PREVIEW_MAX_CHARS);

  return {
    note_uuid: note.casenote_uuid ?? null,
    id: note.id ?? null,
    subject: note.subject ?? null,
    note_type: note.note_type ?? null,
    date_posted: helpers.normalizeDateValue(note.date_posted),
    date_time_created: helpers.normalizeDateValue(note.date_time_created),
    created_by: helpers.normalizeUser(note.created_by),
    last_update: helpers.normalizeDateValue(note.last_update),
    last_updated_by: helpers.normalizeUser(note.last_updated_by),
    is_html: Boolean(note.is_html),
    note_has_document_attached: Boolean(note.note_has_document_attached),
    active: note.active !== false,
    body_preview: preview.preview,
    body_truncated: preview.truncated,
  };
}

function mapMatter(record, helpers) {
  return {
    case_uuid: helpers.getFirstDefined(record.matter_uuid, record.case_uuid, record.uuid),
    case_id: record.case_id ?? null,
    case_number: record.case_number ?? null,
    case_title: record.case_title ?? null,
    case_profile_url: record.case_profile_url ?? null,
    client_name: helpers.getFirstDefined(record.client_full_name, record.organization_name),
    client_email: record.client_email_address ?? null,
    client_gender: record.client_gender ?? null,
    client_address_home: helpers.normalizeAddress(record.client_address_home),
    client_address_mailing: helpers.normalizeAddress(record.client_address_mailing),
    preferred_phone_number: record.preferred_phone_number ?? null,
    home_phone: record.home_phone ?? null,
    mobile_phone: record.mobile_phone ?? null,
    other_phone: record.other_phone ?? null,
    work_phone: record.work_phone ?? null,
    fax_phone: record.fax_phone ?? null,
    case_status: record.case_status ?? null,
    case_disposition: record.case_disposition ?? null,
    close_reason: record.close_reason ?? null,
    date_opened: helpers.normalizeDateValue(record.date_opened),
    date_closed: helpers.normalizeDateValue(record.date_closed),
    intake_date: helpers.normalizeDateValue(record.intake_date),
    date_rejected: helpers.normalizeDateValue(record.date_rejected),
    prescreen_date: helpers.normalizeDateValue(record.prescreen_date),
    days_open: record.days_open ?? null,
    is_prescreen: record.is_this_a_prescreen ?? null,
    intake_office: helpers.normalizeOffice(record.intake_office),
    intake_program: record.intake_program ?? null,
    intake_user: helpers.normalizeUser(record.intake_user),
    intake_type: record.intake_type ?? null,
    prescreen_user: helpers.normalizeUser(record.prescreen_user),
    prescreen_program: record.prescreen_program ?? null,
    prescreen_office: helpers.normalizeOffice(record.prescreen_office),
    prescreen_screening_status: record.prescreen_screening_status ?? null,
    legal_problem_code: record.legal_problem_code ?? null,
    legal_problem_category: record.legal_problem_category ?? null,
    special_legal_problem_code: record.special_legal_problem_code ?? null,
    case_type: record.case_type ?? null,
    county_of_residence: helpers.normalizeCounty(record.county_of_residence),
    county_of_dispute: helpers.normalizeCounty(record.county_of_dispute),
    language: record.language ?? null,
    second_language: record.second_language ?? null,
    interpreter: record.interpreter ?? null,
    number_of_adults: record.number_of_adults ?? null,
    number_of_children: record.number_of_children ?? null,
    percentage_of_poverty: record.percentage_of_poverty ?? null,
    asset_eligible: record.asset_eligible ?? null,
    lsc_eligible: record.lsc_eligible ?? null,
    income_eligible: record.income_eligible ?? null,
  };
}

function mapAssignment(record, helpers) {
  const preview = helpers.makePreview(record.notes, PREVIEW_MAX_CHARS);

  return {
    assignment_uuid: helpers.getFirstDefined(record.uuid, record.assignment_uuid),
    id: record.id ?? null,
    type: record.type ?? null,
    start_date: helpers.normalizeDateValue(record.start_date),
    end_date: helpers.normalizeDateValue(record.end_date),
    date_requested: helpers.normalizeDateValue(record.date_requested),
    confirmed: record.confirmed ?? null,
    program: record.program ?? null,
    office: helpers.normalizeOffice(record.office),
    name: record.name ?? null,
    user: helpers.normalizeUser(record.user),
    assigned_by: helpers.normalizeUser(record.assigned_by),
    notes_preview: preview.preview,
    notes_truncated: preview.truncated,
    created_at: helpers.normalizeDateValue(record.created_at),
  };
}

function mapParty(record, helpers, type) {
  const notePreview = helpers.makePreview(record.adverse_party_note, PREVIEW_MAX_CHARS);
  const alertPreview = helpers.makePreview(record.adverse_party_alert, PREVIEW_MAX_CHARS);

  return {
    [`${type}_uuid`]: helpers.getFirstDefined(record.uuid, record[`${type}_uuid`]),
    id: record.id ?? null,
    display_name: helpers.normalizeDisplayName(record),
    organization_name: record.organization_name ?? null,
    relationship_type: record.relationship_type ?? null,
    email: record.email ?? null,
    phone_home: record.phone_home ?? null,
    phone_business: record.phone_business ?? null,
    phone_mobile: record.phone_mobile ?? null,
    phone_fax: record.phone_fax ?? null,
    address_summary: [
      record.street_address,
      record.apt_num,
      record.street_address_2,
      record.addr2,
      record.city,
      record.state,
      record.zip_code,
      helpers.normalizeCounty(record.county),
    ].filter(Boolean).join(', ') || null,
    active: record.active ?? null,
    family_member: record.family_member ?? null,
    household_member: record.household_member ?? null,
    non_adverse_party: record.non_adverse_party ?? null,
    potential_conflict: record.potential_conflict ?? null,
    alert_preview: alertPreview.preview,
    alert_truncated: alertPreview.truncated,
    note_preview: notePreview.preview,
    note_truncated: notePreview.truncated,
  };
}

function mapContact(record, helpers) {
  const contactTypes = helpers.normalizeArrayValue(record.contact_types)
    .map((item) => (typeof item === 'string' ? item : item?.name ?? item))
    .filter(Boolean);

  return {
    matter_contact_uuid: helpers.getFirstDefined(record.matter_contact_uuid, record.case_contact_uuid),
    contact_uuid: record.contact_uuid ?? null,
    full_name: helpers.normalizeDisplayName(record),
    case_contact_type: record.case_contact_type ?? null,
    contact_types: contactTypes,
    phone_business: record.phone_business ?? null,
    email: record.email ?? null,
  };
}

function mapRelatedMatter(record) {
  const related = record.related_matter_id || record.related_matter || {};

  return {
    relationship_uuid: record.id ?? null,
    matter_relationship_type: record.matter_relationship_type ?? null,
    related_matter: {
      case_uuid: related.uuid ?? related.case_uuid ?? null,
      case_number: related.case_number ?? related.matter_identification_number ?? null,
      matter_name: related.name ?? related.matter_name ?? null,
    },
  };
}

function mapService(record, helpers) {
  const preview = helpers.makePreview(record.note, PREVIEW_MAX_CHARS);

  return {
    service_uuid: record.service_uuid ?? null,
    id: record.id ?? null,
    title: record.title ?? null,
    type: record.type ?? null,
    start_date: helpers.normalizeDateValue(record.start_date),
    end_date: helpers.normalizeDateValue(record.end_date),
    closed_by: helpers.normalizeUser(record.closed_by),
    closed: record.closed ?? null,
    active: record.active ?? null,
    decision: record.decision ?? null,
    funding_code: record.funding_code ?? null,
    note_preview: preview.preview,
    note_truncated: preview.truncated,
  };
}

function mapIncome(record, helpers) {
  const preview = helpers.makePreview(record.notes, PREVIEW_MAX_CHARS);

  return {
    income_uuid: record.income_uuid ?? null,
    id: record.id ?? null,
    type: record.type ?? null,
    amount: record.amount ?? null,
    period: record.period ?? null,
    exclude: record.exclude ?? null,
    notes_preview: preview.preview,
    notes_truncated: preview.truncated,
  };
}

function mapLitigation(record, helpers) {
  const preview = helpers.makePreview(record.notes, PREVIEW_MAX_CHARS);

  return {
    litigation_uuid: record.litigation_uuid ?? null,
    id: record.id ?? null,
    court_number: record.court_number ?? null,
    court_text: record.court_text ?? null,
    caption: record.caption ?? null,
    docket: record.docket ?? null,
    cause_of_action: record.cause_of_action ?? null,
    judge: record.judge ?? null,
    outcome: record.outcome ?? null,
    outcome_date: helpers.normalizeDateValue(record.outcome_date),
    default_date: helpers.normalizeDateValue(record.default_date),
    date_served: helpers.normalizeDateValue(record.date_served),
    date_proceeding_initiated: helpers.normalizeDateValue(record.date_proceeding_initiated),
    date_proceeding_concluded: helpers.normalizeDateValue(record.date_proceeding_concluded),
    application_filing_date: helpers.normalizeDateValue(record.application_filing_date),
    lsc_disclosure_required: record.lsc_disclosure_required ?? null,
    notes_preview: preview.preview,
    notes_truncated: preview.truncated,
  };
}

function mapCurrentUserMatterSummary(record, matchingAssignments, helpers) {
  return {
    case_uuid: helpers.getFirstDefined(record.matter_uuid, record.case_uuid, record.uuid),
    case_id: record.case_id ?? null,
    case_number: record.case_number ?? null,
    case_title: record.case_title ?? null,
    client_name: helpers.getFirstDefined(record.client_full_name, record.organization_name),
    case_status: record.case_status ?? null,
    case_disposition: record.case_disposition ?? null,
    legal_problem_code: record.legal_problem_code ?? null,
    case_profile_url: record.case_profile_url ?? null,
    date_opened: helpers.normalizeDateValue(record.date_opened),
    date_closed: helpers.normalizeDateValue(record.date_closed),
    matching_assignments: matchingAssignments.map((assignment) => mapAssignment(assignment, helpers)),
  };
}

function isIsoDateLike(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function isCurrentAssignment(record, helpers) {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = helpers.normalizeDateValue(record.start_date);
  const endDate = helpers.normalizeDateValue(record.end_date);

  if (isIsoDateLike(startDate) && helpers.compareIsoDates(startDate, today, 'start_date', 'today') > 0) {
    return false;
  }

  if (isIsoDateLike(endDate) && helpers.compareIsoDates(endDate, today, 'end_date', 'today') < 0) {
    return false;
  }

  return true;
}

function filterMatchingAssignments(record, helpers, currentUser, currentOnly) {
  const assignments = Array.isArray(record.assignments) ? record.assignments : [];

  return assignments.filter((assignment) => {
    if (!currentUserMatchesUserRef(currentUser, assignment.user)) {
      return false;
    }

    if (!currentOnly) {
      return true;
    }

    return isCurrentAssignment(assignment, helpers);
  });
}

function createAssignmentVisibilityUnavailableError(helpers) {
  return new helpers.ToolError({
    errorCode: 'assignment_visibility_unavailable',
    message: ASSIGNMENT_VISIBILITY_ERROR_MESSAGE,
    status: 412,
  });
}

function buildMatterCurrentUserFilters(args, overrides = {}) {
  return {
    assignment_type: args.assignment_type ?? null,
    case_disposition: overrides.case_disposition ?? args.case_disposition ?? null,
    current_only: args.current_only === undefined ? true : args.current_only,
    legal_problem_code: args.legal_problem_code ?? null,
  };
}

function buildMatterSearchQuery(filters, pageNumber) {
  return {
    results: 'full',
    page_number: pageNumber,
    page_size: MAX_PAGE_SIZE,
    case_disposition: filters.case_disposition,
    legal_problem_code: filters.legal_problem_code,
    'assignments:type': filters.assignment_type,
  };
}

function processMatterScanResponse({ response, helpers, currentOnly, currentUser }) {
  const records = Array.isArray(response.data) ? response.data : [];
  const sawAssignmentField = records.some((record) => Object.prototype.hasOwnProperty.call(record, 'assignments'));
  if (!sawAssignmentField && records.length > 0) {
    throw createAssignmentVisibilityUnavailableError(helpers);
  }

  const matches = [];
  for (const record of records) {
    const matchingAssignments = filterMatchingAssignments(record, helpers, currentUser, currentOnly);
    if (matchingAssignments.length === 0) {
      continue;
    }

    matches.push(mapCurrentUserMatterSummary(record, matchingAssignments, helpers));
  }

  return {
    matches,
    recordCount: records.length,
    sawAssignmentField,
    totalPages: response.totalPages || 0,
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

async function scanCurrentUserMatterPages({ client, config, currentUser, filters, helpers }) {
  const currentOnly = filters.current_only;
  const firstResponse = await client.getJson('/api/v1/matters', {
    query: buildMatterSearchQuery(filters, 1),
  });
  const firstProcessed = processMatterScanResponse({
    response: firstResponse,
    helpers,
    currentOnly,
    currentUser,
  });
  const pageMatches = new Map([[1, firstProcessed.matches]]);
  let sawAnyRecords = firstProcessed.recordCount > 0;
  let sawAssignmentField = firstProcessed.sawAssignmentField;
  const totalPages = firstProcessed.totalPages;
  const finalScanPage = totalPages === 0 ? 1 : Math.min(totalPages, MATTER_CURRENT_USER_SCAN_MAX_PAGES);
  const remainingPages = [];

  for (let scanPage = 2; scanPage <= finalScanPage; scanPage += 1) {
    remainingPages.push(scanPage);
  }

  const pageResponses = await runWithConcurrency(
    remainingPages,
    config?.matterCurrentUserFetchConcurrency ?? 4,
    async (scanPage) => ({
      page: scanPage,
      processed: processMatterScanResponse({
        response: await client.getJson('/api/v1/matters', {
          query: buildMatterSearchQuery(filters, scanPage),
        }),
        helpers,
        currentOnly,
        currentUser,
      }),
    }),
  );

  for (const pageResponse of pageResponses) {
    sawAnyRecords = sawAnyRecords || pageResponse.processed.recordCount > 0;
    sawAssignmentField = sawAssignmentField || pageResponse.processed.sawAssignmentField;
    pageMatches.set(pageResponse.page, pageResponse.processed.matches);
  }

  const matches = [];
  for (let scanPage = 1; scanPage <= finalScanPage; scanPage += 1) {
    matches.push(...(pageMatches.get(scanPage) || []));
  }

  if (!sawAssignmentField && sawAnyRecords) {
    throw createAssignmentVisibilityUnavailableError(helpers);
  }

  return {
    matches,
    scannedAllPages: totalPages === 0 || finalScanPage >= totalPages,
  };
}

function buildMatterAssignmentIdentity(assignment) {
  return assignment.assignment_uuid
    || (assignment.id !== null && assignment.id !== undefined ? `id:${assignment.id}` : null)
    || JSON.stringify({
      end_date: assignment.end_date,
      start_date: assignment.start_date,
      type: assignment.type,
      user_uuid: assignment.user?.user_uuid ?? null,
    });
}

function mergeMatchingAssignments(existingAssignments, nextAssignments) {
  const merged = [...existingAssignments];
  const seen = new Set(merged.map((assignment) => buildMatterAssignmentIdentity(assignment)));

  for (const assignment of nextAssignments) {
    const key = buildMatterAssignmentIdentity(assignment);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(assignment);
  }

  return merged;
}

function compareActiveCurrentUserMatters(left, right) {
  const leftOpened = left.date_opened || '';
  const rightOpened = right.date_opened || '';
  if (leftOpened !== rightOpened) {
    return rightOpened.localeCompare(leftOpened);
  }

  const leftCaseNumber = left.case_number || '';
  const rightCaseNumber = right.case_number || '';
  if (leftCaseNumber !== rightCaseNumber) {
    return leftCaseNumber.localeCompare(rightCaseNumber);
  }

  return String(left.case_uuid || '').localeCompare(String(right.case_uuid || ''));
}

async function scanActiveCurrentUserMatters({ client, config, currentUser, filters, helpers }) {
  const scans = [];
  const combinedDispositionFilter = ACTIVE_CURRENT_USER_MATTER_DISPOSITIONS.join(',');

  try {
    scans.push(await scanCurrentUserMatterPages({
      client,
      config,
      currentUser,
      filters: {
        ...filters,
        case_disposition: combinedDispositionFilter,
      },
      helpers,
    }));
  } catch (error) {
    if (error?.status !== 400) {
      throw error;
    }

    for (const caseDisposition of ACTIVE_CURRENT_USER_MATTER_DISPOSITIONS) {
      scans.push(await scanCurrentUserMatterPages({
        client,
        config,
        currentUser,
        filters: {
          ...filters,
          case_disposition: caseDisposition,
        },
        helpers,
      }));
    }
  }

  const mergedByCaseUuid = new Map();

  for (const scan of scans) {
    for (const match of scan.matches) {
      const existing = mergedByCaseUuid.get(match.case_uuid);
      if (!existing) {
        mergedByCaseUuid.set(match.case_uuid, {
          ...match,
          matching_assignments: [...match.matching_assignments],
        });
        continue;
      }

      existing.matching_assignments = mergeMatchingAssignments(
        existing.matching_assignments,
        match.matching_assignments,
      );
    }
  }

  return {
    matches: [...mergedByCaseUuid.values()].sort(compareActiveCurrentUserMatters),
    scannedAllPages: scans.every((scan) => scan.scannedAllPages),
  };
}

function buildCurrentUserMatterWarnings(scannedAllPages) {
  if (scannedAllPages) {
    return [];
  }

  return [
    `The scan stopped after ${MATTER_CURRENT_USER_SCAN_MAX_PAGES} upstream matter pages, so counts and next-page hints reflect the scanned window only.`,
  ];
}

function buildCurrentUserMatterCacheKey({ email, filters, variant }) {
  return JSON.stringify({
    email,
    filters,
    variant,
  });
}

async function runCurrentUserMatterScan({ args, client, config, helpers, requestInfo, variant }) {
  const headerName = config?.userEmailHeader || 'x-legalserver-user-email';
  const email = readHeaderValue(requestInfo?.headers, headerName);
  const filters = buildMatterCurrentUserFilters(args);
  const cacheKey = email
    ? buildCurrentUserMatterCacheKey({
        email: email.toLowerCase(),
        filters,
        variant,
      })
    : null;

  const executeScan = async () => {
    const currentUser = await resolveCurrentUser({
      client,
      config,
      helpers,
      requestInfo,
    });

    if (variant === 'active') {
      return scanActiveCurrentUserMatters({
        client,
        config,
        currentUser,
        filters,
        helpers,
      });
    }

    return scanCurrentUserMatterPages({
      client,
      config,
      currentUser,
      filters,
      helpers,
    });
  };

  if (!cacheKey) {
    return executeScan();
  }

  return currentUserMatterScanCache.getOrCreate(
    cacheKey,
    config?.matterCurrentUserCacheTtlMs ?? 0,
    executeScan,
  );
}

async function runCurrentUserMatterList({ args, client, config, helpers, requestInfo, variant = 'all' }) {
  const page = helpers.validatePage(args.page);
  const pageSize = helpers.validatePageSize(args.page_size);
  const scan = await runCurrentUserMatterScan({
    args,
    client,
    config,
    helpers,
    requestInfo,
    variant,
  });
  const paged = helpers.paginateArray(scan.matches, page, pageSize);

  return helpers.successEnvelope({
    data: paged.items,
    page: paged.page,
    pageSize: paged.pageSize,
    totalRecords: paged.totalRecords,
    totalPages: paged.totalPages,
    truncated: !scan.scannedAllPages,
    warnings: buildCurrentUserMatterWarnings(scan.scannedAllPages),
  });
}

function currentUserMatterListProperties({ includeCaseDisposition = true } = {}) {
  const properties = {
    ...pageProperties(),
    legal_problem_code: {
      type: 'string',
      description: 'Optional legal problem code filter.',
    },
    assignment_type: {
      type: 'string',
      description: 'Optional assignment type filter mapped to the matter search assignments:type key.',
    },
    current_only: {
      type: 'boolean',
      default: true,
      description: 'Set false to include historical assignments that are no longer current.',
    },
  };

  if (includeCaseDisposition) {
    properties.case_disposition = {
      type: 'string',
      description: 'Optional LegalServer case disposition filter.',
    };
  }

  return properties;
}

async function apiListHandler({ args, client, helpers, queryBuilder, pathTemplate, pathParams, mapper, warningsFactory, postProcess }) {
  const page = helpers.validatePage(args.page);
  const pageSize = helpers.validatePageSize(args.page_size);
  const response = await client.getJson(pathTemplate, {
    pathParams,
    query: {
      page_number: page,
      page_size: pageSize,
      ...queryBuilder(args),
    },
  });

  const items = Array.isArray(response.data) ? response.data : [];
  const warnings = warningsFactory ? warningsFactory(items, response) : [];
  const mappedItems = items.map((item) => mapper(item, helpers));
  const finalItems = postProcess ? postProcess(mappedItems) : mappedItems;

  return helpers.successEnvelope({
    data: finalItems,
    page: response.page,
    pageSize: response.pageSize,
    totalRecords: response.totalRecords,
    totalPages: response.totalPages,
    truncated: finalItems.some((item) => Object.keys(item).some((key) => key.endsWith('_truncated') && item[key] === true)),
    warnings,
  });
}

function createMatterTools() {
  return [
    {
      name: 'matter_lookup_by_case_number',
      description: 'Resolve a LegalServer case number to the canonical matter routing fields needed for follow-up tools.',
      inputSchema: {
        type: 'object',
        properties: {
          case_number: {
            type: 'string',
            description: 'LegalServer case number such as 24-0539721.',
          },
        },
        required: ['case_number'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: 1,
        page_size_max: 1,
      },
      handler: async ({ client, helpers, args }) => {
        const caseNumber = helpers.normalizeIdentifier(args.case_number, 'case_number');
        const response = await client.getJson('/api/v1/matters', {
          query: {
            case_number: caseNumber,
            results: 'full',
            page_size: 1,
          },
        });

        const records = Array.isArray(response.data) ? response.data : [];
        const match = records[0];

        if (!match) {
          return helpers.successEnvelope({
            data: null,
            page: 1,
            pageSize: 1,
            totalRecords: 0,
            totalPages: 0,
            warnings: [`No matter found for case number ${caseNumber}.`],
            next: null,
          });
        }

        return helpers.successEnvelope({
          data: {
            case_uuid: helpers.getFirstDefined(match.matter_uuid, match.case_uuid, match.uuid),
            case_id: match.case_id ?? null,
            case_number: match.case_number ?? null,
            case_title: match.case_title ?? null,
            client_name: helpers.getFirstDefined(match.client_full_name, match.organization_name),
            case_status: match.case_status ?? null,
            case_disposition: match.case_disposition ?? null,
            legal_problem_code: match.legal_problem_code ?? null,
            date_opened: helpers.normalizeDateValue(match.date_opened),
            case_profile_url: match.case_profile_url ?? null,
          },
          page: 1,
          pageSize: 1,
          totalRecords: response.totalRecords || 1,
          totalPages: response.totalPages || 1,
          truncated: false,
        });
      },
    },
    {
      name: 'matter_get',
      description: 'Return a curated read-only matter core for a LegalServer matter UUID.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {},
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');
        const response = await client.getJson('/api/v1/matters/{case_UUID}', {
          pathParams: { case_UUID: caseUuid },
          query: { results: 'full' },
        });

        return helpers.successEnvelope({
          data: mapMatter(response.data || {}, helpers),
          page: 1,
          pageSize: 1,
          totalRecords: response.totalRecords || 1,
          totalPages: response.totalPages || 1,
          truncated: false,
          next: null,
        });
      },
    },
    {
      name: 'matter_list_current_user',
      description: 'List matters assigned to the current request user.',
      inputSchema: {
        type: 'object',
        properties: currentUserMatterListProperties(),
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: ({ args, client, config, helpers, requestInfo }) => runCurrentUserMatterList({
        args,
        client,
        config,
        helpers,
        requestInfo,
      }),
    },
    {
      name: 'matter_list_current_user_active',
      description: 'List active matters assigned to the current request user.',
      inputSchema: {
        type: 'object',
        properties: currentUserMatterListProperties({ includeCaseDisposition: false }),
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: ({ args, client, config, helpers, requestInfo }) => runCurrentUserMatterList({
        args,
        client,
        config,
        helpers,
        requestInfo,
        variant: 'active',
      }),
    },
    {
      name: 'matter_list_notes',
      description: 'List active matter notes with flattened previews.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
        preview_max_chars: PREVIEW_MAX_CHARS,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');

        return apiListHandler({
          args,
          client,
          helpers,
          pathTemplate: '/api/v1/matters/{case_UUID}/notes',
          pathParams: { case_UUID: caseUuid },
          queryBuilder: () => ({}),
          mapper: mapNote,
          warningsFactory: (items) => {
            const inactiveCount = items.filter((item) => item.active === false).length;
            if (inactiveCount === 0) {
              return [];
            }
            return [`${inactiveCount} inactive note(s) were omitted from this page.`];
          },
          postProcess: (items) => items.filter((item) => item.active !== false),
        });
      },
    },
    {
      name: 'matter_get_note',
      description: 'Return one matter note with HTML flattened to text when needed.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          note_uuid: {
            type: 'string',
            description: 'LegalServer case note UUID.',
          },
          max_chars: {
            type: 'integer',
            default: DEFAULT_MAX_CHARS,
            minimum: 1,
            maximum: MAX_MAX_CHARS,
            description: 'Maximum body characters to return, capped at 12000.',
          },
        },
        required: ['case_uuid', 'note_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        max_chars_default: DEFAULT_MAX_CHARS,
        max_chars_max: MAX_MAX_CHARS,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');
        const noteUuid = helpers.normalizeIdentifier(args.note_uuid, 'note_uuid');
        const maxChars = helpers.validateMaxChars(args.max_chars);
        const response = await client.getJson('/api/v1/matters/{case_UUID}/notes/{casenote_uuid}', {
          pathParams: {
            case_UUID: caseUuid,
            casenote_uuid: noteUuid,
          },
        });

        const note = response.data || {};
        const bodyText = note.is_html ? helpers.htmlToText(note.body) : String(note.body ?? '');
        const truncatedBody = helpers.truncateText(bodyText, maxChars);

        return helpers.successEnvelope({
          data: {
            note_uuid: note.casenote_uuid ?? noteUuid,
            id: note.id ?? null,
            subject: note.subject ?? null,
            note_type: note.note_type ?? null,
            date_posted: helpers.normalizeDateValue(note.date_posted),
            date_time_created: helpers.normalizeDateValue(note.date_time_created),
            created_by: helpers.normalizeUser(note.created_by),
            last_update: helpers.normalizeDateValue(note.last_update),
            last_updated_by: helpers.normalizeUser(note.last_updated_by),
            is_html: Boolean(note.is_html),
            note_has_document_attached: Boolean(note.note_has_document_attached),
            active: note.active !== false,
            body_text: truncatedBody.text,
            body_truncated: truncatedBody.truncated,
          },
          page: 1,
          pageSize: 1,
          totalRecords: 1,
          totalPages: 1,
          truncated: truncatedBody.truncated,
          next: null,
        });
      },
    },
    {
      name: 'matter_list_assignments',
      description: 'List matter assignments with documented LegalServer filters.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
          current_only: {
            type: 'boolean',
            description: 'Limit results to current assignments.',
          },
          probono_only: {
            type: 'boolean',
            description: 'Limit results to pro bono assignments.',
          },
          type: {
            type: 'string',
            description: 'Assignment type filter.',
          },
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
        preview_max_chars: PREVIEW_MAX_CHARS,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');

        return apiListHandler({
          args,
          client,
          helpers,
          pathTemplate: '/api/v1/matters/{case_UUID}/assignments',
          pathParams: { case_UUID: caseUuid },
          queryBuilder: (toolArgs) => ({
            current_only: toolArgs.current_only,
            probono_only: toolArgs.probono_only,
            type: toolArgs.type,
          }),
          mapper: mapAssignment,
        });
      },
    },
    {
      name: 'matter_list_adverse_parties',
      description: 'List normalized adverse party records without high-risk identifiers.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
        preview_max_chars: PREVIEW_MAX_CHARS,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');

        return apiListHandler({
          args,
          client,
          helpers,
          pathTemplate: '/api/v1/matters/{case_UUID}/adverse_parties',
          pathParams: { case_UUID: caseUuid },
          queryBuilder: () => ({}),
          mapper: (record, localHelpers) => mapParty(record, localHelpers, 'adverse_party'),
        });
      },
    },
    {
      name: 'matter_list_non_adverse_parties',
      description: 'List normalized non-adverse and family-party records without high-risk identifiers.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
        preview_max_chars: PREVIEW_MAX_CHARS,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');

        return apiListHandler({
          args,
          client,
          helpers,
          pathTemplate: '/api/v1/matters/{case_UUID}/non_adverse_parties',
          pathParams: { case_UUID: caseUuid },
          queryBuilder: () => ({}),
          mapper: (record, localHelpers) => mapParty(record, localHelpers, 'non_adverse_party'),
        });
      },
    },
    {
      name: 'matter_list_contacts',
      description: 'List matter contacts without expanding into global contact details.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');

        return apiListHandler({
          args,
          client,
          helpers,
          pathTemplate: '/api/v1/matters/{case_UUID}/contacts',
          pathParams: { case_UUID: caseUuid },
          queryBuilder: () => ({}),
          mapper: mapContact,
        });
      },
    },
    {
      name: 'matter_list_related_matters',
      description: 'List locally paginated related-matter links.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');
        const page = helpers.validatePage(args.page);
        const pageSize = helpers.validatePageSize(args.page_size);
        const response = await client.getJson('/api/v1/matters/{case_UUID}/related_matters', {
          pathParams: { case_UUID: caseUuid },
        });

        const records = Array.isArray(response.data) ? response.data : [];
        const paged = helpers.paginateArray(records, page, pageSize);

        return helpers.successEnvelope({
          data: paged.items.map(mapRelatedMatter),
          page: paged.page,
          pageSize: paged.pageSize,
          totalRecords: paged.totalRecords,
          totalPages: paged.totalPages,
          truncated: false,
        });
      },
    },
    {
      name: 'matter_list_services',
      description: 'List service records with the documented high-value filters only.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
          active: {
            type: 'boolean',
            description: 'Filter for active service records.',
          },
          closed: {
            type: 'boolean',
            description: 'Filter for closed service records.',
          },
          type: {
            type: 'string',
            description: 'Service type filter.',
          },
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
        preview_max_chars: PREVIEW_MAX_CHARS,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');

        return apiListHandler({
          args,
          client,
          helpers,
          pathTemplate: '/api/v1/matters/{case_UUID}/services',
          pathParams: { case_UUID: caseUuid },
          queryBuilder: (toolArgs) => ({
            active: toolArgs.active,
            closed: toolArgs.closed,
            type: toolArgs.type,
          }),
          mapper: mapService,
        });
      },
    },
    {
      name: 'matter_list_incomes',
      description: 'List income records with normalized note previews.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
        preview_max_chars: PREVIEW_MAX_CHARS,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');

        return apiListHandler({
          args,
          client,
          helpers,
          pathTemplate: '/api/v1/matters/{case_UUID}/incomes',
          pathParams: { case_UUID: caseUuid },
          queryBuilder: () => ({}),
          mapper: mapIncome,
        });
      },
    },
    {
      name: 'matter_list_litigations',
      description: 'List litigation records with normalized note previews.',
      inputSchema: {
        type: 'object',
        properties: {
          case_uuid: caseUuidProperty(),
          ...pageProperties(),
        },
        required: ['case_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: DEFAULT_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
        preview_max_chars: PREVIEW_MAX_CHARS,
      },
      handler: async ({ client, helpers, args }) => {
        const caseUuid = helpers.normalizeIdentifier(args.case_uuid, 'case_uuid');

        return apiListHandler({
          args,
          client,
          helpers,
          pathTemplate: '/api/v1/matters/{case_UUID}/litigations',
          pathParams: { case_UUID: caseUuid },
          queryBuilder: () => ({}),
          mapper: mapLitigation,
        });
      },
    },
  ];
}

module.exports = {
  createMatterTools,
};
