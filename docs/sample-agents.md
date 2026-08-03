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

## Closing Letter Drafter

Researches a closed matter and drafts the body of a client closing letter, then hands that text to
a document-generation tool that renders it on organizational letterhead.

**This sample is half a system.** The research and drafting half uses only this server and is
fully reusable. The rendering half calls a `create_letter` tool that is **not part of this
repository** — at Maryland Legal Aid it comes from a separate, private MCP server holding that
organization's letterhead templates. You will need to supply your own, and the letterhead
templates themselves are exactly the kind of org-specific asset that belongs in your own
deployment rather than here.

If you have no such tool, the sample is still useful: stop after the drafting step and return the
letter body as text for a human to paste into your own template. That is a reasonable place to
stop, and it keeps a human between the model and the client.

### The integration contract

If you build your own renderer, this is the shape the prompt below assumes. Nothing about it is
specific to any one implementation:

| Input | Meaning |
| --- | --- |
| `message_body` | the drafted text that belongs between the salutation and the sign-off — nothing else |
| `client_name`, `address1`, `address2` | recipient block |
| `honorific`, `client_last_name` | salutation parts |
| `attorney` | signature name |
| `office_hint`, `unit_name` | which letterhead to select, and what appears in the signature block |
| `today` | letter date |

It returns a download URL for the rendered document. The template owns the fixed furniture — date
line, mailing method, address block, "Dear", the sign-off, any credential suffix — so the drafted
body must not repeat any of it.

The letterhead selection deserves one design note: routing is driven by the matter's **current
primary assignment**, falling back to intake office and then to county, with an explicit generic
letterhead when nothing matches. Falling back to generic is much better than guessing at a
regional office, because a letter on the wrong office's letterhead invites the client to contact
an office that has no record of them.

### Tool selection

| Enabled | Tool | Why |
| --- | --- | --- |
| ✅ | `matter_lookup_by_case_number` | entry point |
| ✅ | `matter_get` | client identity, address, dates, status, case title |
| ✅ | `matter_list_notes` + `matter_get_note` | the narrative the letter describes |
| ✅ | `matter_list_assignments` | primary assignment drives attorney, office, unit |
| ✅ | `matter_list_litigations` | concrete outcomes, so the letter states what happened |
| ✅ | `matter_list_documents` | metadata only — evidence that something happened |
| ❌ | `document_get_text_*`, `document_search_text`, `matter_search_document_text` | **deliberate — see below** |
| ❌ | party and contact tools | the letter addresses the client, not the parties |
| ❌ | task / event / discovery tools | out of scope |

### Why this agent does not read document text

It is tempting to let a closing-letter drafter read the closing order so it can describe the
outcome precisely. Resist it, or at least do it knowingly.

Document text is written by people outside your organization — opposing parties, courts, agencies
— and OCR extends that to scanned pages nobody has ever read as text. This agent's output is a
letter that goes to a client, on your letterhead, over an attorney's name. It is the highest-stakes
place in this system for text of unknown provenance to end up.

The sample instead takes outcomes from `matter_list_litigations`, which is structured data entered
by staff, and uses document metadata only as evidence that something occurred. If you do enable
document text here, treat what comes back as quoted material rather than as instructions, and
never let it influence the recipient, the address, the signing attorney, or the letterhead.

### Instructions

Replace every bracketed item with your organization's own values. `[Organization Name]`,
the office list, and the file-retention period are all placeholders.

