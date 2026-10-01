'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppPreferences } from '@/components/app-preferences';
import { findTextMatches, replaceTextMatches } from '@/src/editor/search';

export function SearchReplace({
  editor,
  locked,
}: {
  editor: Editor | null;
  locked: boolean;
}) {
  const { copy } = useAppPreferences();
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [, setRevision] = useState(0);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => setRevision((value) => value + 1);
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor]);
  const matches = editor ? findTextMatches(editor, query) : [];
  const current = matches.length ? Math.min(active, matches.length - 1) : 0;
  const jump = (index: number) => {
    if (!editor || !matches.length) return;
    const next = (index + matches.length) % matches.length;
    setActive(next);
    editor.chain().focus().setTextSelection(matches[next]).run();
  };
  const replaceOne = () => {
    if (!editor || !matches.length || locked) return;
    replaceTextMatches(editor, [matches[current]], replacement);
    editor.commands.focus();
  };
  const replaceAll = () => {
    if (!editor || !matches.length || locked) return;
    replaceTextMatches(editor, matches, replacement);
    setActive(0);
    editor.commands.focus();
  };
  return (
    <search className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
      <Input
        className="h-8 w-48"
        aria-label={copy.workspace.searchText}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
      />
      <output aria-live="polite" className="min-w-14 text-center text-sm">
        {matches.length ? `${current + 1} / ${matches.length}` : '0 / 0'}
      </output>
      <Button
        size="sm"
        variant="outline"
        disabled={!matches.length}
        onClick={() => jump(current - 1)}
      >
        {copy.workspace.searchPrevious}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!matches.length}
        onClick={() => jump(current + 1)}
      >
        {copy.workspace.searchNext}
      </Button>
      <Input
        className="h-8 w-48"
        aria-label={copy.workspace.replacementText}
        value={replacement}
        onChange={(event) => setReplacement(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={locked || !matches.length}
        onClick={replaceOne}
      >
        {copy.workspace.replaceOne}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={locked || !matches.length}
        onClick={replaceAll}
      >
        {copy.workspace.replaceAll}
      </Button>
    </search>
  );
}
