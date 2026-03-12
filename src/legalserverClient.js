const { MAX_DOCUMENT_BYTES, READ_ONLY_ENDPOINTS } = require('./constants');
const { ToolError, parseLegalServerError } = require('./helpers');

const DOCUMENT_DOWNLOAD_PATH = '/modules/document/download.php';

function normalizeEnvelope(payload) {
  if (Array.isArray(payload)) {
    return {
      data: payload,
      page: 1,
      pageSize: payload.length,
      totalPages: payload.length === 0 ? 0 : 1,
      totalRecords: payload.length,
    };
  }

  if (payload && typeof payload === 'object') {
    const data = payload.full_data !== undefined
      ? payload.full_data
      : payload.data !== undefined
        ? payload.data
        : payload;

    const normalizedData = Array.isArray(data) || (data && typeof data === 'object')
      ? data
      : null;

    return {
      data: normalizedData,
      page: payload.page_number ?? payload.page ?? 1,
      pageSize: payload.page_size ?? (
        Array.isArray(normalizedData)
          ? normalizedData.length
          : normalizedData
            ? 1
            : 0
      ),
      totalPages: payload.total_number_of_pages ?? payload.total_pages ?? (
        Array.isArray(normalizedData)
          ? (normalizedData.length === 0 ? 0 : 1)
          : normalizedData
            ? 1
            : 0
      ),
      totalRecords: payload.total_records ?? (
        Array.isArray(normalizedData)
          ? normalizedData.length
          : normalizedData
            ? 1
            : 0
      ),
    };
  }

  return {
    data: null,
    page: 1,
    pageSize: 0,
    totalPages: 0,
    totalRecords: 0,
  };
}

class LegalServerClient {
  constructor({ baseUrl, bearerToken, timeoutMs, fetchImpl }) {
    if (!baseUrl) {
      throw new Error('baseUrl is required');
    }
    if (!bearerToken) {
      throw new Error('bearerToken is required');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required');
    }

    this.baseUrl = baseUrl;
    this.bearerToken = bearerToken;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  assertReadOnlyEndpoint(pathTemplate) {
    if (!READ_ONLY_ENDPOINTS.has(pathTemplate)) {
      throw new Error(`Endpoint not allowlisted for phase 1: ${pathTemplate}`);
    }
  }

  buildPath(pathTemplate, pathParams = {}) {
    return pathTemplate.replace(/\{([^}]+)\}/g, (_, key) => {
      if (pathParams[key] === undefined || pathParams[key] === null || pathParams[key] === '') {
        throw new Error(`Missing path parameter: ${key}`);
      }

      return encodeURIComponent(String(pathParams[key]));
    });
  }

  createHeaders(accept) {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      Accept: accept || 'application/json',
    };
  }

  async getJson(pathTemplate, { pathParams, query, accept } = {}) {
    this.assertReadOnlyEndpoint(pathTemplate);

    const path = this.buildPath(pathTemplate, pathParams);
    const url = new URL(path, this.baseUrl);

    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      url.searchParams.append(key, String(value));
    }

    const response = await this.fetchImpl(url.toString(), {
      method: 'GET',
      headers: this.createHeaders(accept),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw await parseLegalServerError(response);
    }

    if (response.status === 204) {
      return normalizeEnvelope(null);
    }

    const contentType = response.headers.get('content-type') || '';
    const rawPayload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return normalizeEnvelope(rawPayload);
  }

  validateBinaryDownloadUrl(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (error) {
      throw new ToolError({
        errorCode: 'extraction_failed',
        message: 'Document download URL is invalid.',
        status: 502,
      });
    }

    const baseUrl = new URL(this.baseUrl);
    if (parsed.origin !== baseUrl.origin || parsed.pathname !== DOCUMENT_DOWNLOAD_PATH) {
      throw new ToolError({
        errorCode: 'extraction_failed',
        message: 'Document download URL is not an allowlisted LegalServer binary endpoint.',
        status: 502,
      });
    }

    return parsed;
  }

  async downloadBinary(rawUrl, { expectedSizeBytes, maxBytes = MAX_DOCUMENT_BYTES } = {}) {
    if (typeof expectedSizeBytes === 'number' && expectedSizeBytes > maxBytes) {
      throw new ToolError({
        errorCode: 'document_too_large',
        message: `Document exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB phase 2 size limit.`,
        status: 413,
      });
    }

    const url = this.validateBinaryDownloadUrl(rawUrl);
    const response = await this.fetchImpl(url.toString(), {
      method: 'GET',
      headers: this.createHeaders('*/*'),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw await parseLegalServerError(response);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new ToolError({
        errorCode: 'document_too_large',
        message: `Document exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB phase 2 size limit.`,
        status: 413,
      });
    }

    return {
      buffer,
      contentType: response.headers.get('content-type') || null,
      contentLength: buffer.length,
      url: url.toString(),
    };
  }
}

module.exports = {
  LegalServerClient,
  normalizeEnvelope,
};
