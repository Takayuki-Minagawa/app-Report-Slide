# Report / Slide chapter projects

[日本語](./report-projects.ja.md)

Organize a Report or Slide document as several chapters or decks, then assemble them in the chosen order. All chapters in a project must use the same document type.

## Editing and saving

| Action                                       | Scope                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Turn this report / slide deck into a project | Use the open document as the first chapter                                                                                   |
| Add source as chapter                        | Add one Markdown, JSON, editable HTML or document ZIP at a time, with image/PDF attachments when needed                      |
| Select a chapter                             | Edit that chapter only                                                                                                       |
| Move up/down; Include in combined output     | Change chapter order and inclusion without deleting excluded chapters                                                        |
| Chapter Markdown / JSON                      | Save the active chapter with its effective theme and citations; asset files remain separate                                  |
| Export scope: combined / active chapter      | Choose the scope for HTML, PDF, Office and editable ZIP                                                                      |
| Combined Markdown / JSON                     | Assemble included chapters without project structure or asset bytes                                                          |
| Project ZIP                                  | Save every chapter, including excluded chapters, structure, images, original PDFs, reusable parts, citations and supplements |

A chapter name is a navigation label; it does not change the manuscript title or headings. The final chapter cannot be deleted. Excluding every chapter produces an empty combined document. Deletion asks for confirmation and never removes the source file on your device.

## A four-chapter Slide project

1. Open a Slide document and turn it into a project.
2. Use **Add source as chapter** three times to import three other decks. Same-named images and original PDFs remain distinct.
3. Choose chapter order and inclusion. Use **All chapter slides** to select and edit a page in another chapter.
4. Choose **Active chapter only** to export that chapter as HTML, PDF, PPTX or editable ZIP. Return to **Combined included chapters** to recreate the complete deck. Save a project ZIP to resume the chapter-based work later.

Slide chapters always begin on a new slide. **Add chapter contents slides** generates a linked chapter list, with up to twelve chapters per contents page. Chapter reordering and inclusion update its destinations.

Set a common project theme, then choose inheritance or an override for each chapter. Existing page-specific designs take precedence. Manual image placement, composite regions, tables, charts, speaker notes and audience supplements stay with their page.

Use **Chapter slide actions** to duplicate a page, move it earlier/later or move it to the end of another chapter. Copies have independent element IDs and reference labels. Images and original PDFs remain available in the destination chapter. **Undo last slide action** restores body, design and supplements together. Further editing disables that Undo so it cannot overwrite later work. Switching chapters resets ordinary body Undo history.

## Report pages and references

Report uses the existing **Page break before chapter** option, with no automatic break before the first enabled chapter. Both document types retain explicit leading, trailing and consecutive empty pages.

Numbering and references are calculated across included chapters; references into excluded chapters produce warnings. Report retains its existing project-wide labels. Importing another Slide deck renames labels that collide with earlier chapters and updates that deck's internal references. Conflicting publication IDs also remain distinct; subsequent edits to a shared publication update its chapters.

Preview shows explicitly separated pages. It does not automatically paginate long Report content at A4 boundaries.

## ZIP format and compatibility

The ZIP contains `project.json` at its root, chapter sources at `chapters/<id>/document.md` or `document.json`, and chapter asset directories. `schemaVersion` remains 1. The project type is `kumi-report-project` or `kumi-slide-project`; existing Report ZIPs still open. Optional chapter `themeOverride` and project `metadata.project_toc` preserve Slide theme exceptions and contents settings.

A chapter must be Markdown or Document JSON of the matching document type. Saving falls back to a non-conflicting JSON filename when Markdown cannot represent a chapter. Adding editable HTML or a document ZIP also imports its supported editing information.

JSON node IDs are unique within each chapter. Assembly namespaces IDs across chapters. Markdown import regenerates IDs and rebinds page designs and supplements to the imported pages.

Asset paths are relative to each chapter source. Imported chapters receive separate asset directories. Combined Markdown/JSON uses paths relative to the project ZIP root, so keep the asset directories when using those files elsewhere. Chapter HTML and editable ZIP can embed/package the assets. External image URLs remain external links.

## Limits

- Up to 100 chapters and 300 ZIP entries including directories. ZIP size: 60MiB; expanded total: 50MiB; each source/manifest: 5MiB; each asset: 20MiB.
- Stored and Deflate ZIPs are supported. Encryption, symbolic links, escaping or unsafe paths, duplicate filenames and CRC mismatches are rejected.
- Missing local images or original PDFs block ZIP saving/loading with an explanation.
- Apply or discard Markdown drafts before chapter operations. Edits during asynchronous work invalidate stale results.
- Combined output is also subject to document size limits. The project ZIP retains chapter structure and excluded chapters.
- There is no cloud storage, TeX file-inclusion compatibility, collaboration or direct filesystem write-back. Save a project ZIP regularly in addition to the device-local recovery copy.
