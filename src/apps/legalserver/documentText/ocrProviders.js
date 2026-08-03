const { ToolError } = require('../helpers');
const {
  CHAT_VISION_OCR_TIMEOUT_MS,
  OPENAI_CHAT_COMPLETIONS_URL,
} = require('../constants');

const OCR_PROMPT = 'Transcribe this page exactly as plain text. Do not summarize, explain, label, or add commentary.';

// Routes page images directly to OpenAI's own API (api.openai.com) — deliberately NOT via
// OpenRouter or any other proxy, so orgs whose data-handling agreement (zero data retention,
// a BAA) is scoped to OpenAI specifically can rely on it covering this traffic. OpenAI is the
// only supported OCR vendor for that reason; see "OCR" in README.md.
class OpenAiOcrProvider {
  constructor({ apiKey, model, fetchImpl, timeoutMs }) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl || fetch;
    this.timeoutMs = timeoutMs || CHAT_VISION_OCR_TIMEOUT_MS;
  }

  async extractPage(page) {
    const response = await this.fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
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
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`api.openai.com returned ${response.status}`);
    }

    const json = await response.json();
    return String(json?.choices?.[0]?.message?.content || '');
  }

  async extractPages(pages) {
    const results = [];

    for (const page of pages) {
      try {
        results.push({ pageNumber: page.pageNumber, text: await this.extractPage(page) });
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
  createOcrProvider,
};
