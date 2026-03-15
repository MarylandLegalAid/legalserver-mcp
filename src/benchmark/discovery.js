const { createDocumentTextPipeline } = require('../documentText');
const { createOcrProvider } = require('../documentText/ocrProviders');
const helpers = require('../helpers');
const { LegalServerClient } = require('../legalserverClient');
const { createToolRegistry } = require('../toolRegistry');
const { mapDocumentRecord } = require('../tools/shared/documentRecords');

const DEFAULT_PAGE_SIZE = 25;
const MATTER_DISCOVERY_MAX_PAGES = 8;
const USER_DISCOVERY_MAX_PAGES = 4;
const TASK_DISCOVERY_MAX_PAGES = 4;
const EVENT_DISCOVERY_MAX_PAGES = 4;
const STOP_WORDS = new Set(['about', 'after', 'again', 'before', 'client', 'court', 'email', 'legal', 'matter', 'other', 'shall', 'their', 'there', 'these', 'those', 'which']);

function createDiscoveryRuntime(config) {
  const client = new LegalServerClient({
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    timeoutMs: config.timeoutMs,
    fetchImpl: global.fetch,
  });
  const registry = createToolRegistry({
    client,
    config,
    helpers,
    documentTextPipeline: createDocumentTextPipeline({
      client,
      config,
      ocrProvider: createOcrProvider(config),
    }),
  });

  return {
    client,
    config,
    registry,
  };
}

async function discoverFixtures(config) {
  const runtime = createDiscoveryRuntime(config);
  const matterRecords = await collectMatterCandidates(runtime.client);
  const userFixtures = await discoverUserFixtures(runtime.client, config);
  const currentUserFixtures = await discoverCurrentUserFixtures(runtime, matterRecords, userFixtures);
  const matterFixtures = await discoverMatterFixtures(runtime, matterRecords);
  const contactFixture = await discoverContactFixture(runtime.client);
  const organizationFixture = await discoverOrganizationFixture(runtime.client);

  return {
    schema_version: 1,
    discovered_at: new Date().toISOString(),
    base_url: config.baseUrl,
    user_email_header: config.userEmailHeader,
    discovery_warnings: [
      ...userFixtures.discovery_warnings,
      ...currentUserFixtures.discovery_warnings,
      ...matterFixtures.discovery_warnings,
      ...contactFixture.discovery_warnings,
      ...organizationFixture.discovery_warnings,
    ],
    matters: matterFixtures.fixtures,
    tasks: currentUserFixtures.fixtures.tasks,
    events: currentUserFixtures.fixtures.events,
    contacts: contactFixture.fixture,
    users: userFixtures.fixture,
    organizations: organizationFixture.fixture,
    current_user: {
      profile: currentUserFixtures.fixtures.profile,
      tasks: currentUserFixtures.fixtures.current_user_tasks,
      events: currentUserFixtures.fixtures.current_user_events,
      matters: currentUserFixtures.fixtures.current_user_matters,
    },
  };
}

async function collectMatterCandidates(client) {
  const matters = [];

  for (let page = 1; page <= MATTER_DISCOVERY_MAX_PAGES; page += 1) {
    const response = await client.getJson('/api/v1/matters', {
      query: {
        results: 'full',
        page_number: page,
        page_size: DEFAULT_PAGE_SIZE,
      },
    });
    const records = Array.isArray(response.data) ? response.data : [];
    matters.push(...records);

    if (!response.totalPages || page >= response.totalPages) {
      break;
    }
  }

  if (matters.length === 0) {
    throw new Error('Fixture discovery could not find any matters through /api/v1/matters.');
  }

  return matters;
}

