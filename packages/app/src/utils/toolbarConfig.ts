/** toolbarConfig — 格式工具栏配置 @see migration-map.md §6 */
import { translate } from '@/i18n';

export interface ToolbarItemConfig {
  type: string;
  icon: string;
  label: string;
  shortcut: string;
  kind?: 'inline' | 'block' | 'special';
}

export function getDefaultToolbarItems(): ToolbarItemConfig[] {
  return [
    {
      type: 'bold',
      icon: 'B',
      label: translate('editor.toolbar.bold'),
      shortcut: 'Ctrl+B',
      kind: 'inline',
    },
    {
      type: 'italic',
      icon: 'I',
      label: translate('editor.toolbar.italic'),
      shortcut: 'Ctrl+I',
      kind: 'inline',
    },
    {
      type: 'strikethrough',
      icon: 'S',
      label: translate('editor.toolbar.strikethrough'),
      shortcut: 'Ctrl+Shift+S',
      kind: 'inline',
    },
    {
      type: 'inlineCode',
      icon: '</>',
      label: translate('editor.toolbar.inlineCode'),
      shortcut: 'Ctrl+`',
      kind: 'inline',
    },
    {
      type: 'link',
      icon: '🔗',
      label: translate('editor.toolbar.link'),
      shortcut: 'Ctrl+K',
      kind: 'inline',
    },
    {
      type: 'heading',
      icon: 'H',
      label: translate('cheatSheet.headings'),
      shortcut: 'Ctrl+1-6',
      kind: 'block',
    },
    {
      type: 'unorderedList',
      icon: '•',
      label: translate('cheatSheet.unordered'),
      shortcut: 'Ctrl+Shift+U',
      kind: 'block',
    },
    {
      type: 'orderedList',
      icon: '1.',
      label: translate('cheatSheet.ordered'),
      shortcut: 'Ctrl+Shift+O',
      kind: 'block',
    },
    {
      type: 'taskList',
      icon: '☑',
      label: translate('cheatSheet.task'),
      shortcut: 'Ctrl+Shift+T',
      kind: 'block',
    },
    {
      type: 'blockquote',
      icon: '"',
      label: translate('editor.toolbar.blockquote'),
      shortcut: 'Ctrl+Shift+Q',
      kind: 'block',
    },
    {
      type: 'codeBlock',
      icon: '{ }',
      label: translate('cheatSheet.codeBlock'),
      shortcut: 'Ctrl+Shift+C',
      kind: 'block',
    },
    {
      type: 'horizontalRule',
      icon: '—',
      label: translate('program.horizontalRule'),
      shortcut: 'Ctrl+Shift+H',
      kind: 'block',
    },
  ];
}
