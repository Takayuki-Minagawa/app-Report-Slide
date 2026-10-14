'use client';

import { useRef, type ReactNode } from 'react';
import {
  Code2,
  FilePlus2,
  FileText,
  FolderOpen,
  FunctionSquare,
  Heading1,
  ImageIcon,
  Table2,
} from 'lucide-react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  inlineText,
  type DocumentNode,
  type DocumentType,
} from '@/src/document/model';
import type { UiMessages } from '@/src/i18n/messages';

function formatName(node: DocumentNode, copy: UiMessages): string {
  switch (node.type) {
    case 'heading':
      return inlineText(node.content) || copy.workspace.untitledHeading;
    case 'figure':
      return node.attrs.alt || copy.workspace.image;
    case 'blockMath':
      return copy.workspace.blockMath;
    case 'table':
      return copy.workspace.table;
    case 'codeBlock':
      return copy.workspace.code;
    default:
      return node.type;
  }
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

interface WorkspaceNavigatorProps {
  projectPanel?: ReactNode;
  overlay?: boolean;
  outline: readonly DocumentNode[];
  selectedNodeId?: string;
  documentWriteLocked: boolean;
  focusNode: (nodeId: string) => void;
  importFiles: (files: readonly File[]) => Promise<void>;
  createDocument: (type: DocumentType) => void;
  loadSample: (type: DocumentType | 'figures') => void;
  openRecovery: () => void;
  children?: ReactNode;
}

export function WorkspaceNavigator({
  projectPanel,
  overlay = false,
  outline,
  selectedNodeId,
  documentWriteLocked,
  focusNode,
  importFiles,
  createDocument,
  loadSample,
  openRecovery,
  children,
}: WorkspaceNavigatorProps) {
  const { copy, locale } = useAppPreferences();
  const markdownInput = useRef<HTMLInputElement>(null);
  return (
    <aside
      className={`workspace-navigator${overlay ? ' workspace-side-sheet' : ''}`}
    >
      <input
        ref={markdownInput}
        className="sr-only"
        type="file"
        accept=".html,.htm,text/html,.md,.markdown,.json,.zip,application/json,text/markdown,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
        multiple
        disabled={documentWriteLocked}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void importFiles(files);
        }}
        aria-label={copy.workspace.markdownFile}
      />
      <div className="panel-heading">
        <span>{copy.workspace.documentPanel}</span>
        <Button
          aria-label={copy.workspace.openMarkdown}
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
        <details className="border-b p-3 text-xs">
          <summary className="cursor-pointer font-medium">
            {locale === 'ja' ? '章別プロジェクト' : 'Chapter project'}
          </summary>
          {projectPanel}
        </details>
        {children}
        <nav
          aria-label={copy.workspace.documentStructure}
          className="space-y-1 p-2"
        >
          {outline.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {copy.workspace.noOutline}
            </p>
          ) : (
            outline.map((node) => {
              const Icon = nodeIcon(node.type);
              const nodeId = node.attrs.nodeId;
              const active = selectedNodeId === nodeId;
              return (
                <button
                  key={nodeId}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  className={`navigator-item ${active ? 'navigator-item-active' : ''}`}
                  onClick={() => focusNode(nodeId)}
                >
                  <Icon className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">
                    {formatName(node, copy)}
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
          {copy.workspace.importHint}
        </p>
        <Button
          className="w-full justify-start"
          variant="outline"
          disabled={documentWriteLocked}
          onClick={() => markdownInput.current?.click()}
        >
          <FolderOpen data-icon="inline-start" />
          {copy.workspace.openMarkdown}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={documentWriteLocked}
            onClick={() => createDocument('report')}
          >
            <FilePlus2 /> {copy.workspace.newReport}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={documentWriteLocked}
            onClick={() => createDocument('slide')}
          >
            <FilePlus2 /> {copy.workspace.newSlide}
          </Button>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer py-1 text-muted-foreground">
            {locale === 'ja' ? 'サンプルを開く' : 'Open an example'}
          </summary>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              disabled={documentWriteLocked}
              onClick={() => loadSample('report')}
            >
              {locale === 'ja' ? 'Reportサンプル' : 'Report example'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={documentWriteLocked}
              onClick={() => loadSample('slide')}
            >
              {locale === 'ja' ? 'Slideサンプル' : 'Slide example'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={documentWriteLocked}
              onClick={() => loadSample('figures')}
            >
              {locale === 'ja'
                ? '図表サンプル（5ページ）'
                : 'Figure examples (5 pages)'}
            </Button>
          </div>
        </details>
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-start"
          onClick={openRecovery}
        >
          {locale === 'ja' ? '未保存の作業を確認' : 'Review recovery copies'}
        </Button>
      </div>
    </aside>
  );
}
