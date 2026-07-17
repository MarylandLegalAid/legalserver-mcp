const {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require('../../constants');

function caseUuidProperty() {
  return {
    type: 'string',
    description: 'LegalServer matter UUID.',
  };
}

function pageProperties() {
  return {
    page: {
      type: 'integer',
      default: DEFAULT_PAGE,
      minimum: DEFAULT_PAGE,
      description: '1-based page number.',
    },
    page_size: {
      type: 'integer',
      default: DEFAULT_PAGE_SIZE,
      minimum: 1,
      maximum: MAX_PAGE_SIZE,
      description: 'Requested page size, capped at 25.',
    },
  };
}

function uuidProperty(description) {
  return {
    type: 'string',
    description,
  };
}

function isoDateProperty(description) {
  return {
    type: 'string',
    description,
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  };
}

module.exports = {
  caseUuidProperty,
  isoDateProperty,
  pageProperties,
  uuidProperty,
};
