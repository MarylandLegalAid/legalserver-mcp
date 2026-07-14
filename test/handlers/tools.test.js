const test = require('node:test');
const assert = require('node:assert/strict');
const { LegalServerClient } = require('../../src/apps/legalserver/legalserverClient');
const helpers = require('../../src/apps/legalserver/helpers');
const { createToolRegistry } = require('../../src/apps/legalserver/toolRegistry');
const { createSequentialFetch, jsonResponse } = require('../support/mockFetch');

function createRegistry(fetchImpl, overrides = {}) {
  const client = new LegalServerClient({
    baseUrl: 'https://example.legalserver.org/',
    bearerToken: 'token',
    timeoutMs: 30000,
    fetchImpl,
  });

  return createToolRegistry({
    client,
    helpers,
    documentTextPipeline: overrides.documentTextPipeline,
  });
}

function makePaginated(data, page = 1, pageSize = 10) {
  return {
    page_number: page,
    page_size: pageSize,
    total_records: data.length,
    total_number_of_pages: data.length === 0 ? 0 : 1,
    data,
  };
}

function parseSuccess(payload) {
  assert.equal(payload.ok, true);
  return payload;
}

const sampleMatter = {
  matter_uuid: 'matter-uuid-1',
  case_id: 101,
  case_number: '24-0001',
  case_title: 'Test Matter',
  client_full_name: 'Jane Client',
  client_email_address: 'jane@example.org',
  case_status: 'Open',
  case_disposition: 'Open',
  legal_problem_code: '01 Housing',
  date_opened: { raw_value: '2024-01-01', text_value: '01/01/2024' },
  case_profile_url: 'https://example.legalserver.org/matter/101',
  intake_office: { office_name: 'Main Office', office_display: 'Main Office' },
  intake_program: 'Housing',
  intake_user: { user_name: 'Intake User' },
  is_this_a_prescreen: false,
  county_of_residence: { county_name: 'Kings' },
  county_of_dispute: { county_name: 'Queens' },
  language: 'English',
  second_language: 'Spanish',
  interpreter: false,
  number_of_adults: 1,
  number_of_children: 2,
  percentage_of_poverty: '125%',
  asset_eligible: true,
  lsc_eligible: true,
  income_eligible: true,
};

