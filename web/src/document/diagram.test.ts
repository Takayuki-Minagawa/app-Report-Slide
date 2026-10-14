import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorExtensions } from '@/src/editor/extensions';
import { updateDocumentNode } from '@/src/editor/document-commands';
import { serializeDocument } from '@/src/markdown/serializer';
import { parseMarkdown } from '@/src/markdown/parser';
import { sanitizeSvgSource } from '@/src/security/svg-source';
import {
  createStructuredDiagram,
  createStructuredDiagramFigure,
  diagramSchema,
} from './diagram';
import {
  diagramConnectionPoints,
  diagramSelectionBounds,
  duplicateDiagramSelection,
  expandedDiagramSelection,
  moveDiagramSelection,
  removeDiagramSelection,
  resizeDiagramSelection,
} from './diagram-geometry';
import { diagramSvg } from './diagram-svg';
import type { DocumentData, FigureNode } from './model';

describe('structured diagrams', () => {
  it('keeps selection dimensions stable at decimal positions after restoring a resize', () => {
    const diagram = createStructuredDiagram();
    const shape = diagram.shapes[0];
    shape.x = 10.1234;
    shape.y = 30.1234;
    const selected = [shape.id];
    const resized = resizeDiagramSelection(diagram, selected, 25, 32);
    expect(diagramSelectionBounds(resized, selected)).toEqual({
      x: 10.1234,
      y: 30.1234,
      width: 25,
      height: 32,
    });
    // Undo restores this snapshot; computing its selection must preserve exact input values.
    expect(diagramSelectionBounds(diagram, selected)).toEqual({
      x: 10.1234,
      y: 30.1234,
      width: 22,
      height: 28,
    });
  });
  it('keeps connections attached to the shape boundary when their shape is moved or resized', () => {
    const diagram = createStructuredDiagram();
    const id = diagram.shapes[0].id;
    expect(
      diagramConnectionPoints(diagram, diagram.connections[0]).start,
    ).toEqual({ x: 27, y: 44 });
    const moved = moveDiagramSelection(diagram, [id], 10, 20);
    const points = diagramConnectionPoints(moved, moved.connections[0]);
    expect(points.start.x).toBe(37);
    expect(points.start.y).toBeGreaterThan(50);
    expect(moved.connections[0].start).toEqual(diagram.connections[0].start);
    const resized = resizeDiagramSelection(diagram, [id], 30, 20);
    expect(
      diagramConnectionPoints(resized, resized.connections[0]).start.x,
    ).toBe(35);
    expect(diagram.shapes[0].x).toBe(5);
  });
  it('moves a group together, clamps it to the canvas, and respects any locked member', () => {
    const diagram = createStructuredDiagram();
    diagram.shapes[0].groupId = 'group';
    diagram.shapes[1].groupId = 'group';
    const first = diagram.shapes[0].id;
    expect(expandedDiagramSelection(diagram, [first])).toEqual([
      first,
      diagram.shapes[1].id,
    ]);
    const moved = moveDiagramSelection(diagram, [first], -100, 100);
    expect(moved.shapes[0]).toMatchObject({ x: 0, y: 72 });
    expect(moved.shapes[1]).toMatchObject({ x: 34, y: 72 });
    expect(diagramSchema.safeParse(moved).success).toBe(true);
    diagram.shapes[1].locked = true;
    expect(moveDiagramSelection(diagram, [first], 3, 3)).toBe(diagram);
  });
  it('duplicates group members and reconnects their internal edges to new stable IDs', () => {
    const diagram = createStructuredDiagram();
    diagram.shapes[0].groupId = 'group';
    diagram.shapes[1].groupId = 'group';
    const result = duplicateDiagramSelection(diagram, [diagram.shapes[0].id]);
    expect(result.diagram.shapes).toHaveLength(5);
    expect(result.diagram.connections).toHaveLength(3);
    const duplicatedEdge = result.diagram.connections[2];
    expect(duplicatedEdge.start).toMatchObject({
      shapeId: result.diagram.shapes[3].id,
    });
    expect(duplicatedEdge.end).toMatchObject({
      shapeId: result.diagram.shapes[4].id,
    });
    expect(result.diagram.shapes[3].groupId).not.toBe('group');
    expect(diagramSchema.safeParse(result.diagram).success).toBe(true);
    const removed = removeDiagramSelection(result.diagram, [
      result.diagram.shapes[3].id,
    ]);
    expect(removed.shapes).toHaveLength(3);
    expect(removed.connections).toHaveLength(2);
  });
  it('validates IDs and connected endpoints while rendering labels as text', () => {
    const diagram = createStructuredDiagram();
    diagram.shapes[0].text = '<script>alert("x")</script>';
    const svg = diagramSvg(diagram);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(sanitizeSvgSource(svg).source).toContain('&lt;script&gt;');
    const invalid = structuredClone(diagram);
    invalid.connections[0].end = {
      type: 'shape',
      shapeId: 'missing',
      side: 'auto',
    };
    expect(diagramSchema.safeParse(invalid).success).toBe(false);
    invalid.connections[0].end = diagram.connections[0].end;
    invalid.shapes[1].id = invalid.shapes[0].id;
    expect(diagramSchema.safeParse(invalid).success).toBe(false);
  });
  it('moves a free line rigidly at the canvas boundary', () => {
    const diagram = createStructuredDiagram();
    diagram.connections[0].start = { type: 'point', x: 20, y: 40 };
    diagram.connections[0].end = { type: 'point', x: 80, y: 50 };
    const moved = moveDiagramSelection(
      diagram,
      [diagram.connections[0].id],
      50,
      -100,
    );
    expect(moved.connections[0].start).toEqual({ type: 'point', x: 40, y: 0 });
    expect(moved.connections[0].end).toEqual({ type: 'point', x: 100, y: 10 });
  });
  it('round-trips independent parts in Markdown/Tiptap and restores them through document Undo', () => {
    const figure = createStructuredDiagramFigure();
    const document: DocumentData = {
      schemaVersion: 2,
      type: 'slide',
      metadata: {},
      children: [figure],
    };
    const restored = parseMarkdown(serializeDocument(document)).document;
    const saved = restored.children[0] as FigureNode;
    expect(saved.attrs.figureEdit?.diagram).toEqual(
      figure.attrs.figureEdit?.diagram,
    );
    const editor = new Editor({
      extensions: createEditorExtensions({ onMathSelect: () => undefined }),
      content: { type: 'doc', content: restored.children },
    });
    try {
      const original = saved.attrs.figureEdit!.diagram!;
      const moved = moveDiagramSelection(
        original,
        [original.shapes[0].id],
        3,
        3,
      );
      expect(
        updateDocumentNode(editor, saved.attrs.nodeId, {
          figureEdit: { ...saved.attrs.figureEdit, diagram: moved },
        }),
      ).toBe(true);
      expect(editor.getJSON().content?.[0].attrs?.figureEdit.diagram).toEqual(
        moved,
      );
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON().content?.[0].attrs?.figureEdit.diagram).toEqual(
        original,
      );
      const html = editor.getHTML();
      editor.commands.setContent(html);
      expect(editor.getJSON().content?.[0].attrs?.figureEdit.diagram).toEqual(
        original,
      );
    } finally {
      editor.destroy();
    }
  });
});
