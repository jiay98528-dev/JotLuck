/** Source-positioned editing hints. Text numbering remains ordinary Markdown text. */
export interface MarkdownListMarker {
  kind: 'unordered' | 'ordered' | 'task';
  family: 'unordered' | 'ordered';
  indent: string;
  marker: string;
  delimiter?: string;
  number?: number;
  checked?: boolean;
  markerEnd: number;
  contentStart: number;
}

/** Shared by the block scanner and continuation inside quote containers. */
export function readMarkdownListMarker(line: string): MarkdownListMarker | null {
  const task = /^([ \t\u3000]*)([*+\-＊＋－])([ \t\u3000]+\[)([ xX])(\][ \t\u3000]?)/.exec(line);
  if (task) {
    const markerEnd = task[1]!.length + task[2]!.length + task[3]!.length + 2;
    return {
      kind: 'task',
      family: 'unordered',
      indent: task[1]!,
      marker: task[2]!.normalize('NFKC'),
      checked: /x/i.test(task[4]!),
      markerEnd,
      contentStart: task[0].length,
    };
  }
  // GFM 有序任务（`1. [x] foo`）：必须在普通 ordered 之前识别，避免被吞为有序项
  // （R1-C7 修复：旧路径在 ContinuationScanner 内 post-hoc 补 `[x]` 检测，但 AST 与
  // Exporter 拿不到 task kind，DOCX 输出 `1. [x] foo` 字面；TXT 残留事故同理）。
  const orderedTask = /^([ \t\u3000]*)(\d+)([.)])([ \t\u3000]+)\[([ xX])\][ \t\u3000]?/.exec(line);
  if (orderedTask) {
    const marker = orderedTask[2]!;
    const delimiter = orderedTask[3]!;
    // markerEnd 不计末尾可选空白，与有序项同口径（`markerRange` 含 `[x]` 不含尾空）
    const markerEnd =
      orderedTask[0].length -
      (orderedTask[0].endsWith(' ') ||
      orderedTask[0].endsWith('\t') ||
      orderedTask[0].endsWith('\u3000')
        ? 1
        : 0);
    return {
      kind: 'task',
      family: 'ordered',
      indent: orderedTask[1]!,
      marker,
      delimiter,
      number: Number.parseInt(marker, 10),
      checked: /x/i.test(orderedTask[5]!),
      markerEnd,
      contentStart: orderedTask[0].length,
    };
  }
  const ordered = /^([ \t\u3000]*)(\d+)([.)])([ \t\u3000]+)/.exec(line);
  if (ordered)
    return {
      kind: 'ordered',
      family: 'ordered',
      indent: ordered[1]!,
      marker: ordered[2]!,
      number: Number.parseInt(ordered[2]!, 10),
      delimiter: ordered[3]!,
      markerEnd: ordered[0].length - ordered[4]!.length,
      contentStart: ordered[0].length,
    };
  const bullet = /^([ \t\u3000]*)([*+\-＊＋－])([ \t\u3000]+)/.exec(line);
  if (!bullet) return null;
  return {
    kind: 'unordered',
    family: 'unordered',
    indent: bullet[1]!,
    marker: bullet[2]!.normalize('NFKC'),
    markerEnd: bullet[1]!.length + 1,
    contentStart: bullet[0].length,
  };
}

export interface ContinuationLine {
  kind:
    | 'unorderedListItem'
    | 'orderedListItem'
    | 'taskListItem'
    | 'blockquoteLine'
    | 'textListItem';
  markerRange: { from: number; to: number };
  /** Everything before the inner marker: outer quotes and indentation. */
  prefix: string;
  nextMarker: string | null;
  isEmpty: boolean;
}

const digits = '零一二三四五六七八九';
function chineseNumber(value: number): string {
  let text = '';
  let zero = false;
  for (const [power, suffix] of [
    [1000, '千'],
    [100, '百'],
    [10, '十'],
    [1, ''],
  ] as const) {
    const digit = Math.floor(value / power) % 10;
    if (digit) {
      if (zero) text += '零';
      text += (digit === 1 && power === 10 && !text ? '' : digits[digit]) + suffix;
      zero = false;
    } else if (text) zero = true;
  }
  return text;
}

