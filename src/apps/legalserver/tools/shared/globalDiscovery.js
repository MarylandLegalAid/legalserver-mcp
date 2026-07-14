const {
  DEFAULT_MAX_CHARS,
  MAX_PAGE_SIZE,
  PREVIEW_MAX_CHARS,
} = require('../../constants');

function collapseWhitespace(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }

      if (item && typeof item === 'object') {
        return (
          item.name
          ?? item.label
          ?? item.organization_name
          ?? item.user_name
          ?? item.office_display
          ?? item.office_name
          ?? item.matter
          ?? item.matter_identification_number
          ?? null
        );
      }

      return null;
    })
    .filter(Boolean);
}

function normalizeTypeList(value, helpers) {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return helpers.normalizeArrayValue(value)
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }

      if (item && typeof item === 'object') {
        return item.name ?? item.label ?? null;
      }

      return null;
    })
    .filter(Boolean);
}

function normalizeOfficeCollection(value, helpers) {
  const values = helpers.normalizeArrayValue(value);
  if (values.length > 0) {
    return values
      .map((item) => helpers.normalizeOffice(item))
      .filter(Boolean);
  }

  const single = helpers.normalizeOffice(value);
  return single ? [single] : [];
}

function normalizeUserRef(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const userUuid = value.user_uuid ?? value.uuid ?? null;
  const id = value.user_id ?? value.id ?? null;
  const name = value.user_name ?? value.full_name ?? value.name ?? null;

  if (userUuid === null && id === null && name === null) {
    return null;
  }

  return {
    user_uuid: userUuid,
    id,
    name,
  };
}

function normalizeOrganizationRef(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const organizationUuid = value.organization_uuid ?? value.uuid ?? null;
  const id = value.organization_id ?? value.id ?? null;
  const name = value.organization_name ?? value.name ?? null;

  if (organizationUuid === null && id === null && name === null) {
    return null;
  }

  return {
    organization_uuid: organizationUuid,
    id,
    name,
  };
}

function normalizeMatterRef(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const caseUuid = value.case_uuid ?? value.matter_uuid ?? value.uuid ?? null;
  const caseId = value.case_id ?? value.matter_id ?? value.id ?? null;
  const caseNumber = value.case_number ?? value.matter_identification_number ?? null;
  const caseTitle = value.case_title ?? value.matter ?? value.name ?? null;

  if (caseUuid === null && caseId === null && caseNumber === null && caseTitle === null) {
    return null;
  }

  return {
    case_uuid: caseUuid,
    case_id: caseId,
    case_number: caseNumber,
    case_title: caseTitle,
  };
}

function normalizeOutreachRef(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const outreachUuid = value.outreach_uuid ?? value.uuid ?? null;
  const id = value.outreach_id ?? value.id ?? null;
  const name = value.outreach_name ?? value.name ?? null;

  if (outreachUuid === null && id === null && name === null) {
    return null;
  }

  return {
    outreach_uuid: outreachUuid,
    id,
    name,
  };
}

function normalizeModuleRef(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if ('matter_uuid' in value || 'matter_identification_number' in value || 'matter' in value) {
    const matter = normalizeMatterRef(value);
    return matter
      ? {
          module_type: 'matter',
          id: matter.case_id,
          uuid: matter.case_uuid,
          label: matter.case_number ?? matter.case_title,
        }
      : null;
  }

  if ('event_uuid' in value || 'event_id' in value || 'event_name' in value) {
    return {
      module_type: 'event',
      id: value.event_id ?? value.id ?? null,
      uuid: value.event_uuid ?? value.uuid ?? null,
      label: value.event_name ?? value.name ?? null,
    };
  }

  if ('outreach_uuid' in value || 'outreach_id' in value || 'outreach_name' in value) {
    return {
      module_type: 'outreach',
      id: value.outreach_id ?? value.id ?? null,
      uuid: value.outreach_uuid ?? value.uuid ?? null,
      label: value.outreach_name ?? value.name ?? null,
    };
  }

  if ('grant_uuid' in value || 'grant_id' in value || 'grant_name' in value) {
    return {
      module_type: 'grant',
      id: value.grant_id ?? value.id ?? null,
      uuid: value.grant_uuid ?? value.uuid ?? null,
      label: value.grant_name ?? value.name ?? null,
    };
  }

  return null;
}

