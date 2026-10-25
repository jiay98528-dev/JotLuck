import { describe, expect, it } from 'vitest';
import { resetStaticPreviewScroll } from '../static-preview-scroll';

/**
 * 静态 v-html 预览切笔记滚动复位（E6）：读视图滚容器 .reader-workbench 与
 * 分栏滚容器 .split-preview 自身复用不重建，切笔记须复位 scrollTop（渐进
 * 路径 keyed 重挂载天然回顶，静态路径对齐该行为）。
 */
describe('resetStaticPreviewScroll', () => {
  it('两个滚容器复位到顶部；空容器安全 no-op', () => {
    const workbench = document.createElement('div');
    const split = document.createElement('div');
    workbench.scrollTop = 480;
    split.scrollTop = 260;

    resetStaticPreviewScroll(workbench, split);

    expect(workbench.scrollTop).toBe(0);
    expect(split.scrollTop).toBe(0);

    expect(() => resetStaticPreviewScroll(null, null)).not.toThrow();
  });

  it('单侧容器缺失只复位存在的一侧', () => {
    const split = document.createElement('div');
    split.scrollTop = 120;

    resetStaticPreviewScroll(null, split);

    expect(split.scrollTop).toBe(0);
  });
});
