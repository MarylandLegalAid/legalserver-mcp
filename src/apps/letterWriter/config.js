function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function parseEnabled(value, bucketName) {
  if (value === undefined || value === null || value === '') {
    return Boolean(bucketName);
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error('LETTER_WRITER_ENABLED must be true or false');
}

function parsePresignExpiration(value) {
  if (value === undefined || value === null || value === '') {
    return 3600;
  }

  const seconds = Number.parseInt(String(value), 10);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 604800) {
    throw new Error('PRESIGN_EXPIRES_SECONDS must be an integer between 60 and 604800');
  }
  return seconds;
}

function normalizeHeaderName(value, fallback) {
  return (normalizeOptionalString(value) || fallback).toLowerCase();
}

function loadLetterWriterConfig(env) {
  const bucketName = normalizeOptionalString(env.AWS_BUCKET_NAME);
  const enabled = parseEnabled(env.LETTER_WRITER_ENABLED, bucketName);
  const letterWriterSecret = normalizeOptionalString(env.LETTER_WRITER_MCP_SHARED_SECRET);
  const sharedSecret = letterWriterSecret || normalizeOptionalString(env.MCP_SHARED_SECRET);
  const fallbackSecretHeader = letterWriterSecret
    ? 'x-letter-writer-mcp-secret'
    : normalizeHeaderName(env.MCP_SHARED_SECRET_HEADER, 'x-legal-tools-mcp-secret');

  if (enabled && !bucketName) {
    throw new Error('AWS_BUCKET_NAME is required when LETTER_WRITER_ENABLED is true');
  }

  return {
    enabled,
    region: normalizeOptionalString(env.AWS_REGION) || 'us-east-1',
    bucketName,
    s3Prefix: (normalizeOptionalString(env.S3_PREFIX) || 'mcp/letters').replace(/^\/+|\/+$/g, ''),
    presignExpiresSeconds: parsePresignExpiration(env.PRESIGN_EXPIRES_SECONDS),
    sharedSecret,
    sharedSecretHeader: normalizeHeaderName(
      env.LETTER_WRITER_MCP_SHARED_SECRET_HEADER,
      fallbackSecretHeader,
    ),
  };
}

module.exports = {
  loadLetterWriterConfig,
  normalizeOptionalString,
  parseEnabled,
  parsePresignExpiration,
};
