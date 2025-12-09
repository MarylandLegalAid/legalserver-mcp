# LegalServer MCP Server  
*Work in Progress*

This repository contains a **Model Context Protocol (MCP) server** designed to integrate with **LibreChat** and provide tool-based access to your LegalServer case-management system.  
It is an early-stage, actively evolving implementation intended to support legal-aid staff through structured, opinionated LegalServer queries.

---

## Current Tooling Provided (4 MCP Tools)

### **1. `search_case_by_number`**  
Searches LegalServer for a matter using its **public case number** (e.g., `25-1234567`).  
Returns identifying metadata—most importantly the **matter UUID** required by other tools.

### **2. `get_case_info`**  
Retrieves **various case details** for a given matter UUID, including:  
- case title, numbers, status, and disposition  
- client/contact information  
- important dates  
- intake data  
- problem codes  
- case notes

### **3. `list_case_documents`**  
Returns all documents for a specific case, including:  
- document GUID (preferred identifier)  
- internal ID  
- filenames, titles, MIME types  
- file sizes and token-length estimates  
- created/updated dates  

### **4. `get_document`**  
*Beta Feature*
Retrieves text content from a LegalServer document.  
Supports several modes:

| Mode | Behavior |
|------|----------|
| **preview** | Returns first chunk (default) |
| **chunk** | Returns a specific chunk index |
| **search** | Returns snippets matching a search term |
| **full** | Entire document (only if size is safe) |

Supports `.txt`, `.pdf` (via `pdf-parse` v2), and `.docx`/`.doc` (via `mammoth`). Unsupported formats return structured errors.

---

## Installation & Integration with LibreChat

### **1. Create a custom-tools directory**

Inside your LibreChat installation:

```
/librechat
  /custom-tools
    /legalserver-mcp
      .env
      index.js
      package.json
      README.md
```

Copy this repository into:

```
./custom-tools/legalserver-mcp/
```

Install dependencies:
**Note:** pdf-parse v2 requires node 20+

```bash
cd custom-tools/legalserver-mcp
npm install
```

---

### **2. Register the MCP server in `librechat.yaml`**

Add:

```yaml
mcpServers:
  LegalServer:
    command: node
    args:
      - ./custom-tools/legalserver-mcp/index.js
    env:
      LEGALSERVER_BASE_URL: ${LEGALSERVER_BASE_URL}
      LEGALSERVER_BEARER_TOKEN: ${LEGALSERVER_BEARER_TOKEN}
    description: "Tools for interacting with Legalserver case management"
    chatMenu: true
```

Set required environment variables:

```
LEGALSERVER_BASE_URL=https://your-site.legalserver.org/
LEGALSERVER_BEARER_TOKEN=xxxxxxxx
```

Restart LibreChat.

---

## Reference Documentation

LibreChat MCP server documentation:  
https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers

---

## Example Use Case: LS Case Summarizer Agent

Create a LibreChat agent configured with these tools:

- `search_case_by_number`
- `get_case_info`
- `list_case_documents`

**Agent instructions example:**

> When provided a LegalServer case number (e.g., “24-0539721”), use the legalserver tools to search for that case and get information about it, including its documents.  
> If the user does not provide a LegalServer case number, prompt them to provide one.  
> Then provide a summary of what the case is about in a timeline format.

### **Example Workflow**

1. User asks:  
   `Please summarize case 24-0539721`

2. Agent performs:
   - `search_case_by_number` → obtains matter UUID  
   - `get_case_info` → retrieves case metadata and notes  
   - `list_case_documents` → optionally reviews document list  

3. Agent outputs a structured **timeline summary** of the case.
