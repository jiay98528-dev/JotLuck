/**
 * 行内迷你标记解析：主题预览 SVG 文案里的 [[wikilink]] 与 #tag。
 * 与软件语法的对应关系是有意的品牌细节——文案串里直接写软件语法。
 */

export interface InlineSegment {
  text: string;
  kind: 'text' | 'wiki' | 'tag';
}

export function parseInlineMarks(src: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const pattern = /\[\[([^\]]+)\]\]|(#[\w-]+)/g;
  let last = 0;
  for (const match of src.matchAll(pattern)) {
    if (match.index > last) {
      segments.push({ text: src.slice(last, match.index), kind: 'text' });
    }
    if (match[1] !== undefined) {
      segments.push({ text: match[1], kind: 'wiki' });
    } else {
      // 语法符号隐藏：#tag 渲染为着色 "tag"，与 [[wikilink]] 隐藏括号一致（实时预览语义）
      segments.push({ text: (match[2] as string).slice(1), kind: 'tag' });
    }
    last = match.index + match[0].length;
  }
  if (last < src.length) {
    segments.push({ text: src.slice(last), kind: 'text' });
  }
  return segments;
}

/** 估算宽度单位：CJK 全宽记 2，其余记 ~1.05（SVG 定宽排版换行用） */
export function widthUnits(src: string): number {
  let units = 0;
  for (const ch of src) {
    units += /[ᄀ-ᄿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 2 : 1.05;
  }
  return units;
}

/**
 * 贪心换行：拉丁优先在空格断词（词尾不超过行宽 45% 时），
 * 否则就地断字（CJK 无空格长串因此填满行而不留孤词行）。
 * budget 以宽度单位计（≈ 全宽字符数 × 2）。
 */
export function wrapText(src: string, budget: number): string[] {
  const lines: string[] = [];
  let line = '';
  let lastSpace = -1;
  for (const ch of src) {
    line += ch;
    if (ch === ' ') lastSpace = line.length - 1;
    if (widthUnits(line) > budget) {
      const tailUnits = lastSpace >= 0 ? widthUnits(line.slice(lastSpace + 1)) : Number.MAX_VALUE;
      if (lastSpace > 0 && tailUnits <= budget * 0.45) {
        lines.push(line.slice(0, lastSpace).trimEnd());
        line = line.slice(lastSpace + 1).trimStart();
      } else {
        lines.push(line.slice(0, -1).trimEnd());
        line = ch.trim() ? ch : '';
      }
      lastSpace = line.indexOf(' ');
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.filter(Boolean);
}