const successCases = [
  {
    name: 'matter_lookup_by_case_number',
    args: { case_number: '24-0001' },
    responses: [jsonResponse(200, { full_data: [sampleMatter], total_records: 1, total_number_of_pages: 1, page_size: 1, page_number: 1 })],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data.case_uuid, 'matter-uuid-1');
      assert.equal(result.data.case_number, '24-0001');
    },
  },
  {
    name: 'matter_get',
    args: { case_uuid: 'matter-uuid-1' },
    responses: [jsonResponse(200, { data: sampleMatter })],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data.case_uuid, 'matter-uuid-1');
      assert.equal(result.data.client_name, 'Jane Client');
    },
  },
  {
    name: 'matter_list_notes',
    args: { case_uuid: 'matter-uuid-1' },
    responses: [jsonResponse(200, makePaginated([
      {
        casenote_uuid: 'note-1',
        id: 11,
        subject: 'Subject',
        body: '<p>Hello world</p>',
        note_type: 'General',
        date_posted: '2024-01-02',
        date_time_created: '2024-01-02T10:00:00Z',
        created_by: { user_name: 'Author' },
        last_update: '2024-01-03T10:00:00Z',
        last_updated_by: { user_name: 'Editor' },
        is_html: true,
        note_has_document_attached: false,
        active: true,
      },
    ]))],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].note_uuid, 'note-1');
      assert.equal(result.data[0].body_preview, 'Hello world');
    },
  },
  {
    name: 'matter_get_note',
    args: { case_uuid: 'matter-uuid-1', note_uuid: 'note-1', max_chars: 5 },
    responses: [jsonResponse(200, { data: {
      casenote_uuid: 'note-1',
      body: '<p>Hello world</p>',
      is_html: true,
      active: true,
    } })],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data.body_text, 'Hello');
      assert.equal(result.truncated, true);
    },
  },
  {
    name: 'matter_list_documents',
    args: { case_uuid: 'matter-uuid-1' },
    responses: [jsonResponse(200, [
      {
        internal_id: 500,
        guid: 'doc-1',
        name: 'lease.pdf',
        title: 'Lease',
        mime_type: 'application/pdf',
        disk_file_size: 4000,
        date_create: '2024-01-04T00:00:00Z',
        date_update: '2024-01-05T00:00:00Z',
        virus_scanned: true,
        virus_free: true,
        folder_id: 3,
        download_url: 'https://example/doc-1',
      },
    ])],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].document_uuid, 'doc-1');
      assert.equal(result.data[0].estimated_tokens, 1000);
    },
  },
  {
    name: 'document_get_metadata',
    args: { case_uuid: 'matter-uuid-1', document_uuid: 'doc-1' },
    responses: [jsonResponse(200, [
      {
        internal_id: 500,
        guid: 'doc-1',
        name: 'lease.pdf',
        title: 'Lease',
        mime_type: 'application/pdf',
        disk_file_size: 4000,
        date_create: '2024-01-04T00:00:00Z',
        date_update: '2024-01-05T00:00:00Z',
        virus_scanned: true,
        virus_free: true,
        folder_id: 3,
        download_url: 'https://example/doc-1',
      },
    ])],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data.document_uuid, 'doc-1');
      assert.equal(result.data.text_strategy, 'direct_or_ocr');
      assert.equal(result.data.download_url, 'https://example/doc-1');
    },
  },
  {
    name: 'matter_list_assignments',
    args: { case_uuid: 'matter-uuid-1', current_only: true },
    responses: [jsonResponse(200, makePaginated([
      {
        uuid: 'assignment-1',
        id: 1,
        type: 'Primary',
        start_date: '2024-01-01',
        confirmed: true,
        program: 'Housing',
        office: { office_display: 'Main Office' },
        name: 'Staff User',
        user: { user_name: 'Staff User' },
        assigned_by: { user_name: 'Manager User' },
        notes: 'A'.repeat(305),
        created_at: '2024-01-01T00:00:00Z',
      },
    ]))],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].assignment_uuid, 'assignment-1');
      assert.equal(result.data[0].notes_truncated, true);
    },
  },
  {
    name: 'matter_list_adverse_parties',
    args: { case_uuid: 'matter-uuid-1' },
    responses: [jsonResponse(200, makePaginated([
      {
        uuid: 'adv-1',
        id: 9,
        first: 'John',
        last: 'Doe',
        relationship_type: 'Landlord',
        phone_business: '555-5555',
        adverse_party_note: 'Important note',
        adverse_party_alert: 'Alert',
        active: true,
      },
    ]))],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].adverse_party_uuid, 'adv-1');
      assert.equal(result.data[0].display_name, 'John Doe');
    },
  },
  {
    name: 'matter_list_non_adverse_parties',
    args: { case_uuid: 'matter-uuid-1' },
    responses: [jsonResponse(200, makePaginated([
      {
        uuid: 'nonadv-1',
        id: 8,
        first: 'Jane',
        last: 'Relative',
        relationship_type: 'Spouse',
        family_member: true,
        household_member: true,
        non_adverse_party: true,
        potential_conflict: false,
        active: true,
      },
    ]))],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].non_adverse_party_uuid, 'nonadv-1');
      assert.equal(result.data[0].family_member, true);
    },
  },
  {
    name: 'matter_list_contacts',
    args: { case_uuid: 'matter-uuid-1' },
    responses: [jsonResponse(200, makePaginated([
      {
        case_contact_uuid: 'contact-link-1',
        contact_uuid: 'contact-1',
        first: 'Judge',
        last: 'Judy',
        case_contact_type: 'Judge',
        contact_types: { individual_values: ['Judge'] },
        phone_business: '555-0000',
        email: 'judge@example.org',
      },
    ]))],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].matter_contact_uuid, 'contact-link-1');
      assert.deepEqual(result.data[0].contact_types, ['Judge']);
    },
  },
  {
    name: 'matter_list_related_matters',
    args: { case_uuid: 'matter-uuid-1' },
    responses: [jsonResponse(200, { data: [
      {
        id: 'rel-1',
        matter_relationship_type: 'Related',
        related_matter_id: {
          uuid: 'matter-uuid-2',
          case_number: '24-0002',
          name: 'Related Matter',
        },
      },
    ] })],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].relationship_uuid, 'rel-1');
      assert.equal(result.data[0].related_matter.case_uuid, 'matter-uuid-2');
    },
  },
  {
    name: 'matter_list_services',
    args: { case_uuid: 'matter-uuid-1', active: true },
    responses: [jsonResponse(200, makePaginated([
      {
        service_uuid: 'service-1',
        id: 31,
        title: 'Representation',
        type: 'Advice',
        closed_by: { user_name: 'Closer' },
        closed: false,
        active: true,
        decision: 'Approved',
        funding_code: 'FC1',
        note: 'Service note',
      },
    ]))],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].service_uuid, 'service-1');
      assert.equal(result.data[0].note_preview, 'Service note');
    },
  },
  {
    name: 'matter_list_incomes',
    args: { case_uuid: 'matter-uuid-1' },
    responses: [jsonResponse(200, makePaginated([
      {
        income_uuid: 'income-1',
        id: 77,
        type: 'Wages',
        amount: '$500',
        period: 'Monthly',
        exclude: false,
        notes: 'Income note',
      },
    ]))],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].income_uuid, 'income-1');
    },
  },
  {
    name: 'matter_list_litigations',
    args: { case_uuid: 'matter-uuid-1' },
    responses: [jsonResponse(200, makePaginated([
      {
        litigation_uuid: 'lit-1',
        id: 61,
        court_number: '123',
        court_text: 'Civil Court',
        caption: 'Client v. Other',
        docket: '2024CV123',
        cause_of_action: 'Eviction',
        judge: 'Judge Judy',
        outcome: 'Pending',
        date_proceeding_initiated: '2024-01-05',
        lsc_disclosure_required: true,
        notes: 'Litigation note',
      },
    ]))],
    assertPayload(payload) {
      const result = parseSuccess(payload);
      assert.equal(result.data[0].litigation_uuid, 'lit-1');
      assert.equal(result.data[0].notes_preview, 'Litigation note');
    },
  },
];