async function discoverUserFixtures(client) {
  const discoveryWarnings = [];
  let fallbackUser = null;

  for (let page = 1; page <= USER_DISCOVERY_MAX_PAGES; page += 1) {
    const response = await client.getJson('/api/v1/users', {
      query: {
        page_number: page,
        page_size: DEFAULT_PAGE_SIZE,
        active: true,
      },
    });
    const records = Array.isArray(response.data) ? response.data : [];

    for (const record of records) {
      if (!record.user_uuid || !record.login || !record.email) {
        continue;
      }

      if (!fallbackUser) {
        fallbackUser = {
          user_uuid: record.user_uuid,
          login: record.login,
          email: record.email,
        };
      }

      const supervisors = await client.getJson('/api/v1/users/{user_uuid}/supervisors', {
        pathParams: {
          user_uuid: record.user_uuid,
        },
        query: {
          page_number: 1,
          page_size: 1,
        },
      }).catch(() => null);

      if (Array.isArray(supervisors?.data) && supervisors.data.length > 0) {
        return {
          fixture: {
            user_uuid: record.user_uuid,
            login: record.login,
            email: record.email,
          },
          discovery_warnings: [],
        };
      }
    }

    if (!response.totalPages || page >= response.totalPages) {
      break;
    }
  }

  if (!fallbackUser) {
    throw new Error('Fixture discovery could not find any active user with email and login.');
  }

  discoveryWarnings.push('No user with supervisors was discovered; current-user supervisor benchmarks may return empty results.');
  return {
    fixture: fallbackUser,
    discovery_warnings: discoveryWarnings,
  };
}

async function discoverCurrentUserFixtures(runtime, matterRecords, userFixtures) {
  const discoveryWarnings = [];
  const taskFixture = await discoverTaskFixture(runtime.client, runtime.config.userEmailHeader);
  const eventFixture = await discoverEventFixture(runtime.client, runtime.config.userEmailHeader);
  const matterFixture = await discoverCurrentUserMatterFixture(runtime.client, matterRecords, runtime.config.userEmailHeader, userFixtures.fixture.email);

  if (!taskFixture.fixture.current_user_tasks.email) {
    discoveryWarnings.push('No current-user task email was discovered; task current-user benchmarks will reuse the generic user fixture.');
    taskFixture.fixture.current_user_tasks.email = userFixtures.fixture.email;
  }

  if (!eventFixture.fixture.current_user_events.email) {
    discoveryWarnings.push('No current-user event email was discovered; event current-user benchmarks will reuse the generic user fixture.');
    eventFixture.fixture.current_user_events.email = userFixtures.fixture.email;
  }

  if (!matterFixture.fixture.current_user_matters.email) {
    discoveryWarnings.push('No current-user matter assignment email was discovered; matter current-user benchmarks will reuse the generic user fixture.');
    matterFixture.fixture.current_user_matters.email = userFixtures.fixture.email;
  }

  return {
    fixtures: {
      tasks: taskFixture.fixture.tasks,
      events: eventFixture.fixture.events,
      profile: { email: userFixtures.fixture.email },
      current_user_tasks: taskFixture.fixture.current_user_tasks,
      current_user_events: eventFixture.fixture.current_user_events,
      current_user_matters: matterFixture.fixture.current_user_matters,
    },
    discovery_warnings: [
      ...taskFixture.discovery_warnings,
      ...eventFixture.discovery_warnings,
      ...matterFixture.discovery_warnings,
      ...discoveryWarnings,
    ],
  };
}

