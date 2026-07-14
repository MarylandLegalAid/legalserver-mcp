const { MAX_DOCUMENT_BYTES, READ_ONLY_ENDPOINTS } = require('./constants');
const { ToolError, parseLegalServerError } = require('./helpers');

const DOCUMENT_DOWNLOAD_PATH = '/modules/document/download.php';
const DOWNLOAD_RETRY_STATUSES = new Set([400, 401, 403, 404]);
const DOWNLOAD_AUTH_STATUSES = new Set([401, 403]);
const DOWNLOAD_STOP_STATUSES = new Set([429, 503]);

function extractFilenameFromDisposition(disposition) {
  if (!disposition) {
    return null;
  }

  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1] || match[2]);
  } catch (error) {
    return match[1] || match[2] || null;
  }
}

function isHtmlLikeBody(buffer, contentType) {
  const normalizedType = String(contentType || '').toLowerCase();
  if (normalizedType.includes('text/html') || normalizedType.includes('application/xhtml+xml')) {
    return true;
  }

  const prefix = buffer.toString('utf8', 0, Math.min(buffer.length, 256)).trimStart().toLowerCase();
  return prefix.startsWith('<!doctype') || prefix.startsWith('<html');
}

function formatStatusMessage(status, statusText) {
  return `LegalServer document download failed with ${status} ${statusText}.`;
}

function formatNetworkMessage(kind) {
  if (kind === 'timeout') {
    return 'LegalServer document download timed out.';
  }

  return 'LegalServer document download failed due to a network error.';
}

function statusToErrorCode(status) {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'service_unavailable';
  return 'upstream_error';
}

function createDocumentTooLargeError(maxBytes) {
  return new ToolError({
    errorCode: 'document_too_large',
    message: `Document exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB phase 2 size limit.`,
    status: 413,
  });
}

function createNoRetrievableUrlError() {
  return new ToolError({
    errorCode: 'extraction_failed',
    message: 'LegalServer returned document metadata, but no retrievable allowlisted download URL was available for this document.',
    status: 502,
  });
}

function isAbortTimeoutError(error) {
  return error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || error?.code === 'ABORT_ERR';
}

