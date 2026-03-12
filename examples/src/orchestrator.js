const { optimizeForVertex } = require('./utils/legalClient');

const MAX_HISTORY_ENTRIES_FINAL = 6;
const MAX_HISTORY_BYTES_SOFT = 400 * 1024;
const MAX_HISTORY_BYTES_HARD = 900 * 1024;
const MAX_NOTES_TO_SEND = 40;
const GEMINI_MAX_RETRIES = 3;
const GEMINI_BASE_RETRY_DELAY_MS = 600;

function filterAndTruncateNotes(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.notes && Array.isArray(data.notes)) {
    data.notes = data.notes
      .filter((note) => !(note.created_by?.user_name || '').toLowerCase().includes('system user'))
      .map((note) => {
        if (note.body && note.body.length > 2000) {
          note.body = `${note.body.substring(0, 2000)}... [Truncated]`;
        }
        return note;
      })
      .slice(-MAX_NOTES_TO_SEND);
  }
  return data;
}

function manageHistory(history) {
  let managedHistory = [...history];

  if (managedHistory.length > MAX_HISTORY_ENTRIES_FINAL) {
    managedHistory = managedHistory.slice(-MAX_HISTORY_ENTRIES_FINAL);
  }

  let historyBytes = Buffer.byteLength(JSON.stringify(managedHistory));
  while (historyBytes > MAX_HISTORY_BYTES_SOFT && managedHistory.length > 2) {
    managedHistory.splice(0, 2);
    historyBytes = Buffer.byteLength(JSON.stringify(managedHistory));
  }

  if (historyBytes > MAX_HISTORY_BYTES_HARD) {
    managedHistory = managedHistory.slice(-2);
  }
  return managedHistory;
}

