import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorWorkspace } from './editor-workspace';
import { parseMarkdown } from '@/src/markdown/parser';

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
    render(<EditorWorkspace />);
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
    render(<EditorWorkspace />);
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
    render(<EditorWorkspace />);
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

  it('imports valid JSON that cannot be represented as Markdown, without losing cells', async () => {
    const { container } = render(<EditorWorkspace />);
    await screen.findByText('REPORT');
    const document = parseMarkdown('| a |\n|---|\n| b |').document;
    const table = document.children[0];
    if (table.type !== 'table') throw new Error('Expected table');
    table.content[1].content[0].content.push({
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Markdown');
    expect(container.querySelector('.kumi-editor-content')).toHaveTextContent(
      '複数段落セルの本文',
    );
    expect(
      screen.queryByRole('textbox', { name: 'Markdown原稿' }),
    ).not.toBeInTheDocument();
  });
});
