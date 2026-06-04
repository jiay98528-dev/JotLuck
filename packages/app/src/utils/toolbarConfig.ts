/** Toolbar item configuration */
export interface ToolbarItemConfig {
  type: string;
  icon: string;
  label: string;
  shortcut: string;
  /** 'separator' renders a visual divider between button groups */
  kind?: 'button' | 'separator';
}

/** Default toolbar layout — three semantic groups */
export const DEFAULT_TOOLBAR_ITEMS: ToolbarItemConfig[] = [
  // Text group
  { type: 'bold', icon: 'B', label: '加粗', shortcut: 'Ctrl+B' },
  { type: 'italic', icon: 'I', label: '斜体', shortcut: 'Ctrl+I' },
  { type: 'strikethrough', icon: 'S', label: '删除线', shortcut: 'Ctrl+Shift+S' },
  // Separator
  { type: '__sep1__', icon: '', label: '', shortcut: '', kind: 'separator' },
  // Structure group
  { type: 'heading', icon: 'H', label: '标题', shortcut: 'Ctrl+1-6' },
  { type: 'unorderedList', icon: '•', label: '无序列表', shortcut: 'Ctrl+Shift+U' },
  { type: 'orderedList', icon: '1.', label: '有序列表', shortcut: 'Ctrl+Shift+O' },
  { type: 'taskList', icon: '☑', label: '任务列表', shortcut: 'Ctrl+Shift+T' },
  { type: 'blockquote', icon: '"', label: '引用', shortcut: 'Ctrl+Shift+Q' },
  // Separator
  { type: '__sep2__', icon: '', label: '', shortcut: '', kind: 'separator' },
  // Insert group
  { type: 'codeBlock', icon: '<>', label: '代码块', shortcut: 'Ctrl+Shift+C' },
  { type: 'link', icon: '🔗', label: '链接', shortcut: 'Ctrl+K' },
  { type: 'image', icon: '🖼', label: '图片', shortcut: 'Ctrl+Shift+I' },
  { type: 'horizontalRule', icon: '—', label: '分割线', shortcut: 'Ctrl+Shift+H' },
];
