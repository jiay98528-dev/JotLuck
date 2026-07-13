function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function selectorHasThemeScope(selector: string, themeId: string): boolean {
  const trimmed = selector.trim();
  const scopes = [
    `[data-theme-id="${themeId}"]`,
    `[data-theme-id='${themeId}']`,
    `[data-theme-id=${themeId}]`,
  ];
  return scopes.some(
    (scope) => trimmed.startsWith(scope) || trimmed.startsWith(`:where(${scope})`),
  );
}

function splitSelectorList(prelude: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let squareDepth = 0;
  let parenDepth = 0;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < prelude.length; i++) {
    const char = prelude[i];
    const previous = prelude[i - 1];
    if (quote) {
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') squareDepth++;
    else if (char === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === ',' && squareDepth === 0 && parenDepth === 0) {
      selectors.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }

  selectors.push(prelude.slice(start).trim());
  return selectors.filter(Boolean);
}

/** Returns the first unscoped DOM selector, or null when every selector is safe. */
export function findUnscopedCssSelector(css: string, themeId: string): string | null {
  if (!css.trim()) return null;

  const source = stripCssComments(css);
  let segmentStart = 0;
  let depth = 0;
  let keyframesDepth: number | null = null;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '{') {
      const prelude = source.slice(segmentStart, i).trim();
      const lowerPrelude = prelude.toLowerCase();

      if (keyframesDepth !== null && depth >= keyframesDepth) {
        // Keyframe selectors are not DOM selectors.
      } else if (
        lowerPrelude.startsWith('@keyframes') ||
        lowerPrelude.startsWith('@-webkit-keyframes')
      ) {
        keyframesDepth = depth + 1;
      } else if (prelude && !prelude.startsWith('@')) {
        const unscoped = splitSelectorList(prelude).find(
          (selector) => !selectorHasThemeScope(selector, themeId),
        );
        if (unscoped) return unscoped;
      }

      depth += 1;
      segmentStart = i + 1;
      continue;
    }

    if (char === '}') {
      depth = Math.max(0, depth - 1);
      if (keyframesDepth !== null && depth < keyframesDepth) keyframesDepth = null;
      segmentStart = i + 1;
    }
  }

  return null;
}