function normalizeModuleDetail(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const moduleRef = normalizeModuleRef(value);
  if (!moduleRef) {
    return null;
  }

  return {
    ...moduleRef,
    matter: normalizeMatterRef(value),
  };
}

function normalizeAddressObject(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const street2 = value.street_2 ?? value['street 2'] ?? null;
  const normalized = {
    street: value.street ?? null,
    street_2: street2,
    apt_num: value.apt_num ?? null,
    city: value.city ?? null,
    state: value.state ?? null,
    zip: value.zip ?? null,
  };

  return Object.values(normalized).some((item) => item)
    ? normalized
    : null;
}

function normalizeAddressSummary(value) {
  const address = normalizeAddressObject(value);
  if (!address) {
    return null;
  }

  return [
    address.street,
    address.apt_num,
    address.street_2,
    address.city,
    address.state,
    address.zip,
  ].filter(Boolean).join(', ') || null;
}

function makeSearchPreview(value, helpers) {
  return helpers.makePreview(value, PREVIEW_MAX_CHARS);
}

function makeDetailText(value, helpers) {
  return helpers.truncateText(String(value ?? ''), DEFAULT_MAX_CHARS);
}

function buildSearchEnvelope({
  helpers,
  response,
  items,
  warnings = [],
}) {
  const truncated = items.some((item) => (
    item
    && typeof item === 'object'
    && Object.entries(item).some(([key, value]) => key.endsWith('_truncated') && value === true)
  ));

  return helpers.successEnvelope({
    data: items,
    page: response.page,
    pageSize: response.pageSize,
    totalRecords: response.totalRecords,
    totalPages: response.totalPages,
    truncated,
    warnings,
  });
}

async function runPaginatedSearch({
  args,
  client,
  helpers,
  pathTemplate,
  pathParams,
  queryBuilder,
  mapper,
  warningsFactory,
}) {
  const page = helpers.validatePage(args.page);
  const pageSize = helpers.validatePageSize(args.page_size);
  const response = await client.getJson(pathTemplate, {
    pathParams,
    query: {
      page_number: page,
      page_size: pageSize,
      ...(queryBuilder ? queryBuilder(args) : {}),
    },
  });

  const records = Array.isArray(response.data) ? response.data : [];
  const items = records.map((record) => mapper(record, helpers));
  const warnings = warningsFactory ? warningsFactory(records, items, response) : [];

  return buildSearchEnvelope({
    helpers,
    response,
    items,
    warnings,
  });
}

async function findExactMatch({
  client,
  helpers,
  pathTemplate,
  query,
  compare,
  inputLabel,
  subject,
}) {
  const exactMatches = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await client.getJson(pathTemplate, {
      query: {
        page_number: page,
        page_size: MAX_PAGE_SIZE,
        ...query,
      },
    });

    const records = Array.isArray(response.data) ? response.data : [];
    for (const record of records) {
      if (compare(record)) {
        exactMatches.push(record);
        if (exactMatches.length > 1) {
          throw new helpers.ToolError({
            errorCode: 'multiple_matches',
            message: `Multiple ${subject} records matched ${inputLabel}.`,
            status: 409,
          });
        }
      }
    }

    totalPages = response.totalPages || 0;
    if (totalPages === 0) {
      break;
    }
    page += 1;
  }

  if (exactMatches.length === 0) {
    throw new helpers.ToolError({
      errorCode: 'not_found',
      message: `No ${subject} record matched ${inputLabel}.`,
      status: 404,
    });
  }

  return exactMatches[0];
}

module.exports = {
  buildSearchEnvelope,
  collapseWhitespace,
  findExactMatch,
  makeDetailText,
  makeSearchPreview,
  normalizeAddressObject,
  normalizeAddressSummary,
  normalizeMatterRef,
  normalizeModuleDetail,
  normalizeModuleRef,
  normalizeOfficeCollection,
  normalizeOrganizationRef,
  normalizeOutreachRef,
  normalizeStringList,
  normalizeTypeList,
  normalizeUserRef,
  runPaginatedSearch,
};
