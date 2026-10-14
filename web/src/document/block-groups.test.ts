import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { validateDocumentData } from './validation';
import { readBlockLibrary } from './block-library';
import { referencedAssets } from './assets';
import { readBlockLayout } from './block-layout';
import {
  assignBlockRegion,
  duplicateBlockGroup,
  groupDocumentBlocks,
  insertBlockLibraryItem,
  moveBlockGroup,
  registerBlockLibraryItem,
  selectedGroupNodes,
  updateBlockLayouts,
} from './block-groups';
import { resolveSlideDesign } from './slide-design';
import type { DocumentData, FigureNode } from './model';

function sample() {
  const document = parseMarkdown(
    '---\ntype: slide\n---\n# Evidence\n\n![Original](assets/page.png)\n{#fig:original caption="Original figure"}\n\nExplanation [@fig:original]\n\nOther content',
  ).document;
  const figure = document.children[1] as FigureNode;
  figure.attrs.figureEdit = {
    version: 1,
    pdfSource: {
      asset: 'assets/source.pdf',
      fileName: 'source.pdf',
      page: 1,
      pageCount: 2,
      dpi: 144,
    },
  };
  return document;
}
describe('block groups and reusable parts', () => {
  it('duplicates a group with fresh IDs, internal references, captions and region assignments', () => {
    let document = sample();
    const selected = document.children
      .slice(1, 3)
      .map((node) => node.attrs.nodeId);
    document = groupDocumentBlocks(document, 0, selected, 'Evidence group');
    document = assignBlockRegion(document, 0, [selected[0]], 'left');
    const copied = duplicateBlockGroup(document, 0, [selected[0]]);
    expect(copied.children).toHaveLength(document.children.length + 2);
    validateDocumentData(copied);
    const copy = copied.children[3] as FigureNode;
    expect(copy.attrs.caption).toBe('Original figure');
    expect(copy.attrs.label).not.toBe('fig:original');
    expect(copy.attrs.src).toBe('assets/page.png');
    expect(readBlockLayout(copy.attrs.blockLayout).groupId).not.toBe(
      readBlockLayout(document.children[1].attrs.blockLayout).groupId,
    );
    const text = copied.children[4];
    expect(
      text.type === 'paragraph' &&
        text.content?.find((node) => node.type === 'reference'),
    ).toMatchObject({ attrs: { target: copy.attrs.label } });
    expect(
      resolveSlideDesign(copied, 0).composite?.assignments.find(
        (entry) => entry.nodeId === copy.attrs.nodeId,
      )?.region,
    ).toBe('left');
    const restored = parseMarkdown(serializeDocument(copied)).document;
    expect(restored.children[3].attrs.blockLayout).toEqual(
      copy.attrs.blockLayout,
    );
  });
  it('retains library-only images and original PDFs after removing the source blocks and reopening Markdown', () => {
    let document = sample();
    const ids = document.children.slice(1, 3).map((node) => node.attrs.nodeId);
    document = assignBlockRegion(document, 0, ids, 'right-top');
    document = registerBlockLibraryItem(document, 0, ids, 'Reusable evidence');
    document = { ...document, children: [document.children[0]] };
    try {
      validateDocumentData(document);
    } catch (error) {
      throw new Error(JSON.stringify((error as { issues: string[] }).issues));
    }
    const restored = parseMarkdown(serializeDocument(document)).document;
    expect(
      referencedAssets(restored.children, restored.metadata).map(
        (entry) => entry.source,
      ),
    ).toEqual(['assets/page.png', 'assets/source.pdf']);
    const library = readBlockLibrary(restored.metadata);
    const next = insertBlockLibraryItem(restored, 0, library.items[0]);
    validateDocumentData(next);
    expect(next.children).toHaveLength(3);
    expect(
      resolveSlideDesign(next, 0).composite?.assignments.filter(
        (entry) => entry.region === 'right-top',
      ),
    ).toHaveLength(2);
    expect(
      (next.children[1] as FigureNode).attrs.figureEdit?.pdfSource?.asset,
    ).toBe('assets/source.pdf');
  });
  it('keeps copied group members contiguous and assignment ranks bounded after repeated copies', () => {
    let document = sample();
    const selected = document.children
      .slice(1, 3)
      .map((node) => node.attrs.nodeId);
    document = groupDocumentBlocks(document, 0, selected, 'Evidence group');
    document = assignBlockRegion(document, 0, selected, 'left');
    for (let count = 0; count < 15; count++)
      document = duplicateBlockGroup(document, 0, selected);
    validateDocumentData(document);
    const assignments = resolveSlideDesign(document, 0)
      .composite!.assignments.filter((entry) => entry.region === 'left')
      .sort((a, b) => a.order - b.order);
    expect(assignments.map((entry) => entry.order)).toEqual(
      Array.from({ length: 32 }, (_, index) => index),
    );
    for (let index = 0; index < assignments.length; index += 2) {
      const members = assignments
        .slice(index, index + 2)
        .map((entry) =>
          document.children.find((node) => node.attrs.nodeId === entry.nodeId)!,
        );
      expect(members.map((node) => node.type)).toEqual(['figure', 'paragraph']);
      expect(readBlockLayout(members[0].attrs.blockLayout).groupId).toBe(
        readBlockLayout(members[1].attrs.blockLayout).groupId,
      );
    }
  });
  it('protects locked groups from moving or duplicating and permits explicit unlocking', () => {
    let document = sample();
    const id = document.children[1].attrs.nodeId;
    document = groupDocumentBlocks(
      document,
      0,
      document.children.slice(1, 3).map((node) => node.attrs.nodeId),
      'Locked',
    );
    document = updateBlockLayouts(document, 0, [id], { locked: true });
    expect(selectedGroupNodes(document, 0, [id])).toHaveLength(2);
    expect(moveBlockGroup(document, 0, [id], 1)).toBe(document);
    expect(duplicateBlockGroup(document, 0, [id])).toBe(document);
    expect(assignBlockRegion(document, 0, [id], 'bottom')).toBe(document);
    const unlocked = updateBlockLayouts(document, 0, [id], {
      locked: false,
      groupId: undefined,
    });
    expect(selectedGroupNodes(unlocked, 0, [id])).toHaveLength(1);
    const saved = registerBlockLibraryItem(unlocked, 0, [id], 'Unlocked');
    expect(() => validateDocumentData(saved)).not.toThrow();
  });
  it('inserts a registered part into an empty target page before its boundary, preserving notes and other pages', () => {
    const item = { id: 'part', name: 'Part', nodes: [sample().children[1]] };
    const document: DocumentData = {
      schemaVersion: 2,
      type: 'slide',
      metadata: {},
      children: [
        { type: 'slideBreak', attrs: { nodeId: 'divider' } },
        {
          type: 'paragraph',
          attrs: { nodeId: 'second' },
          content: [{ type: 'text', text: 'Second' }],
        },
      ],
    };
    const next = insertBlockLibraryItem(document, 0, item);
    expect(next.children.map((node) => node.type)).toEqual([
      'figure',
      'slideBreak',
      'paragraph',
    ]);
    expect(next.children[2]).toEqual(document.children[1]);
  });
  it('rejects invalid hidden library content when validating a document', () => {
    const document = sample();
    document.metadata.block_library = {
      version: 1,
      items: [
        {
          id: 'bad',
          name: 'Bad',
          nodes: [
            {
              type: 'figure',
              attrs: {
                nodeId: 'bad',
                src: 'javascript:alert(1)',
                alt: '',
                title: null,
                width: 100,
                align: 'center',
              },
            },
          ],
        },
      ],
    };
    expect(() => validateDocumentData(document)).toThrow();
  });
});
