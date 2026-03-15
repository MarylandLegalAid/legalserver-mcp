const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('../../src/helpers');
const { LegalServerClient } = require('../../src/legalserverClient');
const { createToolRegistry } = require('../../src/toolRegistry');
const { createSequentialFetch, jsonResponse } = require('../support/mockFetch');

function createRegistry(responses, options = {}) {
  const calls = [];
  const fetchImpl = options.fetchImpl || createSequentialFetch(responses, calls);
  const client = new LegalServerClient({
    baseUrl: 'https://example.legalserver.org/',
    bearerToken: 'token',
    timeoutMs: 30000,
    fetchImpl,
  });

  return {
    calls,
    registry: createToolRegistry({
      client,
      helpers,
      documentTextPipeline: {
        async getDocumentState() {
          throw new Error('documentTextPipeline should not be used in phase 3 handler tests');
        },
      },
      config: {
        userEmailHeader: 'x-legalserver-user-email',
        matterCurrentUserCacheTtlMs: 60000,
        matterCurrentUserFetchConcurrency: 4,
        ...(options.config || {}),
      },
    }),
  };
}

function makePaginated(data, page = 1, pageSize = 10, totalPages = 1, totalRecords = data.length) {
  return {
    page_number: page,
    page_size: pageSize,
    total_records: totalRecords,
    total_number_of_pages: totalPages,
    data,
  };
}

const sampleTask = {
  id: 101,
  task_uuid: 'task-uuid-1',
  active: true,
  title: 'Prepare filing',
  list_date: '2026-03-12',
  due_date: '2026-03-14',
  task_type: 'Follow Up',
  deadline: false,
  deadline_type: null,
  private: false,
  completed: false,
  completed_by: {
    user_id: 5,
    user_uuid: 'user-uuid-5',
    user_name: 'Closer User',
  },
  users: {
    all_values: 'Assigned User',
    individual_values: [{
      user_id: 7,
      user_uuid: 'user-uuid-7',
      user_name: 'Assigned User',
    }],
  },
  module: {
    matter: 'Client Matter',
    matter_id: 44,
    matter_uuid: 'matter-uuid-1',
    matter_identification_number: '24-0001',
  },
  office: {
    office_name: 'Main Office',
    office_code: 'MO',
    office_display: 'Main Office',
  },
  program: 'Housing',
  statute_of_limitations: '2026-03-30',
  created_by: {
    user_id: 3,
    user_uuid: 'user-uuid-3',
    user_name: 'Creator User',
  },
  created_date: '2026-03-10',
};

const sampleCurrentUserTask = {
  ...sampleTask,
  id: 102,
  task_uuid: 'task-uuid-current-user',
  title: 'Current user filing',
  users: {
    all_values: 'Jordan Staff',
    individual_values: [{
      user_id: 404,
      user_uuid: 'user-uuid-1',
      user_name: 'Jordan Staff',
    }],
  },
};

const sampleEvent = {
  id: 202,
  event_uuid: 'event-uuid-1',
  external_id: 'cal-1',
  title: 'Housing Hearing',
  location: 'Courtroom A',
  front_desk: true,
  private_event: false,
  all_day_event: false,
  court: {
    organization_id: 13,
    organization_uuid: 'org-uuid-court',
    organization_name: 'County Court',
  },
  courtroom: 'A',
  event_type: 'Hearing',
  attendees: {
    all_values: 'Assigned User',
    individual_values: [{
      user_id: 7,
      user_uuid: 'user-uuid-7',
      user_name: 'Assigned User',
    }],
  },
  judge: 'Hon. Example',
  start_datetime: '2026-03-12T09:00:00-05:00',
  end_datetime: '2026-03-12T09:30:00-05:00',
  program: 'Housing',
  office: {
    office_name: 'Main Office',
    office_code: 'MO',
    office_display: 'Main Office',
  },
  matters: {
    all_values: '24-0001',
    individual_values: [{
      matter: 'Client Matter',
      matter_identification_number: '24-0001',
      matter_uuid: 'matter-uuid-1',
    }],
  },
  outreaches: {
    all_values: 'Clinic',
    individual_values: [{
      outreach_id: 77,
      outreach_uuid: 'outreach-uuid-1',
      outreach_name: 'Clinic',
    }],
  },
};

const sampleCurrentUserEvent = {
  ...sampleEvent,
  id: 203,
  event_uuid: 'event-uuid-current-user',
  title: 'My Hearing',
  attendees: {
    all_values: 'Jordan Staff',
    individual_values: [{
      user_id: 404,
      user_uuid: 'user-uuid-1',
      user_name: 'Jordan Staff',
    }],
  },
};