function parseChinese(text: string): number | null {
  let value = 0;
  let digit = 0;
  for (const char of text) {
    const unit = ({ 十: 10, 百: 100, 千: 1000 } as Record<string, number>)[char];
    if (unit) {
      value += (digit || 1) * unit;
      digit = 0;
    } else digit = digits.indexOf(char);
  }
  value += digit;
  return value > 0 && value <= 9999 && chineseNumber(value) === text ? value : null;
}

const romanUnits: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];
function romanNumber(value: number): string {
  let result = '';
  for (const [unit, text] of romanUnits) {
    while (value >= unit) {
      result += text;
      value -= unit;
    }
  }
  return result;
}
function parseRoman(text: string): number | null {
  const upper = text.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(upper) || text.length > 15) return null;
  let value = 0;
  let position = 0;
  for (const [unit, token] of romanUnits) {
    while (upper.startsWith(token, position)) {
      value += unit;
      position += token.length;
    }
  }
  return value > 0 && value <= 3999 && romanNumber(value) === upper ? value : null;
}

interface TextMarker {
  length: number;
  next: string | null;
  letters?: string;
  style?: string;
}

function nextNumeral(raw: string): string | null {
  if (/^[0-9]+$/.test(raw) || /^[０-９]+$/.test(raw)) {
    const normalized = raw.normalize('NFKC');
    const next = (BigInt(normalized) + 1n).toString().padStart(normalized.length, '0');
    return /[０-９]/.test(raw)
      ? next.replace(/\d/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0))
      : next;
  }
  const chinese = parseChinese(raw);
  return chinese !== null && chinese < 9999 ? chineseNumber(chinese + 1) : null;
}

const NUMERAL = '(?:[0-9]+|[０-９]+|[零一二三四五六七八九十百千]+)';
const TEXT_NUMBER = new RegExp(
  `^(?:(${NUMERAL})(、)|\\((${NUMERAL})\\)|（(${NUMERAL})）)([ \\t\\u3000]*)`,
);

function readTextMarker(text: string): TextMarker | null {
  const number = TEXT_NUMBER.exec(text);
  if (number) {
    const raw = number[1] ?? number[3] ?? number[4]!;
    if (!/^[0-9０-９]+$/.test(raw) && parseChinese(raw) === null) return null;
    const next = nextNumeral(raw);
    return { length: number[0].length, next: next === null ? null : number[0].replace(raw, next) };
  }
  // Fullwidth decimal markers remain text; standard ASCII Markdown is handled above.
  const wide = /^([0-9０-９]+)([.．)）])([ \t\u3000]+)/.exec(text);
  if (wide) {
    const next = nextNumeral(wide[1]!);
    return { length: wide[0].length, next: next === null ? null : next + wide[2]! + wide[3]! };
  }
  const circle = /^([①-⑳])([ \t\u3000]*)/.exec(text);
  if (circle)
    return {
      length: circle[0].length,
      next:
        circle[1] === '⑳' ? null : String.fromCharCode(circle[1]!.charCodeAt(0) + 1) + circle[2]!,
    };
  const bullet = /^[•·●○▪■][ \t\u3000]+/.exec(text);
  if (bullet) return { length: bullet[0].length, next: bullet[0] };
  const letters = /^([a-z]+|[A-Z]+)([.)])([ \t\u3000]+)/.exec(text);
  if (letters && (letters[1]!.length === 1 || parseRoman(letters[1]!) !== null))
    return {
      length: letters[0].length,
      next: null,
      letters: letters[1]!,
      style: letters[2]! + letters[3]!,
    };
  return null;
}