async function readResponseBuffer(response) {
  if (typeof response.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer());
  }

  if (typeof response.buffer === 'function') {
    const value = await response.buffer();
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks);
  }

  const text = typeof response.text === 'function' ? await response.text() : '';
  return Buffer.from(text, 'utf8');
}

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

  validateReportApiUrl(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (error) {
      throw new Error('LegalServer report URL is invalid.');
    }

    const baseUrl = new URL(this.baseUrl);
    if (parsed.origin !== baseUrl.origin || parsed.pathname !== '/modules/report/api_export.php') {
      throw new Error('LegalServer report URL must use the configured LegalServer host and /modules/report/api_export.php path.');
    }

    if (!parsed.searchParams.get('load') || !parsed.searchParams.get('api_key')) {
      throw new Error('LegalServer report URL must include load and api_key query parameters.');
    }

    return parsed;
  }

  async getReportJson(reportUrl, { query, accept } = {}) {
    const url = this.validateReportApiUrl(reportUrl);

    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const response = await this.fetchImpl(url.toString(), {
      method: 'GET',
      headers: this.createHeaders(accept),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw await parseLegalServerError(response);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      await response.text();
      throw new ToolError({
        errorCode: 'upstream_error',
        message: 'LegalServer report API returned a non-JSON response.',
        status: 502,
      });
    }

    const rawPayload = await response.json();

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

  getDocumentDownloadCandidates(documentRecord) {
    const baseUrl = new URL(this.baseUrl);
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (url) => {
      const value = url.toString();
      if (seen.has(value)) {
        return;
      }

      seen.add(value);
      candidates.push(url);
    };

    if (documentRecord?.guid) {
      const url = new URL(DOCUMENT_DOWNLOAD_PATH, baseUrl);
      url.searchParams.set('unique_id', String(documentRecord.guid));
      pushCandidate(url);
    }

    if (documentRecord?.internal_id !== undefined && documentRecord?.internal_id !== null && documentRecord.internal_id !== '') {
      const url = new URL(DOCUMENT_DOWNLOAD_PATH, baseUrl);
      url.searchParams.set('id', String(documentRecord.internal_id));
      pushCandidate(url);
    }

    if (documentRecord?.download_url) {
      try {
        pushCandidate(this.validateBinaryDownloadUrl(documentRecord.download_url));
      } catch (error) {
        if (!(error instanceof ToolError)) {
          throw error;
        }
      }
    }

    return candidates;
  }

  async downloadBinary(rawUrl, { expectedSizeBytes, maxBytes = MAX_DOCUMENT_BYTES } = {}) {
    if (typeof expectedSizeBytes === 'number' && expectedSizeBytes > maxBytes) {
      throw createDocumentTooLargeError(maxBytes);
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

    const buffer = await readResponseBuffer(response);
    if (buffer.length > maxBytes) {
      throw createDocumentTooLargeError(maxBytes);
    }

    return {
      buffer,
      contentType: response.headers.get('content-type') || null,
      contentLength: buffer.length,
      url: url.toString(),
    };
  }

  async downloadDocumentBinary(documentRecord, { expectedSizeBytes, maxBytes = MAX_DOCUMENT_BYTES } = {}) {
    if (typeof expectedSizeBytes === 'number' && expectedSizeBytes > maxBytes) {
      throw createDocumentTooLargeError(maxBytes);
    }

    const candidates = this.getDocumentDownloadCandidates(documentRecord);
    if (candidates.length === 0) {
      throw createNoRetrievableUrlError();
    }

    const failures = [];

    for (const candidate of candidates) {
      let response;
      try {
        response = await this.fetchImpl(candidate.toString(), {
          method: 'GET',
          headers: this.createHeaders('*/*'),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (isAbortTimeoutError(error)) {
          throw new ToolError({
            errorCode: 'extraction_failed',
            message: formatNetworkMessage('timeout'),
            status: 504,
          });
        }

        throw new ToolError({
          errorCode: 'extraction_failed',
          message: formatNetworkMessage('network'),
          status: 502,
        });
      }

      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader
        ? Number.parseInt(retryAfterHeader, 10) || retryAfterHeader
        : null;

      if (!response.ok) {
        const failure = {
          status: response.status,
          statusText: response.statusText,
          retryAfter,
          url: candidate.toString(),
        };
        failures.push(failure);

        if (DOWNLOAD_STOP_STATUSES.has(response.status)) {
          throw new ToolError({
            errorCode: statusToErrorCode(response.status),
            message: formatStatusMessage(response.status, response.statusText),
            retryAfter,
            status: response.status,
          });
        }

        if (DOWNLOAD_RETRY_STATUSES.has(response.status)) {
          continue;
        }

        throw new ToolError({
          errorCode: 'extraction_failed',
          message: formatStatusMessage(response.status, response.statusText),
          status: 502,
        });
      }

      const buffer = await readResponseBuffer(response);
      if (buffer.length > maxBytes) {
        throw createDocumentTooLargeError(maxBytes);
      }

      const contentType = response.headers.get('content-type') || null;
      if (isHtmlLikeBody(buffer, contentType)) {
        failures.push({
          status: response.status,
          statusText: response.statusText,
          url: candidate.toString(),
          htmlLike: true,
        });

        if (candidate !== candidates.at(-1)) {
          continue;
        }

        throw new ToolError({
          errorCode: 'extraction_failed',
          message: formatStatusMessage(response.status, response.statusText),
          status: 502,
        });
      }

      const contentDisposition = response.headers.get('content-disposition') || null;
      const headerLength = response.headers.get('content-length');
      const parsedLength = headerLength ? Number.parseInt(headerLength, 10) : NaN;

      return {
        buffer,
        contentDisposition,
        contentLength: Number.isFinite(parsedLength) ? parsedLength : buffer.length,
        contentType,
        filename: extractFilenameFromDisposition(contentDisposition),
        url: candidate.toString(),
      };
    }

    if (failures.length > 0 && failures.every((failure) => failure.status === 404)) {
      throw createNoRetrievableUrlError();
    }

    const authFailure = failures.find((failure) => DOWNLOAD_AUTH_STATUSES.has(failure.status));
    if (authFailure) {
      throw new ToolError({
        errorCode: statusToErrorCode(authFailure.status),
        message: formatStatusMessage(authFailure.status, authFailure.statusText),
        status: authFailure.status,
      });
    }

    const summary = failures
      .map((failure) => `${failure.status} ${failure.statusText}`)
      .filter((value, index, list) => list.indexOf(value) === index)
      .join(', ');

    throw new ToolError({
      errorCode: 'extraction_failed',
      message: summary
        ? `LegalServer document download failed across all candidates: ${summary}.`
        : 'LegalServer document download failed across all candidates.',
      status: 502,
    });
  }
}

module.exports = {
  LegalServerClient,
  normalizeEnvelope,
};
