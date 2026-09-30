/** toolbarConfig — 格式工具栏配置 @see migration-map.md §6 */
import { translate } from '@/i18n';

export interface ToolbarItemConfig {
  type: string;
  icon: string;
  label: string;
  kind?: 'inline' | 'block' | 'special';
}

export function getDefaultToolbarItems(): ToolbarItemConfig[] {
  return [
    {
      type: 'bold',
      icon: 'B',
      label: translate('editor.toolbar.bold'),
      kind: 'inline',
    },
    {
      type: 'italic',
      icon: 'I',
      label: translate('editor.toolbar.italic'),
      kind: 'inline',
    },
    {
      type: 'strikethrough',
      icon: 'S',
      label: translate('editor.toolbar.strikethrough'),
      kind: 'inline',
    },
    {
      type: 'inlineCode',
      icon: '</>',
      label: translate('editor.toolbar.inlineCode'),
      kind: 'inline',
    },
    {
      type: 'link',
      icon: '🔗',
      label: translate('editor.toolbar.link'),
      kind: 'inline',
    },
    {
      type: 'heading',
      icon: 'H',
      label: translate('cheatSheet.headings'),
      kind: 'block',
    },
    {
      type: 'unorderedList',
      icon: '•',
      label: translate('cheatSheet.unordered'),
      kind: 'block',
    },
    {
      type: 'orderedList',
      icon: '1.',
      label: translate('cheatSheet.ordered'),
      kind: 'block',
    },
    {
      type: 'taskList',
      icon: '☑',
      label: translate('cheatSheet.task'),
      kind: 'block',
    },
    {
      type: 'blockquote',
      icon: '"',
      label: translate('editor.toolbar.blockquote'),
      kind: 'block',
    },
    {
      type: 'codeBlock',
      icon: '{ }',
      label: translate('cheatSheet.codeBlock'),
      kind: 'block',
    },
    {
      type: 'horizontalRule',
      icon: '—',
      label: translate('program.horizontalRule'),
      kind: 'block',
    },
  ];
}