function confirmedLetters(previous: TextMarker, current: TextMarker): string | null | false {
  const before = previous.letters!;
  const now = current.letters!;
  if (
    previous.style !== current.style ||
    (before === before.toUpperCase()) !== (now === now.toUpperCase())
  )
    return false;
  const oldRoman = parseRoman(before);
  const newRoman = parseRoman(now);
  if (oldRoman !== null && newRoman === oldRoman + 1) {
    if (newRoman === 3999) return null;
    const next = romanNumber(newRoman + 1);
    return (now === now.toLowerCase() ? next.toLowerCase() : next) + current.style;
  }
  if (before.length === 1 && now.length === 1 && now.charCodeAt(0) === before.charCodeAt(0) + 1)
    return /[zZ]/.test(now) ? null : String.fromCharCode(now.charCodeAt(0) + 1) + current.style;
  return false;
}

function columns(text: string): number {
  let width = 0;
  for (const char of text) width += char === '\t' ? 4 - (width % 4) : 1;
  return width;
}
function normalizeQuotes(prefix: string): string {
  return prefix.replace(/＞[ \u3000]?/g, '> ');
}

/** One streaming pass alongside the shared AST scanner; no rendering or document re-parse. */
export class ContinuationScanner {
  private fence: { char: string; length: number; depth: number; indent: number } | null = null;
  private lists: Array<{ indent: number; content: number }> = [];
  private depth = 0;
  private previous: { marker: TextMarker; scope: string } | null = null;

