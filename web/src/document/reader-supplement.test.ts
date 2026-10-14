import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import { ReaderDetails } from '@/src/export/reader-content';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { validateDocumentData, migrateDocumentData } from './validation';
import {
  readerSupplementForPage,
  setReaderSupplement,
  syncReaderSupplementPositions,
  unassignedReaderSupplements,
  reattachReaderSupplement,
} from './reader-supplement';
describe('reader supplements', () => {
  it('updates once and preserves supplements on their pages through Markdown', () => {
    const doc = parseMarkdown(
      '---\ntype: slide\n---\n\n# One\n\n::: slidebreak\n:::\n\n# Two',
    ).document;
    doc.metadata = setReaderSupplement(doc, 1, {
      title: 'Conditions',
      text: 'Frequency 2 Hz',
      link: 'https://example.com/paper.pdf',
    });
    doc.metadata = setReaderSupplement(doc, 1, {
      title: 'Revised',
      text: 'Frequency 3 Hz',
      link: 'https://example.com/paper.pdf',
    });
    const parsed = parseMarkdown(serializeDocument(doc));
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    );
    expect(readerSupplementForPage(parsed.document, 0)).toBeUndefined();
    expect(readerSupplementForPage(parsed.document, 1)).toMatchObject({
      title: 'Revised',
      text: 'Frequency 3 Hz',
    });
  });
  it('keeps page anchors after reordering and can add another supplement', () => {
    const doc = parseMarkdown(
      '---\ntype: slide\n---\n\n# One\n\n::: slidebreak\n:::\n\n# Two',
    ).document;
    doc.metadata = setReaderSupplement(doc, 0, {
      title: 'One details',
      text: 'first',
      link: '',
    });
    doc.children = [doc.children[2], doc.children[1], doc.children[0]];
    doc.metadata = setReaderSupplement(doc, 0, {
      title: 'Two details',
      text: 'second',
      link: '',
    });
    expect(() => validateDocumentData(doc)).not.toThrow();
    const parsed = parseMarkdown(serializeDocument(doc)).document;
    expect(readerSupplementForPage(parsed, 0)?.title).toBe('Two details');
    expect(readerSupplementForPage(parsed, 1)?.title).toBe('One details');
  });
  it('preserves additional chapter sections when editing or clearing the first supplement', () => {
    const doc = parseMarkdown('# Combined report').document;
    const sections = [
      {
        title: 'Second chapter',
        text: 'Further conditions',
        link: 'https://example.com/chapter-2.pdf',
      },
    ];
    doc.metadata.reader_supplements = {
      version: 1,
      pages: [
        {
          pageId: doc.children[0].attrs.nodeId,
          pageIndex: 0,
          title: 'First chapter',
          text: 'Initial conditions',
          link: '',
          sections,
        },
      ],
    };
    doc.metadata = setReaderSupplement(doc, 0, {
      title: 'Revised first',
      text: 'Updated',
      link: '',
    });
    expect(readerSupplementForPage(doc, 0)?.sections).toEqual(sections);
    const html = renderToStaticMarkup(
      createElement(ReaderDetails, { document: doc, index: 0, locale: 'en' }),
    );
    expect(html).toContain('Revised first');
    expect(html).toContain('Second chapter');
    expect(html).toContain('https://example.com/chapter-2.pdf');
    doc.metadata = setReaderSupplement(doc, 0, {
      title: '',
      text: '',
      link: '',
    });
    expect(readerSupplementForPage(doc, 0)?.sections).toEqual(sections);
    const read = parseMarkdown(serializeDocument(doc));
    expect(read.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(readerSupplementForPage(read.document, 0)?.sections).toEqual(
      sections,
    );
    const retained = renderToStaticMarkup(
      createElement(ReaderDetails, {
        document: read.document,
        index: 0,
        locale: 'en',
      }),
    );
    expect(retained).toContain('Further conditions');
    const unsafe = structuredClone(doc);
    (
      unsafe.metadata.reader_supplements as {
        pages: { sections: { link: string }[] }[];
      }
    ).pages[0].sections[0].link = 'javascript:alert(1)';
    expect(() => validateDocumentData(unsafe)).toThrow();
  });
  it('keeps the supplement attached when only the first heading is deleted', () => {
    const doc = parseMarkdown(
      '---\ntype: slide\n---\n\n# Heading\n\nKeep this body.',
    ).document;
    doc.metadata = setReaderSupplement(doc, 0, {
      title: 'Conditions',
      text: 'Important original',
      link: '',
    });
    doc.children.shift();
    expect(readerSupplementForPage(doc, 0)?.text).toBe('Important original');
    const saved = parseMarkdown(serializeDocument(doc)).document;
    expect(readerSupplementForPage(saved, 0)?.text).toBe('Important original');
    expect(readerSupplementForPage(saved, 0)?.pageId).toBe(
      saved.children[0].attrs.nodeId,
    );
  });
  it('retains a deleted whole page as unassigned across save and requires explicit reassignment', () => {
    const doc = parseMarkdown(
      '---\ntype: slide\n---\n\n# Removed\n\nOld page body.\n\n::: slidebreak\n:::\n\n# Keep\n\nNew page body.',
    ).document;
    doc.metadata = setReaderSupplement(doc, 0, {
      title: 'Removed conditions',
      text: 'Must remain saved',
      link: 'https://example.com/original',
    });
    doc.children = doc.children.slice(3);
    expect(readerSupplementForPage(doc, 0)).toBeUndefined();
    expect(unassignedReaderSupplements(doc)).toMatchObject([
      { text: 'Must remain saved', orphaned: true },
    ]);
    const json = migrateDocumentData(doc);
    expect(unassignedReaderSupplements(json)).toHaveLength(1);
    const saved = parseMarkdown(serializeDocument(json)).document;
    expect(readerSupplementForPage(saved, 0)).toBeUndefined();
    expect(unassignedReaderSupplements(saved)[0].text).toBe(
      'Must remain saved',
    );
    saved.metadata = reattachReaderSupplement(
      saved,
      unassignedReaderSupplements(saved)[0].pageId,
      0,
    );
    expect(unassignedReaderSupplements(saved)).toHaveLength(0);
    expect(readerSupplementForPage(saved, 0)?.text).toBe('Must remain saved');
  });
  it('seeds surviving block anchors for legacy saved supplements', () => {
    const doc = parseMarkdown('# Heading\n\nBody remains.').document;
    doc.metadata.reader_supplements = {
      version: 1,
      pages: [
        {
          pageId: doc.children[0].attrs.nodeId,
          pageIndex: 0,
          title: 'Legacy',
          text: 'old supplement',
          link: '',
        },
      ],
    };
    const loaded = migrateDocumentData(doc);
    loaded.children.shift();
    expect(readerSupplementForPage(loaded, 0)?.title).toBe('Legacy');
  });
  it('keeps both supplements if deleting a break merges their pages', () => {
    const doc = parseMarkdown(
      '---\ntype: slide\n---\n\n# One\n\n::: slidebreak\n:::\n\n# Two',
    ).document;
    doc.metadata = setReaderSupplement(doc, 0, {
      title: 'First',
      text: 'one',
      link: '',
    });
    doc.metadata = setReaderSupplement(doc, 1, {
      title: 'Second',
      text: 'two',
      link: '',
    });
    doc.children.splice(1, 1);
    doc.metadata = syncReaderSupplementPositions(doc);
    expect(() => validateDocumentData(doc)).not.toThrow();
    const saved = parseMarkdown(serializeDocument(doc)).document;
    expect(readerSupplementForPage(saved, 0)).toMatchObject({
      title: 'First',
      sections: [{ title: 'Second', text: 'two' }],
    });
  });
  it('rejects duplicate pages and executable links', () => {
    const doc = parseMarkdown('# One').document;
    const entry = {
      pageId: doc.children[0].attrs.nodeId,
      pageIndex: 0,
      title: 'Details',
      text: '',
      link: '',
    };
    for (const pages of [
      [entry, entry],
      [{ ...entry, link: 'javascript:alert(1)' }],
    ])
      expect(() =>
        validateDocumentData({
          ...doc,
          metadata: { reader_supplements: { version: 1, pages } },
        }),
      ).toThrow();
  });
});