const sampleContact = {
  id: 303,
  uuid: 'contact-uuid-1',
  first: 'Taylor',
  last: 'Contact',
  type: {
    all_values: 'Judge, Referral',
    individual_values: ['Judge', 'Referral'],
  },
  active: true,
  email: 'taylor@example.org',
  phone_home: '555-1000',
  phone_business: '555-2000',
  phone_mobile: '555-3000',
  salutation: 'Mx.',
  bar_number: 'B-123',
  date_created: '2024-05-01',
  language: 'English',
  email_allow: true,
  mail_allow: false,
  gender: 'Nonbinary',
  address_work: {
    street: '123 Main',
    street_2: 'Suite 9',
    city: 'Boston',
    state: 'MA',
    zip: '02110',
  },
  office: {
    all_values: 'Main Office',
    individual_values: [{
      office_name: 'Main Office',
      office_code: 'MO',
      office_display: 'Main Office',
    }],
  },
  user_profile_exists: true,
  user_uuid: 'user-uuid-contact',
};

const sampleUser = {
  id: 404,
  user_uuid: 'user-uuid-1',
  first: 'Jordan',
  last: 'Staff',
  email: 'jordan@example.org',
  login: 'jstaff',
  active: true,
  current: true,
  contact_active: true,
  types: {
    all_values: 'Staff',
    individual_values: ['Staff'],
  },
  role: 'Administrator',
  office: {
    office_name: 'Main Office',
    office_code: 'MO',
    office_display: 'Main Office',
  },
  program: 'Housing',
  additional_offices: {
    all_values: 'Branch Office',
    individual_values: [{
      office_name: 'Branch Office',
      office_code: 'BR',
      office_display: 'Branch Office',
    }],
  },
  additional_programs: {
    all_values: 'Litigation',
    individual_values: ['Litigation'],
  },
  bar_number: 'BAR-1',
  languages: {
    all_values: 'English, Spanish',
    individual_values: ['English', 'Spanish'],
  },
  preferred_phone: 'phone_mobile',
  phone_business: '555-2200',
  phone_mobile: '555-3300',
  contact_uuid: 'contact-uuid-user',
  external_unique_id: 'ext-user-1',
  organization_affiliations: [{
    id: 77,
    organization_affiliation_uuid: 'aff-uuid-1',
    organization: {
      organization_id: 13,
      organization_uuid: 'org-uuid-1',
      organization_name: 'County Court',
    },
    organization_date_start: '2025-01-01',
    organization_position: 'Panel Attorney',
  }],
  supervisors: [{
    id: 91,
    uuid: 'supervisor-link-1',
    supervisor_type: 'Primary',
    supervisor: {
      user_id: 500,
      user_uuid: 'user-uuid-supervisor',
      user_name: 'Supervisor Person',
    },
  }],
  supervisees: [{
    uuid: 'supervisee-link-1',
    supervisor_uuid: 'supervisor-link-1',
    supervisor_type: 'Primary',
    supervisee: {
      user_id: 501,
      user_uuid: 'user-uuid-supervisee',
      user_name: 'Supervisee Person',
    },
  }],
};

const sampleOrganization = {
  id: 505,
  uuid: 'org-uuid-1',
  name: 'Legal Aid Partners',
  abbreviation: 'LAP',
  description: 'A'.repeat(350),
  types: {
    all_values: 'Partner, Court',
    individual_values: ['Partner', 'Court'],
  },
  street: '456 Court St',
  street_2: 'Floor 4',
  city: 'Boston',
  state: 'MA',
  zip: '02108',
  phone: '555-9999',
  referral_contact_phone: '555-8888',
  referral_contact_email: 'referrals@example.org',
  website: 'https://example.org',
  is_master: false,
  active: true,
  external_unique_id: 'org-ext-1',
  parent_organization: [{
    id: 1,
    uuid: 'org-parent-1',
    name: 'Parent Org',
  }],
};

const sampleMatterAssignment = {
  id: 701,
  uuid: 'assignment-uuid-1',
  type: 'Primary',
  start_date: '2025-01-01',
  end_date: null,
  date_requested: null,
  confirmed: true,
  program: 'Housing',
  office: {
    office_name: 'Main Office',
    office_code: 'MO',
    office_display: 'Main Office',
  },
  name: 'Jordan Staff',
  user: {
    user_id: 404,
    user_uuid: 'user-uuid-1',
    user_name: 'Jordan Staff',
  },
  assigned_by: {
    user_id: 3,
    user_uuid: 'user-uuid-3',
    user_name: 'Creator User',
  },
  notes: 'Lead assignment',
  created_at: '2026-01-05T09:00:00Z',
};

