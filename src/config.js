const { DEFAULT_TIMEOUT_MS } = require('./constants');

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

function parseOcrProvider(rawProvider) {
  const provider = (rawProvider || 'none').trim().toLowerCase();

  if (provider === 'none' || provider === 'vertex_gemini') {
    return provider;
  }

  throw new Error('DOCUMENT_OCR_PROVIDER must be one of: none, vertex_gemini');
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeHeaderName(rawHeader, fallback = 'x-legalserver-user-email') {
  const headerName = normalizeOptionalString(rawHeader) || fallback;
  return headerName.toLowerCase();
}

function loadConfig(env) {
  const bearerToken = env.LEGALSERVER_BEARER_TOKEN;
  if (!bearerToken) {
    throw new Error('LEGALSERVER_BEARER_TOKEN environment variable is required');
  }

  const documentOcrProvider = parseOcrProvider(env.DOCUMENT_OCR_PROVIDER);
  const googleCloudProject = normalizeOptionalString(env.GOOGLE_CLOUD_PROJECT);

  if (documentOcrProvider !== 'none' && !googleCloudProject) {
    throw new Error('GOOGLE_CLOUD_PROJECT environment variable is required when DOCUMENT_OCR_PROVIDER is enabled');
  }

  return {
    baseUrl: normalizeBaseUrl(env.LEGALSERVER_BASE_URL),
    bearerToken,
    timeoutMs: parseTimeout(env.LEGALSERVER_TIMEOUT_MS),
    documentOcrProvider,
    documentOcrModel: normalizeOptionalString(env.DOCUMENT_OCR_MODEL) || 'gemini-2.5-flash',
    googleCloudProject,
    googleCloudLocation: normalizeOptionalString(env.GOOGLE_CLOUD_LOCATION) || 'global',
    httpHost: normalizeOptionalString(env.MCP_HTTP_HOST) || '127.0.0.1',
    httpPort: parseHttpPort(env.MCP_HTTP_PORT),
    userEmailHeader: normalizeHeaderName(env.LEGALSERVER_USER_EMAIL_HEADER),
  };
}

module.exports = {
  loadConfig,
  normalizeHeaderName,
  normalizeOptionalString,
  normalizeBaseUrl,
  parseOcrProvider,
  parseHttpPort,
  parseTimeout,
};
