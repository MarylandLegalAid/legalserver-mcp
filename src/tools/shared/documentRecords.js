function normalizeMimeType(value) {
  if (!value) {
    return null;
  }

  return String(value).split(';', 1)[0].trim().toLowerCase() || null;
}

function getFileExtension(name) {
  if (!name) {
    return '';
  }

  const normalized = String(name).trim().toLowerCase();
  const index = normalized.lastIndexOf('.');
  return index === -1 ? '' : normalized.slice(index);
}

function resolveDocumentFormat(record) {
  const mimeType = normalizeMimeType(record.mime_type);
  const extension = getFileExtension(record.name || record.title || '');

  if (mimeType === 'text/plain') {
    return 'txt';
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }

  if (mimeType === 'text/rtf' || mimeType === 'application/rtf') {
    return 'rtf';
  }

  if (mimeType === 'application/mbox' || mimeType === 'message/rfc822') {
    return 'eml';
  }

  if (mimeType === 'application/pdf') {
    return 'pdf';
  }

  if (mimeType === 'image/png') {
    return 'image/png';
  }

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return 'image/jpeg';
  }

  if (mimeType === 'image/webp') {
    return 'image/webp';
  }

  if (extension === '.txt' || extension === '.text') {
    return 'txt';
  }

  if (extension === '.docx') {
    return 'docx';
  }

  if (extension === '.rtf') {
    return 'rtf';
  }

  if (extension === '.eml') {
    return 'eml';
  }

  if (extension === '.pdf') {
    return 'pdf';
  }

  if (extension === '.png') {
    return 'image/png';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  return null;
}

function getDocumentTextStrategy(record) {
  const format = resolveDocumentFormat(record);

  if (format === 'txt' || format === 'docx' || format === 'rtf' || format === 'eml') {
    return 'direct';
  }

  if (format === 'pdf') {
    return 'direct_or_ocr';
  }

  if (format === 'image/png' || format === 'image/jpeg' || format === 'image/webp') {
    return 'ocr';
  }

  return 'unsupported';
}

function getDocumentSizeBytes(record) {
  return record.disk_file_size ?? record.file_size ?? null;
}

function mapDocumentRecord(record) {
  const sizeBytes = getDocumentSizeBytes(record);

  return {
    document_uuid: record.guid ?? null,
    document_id: record.internal_id ?? null,
    name: record.name ?? null,
    title: record.title ?? null,
    mime_type: normalizeMimeType(record.mime_type),
    size_bytes: sizeBytes,
    estimated_tokens: typeof sizeBytes === 'number' ? Math.ceil(sizeBytes / 4) : null,
    text_strategy: getDocumentTextStrategy(record),
    date_created: record.date_create ?? null,
    date_updated: record.date_update ?? null,
    virus_scanned: record.virus_scanned ?? null,
    virus_free: record.virus_free ?? null,
    folder_id: record.folder_id ?? null,
  };
}

async function listMatterDocuments({ client, caseUuid }) {
  const response = await client.getJson('/api/v1/matters/{case_UUID}/documents', {
    pathParams: { case_UUID: caseUuid },
  });

  return Array.isArray(response.data) ? response.data : [];
}

function getDocumentLocator({ args, helpers }) {
  const documentUuid = args.document_uuid
    ? helpers.normalizeIdentifier(args.document_uuid, 'document_uuid')
    : null;
  const documentId = args.document_id
    ? helpers.normalizeIdentifier(args.document_id, 'document_id')
    : null;

  if (!documentUuid && !documentId) {
    throw new Error('document_uuid or document_id is required');
  }

  return {
    documentUuid,
    documentId,
  };
}

function findMatterDocument(records, { documentUuid, documentId }) {
  return records.find((record) => {
    if (documentUuid && String(record.guid) === documentUuid) {
      return true;
    }

    if (documentId && String(record.internal_id) === documentId) {
      return true;
    }

    return false;
  }) || null;
}

async function resolveMatterDocument({ client, helpers, caseUuid, documentUuid, documentId }) {
  const records = await listMatterDocuments({ client, caseUuid });
  const match = findMatterDocument(records, { documentUuid, documentId });

  if (!match) {
    throw new helpers.LegalServerApiError({
      errorCode: 'not_found',
      message: 'Document metadata was not found on this matter.',
      status: 404,
    });
  }

  return {
    record: match,
    mapped: mapDocumentRecord(match),
  };
}

function toTimestamp(value, helpers) {
  const normalized = helpers.normalizeDateValue(value);
  if (!normalized) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function compareMatterSearchOrder(left, right, helpers) {
  const leftUpdated = toTimestamp(left.date_update, helpers);
  const rightUpdated = toTimestamp(right.date_update, helpers);
  const hasLeftUpdated = Number.isFinite(leftUpdated);
  const hasRightUpdated = Number.isFinite(rightUpdated);

  if (hasLeftUpdated && hasRightUpdated) {
    const updatedDiff = rightUpdated - leftUpdated;
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
  } else if (hasLeftUpdated || hasRightUpdated) {
    return hasRightUpdated ? 1 : -1;
  }

  const leftCreated = toTimestamp(left.date_create, helpers);
  const rightCreated = toTimestamp(right.date_create, helpers);
  const hasLeftCreated = Number.isFinite(leftCreated);
  const hasRightCreated = Number.isFinite(rightCreated);

  if (hasLeftCreated && hasRightCreated) {
    const createdDiff = rightCreated - leftCreated;
    if (createdDiff !== 0) {
      return createdDiff;
    }
  } else if (hasLeftCreated || hasRightCreated) {
    return hasRightCreated ? 1 : -1;
  }

  const leftId = Number.parseInt(String(left.internal_id ?? ''), 10);
  const rightId = Number.parseInt(String(right.internal_id ?? ''), 10);

  if (Number.isInteger(leftId) && Number.isInteger(rightId)) {
    return leftId - rightId;
  }

  return String(left.internal_id ?? '').localeCompare(String(right.internal_id ?? ''));
}

function sortMatterDocumentsForSearch(records, helpers) {
  return [...records].sort((left, right) => compareMatterSearchOrder(left, right, helpers));
}

function getDocumentCacheKey(caseUuid, record) {
  return `${caseUuid}::${record.guid ?? record.internal_id}`;
}

module.exports = {
  findMatterDocument,
  getDocumentCacheKey,
  getDocumentLocator,
  getDocumentSizeBytes,
  getDocumentTextStrategy,
  listMatterDocuments,
  mapDocumentRecord,
  normalizeMimeType,
  resolveDocumentFormat,
  resolveMatterDocument,
  sortMatterDocumentsForSearch,
};
