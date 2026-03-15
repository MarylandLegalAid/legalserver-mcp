const { performance } = require('node:perf_hooks');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createHttpApp } = require('../httpServer');
const { buildMarkdownReport, buildRunResult, summarizeScenarioRuns } = require('./summary');
const { buildBenchmarkScenarios } = require('./scenarios');

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

async function runBenchmarkSuite({ config, fixtures, telemetry, pauseMs = 1000 }) {
  const scenarios = buildBenchmarkScenarios(fixtures, config);
  const runs = [];
  let consecutiveThrottleErrors = 0;

  for (const scenario of scenarios) {
    for (let sampleIndex = 0; sampleIndex < scenario.sampleCount; sampleIndex += 1) {
      const run = await executeScenarioRun({
        config,
        fixtures,
        scenario,
        telemetry,
      });
      runs.push(run);

      if (run.error_code === 'rate_limited' || run.error_code === 'service_unavailable') {
        consecutiveThrottleErrors += 1;
      } else {
        consecutiveThrottleErrors = 0;
      }

      if (consecutiveThrottleErrors >= 2) {
        throw new Error(`Benchmark aborted after repeated upstream throttling while running ${scenario.toolName}.`);
      }

      if (pauseMs > 0) {
        await delay(pauseMs);
      }
    }
  }

  const summaries = summarizeRuns(runs);
  return {
    generated_at: new Date().toISOString(),
    base_url: config.baseUrl,
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      label: scenario.label,
      tool_name: scenario.toolName,
      sample_count: scenario.sampleCount,
    })),
    runs,
    summaries,
  };
}

function renderSanitizedBenchmarkReport({ benchmarkResult, fixturesPath, resultsPath, discoveryWarnings = [] }) {
  return buildMarkdownReport({
    generatedAt: benchmarkResult.generated_at,
    baseUrl: benchmarkResult.base_url,
    summaries: benchmarkResult.summaries,
    discoveryWarnings,
    rawResultsPath: resultsPath,
    fixturesPath,
  });
}

async function executeScenarioRun({ config, fixtures, scenario, telemetry }) {
  const headers = {
    ...(scenario.headers ? scenario.headers(fixtures, config) : {}),
  };
  const { server, client } = await startBenchmarkSession({
    config,
    headers,
    fetchImpl: telemetry.fetchImpl,
  });

  try {
    if (typeof scenario.prime === 'function') {
      await scenario.prime({
        client,
        fixtures,
        config,
      });
    }

    telemetry.startRun({
      tool_name: scenario.toolName,
      scenario_id: scenario.id,
    });
    const startedAt = performance.now();
    const result = await client.callTool({
      name: scenario.toolName,
      arguments: scenario.args(fixtures, config),
    });
    const endToEndMs = performance.now() - startedAt;
    const payload = parseToolResult(result);
    const telemetrySnapshot = telemetry.finishRun();

    return buildRunResult({
      scenario,
      payload,
      telemetry: telemetrySnapshot,
      endToEndMs,
    });
  } finally {
    await client.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

async function startBenchmarkSession({ config, headers, fetchImpl }) {
  const benchmarkConfig = {
    ...config,
    httpHost: '127.0.0.1',
    httpPort: 0,
    allowedHosts: buildAllowedHosts(config.allowedHosts),
  };
  const { app } = createHttpApp({
    config: benchmarkConfig,
    fetchImpl,
  });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1');
    listener.once('error', reject);
    listener.once('listening', () => {
      listener.removeListener('error', reject);
      resolve(listener);
    });
  });
  const address = server.address();
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`),
    {
      requestInit: {
        headers,
      },
    },
  );
  const client = new Client({
    name: 'legalserver-mcp-benchmark',
    version: '1.0.0',
  });

  await client.connect(transport);

  return {
    server,
    client,
  };
}

function summarizeRuns(runs) {
  const grouped = new Map();

  for (const run of runs) {
    const key = run.scenario_id;
    const current = grouped.get(key) || [];
    current.push(run);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((group) => summarizeScenarioRuns(group))
    .sort((left, right) => left.tool_name.localeCompare(right.tool_name) || left.scenario_label.localeCompare(right.scenario_label));
}

function buildAllowedHosts(existingHosts) {
  const hosts = new Set(existingHosts || []);
  hosts.add('127.0.0.1');
  hosts.add('localhost');
  return [...hosts];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  renderSanitizedBenchmarkReport,
  runBenchmarkSuite,
};
