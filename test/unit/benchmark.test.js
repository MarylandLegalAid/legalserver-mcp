const test = require('node:test');
const assert = require('node:assert/strict');
const { jsonResponse } = require('../support/mockFetch');
const { createBenchmarkTelemetry } = require('../../src/apps/legalserver/benchmark/telemetry');
const { buildRunResult, summarizeScenarioRuns, buildMarkdownReport } = require('../../src/apps/legalserver/benchmark/summary');
const { buildBenchmarkScenarios } = require('../../src/apps/legalserver/benchmark/scenarios');

test('benchmark telemetry records upstream requests with page and document metrics', async () => {
  const telemetry = createBenchmarkTelemetry(async (url) => jsonResponse(200, {
    ok: true,
    echo: url,
  }));

  telemetry.startRun({ tool_name: 'example_tool' });
  await telemetry.fetchImpl('https://example.legalserver.org/api/v1/tasks?page_number=2&page_size=25');
  await telemetry.fetchImpl('https://example.legalserver.org/modules/document/download.php?id=501');
  const snapshot = telemetry.finishRun();

  assert.equal(snapshot.request_count, 2);
  assert.equal(snapshot.requests[0].pathname, '/api/v1/tasks');
  assert.equal(snapshot.requests[0].query.page_number, '2');
  assert.equal(snapshot.requests[1].pathname, '/modules/document/download.php');
  assert.ok(snapshot.total_ms >= 0);
});

test('scenario summaries flag strong report candidates for scan-heavy current-user tools', () => {
  const runs = [
    {
      tool_name: 'task_list_current_user_between_dates',
      scenario_id: 'task_list_current_user_between_dates',
      scenario_label: 'current user tasks in range',
      cold_or_warm: 'n/a',
      result_ok: true,
      error_code: null,
      warnings: ['Task scans stopped after 20 upstream pages for 2026-03-11.'],
      truncated: true,
      end_to_end_ms: 2400,
      ls_request_count: 15,
      ls_total_ms: 2200,
      ls_max_ms: 180,
      source_pages_scanned: 14,
      documents_scanned: 0,
      rows_returned: 3,
    },
    {
      tool_name: 'task_list_current_user_between_dates',
      scenario_id: 'task_list_current_user_between_dates',
      scenario_label: 'current user tasks in range',
      cold_or_warm: 'n/a',
      result_ok: true,
      error_code: null,
      warnings: [],
      truncated: false,
      end_to_end_ms: 2100,
      ls_request_count: 12,
      ls_total_ms: 1900,
      ls_max_ms: 175,
      source_pages_scanned: 12,
      documents_scanned: 0,
      rows_returned: 4,
    },
  ];

  const summary = summarizeScenarioRuns(runs);

  assert.equal(summary.report_recommendation.label, 'strong_report_candidate');
  assert.equal(summary.max_source_pages_scanned, 14);
  assert.equal(summary.median_ls_request_count, 13.5);
});

test('scenario summaries keep document-text tools out of report-candidate recommendations', () => {
  const summary = summarizeScenarioRuns([{
    tool_name: 'document_search_text',
    scenario_id: 'document_search_text_warm',
    scenario_label: 'document text search (warm cache)',
    cold_or_warm: 'warm',
    result_ok: true,
    error_code: null,
    warnings: [],
    truncated: false,
    end_to_end_ms: 900,
    ls_request_count: 1,
    ls_total_ms: 80,
    ls_max_ms: 80,
    source_pages_scanned: 0,
    documents_scanned: 0,
    rows_returned: 2,
  }]);

  assert.equal(summary.report_recommendation.label, 'not_report_friendly');
});

test('markdown benchmark report renders candidate summaries and sanitized notes', () => {
  const markdown = buildMarkdownReport({
    generatedAt: '2026-03-15T12:00:00.000Z',
    baseUrl: 'https://example.legalserver.org/',
    rawResultsPath: '/tmp/results.json',
    discoveryWarnings: ['No current-user matter assignment email was discovered.'],
    summaries: [{
      tool_name: 'matter_list_current_user',
      scenario_label: 'current user assigned matters',
      sample_count: 3,
      median_end_to_end_ms: 1700,
      max_end_to_end_ms: 2200,
      median_ls_request_count: 8,
      max_source_pages_scanned: 8,
      max_documents_scanned: 0,
      median_rows_returned: 5,
      warnings: ['The scan stopped after 10 upstream matter pages.'],
      error_codes: [],
      report_recommendation: {
        label: 'strong_report_candidate',
        reason: 'Row-oriented workflow currently requires multiple upstream requests or local scanning.',
      },
    }],
  });

  assert.match(markdown, /Strong report candidates/);
  assert.match(markdown, /matter_list_current_user/);
  assert.match(markdown, /No current-user matter assignment email was discovered/);
  assert.doesNotMatch(markdown, /document_uuid/);
});

test('benchmark scenarios include the full canonical tool surface plus optional scanned manifest variants', () => {
  const fixtures = {
    matters: {
      lookup: { case_uuid: 'matter-1', case_number: '24-0001' },
      notes: { case_uuid: 'matter-1', note_uuid: 'note-1' },
      documents: {
        case_uuid: 'matter-1',
        searchable: {
          case_uuid: 'matter-1',
          document_uuid: 'doc-1',
          document_id: 501,
          search_query: 'lease',
        },
        scanned: {
          case_uuid: 'matter-1',
          document_uuid: 'doc-2',
          document_id: 502,
        },
      },
      assignments: { case_uuid: 'matter-1' },
      adverse_parties: { case_uuid: 'matter-1' },
      non_adverse_parties: { case_uuid: 'matter-1' },
      contacts: { case_uuid: 'matter-1' },
      related_matters: { case_uuid: 'matter-1' },
      services: { case_uuid: 'matter-1' },
      incomes: { case_uuid: 'matter-1' },
      litigations: { case_uuid: 'matter-1' },
    },
    tasks: { id: 1, task_uuid: 'task-1', date: '2026-03-12' },
    events: { event_uuid: 'event-1', date: '2026-03-12', title: 'Calendar event', external_id: 'ext-1' },
    contacts: { contact_uuid: 'contact-1', email: 'contact@example.org' },
    users: { user_uuid: 'user-1', login: 'jstaff', email: 'jstaff@example.org' },
    organizations: { organization_uuid: 'org-1', name: 'Legal Aid Org' },
    current_user: {
      profile: { email: 'profile@example.org' },
      tasks: { email: 'tasks@example.org', date: '2026-03-12', range_start_date: '2026-03-06', range_end_date: '2026-03-12' },
      events: { email: 'events@example.org', date: '2026-03-12', range_start_date: '2026-03-06', range_end_date: '2026-03-12' },
      matters: { email: 'matters@example.org' },
    },
  };
  const scenarios = buildBenchmarkScenarios(fixtures, {
    sharedSecret: 'secret',
    sharedSecretHeader: 'x-secret',
    userEmailHeader: 'x-legalserver-user-email',
  });
  const scenarioIds = scenarios.map((scenario) => scenario.id);

  assert.ok(scenarioIds.includes('matter_lookup_by_case_number'));
  assert.ok(scenarioIds.includes('task_list_current_user_between_dates'));
  assert.ok(scenarioIds.includes('document_get_text_manifest_scanned_cold'));
  assert.ok(scenarioIds.includes('organization_lookup_by_name'));
  assert.equal(new Set(scenarioIds).size, scenarioIds.length);
});
