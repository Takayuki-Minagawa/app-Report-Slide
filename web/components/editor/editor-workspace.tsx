'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import {
  Bold,
  Braces,
  Code2,
  FileJson,
  FilePlus2,
  FileText,
  FolderOpen,
  FunctionSquare,
  Heading1,
  Heading2,
  ImageIcon,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Save,
  Sigma,
  Table2,
  Undo2,
} from 'lucide-react';

import { PreviewSurface } from '@/components/preview/preview-surface';
import { SemanticProperties } from './semantic-properties';
import { Input } from '@/components/ui/input';
import {
  analyzeDocument,
  labelPattern,
  semanticTypes,
} from '@/src/document/semantics';
import {
  insertDocumentBreak,
  updateDocumentNode,
} from '@/src/editor/document-commands';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  createDefaultDocument,
  documentTitle,
  inlineText,
  toEditorDocument,
  type DocumentData,
  type DocumentNode,
  type DocumentType,
} from '@/src/document/model';
import {
  migrateDocumentData,
  validateDocumentData,
} from '@/src/document/validation';
import {
  createEditorExtensions,
  type MathSelection,
} from '@/src/editor/extensions';
import { MarkdownImportError } from '@/src/markdown/diagnostics';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';

type WorkspaceView = 'visual' | 'markdown' | 'preview';

interface WorkspaceStatus {
  kind: 'idle' | 'success' | 'error';
  title: string;
  description?: string;
}

interface LoadDocumentOptions {
  assetUrls?: Record<string, string>;
  description?: string;
}

interface SelectedNode {
  nodeId?: string;
  position: number;
  type: string;
  attrs: Record<string, unknown>;
}

const initialMarkdown = `---
type: report
title: 2層鉄骨造 時刻歴応答解析
subtitle: 応答解析報告書
author: TMD
date: 2026-09-02
paper: A4
orientation: portrait
theme: calculation
---

# 解析概要

本解析では、2層鉄骨造モデルを対象として時刻歴応答解析を実施し、各層の最大応答値と変形性能を確認する。

## 基本式

運動方程式は $x = y + 1$ と、次の行列式で表す。

$$
M\\ddot{x}+C\\dot{x}+Kx=F(t)
$$

## 最大応答値

| 階 | 最大変位 | 層間変形角 |
|:---|---:|:---:|
| 2F | 24.5 mm | 1/135 |
| 1F | 18.2 mm | 1/162 |
`;

function deterministicIds(): () => string {
  let id = 0;
  return () => `sample-${++id}`;
}

const initialDocument = parseMarkdown(initialMarkdown, {
  idFactory: deterministicIds(),
}).document;

function cloneDocument(document: DocumentData): DocumentData {
  return JSON.parse(JSON.stringify(document)) as DocumentData;
}

function serializationFailureDescription(
  error: unknown,
  snapshot: DocumentData,
): string {
  const message =
    error instanceof Error ? error.message : '文書を変換できません';
  try {
    validateDocumentData(snapshot);
    return `${message}。Document JSONなら保存できます。`;
  } catch {
    return `${message}。文書構造を確認してください。`;
  }
}

function currentDocument(
  editor: Editor | null,
  document: DocumentData,
): DocumentData {
  const content = editor?.getJSON().content;
  return {
    ...document,
    children: Array.isArray(content)
      ? (content as DocumentNode[])
      : document.children,
  };
}

function formatName(node: DocumentNode): string {
  switch (node.type) {
    case 'heading':
      return inlineText(node.content) || '無題の見出し';
    case 'figure':
      return node.attrs.alt || '画像';
    case 'blockMath':
      return 'ブロック数式';
    case 'table':
      return '表';
    case 'codeBlock':
      return 'コード';
    default:
      return node.type;
  }
}

function navigatorNodes(nodes: DocumentNode[]): DocumentNode[] {
  const result: DocumentNode[] = [];
  const visit = (node: DocumentNode) => {
    if (
      node.type === 'heading' ||
      node.type === 'figure' ||
      node.type === 'blockMath' ||
      node.type === 'table' ||
      node.type === 'codeBlock'
    ) {
      result.push(node);
    }
    if ('content' in node && Array.isArray(node.content)) {
      for (const child of node.content) {
        if (typeof child === 'object' && child && 'attrs' in child) {
          visit(child as DocumentNode);
        }
      }
    }
  };
  nodes.forEach(visit);
  return result;
}

