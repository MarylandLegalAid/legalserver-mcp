const { ToolError } = require('../helpers');

const OCR_PROMPT = 'Transcribe this page exactly as plain text. Do not summarize, explain, label, or add commentary.';

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

  throw new Error(`Unsupported OCR provider: ${config.documentOcrProvider}`);
}

module.exports = {
  VertexGeminiOcrProvider,
  createOcrProvider,
  extractResponseText,
};
