'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { findTextMatches, replaceTextMatches } from '@/src/editor/search';
import type { AppLocale } from '@/src/i18n/messages';

export function SearchReplace({
  editor,
  locked,
  locale,
}: {
  editor: Editor | null;
  locked: boolean;
  locale: AppLocale;
}) {
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
  const ja = locale === 'ja';
  return (
    <search className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
      <Input
        className="h-8 w-48"
        aria-label={ja ? '検索語' : 'Search text'}
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
        {ja ? '前へ' : 'Previous'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!matches.length}
        onClick={() => jump(current + 1)}
      >
        {ja ? '次へ' : 'Next'}
      </Button>
      <Input
        className="h-8 w-48"
        aria-label={ja ? '置換後の文字列' : 'Replacement text'}
        value={replacement}
        onChange={(event) => setReplacement(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={locked || !matches.length}
        onClick={replaceOne}
      >
        {ja ? '置換' : 'Replace'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={locked || !matches.length}
        onClick={replaceAll}
      >
        {ja ? 'すべて置換' : 'Replace all'}
      </Button>
    </search>
  );
}
