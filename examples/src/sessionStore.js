const { Firestore, FieldValue } = require('@google-cloud/firestore');

const db = new Firestore({ ignoreUndefinedProperties: true });
const SESSIONS_COLLECTION = process.env.FIRESTORE_SESSIONS_COLLECTION || 'sessions';

function getSessionRef(sessionId) {
  return db.collection(SESSIONS_COLLECTION).doc(sessionId);
}

function normalizeSession(data) {
  return {
    caseNumber: data?.caseNumber || 'None',
    history: Array.isArray(data?.history) ? data.history : [],
    cancelled: !!data?.cancelled,
    activeInstruction: data?.activeInstruction
  };
}

async function getSession(sessionId) {
  const snap = await getSessionRef(sessionId).get();
  return normalizeSession(snap.exists ? snap.data() : null);
}

async function cancelSession(sessionId) {
  const ref = getSessionRef(sessionId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeSession(snap.exists ? snap.data() : null);
    tx.set(ref, {
      caseNumber: current.caseNumber,
      history: [],
      cancelled: true,
      lastActive: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function isSessionCancelled(sessionId) {
  const snap = await getSessionRef(sessionId).get();
  return !!snap.data()?.cancelled;
}

async function appendUserMessage(sessionId, {
  text,
  turnId,
  caseNumber,
  resetHistory = false,
  maxHistoryEntriesUser = 4
}) {
  const ref = getSessionRef(sessionId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeSession(snap.exists ? snap.data() : null);

    let history = resetHistory ? [] : [...current.history];
    history.push({
      role: 'user',
      turn_id: turnId,
      parts: [{ text }]
    });
    if (history.length > maxHistoryEntriesUser) {
      history = history.slice(-maxHistoryEntriesUser);
    }

    const updatedSession = {
      caseNumber: resetHistory ? (caseNumber || current.caseNumber) : current.caseNumber,
      history,
      cancelled: false
    };

    tx.set(ref, {
      ...updatedSession,
      lastActive: FieldValue.serverTimestamp()
    }, { merge: true });

    return updatedSession;
  });
}

async function appendAssistantEvents(sessionId, { turnId, caseNumber, events = [], manageHistory }) {
  const ref = getSessionRef(sessionId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeSession(snap.exists ? snap.data() : null);

    if (caseNumber && current.caseNumber !== caseNumber) {
      return { applied: false, reason: 'case_mismatch' };
    }

    const normalizedEvents = events.map((event) => ({ ...event, turn_id: turnId }));
    let history = [...current.history, ...normalizedEvents];
    if (typeof manageHistory === 'function') {
      history = manageHistory(history);
    }

    tx.set(ref, {
      caseNumber: current.caseNumber,
      history,
      cancelled: current.cancelled,
      lastActive: FieldValue.serverTimestamp()
    }, { merge: true });

    return { applied: true };
  });
}

async function persistPrefetchState(sessionId, {
  turnId,
  caseNumber,
  prefetchedUserText,
  activeInstruction
}) {
  const ref = getSessionRef(sessionId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeSession(snap.exists ? snap.data() : null);

    if (caseNumber && current.caseNumber !== caseNumber) {
      return { applied: false, reason: 'case_mismatch' };
    }

    let history = [...current.history];
    const idx = history.findIndex((entry) => entry.role === 'user' && entry.turn_id === turnId);
    if (typeof prefetchedUserText === 'string' && prefetchedUserText.length > 0) {
      if (idx >= 0) {
        history[idx] = { ...history[idx], parts: [{ text: prefetchedUserText }] };
      } else {
        history.push({ role: 'user', turn_id: turnId, parts: [{ text: prefetchedUserText }] });
      }
    }

    tx.set(ref, {
      caseNumber: current.caseNumber,
      history,
      cancelled: current.cancelled,
      activeInstruction: activeInstruction || current.activeInstruction,
      lastActive: FieldValue.serverTimestamp()
    }, { merge: true });

    return { applied: true };
  });
}

module.exports = {
  getSession,
  cancelSession,
  isSessionCancelled,
  appendUserMessage,
  appendAssistantEvents,
  persistPrefetchState
};
