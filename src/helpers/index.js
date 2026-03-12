const { LegalServerApiError, ToolError, parseLegalServerError, toErrorEnvelope } = require('./errors');
const {
  getFirstDefined,
  normalizeArrayValue,
  normalizeCounty,
  normalizeDateValue,
  normalizeDisplayName,
  normalizeIdentifier,
  normalizeOffice,
  normalizeUser,
} = require('./identifiers');
const {
  buildNextPage,
  paginateArray,
  validateMaxChars,
  validatePage,
  validatePageSize,
} = require('./pagination');
const { successEnvelope, toMcpTextResult } = require('./response');
const { htmlToText, makePreview, truncateText } = require('./text');

module.exports = {
  LegalServerApiError,
  ToolError,
  buildNextPage,
  getFirstDefined,
  htmlToText,
  makePreview,
  normalizeArrayValue,
  normalizeCounty,
  normalizeDateValue,
  normalizeDisplayName,
  normalizeIdentifier,
  normalizeOffice,
  normalizeUser,
  paginateArray,
  parseLegalServerError,
  successEnvelope,
  toErrorEnvelope,
  toMcpTextResult,
  truncateText,
  validateMaxChars,
  validatePage,
  validatePageSize,
};
