import ts from 'typescript';

export const allowedStaticText =
  /^(?:JotLuck|Markdown|Wiki-link|GitHub|MIT|TXT|PDF|DOCX|XLSX|CSV|HTML|Web|PWA|Tauri|Ctrl(?:\/Cmd)?[+\w`-]*|Esc|B|I|S|Tx|\d+(?:\.\d+)?)$/i;

export function placeholders(value) {
  return [
    ...new Set(
      [...value.matchAll(/(?<!\{)\{([A-Za-z][A-Za-z0-9_]*)\}(?!\})/g)].map((match) => match[1]),
    ),
  ].sort();
}

export function splitPluralBranches(value) {
  const escapedPipes = [];
  const masked = value.replace(/\{(['"])\|\1\}|\\\|/g, (match) => {
    const token = `\u0000${escapedPipes.length}\u0000`;
    escapedPipes.push(match);
    return token;
  });
  return masked
    .split('|')
    .map((branch) =>
      branch
        .replace(/\u0000(\d+)\u0000/g, (_match, index) => escapedPipes[Number(index)] ?? '')
        .trim(),
    );
}

function scriptSource(source, file) {
  if (!file.endsWith('.vue')) return source;
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)]
    .map((match) => match[1])
    .join('\n');
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function literalText(node) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return null;
}

function expressionRootName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return expressionRootName(node.expression);
  }
  return null;
}

function lineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function hasDynamicKeyAnnotation(source, sourceFile, node) {
  const line = lineNumber(sourceFile, node);
  const lines = source.split(/\r?\n/u);
  return [lines[line - 1], lines[line - 2]].some((value) => value?.includes('i18n-dynamic-key'));
}

function isRawUserText(value) {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 && /\p{L}/u.test(normalized) && !allowedStaticText.test(normalized);
}

const translationCalls = new Map([
  ['t', 0],
  ['translate', 0],
  ['translateForLocale', 1],
  ['createUserMessageError', 0],
  ['localizeUserError', 1],
]);

const userMessagePropertyNames = new Set([
  'ariaLabel',
  'description',
  'emptyText',
  'error',
  'errorMessage',
  'label',
  'message',
  'note',
  'placeholder',
  'title',
]);

const userMessageStateNames = /(?:error|message|toast)$/iu;

export function collectScriptIssues(source, file, catalogKeys) {
  const issues = [];
  const extracted = scriptSource(source, file);
  if (!extracted.trim()) return issues;
  const sourceFile = ts.createSourceFile(
    file,
    extracted,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const keyIndex = name === null ? undefined : translationCalls.get(name);
      if (keyIndex !== undefined && node.arguments[keyIndex]) {
        const key = literalText(node.arguments[keyIndex]);
        if (key === null) {
          if (!hasDynamicKeyAnnotation(extracted, sourceFile, node)) {
            issues.push(
              `${file}:${lineNumber(sourceFile, node)}: unregistered dynamic i18n key in ${name}()`,
            );
          }
        } else if (!catalogKeys.has(key)) {
          issues.push(`${file}:${lineNumber(sourceFile, node)}: unknown i18n key ${key}`);
        }
      }

      const root = ts.isPropertyAccessExpression(node.expression)
        ? expressionRootName(node.expression.expression)
        : null;
      const isUserMessageCall =
        name === 'alert' ||
        name === 'confirm' ||
        name === 'showToast' ||
        name === 'notify' ||
        (root === 'toast' && ['show', 'success', 'error', 'warning', 'info'].includes(name ?? ''));
      if (isUserMessageCall && node.arguments[0]) {
        const value = literalText(node.arguments[0]);
        if (value !== null && isRawUserText(value)) {
          issues.push(`${file}:${lineNumber(sourceFile, node)}: raw user message "${value}"`);
        }
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      const value = literalText(node.initializer);
      if (
        name &&
        value !== null &&
        userMessagePropertyNames.has(name) &&
        !catalogKeys.has(value) &&
        isRawUserText(value)
      ) {
        issues.push(`${file}:${lineNumber(sourceFile, node)}: raw ${name} text "${value}"`);
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const root = expressionRootName(node.left);
      const value = literalText(node.right);
      if (root && value !== null && userMessageStateNames.test(root) && isRawUserText(value)) {
        issues.push(`${file}:${lineNumber(sourceFile, node)}: raw ${root} state text "${value}"`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}
