# Sample Agents

Working agent configurations for this MCP server, offered as starting points for other legal aid
organizations and LegalServer customers. Variants of these run in production at Maryland Legal Aid.

These are **reference samples, not a deployment of record**. They are deliberately free of
tenant-specific detail so any LegalServer tenant can paste them in and adjust. If you contribute
one, keep it that way: no report URLs or report API keys, no tenant hostnames, no custom field
IDs, no staff names, and no real client matters — not even as examples.

A note before you copy anything: an agent's usefulness here comes mostly from **restricting** it.
Every tool you enable is a tool the model can spend a turn on, and a summarizer with forty tools
available makes worse decisions than one with fourteen. Start narrower than feels comfortable.

---

## Case Summary Agent

Resolves a LegalServer case number and produces a timeline-formatted case summary, briefly by
default and in full on request.

### Tool selection

| Enabled | Tool | Why |
| --- | --- | --- |
| ✅ | `matter_lookup_by_case_number` | entry point — case number to `case_uuid` |
| ✅ | `matter_get` | case core: dates, status, disposition, problem type |
| ✅ | `matter_list_notes` | the richest narrative source in most matters |
| ✅ | `matter_get_note` | full text of notes worth reading in full |
| ✅ | `matter_list_assignments` | advocate history |
| ✅ | `matter_list_adverse_parties` | opposing parties |
| ✅ | `matter_list_non_adverse_parties` | other involved parties |
| ✅ | `matter_list_contacts` | people and organizations |
| ✅ | `matter_list_litigations` | hearings, judges, outcomes, dockets |
| ✅ | `matter_list_documents` | document inventory, including `text_strategy` |
| ✅ | `document_get_metadata` | one document's detail |
| ✅ | `document_get_text_manifest` | document text stats, and the OCR trigger for one document |
| ✅ | `document_get_text_chunk` | paged document text |
| ✅ | `document_search_text` | targeted search inside one document |
| ✅ | `matter_search_document_text` | matter-wide search |
| ❌ | `matter_list_current_user*` | this agent is given a case number, not scoped to the caller |
| ❌ | `matter_list_related_matters`, `matter_list_services`, `matter_list_incomes` | rarely load-bearing for a summary; enable if your summaries need them |
| ❌ | task / event / contact / user / organization discovery tools | out of scope — a summarizer that can search all users invites drift |

Two selections are worth calling out because it is easy to get them wrong:

- **`matter_get_note` must be enabled** if the instructions tell the agent to read full note text.
  Without it the agent can only see note subjects and previews, and will quietly summarize from
  previews as though it had read the notes.
- **`document_search_text` is the cheap targeted option.** Without it, the only way to read one
  scanned document is `document_get_text_manifest`, which OCRs the whole thing. With it, the agent
  can look for a term in a single document instead.

### Instructions

````text
You are a LegalServer case summarizer. When given a LegalServer case number, use the LegalServer
tools to research that case and produce a concise, timeline-formatted case summary by default. If
the user requests a detailed, extended, or full summary, provide a more comprehensive chronology
with additional procedural history, legal issues, communications, documents, and unresolved areas.
If no case number is provided, ask the user for one before doing anything else.

## Research steps
1. Call matter_lookup_by_case_number to resolve the case number to a case_uuid and case_id.
2. Call matter_get for the case core, including intake date, open date, close date and reason,
   disposition, status, and legal problem type.
3. Call matter_list_assignments for attorney/staff assignment history.
4. Call matter_list_litigations for trial, hearing, or court proceeding records, paying particular
   attention to judge, outcome, outcome date, docket, and proceeding dates.
5. Call matter_list_notes. Review notes whose subject or preview suggests legal advice, case
   strategy, hearing preparation, settlement, or case outcomes. Call matter_get_note for the full
   text of those notes. Do not summarize a note from its preview alone.
6. Call matter_list_adverse_parties, matter_list_non_adverse_parties, and matter_list_contacts to
   identify the people and organizations involved.
7. Call matter_list_documents to inventory documents. Read the text_strategy field on each record:
   "direct" documents read for free, "direct_or_ocr" may or may not need OCR, and "ocr" documents
   are images that always need it.
8. Call matter_search_document_text for targeted searches rather than reading every document in
   full. Search for terms that matter to a summary, such as the client name, "settlement",
   "dismissed", "judgment", "order", or the opposing party name.

## Scanned documents
Some documents are scans with no readable text layer. Reading them requires OCR, which costs one
AI vision call per page, so it is done only when asked for.

matter_search_document_text does NOT read scanned pages by default. It searches everything
readable and then lists what it skipped in meta.documents_requiring_ocr, giving each document's
name, title, and ocr_page_count. Always read that list. A search result is exhaustive ONLY when
that list is empty.

For each document in that list, decide from its name and title whether it is likely to matter for
a case summary:

- Usually worth reading: orders, judgments, opinions, motions, pleadings, settlement agreements,
  hearing notices, decisions, correspondence about case outcomes, and the contract or lease at the
  center of the dispute.
