const { countDocumentDownloads, countPageRequests } = require('./telemetry');

const REPORT_FRIENDLY_STRONG_TOOLS = new Set([
  'task_list_current_user_on_date',
  'task_list_current_user_between_dates',
  'event_list_current_user_on_date',
  'event_list_current_user_between_dates',
  'matter_list_current_user',
  'matter_list_current_user_active',
  'event_list_by_date',
  'event_search',
  'contact_lookup_by_email',
  'user_lookup_by_login',
  'organization_lookup_by_name',
]);

const NON_REPORT_FRIENDLY_TOOLS = new Set([
  'document_get_metadata',
  'document_get_text_manifest',
  'document_get_text_chunk',
  'document_search_text',
  'matter_search_document_text',
]);

function buildRunResult({ scenario, payload, telemetry, endToEndMs }) {
  return {
    tool_name: scenario.toolName,
    scenario_id: scenario.id,
    scenario_label: scenario.label,
    samples_expected: scenario.sampleCount,
    result_ok: payload?.ok === true,
    error_code: payload?.ok === false ? payload.error_code || 'unknown_error' : null,
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
    truncated: Boolean(payload?.truncated),
    cold_or_warm: scenario.coldOrWarm || 'n/a',
    end_to_end_ms: round(endToEndMs),
    ls_request_count: telemetry.request_count,
    ls_total_ms: telemetry.total_ms,
    ls_max_ms: telemetry.max_ms,
    source_pages_scanned: countPageRequests(telemetry.requests),
    documents_scanned: countDocumentDownloads(telemetry.requests),
    rows_returned: extractRowsReturned(payload),
    requests: telemetry.requests,
  };
}

function summarizeScenarioRuns(runs) {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error('Benchmark summaries require at least one run.');
  }

  const sampleCount = runs.length;
  const successfulRuns = runs.filter((run) => run.result_ok);
  const errorCodes = [...new Set(runs.map((run) => run.error_code).filter(Boolean))];
  const warnings = [...new Set(runs.flatMap((run) => run.warnings || []))];
  const summary = {
    tool_name: runs[0].tool_name,
    scenario_id: runs[0].scenario_id,
    scenario_label: runs[0].scenario_label,
    cold_or_warm: runs[0].cold_or_warm,
    sample_count: sampleCount,
    success_count: successfulRuns.length,
    error_codes: errorCodes,
    warnings,
    truncated: runs.some((run) => run.truncated),
    median_end_to_end_ms: median(runs.map((run) => run.end_to_end_ms)),
    max_end_to_end_ms: max(runs.map((run) => run.end_to_end_ms)),
    median_ls_request_count: median(runs.map((run) => run.ls_request_count)),
    max_ls_request_count: max(runs.map((run) => run.ls_request_count)),
    median_ls_total_ms: median(runs.map((run) => run.ls_total_ms)),
    max_ls_total_ms: max(runs.map((run) => run.ls_total_ms)),
    median_ls_max_ms: median(runs.map((run) => run.ls_max_ms)),
    max_source_pages_scanned: max(runs.map((run) => run.source_pages_scanned)),
    max_documents_scanned: max(runs.map((run) => run.documents_scanned)),
    median_rows_returned: median(runs.map((run) => run.rows_returned)),
  };

  summary.report_recommendation = classifyReportCandidate(summary);
  return summary;
}

function classifyReportCandidate(summary) {
  if (NON_REPORT_FRIENDLY_TOOLS.has(summary.tool_name)) {
    return {
      label: 'not_report_friendly',
      reason: 'Requires document binaries, OCR, chunk retrieval, or full-text search.',
    };
  }

  if (summary.success_count === 0) {
    return {
      label: 'error',
      reason: `All benchmark runs failed (${summary.error_codes.join(', ') || 'unknown_error'}).`,
    };
  }

  const hasFallbackOrTruncation = summary.truncated || summary.warnings.some((warning) => (
    /filtered locally|scan stopped|skipped/i.test(warning)
  ));
  const strongSignal = summary.median_end_to_end_ms > 1500
    || summary.median_ls_request_count > 3
    || hasFallbackOrTruncation
    || summary.max_source_pages_scanned > 3
    || summary.max_documents_scanned > 1;

  if (REPORT_FRIENDLY_STRONG_TOOLS.has(summary.tool_name) && strongSignal) {
    return {
      label: 'strong_report_candidate',
      reason: 'Row-oriented workflow currently requires multiple upstream requests or local scanning.',
    };
  }

  if (
    REPORT_FRIENDLY_STRONG_TOOLS.has(summary.tool_name)
    && (summary.median_end_to_end_ms > 750 || summary.max_ls_request_count > 1)
  ) {
    return {
      label: 'secondary_report_candidate',
      reason: 'Row-oriented workflow shows moderate latency or multi-page lookup behavior.',
    };
  }

  return {
    label: 'unlikely_report_candidate',
    reason: 'Observed behavior is already close to a direct single-endpoint fetch.',
  };
}

