function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const withBreaks = String(value)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n');

  const stripped = withBreaks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(stripped);

  return decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function truncateText(value, maxChars) {
  const text = String(value ?? '');
  if (text.length <= maxChars) {
    return {
      text,
      truncated: false,
    };
  }

  return {
    text: text.slice(0, maxChars),
    truncated: true,
  };
}

function makePreview(value, maxChars) {
  if (value === undefined || value === null || value === '') {
    return {
      preview: null,
      truncated: false,
    };
  }

  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return {
    preview: truncateText(normalized, maxChars).text || null,
    truncated: normalized.length > maxChars,
  };
}

module.exports = {
  htmlToText,
  makePreview,
  truncateText,
};
