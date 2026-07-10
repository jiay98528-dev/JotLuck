// ============================================================
// JotLuck — Export & Share Type Definitions
// ============================================================

/**
 * Supported export file formats.
 */
export enum ExportFormat {
  PDF = 'pdf',
  DOCX = 'docx',
  XLSX = 'xlsx',
  CSV = 'csv',
  TXT = 'txt',
  HTML = 'html',
  MD = 'md',
}

/**
 * Options controlling the content and presentation of an export.
 */
export interface ExportOptions {
  /** Target file format. */
  format: ExportFormat;

  /** Whether to include YAML / TOML frontmatter in the export. */
  includeFrontmatter: boolean;

  /** Whether to preserve and render wiki-style [[links]]. */
  includeWikiLinks: boolean;

  /** Whether to render line numbers alongside code blocks. */
  codeLineNumbers: boolean;

  /**
   * Strategy for handling embedded images.
   * - 'embed'   : inline as base64 data URIs
   * - 'attach'  : bundle as separate files alongside the output
   * - 'link'    : leave as external URL references
   * - 'omit'    : strip images entirely
   */
  imageHandling: 'embed' | 'attach' | 'link' | 'omit';
}

/**
 * Channels through which an exported document can be shared.
 */
export enum ShareChannel {
  SYSTEM_SHARE = 'system_share',
  EMAIL = 'email',
  CLIPBOARD = 'clipboard',
  LOCAL_EXPORT = 'local_export',
}

/**
 * Describes how and where an export should be shared.
 */
export interface ShareOptions {
  /** The file format to export before sharing. */
  format: ExportFormat;

  /** The target distribution channel. */
  channel: ShareChannel;
}

/**
 * Result returned after an export operation completes.
 */
export interface ExportResult {
  /** Whether the export succeeded without errors. */
  success: boolean;

  /** Absolute path to the exported file (present on success). */
  filePath?: string;

  /** Human-readable error description (present on failure). */
  error?: string;
}
