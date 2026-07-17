const DEFAULT_SAMPLE_COUNT = 5;
const FANOUT_SAMPLE_COUNT = 3;

function buildBenchmarkScenarios(fixtures, config) {
  const sharedSecretHeaders = config.sharedSecret
    ? { [config.sharedSecretHeader]: config.sharedSecret }
    : {};
  const buildHeaders = (email) => ({
    ...sharedSecretHeaders,
    ...(email ? { [config.userEmailHeader]: email } : {}),
  });
  const scenarios = [
    {
      id: 'matter_lookup_by_case_number',
      label: 'lookup by case number',
      toolName: 'matter_lookup_by_case_number',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_number: fixtures.matters.lookup.case_number }),
    },
    {
      id: 'matter_get',
      label: 'matter detail',
      toolName: 'matter_get',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.lookup.case_uuid }),
    },
    {
      id: 'matter_list_current_user',
      label: 'current user assigned matters',
      toolName: 'matter_list_current_user',
      sampleCount: FANOUT_SAMPLE_COUNT,
      args: () => ({ page_size: 10 }),
      headers: () => buildHeaders(fixtures.current_user.matters.email),
    },
    {
      id: 'matter_list_current_user_active',
      label: 'current user active matters',
      toolName: 'matter_list_current_user_active',
      sampleCount: FANOUT_SAMPLE_COUNT,
      args: () => ({ page_size: 10 }),
      headers: () => buildHeaders(fixtures.current_user.matters.email),
    },
    {
      id: 'matter_list_notes',
      label: 'matter notes',
      toolName: 'matter_list_notes',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.notes.case_uuid, page_size: 10 }),
    },
    {
      id: 'matter_get_note',
      label: 'matter note detail',
      toolName: 'matter_get_note',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({
        case_uuid: fixtures.matters.notes.case_uuid,
        note_uuid: fixtures.matters.notes.note_uuid,
        max_chars: 500,
      }),
    },
    {
      id: 'matter_list_documents',
      label: 'matter documents',
      toolName: 'matter_list_documents',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.documents.case_uuid, page_size: 10 }),
    },
    {
      id: 'document_get_metadata',
      label: 'document metadata',
      toolName: 'document_get_metadata',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => buildDocumentArgs(fixtures.matters.documents.searchable),
    },
    {
      id: 'document_get_text_manifest_cold',
      label: 'document text manifest (cold cache)',
      toolName: 'document_get_text_manifest',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'cold',
      args: () => buildDocumentArgs(fixtures.matters.documents.searchable),
    },
    {
      id: 'document_get_text_manifest_warm',
      label: 'document text manifest (warm cache)',
      toolName: 'document_get_text_manifest',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'warm',
      args: () => buildDocumentArgs(fixtures.matters.documents.searchable),
      prime: async ({ client }) => {
        await client.callTool({
          name: 'document_get_text_manifest',
          arguments: buildDocumentArgs(fixtures.matters.documents.searchable),
        });
      },
    },
    {
      id: 'document_get_text_chunk_cold',
      label: 'document text chunk (cold cache)',
      toolName: 'document_get_text_chunk',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'cold',
      args: () => ({
        ...buildDocumentArgs(fixtures.matters.documents.searchable),
        chunk_index: 0,
      }),
    },
    {
      id: 'document_get_text_chunk_warm',
      label: 'document text chunk (warm cache)',
      toolName: 'document_get_text_chunk',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'warm',
      args: () => ({
        ...buildDocumentArgs(fixtures.matters.documents.searchable),
        chunk_index: 0,
      }),
      prime: async ({ client }) => {
        await client.callTool({
          name: 'document_get_text_manifest',
          arguments: buildDocumentArgs(fixtures.matters.documents.searchable),
        });
      },
    },
    {
      id: 'document_search_text_cold',
      label: 'document text search (cold cache)',
      toolName: 'document_search_text',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'cold',
      args: () => ({
        ...buildDocumentArgs(fixtures.matters.documents.searchable),
        query: fixtures.matters.documents.searchable.search_query,
      }),
    },
    {
      id: 'document_search_text_warm',
      label: 'document text search (warm cache)',
      toolName: 'document_search_text',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'warm',
      args: () => ({
        ...buildDocumentArgs(fixtures.matters.documents.searchable),
        query: fixtures.matters.documents.searchable.search_query,
      }),
      prime: async ({ client }) => {
        await client.callTool({
          name: 'document_get_text_manifest',
          arguments: buildDocumentArgs(fixtures.matters.documents.searchable),
        });
      },
    },
    {
      id: 'matter_search_document_text_cold',
      label: 'matter-wide document search (cold cache)',
      toolName: 'matter_search_document_text',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'cold',
      args: () => ({
        case_uuid: fixtures.matters.documents.case_uuid,
        query: fixtures.matters.documents.searchable.search_query,
        page_size: 10,
      }),
    },
    {
      id: 'matter_search_document_text_warm',
      label: 'matter-wide document search (warm cache)',
      toolName: 'matter_search_document_text',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'warm',
      args: () => ({
        case_uuid: fixtures.matters.documents.case_uuid,
        query: fixtures.matters.documents.searchable.search_query,
        page_size: 10,
      }),
      prime: async ({ client }) => {
        await client.callTool({
          name: 'matter_search_document_text',
          arguments: {
            case_uuid: fixtures.matters.documents.case_uuid,
            query: fixtures.matters.documents.searchable.search_query,
            page_size: 10,
          },
        });
      },
    },
    {
      id: 'document_get_text_manifest_scanned_cold',
      label: 'document text manifest (OCR/scanned cold cache)',
      toolName: 'document_get_text_manifest',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'cold',
      optional: true,
      args: () => buildDocumentArgs(fixtures.matters.documents.scanned),
      onlyIf: () => Boolean(fixtures.matters.documents.scanned),
    },
    {
      id: 'document_get_text_manifest_scanned_warm',
      label: 'document text manifest (OCR/scanned warm cache)',
      toolName: 'document_get_text_manifest',
      sampleCount: FANOUT_SAMPLE_COUNT,
      coldOrWarm: 'warm',
      optional: true,
      onlyIf: () => Boolean(fixtures.matters.documents.scanned),
      args: () => buildDocumentArgs(fixtures.matters.documents.scanned),
      prime: async ({ client }) => {
        await client.callTool({
          name: 'document_get_text_manifest',
          arguments: buildDocumentArgs(fixtures.matters.documents.scanned),
        });
      },
    },
    {
      id: 'matter_list_assignments',
      label: 'matter assignments',
      toolName: 'matter_list_assignments',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.assignments.case_uuid, page_size: 10 }),
    },
    {
      id: 'matter_list_adverse_parties',
      label: 'matter adverse parties',
      toolName: 'matter_list_adverse_parties',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.adverse_parties.case_uuid, page_size: 10 }),
    },
    {
      id: 'matter_list_non_adverse_parties',
      label: 'matter non-adverse parties',
      toolName: 'matter_list_non_adverse_parties',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.non_adverse_parties.case_uuid, page_size: 10 }),
    },
    {
      id: 'matter_list_contacts',
      label: 'matter contacts',
      toolName: 'matter_list_contacts',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.contacts.case_uuid, page_size: 10 }),
    },
    {
      id: 'matter_list_related_matters',
      label: 'related matters',
      toolName: 'matter_list_related_matters',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.related_matters.case_uuid, page_size: 10 }),
    },
    {
      id: 'matter_list_services',
      label: 'matter services',
      toolName: 'matter_list_services',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.services.case_uuid, page_size: 10 }),
    },
    {
      id: 'matter_list_incomes',
      label: 'matter incomes',
      toolName: 'matter_list_incomes',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.incomes.case_uuid, page_size: 10 }),
    },
    {
      id: 'matter_list_litigations',
      label: 'matter litigations',
      toolName: 'matter_list_litigations',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ case_uuid: fixtures.matters.litigations.case_uuid, page_size: 10 }),
    },
    {
      id: 'task_search',
      label: 'task search by id',
      toolName: 'task_search',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ id: fixtures.tasks.id, page_size: 10 }),
    },
    {
      id: 'task_get',
      label: 'task detail',
      toolName: 'task_get',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ task_uuid: fixtures.tasks.task_uuid }),
    },
    {
      id: 'task_list_on_date',
      label: 'tasks on date',
      toolName: 'task_list_on_date',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ date: fixtures.tasks.date, page_size: 10 }),
    },
    {
      id: 'task_list_current_user_on_date',
      label: 'current user tasks on date',
      toolName: 'task_list_current_user_on_date',
      sampleCount: FANOUT_SAMPLE_COUNT,
      args: () => ({ date: fixtures.current_user.tasks.date, page_size: 10 }),
      headers: () => buildHeaders(fixtures.current_user.tasks.email),
    },
    {
      id: 'task_list_current_user_between_dates',
      label: 'current user tasks in range',
      toolName: 'task_list_current_user_between_dates',
      sampleCount: FANOUT_SAMPLE_COUNT,
      args: () => ({
        start_date: fixtures.current_user.tasks.range_start_date,
        end_date: fixtures.current_user.tasks.range_end_date,
        page_size: 10,
      }),
      headers: () => buildHeaders(fixtures.current_user.tasks.email),
    },
    {
      id: 'event_search',
      label: 'event search',
      toolName: 'event_search',
      sampleCount: FANOUT_SAMPLE_COUNT,
      args: () => buildEventSearchArgs(fixtures.events),
    },
    {
      id: 'event_get',
      label: 'event detail',
      toolName: 'event_get',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ event_uuid: fixtures.events.event_uuid }),
    },
    {
      id: 'event_list_by_date',
      label: 'events on date',
      toolName: 'event_list_by_date',
      sampleCount: FANOUT_SAMPLE_COUNT,
      args: () => ({ date: fixtures.events.date, page_size: 10 }),
    },
    {
      id: 'event_list_current_user_on_date',
      label: 'current user events on date',
      toolName: 'event_list_current_user_on_date',
      sampleCount: FANOUT_SAMPLE_COUNT,
      args: () => ({ date: fixtures.current_user.events.date, page_size: 10 }),
      headers: () => buildHeaders(fixtures.current_user.events.email),
    },
    {
      id: 'event_list_current_user_between_dates',
      label: 'current user events in range',
      toolName: 'event_list_current_user_between_dates',
      sampleCount: FANOUT_SAMPLE_COUNT,
      args: () => ({
        start_date: fixtures.current_user.events.range_start_date,
        end_date: fixtures.current_user.events.range_end_date,
        page_size: 10,
      }),
      headers: () => buildHeaders(fixtures.current_user.events.email),
    },
    {
      id: 'contact_search',
      label: 'contact search by email',
      toolName: 'contact_search',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ email: fixtures.contacts.email, page_size: 10 }),
    },
    {
      id: 'contact_get',
      label: 'contact detail',
      toolName: 'contact_get',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ contact_uuid: fixtures.contacts.contact_uuid }),
    },
    {
      id: 'contact_lookup_by_email',
      label: 'contact exact lookup',
      toolName: 'contact_lookup_by_email',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ email: fixtures.contacts.email }),
    },
    {
      id: 'user_search',
      label: 'user search by login',
      toolName: 'user_search',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ login: fixtures.users.login, page_size: 10 }),
    },
    {
      id: 'user_get',
      label: 'user detail',
      toolName: 'user_get',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ user_uuid: fixtures.users.user_uuid }),
    },
    {
      id: 'user_get_current',
      label: 'current user profile',
      toolName: 'user_get_current',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({}),
      headers: () => buildHeaders(fixtures.current_user.profile.email),
    },
    {
      id: 'user_list_current_user_supervisors',
      label: 'current user supervisors',
      toolName: 'user_list_current_user_supervisors',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ page_size: 10 }),
      headers: () => buildHeaders(fixtures.current_user.profile.email),
    },
    {
      id: 'user_lookup_by_login',
      label: 'user exact lookup',
      toolName: 'user_lookup_by_login',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ login: fixtures.users.login }),
    },
    {
      id: 'organization_search',
      label: 'organization search by name',
      toolName: 'organization_search',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ name: fixtures.organizations.name, page_size: 10 }),
    },
    {
      id: 'organization_get',
      label: 'organization detail',
      toolName: 'organization_get',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ organization_uuid: fixtures.organizations.organization_uuid }),
    },
    {
      id: 'organization_lookup_by_name',
      label: 'organization exact lookup',
      toolName: 'organization_lookup_by_name',
      sampleCount: DEFAULT_SAMPLE_COUNT,
      args: () => ({ name: fixtures.organizations.name }),
    },
  ];

  return scenarios.filter((scenario) => !scenario.onlyIf || scenario.onlyIf());
}

function buildDocumentArgs(fixture) {
  return {
    case_uuid: fixture.case_uuid,
    ...(fixture.document_uuid ? { document_uuid: fixture.document_uuid } : {}),
    ...(fixture.document_id ? { document_id: String(fixture.document_id) } : {}),
  };
}

function buildEventSearchArgs(fixture) {
  if (fixture.external_id) {
    return {
      external_id: fixture.external_id,
      date: fixture.date,
      page_size: 10,
    };
  }

  return {
    title: fixture.title,
    date: fixture.date,
    page_size: 10,
  };
}

module.exports = {
  buildBenchmarkScenarios,
};
