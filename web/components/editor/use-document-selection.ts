'use client';

import { useCallback, useState } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import type { MathSelection } from '@/src/editor/extensions';
import type { DocumentType } from '@/src/document/model';
import { semanticTypes } from '@/src/document/semantics';
import { updateDocumentNode } from '@/src/editor/document-commands';
import {
  WorkspaceStatusError,
  statusMessage,
  describeWorkspaceError,
  type WorkspaceStatus,
} from '@/src/workspace/status';

export interface SelectedNode {
  nodeId?: string;
  position: number;
  type: string;
  attrs: Record<string, unknown>;
}

/** Selection and property drafts are scoped to a stable document node, not a UI position. */
export function useDocumentSelection(
  documentWriteLocked: boolean,
  documentType: DocumentType,
  setStatus: (status: WorkspaceStatus) => void,
) {
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [mathSelection, setMathSelection] = useState<MathSelection | null>(
    null,
  );
  const [mathDraft, setMathDraft] = useState('');
  const handleMathSelect = useCallback((selection: MathSelection) => {
    setMathSelection(selection);
    setMathDraft(selection.latex);
    setSelectedNode({
      type: selection.type,
      nodeId: selection.nodeId,
      position: selection.position,
      attrs: { latex: selection.latex },
    });
  }, []);

  const refreshSelection = useCallback((updatedEditor: Editor) => {
    const updatedSelection = updatedEditor.state.selection;
    if (
      updatedSelection instanceof NodeSelection &&
      (updatedSelection.node.type.name === 'blockMath' ||
        updatedSelection.node.type.name === 'inlineMath')
    ) {
      setMathSelection({
        type: updatedSelection.node.type.name,
        nodeId: updatedSelection.node.attrs.nodeId,
        position: updatedSelection.from,
        latex: String(updatedSelection.node.attrs.latex ?? ''),
      });
      setMathDraft(String(updatedSelection.node.attrs.latex ?? ''));
    }
    setSelectedNode((previous) => {
      if (!previous?.nodeId) return previous;
      let next: SelectedNode | null = null;
      updatedEditor.state.doc.descendants((node, position) => {
        if (node.attrs.nodeId === previous.nodeId)
          next = { ...previous, attrs: node.attrs, position };
      });
      return next;
    });
  }, []);

  const handleSelectionUpdate = useCallback((updatedEditor: Editor) => {
    const { selection } = updatedEditor.state;
    if (selection instanceof NodeSelection) {
      if (
        selection.node.type.name === 'blockMath' ||
        selection.node.type.name === 'inlineMath'
      ) {
        setMathSelection({
          type: selection.node.type.name,
          nodeId: selection.node.attrs.nodeId,
          position: selection.from,
          latex: String(selection.node.attrs.latex ?? ''),
        });
        setMathDraft(String(selection.node.attrs.latex ?? ''));
      } else setMathSelection(null);
      setSelectedNode({
        nodeId:
          typeof selection.node.attrs.nodeId === 'string'
            ? selection.node.attrs.nodeId
            : undefined,
        position: selection.from,
        type: selection.node.type.name,
        attrs: selection.node.attrs as Record<string, unknown>,
      });
      return;
    }

    setMathSelection(null);

    let depth = selection.$from.depth;
    for (let level = depth; level > 0; level--) {
      if (semanticTypes.has(selection.$from.node(level).type.name)) {
        depth = level;
        break;
      }
    }
    if (depth === 0) {
      setSelectedNode(null);
      return;
    }
    const node = selection.$from.node(depth);
    setSelectedNode({
      nodeId:
        typeof node.attrs.nodeId === 'string' ? node.attrs.nodeId : undefined,
      position: selection.$from.before(depth),
      type: node.type.name,
      attrs: node.attrs as Record<string, unknown>,
    });
  }, []);

  const focusNode = useCallback((editor: Editor | null, nodeId: string) => {
    if (!editor) return;
    let found = false;
    editor.state.doc.descendants((node, position) => {
      if (node.attrs.nodeId !== nodeId) return !found;
      found = true;
      setSelectedNode({
        nodeId,
        position,
        type: node.type.name,
        attrs: node.attrs,
      });
      if (node.type.name === 'blockMath' || node.type.name === 'inlineMath') {
        setMathSelection({
          type: node.type.name,
          nodeId,
          position,
          latex: String(node.attrs.latex ?? ''),
        });
        setMathDraft(String(node.attrs.latex ?? ''));
      } else setMathSelection(null);
      if (node.isTextblock) {
        editor
          .chain()
          .focus()
          .setTextSelection(position + 1)
          .run();
      } else {
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.setSelection(NodeSelection.create(tr.doc, position));
            return true;
          })
          .run();
      }
      return false;
    });
  }, []);

  const applyMath = useCallback(
    (editor: Editor | null) => {
      if (!editor || !mathSelection || !mathDraft.trim() || documentWriteLocked)
        return;
      if (mathSelection.type === 'blockMath') {
        if (
          !mathSelection.nodeId ||
          selectedNode?.nodeId !== mathSelection.nodeId ||
          !updateDocumentNode(
            editor,
            mathSelection.nodeId,
            { latex: mathDraft.trim() },
            documentType,
          )
        ) {
          setStatus({ kind: 'error', title: statusMessage('selectMathAgain') });
          return;
        }
        setMathSelection({ ...mathSelection, latex: mathDraft.trim() });
        setStatus({ kind: 'success', title: statusMessage('updatedEquation') });
        return;
      }
      const selectedMath = editor.state.doc.nodeAt(mathSelection.position);
      if (
        selectedNode?.position !== mathSelection.position ||
        selectedMath?.type.name !== 'inlineMath' ||
        selectedMath.attrs.latex !== mathSelection.latex
      ) {
        setStatus({ kind: 'error', title: statusMessage('selectMathAgain') });
        return;
      }
      const chain = editor.chain().focus();
      const updated = chain
        .updateInlineMath({
          pos: mathSelection.position,
          latex: mathDraft.trim(),
        })
        .run();
      if (updated) {
        setMathSelection({ ...mathSelection, latex: mathDraft.trim() });
        setStatus({ kind: 'success', title: statusMessage('updatedEquation') });
      }
    },
    [
      documentType,
      documentWriteLocked,
      mathDraft,
      mathSelection,
      selectedNode,
      setStatus,
    ],
  );

  const applyAttributes = (
    editor: Editor | null,
    nodeId: string,
    attrs: Record<string, unknown>,
  ) => {
    if (!editor || documentWriteLocked) return;
    try {
      if (!updateDocumentNode(editor, nodeId, attrs, documentType))
        throw new WorkspaceStatusError(statusMessage('selectedElementRemoved'));
      setStatus({ kind: 'success', title: statusMessage('updatedAttributes') });
    } catch (error) {
      setStatus({
        kind: 'error',
        title: statusMessage('unableToUpdateAttributes'),
        description: describeWorkspaceError(error, 'checkAttributes'),
      });
    }
  };

  const clearSelection = useCallback(() => {
    setSelectedNode(null);
    setMathSelection(null);
    setMathDraft('');
  }, []);

  return {
    selectedNode,
    mathDraft,
    setMathDraft,
    handleMathSelect,
    handleSelectionUpdate,
    refreshSelection,
    focusNode,
    applyMath,
    applyAttributes,
    clearSelection,
  };
}
