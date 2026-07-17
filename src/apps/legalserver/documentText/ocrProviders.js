const { ToolError } = require('../helpers');
const {
  CHAT_VISION_OCR_TIMEOUT_MS,
  OPENAI_CHAT_COMPLETIONS_URL,
  OPENROUTER_CHAT_COMPLETIONS_URL,
} = require('../constants');

const OCR_PROMPT = 'Transcribe this page exactly as plain text. Do not summarize, explain, label, or add commentary.';

// Shared by OpenRouterOcrProvider and OpenAiOcrProvider — both speak the same
// OpenAI-compatible chat completions vision format. `url` is always passed
// explicitly by the caller (never defaulted) so which vendor's servers receive
// the page image is always an unambiguous, visible choice at the call site.
async function callVisionChatCompletionsApi({ url, apiKey, model, page, fetchImpl, timeoutMs }) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: OCR_PROMPT },
          {
            type: 'image_url',
            image_url: {
              url: `data:${page.mimeType};base64,${page.bytes.toString('base64')}`,
            },
          },
        ],
      }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${new URL(url).hostname} returned ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const json = await response.json();
  return String(json?.choices?.[0]?.message?.content || '');
}

function extractResponseText(response) {
  if (!response) {
    return '';
  }

  if (typeof response.text === 'string') {
    return response.text;
  }

  if (typeof response.text === 'function') {
    return response.text();
  }

  const parts = response.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }

  return '';
}

class VertexGeminiOcrProvider {
  constructor({ project, location, model }) {
    this.project = project;
    this.location = location;
    this.model = model;
    this.client = null;
  }

  async getClient() {
    if (this.client) {
      return this.client;
    }

    const { GoogleGenAI } = require('@google/genai');
    this.client = new GoogleGenAI({
      vertexai: true,
      project: this.project,
      location: this.location,
      apiVersion: 'v1',
    });
    return this.client;
  }

  async extractPages(pages) {
    const client = await this.getClient();
    const results = [];

    for (const page of pages) {
      try {
        const response = await client.models.generateContent({
          model: this.model,
          config: {
            temperature: 0,
          },
          contents: [{
            role: 'user',
            parts: [
              { text: OCR_PROMPT },
              {
                inlineData: {
                  data: page.bytes.toString('base64'),
                  mimeType: page.mimeType,
                },
              },
            ],
          }],
        });

        results.push({
          pageNumber: page.pageNumber,
          text: String(await extractResponseText(response) || ''),
        });
      } catch (error) {
        throw new ToolError({
          errorCode: 'extraction_failed',
          message: `OCR failed on page ${page.pageNumber}: ${error instanceof Error ? error.message : String(error)}`,
          status: 502,
        });
      }
    }

    return results;
  }
}

class OpenRouterOcrProvider {
  constructor({ apiKey, model, fetchImpl, timeoutMs }) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl || fetch;
    this.timeoutMs = timeoutMs || CHAT_VISION_OCR_TIMEOUT_MS;
  }

  async extractPages(pages) {
    const results = [];

    for (const page of pages) {
      try {
        const text = await callVisionChatCompletionsApi({
          url: OPENROUTER_CHAT_COMPLETIONS_URL,
          apiKey: this.apiKey,
          model: this.model,
          page,
          fetchImpl: this.fetchImpl,
          timeoutMs: this.timeoutMs,
        });

        results.push({ pageNumber: page.pageNumber, text });
      } catch (error) {
        throw new ToolError({
          errorCode: 'extraction_failed',
          message: `OCR failed on page ${page.pageNumber}: ${error instanceof Error ? error.message : String(error)}`,
          status: 502,
        });
      }
    }

    return results;
  }
}

// Routes page images directly to OpenAI's own API (api.openai.com) — deliberately
// NOT via OpenRouter or any other proxy, so orgs with a ZDR/BAA agreement scoped to
// OpenAI specifically can rely on that agreement covering this traffic.
class OpenAiOcrProvider {
  constructor({ apiKey, model, fetchImpl, timeoutMs }) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl || fetch;
    this.timeoutMs = timeoutMs || CHAT_VISION_OCR_TIMEOUT_MS;
  }

  async extractPages(pages) {
    const results = [];

    for (const page of pages) {
      try {
        const text = await callVisionChatCompletionsApi({
          url: OPENAI_CHAT_COMPLETIONS_URL,
          apiKey: this.apiKey,
          model: this.model,
          page,
          fetchImpl: this.fetchImpl,
          timeoutMs: this.timeoutMs,
        });

        results.push({ pageNumber: page.pageNumber, text });
      } catch (error) {
        throw new ToolError({
          errorCode: 'extraction_failed',
          message: `OCR failed on page ${page.pageNumber}: ${error instanceof Error ? error.message : String(error)}`,
          status: 502,
        });
      }
    }

    return results;
  }
}

function createOcrProvider(config) {
  if (!config || !config.documentOcrProvider || config.documentOcrProvider === 'none') {
    return null;
  }

  if (config.documentOcrProvider === 'vertex_gemini') {
    return new VertexGeminiOcrProvider({
      project: config.googleCloudProject,
      location: config.googleCloudLocation,
      model: config.documentOcrModel,
    });
  }

  if (config.documentOcrProvider === 'openrouter') {
    return new OpenRouterOcrProvider({
      apiKey: config.openRouterApiKey,
      model: config.documentOcrModel,
    });
  }

  if (config.documentOcrProvider === 'openai') {
    return new OpenAiOcrProvider({
      apiKey: config.openAiApiKey,
      model: config.documentOcrModel,
    });
  }

  throw new Error(`Unsupported OCR provider: ${config.documentOcrProvider}`);
}

module.exports = {
  OpenAiOcrProvider,
  OpenRouterOcrProvider,
  VertexGeminiOcrProvider,
  createOcrProvider,
  extractResponseText,
};
