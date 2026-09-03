'use client';

import type { Editor } from '@tiptap/react';
import {
  FileJson,
  FileText,
  Languages,
  Moon,
  Redo2,
  Save,
  Sun,
  Undo2,
} from 'lucide-react';
import { useAppPreferences } from '@/components/app-preferences';
import { UserManualDialog } from '@/components/user-manual-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { documentTitle, type DocumentData } from '@/src/document/model';
import type { DocumentFileFormat } from '@/src/workspace/files';

interface WorkspaceHeaderProps {
  document: DocumentData;
  editor: Editor | null;
  dirty: boolean;
  documentWriteLocked: boolean;
  saveDocument: (format: DocumentFileFormat) => void;
}

export function WorkspaceHeader({
  document,
  editor,
  dirty,
  documentWriteLocked,
  saveDocument,
}: WorkspaceHeaderProps) {
  const {
    copy,
    locale,
    ready: preferencesReady,
    theme,
    toggleLocale,
    toggleTheme,
  } = useAppPreferences();
  return (
    <header className="workspace-header">
      <div className="flex min-w-56 items-center gap-2.5">
        <div className="grid size-8 place-items-center rounded-md bg-[#0b2742] text-xs font-black text-white">
          K
        </div>
        <div className="leading-none">
          <p className="text-sm font-bold tracking-[0.12em] text-primary">
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
            aria-label={copy.workspace.unsaved}
          />
        )}
        <Badge
          variant="outline"
          className="document-type-badge border-blue-200 bg-blue-50 text-[10px] text-blue-700"
        >
          {document.type.toUpperCase()}
        </Badge>
      </div>

      <div className="flex min-w-72 justify-end gap-1.5">
        <Button
          aria-label={copy.app.darkMode}
          title={
            theme === 'light' ? copy.app.switchToDark : copy.app.switchToLight
          }
          size="icon-sm"
          variant="ghost"
          type="button"
          aria-pressed={theme === 'dark'}
          disabled={!preferencesReady}
          onClick={toggleTheme}
        >
          {theme === 'light' ? <Moon /> : <Sun />}
        </Button>
        <Button
          aria-label={copy.app.englishInterface}
          title={
            locale === 'ja'
              ? copy.app.switchToEnglish
              : copy.app.switchToJapanese
          }
          size="sm"
          variant="ghost"
          type="button"
          aria-pressed={locale === 'en'}
          disabled={!preferencesReady}
          onClick={toggleLocale}
        >
          <Languages data-icon="inline-start" />
          {locale === 'ja' ? 'EN' : '日本語'}
        </Button>
        <UserManualDialog />
        <Separator orientation="vertical" className="mx-1 h-6 self-center" />
        <Button
          aria-label={copy.workspace.undo}
          size="icon-sm"
          variant="ghost"
          disabled={documentWriteLocked || !editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 />
        </Button>
        <Button
          aria-label={copy.workspace.redo}
          size="icon-sm"
          variant="ghost"
          disabled={documentWriteLocked || !editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6 self-center" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => saveDocument('json')}
        >
          <FileJson data-icon="inline-start" /> JSON
        </Button>
        <Button size="sm" onClick={() => saveDocument('markdown')}>
          <Save data-icon="inline-start" /> Markdown
        </Button>
      </div>
    </header>
  );
}
