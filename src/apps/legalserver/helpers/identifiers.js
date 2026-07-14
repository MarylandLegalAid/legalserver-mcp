function normalizeIdentifier(value, fieldName) {
  if (value === undefined || value === null) {
    throw new Error(`${fieldName} is required`);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}

function normalizeOptionalIdentifier(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function getFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function normalizeDateValue(value) {
  if (value && typeof value === 'object') {
    return getFirstDefined(value.raw_value, value.text_value);
  }

  return value ?? null;
}

function normalizeArrayValue(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value.individual_values)) {
    return value.individual_values;
  }

  if (typeof value.all_values === 'string') {
    return value.all_values
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeUser(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return getFirstDefined(value.user_name, value.full_name, value.name);
}

function normalizeOffice(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return getFirstDefined(value.office_display, value.office_name, value.office_code);
}

function normalizeCounty(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return getFirstDefined(value.county_name, value.county, value.name);
}

function joinNameParts(parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
    .map((part) => String(part).trim())
    .join(' ')
    .trim();
}

function normalizeDisplayName(record) {
  return getFirstDefined(
    record.organization_name,
    record.client_full_name,
    record.full_name,
    joinNameParts([record.first, record.middle, record.last, record.suffix]),
  );
}

function validateIsoDate(value, fieldName) {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldName} must be an ISO date in YYYY-MM-DD format`);
  }

  return normalized;
}

function parseIsoDateToUtc(value, fieldName) {
  const normalized = validateIsoDate(value, fieldName);
  const date = new Date(`${normalized}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be an ISO date in YYYY-MM-DD format`);
  }

  return {
    normalized,
    date,
  };
}

function formatUtcIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function listInclusiveIsoDates(startValue, endValue, maxDays) {
  const start = parseIsoDateToUtc(startValue, 'start_date');
  const end = parseIsoDateToUtc(endValue, 'end_date');

  if (start.date.getTime() > end.date.getTime()) {
    throw new Error('end_date must be on or after start_date');
  }

  const maxAllowedDays = Number(maxDays);
  const diffDays = Math.floor((end.date.getTime() - start.date.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (Number.isFinite(maxAllowedDays) && maxAllowedDays > 0 && diffDays > maxAllowedDays) {
    throw new Error(`Date ranges cannot exceed ${maxAllowedDays} day(s)`);
  }

  const dates = [];
  const cursor = new Date(start.date.getTime());

  while (cursor.getTime() <= end.date.getTime()) {
    dates.push(formatUtcIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    start_date: start.normalized,
    end_date: end.normalized,
    dates,
  };
}

function compareIsoDates(left, right, leftFieldName = 'left_date', rightFieldName = 'right_date') {
  const normalizedLeft = validateIsoDate(left, leftFieldName);
  const normalizedRight = validateIsoDate(right, rightFieldName);

  if (normalizedLeft < normalizedRight) {
    return -1;
  }

  if (normalizedLeft > normalizedRight) {
    return 1;
  }

  return 0;
}

module.exports = {
  compareIsoDates,
  getFirstDefined,
  listInclusiveIsoDates,
  normalizeArrayValue,
  normalizeCounty,
  normalizeDateValue,
  normalizeDisplayName,
  normalizeIdentifier,
  normalizeOptionalIdentifier,
  normalizeOffice,
  normalizeUser,
  validateIsoDate,
};
