/**
 * MarkLuck Stylelint 配置
 *
 * 强制 Design Token 约束：
 * 1. 禁止硬编码色值（hex/rgb/rgba/hsl），必须使用 var(--clr-*) 或 oklch()
 * 2. 允许 oklch() 作为 fallback 值（在 var() 的第二个参数中）
 * 3. 允许 .cm-* CodeMirror 内部类不受限制
 *
 * @see spec/frontend/design-system.md
 * @see tool.md §5.3 样式 Token 约束
 */

module.exports = {
  extends: ['stylelint-config-standard'],
  customSyntax: 'postcss-html',
  rules: {
    // === 禁止硬编码色值（核心规则） ===
    // 禁止 hex 颜色（#fff, #000000 等）
    'color-no-hex': true,

    // 禁止命名颜色（red, blue, white, black 等）
    'color-named': 'never',

    // 禁止 rgb() / rgba() / hsl() / hsla() 函数
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],

    // === OKLCH 语法适配 ===
    // 项目使用 oklch(L C H) 现代语法（0-1 lightness, 0-360 hue），
    // 不使用 stylelint 默认要求的百分比/度数语法
    'lightness-notation': null,
    'hue-degree-notation': null,
    'alpha-value-notation': null,

    // === BEM 命名适配 ===
    // 项目使用 BEM 风格（.block__element--modifier）
    'selector-class-pattern': null,

    // === Vue 深度选择器 ===
    'selector-pseudo-element-no-unknown': [
      true,
      { ignorePseudoElements: ['v-deep', 'deep'] },
    ],
    'selector-pseudo-class-no-unknown': [
      true,
      { ignorePseudoClasses: ['deep', 'global', 'slotted'] },
    ],
  },

  // === 排除文件 ===
  ignoreFiles: [
    'node_modules/**',
    'dist/**',
    'coverage/**',
    // 第三方 CSS（highlight.js 主题）不受限制
    'src/assets/styles/highlight/**',
    'src-tauri/**',
  ],
};
