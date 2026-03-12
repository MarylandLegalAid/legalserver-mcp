/**
 * Case Management Skill Component.
 * Provides tools for matter lookup and detailed profile retrieval.
 * * NOTE ON API VERSIONS: 
 * - Uses v1 API for searching by Case Number and retrieving comprehensive document lists 
 * (necessary for visibility into nested folders or beyond v2 limit of return count).
 * - Uses v2 API for full profile data retrieval.
 * * VALIDATION: Enforces strict UUID checks to prevent V2 API errors when case numbers 
 * are mistakenly passed as identifiers.
 */

const { callLegalserverAPI } = require('../utils/legalClient');
const { extractFilenameFromDisposition, guessMimeTypeFromName, extractTextFromBuffer, chunkText } = require('../utils/documentUtils');

const caseManagementHandlers = {
    search_case_by_number: async (args) => {
        const response = await callLegalserverAPI('/api/v1/matters', {
            case_number: args.case_number, 
            results: 'full', 
            page_size: '1'
        });
        
        const caseData = response.data?.[0];
        if (!caseData) return { error: "Case number not found in LegalServer." };

        return {
            id: caseData.id,
            case_id: caseData.case_id,
            client_id: caseData.client_id || caseData.client_data?.id,
            ...caseData
        };
    },

    get_case_info: async (args) => {
        const { case_uuid } = args;
        
        const response = await callLegalserverAPI(`/api/v1/matters/${case_uuid}`, { results: 'full' });
        const caseData = response.data || response;
        
        const incomeSummary = (caseData.income_sources && caseData.income_sources.length > 0)
            ? caseData.income_sources.map(inc => `${inc.amount || '$0'} (${inc.type || 'Income'}) ${inc.period || ''}`).join(", ")
            : "None Recorded";

        const primaryHandlers = (caseData.assignments && Array.isArray(caseData.assignments))
            ? caseData.assignments
                .filter(a => a.assignment_type === "Primary")
                .map(a => a.user_full_name)
                .join(", ")
            : "None assigned";

        const rawResult = {
            success: true,
            case_uuid: case_uuid,
            case_number: caseData.case_number,
            client_id: caseData.client_id,
            intake_type: caseData.intake_type?.lookup_value_name || caseData.intake_type,
            income_entries: incomeSummary,
            total_household_income: caseData.total_financial_income || "Not Recorded",
            citizenship: caseData.citizenship?.lookup_value_name || caseData.citizenship,
            citizenship_documents_confirmed_2684: !!caseData.custom_fields?.citizenship_documents_confirmed_2684,
            primary_casehandler_list: primaryHandlers,
            percentage_of_poverty: caseData.percentage_of_poverty || "Not Recorded",
            date_closed: caseData.date_closed,
            close_reason: caseData.close_reason?.lookup_value_name || caseData.close_reason,
            notes: (caseData.notes || []).map(n => ({
                subject: n.subject, body: n.body, date_posted: n.date_posted, created_by: n.created_by
            }))
        };

        return rawResult;
    },

    list_client_matters: async (args) => {
        const { client_id: inputClientId, case_uuid, current_case_number } = args;
        let resolvedClientId = inputClientId;

        if (!resolvedClientId && case_uuid) {
            const caseResponse = await callLegalserverAPI(`/api/v1/matters/${case_uuid}`, { results: 'full' });
            const caseData = caseResponse.data || caseResponse;
            resolvedClientId =
                caseData.client_id ||
                caseData.client_data?.id ||
                caseData.client?.id ||
                caseData.client_uuid;
        }

        if (resolvedClientId !== undefined && resolvedClientId !== null) {
            resolvedClientId = String(resolvedClientId).trim();
        }
        if (!resolvedClientId) return [];
        const response = await callLegalserverAPI('/api/v1/matters', {
            client_id: resolvedClientId, results: 'full'
        });
        const matters = response.data || response;

        if (!Array.isArray(matters)) return matters;

        return matters.filter(m => m.case_number !== current_case_number)
            .map(m => ({
                case_number: m.case_number,
                legal_problem_code: m.legal_problem_code,
                case_profile_url: m.case_profile_url,
                case_markdown_link: (m.case_number && m.case_profile_url)
                    ? `[${m.case_number}](${m.case_profile_url})`
                    : null
            }));
    },

    list_case_documents: async (args) => {
        const response = await callLegalserverAPI(`/api/v1/matters/${args.case_uuid}/documents`);
        const docs = response.data || response;
        return docs;
    },

    get_document: async (args) => {
        const { document_id, document_uuid, mode = 'preview', max_chars = 8000, chunk_index = 0, search_query = "" } = args;
        const qp = document_id ? { id: document_id } : { unique_id: document_uuid };
        
        const docData = await callLegalserverAPI('/modules/document/download.php', qp, true);
        const filename = extractFilenameFromDisposition(docData.contentDisposition);
        const mimeType = docData.mimeType || guessMimeTypeFromName(filename) || 'application/octet-stream';

        try {
            const fullText = await extractTextFromBuffer(docData.content, mimeType, filename || "doc");
            const totalLength = fullText.length;
            const chunks = chunkText(fullText, max_chars);

            let result = {};
            if (mode === 'preview') {
                result = { success: true, mode, total_length: totalLength, text: chunks[0], approx_chunks: chunks.length };
            } else if (mode === 'search') {
                const q = search_query.toLowerCase();
                const paragraphs = fullText.split(/\n{2,}/);
                const matches = paragraphs.filter(p => p.toLowerCase().includes(q));
                result = { success: true, mode, query: q, text: matches.join('\n\n').slice(0, max_chars) };
            } else if (mode === 'chunk') {
                result = { success: true, mode, chunk_index, text: chunks[chunk_index] || "Index out of range" };
            } else {
                result = { success: true, mode, text: fullText.slice(0, max_chars) };
            }

            return result;
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
};

const caseManagementSchemas = [
    { 
        name: "search_case_by_number", 
        description: "Get UUID by case number.", 
        parameters: { type: "OBJECT", properties: { case_number: { type: "STRING" } }, required: ["case_number"] } 
    },
    { 
        name: "get_case_info", 
        description: "Retrieves detailed case data. REQUIRES a 36-character UUID. If you only have a case number (e.g. 25-XXXXXX), you MUST call 'search_case_by_number' first to get the UUID.", 
        parameters: { 
            type: "OBJECT", 
            properties: { 
                case_uuid: { type: "STRING", description: "The 36-character internal UUID, NOT the case number." } 
            }, 
            required: ["case_uuid"] 
        } 
    },
    {
        name: "list_client_matters",
        description: "Retrieve all matters associated with a client ID.",
        parameters: { type: "OBJECT", properties: { client_id: { type: "STRING" } }, required: ["client_id"] }
    },
    { 
        name: "list_case_documents", 
        description: "List all document IDs.", 
        parameters: { type: "OBJECT", properties: { case_uuid: { type: "STRING" } }, required: ["case_uuid"] } 
    },
    {
        name: "get_document",
        description: "Retrieve or search text from a document. Use mode='preview' for the start of the doc, 'search' to find specific text, or 'chunk' to get a specific part.",
        parameters: {
            type: "OBJECT",
            properties: {
                document_uuid: { type: "string", description: "The 36-character internal UUID of the document." },
                document_id: { type: "string", description: "The numeric ID of the document." },
                mode: { type: "string", enum: ["preview", "chunk", "search", "full"] },
                search_query: { type: "string" }
            },
            description: "Requires either document_uuid or document_id."
        }
    }
];

module.exports = { caseManagementHandlers, caseManagementSchemas };
