/** toolbarConfig — 格式工具栏配置 @see migration-map.md §6 */
export interface ToolbarItemConfig {
  type: string;
  icon: string;
  label: string;
  shortcut: string;
  kind?: 'inline' | 'block' | 'special';
}

export const DEFAULT_TOOLBAR_ITEMS: ToolbarItemConfig[] = [
  { type: 'bold', icon: 'B', label: '加粗', shortcut: 'Ctrl+B', kind: 'inline' },
  { type: 'italic', icon: 'I', label: '斜体', shortcut: 'Ctrl+I', kind: 'inline' },
  { type: 'strikethrough', icon: 'S', label: '删除线', shortcut: 'Ctrl+Shift+S', kind: 'inline' },
  { type: 'inlineCode', icon: '</>', label: '行内代码', shortcut: 'Ctrl+`', kind: 'inline' },
  { type: 'link', icon: '🔗', label: '链接', shortcut: 'Ctrl+K', kind: 'inline' },
  { type: 'heading', icon: 'H', label: '标题', shortcut: 'Ctrl+1-6', kind: 'block' },
  { type: 'unorderedList', icon: '•', label: '无序列表', shortcut: 'Ctrl+Shift+U', kind: 'block' },
  { type: 'orderedList', icon: '1.', label: '有序列表', shortcut: 'Ctrl+Shift+O', kind: 'block' },
  { type: 'taskList', icon: '☑', label: '任务列表', shortcut: 'Ctrl+Shift+T', kind: 'block' },
  { type: 'blockquote', icon: '"', label: '引用', shortcut: 'Ctrl+Shift+Q', kind: 'block' },
  { type: 'codeBlock', icon: '{ }', label: '代码块', shortcut: 'Ctrl+Shift+C', kind: 'block' },
  { type: 'horizontalRule', icon: '—', label: '分割线', shortcut: 'Ctrl+Shift+H', kind: 'block' },
];