const sampleMatter = {
  matter_uuid: 'matter-uuid-current',
  case_id: 601,
  case_number: '26-0001',
  case_title: 'Eviction Defense',
  client_full_name: 'Alex Client',
  case_status: 'Open',
  case_disposition: 'Open',
  legal_problem_code: '01 Housing',
  case_profile_url: 'https://example.legalserver.org/matter/601',
  date_opened: '2026-01-05',
  assignments: [sampleMatterAssignment],
};

const sampleOtherMatter = {
  ...sampleMatter,
  matter_uuid: 'matter-uuid-other',
  case_id: 602,
  case_number: '26-0002',
  assignments: [{
    ...sampleMatterAssignment,
    uuid: 'assignment-uuid-2',
    user: {
      user_id: 7,
      user_uuid: 'user-uuid-7',
      user_name: 'Assigned User',
    },
  }],
};

test('task_search and task_list_on_date send the documented query shape and map summaries', async () => {
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([sampleTask])),
    jsonResponse(200, makePaginated([sampleTask])),
  ]);

  const search = await registry.execute('task_search', {
    title: 'Prepare filing',
    deadline: false,
    module: 'matter',
    module_id: 44,
  });
  assert.equal(search.data[0].task_uuid, 'task-uuid-1');
  assert.equal(search.data[0].module.module_type, 'matter');
  assert.equal(search.data[0].users[0].user_uuid, 'user-uuid-7');

  const listOnDate = await registry.execute('task_list_on_date', {
    date: '2026-03-12',
  });
  assert.equal(listOnDate.data[0].title, 'Prepare filing');

  const firstUrl = new URL(calls[0].url);
  assert.equal(firstUrl.searchParams.get('module'), 'matter');
  assert.equal(firstUrl.searchParams.get('module_id'), '44');

  const secondUrl = new URL(calls[1].url);
  assert.equal(secondUrl.searchParams.get('list_date'), '2026-03-12');
  assert.equal(secondUrl.searchParams.get('completed'), 'false');
});

test('task_list_current_user_on_date resolves the request user by email and filters tasks locally', async () => {
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([sampleUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([sampleTask, sampleCurrentUserTask], 1, 25, 1, 2)),
  ]);

  const payload = await registry.execute(
    'task_list_current_user_on_date',
    { date: '2026-03-12' },
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'JORDAN@EXAMPLE.ORG',
        },
      },
    },
  );

  assert.deepEqual(payload.data.map((item) => item.task_uuid), ['task-uuid-current-user']);
  assert.equal(payload.truncated, false);

  const userLookupUrl = new URL(calls[0].url);
  assert.equal(userLookupUrl.pathname, '/api/v1/users');
  assert.equal(userLookupUrl.searchParams.get('email'), 'JORDAN@EXAMPLE.ORG');

  const taskUrl = new URL(calls[1].url);
  assert.equal(taskUrl.searchParams.get('list_date'), '2026-03-12');
  assert.equal(taskUrl.searchParams.get('completed'), 'false');
});

