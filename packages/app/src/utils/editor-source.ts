/** CodeMirror uses LF offsets; keep the on-disk string untouched until an actual edit. */
export function editorSource(source: string): string {
  return source.includes('\r') ? source.replace(/\r\n?/g, '\n') : source;
}
