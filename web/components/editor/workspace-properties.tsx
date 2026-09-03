'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useAppPreferences } from '@/components/app-preferences';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { documentTitle, type DocumentData } from '@/src/document/model';
import {
  documentThemes,
  documentFlags,
  resolveDocumentTheme,
  type DocumentFlag,
} from '@/src/document/metadata';
import {
  labelPattern,
  type DocumentAnalysis,
  type SemanticNode,
} from '@/src/document/semantics';
import { localizeDiagnosticMessage } from '@/src/i18n/diagnostics';
import type { DisplayedWorkspaceStatus } from '@/src/workspace/status';
import type { SelectedNode } from './use-document-selection';
import { SemanticProperties } from './semantic-properties';

interface WorkspacePropertiesProps {
  overlay?: boolean;
  idPrefix?: string;
  document: DocumentData;
  editor: Editor | null;
  documentWriteLocked: boolean;
  analysis: DocumentAnalysis;
  selectedNode: SelectedNode | null;
  selectedSemantic?: SemanticNode;
  mathDraft: string;
  setMathDraft: (value: string) => void;
  applyMath: () => void;
  applyAttributes: (nodeId: string, attrs: Record<string, unknown>) => void;
  updateTheme: (theme: string) => void;
  updateDocumentFlag: (flag: DocumentFlag, checked: boolean) => void;
  displayedStatus: DisplayedWorkspaceStatus;
  dirty: boolean;
}

export function WorkspaceProperties({
  overlay = false,
  idPrefix = 'workspace',
  document,
  editor,
  documentWriteLocked,
  analysis,
  selectedNode,
  selectedSemantic,
  mathDraft,
  setMathDraft,
  applyMath,
  applyAttributes,
  updateTheme,
  updateDocumentFlag,
  displayedStatus,
  dirty,
}: WorkspacePropertiesProps) {
  const { copy, locale } = useAppPreferences();
  const [referenceTarget, setReferenceTarget] = useState('');
  const referenceTargetId = `${idPrefix}-reference-target`;
  const mathLatexId = `${idPrefix}-math-latex`;
  const themeOptions = documentThemes[document.type];
  const flagLabels: Record<DocumentFlag, string> = {
    toc: copy.workspace.toc,
    number_sections: copy.workspace.sectionNumbers,
    slide_number: copy.workspace.slideNumbers,
  };
  const flagOptions = documentFlags
    .filter((key) => key !== 'slide_number' || document.type === 'slide')
    .map((key) => [key, flagLabels[key]] as const);
  const [selectElementTitle, selectElementDescription] =
    copy.workspace.selectElementHint.split('\n');
  return (
    <aside
      className={`workspace-properties${overlay ? ' workspace-side-sheet' : ''}`}
    >
      <div className="panel-heading">
        <span>{copy.workspace.propertiesPanel}</span>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <section>
            <h2 className="mb-3 text-xs font-semibold">
              {copy.workspace.document}
            </h2>
            <dl className="property-grid">
              <dt>{copy.workspace.type}</dt>
              <dd>
                {document.type === 'report'
                  ? copy.workspace.report
                  : copy.workspace.slide}
              </dd>
              <dt>{copy.workspace.title}</dt>
              <dd className="truncate" title={documentTitle(document)}>
                {documentTitle(document)}
              </dd>
              <dt>{copy.workspace.theme}</dt>
              <dd>
                <NativeSelect
                  aria-label={copy.workspace.theme}
                  size="sm"
                  className="w-full"
                  disabled={documentWriteLocked}
                  value={resolveDocumentTheme(
                    document.type,
                    document.metadata.theme,
                  )}
                  onChange={(event) => updateTheme(event.target.value)}
                >
                  {themeOptions.map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </dd>
            </dl>
            <div className="mt-3 space-y-2">
              {flagOptions.map(([key, title]) => (
                <label key={key} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={
                      key === 'slide_number'
                        ? document.metadata[key] !== false
                        : document.metadata[key] === true
                    }
                    disabled={documentWriteLocked}
                    onChange={(event) =>
                      updateDocumentFlag(key, event.target.checked)
                    }
                  />
                  {title}
                </label>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <label className="property-field" htmlFor={referenceTargetId}>
                {copy.workspace.referenceLabel}
                <Input
                  aria-label={copy.workspace.referenceLabel}
                  id={referenceTargetId}
                  value={referenceTarget}
                  disabled={documentWriteLocked}
                  onChange={(event) => setReferenceTarget(event.target.value)}
                  placeholder="fig:response"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  documentWriteLocked || !labelPattern.test(referenceTarget)
                }
                onClick={() =>
                  editor
                    ?.chain()
                    .focus()
                    .insertContent({
                      type: 'reference',
                      attrs: { target: referenceTarget },
                    })
                    .run()
                }
              >
                {copy.workspace.insertReference}
              </Button>
              <p className="text-[10px] text-muted-foreground">
                {copy.workspace.available}:{' '}
                {[...analysis.labels.keys()].join(', ') ||
                  copy.workspace.noReferenceLabels}
              </p>
            </div>
            {analysis.diagnostics.length > 0 && (
              <div
                className="semantic-warnings mt-3"
                aria-label={copy.workspace.referenceDiagnostics}
              >
                {analysis.diagnostics.map((message) => (
                  <p key={message}>
                    {localizeDiagnosticMessage(message, locale)}
                  </p>
                ))}
              </div>
            )}
          </section>

          <Separator />

          <section>
            <h2 className="mb-3 text-xs font-semibold">
              {copy.workspace.selectedElement}
            </h2>
            {selectedNode ? (
              <div className="space-y-3">
                <Badge variant="secondary">{selectedNode.type}</Badge>
                {selectedNode.nodeId && (
                  <p className="break-all font-mono text-[10px] text-muted-foreground">
                    {selectedNode.nodeId}
                  </p>
                )}
                {(selectedNode.type === 'inlineMath' ||
                  selectedNode.type === 'blockMath') && (
                  <div className="space-y-2">
                    <label
                      htmlFor={mathLatexId}
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      LaTeX
                    </label>
                    <Textarea
                      id={mathLatexId}
                      className="min-h-24 font-mono text-xs"
                      disabled={documentWriteLocked}
                      value={mathDraft}
                      onChange={(event) => setMathDraft(event.target.value)}
                    />
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={documentWriteLocked}
                      onClick={applyMath}
                    >
                      {copy.workspace.updateEquation}
                    </Button>
                  </div>
                )}
                {selectedSemantic && (
                  <SemanticProperties
                    key={`${selectedSemantic.attrs.nodeId}:${JSON.stringify(selectedSemantic.attrs)}`}
                    node={selectedSemantic}
                    disabled={documentWriteLocked}
                    onApply={applyAttributes}
                  />
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed bg-muted/35 p-4 text-center">
                <p className="text-[11px] text-muted-foreground">
                  {selectElementTitle}
                  <br />
                  {selectElementDescription}
                </p>
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
      <output
        aria-live="polite"
        className="border-t px-3 py-2 text-[10px] text-muted-foreground"
      >
        <span
          className={`inline-block size-1.5 rounded-full ${
            displayedStatus.kind === 'error'
              ? 'bg-red-500'
              : dirty
                ? 'bg-amber-500'
                : 'bg-emerald-500'
          }`}
        />
        <span className="ml-2">{displayedStatus.title}</span>
        {displayedStatus.description && (
          <span
            className="ml-1 block truncate"
            title={displayedStatus.description}
          >
            {displayedStatus.description}
          </span>
        )}
      </output>
    </aside>
  );
}
