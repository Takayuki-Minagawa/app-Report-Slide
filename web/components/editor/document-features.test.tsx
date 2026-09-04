import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { EditorWorkspace } from './editor-workspace';
import { parseMarkdown } from '@/src/markdown/parser';

afterEach(() => vi.unstubAllGlobals());

function renderWorkspace() {
  return render(
    <AppPreferencesProvider>
      <EditorWorkspace />
    </AppPreferencesProvider>,
  );
}

async function applySource(source: string) {
  await screen.findByText('REPORT');
  fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'Markdown原稿' }),
    { target: { value: source } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Markdownを適用' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('textbox', { name: 'Markdown原稿' }),
    ).not.toBeInTheDocument(),
  );
}

describe('document feature workspace', () => {
  it('edits Figure properties, reflects Undo and locks them during Markdown drafts', async () => {
    renderWorkspace();
    await applySource('![図A](a.svg)\n\n![図B](b.svg)');
    fireEvent.click(screen.getByRole('button', { name: /図A figure/ }));
    const width = await screen.findByRole('spinbutton', {
      name: '図の幅（%）',
    });
    fireEvent.change(width, { target: { value: '65' } });
    fireEvent.change(screen.getByRole('textbox', { name: '参照ラベル' }), {
      target: { value: 'fig:a' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'キャプション' }), {
      target: { value: '応答' },
    });
    fireEvent.click(screen.getByRole('button', { name: '属性を適用' }));
    expect(screen.getByRole('spinbutton', { name: '図の幅（%）' })).toHaveValue(
      65,
    );
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    await waitFor(() =>
      expect(
        screen.getByRole('spinbutton', { name: '図の幅（%）' }),
      ).toHaveValue(100),
    );
    fireEvent.click(screen.getByRole('button', { name: 'やり直す' }));
    await waitFor(() =>
      expect(
        screen.getByRole('spinbutton', { name: '図の幅（%）' }),
      ).toHaveValue(65),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    const source = await screen.findByRole('textbox', { name: 'Markdown原稿' });
    expect((source as HTMLTextAreaElement).value).toContain(
      '#fig:a width=65% caption="応答"',
    );
    expect(
      screen.getByRole('spinbutton', { name: '図の幅（%）' }),
    ).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '目次' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '節番号' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '参照を挿入' })).toBeDisabled();
    fireEvent.change(source, {
      target: { value: `${(source as HTMLTextAreaElement).value}\n\n未適用` },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '完成プレビューへ切り替え' }),
    );
    expect(screen.getByRole('button', { name: '属性を適用' })).toBeDisabled();
    expect(screen.getByLabelText('A4レポートプレビュー')).toHaveTextContent(
      '図 1 — 応答',
    );
  });

  it('does not apply the previous Figure draft to a different selected node', async () => {
    renderWorkspace();
    await applySource('![図A](a.svg)\n\n![図B](b.svg)');
    fireEvent.click(screen.getByRole('button', { name: /図A figure/ }));
    fireEvent.change(
      await screen.findByRole('spinbutton', { name: '図の幅（%）' }),
      { target: { value: '30' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /図B figure/ }));
    expect(
      await screen.findByRole('spinbutton', { name: '図の幅（%）' }),
    ).toHaveValue(100);
    fireEvent.click(screen.getByRole('button', { name: '属性を適用' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    expect(
      (
        (await screen.findByRole('textbox', {
          name: 'Markdown原稿',
        })) as HTMLTextAreaElement
      ).value,
    ).not.toContain('width=30%');
  });

  it('updates only the selected equation after navigating from equation A to B', async () => {
    renderWorkspace();
    await applySource('$$\nx=1\n$$\n\n$$\ny=2\n$$');
    const equations = screen.getAllByRole('button', {
      name: /ブロック数式 blockMath/,
    });
    fireEvent.click(equations[0]);
    expect(await screen.findByRole('textbox', { name: 'LaTeX' })).toHaveValue(
      'x=1',
    );
    fireEvent.click(equations[1]);
    expect(screen.getByRole('textbox', { name: 'LaTeX' })).toHaveValue('y=2');
    fireEvent.change(screen.getByRole('textbox', { name: 'LaTeX' }), {
      target: { value: 'y=3' },
    });
    fireEvent.click(screen.getByRole('button', { name: '数式を更新' }));
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'LaTeX' })).toHaveValue('y=2'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'やり直す' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'LaTeX' })).toHaveValue('y=3'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    const saved = (
      (await screen.findByRole('textbox', {
        name: 'Markdown原稿',
      })) as HTMLTextAreaElement
    ).value;
    expect(saved).toContain('x=1');
    expect(saved).toContain('y=3');
    expect(saved).not.toContain('y=2');
  });

  it('exports an advanced JSON table as lossless KUMI Markdown without losing cells', async () => {
    const { container } = renderWorkspace();
    await screen.findByText('REPORT');
    const document = parseMarkdown('| a |\n|---|\n| b |').document;
    const table = document.children[0];
    if (table.type !== 'table') throw new Error('Expected table');
    table.content[1].content![0].content.push({
      type: 'paragraph',
      attrs: { nodeId: 'extra' },
      content: [{ type: 'text', text: '複数段落セルの本文' }],
    });
    const file = new File([JSON.stringify(document)], 'legacy.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'text', {
      value: async () => JSON.stringify(document),
    });
    fireEvent.change(screen.getByLabelText('Markdownファイル'), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(container.querySelector('.kumi-editor-content')).toHaveTextContent(
        '複数段落セルの本文',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    const source = (await screen.findByRole('textbox', {
      name: 'Markdown原稿',
    })) as HTMLTextAreaElement;
    expect(source.value).toContain('::: kumi-table');
    expect(source.value).toContain('複数段落セルの本文');
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Markdownを適用' }));
    await waitFor(() =>
      expect(container.querySelector('.kumi-editor-content')).toHaveTextContent(
        '複数段落セルの本文',
      ),
    );
  });
  it('shows the image placement canvas only for Slide documents', async () => {
    renderWorkspace();
    await screen.findByText('REPORT');
    expect(
      screen.queryByRole('button', { name: '図を配置へ切り替え' }),
    ).not.toBeInTheDocument();

    await applySource(
      '---\ntype: slide\ntitle: 配置するスライド\n---\n\n# 配置するスライド',
    );
    expect(await screen.findByText('SLIDE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '図を配置へ切り替え' }));

    expect(await screen.findByLabelText('画像を選択')).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg',
    );
    expect(
      screen.getByText(
        /画像を挿入するか本文の図をクリックして配置を開始します。/,
      ),
    ).toBeInTheDocument();
  });
  it('resolves a newly placed image in the visual editor', async () => {
    const { container } = renderWorkspace();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: () => 'blob:visual-placement',
        revokeObjectURL: vi.fn(),
      }),
    );
    await applySource(
      '---\ntype: slide\ntitle: Visual image\n---\n\n# Visual image',
    );
    fireEvent.click(screen.getByRole('button', { name: '図を配置へ切り替え' }));
    fireEvent.change(await screen.findByLabelText('画像を選択'), {
      target: {
        files: [new File(['image'], 'visual.png', { type: 'image/png' })],
      },
    });

    await waitFor(() =>
      expect(
        container.querySelector('.slide-layout-editor img'),
      ).toHaveAttribute('src', 'blob:visual-placement'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'ビジュアル編集へ切り替え' }),
    );
    await waitFor(() =>
      expect(
        container.querySelector('.kumi-editor-content img'),
      ).toHaveAttribute('src', 'blob:visual-placement'),
    );
  });

  it('converts a document-flow Slide figure into a free-positioned figure', async () => {
    renderWorkspace();
    await applySource(
      '---\ntype: slide\ntitle: 既存図\n---\n\n# 既存図\n\n![既存図](diagram.png)',
    );
    fireEvent.click(screen.getByRole('button', { name: '図を配置へ切り替え' }));
    fireEvent.click(await screen.findByRole('button', { name: '既存図' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));

    await waitFor(() =>
      expect(
        (
          screen.getByRole('textbox', {
            name: 'Markdown原稿',
          }) as HTMLTextAreaElement
        ).value,
      ).toContain('slide_layout="32,22,36,42"'),
    );
  });
  it('keeps image placement keyboard focus and labels every resize handle', async () => {
    renderWorkspace();
    await applySource(
      '---\ntype: slide\ntitle: キーボード配置\n---\n\n# キーボード配置\n\n![配置図](diagram.png)\n{slide_layout="12,18,40,30"}',
    );
    fireEvent.click(screen.getByRole('button', { name: '図を配置へ切り替え' }));
    const mover = await screen.findByRole('button', { name: '配置図' });
    mover.focus();
    fireEvent.keyDown(mover, { key: 'ArrowRight' });

    await waitFor(() => expect(mover).toHaveFocus());
    for (const name of [
      '画像の左上の角をリサイズ',
      '画像の右上の角をリサイズ',
      '画像の左下の角をリサイズ',
      '画像の右下の角をリサイズ',
      '画像の上辺をリサイズ',
      '画像の右辺をリサイズ',
      '画像の下辺をリサイズ',
      '画像の左辺をリサイズ',
    ])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole('textbox', {
            name: 'Markdown原稿',
          }) as HTMLTextAreaElement
        ).value,
      ).toContain('slide_layout="13,18,40,30"'),
    );
  });

  it('disables image placement interactions while a Markdown draft is unresolved', async () => {
    renderWorkspace();
    await applySource(
      '---\ntype: slide\ntitle: ロック中\n---\n\n# ロック中\n\n![既存図](diagram.png)',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown原稿' }), {
      target: {
        value:
          '---\ntype: slide\ntitle: ロック中の下書き\n---\n\n# ロック中の下書き',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '図を配置へ切り替え' }));

    expect(
      await screen.findByRole('button', { name: '画像を挿入' }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: '既存図' }),
    ).not.toBeInTheDocument();
  });
});
