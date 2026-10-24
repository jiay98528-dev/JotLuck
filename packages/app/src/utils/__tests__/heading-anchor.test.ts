import { describe, expect, it } from 'vitest';
import { headingAnchorCandidates, findHeadingElement } from '../heading-anchor';

describe('headingAnchorCandidates 三形态候选', () => {
  it('中文标题：原文直通形态与归一形态去重合并', () => {
    // headingIdFromText('基础') === 'heading-基础'，与 prefix 形态重合 → 去重为 2 项
    expect(headingAnchorCandidates('基础')).toEqual(['基础', 'heading-基础']);
  });

  it('含空格/标点：归一形态做小写连字符化，prefix 形态保留原文', () => {
    expect(headingAnchorCandidates('A B 标题!')).toEqual([
      'A B 标题!',
      'heading-A B 标题!',
      'heading-a-b-标题',
    ]);
  });

  it('NFKC 全角：归一形态折叠全角字母，prefix 形态保留全角原文', () => {
    expect(headingAnchorCandidates('ＡＢ ｃ')).toEqual([
      'ＡＢ ｃ',
      'heading-ＡＢ ｃ',
      'heading-ab-c',
    ]);
  });

  it('空 base 落 heading 基底：纯标点原文归一为 heading-heading', () => {
    // headingIdFromText 空 base 时 normalized 落 'heading'（renderer/src/syntax.ts
    // `base || 'heading'`），再拼 heading- 前缀 → 完整 id 为 'heading-heading'
    expect(headingAnchorCandidates('!!!')).toEqual(['!!!', 'heading-!!!', 'heading-heading']);
  });

  it('百分号编码原文先解码再生成三形态', () => {
    expect(headingAnchorCandidates('%E5%9F%BA%E7%A1%80')).toEqual(['基础', 'heading-基础']);
  });

  it('非法百分号序列解码失败回退原文，不抛错', () => {
    expect(headingAnchorCandidates('50%')).toEqual(['50%', 'heading-50%', 'heading-50']);
  });

  it('空锚：候选恒空（L3——不落 heading-heading 形态与纯标点标题撞车）', () => {
    // 空 base 经 headingIdFromText 落 'heading-heading'，恰为 '## ???' 类纯标点
    // 标题的渲染 id；空锚必须恒空候选，否则误滚到该标题。
    expect(headingAnchorCandidates('')).toEqual([]);
  });
});

describe('findHeadingElement DOM 归一查找', () => {
  function containerWith(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  }

  it('形态一：手写 id 即标题原文（无前缀）可命中', () => {
    const root = containerWith('<p><span id="标题原文">文本</span></p>');
    expect(findHeadingElement(root, '标题原文')).toBe(root.querySelector('span'));
  });

  it('形态二：heading-原文 直通 id 可命中', () => {
    const root = containerWith('<h2 id="heading-基础">基础</h2>');
    expect(findHeadingElement(root, '基础')).toBe(root.querySelector('h2'));
  });

  it('形态三：归一形态 id 由含空格/标点的原文命中', () => {
    const root = containerWith('<h3 id="heading-a-b-标题">A B 标题!</h3>');
    expect(findHeadingElement(root, 'A B 标题!')).toBe(root.querySelector('h3'));
  });

  it('候选顺序保序：前一形态命中即返回，不继续尝试', () => {
    const root = containerWith('<h2 id="heading-基础">渲染标题</h2><div id="基础">手写锚点</div>');
    expect(findHeadingElement(root, '%E5%9F%BA%E7%A1%80')?.textContent).toBe('手写锚点');
  });

  it('三形态全 miss 返回 undefined', () => {
    const root = containerWith('<h2 id="heading-别的标题">别的</h2>');
    expect(findHeadingElement(root, '不存在的标题')).toBeUndefined();
  });

  it('CSS 特殊字符 id（点号）不会被当选择器语法误解析', () => {
    const root = containerWith('<h2 id="heading-v1.2">v1.2</h2>');
    expect(findHeadingElement(root, 'v1.2')).toBe(root.querySelector('h2'));
  });

  it('空锚 DOM 查找恒 miss：纯标点标题存在也不误命中（L3）', () => {
    const root = containerWith('<h2 id="heading-heading">???</h2>');
    expect(findHeadingElement(root, '')).toBeUndefined();
  });

  it('候选含孤立 CR/FF/VT：不抛错且定义为 miss（不中断点击消费）', () => {
    const root = containerWith('<h2 id="heading-别的">别的</h2>');
    // 控制字符候选直接跳过：querySelector 坏串抛错的路径被前置摘除
    expect(() => findHeadingElement(root, '标\r题')).not.toThrow();
    expect(findHeadingElement(root, '标\r题')).toBeUndefined();
    expect(() => findHeadingElement(root, '标\f题')).not.toThrow();
    expect(findHeadingElement(root, '标\f题')).toBeUndefined();
    expect(() => findHeadingElement(root, '标\u000B题')).not.toThrow();
    expect(findHeadingElement(root, '标\u000B题')).toBeUndefined();
    // 归一形态（headingIdFromText 把 \s 折叠为连字符）命中不受跳过影响
    const normalized = containerWith('<h2 id="heading-标-题">标题</h2>');
    expect(findHeadingElement(normalized, '标\r题')).toBe(normalized.querySelector('h2'));
  });
});