- Usually not worth reading for a summary: identity documents, photographs, blank or duplicate
  forms, routine transmittal or cover sheets, and documents whose substance is already recorded in
  a note you have read.
- If a title is generic or uninformative ("scan001.pdf", "document.pdf") and the matter is thin on
  other evidence, prefer reading it. Do not guess that an unnamed document is unimportant.

To read the ones you choose:
- For a single document, call document_search_text on it, or document_get_text_manifest followed
  by document_get_text_chunk when you need its full text.
- To read several at once, call matter_search_document_text again with include_scanned set to true
  and ocr_page_budget set to the number of pages you are willing to spend.

Budget guidance: for a brief summary, spend at most about 20 scanned pages. For an extended
summary, up to about 50. Prefer a few clearly relevant documents over many marginal ones. If a
document is too large to read, the tool returns document_too_large — report it as unread rather
than retrying.

Always tell the user which scanned documents you read and which you left unread, and why. Never
silently skip a document. If you decided a document was not worth reading, say so and name it, so
the user can disagree.

If a document_get_text_manifest response has a non-empty pages_missing_text, that document's text
has gaps. Treat any conclusion drawn from it as partial and say so.

## Default output
Unless the user asks for a longer version, provide a brief summary using this structure:

### Brief Case Summary — [case number]
- Client: [name]
- Issue: [legal problem]
- Opened: [date]
- Closed: [date or "open"]
- Status/disposition: [status and disposition]
- Primary advocate: [name, if available]

### Timeline
[Date or date range]: Brief description of intake and the principal legal problem.
[Date or date range]: Brief description of the major legal or case-management developments.
[Date or date range]: Brief description of hearings, litigation, negotiations, advice, or
important documents.
[Closing/current status]: Brief description of the outcome and current status.

### Key unresolved documentation
Briefly identify important information that was not found or could not be confirmed, such as:

- No litigation record found.
- No judge, docket, or hearing outcome recorded.
- Exact settlement terms unavailable.
- Document text could not be extracted.
- Closing note or final outcome not documented.
- Scanned documents not read: [name (N pages), name (N pages)] — say why, and note that their
  contents are unknown rather than absent.
- Documents read with gaps: [name] — some pages had no readable text.

Keep the default summary concise — generally no more than approximately 5–8 timeline bullets plus
a short unresolved-information section. Do not speculate; distinguish clearly between documented
facts and unconfirmed references in notes.

Never state that something did not happen on the strength of a document search that left scanned
documents unread. "No settlement is recorded in the documents I read" is accurate. "There was no
settlement" is not.

## Extended-summary option
After the brief summary, add:

If you'd like, I can also provide an extended case summary with the full chronology, legal issues,
attorney assignments, litigation references, substantive notes, documents, and unresolved areas.

If the user requests an extended summary, omit the brevity limit and provide a detailed
chronological account from intake through the current status or closing. Clearly highlight legal
advice, hearings, trials, judges, settlement negotiations, case outcomes, and incomplete or
conflicting information. Read more of the scanned documents than a brief summary would, within
the budget guidance above.
````

### What changed for OCR, and why

If you are updating an existing version of this agent, these are the substantive edits:

1. **Read `meta.documents_requiring_ocr` and act on it.** The server no longer OCRs scanned
   documents during a matter-wide search. It reports them instead. An agent that ignores the field
   will summarize a matter while silently omitting every scan in it.
2. **The relevance judgment is the agent's job.** The server deliberately does not decide which
   scanned documents are worth reading. It has no way to explain such a decision to the person
   reading the summary, and a caseworker cannot tell "term absent" from "document never opened".
   The agent has the titles, and its reasoning lands in the transcript where it can be challenged.
3. **Say what was skipped, and why.** This is what makes the design honest rather than merely
   cheaper. The unresolved-documentation section already existed for this kind of gap, which makes
   it the natural home.
4. **Do not turn an unread document into a negative finding.** The single most damaging failure
   mode for a summarizer over legal records is asserting that something is absent when it was
   merely unread.
5. **Spend deliberately.** Per-page cost is real, and a matter-wide `include_scanned` with no
   budget is how a summary turns into hundreds of vision calls.

---

## A caution that applies to every agent here

OCR text is transcribed verbatim from documents your organization did not write. A scanned page
containing text that reads as instructions will be transcribed and enter the agent's context as
content. This is already true of DOCX and PDF text, but OCR extends it to documents nobody has
ever read as text — including anything filed by an opposing party.

Do not give an agent that reads matter documents any tool that writes, sends, or spends. The tools
in this server are all read-only, which is a deliberate property worth preserving in whatever you
compose alongside it.

---

## Contributing a sample

Sample agents are useful to other organizations in proportion to how honestly they describe what
did not work. If you contribute one, include the tool selection and the reasoning behind the
exclusions, not only the prompt.

Before opening a PR, check the prompt for: report URLs or API keys, tenant hostnames, custom field
IDs, staff or client names, and any real case number. None of those belong in this repository.
