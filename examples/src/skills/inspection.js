/**
 * Inspection & Compliance Audit Skill Component.
 * Acts as a compliance officer to verify 13 points of case data for grant reporting.
 * Provides prioritized document scanning (citizen > elig > intake > verif) for citizenship verification.
 * * CONFIGURATION REQUIRED: Update custom field IDs (e.g., 2684) to match your organization's schema.
 */

const { callLegalserverAPI, optimizeForVertex } = require('../utils/legalClient');
const {
    cleanText,
    ocrDocumentWithGemini,
    coerceGeminiMimeType
} = require('../utils/documentUtils');
const { performance } = require('node:perf_hooks');

// =============================================================================
// SKILL DEFINITION: INSPECTION CHECKLIST 
// =============================================================================
const INSPECTION_CHECKLIST = `--- SKILL: INSPECTION (Compliance Audit Mode) ---
You are a compliance officer. The user's message below contains pre-fetched audit data (such as 'audit_context', 'notes', and 'other_matters').
Your task is to answer the following 13 points using that data, and when required by these rules you MUST call tools to retrieve additional case documents.

1. INCOME NOTATION: Check the field 'income_entries'.
    - Mark [YES] if 'income_entries' contains ANY specific income values or amounts (e.g., "$3,000.00", "$0.00", "Employment", etc.).
    - Mark [NO] ONLY if 'income_entries' is "None Recorded" or strictly blank/missing.
    - Basis: State the specific amounts and types found in 'income_entries'.
2. POVERTY GUIDELINES (200%): Check the field 'percentage_of_poverty'.
    - Mark [YES] if the value is 200 or less.
    - Mark [NO] if the value is greater than 200 or blank.
    - Basis: State the percentage found in 'percentage_of_poverty'.
3. INCOME 125%-200%: Check the field 'percentage_of_poverty'.
    - If 'percentage_of_poverty' is between 125 and 200, mark [YES] if LSC Overrides are documented in the notes, otherwise mark [NO].
    - If 'percentage_of_poverty' is NOT between 125 and 200, you MUST mark this as [NA].
    - Basis: State the percentage found and whether an override was located in the case notes.
4. ASSETS: Always [YES]. Basis: "LegalServer does not allow for the Asset Field to be blank."
5. TELEPHONE CITIZENSHIP: Check the fields 'intake_type' and 'close_reason'.
    - First, check if 'intake_type' is "Telephone" AND if 'close_reason' starts with "A" or "B". If BOTH of these conditions are NOT met, you MUST mark this as [NA] and stop evaluating this point.
    - If BOTH conditions ARE met, then mark [YES] if EITHER:
      a) The 'citizenship' field's 'lookup_value_name' is "U.S. Citizen".
      b) The field 'citizenship_documents_confirmed_2684' is true.
    - Otherwise, mark [NO].
    - Basis: State the intake_type, close_reason, and the citizenship status found.

6. IN-PERSON CITIZENSHIP: Strict Check. 
    - MANDATORY SKIP: If Point 5 resulted in [YES] or [NO], you MUST mark this Point 6 as [NA] immediately and DO NOT execute any document scanning tools. Only evaluate this point if Point 5 is [NA].
    - Otherwise, mark [YES] if you find ANY of the following:
      - The field 'citizenship_documents_confirmed_2684' is explicitly true.
      - OR a document whose CONTENT contains the exact phrase "CITIZENSHIP VERIFICATION" or "NON-CITIZEN RESIDENT STATUS VERIFICATION".
    - ACTION REQUIRED: If the 'citizenship_documents_confirmed_2684' flag is false, you MUST first call 'list_case_documents' once, then call 'scan_case_documents' and pass that returned list as the 'documents' argument together with query='CITIZENSHIP VERIFICATION'. Do NOT answer Point 6 until these required tool calls are completed.
    - PRIORITY RULE: Use the tool's built-in priority ordering; do NOT treat title keywords as a condition to skip scanning.
    - STOP RULE: As soon as a qualifying document match is found, stop scanning and report that matched document.
    - HYPERLINK MANDATORY: If a document is found, you MUST include a markdown link in the Basis: [Document Name](document_url).
    - CRITICAL: Do NOT accept mentions in case notes, general descriptions, or the 'citizenship' field status (e.g., "U.S. Citizen"). Verification must be the 'citizenship_documents_confirmed_2684' flag OR the physical document text.
7. CASEHANDLER STATUS: Do NOT provide [YES/NO/NA]. Simply list all casehandlers found in the 'primary_casehandler_list' string.
8. LEVEL OF ASSISTANCE: Strict Substantive Check.
    - Mark [YES] ONLY if the note body contains actual legal advice, research, counsel, or representation details.
    - Mark [NO] if the notes only contain administrative, procedural, or system-generated text.
    - CRITICAL: Do NOT rely on the 'Note Type' (e.g., 'Advice Notes'). You MUST read the text.
    - EXCLUSION: Phrases like "Citizenship Attestation has been completed," scheduling notes, or "See attached" without further detail are NOT substantive; mark these as [NO].

9. TIMELINESS (CAT A/B): Do NOT provide [YES/NO/NA]. Extract and state the 'close_reason' and 'date_closed'. The human user will verify this against grant requirements.
10. TIMELINESS (EXTENDED): Do NOT provide [YES/NO/NA]. Review the notes for any mention of extended services or representation and state the date of the last substantive note found.
11/12. DUPLICATE/MULTIPLE MATTERS: Consolidated Check.
     - Do NOT provide [YES/NO/NA]. 
     - Review the 'other_matters' data provided in the prompt.
     - If other matters exist (excluding the current case number):
         a. You MUST output each matter as a markdown hyperlink. Prefer 'case_markdown_link' if present; otherwise format with case_number + case_profile_url as [Case Number](case_profile_url).
         b. Briefly state if the legal problem codes are different from the current case.
     - FORMAT REQUIREMENT: Plain bold case numbers without a hyperlink are non-compliant.
     - If no other matters exist, state: "No other matters found for this ClientID."
13. ELIGIBILITY OF TYPE: Confirm not a restricted case type.

CRITICAL
1. Provide a "Basis" sentence for every point.`;

