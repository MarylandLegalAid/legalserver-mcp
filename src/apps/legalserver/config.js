const {
  DEFAULT_MATTER_CURRENT_USER_CACHE_TTL_MS,
  DEFAULT_MATTER_CURRENT_USER_FETCH_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
  MAX_MATTER_CURRENT_USER_FETCH_CONCURRENCY,
} = require('./constants');

function normalizeBaseUrl(rawBaseUrl) {
  if (!rawBaseUrl) {
    throw new Error('LEGALSERVER_BASE_URL environment variable is required');
  }

  let parsed;
  try {
    parsed = new URL(rawBaseUrl);
  } catch (error) {
    throw new Error('LEGALSERVER_BASE_URL must be a valid URL');
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('LEGALSERVER_BASE_URL must use http or https');
  }

  return parsed.toString().replace(/\/+$/, '/') ;
}

function parseTimeout(rawTimeout) {
  if (rawTimeout === undefined || rawTimeout === null || rawTimeout === '') {
    return DEFAULT_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(String(rawTimeout), 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('LEGALSERVER_TIMEOUT_MS must be a positive integer');
  }

  return timeoutMs;
}

function parseNonNegativeInteger(rawValue, fallback, fieldName) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return parsed;
}

function parseMatterCurrentUserCacheTtl(rawValue) {
  return parseNonNegativeInteger(
    rawValue,
    DEFAULT_MATTER_CURRENT_USER_CACHE_TTL_MS,
    'MATTER_CURRENT_USER_CACHE_TTL_MS',
  );
}

function parseMatterCurrentUserFetchConcurrency(rawValue) {
  const parsed = parseNonNegativeInteger(
    rawValue,
    DEFAULT_MATTER_CURRENT_USER_FETCH_CONCURRENCY,
    'MATTER_CURRENT_USER_FETCH_CONCURRENCY',
  );

  if (parsed === 0) {
    throw new Error('MATTER_CURRENT_USER_FETCH_CONCURRENCY must be at least 1');
  }

  return Math.min(parsed, MAX_MATTER_CURRENT_USER_FETCH_CONCURRENCY);
}

function parseHttpPort(rawPort) {
  if (rawPort === undefined || rawPort === null || rawPort === '') {
    return 3001;
  }

  const port = Number.parseInt(String(rawPort), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('MCP_HTTP_PORT must be an integer between 1 and 65535');
  }

  return port;
}

// OCR is not supported in this release — see "OCR Is Not Supported Yet" in README.md.
// The provider scaffolding in documentText/ocrProviders.js is kept but unreleased, so enabling
// it is rejected at boot rather than allowed to half-work at request time.
const UNRELEASED_OCR_PROVIDERS = new Set(['vertex_gemini', 'openrouter', 'openai']);

function parseOcrProvider(rawProvider) {
  const provider = (rawProvider || 'none').trim().toLowerCase();

  if (provider === 'none') {
    return provider;
  }

  if (UNRELEASED_OCR_PROVIDERS.has(provider)) {
    throw new Error(
      `DOCUMENT_OCR_PROVIDER=${provider} is not supported in this release. `
      + 'OCR is a planned future feature; set DOCUMENT_OCR_PROVIDER=none.',
    );
  }

  throw new Error('DOCUMENT_OCR_PROVIDER must be none — OCR is not supported in this release');
}

// Only the `none` branch is reachable while OCR is unsupported; the rest is kept for revival.
function defaultOcrModel(provider) {
  if (provider === 'openrouter') {
    return 'google/gemini-2.5-flash';
  }
  if (provider === 'openai') {
    return 'gpt-5.6-luna';
  }
  return 'gemini-2.5-flash';
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeOptionalUrl(value, fieldName) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString();
  } catch (error) {
    throw new Error(`${fieldName} must be a valid URL`);
  }
}

function normalizeHeaderName(rawHeader, fallback = 'x-legalserver-user-email') {
  const headerName = normalizeOptionalString(rawHeader) || fallback;
  return headerName.toLowerCase();
}

