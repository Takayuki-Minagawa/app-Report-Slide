'use client';

import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import type { DocumentData } from '@/src/document/model';
import { preservedContent } from '@/src/document/preserved-content';

export function PreservedContentPanel({
  document,
  onFocus,
}: {
  document: DocumentData;
  onFocus: (id: string) => void;
}) {
  const ja = useAppPreferences().locale === 'ja';
  const entries = preservedContent(document.metadata);
  if (!entries.length) return null;
  return (
    <details className="rounded border p-3 text-xs">
      <summary className="cursor-pointer font-semibold">
        {ja ? '保持した取込原データ' : 'Retained import source'} (
        {entries.length})
      </summary>
      <p className="my-2 text-muted-foreground">
        {ja
          ? '未対応要素は原文を保管しています。HTMLの動作や外部ファイルは再現しません。必要なときに原文を確認できます。'
          : 'Unsupported source is retained as text. HTML behavior and external files are not reproduced. Expand an entry to inspect it.'}
      </p>
      {entries.map((entry) => (
        <details key={entry.id} className="mt-2 border-t pt-2">
          <summary className="cursor-pointer break-words">{entry.name}</summary>
          <div className="my-2 flex gap-2">
            {entry.nodeId && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onFocus(entry.nodeId!)}
              >
                {ja ? '対象へ移動' : 'Go to element'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([entry.source], {
                    type: 'text/plain;charset=utf-8',
                  }),
                );
                const link = window.document.createElement('a');
                link.href = url;
                link.download = `kumi-retained-${entry.id}.${entry.format === 'json' ? 'json' : 'html.txt'}`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              {ja ? '原文を保存' : 'Save source'}
            </Button>
          </div>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
            {entry.source}
          </pre>
        </details>
      ))}
    </details>
  );
}
