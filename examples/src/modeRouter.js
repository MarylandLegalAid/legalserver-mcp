const { optimizeForVertex } = require('./utils/legalClient');

const CASE_PATTERN = /\d{2}[\s\-\u2013\u2014]+\d+/;
let cachedCreateIntakeNotesHandler = null;

function getCreateIntakeNotesHandler() {
  if (!cachedCreateIntakeNotesHandler) {
    const { factsSummaryHandlers } = require('./skills/intakeNotes');
    cachedCreateIntakeNotesHandler = factsSummaryHandlers.create_intake_notes;
  }
  return cachedCreateIntakeNotesHandler;
}

function detectModes(userText) {
  const lower = userText.toLowerCase();
  return {
    isInspectionMode: lower.includes('inspection') || lower.includes('audit'),
    isIntakeNotesMode: lower.includes('intake notes')
  };
}

function normalizeCaseNumber(rawCaseText) {
  return rawCaseText.replace(/[\s\u2013\u2014]/g, '-').replace(/-+/g, '-');
}

function applyCaseRouting(memory, userText) {
  const next = { ...memory, resetHistory: false };
  const caseMatch = userText.match(CASE_PATTERN);
  if (!caseMatch) {
    return next;
  }

  const cleanCase = normalizeCaseNumber(caseMatch[0]);
  if (cleanCase !== next.caseNumber) {
    next.caseNumber = cleanCase;
    next.history = [];
    next.resetHistory = true;
  }

  return next;
}

function buildBaseInstruction(caseNumber) {
  return `You are the LegalServer AI Assistant. Your job is to summarize case information in a professional narrative format that is easy for a legal advocate to consume.

**HIERARCHY OF TOOLS (Strict Routing):**
1. DEFAULT: For summaries, status checks, or general questions, ALWAYS use 'get_case_info'. 
2. INTAKE NOTES: ONLY use 'create_intake_notes' if the user specifically says "Create Intake Notes".
3. INSPECTION: ONLY use 'get_inspection_data' if the user specifically says "Inspection" or "Audit".

**SUMMARY FORMATTING RULES:**
If not asked for a specific skill (like an Audit), provide a narrative "Case Profile" using these headers:
- **Matter Overview**: Summarize client name, case status, disposition (if closed), and current handlers.
- **Legal Issue**: Explain the legal problem code and category.
- **Case Summary**: Synthesize the substantive notes into a concise chronological narrative, highlighting key legal milestones and outcomes.

CRITICAL: 
- Do NOT simply dump JSON. Use bold headers and bullet points.
- If the user mentions a Case Number DIFFERENT from the "Active Case" below, you must prioritize the new number and reset history.
- You must take initiative to find data yourself; do not ask the user for UUIDs.

ACTIVE SESSION DATA:
- Current Case: ${caseNumber}`;
}

async function prefetchByMode({ memory, userText, modes, allHandlers, inspectionChecklist }) {
  const { isInspectionMode, isIntakeNotesMode } = modes;
  const baseInstruction = buildBaseInstruction(memory.caseNumber);
  let prefetchChangedHistory = false;
  let prefetchChangedInstruction = false;
  let prefetchedUserText;

  let activeInstruction = (isInspectionMode && !isIntakeNotesMode)
    ? inspectionChecklist
    : `${baseInstruction}\nCRITICAL: If the request is a general summary, use 'get_case_info' only. DO NOT explain your steps. Just execute tools.`;

  if (isInspectionMode && !isIntakeNotesMode) {
    try {
      const caseInfo = await allHandlers.search_case_by_number({ case_number: memory.caseNumber });
      if (caseInfo && caseInfo.id) {
        const [inspectionData, clientMatters] = await Promise.all([
          allHandlers.get_inspection_data({ case_uuid: caseInfo.id }),
          allHandlers.list_client_matters({
            case_uuid: caseInfo.id,
            current_case_number: memory.caseNumber
          })
        ]);

        const { notes, ...auditData } = inspectionData;
        const consolidatedContext = {
          audit_context: optimizeForVertex(auditData),
          notes,
          other_matters: Array.isArray(clientMatters) ? clientMatters : []
        };

        const inspectionRequestText = `
              **USER REQUEST:** ${userText}

              --- PRE-FETCHED AUDIT DATA ---
              ${JSON.stringify(consolidatedContext, null, 2)}
              `;
        memory.history[memory.history.length - 1].parts[0].text = inspectionRequestText;
        prefetchedUserText = inspectionRequestText;
        prefetchChangedHistory = true;
      }
    } catch (error) {
      console.error('Inspection pre-fetch failed:', error.message);
    }
  } else if (isIntakeNotesMode) {
    try {
      const caseInfo = await allHandlers.search_case_by_number({ case_number: memory.caseNumber });
      if (caseInfo && caseInfo.id) {
        const createIntakeNotes = getCreateIntakeNotesHandler();
        const intakeData = await createIntakeNotes({ case_uuid: caseInfo.id });
        if (intakeData.system_prompt_addition) {
          memory.history[memory.history.length - 1].parts[0].text = intakeData.user_prompt_addition;
          activeInstruction = intakeData.system_prompt_addition;
          prefetchedUserText = intakeData.user_prompt_addition;
          prefetchChangedHistory = true;
          prefetchChangedInstruction = true;
        }
      }
    } catch (error) {
      console.error('Intake Notes pre-fetch failed:', error.message);
    }
  }

  return {
    memory,
    activeInstruction,
    prefetchChangedHistory,
    prefetchChangedInstruction,
    prefetchedUserText
  };
}

module.exports = {
  detectModes,
  applyCaseRouting,
  prefetchByMode
};
