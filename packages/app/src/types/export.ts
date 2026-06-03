// ============================================================
// MarkLuck — Export & Share Types
// ============================================================
// Source: spec/types/export.ts

/** Supported export file formats */
export enum ExportFormat {
  PDF = 'pdf',
  DOCX = 'docx',
  XLSX = 'xlsx',
  CSV = 'csv',
  TXT = 'txt',
  HTML = 'html',
  MD = 'md',
}

/** Options controlling the content and presentation of an export */
export interface ExportOptions {
  format: ExportFormat;
  includeFrontmatter: boolean;
  includeWikiLinks: boolean;
  codeLineNumbers: boolean;
  imageHandling: 'embed' | 'attach' | 'link' | 'omit';
}

/** Channels through which an exported document can be shared */
export enum ShareChannel {
  SYSTEM_SHARE = 'system_share',
  EMAIL = 'email',
  CLIPBOARD = 'clipboard',
  LOCAL_EXPORT = 'local_export',
}

/** Describes how and where an export should be shared */
export interface ShareOptions {
  format: ExportFormat;
  channel: ShareChannel;
}

/** Result returned after an export operation completes */
export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}