const inspectionHandlers = {
    get_inspection_data: async (args) => { 
        const { case_uuid } = args;

        try {
            const [v1Data, v2CustomData] = await Promise.all([
                callLegalserverAPI(`/api/v1/matters/${case_uuid}`, { results: 'full' }),
                callLegalserverAPI(`/api/v2/matters/${case_uuid}`, { results: 'full', citizenship_documents_confirmed_2684: 'true' })
            ]);

            const v1 = v1Data.data || v1Data;
            const v2 = v2CustomData.data || v2CustomData;

            const processedNotes = (v1.notes || []).map(n => ({
                date: n.date_posted,
                body: cleanText(n.body),
                subject: n.subject || ""
            }));
            
            return {
                income_entries: v1.income_entries,
                percentage_of_poverty: v1.percentage_of_poverty,
                intake_type: v1.intake_type,
                close_reason: v1.close_reason,
                date_closed: v1.date_closed,
                client_id: v1.client_id || v1.client_data?.id || v1.client?.id,
                citizenship: v1.citizenship,
                citizenship_documents_confirmed_2684: v2.citizenship_documents_confirmed_2684,
                primary_casehandler_list: v1.primary_casehandler_list,
                notes: processedNotes
            };
        } catch (error) {
            console.error('Audit Pull Error for [CASE_ID]:', error.message);
            throw error;
        }
    },

    scan_case_documents: async (args) => {
        const { case_uuid, query, documents: providedDocuments } = args;
        const diagnostics = {
            docsScanned: 0,
            totalDownloadMs: 0,
            totalOcrMs: 0
        };

        let documents = Array.isArray(providedDocuments) ? providedDocuments : null;
        if (!documents) {
            const docList = await callLegalserverAPI(`/api/v1/matters/${case_uuid}/documents`);
            documents = docList.data || docList;
        }

        if (!Array.isArray(documents) || documents.length === 0) return { success: false, error: "No documents found." };

        const PRIORITY_MAP = { citizen: 1, elig: 2, intake: 3, verif: 4 };
        const getPriority = (name) => {
            const lowerName = (name || '').toLowerCase();
            for (const [keyword, weight] of Object.entries(PRIORITY_MAP)) {
                if (lowerName.includes(keyword)) return weight;
            }
            return 999;
        };
        const sortedDocs = documents
            .map((doc, idx) => ({ doc, idx, priority: getPriority(doc?.name) }))
            .sort((a, b) => (a.priority - b.priority) || (a.idx - b.idx))
            .map((item) => item.doc);

        console.log(`[DIAGNOSTIC] Priority order preview: ${sortedDocs.slice(0, 5).map((d) => d?.name || '[UNKNOWN_DOC]').join(' | ')}`);

        let scannedCount = 0;

        for (let i = 0; i < sortedDocs.length; i += 1) {
            if (scannedCount >= 20) break; 
            const doc = sortedDocs[i];
            scannedCount += 1;
            try {
                const ext = (doc.name || "").split('.').pop().toLowerCase();
                if (["heic", "eml", "msg"].includes(ext)) continue;

                diagnostics.docsScanned += 1;
                const downloadStart = performance.now();
                const docData = await callLegalserverAPI('/modules/document/download.php', { unique_id: doc.guid }, true);
                const downloadDurationMs = performance.now() - downloadStart;
                diagnostics.totalDownloadMs += downloadDurationMs;

                const effectiveMimeType = coerceGeminiMimeType(docData.mimeType, doc.name);
                const fileSizeBytes = docData?.content?.length || 0;
                const fileSizeMb = fileSizeBytes > 0 ? (fileSizeBytes / (1024 * 1024)).toFixed(2) : '0.00';
                console.log(`[DIAGNOSTIC] File metadata for ${doc.name || '[UNKNOWN_DOC]'}: fileSizeMB=${fileSizeMb}, mimeType=${effectiveMimeType}`);

                console.log(`[DIAGNOSTIC] Hand-off to Gemini (flash-lite) for ${doc.name || '[UNKNOWN_DOC]'}...`);
                const ocrStart = performance.now();
                const isMatch = await ocrDocumentWithGemini(docData.content, effectiveMimeType, query, {
                    fileName: doc.name
                });
                const ocrDurationMs = performance.now() - ocrStart;
                diagnostics.totalOcrMs += ocrDurationMs;
                console.log(`[DIAGNOSTIC] OCR finished in ${ocrDurationMs.toFixed(2)}ms for ${doc.name || '[UNKNOWN_DOC]'}.`);

                if (isMatch) {
                    const docUrl = `${process.env.LEGALSERVER_BASE_URL}/document/profile/view/${doc.internal_id}`;
                    const bottleneck = diagnostics.totalOcrMs >= diagnostics.totalDownloadMs
                        ? 'sequential_processing + OCR-bound'
                        : 'memory/network-bound downloading';
                    console.log(`[DIAGNOSTIC] Scan summary (match found): docsScanned=${diagnostics.docsScanned}, downloadMs=${diagnostics.totalDownloadMs.toFixed(2)}, ocrMs=${diagnostics.totalOcrMs.toFixed(2)}, bottleneck=${bottleneck}`);
                    return {
                        success: true,
                        found: true,
                        document_name: doc.name,
                        document_url: docUrl
                    };
                }
            } catch (e) {
                console.warn(`Scan error on [DOC_NAME]: ${e.message}`);
            }
        }

        const computeBottleneck = () => {
            const download = diagnostics.totalDownloadMs;
            const ocr = diagnostics.totalOcrMs;
            const max = Math.max(download, ocr);
            if (max === ocr) return 'sequential_processing + OCR-bound';
            return 'memory/network-bound downloading';
        };
        console.log(`[DIAGNOSTIC] Scan summary (no match): docsScanned=${diagnostics.docsScanned}, downloadMs=${diagnostics.totalDownloadMs.toFixed(2)}, ocrMs=${diagnostics.totalOcrMs.toFixed(2)}, bottleneck=${computeBottleneck()}`);
        return { success: true, found: false, note: `Scanned ${scannedCount} documents. Phrase "${query}" not found.` };
    }
};

const inspectionSchemas = [
    {
        name: "get_inspection_data",
        description: "Use ONLY for Inspections or Self Inspections. Do not use for general summaries.",
        parameters: {
            type: "OBJECT",
            properties: {
                case_uuid: { type: "STRING" }
            },
            required: ["case_uuid"]
        }
    },
    {
        name: "scan_case_documents",
        description: "Efficiently performs a page-by-page scan of ALL documents in a case for a specific text phrase. Use this for Question 6.",
        parameters: {
            type: "OBJECT",
            properties: {
                case_uuid: { type: "STRING" },
                query: { type: "STRING" },
                documents: {
                    type: "ARRAY",
                    description: "Optional pre-fetched output from list_case_documents to avoid duplicate listing calls in the same turn.",
                    items: {
                        type: "OBJECT",
                        properties: {
                            guid: { type: "STRING" },
                            name: { type: "STRING" },
                            internal_id: { type: "STRING" }
                        }
                    }
                }
            },
            required: ["case_uuid", "query"]
        }
    }
];

module.exports = { 
    INSPECTION_CHECKLIST, 
    inspectionHandlers, 
    inspectionSchemas 
};
