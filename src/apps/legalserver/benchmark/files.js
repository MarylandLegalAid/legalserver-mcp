const fs = require('node:fs');
const path = require('node:path');

const BENCHMARK_DIR = '.bench';
const BENCHMARK_RESULTS_DIR = path.join(BENCHMARK_DIR, 'results');
const FIXTURES_FILE = path.join(BENCHMARK_DIR, 'fixtures.local.json');
const SANITIZED_REPORT_FILE = path.join('docs', 'tool-latency.md');

function getRepoRoot() {
  return process.cwd();
}

function resolveRepoPath(relativePath) {
  return path.join(getRepoRoot(), relativePath);
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeTextFile(filePath, contents) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, contents, 'utf8');
}

function buildTimestampSlug(input = new Date()) {
  return input.toISOString().replace(/[:.]/g, '-');
}

function getFixturesPath() {
  return resolveRepoPath(FIXTURES_FILE);
}

function getResultsPath(timestamp = new Date()) {
  return resolveRepoPath(path.join(BENCHMARK_RESULTS_DIR, `${buildTimestampSlug(timestamp)}.json`));
}

function getSanitizedReportPath() {
  return resolveRepoPath(SANITIZED_REPORT_FILE);
}

module.exports = {
  BENCHMARK_DIR,
  BENCHMARK_RESULTS_DIR,
  FIXTURES_FILE,
  SANITIZED_REPORT_FILE,
  buildTimestampSlug,
  ensureParentDirectory,
  getFixturesPath,
  getRepoRoot,
  getResultsPath,
  getSanitizedReportPath,
  readJsonFile,
  resolveRepoPath,
  writeJsonFile,
  writeTextFile,
};