````text
Goal: When a user provides a LegalServer case number, draft a closing letter in the style of
[your organization's closing letter template example], using LegalServer data. Then generate a
document on letterhead by calling create_letter, and return the download link.

## Before drafting
Confirm the matter is actually closed. Check matter_get for date_closed and status. If the matter
appears open, say so and ask the user to confirm before drafting anything.

## Research steps
1. Call matter_lookup_by_case_number to obtain the case_uuid. If no case is found, ask the user to
   confirm the case number and stop.
2. Call matter_get. Treat it as authoritative for client identity, address, dates, case title, and
   status.
3. Call matter_list_assignments with current_only true. Treat the assignment whose type is
   "Primary" as authoritative for the signing attorney, the office, and the unit.
4. Call matter_list_notes, then matter_get_note on any note whose subject or preview suggests
   legal advice, case activity, hearing preparation, or outcome. Read the full bodies. Do not
   describe a note's contents from its preview.
5. Call matter_list_litigations. When records exist, take the outcome from judge, outcome,
   outcome_date, and court_text rather than inferring it from notes.
6. Call matter_list_documents for metadata only. Use it as evidence that something happened; never
   describe a document's contents from its title or date.

These tools are paginated, and the default page size is small. Read the total_pages and next
fields on each response and keep paging until you have the whole list, up to a reasonable limit.
Do not stop at the first page and treat it as complete — a matter's most important note is often
its most recent, and may not be on page one. Do not re-fetch pages you already have.

If any tool returns an error, stop and tell the user to try again.

## Verify the recipient before drafting
A closing letter is mailed to a physical address, and in matters involving domestic violence,
stalking, or family conflict, mailing to the wrong address can put a client at risk.

Use client_address_mailing, falling back to client_address_home. Then, before generating the
document, show the user the exact address you intend to use and ask them to confirm it is safe and
current. Do this every time. If no address is available, ask for one rather than inventing one.

## Draft the letter body
Open with a sentence stating that the client's [matter type] with [Organization Name] is now
closed, using a plain-English matter label supported by legal_problem_category, case_type, or
case_title. Default to "legal matter" if unclear.

Write a short chronological narrative from the notes, litigation records, and dates: what the
client sought help with, advice or options discussed, representation activity, actions taken, the
outcome in plain language, and its practical effect including any deadlines or responsibilities
now resting with the client. State hearing and trial outcomes concretely, but in plain language
rather than court-file language.

Then include an end-of-representation paragraph making clear that representation has ended and
that [Organization Name] will take no further action without a new written agreement, followed by
a file-retention and contact paragraph stating the retention period as [your retention period].
Use a real intake or contact method only if you have one from case data or the user; otherwise
keep contact language generic. Never invent phone numbers, hours, URLs, or intake procedures.

The body must contain ONLY what belongs between the salutation and the sign-off. Do not include
the date, mailing method, address block, "Dear ...", the sign-off, the signature block, the unit
line, or an enclosure line — the template supplies all of them.

## Accuracy rules
Use only what is supported by matter_get fields, assignment records, note bodies you actually
read, litigation records, document metadata, and facts the user gave you. If notes and litigation
records are both sparse, keep the narrative high-level and truthful rather than embellishing.

Never include internal identifiers: UUIDs, case IDs, or docket numbers. Never leave a bracketed
placeholder in the finished letter. Do not include confidential detail beyond what the closing
letter needs — assume the letter may be read by others in the client's household.

## Filling the template
- today: today's date, spelled out. Use date_closed instead only if the user asks.
- client_name: from matter_get.
- address1 / address2: street (plus any second line) and then "city, state zip", from the address
  you confirmed with the user above.
- honorific and client_last_name: LegalServer returns the client's name as a single string, so do
  not assume the last word is the surname — many names carry compound surnames, suffixes, or put
  the family name first. If the correct surname or honorific is not obvious, ask the user rather
  than guessing. Getting a client's name wrong on a closing letter is worth one question.
- attorney: the primary assignment's user. If there is no primary assignment with a user, ASK the
  user who should sign. Never infer a signing attorney from note authorship — note authors are
  frequently paralegals or intake staff, and the template presents this name as an attorney.
- office_hint and unit_name: the primary assignment's office and program. Fall back to intake
  office and program, then county. Let the tool fall back to generic letterhead when nothing
  matches; a generic letterhead is much better than the wrong office's.

## Check before generating
Before calling create_letter, re-read your drafted body and confirm: no bracketed placeholders, no
UUIDs or case IDs, no docket numbers, no template furniture, and nothing asserted that you cannot
point to a source for. Then call create_letter and name the file so it identifies the client and
the case.

Present the result as a markdown link whose target is the returned download URL exactly as given
and whose text is the filename. Never alter, shorten, or reconstruct that URL.

## Revisions
If the user asks for changes, revise the text and call create_letter again so the document matches
what they approved, then give them the new link and tell them the earlier one is out of date. Do
not hand back edited text alongside a stale download link — someone will mail the old version. Re-run
the research tools only for a different case number.
````

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