test('task_list_current_user_on_date fails when the request-scoped email header is missing', async () => {
  const { registry } = createRegistry([]);

  await assert.rejects(
    () => registry.execute('task_list_current_user_on_date', { date: '2026-03-12' }),
    (error) => {
      assert.equal(error.errorCode, 'missing_user_context');
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test('task_list_current_user_on_date returns user_context_unresolved when no user matches the email', async () => {
  const { registry } = createRegistry([
    jsonResponse(200, makePaginated([], 1, 25, 0, 0)),
  ]);

  await assert.rejects(
    () => registry.execute(
      'task_list_current_user_on_date',
      { date: '2026-03-12' },
      {
        requestInfo: {
          headers: {
            'x-legalserver-user-email': 'missing@example.org',
          },
        },
      },
    ),
    (error) => {
      assert.equal(error.errorCode, 'user_context_unresolved');
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test('task_list_current_user_on_date marks results truncated when the user filter scan window is incomplete', async () => {
  const { registry } = createRegistry([
    jsonResponse(200, makePaginated([sampleUser], 1, 25, 1, 1)),
    ...Array.from({ length: 20 }, (_, index) => jsonResponse(
      200,
      makePaginated(
        [{
          ...sampleCurrentUserTask,
          id: 500 + index,
          task_uuid: `task-window-${index}`,
        }],
        index + 1,
        25,
        21,
        21,
      ),
    )),
  ]);

  const payload = await registry.execute(
    'task_list_current_user_on_date',
    { date: '2026-03-12' },
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'jordan@example.org',
        },
      },
    },
  );

  assert.equal(payload.truncated, true);
  assert.equal(payload.warnings.length, 1);
  assert.match(payload.warnings[0], /stopped after 20 upstream task pages/i);
});

test('task_list_current_user_between_dates aggregates multiple dates for the resolved user', async () => {
  const secondDayTask = {
    ...sampleCurrentUserTask,
    id: 103,
    task_uuid: 'task-uuid-current-user-2',
    title: 'Second day task',
    list_date: '2026-03-13',
    due_date: '2026-03-13',
  };
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([sampleUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([sampleCurrentUserTask], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([secondDayTask], 1, 25, 1, 1)),
  ]);

  const payload = await registry.execute(
    'task_list_current_user_between_dates',
    { start_date: '2026-03-12', end_date: '2026-03-13' },
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'jordan@example.org',
        },
      },
    },
  );

  assert.deepEqual(payload.data.map((item) => item.task_uuid), [
    'task-uuid-current-user',
    'task-uuid-current-user-2',
  ]);
  assert.equal(payload.truncated, false);

  const firstTaskUrl = new URL(calls[1].url);
  assert.equal(firstTaskUrl.searchParams.get('list_date'), '2026-03-12');

  const secondTaskUrl = new URL(calls[2].url);
  assert.equal(secondTaskUrl.searchParams.get('list_date'), '2026-03-13');
});

test('task_list_current_user_between_dates rejects ranges longer than seven days', async () => {
  const { registry } = createRegistry([]);

  await assert.rejects(
    () => registry.execute(
      'task_list_current_user_between_dates',
      { start_date: '2026-03-01', end_date: '2026-03-08' },
      {
        requestInfo: {
          headers: {
            'x-legalserver-user-email': 'jordan@example.org',
          },
        },
      },
    ),
    /cannot exceed 7 day\(s\)/i,
  );
});

test('task_get returns phase 3 detail fields', async () => {
  const { registry } = createRegistry([
    jsonResponse(200, { data: sampleTask }),
  ]);

  const payload = await registry.execute('task_get', { task_uuid: 'task-uuid-1' });
  assert.equal(payload.data.private, false);
  assert.equal(payload.data.statute_of_limitations, '2026-03-30');
  assert.equal(payload.data.module.uuid, 'matter-uuid-1');
});

test('event_search maps matter to the matters query parameter and event_get expands nested refs', async () => {
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([sampleEvent])),
    jsonResponse(200, { data: sampleEvent }),
  ]);

  const search = await registry.execute('event_search', {
    date: '2026-03-12',
    matter: 'matter-uuid-1',
  });
  assert.equal(search.data[0].attendee_count, 1);
  assert.equal(search.data[0].matter_count, 1);

  const detail = await registry.execute('event_get', { event_uuid: 'event-uuid-1' });
  assert.equal(detail.data.attendees[0].user_uuid, 'user-uuid-7');
  assert.equal(detail.data.matters[0].case_uuid, 'matter-uuid-1');
  assert.equal(detail.data.outreaches[0].outreach_uuid, 'outreach-uuid-1');

  const searchUrl = new URL(calls[0].url);
  assert.equal(searchUrl.searchParams.get('matters'), 'matter-uuid-1');
});

