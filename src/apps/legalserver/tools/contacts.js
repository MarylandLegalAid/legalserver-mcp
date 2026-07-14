const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('../constants');
const { pageProperties, uuidProperty } = require('./shared/schemas');
const {
  findExactMatch,
  normalizeAddressObject,
  normalizeAddressSummary,
  normalizeOfficeCollection,
  normalizeTypeList,
  runPaginatedSearch,
} = require('./shared/globalDiscovery');

function getPrimaryOffice(record, helpers) {
  return normalizeOfficeCollection(record.office, helpers)[0] ?? null;
}

function mapContactSummary(record, helpers) {
  return {
    contact_uuid: record.uuid ?? null,
    id: record.id ?? null,
    full_name: helpers.normalizeDisplayName(record),
    active: record.active ?? null,
    types: normalizeTypeList(record.type, helpers),
    email: record.email ?? null,
    phone_business: record.phone_business ?? null,
    phone_mobile: record.phone_mobile ?? null,
    phone_home: record.phone_home ?? null,
    work_address_summary: normalizeAddressSummary(record.address_work),
    office: getPrimaryOffice(record, helpers),
    user_profile_exists: record.user_profile_exists ?? null,
    user_uuid: record.user_uuid ?? null,
  };
}

function mapContactDetail(record, helpers) {
  return {
    ...mapContactSummary(record, helpers),
    salutation: record.salutation ?? null,
    bar_number: record.bar_number ?? null,
    language: record.language ?? null,
    email_allow: record.email_allow ?? null,
    mail_allow: record.mail_allow ?? null,
    gender: record.gender ?? null,
    work_address: normalizeAddressObject(record.address_work),
    date_created: helpers.normalizeDateValue(record.date_created),
  };
}

function createContactTools() {
  return [
    {
      name: 'contact_search',
      description: 'Search LegalServer contacts with the full results shape enforced.',
      inputSchema: {
        type: 'object',
        properties: {
          ...pageProperties(),
          first: { type: 'string', description: 'Contact first name filter.' },
          middle: { type: 'string', description: 'Contact middle name filter.' },
          last: { type: 'string', description: 'Contact last name filter.' },
          organization_name: { type: 'string', description: 'Contact organization-name filter.' },
          type: { type: 'string', description: 'Contact type filter.' },
          email: { type: 'string', description: 'Contact email filter.' },
          phone_business: { type: 'string', description: 'Business phone filter.' },
          contact_uuid: uuidProperty('Contact UUID filter.'),
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
        pathTemplate: '/api/v1/contacts',
        queryBuilder: (toolArgs) => ({
          results: 'full',
          first: toolArgs.first,
          middle: toolArgs.middle,
          last: toolArgs.last,
          organization_name: toolArgs.organization_name,
          type: toolArgs.type,
          email: toolArgs.email,
          phone_business: toolArgs.phone_business,
          uuid: toolArgs.contact_uuid,
        }),
        mapper: mapContactSummary,
      }),
    },
    {
      name: 'contact_get',
      description: 'Return one LegalServer contact by contact UUID.',
      inputSchema: {
        type: 'object',
        properties: {
          contact_uuid: uuidProperty('LegalServer contact UUID.'),
        },
        required: ['contact_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {},
      handler: async ({ args, client, helpers }) => {
        const contactUuid = helpers.normalizeIdentifier(args.contact_uuid, 'contact_uuid');
        const response = await client.getJson('/api/v1/contacts/{contact_UUID}', {
          pathParams: { contact_UUID: contactUuid },
        });

        return helpers.successEnvelope({
          data: mapContactDetail(response.data || {}, helpers),
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
      name: 'contact_lookup_by_email',
      description: 'Resolve one contact by exact email address.',
      inputSchema: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Exact contact email address.',
          },
        },
        required: ['email'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: MAX_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: async ({ args, client, helpers }) => {
        const email = helpers.normalizeIdentifier(args.email, 'email');
        const normalizedEmail = email.toLowerCase();
        const record = await findExactMatch({
          client,
          helpers,
          pathTemplate: '/api/v1/contacts',
          query: {
            results: 'full',
            email,
          },
          compare: (candidate) => String(candidate.email ?? '').trim().toLowerCase() === normalizedEmail,
          inputLabel: `email ${email}`,
          subject: 'contact',
        });

        return helpers.successEnvelope({
          data: {
            contact_uuid: record.uuid ?? null,
            id: record.id ?? null,
            full_name: helpers.normalizeDisplayName(record),
            email: record.email ?? null,
            phone_business: record.phone_business ?? null,
            user_profile_exists: record.user_profile_exists ?? null,
            user_uuid: record.user_uuid ?? null,
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
  createContactTools,
};
