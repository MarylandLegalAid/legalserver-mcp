const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('../constants');
const { pageProperties, uuidProperty } = require('./shared/schemas');
const {
  findExactMatch,
  normalizeOfficeCollection,
  normalizeOrganizationRef,
  normalizeTypeList,
  normalizeUserRef,
  runPaginatedSearch,
} = require('./shared/globalDiscovery');

function mapOrganizationAffiliation(record, helpers) {
  return {
    organization_affiliation_uuid: record.organization_affiliation_uuid ?? null,
    id: record.id ?? null,
    organization: normalizeOrganizationRef(record.organization),
    organization_date_start: helpers.normalizeDateValue(record.organization_date_start),
    organization_date_end: helpers.normalizeDateValue(record.organization_date_end),
    organization_position: record.organization_position ?? null,
    organization_contact: record.organization_contact ?? null,
    organization_contact_type: record.organization_contact_type ?? null,
    assistant: record.assistant ?? null,
    assistant_phone: record.assistant_phone ?? null,
    judicial_assistant: record.judicial_assistant ?? null,
    judicial_assistant_phone: record.judicial_assistant_phone ?? null,
  };
}

function mapSupervisor(record) {
  return {
    uuid: record.uuid ?? null,
    id: record.id ?? null,
    supervisor_type: record.supervisor_type ?? null,
    supervisor: normalizeUserRef(record.supervisor),
  };
}

function mapSupervisee(record) {
  return {
    uuid: record.uuid ?? null,
    supervisor_uuid: record.supervisor_uuid ?? null,
    supervisor_type: record.supervisor_type ?? null,
    supervisee: normalizeUserRef(record.supervisee),
  };
}

function mapUserSummary(record, helpers) {
  return {
    user_uuid: record.user_uuid ?? null,
    id: record.id ?? null,
    full_name: helpers.normalizeDisplayName(record),
    login: record.login ?? null,
    email: record.email ?? null,
    active: record.active ?? null,
    current: record.current ?? null,
    contact_active: record.contact_active ?? null,
    types: normalizeTypeList(record.types, helpers),
    role: record.role ?? null,
    office: helpers.normalizeOffice(record.office),
    program: record.program ?? null,
    additional_offices: normalizeOfficeCollection(record.additional_offices, helpers),
    additional_programs: normalizeTypeList(record.additional_programs, helpers),
    bar_number: record.bar_number ?? null,
    languages: normalizeTypeList(record.languages, helpers),
    preferred_phone: record.preferred_phone ?? null,
    phone_business: record.phone_business ?? null,
    phone_mobile: record.phone_mobile ?? null,
    contact_uuid: record.contact_uuid ?? null,
    external_unique_id: record.external_unique_id ?? null,
  };
}

function mapUserDetail(record, helpers) {
  return {
    ...mapUserSummary(record, helpers),
    organization_affiliations: Array.isArray(record.organization_affiliations)
      ? record.organization_affiliations.map((item) => mapOrganizationAffiliation(item, helpers))
      : [],
    supervisors: Array.isArray(record.supervisors)
      ? record.supervisors.map(mapSupervisor)
      : [],
    supervisees: Array.isArray(record.supervisees)
      ? record.supervisees.map(mapSupervisee)
      : [],
  };
}

function createUserTools() {
  return [
    {
      name: 'user_search',
      description: 'Search LegalServer users with the documented global user filters.',
      inputSchema: {
        type: 'object',
        properties: {
          ...pageProperties(),
          user_uuid: uuidProperty('User UUID filter.'),
          id: { type: 'integer', description: 'LegalServer user ID.' },
          first: { type: 'string', description: 'First name filter.' },
          middle: { type: 'string', description: 'Middle name filter.' },
          last: { type: 'string', description: 'Last name filter.' },
          email: { type: 'string', description: 'Email filter.' },
          login: { type: 'string', description: 'Login filter.' },
          active: { type: 'boolean', description: 'Active user filter.' },
          current: { type: 'boolean', description: 'Current user filter.' },
          role: { type: 'string', description: 'Role filter.' },
          office: { type: 'string', description: 'Office filter.' },
          program: { type: 'string', description: 'Program filter.' },
          bar_number: { type: 'string', description: 'Bar number filter.' },
          external_unique_id: { type: 'string', description: 'External unique ID filter.' },
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
        pathTemplate: '/api/v1/users',
        queryBuilder: (toolArgs) => ({
          user_uuid: toolArgs.user_uuid,
          id: toolArgs.id,
          first: toolArgs.first,
          middle: toolArgs.middle,
          last: toolArgs.last,
          email: toolArgs.email,
          login: toolArgs.login,
          active: toolArgs.active,
          current: toolArgs.current,
          role: toolArgs.role,
          office: toolArgs.office,
          program: toolArgs.program,
          bar_number: toolArgs.bar_number,
          external_unique_id: toolArgs.external_unique_id,
        }),
        mapper: mapUserSummary,
      }),
    },
    {
      name: 'user_get',
      description: 'Return one LegalServer user by user UUID.',
      inputSchema: {
        type: 'object',
        properties: {
          user_uuid: uuidProperty('LegalServer user UUID.'),
        },
        required: ['user_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {},
      handler: async ({ args, client, helpers }) => {
        const userUuid = helpers.normalizeIdentifier(args.user_uuid, 'user_uuid');
        const response = await client.getJson('/api/v1/users/{user_uuid}', {
          pathParams: { user_uuid: userUuid },
        });

        return helpers.successEnvelope({
          data: mapUserDetail(response.data || {}, helpers),
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
      name: 'user_lookup_by_login',
      description: 'Resolve one LegalServer user by exact login.',
      inputSchema: {
        type: 'object',
        properties: {
          login: {
            type: 'string',
            description: 'Exact LegalServer login.',
          },
        },
        required: ['login'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: MAX_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: async ({ args, client, helpers }) => {
        const login = helpers.normalizeIdentifier(args.login, 'login');
        const normalizedLogin = login.toLowerCase();
        const record = await findExactMatch({
          client,
          helpers,
          pathTemplate: '/api/v1/users',
          query: { login },
          compare: (candidate) => String(candidate.login ?? '').trim().toLowerCase() === normalizedLogin,
          inputLabel: `login ${login}`,
          subject: 'user',
        });

        return helpers.successEnvelope({
          data: {
            user_uuid: record.user_uuid ?? null,
            id: record.id ?? null,
            full_name: helpers.normalizeDisplayName(record),
            login: record.login ?? null,
            email: record.email ?? null,
            active: record.active ?? null,
            current: record.current ?? null,
            role: record.role ?? null,
            office: helpers.normalizeOffice(record.office),
            program: record.program ?? null,
          },
          page: 1,
          pageSize: 1,
          totalRecords: 1,
          totalPages: 1,
          truncated: false,
          next: null,
        });
      },
    },
  ];
}

module.exports = {
  createUserTools,
};
