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

module.exports = {
  getFirstDefined,
  normalizeArrayValue,
  normalizeCounty,
  normalizeDateValue,
  normalizeDisplayName,
  normalizeIdentifier,
  normalizeOffice,
  normalizeUser,
};
