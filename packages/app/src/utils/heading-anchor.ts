/**
 * heading-anchor — 站内标题锚点三形态归一查找
 *
 * 背景：静态渲染的标题 id 由 renderer 的 headingIdFromText 生成（恒为
 * `heading-<NFKC 归一小写连字符>` 前缀形态，空 base 落 'heading'），而
 * markdown `[x](#基础)` 的 href 是原文——原文、`heading-原文`、归一形态
 * 三者可能互不相等，跨形态逐一尝试即为本模块的失配弥合。
 */
import { headingIdFromText } from '@jotluck/renderer';

/** decodeURIComponent 失败（非法百分号序列）时回退原文，不抛错。 */
function decodeAnchorId(rawId: string): string {
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}

/**
 * 锚点 id 三形态候选（去重、按命中率排序）：
 * 1. decodeURIComponent 后的原文——命中手写 HTML 锚点（id 即标题原文）；
 * 2. `heading-${原文}`——命中标题原文未经归一即成 id 的直通形态；
 * 3. headingIdFromText(原文)——命中 NFKC 归一/去标点/连字符化的渲染形态。
 * 空锚无合法目标：''与'heading-' 形态不可能命中有效 id，且空 base 会落
 * 'heading-heading' 形态——恰与纯标点标题的渲染 id 撞车（L3），恒空返回。
 */
export function headingAnchorCandidates(rawId: string): string[] {
  if (!rawId) return [];
  const text = decodeAnchorId(rawId);
  const candidates = [text, `heading-${text}`, headingIdFromText(text)];
  return [...new Set(candidates)];
}

/** 候选含控制字符时直接跳过：querySelector 对其成坏串抛错（jsdom 与浏览器
 *  实测均如此），且渲染 id 管线（headingIdFromText）不产出控制字符——跳过
 *  即定义行为（该形态 miss），不中断点击消费。 */
const UNSAFE_CONTROL_RE = /[\u0000-\u001F\u007F\u0085\u2028\u2029]/;

/**
 * 引号内属性值选择器转义（`[id="…"]` 字符串上下文）：只需转义反斜杠、
 * 双引号与换行类字符（LF/CR/FF 十六进制 \A/\D/\C + 终结空格，覆盖孤立
 * CR/FF）。不依赖全局 CSS.escape——vitest jsdom 环境无 CSS 全局（实测
 * TypeError），且引号字符串上下文本不需要标识符级全量转义（浏览器/WebView
 * 二者均正确）。
 */
function escapeAttrValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')
    .replace(/\f/g, '\\C ');
}

/**
 * 在 root 内按候选顺序查找 id 匹配的标题元素（或任意带 id 元素），
 * 三形态全 miss 返回 undefined。空锚前置短路（无合法目标，恒 undefined）。
 */
export function findHeadingElement(root: ParentNode, rawId: string): HTMLElement | undefined {
  if (!rawId) return undefined;
  for (const candidate of headingAnchorCandidates(rawId)) {
    if (UNSAFE_CONTROL_RE.test(candidate)) continue;
    const element = root.querySelector<HTMLElement>(`[id="${escapeAttrValue(candidate)}"]`);
    if (element) return element;
  }
  return undefined;
}
