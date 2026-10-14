import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createConceptFigure,
  conceptDiagramSvg,
} from '@/src/document/figure-edit';
import type { FigureNode } from '@/src/document/model';
import { FigureEditProperties } from './figure-edit-properties';

describe('figure property drafts', () => {
  it('keeps an unsaved draft across unrelated updates and follows an external Undo', () => {
    const node = createConceptFigure();
    node.attrs.figureEdit = {
      version: 1,
      name: '保存済みの図',
      svgSource: conceptDiagramSvg,
      imageSize: { width: 800, height: 400 },
    };
    const onApply = vi.fn();
    const props = {
      metadata: { title: '文書' },
      resolveImageUrl: (source: string) => source,
      disabled: false,
      onApply,
      onMetadataChange: vi.fn(),
    };
    const { rerender } = render(
      <FigureEditProperties {...props} node={node} />,
    );
    fireEvent.change(screen.getByLabelText('図の名前'), {
      target: { value: '未適用の編集' },
    });
    rerender(
      <FigureEditProperties
        {...props}
        node={JSON.parse(JSON.stringify(node)) as FigureNode}
        metadata={{ title: '文書のタイトルを変更' }}
      />,
    );
    expect(screen.getByLabelText('図の名前')).toHaveValue('未適用の編集');
    fireEvent.click(screen.getByRole('button', { name: '図の編集を適用' }));
    const saved = {
      ...node,
      attrs: { ...node.attrs, ...onApply.mock.calls[0][1] },
    };
    rerender(<FigureEditProperties {...props} node={saved} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      /図(を更新|の編集を適用)しました。/,
    );
    expect(screen.getByLabelText('図の名前')).toHaveValue('未適用の編集');
    rerender(<FigureEditProperties {...props} node={node} />);
    expect(screen.getByLabelText('図の名前')).toHaveValue('保存済みの図');
  });
});
