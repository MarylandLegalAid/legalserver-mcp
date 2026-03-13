const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { ToolError } = require('../../src/helpers');
const { createMcpServer } = require('../../src/mcpServer');
const { CANONICAL_TOOL_NAMES } = require('../../src/constants');
const { jsonResponse } = require('../support/mockFetch');

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

test('in-process MCP server lists canonical tools and serves representative calls', async () => {
  const fakePipeline = {
    async getDocumentState() {
      return {
        canonicalText: 'Lease terms\nRent due monthly.',
        chunks: [{
          chunkIndex: 0,
          pageStart: 1,
          pageEnd: 1,
          startChar: 0,
          endChar: 29,
          text: 'Lease terms\nRent due monthly.',
        }],
        ocrModel: null,
        ocrProvider: null,
        pageCount: 1,
        pageOffsets: [{ pageNumber: 1, startChar: 0, endChar: 29 }],
        textSha256: 'hash-doc-1',
        textSource: 'pdf_text',
        totalTextChars: 29,
        estimatedTokens: 8,
      };
    },
  };

  const fetchImpl = async (url) => {
    const parsed = new URL(url);

    if (parsed.pathname === '/api/v1/matters' && parsed.searchParams.get('case_number')) {
      return jsonResponse(200, {
        full_data: [{
          matter_uuid: 'matter-uuid-1',
          case_id: 101,
          case_number: '24-0001',
          client_full_name: 'Jane Client',
          case_disposition: 'Open',
          legal_problem_code: '01 Housing',
          date_opened: { raw_value: '2024-01-01' },
          case_profile_url: 'https://example.legalserver.org/matter/101',
        }],
        total_records: 1,
        total_number_of_pages: 1,
        page_size: 1,
        page_number: 1,
      });
    }

    if (parsed.pathname === '/api/v1/matters/matter-uuid-1') {
      return jsonResponse(200, {
        data: {
          matter_uuid: 'matter-uuid-1',
          case_id: 101,
          case_number: '24-0001',
          client_full_name: 'Jane Client',
          case_status: 'Open',
          case_disposition: 'Open',
        },
      });
    }

    if (parsed.pathname === '/api/v1/matters/matter-uuid-1/notes') {
      return jsonResponse(200, {
        data: [{
          casenote_uuid: 'note-1',
          id: 10,
          subject: 'Client update',
          body: '<p>Hello</p>',
          note_type: 'General',
          is_html: true,
          active: true,
        }],
        page_number: 1,
        page_size: 10,
        total_records: 1,
        total_number_of_pages: 1,
      });
    }

    if (parsed.pathname === '/api/v1/matters/matter-uuid-1/documents') {
      return jsonResponse(200, [{
        internal_id: 500,
        guid: 'doc-1',
        name: 'lease.pdf',
        title: 'Lease',
        mime_type: 'application/pdf',
        disk_file_size: 400,
        date_create: '2024-01-04T00:00:00Z',
        date_update: '2024-01-05T00:00:00Z',
        virus_scanned: true,
        virus_free: true,
        folder_id: 3,
        download_url: 'https://example/doc-1',
      }]);
    }

    if (parsed.pathname === '/api/v1/matters/matter-uuid-1/assignments') {
      return jsonResponse(200, {
        data: [{
          uuid: 'assignment-1',
          id: 1,
          type: 'Primary',
          start_date: '2024-01-01',
          confirmed: true,
          program: 'Housing',
        }],
        page_number: 1,
        page_size: 10,
        total_records: 1,
        total_number_of_pages: 1,
      });
    }

    throw new Error(`Unexpected URL in integration test: ${url}`);
  };

  const server = createMcpServer({
    config: {
      baseUrl: 'https://example.legalserver.org/',
      bearerToken: 'token',
      timeoutMs: 30000,
    },
    fetchImpl,
    documentTextPipeline: fakePipeline,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: 'legalserver-mcp-test-client',
    version: '1.0.0',
  });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, [...CANONICAL_TOOL_NAMES].sort());

  const lookup = parseToolResult(await client.callTool({
    name: 'matter_lookup_by_case_number',
    arguments: { case_number: '24-0001' },
  }));
  assert.equal(lookup.data.case_uuid, 'matter-uuid-1');

  const matter = parseToolResult(await client.callTool({
    name: 'matter_get',
    arguments: { case_uuid: 'matter-uuid-1' },
  }));
  assert.equal(matter.data.case_number, '24-0001');

  const notes = parseToolResult(await client.callTool({
    name: 'matter_list_notes',
    arguments: { case_uuid: 'matter-uuid-1' },
  }));
  assert.equal(notes.data[0].body_preview, 'Hello');

  const metadata = parseToolResult(await client.callTool({
    name: 'document_get_metadata',
    arguments: { case_uuid: 'matter-uuid-1', document_uuid: 'doc-1' },
  }));
  assert.equal(metadata.data.document_uuid, 'doc-1');
  assert.equal(metadata.data.text_strategy, 'direct_or_ocr');
  assert.equal(metadata.data.download_url, 'https://example/doc-1');

  const manifest = parseToolResult(await client.callTool({
    name: 'document_get_text_manifest',
    arguments: { case_uuid: 'matter-uuid-1', document_uuid: 'doc-1' },
  }));
  assert.equal(manifest.data.text_source, 'pdf_text');
  assert.equal(manifest.data.chunk_count, 1);

  const chunk = parseToolResult(await client.callTool({
    name: 'document_get_text_chunk',
    arguments: { case_uuid: 'matter-uuid-1', document_uuid: 'doc-1', chunk_index: 0 },
  }));
  assert.equal(chunk.data.text, 'Lease terms\nRent due monthly.');

  const search = parseToolResult(await client.callTool({
    name: 'document_search_text',
    arguments: { case_uuid: 'matter-uuid-1', document_uuid: 'doc-1', query: 'rent' },
  }));
  assert.equal(search.data[0].chunk_index, 0);

  const matterSearch = parseToolResult(await client.callTool({
    name: 'matter_search_document_text',
    arguments: { case_uuid: 'matter-uuid-1', query: 'rent' },
  }));
  assert.equal(matterSearch.data[0].document_uuid, 'doc-1');

  const assignments = parseToolResult(await client.callTool({
    name: 'matter_list_assignments',
    arguments: { case_uuid: 'matter-uuid-1', page: 1, page_size: 10 },
  }));
  assert.equal(assignments.data[0].assignment_uuid, 'assignment-1');

  await clientTransport.close();
});

