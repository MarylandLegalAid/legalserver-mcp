const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const {
  DOCUMENT_CHUNK_BOUNDARY_LOOKBACK_CHARS,
  DOCUMENT_CHUNK_OVERLAP_CHARS,
  DOCUMENT_CHUNK_TARGET_CHARS,
  DOCUMENT_SEARCH_SNIPPET_MAX_CHARS,
  DEFAULT_DOCUMENT_OCR_MAX_PAGES,
  PDF_EMBEDDED_TEXT_MIN_CHARS,
  PDF_RASTER_DPI,
  PDF_RASTER_PAGE_TIMEOUT_MS,
} = require('../constants');
const { ToolError } = require('../helpers');
const {
  getDocumentCacheKey,
  getDocumentSizeBytes,
  normalizeMimeType,
  resolveDocumentFormat,
} = require('../tools/shared/documentRecords');

function normalizePageText(value) {
  const normalizedLines = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/ +$/g, ''));

  return normalizedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeDocumentPages(pageTexts) {
  const safePages = Array.isArray(pageTexts) && pageTexts.length > 0 ? pageTexts : [''];
  const normalizedPages = safePages.map((pageText) => normalizePageText(pageText));
  const pageOffsets = [];
  const segments = [];
  let cursor = 0;

  for (let index = 0; index < normalizedPages.length; index += 1) {
    const pageText = normalizedPages[index];
    pageOffsets.push({
      pageNumber: index + 1,
      startChar: cursor,
      endChar: cursor + pageText.length,
    });
    segments.push(pageText);
    cursor += pageText.length;

    if (index < normalizedPages.length - 1) {
      segments.push('\n\n');
      cursor += 2;
    }
  }

  return {
    text: segments.join(''),
    normalizedPages,
    pageOffsets,
  };
}

function findChunkBoundary(text, start, idealEnd) {
  const searchStart = Math.max(start + 1, idealEnd - DOCUMENT_CHUNK_BOUNDARY_LOOKBACK_CHARS);
  const boundarySlice = text.slice(searchStart, idealEnd);
  const paragraphIndex = boundarySlice.lastIndexOf('\n\n');
  if (paragraphIndex !== -1) {
    return searchStart + paragraphIndex + 2;
  }

  const newlineIndex = boundarySlice.lastIndexOf('\n');
  if (newlineIndex !== -1) {
    return searchStart + newlineIndex + 1;
  }

  return idealEnd;
}

function buildChunks(text) {
  if (!text) {
    return [];
  }

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const idealEnd = Math.min(start + DOCUMENT_CHUNK_TARGET_CHARS, text.length);
    const end = idealEnd >= text.length ? text.length : findChunkBoundary(text, start, idealEnd);
    const safeEnd = end <= start ? idealEnd : end;
    chunks.push({
      chunkIndex: chunks.length,
      startChar: start,
      endChar: safeEnd,
      text: text.slice(start, safeEnd),
    });

    if (safeEnd >= text.length) {
      break;
    }

    start = Math.max(safeEnd - DOCUMENT_CHUNK_OVERLAP_CHARS, start + 1);
  }

  return chunks;
}

function locatePageNumber(pageOffsets, charIndex) {
  const safeIndex = Math.max(charIndex, 0);

  for (const page of pageOffsets) {
    if (safeIndex <= page.endChar || (page.startChar === page.endChar && safeIndex === page.startChar)) {
      return page.pageNumber;
    }
  }

  return pageOffsets.at(-1)?.pageNumber ?? 1;
}

function locatePageRange(pageOffsets, startChar, endChar) {
  return {
    pageStart: locatePageNumber(pageOffsets, startChar),
    pageEnd: locatePageNumber(pageOffsets, Math.max(startChar, endChar - 1)),
  };
}

function locateChunkIndex(chunks, charIndex) {
  return chunks.find((chunk) => charIndex >= chunk.startChar && charIndex < chunk.endChar)?.chunkIndex
    ?? chunks.at(-1)?.chunkIndex
    ?? 0;
}

