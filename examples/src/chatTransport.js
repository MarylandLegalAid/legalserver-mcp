function sendAck(res) {
  res.json({});
}

function extractIncomingMessage(req) {
  const payload = req.body.chat?.messagePayload || req.body;
  const userText = payload.message?.text?.trim() || '';
  const spaceName = payload.message?.space?.name;
  return { userText, spaceName };
}

function createPushMessage(auth) {
  let cachedClient = null;
  let cachedToken = null;
  let tokenFetchedAt = 0;
  const TOKEN_TTL_MS = 50 * 60 * 1000;
  const PUSH_MAX_RETRIES = 3;
  const PUSH_BASE_DELAY_MS = 400;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isTransientPushError(error) {
    const msg = (error?.message || '').toLowerCase();
    const causeCode = error?.cause?.code;
    return (
      msg.includes('fetch failed') ||
      msg.includes('socket') ||
      causeCode === 'UND_ERR_SOCKET' ||
      causeCode === 'ECONNRESET' ||
      causeCode === 'ETIMEDOUT'
    );
  }

  async function getToken(forceRefresh = false) {
    const now = Date.now();
    if (!cachedClient) {
      cachedClient = await auth.getClient();
    }
    if (!forceRefresh && cachedToken && (now - tokenFetchedAt) < TOKEN_TTL_MS) {
      return cachedToken;
    }

    cachedToken = (await cachedClient.getAccessToken()).token;
    tokenFetchedAt = now;
    return cachedToken;
  }

  function splitForChat(text, maxChars = 3500) {
    const source = String(text || '');
    if (source.length <= maxChars) return [source];

    const chunks = [];
    let remaining = source;
    while (remaining.length > maxChars) {
      let cut = remaining.lastIndexOf('\n\n', maxChars);
      if (cut < Math.floor(maxChars * 0.6)) {
        cut = remaining.lastIndexOf('\n', maxChars);
      }
      if (cut < Math.floor(maxChars * 0.4)) {
        cut = maxChars;
      }
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
  }

  async function sendSingleMessage(text, spaceName) {
    let lastError = null;
    for (let attempt = 0; attempt <= PUSH_MAX_RETRIES; attempt++) {
      try {
        let token = await getToken(false);
        let response = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text })
        });

        if (response.status === 401 || response.status === 403) {
          token = await getToken(true);
          response = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
          });
        }

        if ((response.status === 429 || response.status >= 500) && attempt < PUSH_MAX_RETRIES) {
          const waitMs = PUSH_BASE_DELAY_MS * (attempt + 1);
          console.warn(`Push transient status ${response.status}. Retrying in ${waitMs}ms...`);
          await delay(waitMs);
          continue;
        }

        if (!response.ok) {
          throw new Error(`Chat API error: ${response.status}`);
        }

        return;
      } catch (error) {
        lastError = error;
        if (attempt >= PUSH_MAX_RETRIES || !isTransientPushError(error)) {
          throw error;
        }
        const waitMs = PUSH_BASE_DELAY_MS * (attempt + 1);
        console.warn(`Push transient network error (${error?.cause?.code || error.message}). Retrying in ${waitMs}ms...`);
        await delay(waitMs);
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  return async function pushMessage(text, spaceName) {
    try {
      const chunks = splitForChat(text);
      for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks.length > 1
          ? `[Part ${i + 1}/${chunks.length}]\n${chunks[i]}`
          : chunks[i];
        await sendSingleMessage(chunkText, spaceName);
      }
    } catch (error) {
      console.error('Push Failed:', error.message);
    }
  };
}

module.exports = {
  sendAck,
  extractIncomingMessage,
  createPushMessage
};
