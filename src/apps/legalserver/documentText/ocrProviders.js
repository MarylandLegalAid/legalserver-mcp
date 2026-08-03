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
        // Hardcoded, and deliberately not configurable — there is no env var that turns this
        // off. These requests carry page images of scanned client documents, and `store: false`
        // keeps them from being retained as a retrievable object (dashboard logs, API-side
        // conversation state, evals/distillation).
        //
        // It is NOT zero retention. Abuse-monitoring retention is governed by a ZDR agreement on
        // the operator's own OpenAI account, which this code cannot assert — and even ZDR does
        // not cover an image the CSAM classifier flags for manual review. See "When OCR ships,
        // Zero Data Retention is your responsibility" in README.md.
        //
        // Worth knowing if this ever moves to the Responses API: `store` defaults to true there,
        // so sending it explicitly is what makes this survive an endpoint migration.
        store: false,
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

    // No `user` / `safety_identifier` field is sent, deliberately. The server has the signed-in
    // staff member's email in request context and passing it here would be trivial, but that
    // attaches an identifiable legal-aid worker to every scanned client document.

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