for (const testCase of successCases) {
  test(`handler success: ${testCase.name}`, async () => {
    const registry = createRegistry(createSequentialFetch(testCase.responses, []));
    const payload = await registry.execute(testCase.name, testCase.args);
    testCase.assertPayload(payload);
  });
}

test('handler empty results stay structured', async () => {
  const registry = createRegistry(createSequentialFetch([
    jsonResponse(200, { full_data: [], total_records: 0, total_number_of_pages: 0, page_size: 1, page_number: 1 }),
    jsonResponse(200, { data: [] }),
    jsonResponse(200, makePaginated([])),
  ], []));

  const lookup = await registry.execute('matter_lookup_by_case_number', { case_number: '24-missing' });
  assert.equal(lookup.ok, true);
  assert.equal(lookup.data, null);

  const related = await registry.execute('matter_list_related_matters', { case_uuid: 'matter-uuid-1' });
  assert.deepEqual(related.data, []);

  const assignments = await registry.execute('matter_list_assignments', { case_uuid: 'matter-uuid-1' });
  assert.deepEqual(assignments.data, []);
});

for (const status of [401, 403, 404, 429, 503]) {
  for (const testCase of successCases) {
    test(`handler error mapping: ${testCase.name} -> ${status}`, async () => {
      const calls = [];
      const registry = createRegistry(createSequentialFetch([
        jsonResponse(status, { message: `status-${status}` }, status === 429 ? { 'retry-after': '9' } : {}),
      ], calls));

      await assert.rejects(() => registry.execute(testCase.name, testCase.args), (error) => {
        assert.equal(error.status, status);
        assert.equal(error.errorCode, status === 401
          ? 'unauthorized'
          : status === 403
            ? 'forbidden'
            : status === 404
              ? 'not_found'
              : status === 429
                ? 'rate_limited'
                : 'service_unavailable');
        return true;
      });
    });
  }
}