function buildSnippet(text, startChar, endChar) {
  const matchLength = Math.max(endChar - startChar, 0);
  if (text.length <= DOCUMENT_SEARCH_SNIPPET_MAX_CHARS) {
    return {
      snippet: text,
      snippetTruncatedBefore: false,
      snippetTruncatedAfter: false,
    };
  }

  const remaining = Math.max(DOCUMENT_SEARCH_SNIPPET_MAX_CHARS - matchLength, 0);
  let snippetStart = Math.max(startChar - Math.floor(remaining / 2), 0);
  let snippetEnd = Math.min(endChar + Math.ceil(remaining / 2), text.length);

  if (snippetEnd - snippetStart > DOCUMENT_SEARCH_SNIPPET_MAX_CHARS) {
    snippetEnd = snippetStart + DOCUMENT_SEARCH_SNIPPET_MAX_CHARS;
  }

  if (snippetEnd - snippetStart < DOCUMENT_SEARCH_SNIPPET_MAX_CHARS) {
    snippetStart = Math.max(snippetEnd - DOCUMENT_SEARCH_SNIPPET_MAX_CHARS, 0);
  }

  return {
    snippet: text.slice(snippetStart, snippetEnd),
    snippetTruncatedBefore: snippetStart > 0,
    snippetTruncatedAfter: snippetEnd < text.length,
  };
}

function buildSearchHits({ text, pageOffsets, chunks, query }) {
  if (!text || !query) {
    return [];
  }

  const normalizedQuery = query.toLowerCase();
  const normalizedText = text.toLowerCase();
  const matches = [];
  let cursor = 0;

  while (cursor < normalizedText.length) {
    const index = normalizedText.indexOf(normalizedQuery, cursor);
    if (index === -1) {
      break;
    }

    matches.push({
      startChar: index,
      endChar: index + query.length,
    });
    cursor = index + 1;
  }

  if (matches.length === 0) {
    return [];
  }

  const merged = [];
  for (const match of matches) {
    const current = merged.at(-1);
    if (current && match.startChar <= current.endChar) {
      current.endChar = Math.max(current.endChar, match.endChar);
      current.matchCount += 1;
      continue;
    }

    merged.push({
      startChar: match.startChar,
      endChar: match.endChar,
      matchCount: 1,
    });
  }

  return merged.map((window) => {
    const snippet = buildSnippet(text, window.startChar, window.endChar);
    return {
      chunk_index: locateChunkIndex(chunks, window.startChar),
      page_number: locatePageNumber(pageOffsets, window.startChar),
      start_char: window.startChar,
      end_char: window.endChar,
      match_count: window.matchCount,
      snippet: snippet.snippet,
      snippet_truncated_before: snippet.snippetTruncatedBefore,
      snippet_truncated_after: snippet.snippetTruncatedAfter,
    };
  });
}

function ensureSearchQuery(value) {
  const query = String(value ?? '').trim();
  if (query.length < 2) {
    throw new Error('query must be at least 2 characters');
  }

  return query;
}

async function extractDocxText(buffer) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return [result.value || ''];
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'');
}

function htmlToPlainText(value) {
  return decodeHtmlEntities(
    String(value ?? '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|tr|table|blockquote|h[1-6])>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/\n[ \t]+/g, '\n');
}

function decodeQuotedPrintableToBuffer(value) {
  const source = String(value ?? '').replace(/=\r?\n/g, '');
  const bytes = [];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }

    bytes.push(source.charCodeAt(index));
  }

  return Buffer.from(bytes);
}

function decodeMimeEncodedWords(value) {
  return String(value ?? '').replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, charset, encoding, encodedText) => {
    try {
      if (String(encoding).toUpperCase() === 'B') {
        return decodeBufferToText(Buffer.from(encodedText, 'base64'), charset);
      }

      const normalized = String(encodedText).replace(/_/g, ' ');
      return decodeBufferToText(decodeQuotedPrintableToBuffer(normalized), charset);
    } catch (error) {
      return encodedText;
    }
  });
}