async function discoverTaskFixture(client) {
  const discoveryWarnings = [];
  let fallbackTask = null;

  for (let page = 1; page <= TASK_DISCOVERY_MAX_PAGES; page += 1) {
    const response = await client.getJson('/api/v1/tasks', {
      query: {
        page_number: page,
        page_size: DEFAULT_PAGE_SIZE,
        completed: false,
      },
    });
    const records = Array.isArray(response.data) ? response.data : [];

    for (const record of records) {
      if (!record.task_uuid || !record.id || !record.list_date) {
        continue;
      }

      const email = await resolveUserEmailFromCollection(client, record.users);
      const range = buildRecentRange(record.list_date);
      const baseFixture = {
        tasks: {
          id: record.id,
          task_uuid: record.task_uuid,
          date: normalizeDateValue(record.list_date),
        },
        current_user_tasks: {
          email,
          date: normalizeDateValue(record.list_date),
          range_start_date: range.start_date,
          range_end_date: range.end_date,
        },
      };

      if (!fallbackTask) {
        fallbackTask = baseFixture;
      }

      if (email) {
        return {
          fixture: baseFixture,
          discovery_warnings: [],
        };
      }
    }

    if (!response.totalPages || page >= response.totalPages) {
      break;
    }
  }

  if (!fallbackTask) {
    throw new Error('Fixture discovery could not find a benchmarkable task.');
  }

  discoveryWarnings.push('No task with a resolvable assigned-user email was found; current-user task benchmarks will fall back to the generic user fixture.');
  return {
    fixture: fallbackTask,
    discovery_warnings: discoveryWarnings,
  };
}

async function discoverEventFixture(client) {
  const discoveryWarnings = [];
  let fallbackEvent = null;

  for (let page = 1; page <= EVENT_DISCOVERY_MAX_PAGES; page += 1) {
    const response = await client.getJson('/api/v1/events', {
      query: {
        page_number: page,
        page_size: DEFAULT_PAGE_SIZE,
      },
    });
    const records = Array.isArray(response.data) ? response.data : [];

    for (const record of records) {
      const eventUuid = record.event_uuid;
      const eventDate = normalizeDateValue(record.start_datetime);
      if (!eventUuid || !eventDate) {
        continue;
      }

      const email = await resolveUserEmailFromCollection(client, record.attendees);
      const range = buildRecentRange(eventDate);
      const baseFixture = {
        events: {
          event_uuid: eventUuid,
          date: eventDate,
          title: record.title || 'Event',
          external_id: record.external_id || null,
        },
        current_user_events: {
          email,
          date: eventDate,
          range_start_date: range.start_date,
          range_end_date: range.end_date,
        },
      };

      if (!fallbackEvent) {
        fallbackEvent = baseFixture;
      }

      if (email) {
        return {
          fixture: baseFixture,
          discovery_warnings: [],
        };
      }
    }

    if (!response.totalPages || page >= response.totalPages) {
      break;
    }
  }

  if (!fallbackEvent) {
    throw new Error('Fixture discovery could not find a benchmarkable event.');
  }

  discoveryWarnings.push('No event with a resolvable attendee email was found; current-user event benchmarks will fall back to the generic user fixture.');
  return {
    fixture: fallbackEvent,
    discovery_warnings: discoveryWarnings,
  };
}

async function discoverCurrentUserMatterFixture(client, matterRecords, _headerName, fallbackEmail) {
  const discoveryWarnings = [];

  for (const matter of matterRecords) {
    const assignments = Array.isArray(matter.assignments) ? matter.assignments : [];
    for (const assignment of assignments) {
      const email = await resolveUserEmailFromRef(client, assignment.user);
      if (!email) {
        continue;
      }

      return {
        fixture: {
          current_user_matters: {
            email,
          },
        },
        discovery_warnings: [],
      };
    }
  }

  discoveryWarnings.push('Matter search results did not expose a resolvable assignment user; current-user matter benchmarks may return empty results or a 412 visibility error.');
  return {
    fixture: {
      current_user_matters: {
        email: fallbackEmail || null,
      },
    },
    discovery_warnings: discoveryWarnings,
  };
}