function sanitizeHistoryForGemini(history) {
  return history.map((entry) => ({
    role: entry.role,
    parts: entry.parts
  }));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFetchError(error) {
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

async function runOrchestration({
  auth,
  projectId,
  location,
  modelId,
  memory,
  sessionId,
  spaceName,
  turnId,
  activeInstruction,
  allHandlers,
  toolDeclarations,
  pushMessage,
  isSessionCancelled,
  appendAssistantEvents
}) {
  try {
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
    let totalPromptTokens = 0;
    let totalOutputTokens = 0;
    const authClient = await auth.getClient();
    let geminiAccessToken = (await authClient.getAccessToken()).token;

    const refreshGeminiToken = async () => {
      geminiAccessToken = (await authClient.getAccessToken()).token;
      return geminiAccessToken;
    };

    const persistEventsIncremental = async (events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      await appendAssistantEvents(sessionId, {
        turnId,
        caseNumber: memory.caseNumber,
        events,
        manageHistory
      });
    };

    const callGemini = async (history, retryAuth = true) => {
      const safeHistory = sanitizeHistoryForGemini(manageHistory(history));
      const requestBody = JSON.stringify({
        system_instruction: { parts: [{ text: activeInstruction }] },
        contents: safeHistory,
        tools: [{ function_declarations: toolDeclarations }]
      });

      let lastError = null;
      for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${geminiAccessToken}`,
              'Content-Type': 'application/json'
            },
            body: requestBody
          });

          if ((response.status === 401 || response.status === 403) && retryAuth) {
            await refreshGeminiToken();
            return callGemini(history, false);
          }

          if ((response.status === 429 || response.status >= 500) && attempt < GEMINI_MAX_RETRIES) {
            const waitMs = GEMINI_BASE_RETRY_DELAY_MS * (attempt + 1);
            console.warn(`Gemini transient status ${response.status}. Retrying in ${waitMs}ms...`);
            await delay(waitMs);
            continue;
          }

          let data;
          try {
            data = await response.json();
          } catch {
            const rawText = await response.text();
            throw new Error(`Gemini response parse error (status ${response.status}): ${rawText.slice(0, 500)}`);
          }

          if (!response.ok) {
            throw new Error(`Gemini API error ${response.status}: ${JSON.stringify(data?.error || data).slice(0, 800)}`);
          }

          totalPromptTokens += data.usageMetadata?.promptTokenCount || 0;
          totalOutputTokens += data.usageMetadata?.candidatesTokenCount || 0;
          return { data };
        } catch (error) {
          lastError = error;
          if (attempt >= GEMINI_MAX_RETRIES || !isTransientFetchError(error)) {
            throw error;
          }
          const waitMs = GEMINI_BASE_RETRY_DELAY_MS * (attempt + 1);
          console.warn(`Gemini transient network error (${error?.cause?.code || error.message}). Retrying in ${waitMs}ms...`);
          await delay(waitMs);
        }
      }

      throw lastError || new Error('Gemini request failed after retries.');
    };

    let liveConversation = JSON.parse(JSON.stringify(memory.history));
    let geminiRes = await callGemini(liveConversation);
    if (!geminiRes.data.candidates || geminiRes.data.candidates.length === 0) {
      const errorDetails = JSON.stringify(geminiRes.data.error || geminiRes.data, null, 2);
      throw new Error(`The API returned no candidates, possibly due to a large payload or safety filter. Details: ${errorDetails}`);
    }

    let parts = geminiRes.data.candidates[0].content.parts || [];
    let functionCalls = parts.filter((part) => part.functionCall);

    let hasSentScanUpdate = false;

    while (functionCalls.length > 0) {
      const cancelled = await isSessionCancelled(sessionId);
      if (cancelled) {
        await pushMessage('Audit Cancelled.', spaceName);
        return;
      }

      if (!hasSentScanUpdate && functionCalls.some((part) => part.functionCall.name === 'scan_case_documents')) {
        await pushMessage('Analyzing documents. Starting deep scan for verification documents now (this may take 1-2 minutes)...', spaceName);
        hasSentScanUpdate = true;
      }

      const rawFunctionResponses = [];
      const slimFunctionResponses = [];

      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        try {
          let toolResult = await allHandlers[name](args);
          toolResult = optimizeForVertex(filterAndTruncateNotes(toolResult));

          if (name === 'create_intake_notes' && toolResult.system_prompt_addition) {
            activeInstruction = toolResult.system_prompt_addition;
          }

          rawFunctionResponses.push({ functionResponse: { name, response: { content: toolResult } } });

          const slimResult = JSON.parse(JSON.stringify(toolResult));
          if (slimResult.text) slimResult.text = `${(slimResult.text || '').substring(0, 400)}... [Trunc]`;
          if (slimResult.system_data) slimResult.system_data = '[Omitted]';
          if (Array.isArray(slimResult.documents)) slimResult.documents = slimResult.documents.slice(0, 3);
          slimFunctionResponses.push({ functionResponse: { name, response: { content: slimResult } } });
        } catch (toolError) {
          const errPayload = { functionResponse: { name, response: { content: { error: toolError.message } } } };
          rawFunctionResponses.push(errPayload);
          slimFunctionResponses.push(errPayload);
        }
      }

      const modelEvent = { role: 'model', parts };
      const functionEvent = { role: 'function', parts: slimFunctionResponses };
      memory.history.push(modelEvent);
      memory.history.push(functionEvent);
      await persistEventsIncremental([modelEvent, functionEvent]);

      liveConversation = JSON.parse(JSON.stringify(memory.history));
      liveConversation[liveConversation.length - 1] = { role: 'function', parts: rawFunctionResponses };

      geminiRes = await callGemini(liveConversation);
      if (!geminiRes.data.candidates || geminiRes.data.candidates.length === 0) {
        const errorDetails = JSON.stringify(geminiRes.data.error || geminiRes.data, null, 2);
        throw new Error(`The API returned no candidates, possibly due to a large payload or safety filter. Details: ${errorDetails}`);
      }

      parts = geminiRes.data.candidates[0].content.parts || [];
      functionCalls = parts.filter((part) => part.functionCall);
    }

    const finalPart = parts.find((part) => part.text);
    if (finalPart?.text) {
      const reply = finalPart.text;
      const finalEvent = { role: 'model', parts: [{ text: reply }] };
      memory.history.push(finalEvent);
      await persistEventsIncremental([finalEvent]);

      const totalCost = ((totalPromptTokens / 1000000) * 0.30 + (totalOutputTokens / 1000000) * 0.90).toFixed(4);
      const stats = `\n\n---\nUsage: In: ${totalPromptTokens} | Out: ${totalOutputTokens} | Cost: $${totalCost} | Active Case: ${memory.caseNumber}`;
      await pushMessage(reply + stats, spaceName);
    }
  } catch (innerErr) {
    console.error('Inner processing error:', innerErr);
    await pushMessage('Internal error. Please try again or type "stop".', spaceName);
  }
}

module.exports = {
  runOrchestration
};