function parseAllowedHosts(rawAllowedHosts) {
  const normalized = normalizeOptionalString(rawAllowedHosts);
  if (!normalized) {
    return null;
  }

  const allowedHosts = normalized
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (allowedHosts.length === 0) {
    return null;
  }

  return [...new Set(allowedHosts)];
}

function loadConfig(env) {
  const bearerToken = env.LEGALSERVER_BEARER_TOKEN;
  if (!bearerToken) {
    throw new Error('LEGALSERVER_BEARER_TOKEN environment variable is required');
  }

  // parseOcrProvider rejects every provider but `none`, so the per-provider credential checks
  // that used to live here are unreachable. Restore them alongside the provider itself.
  const documentOcrProvider = parseOcrProvider(env.DOCUMENT_OCR_PROVIDER);
  const googleCloudProject = normalizeOptionalString(env.GOOGLE_CLOUD_PROJECT);
  const openRouterApiKey = normalizeOptionalString(env.OPENROUTER_API_KEY);
  const openAiApiKey = normalizeOptionalString(env.OPENAI_API_KEY);

  return {
    baseUrl: normalizeBaseUrl(env.LEGALSERVER_BASE_URL),
    bearerToken,
    timeoutMs: parseTimeout(env.LEGALSERVER_TIMEOUT_MS),
    documentOcrProvider,
    documentOcrModel: normalizeOptionalString(env.DOCUMENT_OCR_MODEL) || defaultOcrModel(documentOcrProvider),
    googleCloudProject,
    googleCloudLocation: normalizeOptionalString(env.GOOGLE_CLOUD_LOCATION) || 'global',
    openRouterApiKey,
    openAiApiKey,
    httpHost: normalizeOptionalString(env.MCP_HTTP_HOST) || '127.0.0.1',
    httpPort: parseHttpPort(env.PORT || env.MCP_HTTP_PORT),
    allowedHosts: parseAllowedHosts(env.MCP_ALLOWED_HOSTS),
    sharedSecret: normalizeOptionalString(env.MCP_SHARED_SECRET),
    sharedSecretHeader: normalizeHeaderName(env.MCP_SHARED_SECRET_HEADER, 'x-legalserver-mcp-secret'),
    userEmailHeader: normalizeHeaderName(env.LEGALSERVER_USER_EMAIL_HEADER),
    currentUserEventsReportUrl: normalizeOptionalUrl(
      env.LEGALSERVER_CURRENT_USER_EVENTS_REPORT_URL,
      'LEGALSERVER_CURRENT_USER_EVENTS_REPORT_URL',
    ),
    currentUserTasksReportUrl: normalizeOptionalUrl(
      env.LEGALSERVER_CURRENT_USER_TASKS_REPORT_URL,
      'LEGALSERVER_CURRENT_USER_TASKS_REPORT_URL',
    ),
    currentUserMattersReportUrl: normalizeOptionalUrl(
      env.LEGALSERVER_CURRENT_USER_MATTERS_REPORT_URL,
      'LEGALSERVER_CURRENT_USER_MATTERS_REPORT_URL',
    ),
    matterCurrentUserCacheTtlMs: parseMatterCurrentUserCacheTtl(env.MATTER_CURRENT_USER_CACHE_TTL_MS),
    matterCurrentUserFetchConcurrency: parseMatterCurrentUserFetchConcurrency(env.MATTER_CURRENT_USER_FETCH_CONCURRENCY),
  };
}

module.exports = {
  loadConfig,
  parseAllowedHosts,
  parseMatterCurrentUserCacheTtl,
  parseMatterCurrentUserFetchConcurrency,
  normalizeHeaderName,
  normalizeOptionalString,
  normalizeOptionalUrl,
  normalizeBaseUrl,
  parseNonNegativeInteger,
  parseOcrProvider,
  parseHttpPort,
  parseTimeout,
};
