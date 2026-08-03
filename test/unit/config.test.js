const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadConfig,
  normalizeBaseUrl,
  normalizeHeaderName,
  normalizeOptionalUrl,
  parseAllowedHosts,
  parseHttpPort,
  parseMatterCurrentUserCacheTtl,
  parseMatterCurrentUserFetchConcurrency,
  parseOcrProvider,
  parseTimeout,
} = require('../../src/apps/legalserver/config');

test('normalizeBaseUrl validates and normalizes trailing slash', () => {
  assert.equal(normalizeBaseUrl('https://example.legalserver.org'), 'https://example.legalserver.org/');
  assert.equal(normalizeBaseUrl('https://example.legalserver.org////'), 'https://example.legalserver.org/');
});

test('loadConfig fails fast when required env is missing', () => {
  assert.throws(
    () => loadConfig({ LEGALSERVER_BASE_URL: 'https://example.legalserver.org/' }),
    /LEGALSERVER_BEARER_TOKEN/,
  );
});

test('parseTimeout uses default and rejects invalid values', () => {
  assert.equal(parseTimeout(undefined), 30000);
  assert.equal(parseTimeout('45000'), 45000);
  assert.throws(() => parseTimeout('0'), /positive integer/);
});

test('matter current-user cache and concurrency config defaults and validation', () => {
  assert.equal(parseMatterCurrentUserCacheTtl(undefined), 60000);
  assert.equal(parseMatterCurrentUserCacheTtl('0'), 0);
  assert.throws(() => parseMatterCurrentUserCacheTtl('-1'), /MATTER_CURRENT_USER_CACHE_TTL_MS/);

  assert.equal(parseMatterCurrentUserFetchConcurrency(undefined), 4);
  assert.equal(parseMatterCurrentUserFetchConcurrency('8'), 8);
  assert.equal(parseMatterCurrentUserFetchConcurrency('99'), 8);
  assert.throws(() => parseMatterCurrentUserFetchConcurrency('0'), /at least 1/);
});

test('HTTP config defaults and validates values', () => {
  const config = loadConfig({
    LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
    LEGALSERVER_BEARER_TOKEN: 'token',
  });

  assert.equal(config.httpHost, '127.0.0.1');
  assert.equal(config.httpPort, 3001);
  assert.equal(config.allowedHosts, null);
  assert.equal(config.sharedSecret, null);
  assert.equal(config.sharedSecretHeader, 'x-legalserver-mcp-secret');
  assert.equal(config.userEmailHeader, 'x-legalserver-user-email');
  assert.equal(config.currentUserEventsReportUrl, null);
  assert.equal(config.currentUserTasksReportUrl, null);
  assert.equal(config.currentUserMattersReportUrl, null);
  assert.equal(config.matterCurrentUserCacheTtlMs, 60000);
  assert.equal(config.matterCurrentUserFetchConcurrency, 4);
  assert.equal(parseHttpPort('8080'), 8080);
  assert.deepEqual(parseAllowedHosts(' legalserver-mcp, localhost , legalserver-mcp '), ['legalserver-mcp', 'localhost']);
  assert.equal(normalizeHeaderName(' X-Custom-User-Email '), 'x-custom-user-email');
  assert.equal(normalizeOptionalUrl(' https://example.legalserver.org/report ', 'TEST_URL'), 'https://example.legalserver.org/report');
  assert.throws(() => normalizeOptionalUrl('not a url', 'TEST_URL'), /TEST_URL/);
  assert.throws(() => parseHttpPort('70000'), /MCP_HTTP_PORT/);

  const renderConfig = loadConfig({
    LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
    LEGALSERVER_BEARER_TOKEN: 'token',
    PORT: '10000',
  });
  assert.equal(renderConfig.httpPort, 10000);
});

test('HTTP config parses optional host filtering and shared secret settings', () => {
  const config = loadConfig({
    LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
    LEGALSERVER_BEARER_TOKEN: 'token',
    MCP_ALLOWED_HOSTS: 'legalserver-mcp, localhost,127.0.0.1',
    MCP_SHARED_SECRET: 'super-secret',
    MCP_SHARED_SECRET_HEADER: ' X-LegalServer-Mcp-Secret ',
    LEGALSERVER_CURRENT_USER_EVENTS_REPORT_URL: 'https://example.legalserver.org/modules/report/api_export.php?load=2744&api_key=key&filter%5Bperson_email%5D=',
    LEGALSERVER_CURRENT_USER_TASKS_REPORT_URL: 'https://example.legalserver.org/modules/report/api_export.php?load=2777&api_key=task-key&filter%5Btodo_users_email%5D=',
    LEGALSERVER_CURRENT_USER_MATTERS_REPORT_URL: 'https://example.legalserver.org/modules/report/api_export.php?load=2809&api_key=matter-key&filter%5Bperson_email%5D=',
    MATTER_CURRENT_USER_CACHE_TTL_MS: '120000',
    MATTER_CURRENT_USER_FETCH_CONCURRENCY: '6',
  });

  assert.deepEqual(config.allowedHosts, ['legalserver-mcp', 'localhost', '127.0.0.1']);
  assert.equal(config.sharedSecret, 'super-secret');
  assert.equal(config.sharedSecretHeader, 'x-legalserver-mcp-secret');
  assert.equal(
    config.currentUserEventsReportUrl,
    'https://example.legalserver.org/modules/report/api_export.php?load=2744&api_key=key&filter%5Bperson_email%5D=',
  );
  assert.equal(
    config.currentUserTasksReportUrl,
    'https://example.legalserver.org/modules/report/api_export.php?load=2777&api_key=task-key&filter%5Btodo_users_email%5D=',
  );
  assert.equal(
    config.currentUserMattersReportUrl,
    'https://example.legalserver.org/modules/report/api_export.php?load=2809&api_key=matter-key&filter%5Bperson_email%5D=',
  );
  assert.equal(config.matterCurrentUserCacheTtlMs, 120000);
  assert.equal(config.matterCurrentUserFetchConcurrency, 6);
});