function nodeIcon(type: string) {
  switch (type) {
    case 'heading':
      return Heading1;
    case 'figure':
      return ImageIcon;
    case 'blockMath':
      return FunctionSquare;
    case 'table':
      return Table2;
    case 'codeBlock':
      return Code2;
    default:
      return FileText;
  }
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function filenameFor(document: DocumentData, extension: string): string {
  const base = documentTitle(document)
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${base || 'document'}.${extension}`;
}

const maximumAssetBytes = 20 * 1024 * 1024;
const maximumTotalAssetBytes = 50 * 1024 * 1024;

function isMarkdownFile(file: File): boolean {
  return (
    file.type === 'text/markdown' || /\.(?:md|markdown|json)$/i.test(file.name)
  );
}

function isImageAsset(file: File): boolean {
  return (
    /^image\/(?:png|jpe?g|webp|gif|svg\+xml)$/i.test(file.type) ||
    /\.(?:png|jpe?g|webp|gif|svg)$/i.test(file.name)
  );
}

function normalizedAssetPath(value: string): string {
  const path = value.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Invalid percent escapes are kept verbatim for a deterministic mismatch.
  }
  return decoded.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
}

function localImageSources(document: DocumentData): string[] {
  const sources = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (record.type === 'figure' || record.type === 'inlineImage') {
      const attrs = record.attrs;
      if (typeof attrs === 'object' && attrs !== null) {
        const source = (attrs as Record<string, unknown>).src;
        if (
          typeof source === 'string' &&
          !/^[a-z][a-z\d+.-]*:/i.test(source) &&
          !source.startsWith('/') &&
          !source.startsWith('//')
        ) {
          sources.add(source);
        }
      }
    }
    visit(record.content);
  };
  visit(document.children);
  return [...sources];
}

function createLocalAssetUrls(
  document: DocumentData,
  files: File[],
): { urls: Record<string, string>; unresolved: string[] } {
  const urls: Record<string, string> = {};
  const unresolved: string[] = [];
  const urlByFile = new Map<File, string>();

  for (const source of localImageSources(document)) {
    const normalizedSource = normalizedAssetPath(source);
    const exactMatches = files.filter((file) => {
      const candidate = normalizedAssetPath(
        file.webkitRelativePath || file.name,
      );
      return (
        candidate === normalizedSource ||
        candidate.endsWith(`/${normalizedSource}`)
      );
    });
    const basename = normalizedSource.split('/').at(-1);
    const matches =
      exactMatches.length > 0
        ? exactMatches
        : files.filter(
            (file) =>
              normalizedAssetPath(file.name).split('/').at(-1) === basename,
          );

    if (matches.length !== 1) {
      unresolved.push(source);
      continue;
    }
    const file = matches[0];
    const url = urlByFile.get(file) ?? URL.createObjectURL(file);
    urlByFile.set(file, url);
    urls[source] = url;
  }

  return { urls, unresolved };
}

function revokeAssetUrls(urls: Record<string, string>): void {
  for (const url of new Set(Object.values(urls))) URL.revokeObjectURL(url);
}

export function EditorWorkspace() {
  const [document, setDocument] = useState<DocumentData>(() =>
    cloneDocument(initialDocument),
  );
  const [view, setView] = useState<WorkspaceView>('visual');
  const [markdownDraft, setMarkdownDraft] = useState(initialMarkdown);
  const [editorSource, setEditorSource] = useState(() => ({
    revision: 0,
    document: cloneDocument(initialDocument),
  }));
  const [status, setStatus] = useState<WorkspaceStatus>({
    kind: 'idle',
    title: '準備完了',
    description: 'Document ModelとEditorを同期しています',
  });
  const [documentDirty, setDocumentDirty] = useState(false);
  const [markdownDirty, setMarkdownDirty] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [mathSelection, setMathSelection] = useState<MathSelection | null>(
    null,
  );
  const [mathDraft, setMathDraft] = useState('');
  const markdownInput = useRef<HTMLInputElement>(null);
  const dirty = documentDirty || markdownDirty;
  const documentWriteLocked = view === 'markdown' || markdownDirty;

  const replaceAssetUrls = useCallback((next: Record<string, string>) => {
    setAssetUrls(next);
  }, []);

  const resolveImageUrl = useCallback(
    (source: string) => assetUrls[source] ?? source,
    [assetUrls],
  );

  useEffect(() => () => revokeAssetUrls(assetUrls), [assetUrls]);

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

  const extensions = useMemo(
    () =>
      createEditorExtensions({
        onMathSelect: handleMathSelect,
        resolveImageUrl,
      }),
    [handleMathSelect, resolveImageUrl],
  );

  const editor = useEditor(
    {
      extensions,
      content: toEditorDocument(editorSource.document),
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: 'kumi-editor-content',
          'aria-label': '文書本文',
        },
      },
      onUpdate: ({ editor: updatedEditor }) => {
        const content = updatedEditor.getJSON().content;
        if (!Array.isArray(content)) return;
        setDocument((current) => ({
          ...current,
          children: content as DocumentNode[],
        }));
        setDocumentDirty(true);
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
        setStatus({
          kind: 'idle',
          title: '編集中',
          description: '変更はブラウザ内に保持されています',
        });
      },
      onSelectionUpdate: ({ editor: updatedEditor }) => {
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
            typeof node.attrs.nodeId === 'string'
              ? node.attrs.nodeId
              : undefined,
          position: selection.$from.before(depth),
          type: node.type.name,
          attrs: node.attrs as Record<string, unknown>,
        });
      },
    },
    [editorSource.revision, extensions],
  );

  const outline = useMemo(
    () => navigatorNodes(document.children),
    [document.children],
  );
  const analysis = useMemo(() => analyzeDocument(document), [document]);
  const selectedSemantic = outline.find(
    (node) =>
      node.attrs.nodeId === selectedNode?.nodeId &&
      semanticTypes.has(node.type),
  );
  const [referenceTarget, setReferenceTarget] = useState('');

  const loadDocument = useCallback(
    (
      nextDocument: DocumentData,
      message: string,
      options: LoadDocumentOptions = {},
    ) => {
      nextDocument = migrateDocumentData(nextDocument);
      editor?.schema.nodeFromJSON(toEditorDocument(nextDocument));
      let serialized = '';
      let markdownWarning: string | undefined;
      try {
        serialized = serializeDocument(nextDocument);
      } catch {
        markdownWarning =
          'この文書はDocument JSONで保存してください。Markdownでは表現できない構造を保持しています。';
      }
      if (options.assetUrls !== undefined) {
        replaceAssetUrls(options.assetUrls);
      }
      setDocument(nextDocument);
      setEditorSource((current) => ({
        revision: current.revision + 1,
        document: nextDocument,
      }));
      setMarkdownDraft(serialized);
      setMarkdownDirty(false);
      setSelectedNode(null);
      setMathSelection(null);
      setDocumentDirty(false);
      setStatus({
        kind: 'success',
        title: message,
        description:
          [options.description, markdownWarning].filter(Boolean).join(' / ') ||
          undefined,
      });
    },
    [editor, replaceAssetUrls],
  );

  const importMarkdown = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (files.length === 0) return;

      let pendingAssetUrls: Record<string, string> | undefined;
      try {
        const markdownFiles = files.filter(isMarkdownFile);
        if (markdownFiles.length !== 1) {
          throw new Error(
            'MarkdownまたはDocument JSONを1つだけ選択してください',
          );
        }
        const file = markdownFiles[0];
        const imageFiles = files.filter(
          (candidate) => candidate !== file && isImageAsset(candidate),
        );
        const unsupported = files.filter(
          (candidate) => candidate !== file && !isImageAsset(candidate),
        );
        if (unsupported.length > 0) {
          throw new Error(
            `画像以外の添付ファイルは読み込めません: ${unsupported
              .map((candidate) => candidate.name)
              .join(', ')}`,
          );
        }
        if (file.size > 5 * 1024 * 1024) {
          throw new Error('Markdownファイルは5MB以下にしてください');
        }
        if (imageFiles.some((asset) => asset.size > maximumAssetBytes)) {
          throw new Error('画像ファイルは1件20MB以下にしてください');
        }
        if (
          imageFiles.reduce((total, asset) => total + asset.size, 0) >
          maximumTotalAssetBytes
        ) {
          throw new Error('画像ファイルの合計は50MB以下にしてください');
        }
        const source = await file.text();
        const result = /\.json$/i.test(file.name)
          ? {
              document: migrateDocumentData(JSON.parse(source)),
              diagnostics: [],
            }
          : parseMarkdown(source);
        const localAssets = createLocalAssetUrls(result.document, imageFiles);
        pendingAssetUrls = localAssets.urls;
        const descriptions = [
          ...result.diagnostics.map((item) => item.message),
          ...(localAssets.unresolved.length > 0
            ? [
                `ローカル画像を解決できません: ${localAssets.unresolved.join(
                  ', ',
                )}（Markdownと画像を同時に選択してください）`,
              ]
            : []),
        ];
        const hasWarnings = descriptions.length > 0;
        loadDocument(
          result.document,
          hasWarnings
            ? `${file.name}を警告付きで読み込みました`
            : `${file.name}を読み込みました`,
          {
            assetUrls: localAssets.urls,
            description:
              descriptions.length > 0 ? descriptions.join(' / ') : undefined,
          },
        );
        pendingAssetUrls = undefined;
      } catch (error) {
        if (pendingAssetUrls) revokeAssetUrls(pendingAssetUrls);
        const description =
          error instanceof MarkdownImportError
            ? error.diagnostics.map((item) => item.message).join(' / ')
            : error instanceof Error
              ? error.message
              : 'ファイルを読み込めませんでした';
        setStatus({
          kind: 'error',
          title: 'Markdownを読み込めませんでした',
          description,
        });
      }
    },
    [loadDocument],
  );

  const applyMarkdown = useCallback(() => {
    try {
      const result = parseMarkdown(markdownDraft, {
        fallbackType: document.type,
      });
      loadDocument(result.document, 'Markdownの変更を適用しました', {
        description:
          result.diagnostics.length > 0
            ? result.diagnostics.map((item) => item.message).join(' / ')
            : undefined,
      });
      setView('visual');
    } catch (error) {
      setStatus({
        kind: 'error',
        title: 'Markdownを適用できませんでした',
        description:
          error instanceof MarkdownImportError
            ? error.diagnostics.map((item) => item.message).join(' / ')
            : error instanceof Error
              ? error.message
              : 'Markdownを解析できませんでした',
      });
    }
  }, [document.type, loadDocument, markdownDraft]);

  const createDocument = useCallback(
    (type: DocumentType) => {
      loadDocument(
        createDefaultDocument(type),
        `新しい${type}文書を作成しました`,
        { assetUrls: {} },
      );
      setView('visual');
    },
    [loadDocument],
  );

  const changeView = useCallback(
    (nextView: WorkspaceView) => {
      if (nextView === 'visual' && markdownDirty) {
        setStatus({
          kind: 'error',
          title: 'Markdownの変更を先に処理してください',
          description:
            'ビジュアル編集へ戻る前に、Markdownの変更を適用または破棄してください',
        });
        return;
      }
      if (nextView === 'markdown' && !markdownDirty) {
        const snapshot = currentDocument(editor, document);
        try {
          setMarkdownDraft(serializeDocument(snapshot));
        } catch (error) {
          setStatus({
            kind: 'error',
            title: 'Markdown表示を更新できませんでした',
            description: serializationFailureDescription(error, snapshot),
          });
          return;
        }
      }
      setView(nextView);
    },
    [document, editor, markdownDirty],
  );

  const discardMarkdown = useCallback(() => {
    const snapshot = currentDocument(editor, document);
    try {
      setMarkdownDraft(serializeDocument(snapshot));
      setMarkdownDirty(false);
      setView('visual');
      setStatus({ kind: 'idle', title: 'Markdownの変更を破棄しました' });
    } catch (error) {
      setStatus({
        kind: 'error',
        title: 'Markdownの変更を破棄できませんでした',
        description: serializationFailureDescription(error, snapshot),
      });
    }
  }, [document, editor]);

  const focusNode = useCallback(
    (nodeId: string) => {
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
    },
    [editor],
  );

  const documentForSave = useCallback(() => {
    if (markdownDirty) {
      return parseMarkdown(markdownDraft, {
        fallbackType: document.type,
      });
    }
    return {
      document: currentDocument(editor, document),
      diagnostics: [],
    };
  }, [document, editor, markdownDirty, markdownDraft]);

  const saveMarkdown = useCallback(() => {
    try {
      const result = documentForSave();
      const snapshot = result.document;
      const serialized = serializeDocument(snapshot);
      download(
        filenameFor(snapshot, 'md'),
        serialized,
        'text/markdown;charset=utf-8',
      );
      if (markdownDirty) {
        loadDocument(snapshot, 'Markdownを適用して保存しました', {
          description:
            result.diagnostics.length > 0
              ? result.diagnostics.map((item) => item.message).join(' / ')
              : undefined,
        });
      } else {
        setDocumentDirty(false);
        setStatus({ kind: 'success', title: 'Markdownを保存しました' });
      }
    } catch (error) {
      const snapshot = currentDocument(editor, document);
      setStatus({
        kind: 'error',
        title: 'Markdownを保存できませんでした',
        description: serializationFailureDescription(error, snapshot),
      });
    }
  }, [document, documentForSave, editor, loadDocument, markdownDirty]);

  const saveJson = useCallback(() => {
    try {
      const result = documentForSave();
      const snapshot = migrateDocumentData(result.document);
      download(
        filenameFor(snapshot, 'json'),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        'application/json;charset=utf-8',
      );
      if (markdownDirty) {
        loadDocument(
          snapshot,
          'Markdownを適用してDocument JSONを保存しました',
          {
            description:
              result.diagnostics.length > 0
                ? result.diagnostics.map((item) => item.message).join(' / ')
                : undefined,
          },
        );
      } else {
        setDocumentDirty(false);
        setStatus({ kind: 'success', title: 'Document JSONを保存しました' });
      }
    } catch (error) {
      setStatus({
        kind: 'error',
        title: 'Document JSONを保存できませんでした',
        description:
          error instanceof Error ? error.message : '文書データを検証できません',
      });
    }
  }, [documentForSave, loadDocument, markdownDirty]);

  const updateTheme = useCallback((theme: string) => {
    setDocument((current) => ({
      ...current,
      metadata: { ...current.metadata, theme },
    }));
    setDocumentDirty(true);
  }, []);

  const applyMath = useCallback(() => {
    if (!editor || !mathSelection || !mathDraft.trim() || documentWriteLocked)
      return;
    if (mathSelection.type === 'blockMath') {
      if (
        !mathSelection.nodeId ||
        selectedNode?.nodeId !== mathSelection.nodeId ||
        !updateDocumentNode(editor, mathSelection.nodeId, {
          latex: mathDraft.trim(),
        })
      ) {
        setStatus({ kind: 'error', title: '数式を選択し直してください' });
        return;
      }
      setMathSelection({ ...mathSelection, latex: mathDraft.trim() });
      setStatus({ kind: 'success', title: '数式を更新しました' });
      return;
    }
    const selectedMath = editor.state.doc.nodeAt(mathSelection.position);
    if (
      selectedNode?.position !== mathSelection.position ||
      selectedMath?.type.name !== 'inlineMath' ||
      selectedMath.attrs.latex !== mathSelection.latex
    ) {
      setStatus({ kind: 'error', title: '数式を選択し直してください' });
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
      setStatus({ kind: 'success', title: '数式を更新しました' });
    }
  }, [documentWriteLocked, editor, mathDraft, mathSelection, selectedNode]);

  const applyAttributes = (nodeId: string, attrs: Record<string, unknown>) => {
    if (!editor || documentWriteLocked) return;
    try {
      if (!updateDocumentNode(editor, nodeId, attrs))
        throw new Error('対象の要素は削除されています。選択し直してください');
      setStatus({ kind: 'success', title: '属性を更新しました' });
    } catch (error) {
      setStatus({
        kind: 'error',
        title: '属性を更新できませんでした',
        description:
          error instanceof Error ? error.message : '属性を確認してください',
      });
    }
  };

  const updateDocumentFlag = (key: string, checked: boolean) => {
    if (documentWriteLocked) return;
    setDocument((current) => ({
      ...current,
      metadata: { ...current.metadata, [key]: checked },
    }));
    setDocumentDirty(true);
  };

  const themeOptions =
    document.type === 'report'
      ? [
          ['latex', 'LaTeX'],
          ['calculation', 'Calculation'],
        ]
      : [
          ['beamer-simple', 'Beamer Simple'],
          ['technical', 'Technical'],
        ];

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background">
      <input
        ref={markdownInput}
        className="sr-only"
        type="file"
        accept=".md,.markdown,.json,application/json,text/markdown,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
        multiple
        disabled={documentWriteLocked}
        onChange={importMarkdown}
        aria-label="Markdownファイル"
      />

      <header className="workspace-header">
        <div className="flex min-w-56 items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-md bg-[#0b2742] text-xs font-black text-white">
            K
          </div>
          <div className="leading-none">
            <p className="text-sm font-bold tracking-[0.12em] text-[#0b2742]">
              KUMI
            </p>
            <p className="mt-1 text-[9px] font-medium tracking-[0.08em] text-muted-foreground">
              MARKDOWN STUDIO
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">
            {documentTitle(document)}
          </span>
          {dirty && (
            <span
              className="size-1.5 rounded-full bg-amber-500"
              aria-label="未保存"
            />
          )}
          <Badge
            variant="outline"
            className="border-blue-200 bg-blue-50 text-[10px] text-blue-700"
          >
            {document.type.toUpperCase()}
          </Badge>
        </div>

        <div className="flex min-w-56 justify-end gap-1.5">
          <Button
            aria-label="元に戻す"
            size="icon-sm"
            variant="ghost"
            disabled={documentWriteLocked || !editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 />
          </Button>
          <Button
            aria-label="やり直す"
            size="icon-sm"
            variant="ghost"
            disabled={documentWriteLocked || !editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 />
          </Button>
          <Separator orientation="vertical" className="mx-1 h-6 self-center" />
          <Button size="sm" variant="outline" onClick={saveJson}>
            <FileJson data-icon="inline-start" /> JSON
          </Button>
          <Button size="sm" onClick={saveMarkdown}>
            <Save data-icon="inline-start" /> Markdown
          </Button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="workspace-navigator">
          <div className="panel-heading">
            <span>DOCUMENT</span>
            <Button
              aria-label="Markdownを開く"
              size="icon-xs"
              variant="ghost"
              disabled={documentWriteLocked}
              onClick={() => markdownInput.current?.click()}
            >
              <FolderOpen />
            </Button>
          </div>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <nav aria-label="文書構成" className="space-y-1 p-2">
              {outline.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  構成要素はまだありません
                </p>
              ) : (
                outline.map((node) => {
                  const Icon = nodeIcon(node.type);
                  const nodeId = node.attrs.nodeId;
                  const active = selectedNode?.nodeId === nodeId;
                  return (
                    <button
                      key={nodeId}
                      type="button"
                      className={`navigator-item ${active ? 'navigator-item-active' : ''}`}
                      onClick={() => focusNode(nodeId)}
                    >
                      <Icon className="size-3.5" />
                      <span className="min-w-0 flex-1 truncate">
                        {formatName(node)}
                      </span>
                      <span className="font-mono text-[9px] opacity-55">
                        {node.type}
                      </span>
                    </button>
                  );
                })
              )}
            </nav>
          </ScrollArea>
          <div className="space-y-2 border-t p-3">
            <p className="text-[10px] text-muted-foreground">
              Markdown / Document JSON ＋ 画像
            </p>
            <Button
              className="w-full justify-start"
              variant="outline"
              disabled={documentWriteLocked}
              onClick={() => markdownInput.current?.click()}
            >
              <FolderOpen data-icon="inline-start" /> Markdownを開く
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={documentWriteLocked}
                onClick={() => createDocument('report')}
              >
                <FilePlus2 /> Report
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={documentWriteLocked}
                onClick={() => createDocument('slide')}
              >
                <FilePlus2 /> Slide
              </Button>
            </div>
          </div>
        </aside>

        <section className="workspace-center">
          <div className="view-tabs">
            <div className="flex h-full items-end gap-1">
              {(
                [
                  ['visual', 'ビジュアル編集'],
                  ['markdown', 'Markdown'],
                  ['preview', '完成プレビュー'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${label}へ切り替え`}
                  className={
                    view === value ? 'view-tab view-tab-active' : 'view-tab'
                  }
                  onClick={() => changeView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {document.type === 'report' ? 'A4' : '16:9'} ・ 100%
            </span>
          </div>

          {view === 'visual' && (
            <>
              <div className="format-toolbar" role="toolbar" aria-label="書式">
                <FormatButton
                  label="太字"
                  active={editor?.isActive('bold')}
                  onClick={() => editor?.chain().focus().toggleBold().run()}
                >
                  <Bold />
                </FormatButton>
                <FormatButton
                  label="斜体"
                  active={editor?.isActive('italic')}
                  onClick={() => editor?.chain().focus().toggleItalic().run()}
                >
                  <Italic />
                </FormatButton>
                <Separator
                  orientation="vertical"
                  className="mx-1 h-5 self-center"
                />
                <FormatButton
                  label="見出し1"
                  active={editor?.isActive('heading', { level: 1 })}
                  onClick={() =>
                    editor?.chain().focus().toggleHeading({ level: 1 }).run()
                  }
                >
                  <Heading1 />
                </FormatButton>
                <FormatButton
                  label="見出し2"
                  active={editor?.isActive('heading', { level: 2 })}
                  onClick={() =>
                    editor?.chain().focus().toggleHeading({ level: 2 }).run()
                  }
                >
                  <Heading2 />
                </FormatButton>
                <FormatButton
                  label="箇条書き"
                  active={editor?.isActive('bulletList')}
                  onClick={() =>
                    editor?.chain().focus().toggleBulletList().run()
                  }
                >
                  <List />
                </FormatButton>
                <FormatButton
                  label="番号付きリスト"
                  active={editor?.isActive('orderedList')}
                  onClick={() =>
                    editor?.chain().focus().toggleOrderedList().run()
                  }
                >
                  <ListOrdered />
                </FormatButton>
                <FormatButton
                  label="引用"
                  active={editor?.isActive('blockquote')}
                  onClick={() =>
                    editor?.chain().focus().toggleBlockquote().run()
                  }
                >
                  <Quote />
                </FormatButton>
                <Separator
                  orientation="vertical"
                  className="mx-1 h-5 self-center"
                />
                <FormatButton
                  label="インライン数式"
                  onClick={() =>
                    editor
                      ?.chain()
                      .focus()
                      .insertInlineMath({ latex: 'x = y + 1' })
                      .run()
                  }
                >
                  <Sigma />
                </FormatButton>
                <FormatButton
                  label="ブロック数式"
                  onClick={() =>
                    editor
                      ?.chain()
                      .focus()
                      .insertBlockMath({
                        latex: 'M\\ddot{x}+C\\dot{x}+Kx=F(t)',
                      })
                      .run()
                  }
                >
                  <FunctionSquare />
                </FormatButton>
                <FormatButton
                  label="表を挿入"
                  onClick={() =>
                    editor
                      ?.chain()
                      .focus()
                      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                      .run()
                  }
                >
                  <Table2 />
                </FormatButton>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    editor &&
                    insertDocumentBreak(
                      editor,
                      document.type === 'slide' ? 'slideBreak' : 'pageBreak',
                    )
                  }
                >
                  {document.type === 'slide' ? 'スライドを区切る' : '改ページ'}
                </Button>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="editor-stage">
                  <div className={`editor-paper editor-paper-${document.type}`}>
                    <EditorContent editor={editor} />
                  </div>
                </div>
              </ScrollArea>
            </>
          )}

          {view === 'markdown' && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <Textarea
                aria-label="Markdown原稿"
                className="min-h-0 flex-1 resize-none rounded-md bg-[#101923] p-5 font-mono text-[13px] leading-6 text-slate-100"
                value={markdownDraft}
                spellCheck={false}
                onChange={(event) => {
                  setMarkdownDraft(event.target.value);
                  setMarkdownDirty(true);
                  setStatus({
                    kind: 'idle',
                    title: 'Markdownを編集中',
                    description:
                      '適用または保存するまで下書きとして保持されます',
                  });
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={discardMarkdown}>
                  破棄
                </Button>
                <Button onClick={applyMarkdown}>
                  <Braces data-icon="inline-start" /> Markdownを適用
                </Button>
              </div>
            </div>
          )}

          {view === 'preview' && (
            <ScrollArea className="min-h-0 flex-1">
              <div className="preview-stage">
                <PreviewSurface
                  document={currentDocument(editor, document)}
                  resolveImageUrl={resolveImageUrl}
                />
              </div>
            </ScrollArea>
          )}

          {status.kind === 'error' && (
            <div className="absolute bottom-4 left-1/2 z-20 w-[min(620px,calc(100%-32px))] -translate-x-1/2">
              <Alert variant="destructive" className="bg-card shadow-lg">
                <AlertTitle>{status.title}</AlertTitle>
                {status.description && (
                  <AlertDescription>{status.description}</AlertDescription>
                )}
              </Alert>
            </div>
          )}
        </section>

        <aside className="workspace-properties">
          <div className="panel-heading">
            <span>PROPERTIES</span>
          </div>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4">
              <section>
                <h2 className="mb-3 text-xs font-semibold">文書</h2>
                <dl className="property-grid">
                  <dt>種類</dt>
                  <dd>{document.type === 'report' ? 'Report' : 'Slide'}</dd>
                  <dt>タイトル</dt>
                  <dd className="truncate" title={documentTitle(document)}>
                    {documentTitle(document)}
                  </dd>
                  <dt>テーマ</dt>
                  <dd>
                    <NativeSelect
                      aria-label="テーマ"
                      size="sm"
                      className="w-full"
                      disabled={documentWriteLocked}
                      value={
                        typeof document.metadata.theme === 'string'
                          ? document.metadata.theme
                          : themeOptions[0][0]
                      }
                      onChange={(event) => updateTheme(event.target.value)}
                    >
                      {themeOptions.map(([value, label]) => (
                        <NativeSelectOption key={value} value={value}>
                          {label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </dd>
                </dl>
                <div className="mt-3 space-y-2">
                  {[
                    ['toc', '目次'],
                    ['number_sections', '節番号'],
                    ...(document.type === 'slide'
                      ? [['slide_number', 'スライド番号']]
                      : []),
                  ].map(([key, title]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={
                          key === 'slide_number'
                            ? document.metadata[key] !== false
                            : document.metadata[key] === true
                        }
                        disabled={documentWriteLocked}
                        onChange={(event) =>
                          updateDocumentFlag(key, event.target.checked)
                        }
                      />
                      {title}
                    </label>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  <label className="property-field" htmlFor="reference-target">
                    参照先ラベル
                    <Input
                      aria-label="参照先ラベル"
                      id="reference-target"
                      value={referenceTarget}
                      disabled={documentWriteLocked}
                      onChange={(event) =>
                        setReferenceTarget(event.target.value)
                      }
                      placeholder="fig:response"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      documentWriteLocked || !labelPattern.test(referenceTarget)
                    }
                    onClick={() =>
                      editor
                        ?.chain()
                        .focus()
                        .insertContent({
                          type: 'reference',
                          attrs: { target: referenceTarget },
                        })
                        .run()
                    }
                  >
                    参照を挿入
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    利用可能:{' '}
                    {[...analysis.labels.keys()].join(', ') ||
                      '要素に参照ラベルを設定してください'}
                  </p>
                </div>
                {analysis.diagnostics.length > 0 && (
                  <div
                    className="semantic-warnings mt-3"
                    aria-label="文書の参照診断"
                  >
                    {analysis.diagnostics.map((message) => (
                      <p key={message}>{message}</p>
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              <section>
                <h2 className="mb-3 text-xs font-semibold">選択中の要素</h2>
                {selectedNode ? (
                  <div className="space-y-3">
                    <Badge variant="secondary">{selectedNode.type}</Badge>
                    {selectedNode.nodeId && (
                      <p className="break-all font-mono text-[10px] text-muted-foreground">
                        {selectedNode.nodeId}
                      </p>
                    )}
                    {(selectedNode.type === 'inlineMath' ||
                      selectedNode.type === 'blockMath') && (
                      <div className="space-y-2">
                        <label
                          htmlFor="math-latex"
                          className="text-[11px] font-medium text-muted-foreground"
                        >
                          LaTeX
                        </label>
                        <Textarea
                          id="math-latex"
                          className="min-h-24 font-mono text-xs"
                          disabled={documentWriteLocked}
                          value={mathDraft}
                          onChange={(event) => setMathDraft(event.target.value)}
                        />
                        <Button
                          className="w-full"
                          size="sm"
                          disabled={documentWriteLocked}
                          onClick={applyMath}
                        >
                          数式を更新
                        </Button>
                      </div>
                    )}
                    {selectedSemantic && (
                      <SemanticProperties
                        key={`${selectedSemantic.attrs.nodeId}:${JSON.stringify(selectedSemantic.attrs)}`}
                        node={selectedSemantic}
                        disabled={documentWriteLocked}
                        onApply={applyAttributes}
                      />
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed bg-muted/35 p-4 text-center">
                    <p className="text-[11px] text-muted-foreground">
                      要素を選択すると
                      <br />
                      設定を編集できます
                    </p>
                  </div>
                )}
              </section>
            </div>
          </ScrollArea>
          <output
            aria-live="polite"
            className="border-t px-3 py-2 text-[10px] text-muted-foreground"
          >
            <span
              className={`inline-block size-1.5 rounded-full ${
                status.kind === 'error'
                  ? 'bg-red-500'
                  : dirty
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
              }`}
            />
            <span className="ml-2">{status.title}</span>
            {status.description && (
              <span className="ml-1 block truncate" title={status.description}>
                {status.description}
              </span>
            )}
          </output>
        </aside>
      </section>
    </main>
  );
}

function FormatButton({
  active,
  children,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      size="icon-sm"
      variant={active ? 'secondary' : 'ghost'}
      onClick={onClick}
      type="button"
    >
      {children}
    </Button>
  );
}