function decodeBufferToText(buffer, charset) {
  const normalizedCharset = String(charset || 'utf-8').trim().toLowerCase();
  const fallbackBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const candidateCharsets = [normalizedCharset, 'utf-8', 'windows-1252', 'latin1'];

  for (const candidate of candidateCharsets) {
    try {
      return new TextDecoder(candidate, { fatal: false }).decode(fallbackBuffer);
    } catch (error) {
      continue;
    }
  }

  return fallbackBuffer.toString('utf8');
}

function parseMimeParameters(value) {
  const [type, ...rawParams] = String(value || 'text/plain').split(';');
  const params = {};

  for (const rawParam of rawParams) {
    const separatorIndex = rawParam.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = rawParam.slice(0, separatorIndex).trim().toLowerCase();
    const rawValue = rawParam.slice(separatorIndex + 1).trim();
    params[key] = rawValue.replace(/^"|"$/g, '');
  }

  return {
    mimeType: normalizeMimeType(type) || 'text/plain',
    params,
  };
}

function splitEmailHeadersAndBody(raw) {
  const normalized = String(raw ?? '').replace(/\r\n/g, '\n');
  const separatorIndex = normalized.indexOf('\n\n');

  if (separatorIndex === -1) {
    return {
      headerText: normalized,
      bodyText: '',
    };
  }

  return {
    headerText: normalized.slice(0, separatorIndex),
    bodyText: normalized.slice(separatorIndex + 2),
  };
}

function parseEmailHeaders(headerText) {
  const unfoldedLines = [];

  for (const line of String(headerText ?? '').split('\n')) {
    if (/^[ \t]/.test(line) && unfoldedLines.length > 0) {
      unfoldedLines[unfoldedLines.length - 1] += ` ${line.trim()}`;
      continue;
    }

    unfoldedLines.push(line.trimEnd());
  }

  const headers = {};

  for (const line of unfoldedLines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = decodeMimeEncodedWords(line.slice(separatorIndex + 1).trim());

    if (!headers[key]) {
      headers[key] = [];
    }

    headers[key].push(value);
  }

  return headers;
}

function parseEmailPart(raw) {
  const { headerText, bodyText } = splitEmailHeadersAndBody(raw);
  const headers = parseEmailHeaders(headerText);
  const parsedContentType = parseMimeParameters(headers['content-type']?.[0] || 'text/plain; charset=utf-8');

  return {
    headers,
    bodyText,
    contentType: parsedContentType.mimeType,
    contentTypeParams: parsedContentType.params,
  };
}