test('in-process MCP server returns partial matter-wide search results with warnings', async () => {
  const fakePipeline = {
    async getDocumentState({ documentRecord }) {
      if (documentRecord.guid === 'doc-1') {
        return {
          canonicalText: 'Lease terms\nRent due monthly.',
          chunks: [{
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            startChar: 0,
            endChar: 29,
            text: 'Lease terms\nRent due monthly.',
          }],
          ocrModel: null,
          ocrProvider: null,
          pageCount: 1,
          pageOffsets: [{ pageNumber: 1, startChar: 0, endChar: 29 }],
          textSha256: 'hash-doc-1',
          textSource: 'pdf_text',
          totalTextChars: 29,
          estimatedTokens: 8,
        };
      }

      throw new ToolError({
        errorCode: 'unsupported_media_type',
        message: 'Unsupported email',
        status: 415,
      });
    },
  };

  const fetchImpl = async (url) => {
    const parsed = new URL(url);

    if (parsed.pathname === '/api/v1/matters/matter-uuid-1/documents') {
      return jsonResponse(200, [
        {
          internal_id: 500,
          guid: 'doc-1',
          name: 'lease.pdf',
          title: 'Lease',
          mime_type: 'application/pdf',
          disk_file_size: 400,
          date_create: '2024-01-04T00:00:00Z',
          date_update: '2024-01-05T00:00:00Z',
        },
        {
          internal_id: 501,
          guid: 'doc-2',
          name: 'email.eml',
          title: 'Email',
          mime_type: 'application/mbox',
          disk_file_size: 200,
          date_create: '2024-01-03T00:00:00Z',
          date_update: '2024-01-04T00:00:00Z',
        },
      ]);
    }

    throw new Error(`Unexpected URL in integration test: ${url}`);
  };

  const server = createMcpServer({
    config: {
      baseUrl: 'https://example.legalserver.org/',
      bearerToken: 'token',
      timeoutMs: 30000,
    },
    fetchImpl,
    documentTextPipeline: fakePipeline,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: 'legalserver-mcp-test-client',
    version: '1.0.0',
  });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const matterSearch = parseToolResult(await client.callTool({
    name: 'matter_search_document_text',
    arguments: { case_uuid: 'matter-uuid-1', query: 'rent' },
  }));

  assert.equal(matterSearch.ok, true);
  assert.equal(matterSearch.data.length, 1);
  assert.equal(matterSearch.data[0].document_uuid, 'doc-1');
  assert.deepEqual(matterSearch.warnings, [
    'Skipped 1 documents during matter-wide search.',
    'unsupported_media_type: 1 skipped (501: email.eml)',
  ]);

  await clientTransport.close();
});