test('event_list_by_date falls back to a bounded local date filter when LegalServer rejects the documented date key', async () => {
  const fallbackEvent = {
    ...sampleEvent,
    id: 203,
    event_uuid: 'event-uuid-2',
    title: 'Follow-up Hearing',
    start_datetime: '2026-03-12T13:00:00-05:00',
    end_datetime: '2026-03-12T13:30:00-05:00',
  };
  const offDateEvent = {
    ...sampleEvent,
    id: 204,
    event_uuid: 'event-uuid-3',
    title: 'Wrong Date Event',
    start_datetime: '2026-03-11T09:00:00-05:00',
    end_datetime: '2026-03-11T09:30:00-05:00',
  };
  const { registry, calls } = createRegistry([
    jsonResponse(400, { invalid_search_keys: ['date'] }),
    jsonResponse(200, makePaginated([sampleEvent, offDateEvent], 1, 25, 2, 3)),
    jsonResponse(200, makePaginated([fallbackEvent], 2, 25, 2, 3)),
  ]);

  const payload = await registry.execute('event_list_by_date', {
    date: '2026-03-12',
  });

  assert.deepEqual(payload.data.map((item) => item.event_uuid), ['event-uuid-1', 'event-uuid-2']);
  assert.equal(payload.warnings.length, 1);
  assert.match(payload.warnings[0], /rejected the documented event date search key/i);
  assert.equal(payload.truncated, false);

  const firstUrl = new URL(calls[0].url);
  assert.equal(firstUrl.searchParams.get('date'), '2026-03-12');

  const secondUrl = new URL(calls[1].url);
  assert.equal(secondUrl.searchParams.get('date'), null);
  assert.equal(secondUrl.searchParams.get('sort'), 'desc');
});

test('event_list_current_user_on_date filters by attendee and returns matter context', async () => {
  const { registry } = createRegistry([
    jsonResponse(200, makePaginated([sampleUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([sampleEvent, sampleCurrentUserEvent], 1, 25, 1, 2)),
  ]);

  const payload = await registry.execute(
    'event_list_current_user_on_date',
    { date: '2026-03-12' },
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'jordan@example.org',
        },
      },
    },
  );

  assert.deepEqual(payload.data.map((item) => item.event_uuid), ['event-uuid-current-user']);
  assert.equal(payload.data[0].matters[0].case_uuid, 'matter-uuid-1');
  assert.equal(payload.data[0].outreaches[0].outreach_uuid, 'outreach-uuid-1');
});

test('event_list_current_user_between_dates falls back once and deduplicates range results', async () => {
  const spanningCurrentUserEvent = {
    ...sampleCurrentUserEvent,
    start_datetime: '2026-03-12T09:00:00-05:00',
    end_datetime: '2026-03-13T10:00:00-05:00',
  };
  const { registry } = createRegistry([
    jsonResponse(200, makePaginated([sampleUser], 1, 25, 1, 1)),
    jsonResponse(400, { invalid_search_keys: ['date'] }),
    jsonResponse(200, makePaginated([spanningCurrentUserEvent], 1, 25, 1, 1)),
  ]);

  const payload = await registry.execute(
    'event_list_current_user_between_dates',
    { start_date: '2026-03-12', end_date: '2026-03-13' },
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'jordan@example.org',
        },
      },
    },
  );

  assert.deepEqual(payload.data.map((item) => item.event_uuid), ['event-uuid-current-user']);
  assert.equal(payload.warnings.length, 1);
  assert.match(payload.warnings[0], /rejected the documented event date search key/i);
});

test('contact_search enforces results=full and contact_get returns the curated detail shape', async () => {
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([sampleContact])),
    jsonResponse(200, { data: sampleContact }),
  ]);

  const search = await registry.execute('contact_search', {
    email: 'taylor@example.org',
  });
  assert.equal(search.data[0].work_address_summary, '123 Main, Suite 9, Boston, MA, 02110');

  const detail = await registry.execute('contact_get', {
    contact_uuid: 'contact-uuid-1',
  });
  assert.equal(detail.data.bar_number, 'B-123');
  assert.equal(detail.data.work_address.city, 'Boston');

  const searchUrl = new URL(calls[0].url);
  assert.equal(searchUrl.searchParams.get('results'), 'full');
});

test('contact_lookup_by_email resolves an exact match across pages', async () => {
  const { registry } = createRegistry([
    jsonResponse(200, makePaginated([{
      ...sampleContact,
      email: 'other@example.org',
    }], 1, 25, 2, 2)),
    jsonResponse(200, makePaginated([sampleContact], 2, 25, 2, 2)),
  ]);

  const payload = await registry.execute('contact_lookup_by_email', {
    email: 'TAYLOR@EXAMPLE.ORG',
  });

  assert.equal(payload.data.contact_uuid, 'contact-uuid-1');
  assert.equal(payload.data.user_profile_exists, true);
});

