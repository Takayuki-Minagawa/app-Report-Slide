'use client';

import { documentTitle } from '@/src/document/model';
import type { WorkspaceRecovery } from '@/src/workspace/recovery';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function RecoveryDialog({
  recovery,
  restoring,
  onRestore,
  onDiscard,
  open = false,
  onClose,
  candidates = [],
  onSelect,
}: {
  recovery: WorkspaceRecovery | null;
  restoring: boolean;
  onRestore: () => void;
  onDiscard: () => void;
  open?: boolean;
  onClose?: () => void;
  candidates?: WorkspaceRecovery[];
  onSelect?: (savedAt: number) => void;
}) {
  const { copy, locale } = useAppPreferences();
  if (!open) return null;
  const savedAt = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(recovery?.savedAt ?? 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !restoring) onClose?.();
      }}
    >
      <DialogContent showCloseButton={false} aria-busy={restoring}>
        <DialogHeader>
          <DialogTitle>
            {recovery
              ? copy.recovery.foundTitle
              : locale === 'ja'
                ? '復元できる作業はありません'
                : 'No recovery copies'}
          </DialogTitle>
          <DialogDescription>
            {recovery
              ? copy.recovery.foundDescription
              : locale === 'ja'
                ? '現在の文書をそのまま編集できます。'
                : 'Continue editing your current document.'}
          </DialogDescription>
        </DialogHeader>
        {candidates.length > 1 && (
          <label className="property-field">
            {locale === 'ja' ? '復元候補' : 'Recovery copy'}
            <select
              className="rounded border p-2"
              value={recovery?.savedAt}
              disabled={restoring}
              onChange={(event) => onSelect?.(Number(event.target.value))}
            >
              {candidates.map((item) => (
                <option key={item.savedAt} value={item.savedAt}>
                  {documentTitle(item.document)} —{' '}
                  {new Date(item.savedAt).toLocaleString(locale)}
                </option>
              ))}
            </select>
          </label>
        )}
        {recovery && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {copy.recovery.savedAt(documentTitle(recovery.document), savedAt)}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={restoring} onClick={onClose}>
            {locale === 'ja' ? '閉じる（候補を保持）' : 'Close (keep copies)'}
          </Button>
          <Button
            variant="outline"
            disabled={restoring || !recovery}
            onClick={onDiscard}
          >
            {copy.recovery.discard}
          </Button>
          <Button disabled={restoring || !recovery} onClick={onRestore}>
            {restoring ? copy.recovery.restoring : copy.recovery.restore}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