function splitMultipartBody(bodyText, boundary) {
  if (!boundary) {
    return [];
  }

  const normalized = String(bodyText ?? '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const parts = [];
  const boundaryLine = `--${boundary}`;
  const closingBoundaryLine = `--${boundary}--`;
  let current = null;

  for (const line of lines) {
    if (line === boundaryLine) {
      if (current) {
        parts.push(current.join('\n'));
      }
      current = [];
      continue;
    }

    if (line === closingBoundaryLine) {
      if (current) {
        parts.push(current.join('\n'));
      }
      break;
    }

    if (current) {
      current.push(line);
    }
  }

  return parts.filter((part) => part.trim());
}

function decodeEmailBodyBuffer(part) {
  const transferEncoding = String(part.headers['content-transfer-encoding']?.[0] || '').trim().toLowerCase();
  const bodyText = part.bodyText || '';

  if (transferEncoding === 'base64') {
    const compact = bodyText.replace(/\s+/g, '');
    return Buffer.from(compact, 'base64');
  }

  if (transferEncoding === 'quoted-printable') {
    return decodeQuotedPrintableToBuffer(bodyText);
  }

  return Buffer.from(bodyText, 'utf8');
}

function decodeEmailPartText(part) {
  const charset = part.contentTypeParams.charset || 'utf-8';
  const decoded = decodeBufferToText(decodeEmailBodyBuffer(part), charset);

  if (part.contentType === 'text/html') {
    return htmlToPlainText(decoded);
  }

  return decoded;
}

function collectEmailBodySegments(part) {
  if (part.contentType === 'message/rfc822') {
    const nestedMessage = decodeEmailPartText(part).trim();
    return nestedMessage ? collectEmailBodySegments(parseEmailPart(nestedMessage)) : [];
  }

  if (part.contentType.startsWith('multipart/')) {
    const childParts = splitMultipartBody(part.bodyText, part.contentTypeParams.boundary)
      .map((rawPart) => parseEmailPart(rawPart));

    if (part.contentType === 'multipart/alternative') {
      const plainSegments = [];
      const htmlSegments = [];
      const otherSegments = [];

      for (const childPart of childParts) {
        const segments = collectEmailBodySegments(childPart);
        if (segments.length === 0) {
          continue;
        }

        if (childPart.contentType === 'text/plain') {
          plainSegments.push(...segments);
        } else if (childPart.contentType === 'text/html') {
          htmlSegments.push(...segments);
        } else {
          otherSegments.push(...segments);
        }
      }

      if (plainSegments.length > 0) {
        return plainSegments;
      }

      if (htmlSegments.length > 0) {
        return htmlSegments;
      }

      return otherSegments;
    }

    return childParts.flatMap((childPart) => collectEmailBodySegments(childPart));
  }

  if (part.contentType === 'text/plain' || part.contentType === 'text/html') {
    const text = decodeEmailPartText(part).trim();
    return text ? [text] : [];
  }

  return [];
}

function buildEmailHeaderLines(headers) {
  const selectedHeaders = [
    ['from', 'From'],
    ['to', 'To'],
    ['cc', 'Cc'],
    ['date', 'Date'],
    ['subject', 'Subject'],
  ];

  return selectedHeaders
    .map(([headerKey, label]) => {
      const value = headers[headerKey]?.[0];
      return value ? `${label}: ${value}` : null;
    })
    .filter(Boolean);
}

const RTF_IGNORABLE_DESTINATIONS = new Set([
  'annotation',
  'atnauthor',
  'colortbl',
  'datastore',
  'field',
  'filetbl',
  'fonttbl',
  'footer',
  'footerf',
  'footerl',
  'footerr',
  'ftncn',
  'ftnsep',
  'ftnsepc',
  'header',
  'headerf',
  'headerl',
  'headerr',
  'info',
  'listoverridetable',
  'listtable',
  'object',
  'pict',
  'private',
  'revtbl',
  'stylesheet',
  'themedata',
  'xmlnstbl',
]);

async function extractRtfTextPages(buffer) {
  const raw = decodeBufferToText(buffer, 'utf-8');
  const stateStack = [{ ignorable: false }];
  let output = '';
  let index = 0;
  let unicodeSkipCount = 1;
  let pendingUnicodeFallbackSkip = 0;

  function currentState() {
    return stateStack[stateStack.length - 1];
  }

  while (index < raw.length) {
    const char = raw[index];

    if (char === '{') {
      stateStack.push({ ignorable: currentState().ignorable });
      index += 1;
      continue;
    }

    if (char === '}') {
      if (stateStack.length > 1) {
        stateStack.pop();
      }
      index += 1;
      continue;
    }

    if (char === '\\') {
      const next = raw[index + 1];

      if (next === '\'' && /^[0-9A-Fa-f]{2}$/.test(raw.slice(index + 2, index + 4))) {
        if (!currentState().ignorable) {
          output += String.fromCharCode(Number.parseInt(raw.slice(index + 2, index + 4), 16));
        }
        index += 4;
        continue;
      }

      if (next === '\\' || next === '{' || next === '}') {
        if (!currentState().ignorable) {
          output += next;
        }
        index += 2;
        continue;
      }

      if (next === '*') {
        currentState().ignorable = true;
        index += 2;
        continue;
      }

      const wordMatch = raw.slice(index + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (!wordMatch) {
        index += 1;
        continue;
      }

      const [, controlWord, numericValue] = wordMatch;
      const parameter = numericValue === undefined ? null : Number.parseInt(numericValue, 10);
      index += 1 + wordMatch[0].length;

      if (RTF_IGNORABLE_DESTINATIONS.has(controlWord.toLowerCase())) {
        currentState().ignorable = true;
        continue;
      }

      if (currentState().ignorable) {
        continue;
      }

      if (controlWord === 'par' || controlWord === 'line') {
        output += '\n';
        continue;
      }

      if (controlWord === 'tab') {
        output += '\t';
        continue;
      }

      if (controlWord === 'uc' && parameter !== null && !Number.isNaN(parameter)) {
        unicodeSkipCount = Math.max(parameter, 0);
        continue;
      }

      if (controlWord === 'u' && parameter !== null && !Number.isNaN(parameter)) {
        output += String.fromCharCode(parameter < 0 ? 65536 + parameter : parameter);
        pendingUnicodeFallbackSkip = unicodeSkipCount;
      }

      continue;
    }

    if (pendingUnicodeFallbackSkip > 0) {
      pendingUnicodeFallbackSkip -= 1;
      index += 1;
      continue;
    }

    if (!currentState().ignorable) {
      output += char;
    }

    index += 1;
  }

  return [output.trim()];
}

async function extractEmailTextPages(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new ToolError({
      errorCode: 'unsupported_media_type',
      message: 'This email document is empty and cannot be extracted.',
      status: 415,
    });
  }

  const raw = decodeBufferToText(buffer, 'utf-8');
  if (!raw.trim()) {
    throw new ToolError({
      errorCode: 'unsupported_media_type',
      message: 'This email document is empty and cannot be extracted.',
      status: 415,
    });
  }

  const part = parseEmailPart(raw);
  const headerLines = buildEmailHeaderLines(part.headers);
  const bodySegments = collectEmailBodySegments(part);
  const sections = [];

  if (headerLines.length > 0) {
    sections.push(headerLines.join('\n'));
  }

  if (bodySegments.length > 0) {
    sections.push(bodySegments.join('\n\n-----\n\n'));
  }

  return [sections.join('\n\n').trim()];
}

async function extractPdfTextPages(buffer) {
  const pdfParse = require('pdf-parse');
  const pageTexts = [];

  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();
      const text = (textContent.items || [])
        .map((item) => (typeof item.str === 'string' ? item.str : ''))
        .join(' ');
      pageTexts.push(text);
      return text;
    },
  });

  return pageTexts.length > 0 ? pageTexts : [''];
}

