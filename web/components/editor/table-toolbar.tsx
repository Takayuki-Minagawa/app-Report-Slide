'use client';

import {
  Eraser,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Pencil,
  Square,
  Table2,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';

import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  applyTableBorders,
  type TableBorderMode,
  type TableBorderPreset,
} from '@/src/editor/table-commands';
import type { TableBorderStyle, TableBorderWidth } from '@/src/document/table';

function TableActionButton({
  active = false,
  children,
  destructive = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  destructive?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      size="icon-sm"
      title={label}
      type="button"
      variant={destructive ? 'destructive' : active ? 'secondary' : 'ghost'}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function TableToolbarGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="table-toolbar-group">
      <span className="table-toolbar-label">{label}</span>
      <div className="table-toolbar-actions">{children}</div>
    </div>
  );
}

function useTableActive(editor: Editor | null): boolean {
  const [active, setActive] = useState(
    () => editor?.isActive('table') ?? false,
  );

  useEffect(() => {
    if (!editor) return;
    const update = () => setActive(editor.isActive('table'));
    const refresh = window.setTimeout(update, 0);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      window.clearTimeout(refresh);
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  return active;
}

export function TableToolbar({ editor }: { editor: Editor | null }) {
  const { copy } = useAppPreferences();
  const tableActive = useTableActive(editor);
  const [borderMode, setBorderMode] = useState<TableBorderMode>('draw');
  const [borderColor, setBorderColor] = useState('#334155');
  const [borderStyle, setBorderStyle] = useState<TableBorderStyle>('solid');
  const [borderWidth, setBorderWidth] = useState<TableBorderWidth>(1);

  if (!editor || !tableActive) return null;

  const run = (command: () => boolean) => {
    command();
  };
  const applyBorders = (preset: TableBorderPreset) => {
    applyTableBorders(editor, preset, borderMode, {
      color: borderColor,
      style: borderStyle,
      width: borderWidth,
    });
  };

  return (
    <div
      className="table-toolbar"
      role="toolbar"
      aria-label={copy.workspace.tableTools}
    >
      <TableToolbarGroup label={copy.workspace.tableRows}>
        <TableActionButton
          label={copy.workspace.addRowAbove}
          onClick={() => run(() => editor.chain().focus().addRowBefore().run())}
        >
          <PanelTop />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.addRowBelow}
          onClick={() => run(() => editor.chain().focus().addRowAfter().run())}
        >
          <PanelBottom />
        </TableActionButton>
        <TableActionButton
          destructive
          label={copy.workspace.deleteRow}
          onClick={() => run(() => editor.chain().focus().deleteRow().run())}
        >
          <Trash2 />
        </TableActionButton>
      </TableToolbarGroup>

      <TableToolbarGroup label={copy.workspace.tableColumns}>
        <TableActionButton
          label={copy.workspace.addColumnBefore}
          onClick={() =>
            run(() => editor.chain().focus().addColumnBefore().run())
          }
        >
          <PanelLeft />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.addColumnAfter}
          onClick={() =>
            run(() => editor.chain().focus().addColumnAfter().run())
          }
        >
          <PanelRight />
        </TableActionButton>
        <TableActionButton
          destructive
          label={copy.workspace.deleteColumn}
          onClick={() => run(() => editor.chain().focus().deleteColumn().run())}
        >
          <Trash2 />
        </TableActionButton>
      </TableToolbarGroup>

      <TableToolbarGroup label={copy.workspace.tableTools}>
        <TableActionButton
          label={copy.workspace.mergeCells}
          onClick={() => run(() => editor.chain().focus().mergeCells().run())}
        >
          <TableCellsMerge />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.splitCell}
          onClick={() => run(() => editor.chain().focus().splitCell().run())}
        >
          <TableCellsSplit />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.toggleHeaderRow}
          onClick={() =>
            run(() => editor.chain().focus().toggleHeaderRow().run())
          }
        >
          <Table2 />
        </TableActionButton>
        <TableActionButton
          destructive
          label={copy.workspace.deleteTable}
          onClick={() => run(() => editor.chain().focus().deleteTable().run())}
        >
          <Trash2 />
        </TableActionButton>
      </TableToolbarGroup>

      <TableToolbarGroup label={copy.workspace.tableBorders}>
        <TableActionButton
          active={borderMode === 'draw'}
          label={copy.workspace.drawBorders}
          onClick={() => setBorderMode('draw')}
        >
          <Pencil />
        </TableActionButton>
        <TableActionButton
          active={borderMode === 'erase'}
          label={copy.workspace.eraseBorders}
          onClick={() => setBorderMode('erase')}
        >
          <Eraser />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.borderAll}
          onClick={() => applyBorders('all')}
        >
          <Table2 />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.borderOuter}
          onClick={() => applyBorders('outer')}
        >
          <Square />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.borderInner}
          onClick={() => applyBorders('inner')}
        >
          <TableCellsSplit />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.borderTop}
          onClick={() => applyBorders('top')}
        >
          <PanelTop />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.borderRight}
          onClick={() => applyBorders('right')}
        >
          <PanelRight />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.borderBottom}
          onClick={() => applyBorders('bottom')}
        >
          <PanelBottom />
        </TableActionButton>
        <TableActionButton
          label={copy.workspace.borderLeft}
          onClick={() => applyBorders('left')}
        >
          <PanelLeft />
        </TableActionButton>
        <label
          className="table-toolbar-color"
          title={copy.workspace.borderColor}
        >
          <span className="sr-only">{copy.workspace.borderColor}</span>
          <input
            aria-label={copy.workspace.borderColor}
            type="color"
            value={borderColor}
            onChange={(event) => setBorderColor(event.target.value)}
          />
        </label>
        <select
          aria-label={copy.workspace.borderStyle}
          className="table-toolbar-select"
          value={borderStyle}
          onChange={(event) =>
            setBorderStyle(event.target.value as TableBorderStyle)
          }
        >
          <option value="solid">{copy.workspace.borderSolid}</option>
          <option value="dashed">{copy.workspace.borderDashed}</option>
          <option value="dotted">{copy.workspace.borderDotted}</option>
          <option value="double">{copy.workspace.borderDouble}</option>
        </select>
        <select
          aria-label={copy.workspace.borderWidth}
          className="table-toolbar-select table-toolbar-width"
          value={borderWidth}
          onChange={(event) =>
            setBorderWidth(Number(event.target.value) as TableBorderWidth)
          }
        >
          <option value="1">{copy.workspace.borderThin}</option>
          <option value="2">{copy.workspace.borderMedium}</option>
          <option value="3">{copy.workspace.borderThick}</option>
        </select>
      </TableToolbarGroup>
    </div>
  );
}