test('user_search, user_get, and user_lookup_by_login return the phase 3 user shapes', async () => {
  const { registry } = createRegistry([
    jsonResponse(200, makePaginated([sampleUser])),
    jsonResponse(200, { data: sampleUser }),
    jsonResponse(200, makePaginated([sampleUser])),
  ]);

  const search = await registry.execute('user_search', {
    login: 'jstaff',
  });
  assert.deepEqual(search.data[0].languages, ['English', 'Spanish']);
  assert.deepEqual(search.data[0].additional_offices, ['Branch Office']);

  const detail = await registry.execute('user_get', {
    user_uuid: 'user-uuid-1',
  });
  assert.equal(detail.data.organization_affiliations[0].organization.organization_uuid, 'org-uuid-1');
  assert.equal(detail.data.supervisors[0].supervisor.user_uuid, 'user-uuid-supervisor');
  assert.equal(detail.data.supervisees[0].supervisee.user_uuid, 'user-uuid-supervisee');

  const lookup = await registry.execute('user_lookup_by_login', {
    login: 'JSTAFF',
  });
  assert.equal(lookup.data.user_uuid, 'user-uuid-1');
  assert.equal(lookup.data.login, 'jstaff');
});

test('user_get_current and user_list_current_user_supervisors resolve the request user', async () => {
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([sampleUser], 1, 25, 1, 1)),
    jsonResponse(200, { data: sampleUser }),
    jsonResponse(200, makePaginated([sampleUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated(sampleUser.supervisors, 1, 10, 1, sampleUser.supervisors.length)),
  ]);

  const current = await registry.execute(
    'user_get_current',
    {},
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'jordan@example.org',
        },
      },
    },
  );
  assert.equal(current.data.user_uuid, 'user-uuid-1');
  assert.equal(current.data.supervisors[0].supervisor.user_uuid, 'user-uuid-supervisor');

  const supervisors = await registry.execute(
    'user_list_current_user_supervisors',
    { supervisor_type: 'Primary' },
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'jordan@example.org',
        },
      },
    },
  );
  assert.equal(supervisors.data[0].supervisor.user_uuid, 'user-uuid-supervisor');

  const supervisorUrl = new URL(calls[3].url);
  assert.equal(supervisorUrl.pathname, '/api/v1/users/user-uuid-1/supervisors');
  assert.equal(supervisorUrl.searchParams.get('supervisor_type'), 'Primary');
});

test('user_get_current fails when the request-scoped email header is missing', async () => {
  const { registry } = createRegistry([]);

  await assert.rejects(
    () => registry.execute('user_get_current', {}),
    (error) => {
      assert.equal(error.errorCode, 'missing_user_context');
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test('matter_list_current_user filters matters by current user assignment and forwards search filters', async () => {
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([sampleUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([sampleMatter, sampleOtherMatter], 1, 25, 1, 2)),
  ]);

  const payload = await registry.execute(
    'matter_list_current_user',
    { assignment_type: 'Primary', current_only: true },
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'jordan@example.org',
        },
      },
    },
  );

  assert.deepEqual(payload.data.map((item) => item.case_uuid), ['matter-uuid-current']);
  assert.equal(payload.data[0].matching_assignments[0].assignment_uuid, 'assignment-uuid-1');

  const matterUrl = new URL(calls[1].url);
  assert.equal(matterUrl.searchParams.get('results'), 'full');
  assert.equal(matterUrl.searchParams.get('assignments:type'), 'Primary');
});

