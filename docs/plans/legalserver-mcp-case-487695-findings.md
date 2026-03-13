# Case 487695 Findings: Live Document Handling Evaluation

## Context
- Resolved case database ID `487695` to case UUID `2561a41e-1977-11ed-8449-0e887f6053d2`.
- Treated all documents created on `2026-03-12` as the canonical John Jeffcott corpus.
- Used the current `v2` repo state plus live LegalServer credentials from `.env`.

## Corpus Summary
- Total case documents: `276`
- Canonical March 12 corpus: `103`
- Canonical corpus composition:
  - `54` PDFs
  - `48` `.eml` / `application/mbox`
  - `1` `.rtf`
- Baseline extraction outcomes on the canonical corpus before OCR was configured:
  - `8` succeeded as `pdf_text`
  - `46` failed with `ocr_unavailable`
  - `49` failed with `unsupported_media_type`

## Retrieval Findings
- Real documents on this case are downloadable.
- For document `2679592` (`Chapter 13 Trustee Annual Report.pdf`), these three routes were identical:
  - metadata `download_url`
  - `/modules/document/download.php?unique_id=<guid>`
  - `/modules/document/download.php?id=<internal_id>`
- All three returned:
  - `200`
  - `application/pdf`
  - matching `content-disposition`
  - matching `content-length`
  - matching PDF signature bytes
- Real RTF and EML downloads also returned clean binary responses:
  - `2679559` returned `200 text/rtf`
  - `2679524` returned `200 application/mbox`

## Representative Outcomes
- `2679592` (`Chapter 13 Trustee Annual Report.pdf`)
  - `document_get_text_manifest` succeeded
  - `text_source = pdf_text`
  - `chunk_count = 1`
- `2679626` (`Signed Claimant Response to Debtor W. Chase.pdf`)
  - before OCR configuration: failed with `ocr_unavailable`
  - after Vertex OCR configuration: succeeded
  - `text_source = pdf_ocr`
  - `ocr_provider = vertex_gemini`
  - `page_count = 8`
  - `chunk_count = 5`
  - `total_text_chars = 16038`
- `2679559` (`03-10-2022 - Intake Report-... .rtf`)
  - failed with `unsupported_media_type`
- `2679524` (`FW_ Child Support Issue for Doug Hicks Bey.eml`)
  - failed with `unsupported_media_type`
- `2679571` (`FW_ Hearing Scheduled for Next Week on November 19, 2025.eml`)
  - metadata `mime_type = application/octet-stream`
  - `size_bytes = 0`
  - failed with `unsupported_media_type`

## Case-Wide Behavior Findings
- `matter_search_document_text` is currently not usable on this case.
- The first failure on the full case is old artifact document `2339064` (`Cl JWilliams Civil Rights.pdf`).
- That failure is:
  - `errorCode = extraction_failed`
  - `status = 502`
  - message: `LegalServer returned document metadata, but no retrievable allowlisted download URL was available for this document.`

## Ordering Bug
- The document ordering used by `matter_search_document_text` is incorrect when both records have null `date_update`.
- In `compareMatterSearchOrder(...)`, this branch can produce `NaN`:
  - `toTimestamp(right.date_update) - toTimestamp(left.date_update)`
- When both values normalize to `Number.NEGATIVE_INFINITY`, the subtraction becomes `NaN`.
- Because `NaN !== 0`, the comparator returns `NaN` early and never falls through to `date_create`.
- Observed result: older artifacts can appear ahead of newer March 12 documents.

## OCR Validation Finding
- Vertex OCR is now configured through `.env` and works end to end.
- A live read-only validation against scanned PDF `2679626` returned:
  - `text_source = pdf_ocr`
  - `ocr_provider = vertex_gemini`
  - `ocr_model = gemini-2.5-flash`
  - `page_count = 8`
  - `chunk_count = 5`
  - `total_text_chars = 16038`
- The earlier `46` `ocr_unavailable` results were an environment-specific baseline from before OCR was enabled, not a repo defect in the OCR pipeline.
- Current repo state therefore supports:
  - born-digital PDFs without OCR
  - scanned PDFs through Vertex OCR when configured
  - explicit `ocr_unavailable` failures only in deployments where OCR remains disabled

## Conclusion
- Phase 2.5 should not be reverted based on the earlier deleted-demo-doc incident.
- The OCR configuration gap is now closed and the live OCR path is validated.
- The real corpus shows the retrieval path is healthy, but the current repo still needs follow-up work in three areas:
  - deterministic matter document ordering
  - case-wide handling of mixed supported/unsupported/broken documents
  - format support and/or clearer policy for `.eml` and `.rtf`
