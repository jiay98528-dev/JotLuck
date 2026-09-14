/**
 * 裸 JSON 块检测 — 定位完整的顶层 JSON 文本块，不把 fenced code 当作 JSON。
 *
 * 从 index.ts 搬移，行为字节不变。渲染管线用它把裸 JSON 包进 ```json 围栏，
 * AST 解析用它把裸 JSON 识别为独立块。
 */

export interface BareJsonBlockRange {
  startLine: number;
  endLine: number;
}

function startsBareJsonBlock(line: string): boolean {
  return /^\s*[\[{]/.test(line);
}

function updateJsonDepth(
  line: string,
  state: { depth: number; inString: boolean; escaped: boolean },
): void {
  for (const char of line) {
    if (state.escaped) {
      state.escaped = false;
      continue;
    }
    if (char === '\\' && state.inString) {
      state.escaped = true;
      continue;
    }
    if (char === '"') {
      state.inString = !state.inString;
      continue;
    }
    if (state.inString) continue;
    if (char === '{' || char === '[') state.depth++;
    else if (char === '}' || char === ']') state.depth--;
  }
}

function isJsonText(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/** Locate complete bare JSON blocks without treating fenced code as JSON. */
export function findBareJsonBlockLineRanges(source: string): BareJsonBlockRange[] {
  const lines = source.split('\n');
  const ranges: BareJsonBlockRange[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !startsBareJsonBlock(line)) {
      continue;
    }

    const candidate: string[] = [];
    const state = { depth: 0, inString: false, escaped: false };
    let end = -1;

    for (let j = i; j < lines.length; j++) {
      const current = lines[j] ?? '';
      if (j > i && /^\s*```/.test(current)) break;
      candidate.push(current);
      updateJsonDepth(current, state);
      if (state.depth < 0) break;
      if (state.depth === 0 && !state.inString) {
        const text = candidate.join('\n').trim();
        if (text && isJsonText(text)) end = j;
        break;
      }
    }

    if (end >= i) {
      ranges.push({ startLine: i, endLine: end });
      i = end;
    }
  }

  return ranges;
}

/** 渲染管线内部：把裸 JSON 块包进 ```json 围栏，使 marked 按代码块渲染。 */
export function protectBareJsonBlocks(source: string): string {
  const lines = source.split('\n');
  const ranges = findBareJsonBlockLineRanges(source);
  const starts = new Map(ranges.map((range) => [range.startLine, range]));

  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const range = starts.get(i);
    if (range) {
      output.push('```json', ...lines.slice(range.startLine, range.endLine + 1), '```');
      i = range.endLine;
    } else {
      output.push(lines[i] ?? '');
    }
  }

  return output.join('\n');
}