test('matter_list_current_user fails when matter search omits assignments', async () => {
  const { registry } = createRegistry([
    jsonResponse(200, makePaginated([sampleUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([{
      matter_uuid: 'matter-uuid-without-assignments',
      case_id: 603,
      case_number: '26-0003',
      client_full_name: 'Missing Assignments',
    }], 1, 25, 1, 1)),
  ]);

  await assert.rejects(
    () => registry.execute(
      'matter_list_current_user',
      {},
      {
        requestInfo: {
          headers: {
            'x-legalserver-user-email': 'jordan@example.org',
          },
        },
      },
    ),
    (error) => {
      assert.equal(error.errorCode, 'assignment_visibility_unavailable');
      assert.equal(error.status, 412);
      return true;
    },
  );
});

test('matter_list_current_user reuses cached scan results for identical filters across pages', async () => {
  const cacheUser = {
    ...sampleUser,
    email: 'cache-jordan@example.org',
  };
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([cacheUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([sampleMatter], 1, 25, 1, 1)),
  ]);

  const requestContext = {
    requestInfo: {
      headers: {
        'x-legalserver-user-email': 'cache-jordan@example.org',
      },
    },
  };

  await registry.execute('matter_list_current_user', { assignment_type: 'Primary', page_size: 1 }, requestContext);
  await registry.execute('matter_list_current_user', { assignment_type: 'Primary', page: 1, page_size: 10 }, requestContext);

  assert.equal(calls.length, 2);
});

test('matter_list_current_user disables scan result caching when TTL is zero', async () => {
  const noCacheUser = {
    ...sampleUser,
    email: 'nocache-jordan@example.org',
  };
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([noCacheUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([sampleMatter], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([noCacheUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([sampleMatter], 1, 25, 1, 1)),
  ], {
    config: {
      matterCurrentUserCacheTtlMs: 0,
    },
  });

  const requestContext = {
    requestInfo: {
      headers: {
        'x-legalserver-user-email': 'nocache-jordan@example.org',
      },
    },
  };

  await registry.execute('matter_list_current_user', {}, requestContext);
  await registry.execute('matter_list_current_user', {}, requestContext);

  assert.equal(calls.length, 4);
});

test('matter_list_current_user shares an in-flight scan across concurrent identical requests', async () => {
  const inFlightUser = {
    ...sampleUser,
    email: 'inflight-jordan@example.org',
  };
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([inFlightUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([sampleMatter], 1, 25, 1, 1)),
  ]);

  const requestContext = {
    requestInfo: {
      headers: {
        'x-legalserver-user-email': 'inflight-jordan@example.org',
      },
    },
  };

  const [first, second] = await Promise.all([
    registry.execute('matter_list_current_user', { page_size: 1 }, requestContext),
    registry.execute('matter_list_current_user', { page_size: 1 }, requestContext),
  ]);

  assert.deepEqual(first.data, second.data);
  assert.equal(calls.length, 2);
});

test('matter_list_current_user preserves page ordering while fetching matter pages concurrently', async () => {
  const orderedUser = {
    ...sampleUser,
    email: 'ordered-jordan@example.org',
  };
  const calls = [];
  let activeMatterFetches = 0;
  let maxActiveMatterFetches = 0;
  const matterPages = new Map([
    [1, makePaginated([sampleMatter], 1, 25, 3, 3)],
    [2, makePaginated([{
      ...sampleMatter,
      matter_uuid: 'matter-uuid-page-2',
      case_id: 604,
      case_number: '26-0004',
    }], 2, 25, 3, 3)],
    [3, makePaginated([{
      ...sampleMatter,
      matter_uuid: 'matter-uuid-page-3',
      case_id: 605,
      case_number: '26-0005',
    }], 3, 25, 3, 3)],
  ]);

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/users') {
      return jsonResponse(200, makePaginated([orderedUser], 1, 25, 1, 1));
    }

    const page = Number(parsed.searchParams.get('page_number'));
    const delayMs = page === 2 ? 30 : page === 3 ? 5 : 0;
    if (page > 1) {
      activeMatterFetches += 1;
      maxActiveMatterFetches = Math.max(maxActiveMatterFetches, activeMatterFetches);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (page > 1) {
      activeMatterFetches -= 1;
    }

    return jsonResponse(200, matterPages.get(page));
  };

  const { registry } = createRegistry([], {
    config: {
      matterCurrentUserFetchConcurrency: 2,
    },
    fetchImpl,
  });

  const payload = await registry.execute(
    'matter_list_current_user',
    {},
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'ordered-jordan@example.org',
        },
      },
    },
  );

  assert.deepEqual(payload.data.map((item) => item.case_uuid), [
    'matter-uuid-current',
    'matter-uuid-page-2',
    'matter-uuid-page-3',
  ]);
  assert.equal(maxActiveMatterFetches, 2);
});

test('matter_list_current_user_active prefers one combined active-disposition query and sorts results deterministically', async () => {
  const activeUser = {
    ...sampleUser,
    email: 'active-jordan@example.org',
  };
  const openMatter = {
    ...sampleMatter,
    matter_uuid: 'matter-uuid-open',
    case_id: 606,
    case_number: '26-0006',
    date_opened: '2026-01-15',
    case_disposition: 'Open',
  };
  const pendingMatter = {
    ...sampleMatter,
    matter_uuid: 'matter-uuid-pending',
    case_id: 607,
    case_number: '26-0007',
    date_opened: '2026-03-01',
    case_disposition: 'Pending',
  };
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([activeUser], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([openMatter, pendingMatter], 1, 25, 1, 2)),
  ]);

  const payload = await registry.execute(
    'matter_list_current_user_active',
    {},
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'active-jordan@example.org',
        },
      },
    },
  );

  assert.deepEqual(payload.data.map((item) => item.case_uuid), [
    'matter-uuid-pending',
    'matter-uuid-open',
  ]);
  assert.equal(
    new URL(calls[1].url).searchParams.get('case_disposition'),
    'Open,Pending,Incomplete Intake,Prescreen',
  );
});

