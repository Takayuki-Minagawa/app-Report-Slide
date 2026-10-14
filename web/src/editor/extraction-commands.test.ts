import { Editor } from '@tiptap/core';
import { afterEach, expect, it } from 'vitest';
import { createEditorExtensions } from './extensions';
import { applyFigureExtraction } from './extraction-commands';
import {
  extractionBlocks,
  extractionResultSchema,
  type ExtractionResult,
} from '@/src/document/extraction';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { toEditorDocument, type FigureNode } from '@/src/document/model';
import { validateDocumentData } from '@/src/document/validation';

const evidence: ExtractionResult = {
  mode: 'text',
  method: 'ocr',
  text: '確認した文字\n<script>alert(1)</script>',
  rawText: '確忍した文字',
  rows: [],
  rawRows: [],
  numericValues: [],
  header: false,
  language: 'jpn+eng',
  confidence: 68,
  warnings: [],
};
let editor: Editor;
afterEach(() => editor?.destroy());

it('keeps original evidence and literal editable text in one Undo/Redo step and Markdown roundtrip', () => {
  const document = parseMarkdown(
    '![original](assets/source.png)\n\nFollowing',
  ).document;
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: toEditorDocument(document),
  });
  const figure = document.children[0] as FigureNode;
  expect(
    applyFigureExtraction(
      editor,
      figure.attrs.nodeId,
      { version: 1, extraction: evidence },
      true,
    ),
  ).toBe(true);
  expect(editor.state.doc.childCount).toBe(4);
  expect(editor.state.doc.child(2).textContent).toBe(
    '<script>alert(1)</script>',
  );
  const edited = { ...document, children: editor.getJSON().content! };
  expect(() => validateDocumentData(edited)).not.toThrow();
  const validated = validateDocumentData(edited);
  const reopened = parseMarkdown(serializeDocument(validated)).document;
  expect(
    (reopened.children[0] as FigureNode).attrs.figureEdit?.extraction,
  ).toEqual(evidence);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.childCount).toBe(2);
  expect(editor.state.doc.firstChild?.attrs.figureEdit).toBeNull();
  expect(editor.commands.redo()).toBe(true);
  expect(editor.state.doc.firstChild?.attrs.src).toBe('assets/source.png');
  expect(editor.state.doc.firstChild?.attrs.figureEdit.extraction.rawText).toBe(
    '確忍した文字',
  );
});

it('creates a cited editable table while preserving number spelling and fresh cell IDs', () => {
  const extracted: ExtractionResult = {
    ...evidence,
    mode: 'table',
    rows: [
      ['Name', 'Value'],
      ['A', '1.20'],
    ],
    rawRows: [
      ['Name', 'Value'],
      ['A', '１.２０'],
    ],
    numericValues: [
      [null, null],
      [null, 1.2],
    ],
    header: true,
  };
  const blocks = extractionBlocks(extracted, 'reference-one');
  expect(blocks[0]).toMatchObject({
    type: 'table',
    attrs: { sourceReferenceId: 'reference-one' },
    content: [
      { content: [{ type: 'tableHeader' }, { type: 'tableHeader' }] },
      {
        content: [
          {},
          {
            attrs: { align: 'right' },
            content: [{ content: [{ text: '1.20' }] }],
          },
        ],
      },
    ],
  });
  expect(extractionBlocks(extracted)[0].attrs.nodeId).not.toBe(
    blocks[0].attrs.nodeId,
  );
});

it('rejects oversized, ragged and mismatching numerical snapshots but permits manual row correction', () => {
  const table = {
    ...evidence,
    mode: 'table',
    rows: [['a']],
    rawRows: [['a', 'b']],
    numericValues: [[null]],
  };
  expect(extractionResultSchema.safeParse(table).success).toBe(true);
  expect(
    extractionResultSchema.safeParse({ ...table, numericValues: [] }).success,
  ).toBe(false);
  expect(
    extractionResultSchema.safeParse({ ...table, rows: [['a'], ['a', 'b']] })
      .success,
  ).toBe(false);
  expect(
    extractionResultSchema.safeParse({ ...table, rawText: 'x'.repeat(100001) })
      .success,
  ).toBe(false);
  expect(
    extractionResultSchema.safeParse({
      ...table,
      rows: Array.from({ length: 100 }, () => Array(30).fill('a')),
    }).success,
  ).toBe(false);
});
