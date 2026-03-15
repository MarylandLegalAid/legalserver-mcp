#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const path = require('node:path');
const { loadConfig } = require('../src/config');
const {
  getFixturesPath,
  getResultsPath,
  getSanitizedReportPath,
  readJsonFile,
  writeJsonFile,
  writeTextFile,
} = require('../src/benchmark/files');
const { runBenchmarkSuite, renderSanitizedBenchmarkReport } = require('../src/benchmark/runner');
const { createBenchmarkTelemetry } = require('../src/benchmark/telemetry');

async function main() {
  const config = loadConfig(process.env);
  const fixturesPath = getFixturesPath();
  let fixtures;

  try {
    fixtures = readJsonFile(fixturesPath);
  } catch (error) {
    throw new Error(`Benchmark fixtures were not found at ${fixturesPath}. Run "npm run benchmark:discover" first.`);
  }

  const telemetry = createBenchmarkTelemetry(global.fetch);
  const benchmarkResult = await runBenchmarkSuite({
    config,
    fixtures,
    telemetry,
  });
  const resultsPath = getResultsPath();
  const reportPath = getSanitizedReportPath();
  const markdown = renderSanitizedBenchmarkReport({
    benchmarkResult,
    fixturesPath,
    resultsPath: path.relative(process.cwd(), resultsPath),
    discoveryWarnings: fixtures.discovery_warnings || [],
  });

  writeJsonFile(resultsPath, benchmarkResult);
  writeTextFile(reportPath, markdown);

  console.log(`Wrote raw benchmark results to ${resultsPath}`);
  console.log(`Wrote sanitized benchmark report to ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