test('matter_list_current_user_active falls back to per-disposition scans when a tenant rejects the combined filter', async () => {
  const activeUser = {
    ...sampleUser,
    email: 'active-fallback@example.org',
  };
  const { registry, calls } = createRegistry([
    jsonResponse(200, makePaginated([activeUser], 1, 25, 1, 1)),
    jsonResponse(400, { invalid_search_keys: ['case_disposition'] }),
    jsonResponse(200, makePaginated([sampleMatter], 1, 25, 1, 1)),
    jsonResponse(200, makePaginated([], 1, 25, 0, 0)),
    jsonResponse(200, makePaginated([], 1, 25, 0, 0)),
    jsonResponse(200, makePaginated([], 1, 25, 0, 0)),
  ]);

  const payload = await registry.execute(
    'matter_list_current_user_active',
    {},
    {
      requestInfo: {
        headers: {
          'x-legalserver-user-email': 'active-fallback@example.org',
        },
      },
    },
  );

  assert.deepEqual(payload.data.map((item) => item.case_uuid), ['matter-uuid-current']);
  assert.deepEqual(
    calls.slice(1).map((call) => new URL(call.url).searchParams.get('case_disposition')),
    [
      'Open,Pending,Incomplete Intake,Prescreen',
      'Open',
      'Pending',
      'Incomplete Intake',
      'Prescreen',
    ],
  );
});

test('organization_search previews descriptions and organization_get truncates very large detail text', async () => {
  const { registry } = createRegistry([
    jsonResponse(200, makePaginated([sampleOrganization])),
    jsonResponse(200, {
      data: {
        ...sampleOrganization,
        description: 'B'.repeat(7001),
      },
    }),
    jsonResponse(200, makePaginated([sampleOrganization])),
  ]);

  const search = await registry.execute('organization_search', {
    name: 'Legal Aid Partners',
  });
  assert.equal(search.data[0].description_preview.length, 300);
  assert.equal(search.data[0].description_truncated, true);

  const detail = await registry.execute('organization_get', {
    organization_uuid: 'org-uuid-1',
  });
  assert.equal(detail.truncated, true);
  assert.equal(detail.data.description.length, 6000);
  assert.equal(detail.data.parent_organization.organization_uuid, 'org-parent-1');

  const lookup = await registry.execute('organization_lookup_by_name', {
    name: '  Legal   Aid  Partners ',
  });
  assert.equal(lookup.data.organization_uuid, 'org-uuid-1');
});

test('phase 3 exact-match lookups raise multiple_matches with status 409', async () => {
  const { registry } = createRegistry([
    jsonResponse(200, makePaginated([sampleContact], 1, 25, 2, 2)),
    jsonResponse(200, makePaginated([{
      ...sampleContact,
      id: 304,
      uuid: 'contact-uuid-2',
    }], 2, 25, 2, 2)),
  ]);

  await assert.rejects(
    () => registry.execute('contact_lookup_by_email', {
      email: 'taylor@example.org',
    }),
    (error) => {
      assert.equal(error.errorCode, 'multiple_matches');
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test('phase 3 tools propagate representative upstream errors for each new domain', async () => {
  const taskRegistry = createRegistry([jsonResponse(401, { message: 'Unauthorized' })]).registry;
  await assert.rejects(() => taskRegistry.execute('task_search', {}), (error) => error.status === 401);

  const eventRegistry = createRegistry([jsonResponse(403, { message: 'Forbidden' })]).registry;
  await assert.rejects(() => eventRegistry.execute('event_get', { event_uuid: 'event-uuid-1' }), (error) => error.status === 403);

  const contactRegistry = createRegistry([jsonResponse(404, { message: 'Missing' })]).registry;
  await assert.rejects(() => contactRegistry.execute('contact_get', { contact_uuid: 'contact-uuid-1' }), (error) => error.status === 404);

  const userRegistry = createRegistry([jsonResponse(429, { message: 'Slow down' })]).registry;
  await assert.rejects(() => userRegistry.execute('user_search', {}), (error) => error.status === 429);

  const organizationRegistry = createRegistry([jsonResponse(503, { message: 'Unavailable' })]).registry;
  await assert.rejects(() => organizationRegistry.execute('organization_get', { organization_uuid: 'org-uuid-1' }), (error) => error.status === 503);
});
