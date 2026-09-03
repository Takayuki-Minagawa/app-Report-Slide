import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { initialDocument } from '@/src/workspace/initial-document';
import { RecoveryDialog } from './recovery-dialog';

describe('RecoveryDialog', () => {
  it('lets the user restore or remove device-local unfinished work', async () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(
      <AppPreferencesProvider>
        <RecoveryDialog
          recovery={{
            schemaVersion: 1,
            savedAt: Date.UTC(2026, 8, 3, 10, 0),
            document: initialDocument,
            markdownDraft: '',
            markdownDirty: false,
            view: 'visual',
            assets: [],
          }}
          restoring={false}
          onRestore={onRestore}
          onDiscard={onDiscard}
        />
      </AppPreferencesProvider>,
    );

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      '未保存の作業が見つかりました',
    );
    fireEvent.click(screen.getByRole('button', { name: '復元する' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    expect(onRestore).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
  });
});
