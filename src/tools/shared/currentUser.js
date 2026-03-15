const { findExactMatch } = require('./globalDiscovery');

function readHeaderValue(headers, headerName) {
  const normalizedHeaderName = String(headerName || '').trim().toLowerCase();
  if (!normalizedHeaderName) {
    return null;
  }

  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() !== normalizedHeaderName) {
      continue;
    }

    if (Array.isArray(value)) {
      const firstString = value.find((item) => typeof item === 'string' && item.trim());
      return firstString ? firstString.trim() : null;
    }

    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized || null;
    }
  }

  return null;
}

async function resolveCurrentUser({ client, config, helpers, requestInfo }) {
  const headerName = config?.userEmailHeader || 'x-legalserver-user-email';
  const email = readHeaderValue(requestInfo?.headers, headerName);

  if (!email) {
    throw new helpers.ToolError({
      errorCode: 'missing_user_context',
      message: `This tool requires the ${headerName} request header.`,
      status: 400,
    });
  }

  const normalizedEmail = email.toLowerCase();
  const record = await findExactMatch({
    client,
    helpers,
    pathTemplate: '/api/v1/users',
    query: { email },
    compare: (candidate) => String(candidate.email ?? '').trim().toLowerCase() === normalizedEmail,
    inputLabel: `email ${email}`,
    subject: 'user',
  }).catch((error) => {
    if (error?.errorCode === 'not_found') {
      throw new helpers.ToolError({
        errorCode: 'user_context_unresolved',
        message: `No LegalServer user matched email ${email}.`,
        status: 404,
      });
    }

    throw error;
  });

  return {
    email: record.email ?? email,
    user_uuid: record.user_uuid ?? null,
    id: record.id ?? null,
    login: record.login ?? null,
    full_name: helpers.normalizeDisplayName(record),
  };
}

module.exports = {
  resolveCurrentUser,
};
