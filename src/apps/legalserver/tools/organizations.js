const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('../constants');
const { pageProperties, uuidProperty } = require('./shared/schemas');
const {
  collapseWhitespace,
  findExactMatch,
  makeDetailText,
  makeSearchPreview,
  normalizeAddressSummary,
  normalizeOrganizationRef,
  normalizeTypeList,
  runPaginatedSearch,
} = require('./shared/globalDiscovery');

function mapOrganizationSummary(record, helpers) {
  const descriptionPreview = makeSearchPreview(record.description, helpers);

  return {
    organization_uuid: record.uuid ?? null,
    id: record.id ?? null,
    name: record.name ?? null,
    abbreviation: record.abbreviation ?? null,
    types: normalizeTypeList(record.types, helpers),
    active: record.active ?? null,
    is_master: record.is_master ?? null,
    phone: record.phone ?? null,
    referral_contact_phone: record.referral_contact_phone ?? null,
    referral_contact_email: record.referral_contact_email ?? null,
    website: record.website ?? null,
    city: record.city ?? null,
    state: record.state ?? null,
    address_summary: normalizeAddressSummary(record),
    description_preview: descriptionPreview.preview,
    description_truncated: descriptionPreview.truncated,
    external_unique_id: record.external_unique_id ?? null,
  };
}

function mapOrganizationDetail(record, helpers) {
  const description = makeDetailText(record.description, helpers);
  const parent = Array.isArray(record.parent_organization) ? record.parent_organization[0] : null;

  return {
    data: {
      ...mapOrganizationSummary(record, helpers),
      description: description.text || null,
      parent_organization: parent
        ? normalizeOrganizationRef({
            organization_uuid: parent.uuid,
            organization_id: parent.id,
            organization_name: parent.name,
          })
        : null,
    },
    truncated: description.truncated,
  };
}

function createOrganizationTools() {
  return [
    {
      name: 'organization_search',
      description: 'Search LegalServer organizations with documented global filters.',
      inputSchema: {
        type: 'object',
        properties: {
          ...pageProperties(),
          name: { type: 'string', description: 'Organization name filter.' },
          types: { type: 'string', description: 'Organization type filter.' },
          active: { type: 'boolean', description: 'Active organization filter.' },
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
        pathTemplate: '/api/v1/organizations',
        queryBuilder: (toolArgs) => ({
          name: toolArgs.name,
          types: toolArgs.types,
          active: toolArgs.active,
          external_unique_id: toolArgs.external_unique_id,
        }),
        mapper: mapOrganizationSummary,
      }),
    },
    {
      name: 'organization_get',
      description: 'Return one LegalServer organization by organization UUID.',
      inputSchema: {
        type: 'object',
        properties: {
          organization_uuid: uuidProperty('LegalServer organization UUID.'),
        },
        required: ['organization_uuid'],
        additionalProperties: false,
      },
      budgetPolicy: {},
      handler: async ({ args, client, helpers }) => {
        const organizationUuid = helpers.normalizeIdentifier(args.organization_uuid, 'organization_uuid');
        const response = await client.getJson('/api/v1/organizations/{organization_uuid}', {
          pathParams: { organization_uuid: organizationUuid },
        });
        const mapped = mapOrganizationDetail(response.data || {}, helpers);

        return helpers.successEnvelope({
          data: mapped.data,
          page: 1,
          pageSize: 1,
          totalRecords: 1,
          totalPages: 1,
          truncated: mapped.truncated,
          next: null,
        });
      },
    },
    {
      name: 'organization_lookup_by_name',
      description: 'Resolve one LegalServer organization by exact organization name.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Exact organization name.',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      budgetPolicy: {
        page_size_default: MAX_PAGE_SIZE,
        page_size_max: MAX_PAGE_SIZE,
      },
      handler: async ({ args, client, helpers }) => {
        const name = helpers.normalizeIdentifier(args.name, 'name');
        const normalizedName = collapseWhitespace(name).toLowerCase();
        const record = await findExactMatch({
          client,
          helpers,
          pathTemplate: '/api/v1/organizations',
          query: { name },
          compare: (candidate) => collapseWhitespace(candidate.name).toLowerCase() === normalizedName,
          inputLabel: `name ${name}`,
          subject: 'organization',
        });

        return helpers.successEnvelope({
          data: {
            organization_uuid: record.uuid ?? null,
            id: record.id ?? null,
            name: record.name ?? null,
            active: record.active ?? null,
            types: normalizeTypeList(record.types, helpers),
            phone: record.phone ?? null,
            city: record.city ?? null,
            state: record.state ?? null,
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
  createOrganizationTools,
};