async function discoverMatterFixtures(runtime, matterRecords) {
  const discoveryWarnings = [];
  const lookupMatter = matterRecords.find((record) => record.case_number && getCaseUuid(record));

  if (!lookupMatter) {
    throw new Error('Fixture discovery could not find a matter with both case UUID and case number.');
  }

  const fallbackCaseFixture = {
    case_uuid: getCaseUuid(lookupMatter),
  };

  const fixtures = {
    lookup: {
      case_uuid: getCaseUuid(lookupMatter),
      case_number: lookupMatter.case_number,
    },
    notes: await discoverMatterSubresourceFixture(runtime.client, matterRecords, 'notes', {
      pathTemplate: '/api/v1/matters/{case_UUID}/notes',
      getFixture: (caseUuid, response) => {
        const note = Array.isArray(response.data) ? response.data[0] : null;
        return note ? { case_uuid: caseUuid, note_uuid: note.casenote_uuid || note.uuid } : null;
      },
    }, discoveryWarnings, lookupMatter),
    documents: await discoverDocumentFixture(runtime, matterRecords, discoveryWarnings, lookupMatter),
    assignments: fallbackCaseFixture,
    adverse_parties: fallbackCaseFixture,
    non_adverse_parties: fallbackCaseFixture,
    contacts: fallbackCaseFixture,
    related_matters: fallbackCaseFixture,
    services: fallbackCaseFixture,
    incomes: fallbackCaseFixture,
    litigations: fallbackCaseFixture,
  };

  discoveryWarnings.push('Matter child-list fixtures use a stable fallback matter for production benchmarking; some list tools may return empty results if that matter has no rows for the child endpoint.');

  return {
    fixtures,
    discovery_warnings: discoveryWarnings,
  };
}

async function discoverDocumentFixture(runtime, matterRecords, discoveryWarnings, fallbackMatter) {
  let fallback = null;

  for (const matter of matterRecords) {
    const caseUuid = getCaseUuid(matter);
    if (!caseUuid) {
      continue;
    }

    const response = await runtime.client.getJson('/api/v1/matters/{case_UUID}/documents', {
      pathParams: {
        case_UUID: caseUuid,
      },
    });
    const documents = Array.isArray(response.data) ? response.data : [];
    if (documents.length === 0) {
      continue;
    }

    if (!fallback) {
      fallback = {
        case_uuid: caseUuid,
        searchable: {
          ...buildDocumentFixture(caseUuid, documents[0], 'document'),
          search_query: 'document',
        },
        scanned: null,
      };
    }

    const fixture = await extractDocumentSearchFixture(runtime.registry, caseUuid, documents);
    if (fixture) {
      return fixture;
    }
  }

  if (!fallback) {
    throw new Error('Fixture discovery could not find any matter documents.');
  }

  discoveryWarnings.push('No searchable document text fixture was discovered; document text benchmarks may fail until a text-bearing document is available.');
  return {
    case_uuid: fallbackMatter ? getCaseUuid(fallbackMatter) : fallback.case_uuid,
    searchable: fallback.searchable,
    scanned: null,
  };
}

async function extractDocumentSearchFixture(registry, caseUuid, documents) {
  let searchable = null;
  let scanned = null;

  for (const record of documents) {
    const mapped = mapDocumentRecord(record);
    const fixture = buildDocumentFixture(caseUuid, record, mapped.text_strategy || 'document');

    if (!scanned && mapped.text_strategy === 'ocr') {
      scanned = fixture;
    }

    if (searchable) {
      continue;
    }

    try {
      const manifest = await registry.execute('document_get_text_manifest', {
        case_uuid: caseUuid,
        document_uuid: fixture.document_uuid,
      });
      if (!manifest.ok || !manifest.data?.total_text_chars) {
        continue;
      }

      const chunk = await registry.execute('document_get_text_chunk', {
        case_uuid: caseUuid,
        document_uuid: fixture.document_uuid,
        chunk_index: 0,
      });
      const query = pickSearchQuery(chunk.data?.text || '');
      if (!query) {
        continue;
      }

      searchable = {
        ...fixture,
        search_query: query,
      };
    } catch (error) {
      continue;
    }
  }

  if (!searchable) {
    return null;
  }

  return {
    case_uuid: caseUuid,
    searchable,
    scanned,
  };
}

