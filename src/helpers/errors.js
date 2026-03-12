class ToolError extends Error {
  constructor({ errorCode, message, retryAfter, status }) {
    super(message);
    this.name = 'ToolError';
    this.errorCode = errorCode;
    this.retryAfter = retryAfter ?? null;
    this.status = status ?? 500;
  }
}

class LegalServerApiError extends ToolError {
  constructor(options) {
    super(options);
    this.name = 'LegalServerApiError';
  }
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

function extractErrorMessage(payload, fallback) {
  if (!payload) {
    return fallback;
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  if (typeof payload.detail === 'string' && payload.detail.trim()) {
    return payload.detail;
  }

  const detailParts = [];

  if (Array.isArray(payload.missing_arguments) && payload.missing_arguments.length > 0) {
    detailParts.push(`missing_arguments=${payload.missing_arguments.join(', ')}`);
  }

  if (Array.isArray(payload.invalid_parameters) && payload.invalid_parameters.length > 0) {
    detailParts.push(`invalid_parameters=${payload.invalid_parameters.join(', ')}`);
  }

  if (payload.invalid_values && typeof payload.invalid_values === 'object') {
    detailParts.push(`invalid_values=${JSON.stringify(payload.invalid_values)}`);
  }

  if (detailParts.length > 0) {
    return detailParts.join('; ');
  }

  return fallback;
}

async function parseLegalServerError(response) {
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) || retryAfterHeader : null;
  const fallback = `LegalServer request failed with ${response.status} ${response.statusText}`;
  const contentType = response.headers.get('content-type') || '';

  let payload = null;
  try {
    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      const text = await response.text();
      payload = text || null;
    }
  } catch (error) {
    payload = null;
  }

  return new LegalServerApiError({
    errorCode: statusToErrorCode(response.status),
    message: extractErrorMessage(payload, fallback),
    retryAfter,
    status: response.status,
  });
}

function toErrorEnvelope(error) {
  if (error instanceof ToolError) {
    return {
      ok: false,
      data: null,
      page: null,
      page_size: null,
      total_records: null,
      total_pages: null,
      truncated: false,
      warnings: [],
      next: null,
      error_code: error.errorCode,
      message: error.message,
      status: error.status,
      retry_after: error.retryAfter,
    };
  }

  return {
    ok: false,
    data: null,
    page: null,
    page_size: null,
    total_records: null,
    total_pages: null,
    truncated: false,
    warnings: [],
    next: null,
    error_code: 'invalid_request',
    message: error instanceof Error ? error.message : String(error),
    status: 400,
    retry_after: null,
  };
}

module.exports = {
  LegalServerApiError,
  ToolError,
  parseLegalServerError,
  toErrorEnvelope,
};
