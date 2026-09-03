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
}: {
  recovery: WorkspaceRecovery | null;
  restoring: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { copy, locale } = useAppPreferences();
  if (!recovery) return null;
  const savedAt = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(recovery.savedAt);

  return (
    <Dialog open>
      <DialogContent showCloseButton={false} aria-busy={restoring}>
        <DialogHeader>
          <DialogTitle>{copy.recovery.foundTitle}</DialogTitle>
          <DialogDescription>
            {copy.recovery.foundDescription}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {copy.recovery.savedAt(documentTitle(recovery.document), savedAt)}
        </p>
        <DialogFooter>
          <Button variant="outline" disabled={restoring} onClick={onDiscard}>
            {copy.recovery.discard}
          </Button>
          <Button disabled={restoring} onClick={onRestore}>
            {restoring ? copy.recovery.restoring : copy.recovery.restore}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
