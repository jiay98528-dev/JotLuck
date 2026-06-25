const MARKDOWN_NOTE_EXTENSIONS = ['md', 'markdown', 'mdx'] as const;
const PLAIN_TEXT_NOTE_EXTENSIONS = ['txt'] as const;

const SUPPORTED_NOTE_EXTENSIONS = [
  ...MARKDOWN_NOTE_EXTENSIONS,
  ...PLAIN_TEXT_NOTE_EXTENSIONS,
] as const;

function extensionOf(fileName: string): string {
  const cleanName = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIndex = cleanName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === cleanName.length - 1) return '';
  return cleanName.slice(dotIndex + 1).toLowerCase();
}

export function isMarkdownLikeFile(fileName: string): boolean {
  const ext = extensionOf(fileName);
  return MARKDOWN_NOTE_EXTENSIONS.includes(ext as (typeof MARKDOWN_NOTE_EXTENSIONS)[number]);
}

export function isSupportedNoteFile(fileName: string): boolean {
  const ext = extensionOf(fileName);
  return SUPPORTED_NOTE_EXTENSIONS.includes(ext as (typeof SUPPORTED_NOTE_EXTENSIONS)[number]);
}

export function stripSupportedNoteExtension(fileName: string): string {
  return fileName.replace(/\.(?:markdown|mdx|md|txt)$/i, '');
}

export function supportedNoteExtensionsLabel(): string {
  return '.md/.markdown/.mdx/.txt';
}
