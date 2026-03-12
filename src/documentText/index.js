const crypto = require('node:crypto');
const {
  DOCUMENT_CHUNK_BOUNDARY_LOOKBACK_CHARS,
  DOCUMENT_CHUNK_OVERLAP_CHARS,
  DOCUMENT_CHUNK_TARGET_CHARS,
  DOCUMENT_SEARCH_SNIPPET_MAX_CHARS,
  PDF_EMBEDDED_TEXT_MIN_CHARS,
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

async function splitPdfIntoSinglePageBuffers(buffer) {
  const { PDFDocument } = require('pdf-lib');
  const source = await PDFDocument.load(buffer);
  const pages = [];

  for (let index = 0; index < source.getPageCount(); index += 1) {
    const pdf = await PDFDocument.create();
    const [page] = await pdf.copyPages(source, [index]);
    pdf.addPage(page);
    pages.push({
      pageNumber: index + 1,
      mimeType: 'application/pdf',
      bytes: Buffer.from(await pdf.save()),
    });
  }

  return pages;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

class DocumentTextPipeline {
  constructor({ client, config, ocrProvider, extractors }) {
    this.client = client;
    this.config = config;
    this.ocrProvider = ocrProvider || null;
    this.extractors = {
      extractDocxText,
      extractPdfTextPages,
      splitPdfIntoSinglePageBuffers,
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
    if (!documentRecord.download_url) {
      throw new ToolError({
        errorCode: 'extraction_failed',
        message: 'Document metadata did not include a LegalServer download URL.',
        status: 502,
      });
    }

    const download = await this.client.downloadBinary(documentRecord.download_url, {
      expectedSizeBytes,
    });

    const format = resolveDocumentFormat({
      ...documentRecord,
      mime_type: normalizeMimeType(download.contentType) || documentRecord.mime_type,
    });

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

      const ocrPages = await this.extractWithOcr(await this.extractors.splitPdfIntoSinglePageBuffers(buffer));
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

  async extractWithOcr(pages) {
    if (!this.ocrProvider) {
      throw new ToolError({
        errorCode: 'ocr_unavailable',
        message: 'OCR is required for this document, but DOCUMENT_OCR_PROVIDER is not configured.',
        status: 412,
      });
    }

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
  locatePageNumber,
  locatePageRange,
  normalizeDocumentPages,
  normalizePageText,
};