  scan(line: string, from: number, blockType: string): ContinuationLine | undefined {
    const prior = this.previous;
    this.previous = null;
    if (!['paragraph', 'listItem', 'blockquote', 'blank'].includes(blockType)) {
      this.fence = null;
      this.lists = [];
      return;
    }
    let quote = /^([ \t\u3000]{0,3})((?:[>＞][ \u3000]?)+)/.exec(line);
    // A quoted-looking string inside fenced code is not a new container.
    if (this.fence) {
      const depth = this.fence.depth;
      if (depth === 0) quote = null;
      else {
        const outer = new RegExp(`^([ \\t\\u3000]{0,3})((?:[>＞][ \\u3000]?){${depth}})`).exec(
          line,
        );
        if (outer) quote = outer;
      }
    }
    const quoteEnd = quote?.[0].length ?? 0;
    const depth = quote ? quote[2]!.replace(/[^>＞]/g, '').length : 0;
    if (depth !== this.depth) {
      this.lists = [];
      this.fence = null;
      this.depth = depth;
    }
    const body = line.slice(quoteEnd);
    const indent = /^[ \t\u3000]*/.exec(body)![0];
    const width = columns(indent);
    const content = body.slice(indent.length);
    if (this.fence) {
      const fence = this.fence;
      if (body.trim() && width < fence.indent) {
        this.fence = null;
        // Re-read outer markers now that they are no longer literal fence text.
        return this.scan(line, from, blockType);
      } else {
        const close = /^([`~｀～]{3,})[ \t\u3000]*$/.exec(content);
        if (
          close &&
          width <= fence.indent + 3 &&
          close[1]!
            .normalize('NFKC')
            .split('')
            .every((char) => char === fence.char) &&
          close[1]!.length >= fence.length
        )
          this.fence = null;
        return;
      }
    }
    if (!content) return this.quoteLine(line, from, quoteEnd, quote);
    while (this.lists.length && width < this.lists[this.lists.length - 1]!.content)
      this.lists.pop();
    const parentIndent = this.lists[this.lists.length - 1]?.content ?? 0;
    if (width >= parentIndent + 4) return; // Indented code, including code inside a list/quote.
    const markdown = readMarkdownListMarker(body);
    // 有序项后跟 `[x]` 已被 readMarkdownListMarker 直接识别为 task；
    // 此处仅对「普通有序项（非 task）」保留 post-hoc 探测以维持非空哨兵（保持行为兼容）。
    const task =
      markdown?.kind === 'ordered'
        ? /^\[[ xX]\][ \t\u3000]?/.exec(body.slice(markdown.contentStart))
        : null;
    // 有序任务的 contentStart 含 `[x] `，而围栏锚点与列表栈沿用「标记后内容列」
    // （旧有序路径语义）——否则围栏 dedent 退出与嵌套缩进判断会漂移
    // （回归：`2. [x] ``` ` 的围栏锚点从列 3 变 7，缩进行误判为离开围栏）。
    const markerContentCol =
      markdown?.kind === 'task' && markdown.family === 'ordered'
        ? columns(
            body.slice(
              0,
              markdown.indent.length +
                markdown.marker.length +
                (markdown.delimiter ?? '.').length +
                1,
            ),
          )
        : undefined;
    const markerCol =
      markerContentCol ?? (markdown ? columns(body.slice(0, markdown.contentStart)) : 0);
    const fenceBody = markdown
      ? body.slice(markdown.contentStart + (task?.[0].length ?? 0))
      : content;
    const open = /^([`~｀～]{3,})(.*)$/.exec(fenceBody);
    if (open) {
      const marks = open[1]!.normalize('NFKC');
      if (/^(`+|~+)$/.test(marks) && !(marks[0] === '`' && /[`｀]/.test(open[2]!))) {
        this.fence = {
          char: marks[0]!,
          length: marks.length,
          depth,
          indent: markdown ? markerCol : parentIndent,
        };
        return;
      }
    }
    if (markdown) {
      const contentStart = markdown.contentStart + (task?.[0].length ?? 0);
      // 有序任务（readMarkdownListMarker 已吞 `[x]`）续行 = number+1 + `[ ] `；
      // 普通有序项（无 `[x]`）续行 = number+1；有序项 post-hoc 命中 `[x]` = number+1 + `[ ] `；
      // 无序任务续行 = bullet + `[ ] `；普通无序续行 = bullet。
      let next: string;
      if (markdown.kind === 'task' && markdown.number !== undefined) {
        next = `${BigInt(markdown.marker) + 1n}${markdown.delimiter} [ ] `;
      } else if (markdown.kind === 'ordered') {
        next = `${BigInt(markdown.marker) + 1n}${markdown.delimiter} ` + (task ? '[ ] ' : '');
      } else if (markdown.kind === 'task') {
        next = `${markdown.marker} [ ] `;
      } else {
        next = `${markdown.marker} `;
      }
      this.lists.push({ indent: width, content: markerCol });
      return {
        kind:
          markdown.kind === 'task' || task
            ? 'taskListItem'
            : markdown.kind === 'ordered'
              ? 'orderedListItem'
              : 'unorderedListItem',
        markerRange: { from: from + quoteEnd + indent.length, to: from + quoteEnd + contentStart },
        prefix: normalizeQuotes(line.slice(0, quoteEnd)) + indent,
        nextMarker: next,
        isEmpty: !body.slice(contentStart).trim(),
      };
    }
    const marker = readTextMarker(content);
    if (marker) {
      const scope = `${depth}:${indent}`;
      if (marker.letters) {
        if (content.slice(marker.length).trim()) this.previous = { marker, scope };
        const confirmed =
          prior?.marker.letters && prior.scope === scope
            ? confirmedLetters(prior.marker, marker)
            : false;
        if (confirmed === false) return this.quoteLine(line, from, quoteEnd, quote);
        marker.next = confirmed;
      }
      return {
        kind: 'textListItem',
        markerRange: {
          from: from + quoteEnd + indent.length,
          to: from + quoteEnd + indent.length + marker.length,
        },
        prefix: normalizeQuotes(line.slice(0, quoteEnd)) + indent,
        nextMarker: marker.next,
        isEmpty: !content.slice(marker.length).trim(),
      };
    }
    return this.quoteLine(line, from, quoteEnd, quote);
  }

  private quoteLine(
    line: string,
    from: number,
    quoteEnd: number,
    quote: RegExpExecArray | null,
  ): ContinuationLine | undefined {
    if (!quote) return;
    return {
      kind: 'blockquoteLine',
      markerRange: { from: from + quote[1]!.length, to: from + quoteEnd },
      prefix: quote[1]!,
      nextMarker: normalizeQuotes(quote[2]!),
      isEmpty: !line.slice(quoteEnd).trim(),
    };
  }
}
