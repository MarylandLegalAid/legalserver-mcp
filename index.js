#!/usr/bin/env node

// Polyfill DOMMatrix for pdf-parse/pdfjs-dist in Node environments
try {
  if (typeof global.DOMMatrix === 'undefined') {
    const { DOMMatrix } = require('@thednp/dommatrix');
    global.DOMMatrix = DOMMatrix;
  }
} catch (e) {
  // If this fails, PDF parsing may still blow up, but MCP will stay alive
  console.warn('Warning: DOMMatrix polyfill not available; PDF parsing may fail:', e);
}

// Import the MCP SDK components we need
// The SDK handles all the complex protocol communication for us
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
// Import PDF text extraction library
// const { PDFParse } = require('pdf-parse');  // Lazy loading this later
const mammoth = require('mammoth');

// =============================================================================
// CONFIGURATION
// =============================================================================
// These values come from environment variables (set these in .env)
const rawBaseUrl = process.env.LEGALSERVER_BASE_URL;
const LEGALSERVER_BEARER_TOKEN = process.env.LEGALSERVER_BEARER_TOKEN;

// Check if we have the required authentication token
if (!LEGALSERVER_BEARER_TOKEN) {
  console.error('ERROR: LEGALSERVER_BEARER_TOKEN environment variable is required');
  process.exit(1);
}

// Validate and normalize the Legalserver base URL
if (!rawBaseUrl) {
  console.error('ERROR: LEGALSERVER_BASE_URL environment variable is required');
  process.exit(1);
}