function buildMarkdownReport({ generatedAt, baseUrl, summaries, discoveryWarnings = [], rawResultsPath }) {
  const strong = summaries
    .filter((summary) => summary.report_recommendation.label === 'strong_report_candidate')
    .map((summary) => `- \`${summary.tool_name}\` (${summary.scenario_label})`);
  const secondary = summaries
    .filter((summary) => summary.report_recommendation.label === 'secondary_report_candidate')
    .map((summary) => `- \`${summary.tool_name}\` (${summary.scenario_label})`);
  const lines = [
    '# Tool Latency Benchmark',
    '',
    `Generated: ${generatedAt}`,
    `Base URL origin: ${new URL(baseUrl).origin}`,
    `Raw results: \`${rawResultsPath}\``,
    '',
    'This document is sanitized for commit safety. Benchmark fixtures and raw request traces remain in `.bench/` and must not be committed.',
    '',
    '## Summary',
  ];

  if (strong.length === 0) {
    lines.push('- No strong report candidates were identified in this run.');
  } else {
    lines.push('- Strong report candidates:');
    lines.push(...strong);
  }

  if (secondary.length > 0) {
    lines.push('- Secondary report candidates:');
    lines.push(...secondary);
  }

  if (discoveryWarnings.length > 0) {
    lines.push('- Discovery warnings:');
    lines.push(...discoveryWarnings.map((warning) => `- ${warning}`));
  }

  lines.push(
    '',
    '## Scenario Table',
    '',
    '| Tool | Scenario | Samples | Median ms | Max ms | LS req median | Pages max | Docs max | Rows median | Recommendation |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  );

  for (const summary of summaries) {
    lines.push([
      `\`${summary.tool_name}\``,
      summary.scenario_label,
      summary.sample_count,
      summary.median_end_to_end_ms,
      summary.max_end_to_end_ms,
      summary.median_ls_request_count,
      summary.max_source_pages_scanned,
      summary.max_documents_scanned,
      summary.median_rows_returned,
      `${summary.report_recommendation.label}: ${summary.report_recommendation.reason}`,
    ].join(' | '));
  }

  lines.push('', '## Notes', '');
  for (const summary of summaries) {
    const noteParts = [];
    if (summary.error_codes.length > 0) {
      noteParts.push(`errors: ${summary.error_codes.join(', ')}`);
    }
    if (summary.warnings.length > 0) {
      noteParts.push(`warnings: ${summary.warnings.join(' / ')}`);
    }

    if (noteParts.length > 0) {
      lines.push(`- \`${summary.tool_name}\` (${summary.scenario_label}): ${noteParts.join('; ')}`);
    }
  }

  lines.push(
    '',
    '## Reports API References',
    '',
    '- LegalServer Reports API: https://help.legalserver.org/article/1751-reports-api',
    '- LegalServer Data Export: https://help.legalserver.org/article/3031-data-export',
    '',
  );

  return lines.join('\n');
}

function extractRowsReturned(payload) {
  if (!payload || payload.ok === false) {
    return 0;
  }

  if (typeof payload.total_records === 'number') {
    return payload.total_records;
  }

  if (Array.isArray(payload.data)) {
    return payload.data.length;
  }

  return payload.data ? 1 : 0;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);

  if (ordered.length % 2 === 0) {
    return round((ordered[middle - 1] + ordered[middle]) / 2);
  }

  return round(ordered[middle]);
}

function max(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return round(Math.max(...values));
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}

module.exports = {
  buildMarkdownReport,
  buildRunResult,
  classifyReportCandidate,
  summarizeScenarioRuns,
};