test('OCR config defaults to none, so OCR is opt-in', () => {
  const config = loadConfig({
    LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
    LEGALSERVER_BEARER_TOKEN: 'token',
  });

  assert.equal(config.documentOcrProvider, 'none');
  assert.equal(config.documentOcrModel, 'gpt-5.6-luna');

  assert.equal(parseOcrProvider('none'), 'none');
  assert.equal(parseOcrProvider(undefined), 'none');
  assert.equal(parseOcrProvider('  NONE  '), 'none');
  assert.throws(() => parseOcrProvider('bad'), /DOCUMENT_OCR_PROVIDER/);
});

test('loadConfig accepts the openai OCR provider with a key', () => {
  const config = loadConfig({
    LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
    LEGALSERVER_BEARER_TOKEN: 'token',
    DOCUMENT_OCR_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-test-key',
  });

  assert.equal(config.documentOcrProvider, 'openai');
  assert.equal(config.documentOcrModel, 'gpt-5.6-luna');
  assert.equal(config.openAiApiKey, 'sk-test-key');
  assert.equal(parseOcrProvider('OpenAI'), 'openai');
});

// Without this the server boots happily and every scanned document fails later with a 502 that
// looks like an OpenAI outage rather than a missing setting.
test('loadConfig refuses to boot when openai OCR is enabled without a key', () => {
  assert.throws(
    () => loadConfig({
      LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
      LEGALSERVER_BEARER_TOKEN: 'token',
      DOCUMENT_OCR_PROVIDER: 'openai',
    }),
    /OPENAI_API_KEY environment variable is required when DOCUMENT_OCR_PROVIDER=openai/,
  );
});

test('DOCUMENT_OCR_MAX_PAGES defaults to 50 and rejects nonsense', () => {
  const base = {
    LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
    LEGALSERVER_BEARER_TOKEN: 'token',
  };

  assert.equal(loadConfig(base).documentOcrMaxPages, 50);
  assert.equal(loadConfig({ ...base, DOCUMENT_OCR_MAX_PAGES: '12' }).documentOcrMaxPages, 12);
  assert.throws(() => loadConfig({ ...base, DOCUMENT_OCR_MAX_PAGES: '0' }), /at least 1/);
  assert.throws(() => loadConfig({ ...base, DOCUMENT_OCR_MAX_PAGES: '-3' }), /non-negative integer/);
});

// An existing deployment may still carry one of these in its .env. Failing at boot with a
// message naming the removal beats silently ignoring the setting and sending nothing anywhere.
test('loadConfig refuses to boot on a removed third-party OCR provider', () => {
  for (const provider of ['openrouter', 'vertex_gemini']) {
    assert.throws(
      () => loadConfig({
        LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
        LEGALSERVER_BEARER_TOKEN: 'token',
        DOCUMENT_OCR_PROVIDER: provider,
        OPENROUTER_API_KEY: 'sk-or-test-key',
        GOOGLE_CLOUD_PROJECT: 'proj-1',
      }),
      new RegExp(`DOCUMENT_OCR_PROVIDER=${provider} has been removed`),
      `${provider} should be rejected at boot`,
    );

    assert.throws(() => parseOcrProvider(provider), /has been removed/);
  }
});

test('loadConfig no longer surfaces credentials for the removed providers', () => {
  const config = loadConfig({
    LEGALSERVER_BASE_URL: 'https://example.legalserver.org/',
    LEGALSERVER_BEARER_TOKEN: 'token',
    OPENROUTER_API_KEY: 'sk-or-test-key',
    GOOGLE_CLOUD_PROJECT: 'proj-1',
    GOOGLE_CLOUD_LOCATION: 'us-central1',
  });

  assert.equal(config.openRouterApiKey, undefined);
  assert.equal(config.googleCloudProject, undefined);
  assert.equal(config.googleCloudLocation, undefined);
});