async function discoverContactFixture(client) {
  const response = await client.getJson('/api/v1/contacts', {
    query: {
      results: 'full',
      page_number: 1,
      page_size: DEFAULT_PAGE_SIZE,
    },
  });
  const records = Array.isArray(response.data) ? response.data : [];
  const contact = records.find((record) => record.uuid && record.email);

  if (!contact) {
    throw new Error('Fixture discovery could not find a contact with both UUID and email.');
  }

  return {
    fixture: {
      contact_uuid: contact.uuid,
      email: contact.email,
    },
    discovery_warnings: [],
  };
}

async function discoverOrganizationFixture(client) {
  const response = await client.getJson('/api/v1/organizations', {
    query: {
      page_number: 1,
      page_size: DEFAULT_PAGE_SIZE,
    },
  });
  const records = Array.isArray(response.data) ? response.data : [];
  const organization = records.find((record) => record.uuid && record.name);

  if (!organization) {
    throw new Error('Fixture discovery could not find an organization with both UUID and name.');
  }

  return {
    fixture: {
      organization_uuid: organization.uuid,
      name: organization.name,
    },
    discovery_warnings: [],
  };
}

async function discoverMatterSubresourceFixture(client, matterRecords, label, options, discoveryWarnings, fallbackMatter) {
  const query = options.query === null
    ? undefined
    : {
        page_number: 1,
        page_size: 1,
      };

  for (const matter of matterRecords) {
    const caseUuid = getCaseUuid(matter);
    if (!caseUuid) {
      continue;
    }

    const response = await client.getJson(options.pathTemplate, {
      pathParams: {
        case_UUID: caseUuid,
      },
      query,
    }).catch((error) => {
      if (error?.status === 403 || error?.status === 404) {
        return null;
      }

      throw error;
    });
    if (!response) {
      continue;
    }
    const fixture = options.getFixture(caseUuid, response);
    if (fixture) {
      return fixture;
    }
  }

  discoveryWarnings.push(`No non-empty matter ${label} fixture was found in the scanned matter window; the benchmark will use the fallback matter and may observe empty results.`);
  return {
    case_uuid: getCaseUuid(fallbackMatter),
  };
}

async function resolveUserEmailFromCollection(client, collection) {
  const values = helpers.normalizeArrayValue(collection);

  for (const item of values) {
    const email = await resolveUserEmailFromRef(client, item);
    if (email) {
      return email;
    }
  }

  return null;
}

async function resolveUserEmailFromRef(client, ref) {
  if (!ref || typeof ref !== 'object') {
    return null;
  }

  if (ref.user_uuid) {
    const response = await client.getJson('/api/v1/users/{user_uuid}', {
      pathParams: {
        user_uuid: ref.user_uuid,
      },
    }).catch(() => null);
    return response?.data?.email || null;
  }

  if (ref.user_id || ref.id) {
    const response = await client.getJson('/api/v1/users', {
      query: {
        id: ref.user_id || ref.id,
        page_number: 1,
        page_size: 1,
      },
    }).catch(() => null);
    const record = Array.isArray(response?.data) ? response.data[0] : null;
    return record?.email || null;
  }

  return null;
}

function pickSearchQuery(text) {
  const words = String(text || '')
    .toLowerCase()
    .match(/[a-z][a-z'-]{4,}/g) || [];

  return words.find((word) => !STOP_WORDS.has(word)) || null;
}

function buildDocumentFixture(caseUuid, record, kind) {
  return {
    case_uuid: caseUuid,
    document_uuid: record.guid || record.uuid || null,
    document_id: record.internal_id || record.id || null,
    fixture_kind: kind,
  };
}

function buildCaseFixture(caseUuid, response) {
  const records = Array.isArray(response.data) ? response.data : [];
  return records.length > 0 ? { case_uuid: caseUuid } : null;
}

function buildRecentRange(endDate) {
  const end = new Date(`${normalizeDateValue(endDate)}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);

  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

function normalizeDateValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function getCaseUuid(record) {
  return record.matter_uuid || record.case_uuid || record.uuid || null;
}

module.exports = {
  createDiscoveryRuntime,
  discoverFixtures,
  pickSearchQuery,
};
