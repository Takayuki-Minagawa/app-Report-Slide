import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppPreferencesProvider } from './app-preferences';
import { UserManualDialog } from './user-manual-dialog';

describe('UserManualDialog', () => {
  it('opens a Japanese quick guide by default', async () => {
    render(
      <AppPreferencesProvider>
        <UserManualDialog />
      </AppPreferencesProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'ガイド' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'KUMI かんたんガイド',
    );
    expect(screen.getByText('1. はじめる')).toBeInTheDocument();
    expect(screen.getByText('3. 表を高度に編集する')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument();
  });
});
