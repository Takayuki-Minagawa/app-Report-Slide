# KUMI quick guide

KUMI is a browser application for editing and reviewing technical reports and slides from Markdown or Document JSON. It opens in Japanese and light mode by default. Use the header controls to switch to English or dark mode; your choices are saved in this browser.

## 1. Start a document

- Select **Open Markdown** in the lower-left panel to import Markdown or Document JSON. Select local image files at the same time when Markdown refers to them.
- Use **Report** or **Slide** in the same panel to start a blank document.
- Imported documents and images stay in your browser. They are not automatically uploaded to GitHub Pages or this repository.

## 2. Edit

- Edit text directly in the **Visual editor**. The formatting toolbar adds headings, lists, quotes, tables, equations, and page or slide breaks.
- Use the **Markdown** tab to edit source. Choose **Apply Markdown**, or save **Markdown/JSON** from the header when you finish. While a Markdown draft is unapplied, KUMI prevents a return to the visual editor to avoid conflicting changes.
- Select an element to configure its theme, table of contents, numbering, reference label, caption, and an image's width, alignment, or alternative text in **Properties**.

## 3. Review and save

- Use **Preview** to review Reports as A4 pages and Slides as 16:9 slides. Explicit page and slide breaks start a new preview page.
- Save a file with **Markdown** or **JSON** in the header. Document JSON retains structures that Markdown cannot represent.

### Take HTML slides with you

1. Create or import a **Slide** document and insert slide breaks where needed.
2. Select **HTML** in the header to download a single `.html` file.
3. Open the file in a browser. Use **Previous/Next**, ←/→, or Space to navigate, and Home/End to jump to the first/last slide. F or **Fullscreen** works in supported browsers. Table-of-contents and cross-reference links open the target slide.

The slide frame scales to fit the screen. Overflowing content can be scrolled within the slide; add more slide breaks before presenting if needed.

Math fonts and imported images are embedded in the HTML. External image URLs still need a network connection. If an image has not been imported, save your source as Markdown/JSON first, then import the source and images together before exporting again.

HTML is for viewing and presenting; it cannot be re-imported into KUMI. Unapplied Markdown drafts are included in the export, but are not applied to the editable document or marked as saved. **Save Markdown/JSON separately to keep an editable source.**

## 4. Change display and language

- Use the moon/sun button to switch light and dark mode. The workspace changes appearance, while the document canvas stays white for readability.
- Use **EN** or **日本語** to change the application interface. Your document is never translated automatically.
- Open **Guide** to view the same essential instructions inside the application.

## Using the published version

GitHub Pages is public. Do not import documents or images containing customer information, personal data, confidential information, or credentials. Handle files stored on your device or exported from KUMI according to your organization's policies.