let LEGALSERVER_BASE_URL;
try {
  const parsedBaseUrl = new URL(rawBaseUrl);

  // Ensure a single trailing slash to avoid double-slash paths
  LEGALSERVER_BASE_URL = parsedBaseUrl.toString().replace(/\/+$/, '/');
} catch (error) {
  console.error('ERROR: LEGALSERVER_BASE_URL must be a valid URL');
  console.error(error.message);
  process.exit(1);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function extractFilenameFromDisposition(disposition) {
  if (!disposition) return undefined;
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  if (!match) return undefined;
  return decodeURIComponent(match[1] || match[2]);
}

function guessMimeTypeFromName(name) {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.rtf')) return 'application/rtf';
  return undefined;
}

function chunkText(text, maxChars) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

// Lazy loader for pdf-parse v2 so that any errors become tool errors, not process crashes
let PDFParseClass = null;

function getPdfParseClass() {
  if (PDFParseClass) {
    return PDFParseClass;
  }

  // This require is inside a function so if it throws, we catch it in the tool handler
  // and return a nice error to the LLM instead of crashing the whole MCP server.
  // For pdf-parse v2 the correct named export is PDFParse.
  const mod = require('pdf-parse');

  // Be a bit defensive in case the export shape changes
  PDFParseClass = mod.PDFParse || mod.default || mod;

  if (typeof PDFParseClass !== 'function') {
    throw new Error('pdf-parse did not expose a PDFParse class/function as expected');
  }

  return PDFParseClass;
}

/**
 * Makes an HTTP request to the Legalserver API
 * This function handles all the details of calling the API correctly
 * 
 * @param {string} endpoint - The API path (e.g., '/api/v1/matters/123/documents')
 * @param {Object} queryParams - Optional query parameters (e.g., { id: '123' })
 * @param {boolean} returnBinary - Whether to return binary data (for documents)
 * @returns {Promise} - Returns the API response
 */
async function callLegalserverAPI(endpoint, queryParams = {}, returnBinary = false) {
  // Build the full URL using the base URL from environment
  const url = new URL(endpoint, LEGALSERVER_BASE_URL);
  
  // Add query parameters
  Object.keys(queryParams).forEach(key => {
    url.searchParams.append(key, queryParams[key]);
  });

  // Make the request
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${LEGALSERVER_BEARER_TOKEN}`,
      'Accept': returnBinary ? '*/*' : 'application/json',
    },
  });

  // Check if request was successful
  if (!response.ok) {
    throw new Error(`LegalServer API error: ${response.status} ${response.statusText}`);
  }

  // Handle binary document downloads differently
  if (returnBinary) {
    // Get the content type from response headers
    const mimeType = response.headers.get('content-type');
    const contentDisposition = response.headers.get('content-disposition');

    // Attempt to read the download stream regardless of how the fetch implementation exposes it
    let buffer;
    if (typeof response.arrayBuffer === 'function') {
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else if (typeof response.buffer === 'function') {
      buffer = await response.buffer();
    } else if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks = [];
      // Read until done, handling streamed downloads that behave like browser file downloads
      // rather than traditional binary API responses
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      buffer = Buffer.concat(chunks);
    } else {
      // Last resort: treat it as text (e.g., when a download-style response lacks binary helpers)
      const text = await response.text();
      buffer = Buffer.from(text, 'utf-8');
    }

    return {
      content: buffer,
      mimeType: mimeType,
      contentDisposition,
    };
  }

  // For regular API calls, return JSON
  return await response.json();
}

// =============================================================================
// MCP SERVER SETUP
// =============================================================================

// Create a new MCP server instance
// The server will handle communication with LibreChat
const server = new Server(
  {
    name: 'legalserver-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {}, // This server provides tools that agents can use
    },
  }
);

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

/**
 * Handler for the "list_tools" request
 * This tells LibreChat what tools are available and how to use them
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_case_by_number",
        description: "Search for a LegalServer case by case number to get its UUID. This UUID is required for other operations like retrieving documents.",
        inputSchema: {
          type: "object",
          properties: {
            case_number: {
              type: "string",
              description: "The LegalServer case number (e.g., '24-0539721')"
            }
          },
          required: ["case_number"]
        }
      },
      {
        name: 'get_case_info',
        description: 'Retrieve detailed information about a specific case including dates, location, problem codes, and notes. Requires the case UUID from search_case_by_number.',
        inputSchema: {
          type: 'object',
          properties: {
            case_uuid: {
              type: 'string',
              description: 'The UUID of the case (obtained from search_case_by_number)',
            },
          },
          required: ['case_uuid'],
        },
      },
      {
        name: 'list_case_documents',
        description: 'Retrieves a list of all documents associated with a specific case in Legalserver. Returns document IDs, names, titles, download URLs, and size/token estimates.',
        inputSchema: {
          type: 'object',
          properties: {
            case_uuid: {
              type: 'string',
              description: 'The UUID of the case/matter in Legalserver (e.g., 587cd44b-6198-4ba8-9a14-4d27fb157016)',
            },
          },
          required: ['case_uuid'],
        },
      },
      {
        name: 'get_document',
        description: 'Retrieve text from a LegalServer document. Prefer mode="preview", "chunk", or "search" to avoid loading entire files; use mode="full" only for small documents.',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: {
              type: 'string',
              description: 'The internal ID of the document (optional if document_uuid is provided)',
            },
            document_uuid: {
              type: 'string',
              description: 'The UUID (guid) of the document (optional if document_id is provided). This is preferred - use the guid from list_case_documents.',
            },
            mode: {
              type: 'string',
              enum: ['preview', 'chunk', 'search', 'full'],
              description: 'How much content to return. Default: preview.',
            },
            chunk_index: {
              type: 'integer',
              description: 'Zero-based chunk index when mode=chunk.',
            },
            max_chars: {
              type: 'integer',
              description: 'Approximate maximum number of characters of text to return (default: 8000).',
            },
            search_query: {
              type: 'string',
              description: 'Search term(s) when mode=search; only matching snippets are returned.',
            },
          },
        },
      },
    ],
  };
});

// =============================================================================
// TOOL EXECUTION
// =============================================================================

/**
 * Handler for when a tool is actually called by the AI agent
 * This is where we do the actual work
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ============================================
    // TOOL 1: Search for a case by case number
    // ============================================
    if (name === 'search_case_by_number') {
      const { case_number } = args;

      // Validate required parameter
      if (!case_number) {
        throw new Error('case_number is required');
      }

      // Call the Legalserver search API
      const response = await callLegalserverAPI(
        '/api/v1/matters',
        {
          case_number: case_number,
          results: 'full',  // Get full results including matter_uuid
          page_size: '1'    // We only expect one exact match
        }
      );

      // Check if we found the case
      if (!response.data || response.data.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `No case found with case number: ${case_number}`,
                suggestion: 'Please verify the case number and try again.'
              }, null, 2),
            },
          ],
        };
      }

      // Get the case data (first result)
      const caseData = response.data[0];

      // Return formatted case information
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              case_found: true,
              matter_uuid: caseData.matter_uuid,  // THIS IS WHAT WE NEED!
              case_id: caseData.case_id,
              case_number: caseData.case_number,
              client_name: caseData.client_full_name,
              case_disposition: caseData.case_disposition,
              date_opened: caseData.date_opened,
              legal_problem_code: caseData.legal_problem_code,
              case_profile_url: caseData.case_profile_url,
              note: 'Use the matter_uuid to retrieve documents with list_case_documents'
            }, null, 2),
          },
        ],
      };
    }

    // ============================================
    // TOOL 2: Get detailed case information
    // ============================================
    if (name === 'get_case_info') {
      const { case_uuid } = args;

      // Validate required parameter
      if (!case_uuid) {
        throw new Error('case_uuid is required');
      }

      // Call the LegalServer API to get full case details
      const response = await callLegalserverAPI(
        `/api/v1/matters/${case_uuid}`,
        {
          results: 'full',  // Get full results
        }
      );

      // IMPORTANT: The API wraps data in a 'data' object
      const caseData = response.data;

      // ===================================================================
      // CUSTOMIZE THIS SECTION - Choose which fields to return to the LLM
      // ===================================================================
      
      const filteredResponse = {
        success: true,
        case_uuid: case_uuid,
        
        // Basic case information
        case_number: caseData.case_number,
        case_id: caseData.case_id,
        case_title: caseData.case_title,
        case_disposition: caseData.case_disposition,
        case_status: caseData.case_status,
        
        // Client information
        client_name: caseData.client_full_name,
        client_email: caseData.client_email_address,
        
        // Important dates
        dates: {
          opened: caseData.date_opened,
          closed: caseData.date_closed,
          intake: caseData.intake_date,
          rejected: caseData.date_rejected,
          days_open: caseData.days_open,
        },
        
        // Location information
        location: {
          home_address: caseData.client_address_home,
          mailing_address: caseData.client_address_mailing,
          county_of_residence: caseData.county_of_residence,
          county_of_dispute: caseData.county_of_dispute,
        },
        
        // Legal problem information
        legal_problem: {
          code: caseData.legal_problem_code,
          category: caseData.legal_problem_category,
          special_code: caseData.special_legal_problem_code,
          case_type: caseData.case_type,
        },
        
        // Case details
        intake_office: caseData.intake_office,
        intake_program: caseData.intake_program,
        close_reason: caseData.close_reason,
        
        // Notes - properly mapped from API structure
        notes: caseData.notes ? caseData.notes
          .filter(note => note.active !== false)  // Only include active notes
          .map(note => ({
            id: note.id,
            uuid: note.casenote_uuid,
            subject: note.subject,
            body: note.body,
            note_type: note.note_type,
            date_posted: note.date_posted,
            date_created: note.date_time_created,
            created_by: note.created_by,
            last_updated: note.last_update,
            last_updated_by: note.last_updated_by,
            is_html: note.is_html,
            has_document_attached: note.note_has_document_attached,
          })) : [],
        
        notes_summary: {
          total_notes: caseData.notes?.length || 0,
          active_notes: caseData.notes?.filter(n => n.active !== false).length || 0,
        },
        
        // Profile link for reference
        case_profile_url: caseData.case_profile_url,
      };

      // Return the curated data
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(filteredResponse, null, 2),
          },
        ],
      };
    }

    // ============================================
    // TOOL 3: List all documents for a case
    // ============================================
    if (name === 'list_case_documents') {
      const { case_uuid } = args;

      // Validate required parameter
      if (!case_uuid) {
        throw new Error('case_uuid is required');
      }

      // Call the Legalserver API to get the documents list
      const documentResponse = await callLegalserverAPI(
        `/api/v1/matters/${case_uuid}/documents`
      );

      const documents = documentResponse?.data ?? documentResponse;

      if (!Array.isArray(documents) || documents.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'No documents were found for this case.',
                suggestion: 'Verify the case UUID or ensure documents have been uploaded.',
              }, null, 2),
            },
          ],
        };
      }

      // Format the response for the AI
      const formattedResponse = {
        success: true,
        case_uuid: case_uuid,
        total_documents: documents.length,
        documents: documents.map(doc => {
          const sizeBytes = doc.disk_file_size || doc.file_size || null;
          const estimatedTokens = sizeBytes ? Math.round(sizeBytes / 4) : null;

          return {
            // Document identifiers (use guid for get_document)
            guid: doc.guid,
            internal_id: doc.internal_id,

            // Document metadata
            name: doc.name,
            title: doc.title,
            mime_type: doc.mime_type,
            size_bytes: sizeBytes,
            estimated_tokens: estimatedTokens,
            file_size: sizeBytes ? `${(sizeBytes / 1024).toFixed(2)} KB` : null,

            // Dates
            date_created: doc.date_create,
            date_updated: doc.date_update,

            // Security info
            virus_scanned: doc.virus_scanned,
            virus_free: doc.virus_free,

            // Organization
            folder_id: doc.folder_id,
          };
        }),
        note: 'Use the guid field with get_document to retrieve document content'
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formattedResponse, null, 2),
          },
        ],
      };
    }

    // ============================================
    // TOOL 4: Get actual document content
    // ============================================
    if (name === 'get_document') {
      const { document_id, document_uuid } = args;

      // Validate that we have at least one identifier
      if (!document_id && !document_uuid) {
        throw new Error('Either document_id or document_uuid is required');
      }

      // Build query parameters based on what was provided
      const queryParams = {};
      if (document_id) {
        queryParams.id = document_id;
      }
      if (document_uuid) {
        queryParams.unique_id = document_uuid;
      }

      // Call the Legalserver API to download the document
      const documentData = await callLegalserverAPI(
        '/modules/document/download.php',
        queryParams,
        true  // Get binary data
      );

      const filename = extractFilenameFromDisposition(documentData.contentDisposition);
      const identifier = filename || document_id || document_uuid;
      const mimeType = documentData.mimeType || guessMimeTypeFromName(filename || identifier) || 'application/octet-stream';

      // Handle different document types and extract text content
      try {
        let fullText;

        // CASE 1: Images (jpg, png, etc.)
        if (mimeType.startsWith('image/')) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  document_identifier: identifier,
                  mime_type: mimeType,
                  error: 'Image document - OCR not available',
                  suggestion: 'This is an image file. To read text from images, OCR (Optical Character Recognition) would be needed. Please ask the user to describe the image content or provide it in text format.',
                  size_bytes: documentData.content.length,
                }, null, 2),
              },
            ],
          };
        }

        // CASE 2: Plain text files
        if (mimeType.startsWith('text/') || mimeType.includes('plain')) {
          fullText = documentData.content.toString('utf-8');
      } else if (
          mimeType === 'application/pdf' ||
          identifier.toLowerCase().endsWith('.pdf') ||
          mimeType.includes('pdf')
        ) {
          // CASE 3: PDF files - pdf-parse v2 API
          try {
            const PDFParse = getPdfParseClass();

            const parser = new PDFParse({
              // v2 API: use `data`, not `buffer`
              data: documentData.content,
            });

            const result = await parser.getText();
            fullText = result && typeof result.text === 'string' ? result.text : '';

          } catch (err) {
            console.error('PDF parsing error:', err);
            throw new Error(`Failed to extract PDF text: ${err.message}`);
          }
        } else if (mimeType.includes('word') || mimeType.includes('officedocument')) {
          // CASE 4: Word documents (.docx, .doc)
          const result = await mammoth.extractRawText({ buffer: documentData.content });
          fullText = result.value;
        } else {
          // CASE 5: Other binary formats - explain what it is
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  document_identifier: identifier,
                  mime_type: mimeType,
                  error: 'Unsupported document format for text extraction',
                  suggestion: `This document type (${mimeType}) cannot be read directly. Supported formats: PDF, plain text. Please ask the user if they can provide the document in a supported format.`,
                  size_bytes: documentData.content.length,
                }, null, 2),
              },
            ],
          };
        }

        const mode = args.mode || 'preview';
        const maxChars = typeof args.max_chars === 'number' && args.max_chars > 0
          ? args.max_chars
          : 8000;

        if (!fullText || !fullText.trim()) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                document_identifier: identifier,
                mode,
                error: 'No text content could be extracted from this document.'
              }, null, 2)
            }]
          };
        }

        const totalLength = fullText.length;
        const chunks = chunkText(fullText, maxChars);
        const ESTIMATED_TOKENS = Math.round(totalLength / 4);
        const MAX_FULL_TOKENS = 40000;

        if (mode === 'full' && ESTIMATED_TOKENS > MAX_FULL_TOKENS) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                document_identifier: identifier,
                mode: 'full',
                error: 'Document too large for full retrieval in a single call.',
                estimated_tokens: ESTIMATED_TOKENS,
                suggestion: 'Call get_document with mode="preview", "chunk", or "search" instead.'
              }, null, 2)
            }]
          };
        }

        if (mode === 'preview') {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                document_identifier: identifier,
                mode: 'preview',
                total_length: totalLength,
                estimated_tokens: ESTIMATED_TOKENS,
                approx_chunks: chunks.length,
                chunk_index: 0,
                text: chunks[0],
                note: 'To retrieve more content, call get_document with mode="chunk" and a chunk_index between 0 and approx_chunks - 1.'
              }, null, 2)
            }]
          };
        }

        if (mode === 'chunk') {
          const idx = typeof args.chunk_index === 'number' ? args.chunk_index : 0;

          if (idx < 0 || idx >= chunks.length) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  document_identifier: identifier,
                  mode: 'chunk',
                  error: `chunk_index ${idx} out of range (0-${chunks.length - 1})`,
                  total_length: totalLength,
                  approx_chunks: chunks.length
                }, null, 2)
              }]
            };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                document_identifier: identifier,
                mode: 'chunk',
                total_length: totalLength,
                estimated_tokens: ESTIMATED_TOKENS,
                approx_chunks: chunks.length,
                chunk_index: idx,
                text: chunks[idx]
              }, null, 2)
            }]
          };
        }

        if (mode === 'search') {
          const q = (args.search_query || '').trim().toLowerCase();

          if (!q) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  document_identifier: identifier,
                  mode: 'search',
                  error: 'search_query is required when mode is "search".'
                }, null, 2)
              }]
            };
          }

          const paragraphs = fullText.split(/\n{2,}/);
          const matches = [];
          let accumulated = '';

          for (let i = 0; i < paragraphs.length; i++) {
            if (paragraphs[i].toLowerCase().includes(q)) {
              const context = [];
              if (i > 0) context.push(paragraphs[i - 1]);
              context.push(paragraphs[i]);
              if (i < paragraphs.length - 1) context.push(paragraphs[i + 1]);

              for (const p of context) {
                if (accumulated.length + p.length + 2 > maxChars) {
                  break;
                }
                matches.push(p);
                accumulated += p + '\n\n';
              }
            }
            if (accumulated.length >= maxChars) {
              break;
            }
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                document_identifier: identifier,
                mode: 'search',
                query: q,
                total_length: totalLength,
                estimated_tokens: ESTIMATED_TOKENS,
                snippet_count: matches.length,
                text: matches.join('\n\n')
              }, null, 2)
            }]
          };
        }

        // Legacy / explicit full mode: return full text, possibly truncated to maxChars
        if (mode === 'full') {
          const textToReturn = totalLength > maxChars ? fullText.slice(0, maxChars) : fullText;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                document_identifier: identifier,
                mode: 'full',
                total_length: totalLength,
                estimated_tokens: ESTIMATED_TOKENS,
                truncated: totalLength > maxChars,
                text: textToReturn
              }, null, 2)
            }]
          };
        }

        // Fallback for unknown mode values
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              document_identifier: identifier,
              mode,
              error: `Unsupported mode "${mode}". Use "preview", "chunk", "search", or "full".`
            }, null, 2)
          }]
        };

      } catch (extractionError) {
        // If text extraction fails, return helpful error
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                document_identifier: identifier,
                mime_type: mimeType,
                error: `Failed to extract text: ${extractionError.message}`,
                suggestion: 'The document could not be processed. It may be corrupted or in an unsupported format.',
              }, null, 2),
            },
          ],
        };
      }
    }
    throw new Error(`Unknown tool: ${name}`);

  } catch (error) {
    // If anything goes wrong, return a helpful error message
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: true,
            tool: name,
            message: error.message,
            suggestion: 'Check the parameters and try again. Ensure the case exists and you have proper permissions.'
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// =============================================================================
// START THE SERVER
// =============================================================================

/**
 * Main function to start the MCP server
 * This connects the server to LibreChat via standard input/output
 */
async function main() {
  console.error('Starting Legalserver MCP Server...');
  
  // Create a transport that communicates via stdio (standard input/output)
  // This is how LibreChat will talk to our server
  const transport = new StdioServerTransport();
  
  // Connect the server to the transport
  await server.connect(transport);
  
  console.error('Legalserver MCP Server is running and ready!');
}

// Start the server
main().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});