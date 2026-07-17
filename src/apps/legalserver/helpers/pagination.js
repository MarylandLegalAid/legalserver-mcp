const {
  DEFAULT_MAX_CHARS,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_MAX_CHARS,
  MAX_PAGE_SIZE,
} = require('../constants');

function validatePositiveInteger(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function validatePage(value) {
  return validatePositiveInteger(value, DEFAULT_PAGE, 'page');
}

function validatePageSize(value) {
  const pageSize = validatePositiveInteger(value, DEFAULT_PAGE_SIZE, 'page_size');
  return Math.min(pageSize, MAX_PAGE_SIZE);
}

function validateMaxChars(value) {
  const maxChars = validatePositiveInteger(value, DEFAULT_MAX_CHARS, 'max_chars');
  return Math.min(maxChars, MAX_MAX_CHARS);
}

function paginateArray(items, page, pageSize) {
  const totalRecords = items.length;
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize);
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  return {
    items: items.slice(startIndex, endIndex),
    page,
    pageSize,
    totalRecords,
    totalPages,
  };
}

function buildNextPage(page, pageSize, totalPages) {
  if (!totalPages || page >= totalPages) {
    return null;
  }

  return {
    page: page + 1,
    page_size: pageSize,
  };
}

module.exports = {
  buildNextPage,
  paginateArray,
  validateMaxChars,
  validatePage,
  validatePageSize,
};
