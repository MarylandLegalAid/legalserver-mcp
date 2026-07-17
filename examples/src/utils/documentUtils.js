/**
 * Document Processing Utility Library.
 * Handles text extraction from digital formats (PDF, DOCX, TXT) with multimodal OCR fallback.
 * Uses Gemini Vision models for page-by-page visual analysis of scanned images.
 * * Dependencies: Requires PROJECT_ID and LOCATION environment variables for Vertex AI access.
 */

const mammoth = require('mammoth');
const { GoogleAuth } = require('google-auth-library');
const pdf = require('pdf-parse');

const PROJECT_ID = process.env.PROJECT_ID;
const LOCATION = process.env.LOCATION;

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

function extractFilenameFromDisposition(disposition) {
  if (!disposition) return undefined;
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  if (!match) return undefined;
  return decodeURIComponent(match[1] || match[2]);
}

function guessMimeTypeFromName(name) {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.rtf')) return 'application/rtf';
  return undefined;
}

function cleanText(text) {
  if (!text) return "";
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

function chunkText(text, maxChars) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

function coerceGeminiMimeType(mimeType, fileName) {
  const lowerMime = (mimeType || '').toLowerCase();
  if (lowerMime && lowerMime !== 'application/octet-stream') return mimeType;

  const guessed = guessMimeTypeFromName(fileName);
  if (guessed === 'application/pdf') return 'application/pdf';
  if (guessed && guessed.startsWith('image/')) return guessed;
  return 'application/pdf';
}

async function extractTextFromBuffer(content, mimeType, identifier, maxPages = 0, options = {}) {
  const { allowOcrFallback = true, diagnostics = null } = options;
  let fullText = "";
  
  try {
    if (mimeType.startsWith('text/') || mimeType.includes('plain')) {
      fullText = content.toString('utf-8');
    } 
    else if (mimeType.includes('pdf') || (identifier && identifier.toLowerCase().endsWith('.pdf'))) {
      const parseOptions = maxPages > 0 ? { max: maxPages } : {};
      const data = await pdf(content, parseOptions);
      fullText = data.text || "";
      if (diagnostics) {
        diagnostics.pageCount = data.numpages || data.numrender || null;
      }
      if (!fullText && allowOcrFallback) {
        console.warn(`PDF text extraction failed for ${identifier}. Attempting multimodal OCR fallback.`);
        fullText = await ocrDocumentWithGemini(content, mimeType, "Extract all text from this document.", { fileName: identifier });
      }
    } 
    else if (mimeType.includes('word') || mimeType.includes('officedocument')) {
      const result = await mammoth.extractRawText({ buffer: content });
      fullText = result.value;
    } 
    else {
      console.warn(`Unsupported format for ${identifier}: ${mimeType}. Falling back to string conversion.`);
      fullText = content.toString('utf-8').substring(0, 2000);
    }
  } catch (err) {
    console.error(`Extraction failed for ${identifier}:`, err.message);
    return "";
  }

  if (diagnostics) {
    diagnostics.extractedChars = (fullText || '').length;
  }
  
  return fullText;
}

function isImageLikeDocument(name, mimeType) {
  const lowerName = (name || '').toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();

  if (lowerMime.startsWith('image/')) return true;
  return ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif', '.webp', '.heic'].some((ext) => lowerName.endsWith(ext));
}

function textContainsAnyPhrase(text, phrases = []) {
  if (!text || !Array.isArray(phrases) || phrases.length === 0) return false;
  const normalizedText = String(text).toUpperCase().replace(/\s+/g, ' ').trim();
  return phrases.some((phrase) => {
    const normalizedPhrase = String(phrase || '').toUpperCase().replace(/\s+/g, ' ').trim();
    return normalizedPhrase && normalizedText.includes(normalizedPhrase);
  });
}

async function ocrDocumentWithGemini(fileBuffer, mimeType, query, options = {}) {
  try {
    const OCR_MODEL = options.modelId || process.env.MODEL_LITE || "gemini-2.0-flash-lite";
    const fileName = options.fileName;
    const client = await auth.getClient();
    const token = (await client.getAccessToken()).token;
    const MAX_RETRIES = 2;
    const BASE_RETRY_DELAY_MS = 500;

    const safeMimeType = coerceGeminiMimeType(mimeType, fileName);

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${OCR_MODEL}:generateContent`;
    
    const prompt = `Perform a page-by-page scan of this entire document from the first page to the last. Does this document contain "CITIZENSHIP VERIFICATION" or "NON-CITIZEN RESIDENT STATUS VERIFICATION"? If either phrase appears on ANY page, respond with ONLY the word TRUE. If you have checked every single page and found neither phrase, respond with FALSE.`;

    const effectivePrompt = query.startsWith("Extract all text") 
      ? "Extract all text from this document page by page." 
      : prompt;

    const isExtraction = query.startsWith("Extract all text");

    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: effectivePrompt },
          { inlineData: { mimeType: safeMimeType, data: fileBuffer.toString('base64') } }
        ]
      }],
      generationConfig: { 
        maxOutputTokens: isExtraction ? 8192 : 5, 
        temperature: 0.0 
      }
    };

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isTransient = (err) => {
      const msg = (err?.message || '').toLowerCase();
      const code = err?.cause?.code;
      return (
        msg.includes('fetch failed') ||
        msg.includes('socket') ||
        code === 'UND_ERR_SOCKET' ||
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT'
      );
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
          const waitMs = BASE_RETRY_DELAY_MS * (attempt + 1);
          console.warn(`Gemini OCR transient status ${response.status}. Retrying in ${waitMs}ms...`);
          await delay(waitMs);
          continue;
        }

        if (!response.ok) throw new Error(`Gemini OCR error: ${response.status}`);
        const responseData = await response.json();
        const resultText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return isExtraction
          ? resultText
          : resultText.toUpperCase().includes("TRUE");
      } catch (err) {
        if (attempt >= MAX_RETRIES || !isTransient(err)) {
          throw err;
        }
        const waitMs = BASE_RETRY_DELAY_MS * (attempt + 1);
        console.warn(`Gemini OCR transient network error (${err?.cause?.code || err.message}). Retrying in ${waitMs}ms...`);
        await delay(waitMs);
      }
    }

    return false;
  } catch (e) {
    console.error("Analysis Failed:", e.message);
    return false;
  }
}

module.exports = {
  extractFilenameFromDisposition,
  guessMimeTypeFromName,
  coerceGeminiMimeType,
  cleanText,
  chunkText,
  extractTextFromBuffer,
  isImageLikeDocument,
  textContainsAnyPhrase,
  ocrDocumentWithGemini
};
