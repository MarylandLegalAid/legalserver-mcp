/**
 * Entry point for the Modular LegalServer AI Assistant.
 * Routes Google Chat requests, persists session state, and delegates orchestration.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { GoogleAuth } = require('google-auth-library');

const {
  getSession,
  cancelSession,
  appendUserMessage,
  isSessionCancelled,
  appendAssistantEvents,
  persistPrefetchState
} = require('./sessionStore');
const { sendAck, extractIncomingMessage, createPushMessage } = require('./chatTransport');
const { detectModes, applyCaseRouting, prefetchByMode } = require('./modeRouter');
const { runOrchestration } = require('./orchestrator');
const { allHandlers, toolDeclarations, INSPECTION_CHECKLIST } = require('./toolRegistry');

const PROJECT_ID = process.env.PROJECT_ID;
const LOCATION = process.env.LOCATION;
const PORT = process.env.PORT || 8080;
const MODELS = {
  flash: process.env.MODEL_FLASH
};
const MAX_HISTORY_ENTRIES_USER = 4;

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/chat.bot']
});
const pushMessage = createPushMessage(auth);

const app = express();
app.use(express.json());

app.post('/google-chat', async (req, res) => {
  sendAck(res);

  try {
    const { userText, spaceName } = extractIncomingMessage(req);
    if (!userText || !spaceName) return;

    const sessionId = spaceName.replace(/\//g, '_');
    let memory = await getSession(sessionId);

    if (userText.toLowerCase() === 'stop' || userText.toLowerCase() === 'cancel') {
      await cancelSession(sessionId);
      await pushMessage('Stopping... History cleared.', spaceName);
      return;
    }

    memory = applyCaseRouting(memory, userText);
    const modes = detectModes(userText);
    const turnId = uuidv4();

    memory = await appendUserMessage(sessionId, {
      text: userText,
      turnId,
      caseNumber: memory.caseNumber,
      resetHistory: !!memory.resetHistory,
      maxHistoryEntriesUser: MAX_HISTORY_ENTRIES_USER
    });

    const modeResult = await prefetchByMode({
      memory,
      userText,
      modes,
      allHandlers,
      inspectionChecklist: INSPECTION_CHECKLIST
    });
    memory = modeResult.memory;
    if (modeResult.prefetchChangedHistory || modeResult.prefetchChangedInstruction) {
      await persistPrefetchState(sessionId, {
        turnId,
        caseNumber: memory.caseNumber,
        prefetchedUserText: modeResult.prefetchedUserText,
        activeInstruction: modeResult.activeInstruction
      });
    }

    (async () => {
      await runOrchestration({
        auth,
        projectId: PROJECT_ID,
        location: LOCATION,
        modelId: MODELS.flash,
        memory,
        sessionId,
        spaceName,
        turnId,
        activeInstruction: modeResult.activeInstruction,
        allHandlers,
        toolDeclarations,
        pushMessage,
        isSessionCancelled,
        appendAssistantEvents
      });
    })();
  } catch (outerErr) {
    console.error('Outer error:', outerErr);
  }
});

app.listen(PORT, () => console.log(`Modular LegalServer MCP Active on Port ${PORT}`));
