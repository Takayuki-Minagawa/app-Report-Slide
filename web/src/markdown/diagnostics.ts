export type DiagnosticSeverity = 'warning' | 'error';

export interface MarkdownDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export class MarkdownImportError extends Error {
  readonly diagnostics: MarkdownDiagnostic[];

  constructor(message: string, diagnostics: MarkdownDiagnostic[]) {
    super(message);
    this.name = 'MarkdownImportError';
    this.diagnostics = diagnostics;
  }
}