// Renders one PDF page to PNG with poppler's pdftoppm. The PDF goes in on stdin and the
// PNG comes back on stdout, so no part of a client document is ever written to disk.
function rasterizePdfPageToPng({ buffer, pageNumber, dpi, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftoppm', [
      '-png',
      '-r', String(dpi),
      '-f', String(pageNumber),
      '-l', String(pageNumber),
      '-',
    ]);

    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`pdftoppm timed out after ${timeoutMs}ms on page ${pageNumber}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (error) => {
      finish(error.code === 'ENOENT'
        ? new Error('pdftoppm is not installed. PDF page rasterization requires poppler-utils.')
        : error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(
          `pdftoppm exited with code ${code} on page ${pageNumber}: `
          + `${Buffer.concat(stderrChunks).toString('utf8').trim().slice(0, 200)}`,
        ));
        return;
      }

      const png = Buffer.concat(stdoutChunks);
      if (png.length === 0) {
        finish(new Error(`pdftoppm produced no image data for page ${pageNumber}`));
        return;
      }

      finish(null, png);
    });

    // EPIPE is expected if pdftoppm rejects the document and exits before reading all input;
    // the non-zero exit code handled above is the meaningful error, so swallow it here.
    child.stdin.on('error', () => {});
    child.stdin.end(buffer);
  });
}

// OCR providers need raster images, not PDFs, so every page is rendered to PNG here rather
// than handed over as a single-page PDF.
async function rasterizePdfIntoPageImages(buffer, options = {}) {
  const { PDFDocument } = require('pdf-lib');
  const dpi = options.dpi || PDF_RASTER_DPI;
  const timeoutMs = options.timeoutMs || PDF_RASTER_PAGE_TIMEOUT_MS;

  let pageCount;
  try {
    pageCount = (await PDFDocument.load(buffer)).getPageCount();
  } catch (error) {
    throw new ToolError({
      errorCode: 'extraction_failed',
      message: `Could not read the page structure of this PDF: ${error instanceof Error ? error.message : String(error)}`,
      status: 502,
    });
  }

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    try {
      pages.push({
        pageNumber,
        mimeType: 'image/png',
        bytes: await rasterizePdfPageToPng({ buffer, pageNumber, dpi, timeoutMs }),
      });
    } catch (error) {
      throw new ToolError({
        errorCode: 'extraction_failed',
        message: `Could not rasterize page ${pageNumber} for OCR: ${error instanceof Error ? error.message : String(error)}`,
        status: 502,
      });
    }
  }

  return pages;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function resolveDownloadFormat({ documentRecord, download }) {
  const normalizedContentType = normalizeMimeType(download.contentType);

  return resolveDocumentFormat({ mime_type: normalizedContentType })
    || resolveDocumentFormat({ name: download.filename })
    || resolveDocumentFormat({ mime_type: documentRecord.mime_type })
    || resolveDocumentFormat({ name: documentRecord.name })
    || resolveDocumentFormat({ title: documentRecord.title });
}

class DocumentTextPipeline {
  constructor({ client, config, ocrProvider, extractors }) {
    this.client = client;
    this.config = config;
    this.ocrProvider = ocrProvider || null;
    this.extractors = {
      extractDocxText,
      extractEmailTextPages,
      extractPdfTextPages,
      extractRtfTextPages,
      rasterizePdfIntoPageImages,
      ...(extractors || {}),
    };
    this.cache = new Map();
  }

  async getDocumentState({ caseUuid, documentRecord }) {
    const cacheKey = getDocumentCacheKey(caseUuid, documentRecord);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = this.buildDocumentState({ documentRecord })
      .catch((error) => {
        this.cache.delete(cacheKey);
        throw error;
      });

    this.cache.set(cacheKey, pending);
    return pending;
  }

  async buildDocumentState({ documentRecord }) {
    const expectedSizeBytes = getDocumentSizeBytes(documentRecord);
    const download = await this.client.downloadDocumentBinary(documentRecord, {
      expectedSizeBytes,
    });

    const format = resolveDownloadFormat({ documentRecord, download });

    if (!format) {
      throw new ToolError({
        errorCode: 'unsupported_media_type',
        message: 'This document type is not supported for phase 2 text extraction.',
        status: 415,
      });
    }

    const extracted = await this.extractDocument({ buffer: download.buffer, format });
    const normalized = normalizeDocumentPages(extracted.pageTexts);
    const chunks = buildChunks(normalized.text);

    return {
      canonicalText: normalized.text,
      chunks: chunks.map((chunk) => ({
        ...chunk,
        ...locatePageRange(normalized.pageOffsets, chunk.startChar, chunk.endChar),
      })),
      ocrModel: extracted.ocrUsed ? this.config.documentOcrModel : null,
      ocrProvider: extracted.ocrUsed ? this.config.documentOcrProvider : null,
      pageCount: normalized.pageOffsets.length,
      pageOffsets: normalized.pageOffsets,
      textSha256: sha256(normalized.text),
      textSource: extracted.textSource,
      totalTextChars: normalized.text.length,
      estimatedTokens: normalized.text.length === 0 ? 0 : Math.ceil(normalized.text.length / 4),
    };
  }

  async extractDocument({ buffer, format }) {
    if (format === 'txt') {
      return {
        pageTexts: [buffer.toString('utf8')],
        textSource: 'plain_text',
        ocrUsed: false,
      };
    }

    if (format === 'docx') {
      return {
        pageTexts: await this.extractors.extractDocxText(buffer),
        textSource: 'docx_text',
        ocrUsed: false,
      };
    }

    if (format === 'rtf') {
      return {
        pageTexts: await this.extractors.extractRtfTextPages(buffer),
        textSource: 'rtf_text',
        ocrUsed: false,
      };
    }

    if (format === 'eml') {
      return {
        pageTexts: await this.extractors.extractEmailTextPages(buffer),
        textSource: 'email_text',
        ocrUsed: false,
      };
    }

    if (format === 'pdf') {
      const embeddedPages = await this.extractors.extractPdfTextPages(buffer);
      const embeddedNormalized = normalizeDocumentPages(embeddedPages);
      const embeddedTextLength = embeddedNormalized.text.replace(/\s/g, '').length;

      if (embeddedTextLength >= PDF_EMBEDDED_TEXT_MIN_CHARS) {
        return {
          pageTexts: embeddedPages,
          textSource: 'pdf_text',
          ocrUsed: false,
        };
      }

      // Both checks run before rasterizing. This document is going to fail either way, and
      // rendering every page first would burn a pdftoppm process per page for nothing.
      // embeddedPages is one entry per page even when a scan yields no text, so it is a usable
      // page count without loading the PDF a second time.
      this.ensureOcrAvailable();
      this.ensureOcrPageBudget(embeddedPages.length);

      const ocrPages = await this.extractWithOcr(await this.extractors.rasterizePdfIntoPageImages(buffer));
      return {
        pageTexts: ocrPages,
        textSource: 'pdf_ocr',
        ocrUsed: true,
      };
    }

    if (format === 'image/png' || format === 'image/jpeg' || format === 'image/webp') {
      const ocrPages = await this.extractWithOcr([{
        pageNumber: 1,
        mimeType: format,
        bytes: buffer,
      }]);

      return {
        pageTexts: ocrPages,
        textSource: 'image_ocr',
        ocrUsed: true,
      };
    }

    throw new ToolError({
      errorCode: 'unsupported_media_type',
      message: 'This document type is not supported for phase 2 text extraction.',
      status: 415,
    });
  }

  ensureOcrAvailable() {
    if (!this.ocrProvider) {
      // Reaches end users through the MCP client, so it names no environment variable: the
      // person reading it is a caseworker who cannot change the server's configuration.
      throw new ToolError({
        errorCode: 'ocr_unavailable',
        message: 'This document requires OCR, which is not enabled on this server.',
        status: 412,
      });
    }
  }

  // Each page is a separate vision API call, so an unbounded document is a cost, latency, and
  // exposure problem all at once. Fail loudly rather than transcribing a truncated prefix and
  // returning it as if it were the whole document.
  ensureOcrPageBudget(pageCount) {
    const maxPages = this.config?.documentOcrMaxPages ?? DEFAULT_DOCUMENT_OCR_MAX_PAGES;

    if (pageCount > maxPages) {
      throw new ToolError({
        errorCode: 'document_too_large',
        message: `This document has ${pageCount} pages requiring OCR, over the ${maxPages}-page limit.`,
        status: 413,
      });
    }
  }

  async extractWithOcr(pages) {
    this.ensureOcrAvailable();
    this.ensureOcrPageBudget(pages.length);

    const results = await this.ocrProvider.extractPages(pages);
    return results.map((page) => page.text || '');
  }
}

function createDocumentTextPipeline({ client, config, ocrProvider, extractors }) {
  return new DocumentTextPipeline({
    client,
    config,
    ocrProvider,
    extractors,
  });
}

module.exports = {
  DocumentTextPipeline,
  buildChunks,
  buildSearchHits,
  createDocumentTextPipeline,
  ensureSearchQuery,
  extractEmailTextPages,
  extractRtfTextPages,
  htmlToPlainText,
  locatePageNumber,
  locatePageRange,
  normalizeDocumentPages,
  normalizePageText,
  rasterizePdfIntoPageImages,
};
