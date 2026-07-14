const { buildNextPage } = require('./pagination');

function successEnvelope({
  data,
  page = 1,
  pageSize = 1,
  totalRecords,
  totalPages,
  truncated = false,
  warnings = [],
  next,
}) {
  const normalizedTotalRecords = totalRecords ?? (Array.isArray(data) ? data.length : data ? 1 : 0);
  const normalizedTotalPages = totalPages ?? (pageSize > 0 ? Math.ceil(normalizedTotalRecords / pageSize) : 0);

  return {
    ok: true,
    data,
    page,
    page_size: pageSize,
    total_records: normalizedTotalRecords,
    total_pages: normalizedTotalPages,
    truncated,
    warnings,
    next: next === undefined ? buildNextPage(page, pageSize, normalizedTotalPages) : next,
  };
}

function toMcpTextResult(payload, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError,
  };
}

module.exports = {
  successEnvelope,
  toMcpTextResult,
};
