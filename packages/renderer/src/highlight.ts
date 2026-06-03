/**
 * highlight.js 代码语法高亮（按需加载语言包）
 *
 * 渲染管线第三步：安全 HTML → highlightElement → 高亮 HTML
 *
 * @module highlight
 * @see TAD.md §4.4
 */

import hljs from 'highlight.js/lib/core';

// 按需注册语言包（控制 bundle 体积）
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('xml', xml);

/**
 * 对容器内所有 <pre><code> 块执行语法高亮。
 * 必须在 DOM 插入后调用（需要真实 DOM 元素）。
 */
export function highlightCodeBlocks(container: HTMLElement): void {
  container.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block as HTMLElement);
  });
}
