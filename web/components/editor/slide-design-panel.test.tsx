import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { createDefaultDocument, type DocumentData } from '@/src/document/model';
import { resolveSlideDesign } from '@/src/document/slide-design';
import { SlideDesignPanel } from './slide-design-panel';

function Harness() {
  const [document, setDocument] = useState<DocumentData>(() => {
    const data = createDefaultDocument('slide');
    data.children.push(
      { type: 'slideBreak', attrs: { nodeId: 'divider' } },
      {
        type: 'heading',
        attrs: { nodeId: 'second', level: 1 },
        content: [{ type: 'text', text: 'Page two' }],
      },
    );
    return data;
  });
  return (
    <AppPreferencesProvider>
      <SlideDesignPanel
        document={document}
        currentPageIndex={1}
        disabled={false}
        onApply={(metadata) => setDocument({ ...document, metadata })}
      />
      <output aria-label="Current designs">
        {[0, 1]
          .map((index) => resolveSlideDesign(document, index).theme)
          .join(',')}
      </output>
      <button
        onClick={() =>
          setDocument({
            ...document,
            metadata: { ...document.metadata, title: 'New title' },
          })
        }
      >
        Change title
      </button>
      <output aria-label="Current title">{document.metadata.title}</output>
      <output aria-label="Saved metadata">
        {JSON.stringify(document.metadata)}
      </output>
    </AppPreferencesProvider>
  );
}

describe('slide design panel', () => {
  it('saves an explicitly enabled default role alongside subsequent spacing edits in a named preset', async () => {
    render(<Harness />);
    expect(screen.getByLabelText('リード文のsize')).toHaveValue(20);
    fireEvent.click(screen.getByLabelText('リード文の個別設定を使う'));
    fireEvent.change(screen.getByLabelText('ページ余白 horizontal'), {
      target: { value: '45' },
    });
    fireEvent.change(screen.getByLabelText('スタイルプリセット名'), {
      target: { value: 'Reading style' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '現在の設定をプリセット保存' }),
    );
    const metadata = JSON.parse(
      screen.getByLabelText('Saved metadata').textContent!,
    );
    expect(metadata.slide_presets.items[0]).toMatchObject({
      name: 'Reading style',
      design: {
        roleStyles: { lead: { size: 20 } },
        spacing: { horizontal: 45 },
      },
    });
    expect(screen.getByLabelText('リード文の個別設定を使う')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '変更をプレビュー' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'このデザインを適用' }),
    );
    const applied = JSON.parse(
      screen.getByLabelText('Saved metadata').textContent!,
    );
    expect(applied.slide_design.pages[0].design).toMatchObject({
      roleStyles: { lead: { size: 20 } },
      spacing: { horizontal: 45 },
    });
    fireEvent.click(screen.getByLabelText('リード文の個別設定を使う'));
    expect(screen.getByLabelText('リード文の個別設定を使う')).not.toBeChecked();
  });
  it('previews selected scope before applying, cancels without mutation and undoes only design', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('combobox', { name: 'テーマ' }), {
      target: { value: 'paper-light' },
    });
    fireEvent.click(screen.getByRole('button', { name: '変更をプレビュー' }));
    let dialog = await screen.findByRole('dialog');
    expect(
      within(dialog)
        .getByRole('region', { name: '変更前' })
        .querySelector('article'),
    ).toHaveAttribute('data-theme', 'beamer-simple');
    expect(
      within(dialog)
        .getByRole('region', { name: '変更後' })
        .querySelector('article'),
    ).toHaveAttribute('data-theme', 'paper-light');
    expect(screen.getByLabelText('Current designs')).toHaveTextContent(
      'beamer-simple,beamer-simple',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByLabelText('Current designs')).toHaveTextContent(
      'beamer-simple,beamer-simple',
    );
    fireEvent.click(screen.getByRole('button', { name: '変更をプレビュー' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'このデザインを適用' }),
    );
    expect(screen.getByLabelText('Current designs')).toHaveTextContent(
      'beamer-simple,paper-light',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change title' }));
    fireEvent.click(
      screen.getByRole('button', { name: '直前のデザイン変更を取り消す' }),
    );
    expect(screen.getByLabelText('Current designs')).toHaveTextContent(
      'beamer-simple,beamer-simple',
    );
    expect(screen.getByLabelText('Current title')).toHaveTextContent(
      'New title',
    );
  });

  it('applies to all pages and exposes every target page in preview', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('combobox', { name: 'テーマ' }), {
      target: { value: 'technical' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '適用範囲' }), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('button', { name: '変更をプレビュー' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('combobox', { name: '確認するページ' }).children,
    ).toHaveLength(2);
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'このデザインを適用' }),
    );
    expect(screen.getByLabelText('Current designs')).toHaveTextContent(
      'technical,technical',
    );
  });

  it('requires at least one selected page', () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('combobox', { name: '適用範囲' }), {
      target: { value: 'selected' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'ページ 2 — Page two' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '変更をプレビュー' }));
    expect(screen.getByRole('alert')).toHaveTextContent('1つ以上');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
