# KUMI quick guide

KUMI is a browser application for editing and reviewing technical reports and slides from Markdown or Document JSON. It opens in Japanese and light mode by default. Use the header controls to switch to English or dark mode; your choices are saved in this browser.

## 1. Start a document

- Select **Open Markdown** in the lower-left panel to import Markdown or Document JSON. Select local image files at the same time when Markdown refers to them.
- Use **Report** or **Slide** in the same panel to start a blank document.
- Imported documents and images stay in your browser. They are not automatically uploaded to GitHub Pages or this repository.

## 2. Edit

- Edit text directly in the **Visual editor**. The formatting toolbar adds headings, lists, quotes, tables, equations, and page or slide breaks.
- Use the **Markdown** tab to edit source. Choose **Apply Markdown**, or save **Markdown/JSON** from the header when you finish. While a Markdown draft is unapplied, KUMI prevents a return to the visual editor to avoid conflicting changes.
- Unfinished content, chapter structure, unapplied Markdown, and imported images are temporarily kept as a recovery copy in this browser. When you return, choose whether to restore or remove it. This is device-local help only, so keep Markdown, JSON, or a project ZIP as the source of record.
- Select an element to configure its theme, table of contents, numbering, reference label, caption, and an image's width, alignment, or alternative text in **Properties**.

## 3. Edit tables in detail

- Place the cursor in a table cell to reveal the table toolbar. You can add or remove rows and columns, toggle the first row as a header, and merge or split adjacent cells.
- Choose all, outer, inner, or one edge to draw borders with a color, solid/dashed/dotted/double style, and width. Switch to **Erase borders** to remove only the selected edges.
- Simple tables save as standard Markdown tables. Tables with merged cells, per-edge borders, or multiple paragraphs save as a lossless KUMI table block in Markdown. Do not alter that block in an external Markdown editor; also keep JSON or a project ZIP as the source of record.
- Preview and Slide HTML exports preserve merged cells and per-edge borders.

## 4. Review and save

- Use **Preview** to review Reports as A4 pages and Slides as 16:9 slides. Explicit page and slide breaks start a new preview page.
- Save a file with **Markdown** or **JSON** in the header. Document JSON retains every editing structure.

### Take HTML slides with you

1. Create or import a **Slide** document and insert slide breaks where needed.
2. Select **HTML** in the header to download a single `.html` file.
3. Open the file in a browser. Use **Previous/Next**, ←/→, or Space to navigate, and Home/End to jump to the first/last slide. F or **Fullscreen** works in supported browsers. Table-of-contents and cross-reference links open the target slide.

The slide frame scales to fit the screen. Overflowing content can be scrolled within the slide; add more slide breaks before presenting if needed.

Math fonts and imported images are embedded in the HTML. External image URLs still need a network connection. If an image has not been imported, save your source as Markdown/JSON first, then import the source and images together before exporting again.

HTML is for viewing and presenting; it cannot be re-imported into KUMI. Unapplied Markdown drafts are included in the export, but are not applied to the editable document or marked as saved. **Save Markdown/JSON separately to keep an editable source.**

## 5. Change display and language

- Use the moon/sun button to switch light and dark mode. The workspace changes appearance, while the document canvas stays white for readability.
- Use **EN** or **日本語** to change the application interface. Your document is never translated automatically.
- Open **Guide** to view the same essential instructions inside the application.
- On a narrower screen, use the header's Document panel and Properties buttons to open the document/chapter list and settings that normally appear at the sides.

## 6. Split a long report into chapters

1. Open a Report and select **Turn this report into a project** in the left panel.
2. Use **Add a blank chapter** or **Add source as chapter**. Select one Markdown/Document JSON source and any local images it needs.
3. Select a chapter to edit only that chapter. Use Move up/down to reorder it. Uncheck **Include in combined output** to exclude a chapter while keeping its source. Deletion requires confirmation.
4. Use **Page break before chapter** and in-document page breaks to arrange pages. The combined preview supports Previous/Next, page selection, and TOC/reference links. Numbering and references cover all enabled chapters.
5. **Save project ZIP** saves the structure, all chapters and images. Resume with **Open project ZIP**.

**Chapter Markdown/JSON** in the header saves only the active chapter. Combined exports produce one document containing the enabled chapters. Neither replaces a project ZIP or clears the project's unsaved indicator.

Apply or discard Markdown and return to the visual editor before changing the chapter structure. Structural changes are outside Undo; switching or deleting chapters resets the body Undo history. A device-local recovery copy can help resume unfinished work, but **save a ZIP before closing the tab**. See [Chapter projects](./report-projects.en.md) for details.

## Using the published version

GitHub Pages is public. Do not import documents or images containing customer information, personal data, confidential information, or credentials. Handle files stored on your device or exported from KUMI according to your organization's policies.
