# Chapter projects

[日本語](./report-projects.ja.md)

Split a Report into source files and assemble them in a manifest-defined order. This feature is not a slide project manager or a TeX `\\input` / `\\include` implementation.

## Editing and saving

| Action                       | Scope                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Select a chapter             | Load only that chapter in the editor                                                         |
| Add a blank chapter / source | Add a heading and empty paragraph, or one source file with images                            |
| Move up/down                 | Change the assembly order                                                                    |
| Include in combined output   | Include or exclude a chapter from numbering, TOC, references and output; keep its source     |
| Delete chapter               | Remove it from the project after confirmation; never delete the original file on your device |
| Chapter Markdown / JSON      | Save only the active source; no images or project structure                                  |
| Combined Markdown / JSON     | Save enabled chapters as one document; no excluded sources or manifest                       |
| Save project ZIP             | Save the manifest, every chapter including excluded chapters, and referenced imported images |

A chapter name is a navigation label; renaming it does not change its source title or headings. Project title, theme, TOC and section numbering control the combined document. Each chapter's front matter is retained; project settings take precedence in the combined view.

Excluding all chapters produces an empty combined body. The final chapter cannot be deleted. Structural operations are outside Undo; switching or deleting chapters resets the body Undo history.

## Pages and references

No automatic break is inserted before the first enabled chapter. Later chapters follow their **Page break before chapter** setting. Explicit breaks inside a chapter retain leading, trailing and consecutive empty pages.

Section, figure, table and equation numbers, the TOC and label references are computed over enabled chapters. Reordering or excluding a chapter recalculates them. Duplicate and unresolved labels produce warnings; labels are never silently renamed. References to an excluded chapter become unresolved.

The project preview renders one explicitly separated page at a time. Use page selection, TOC links and references to navigate. Content is not automatically split at A4 boundaries. A single very large chapter or page can still be expensive to render.

## ZIP format

```text
report.kumi.zip
├── project.json
└── chapters/
    ├── chapter-.../
    │   ├── document.md
    │   └── assets/image-1.svg
    └── chapter-.../
        └── document.json
```

Example manifest; the `chapters` array determines order:

```json
{
  "schemaVersion": 1,
  "type": "kumi-report-project",
  "metadata": {
    "title": "Research report",
    "theme": "latex",
    "toc": true,
    "number_sections": true
  },
  "chapters": [
    {
      "id": "intro",
      "title": "Introduction",
      "file": "chapters/intro.md",
      "enabled": true,
      "pageBreakBefore": false
    }
  ]
}
```

You may extract, edit and re-compress the project. Keep `project.json` at the ZIP root. Each chapter must be a Report Markdown or Document JSON file. If Markdown cannot represent a chapter, saving uses a `.json` file in the same directory. Markdown element IDs are regenerated on import; use labels for references. JSON element IDs must be unique across all chapters.

Local image paths are relative to each chapter source. Paths such as `../images/a.png` may share an image within the ZIP but cannot escape it. Newly added chapters receive their own `assets` directory to prevent same-name images in different chapters from colliding.

Image paths in a combined Markdown/JSON export are relative to the ZIP root. To use the combined document with images elsewhere, place it at the extracted project's root and keep the image directories alongside it. External image URLs remain links and are never downloaded for packaging. Missing local images block ZIP saving and loading with an error.

## Limits and safeguards

- Up to 100 chapters and 300 ZIP entries including directories.
- A ZIP may be up to 60MiB; total expanded content is limited to 50MiB. Each source or manifest is limited to 5MiB and each image to 20MiB.
- Absolute or escaping paths, duplicate filenames including case-only collisions, Windows reserved names, unsafe paths and unrelated attachments are rejected.
- Apply or discard Markdown drafts before switching chapters. Edits during a ZIP operation invalidate its result; save again after editing.
- There is no cloud storage or autosave. The downloaded ZIP is the resumable source. Save regularly rather than relying on the browser's unload warning.
- PDF, Report HTML, automatic A4 typesetting, direct filesystem writes and collaboration are outside this feature.
