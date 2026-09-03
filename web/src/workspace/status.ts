import type { AppLocale, UiMessages } from '@/src/i18n/messages';
import {
  localizeDiagnosticMessage,
  localizeMarkdownDiagnostic,
} from '@/src/i18n/diagnostics';
import {
  MarkdownImportError,
  type MarkdownDiagnostic,
} from '@/src/markdown/diagnostics';
import { MarkdownSerializationError } from '@/src/markdown/serializer';
import { DocumentValidationError } from '@/src/document/validation';
import { ReportProjectError } from '@/src/project/model';

type ProjectStatusKey = keyof UiMessages['project']['status'];

interface ProjectStatusMessage {
  projectKey: ProjectStatusKey;
  detail?: string;
}

export function projectStatus(
  projectKey: ProjectStatusKey,
  detail?: string,
): ProjectStatusMessage {
  return { projectKey, detail };
}

export type StatusMessageKey = keyof UiMessages['status'];

interface TranslationStatusMessage {
  key: StatusMessageKey;
  args?: readonly string[];
}

interface DiagnosticStatusMessage {
  diagnostic: Pick<MarkdownDiagnostic, 'code' | 'message'>;
}

export type StatusMessage =
  | string
  | TranslationStatusMessage
  | ProjectStatusMessage
  | DiagnosticStatusMessage;
export type StatusDescription = StatusMessage | readonly StatusMessage[];

export interface WorkspaceStatus {
  kind: 'idle' | 'success' | 'error';
  title: StatusMessage;
  description?: StatusDescription;
}

export interface DisplayedWorkspaceStatus {
  kind: WorkspaceStatus['kind'];
  title: string;
  description?: string;
}

export function statusMessage(
  key: StatusMessageKey,
  ...args: string[]
): TranslationStatusMessage {
  return args.length > 0 ? { key, args } : { key };
}

export function diagnosticStatusMessage(
  diagnostic: Pick<MarkdownDiagnostic, 'code' | 'message'>,
): DiagnosticStatusMessage {
  return { diagnostic };
}

export class WorkspaceStatusError extends Error {
  constructor(readonly status: StatusMessage) {
    super('A localized workspace status is available.');
  }
}

export function statusMessageText(
  value: StatusMessage,
  copy: UiMessages,
  locale: AppLocale,
): string {
  if (typeof value === 'string')
    return localizeDiagnosticMessage(value, locale);
  if ('diagnostic' in value)
    return localizeMarkdownDiagnostic(value.diagnostic, locale);
  if ('projectKey' in value) {
    const translation = copy.project.status[value.projectKey];
    return typeof translation === 'function'
      ? translation(value.detail ?? '')
      : translation;
  }

  const translation = copy.status[value.key];
  return typeof translation === 'function'
    ? translation(value.args?.[0] ?? '')
    : translation;
}

function statusMessages(value: StatusDescription | undefined): StatusMessage[] {
  if (!value) return [];
  return Array.isArray(value) ? [...value] : [value as StatusMessage];
}

export function statusDescriptionText(
  value: StatusDescription | undefined,
  copy: UiMessages,
  locale: AppLocale,
): string | undefined {
  const messages = statusMessages(value)
    .map((message) => statusMessageText(message, copy, locale))
    .filter(Boolean);
  return messages.length > 0 ? messages.join(' / ') : undefined;
}

export function combinedStatusDescription(
  ...values: Array<StatusDescription | undefined>
): StatusDescription | undefined {
  const messages = values.flatMap(statusMessages);
  return messages.length > 0 ? messages : undefined;
}

/** Retain structured diagnostics until render so changing the locale also updates errors. */
export function describeWorkspaceError(
  error: unknown,
  fallback: StatusMessageKey,
): StatusDescription {
  if (error instanceof WorkspaceStatusError) return error.status;
  if (error instanceof ReportProjectError)
    return projectStatus(error.code, error.detail);
  if (error instanceof MarkdownImportError)
    return error.diagnostics.map(diagnosticStatusMessage);
  if (error instanceof MarkdownSerializationError)
    return [
      diagnosticStatusMessage(error),
      statusMessage('markdownUnsupported'),
    ];
  if (error instanceof DocumentValidationError)
    return [error.message, statusMessage('invalidDocumentData')];
  return error instanceof Error ? error.message : statusMessage(fallback);
}
