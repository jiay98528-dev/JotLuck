import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import tsParser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';
import { collectScriptIssues, placeholders, splitPluralBranches } from './i18n-check-lib.mjs';

const workspace = process.cwd();
const localeDir = path.join(workspace, 'packages', 'app', 'src', 'locales');
const localeCodes = ['zh-CN', 'en', 'ja', 'ko', 'fr'];
const issues = [];

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return null;
}

function unwrapExpression(node) {
  if (
    ts.isSatisfiesExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return unwrapExpression(node.expression);
  }
  return node;
}

function flattenObject(node, prefix = '', result = new Map()) {
  const expression = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(expression)) return result;
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (!name) continue;
    const key = prefix ? `${prefix}.${name}` : name;
    const value = unwrapExpression(property.initializer);
    if (ts.isObjectLiteralExpression(value)) {
      flattenObject(value, key, result);
    } else if (ts.isStringLiteralLike(value)) {
      result.set(key, value.text);
    } else {
      issues.push(`${key}: locale values must be static strings or nested objects`);
    }
  }
  return result;
}

function readLocale(code) {
  const file = path.join(localeDir, `${code}.ts`);
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let initializer;
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'messages') {
        initializer = declaration.initializer;
      }
    }
  });
  if (!initializer) throw new Error(`Unable to find messages in ${file}`);
  return flattenObject(initializer);
}

const catalogs = Object.fromEntries(localeCodes.map((code) => [code, readLocale(code)]));
const sourceCatalog = catalogs['zh-CN'];
const sourceKeys = [...sourceCatalog.keys()].sort();
const sourceKeySet = new Set(sourceKeys);

for (const code of localeCodes.slice(1)) {
  const catalog = catalogs[code];
  const keys = [...catalog.keys()].sort();
  for (const key of sourceKeys.filter((key) => !catalog.has(key))) {
    issues.push(`${code}: missing message key ${key}`);
  }
  for (const key of keys.filter((key) => !sourceCatalog.has(key))) {
    issues.push(`${code}: extra message key ${key}`);
  }
  for (const key of sourceKeys.filter((key) => catalog.has(key))) {
    const expectedBranches = splitPluralBranches(sourceCatalog.get(key));
    const actualBranches = splitPluralBranches(catalog.get(key));
    if (expectedBranches.length !== actualBranches.length) {
      issues.push(
        `${code}: plural branch mismatch for ${key}; expected ${expectedBranches.length}, received ${actualBranches.length}`,
      );
      continue;
    }
    for (let index = 0; index < expectedBranches.length; index += 1) {
      const expected = placeholders(expectedBranches[index]);
      const actual = placeholders(actualBranches[index]);
      if (expected.join('|') !== actual.join('|')) {
        issues.push(
          `${code}: placeholder mismatch for ${key} branch ${index + 1}; expected [${expected}], received [${actual}]`,
        );
      }
    }
  }
}

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(fullPath));
    else result.push(fullPath);
  }
  return result;
}

const sourceRoot = path.join(workspace, 'packages', 'app', 'src');
const productionFiles = walk(sourceRoot).filter((file) => {
  const normalized = file.replaceAll('\\', '/');
  return (
    /\.(?:ts|vue)$/.test(file) &&
    !normalized.includes('/locales/') &&
    !normalized.includes('/__tests__/') &&
    !normalized.includes('/test/') &&
    !normalized.includes('/services/completion/') &&
    !normalized.endsWith('/services/MarkdownPredictor.ts') &&
    !normalized.endsWith('/services/CompletionTrainingService.ts') &&
    !normalized.endsWith('/utils/cm6-ghost-text.ts')
  );
});

const allowedStaticText =
  /^(?:JotLuck|Markdown|Wiki-link|GitHub|MIT|TXT|PDF|DOCX|XLSX|CSV|HTML|Web|PWA|Tauri|Ctrl(?:\/Cmd)?[+\w`-]*|Esc|B|I|S|Tx|\d+(?:\.\d+)?)$/i;
const markdownSyntax =
  /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|`[^`]+`|\[.+\]\(.+\)|!\[.*\]\(.+\)|\[\[.+\]\]|\{\{.+\}\}|[|:>#*_~`\-[\](){}./\\]+)$/;

function visitTemplate(node, visitorKeys, onNode) {
  onNode(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item.type === 'string') visitTemplate(item, visitorKeys, onNode);
      }
    } else if (child && typeof child.type === 'string') {
      visitTemplate(child, visitorKeys, onNode);
    }
  }
}

for (const file of productionFiles) {
  const normalized = path.relative(workspace, file).replaceAll('\\', '/');
  const source = fs.readFileSync(file, 'utf8');
  const uncommented = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const lines = uncommented.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/[\u3400-\u9fff]/u.test(line)) return;
    if (/console\.(?:log|warn|error)/.test(line)) return;
    if (normalized === 'packages/app/src/i18n/index.ts' && line.includes('nativeName')) return;
    issues.push(`${normalized}:${index + 1}: raw CJK text outside locale catalogs`);
  });

  if (normalized !== 'packages/app/src/i18n/index.ts') {
    issues.push(...collectScriptIssues(source, normalized, sourceKeySet));
  }

  if (!file.endsWith('.vue')) continue;
  const parsed = vueParser.parseForESLint(source, {
    sourceType: 'module',
    ecmaVersion: 'latest',
    parser: tsParser,
  });
  if (!parsed.ast.templateBody) continue;
  visitTemplate(parsed.ast.templateBody, parsed.visitorKeys, (node) => {
    if (node.type === 'VText') {
      const value = node.value.replace(/\s+/g, ' ').trim();
      if (
        value &&
        /[\p{L}]/u.test(value) &&
        !allowedStaticText.test(value) &&
        !markdownSyntax.test(value)
      ) {
        issues.push(`${normalized}:${node.loc.start.line}: raw template text "${value}"`);
      }
      return;
    }
    if (node.type !== 'VAttribute' || node.directive || !node.value) return;
    const name = typeof node.key.name === 'string' ? node.key.name : node.key.name?.name;
    if (!['aria-label', 'title', 'placeholder', 'alt'].includes(name)) return;
    const value = String(node.value.value ?? '').trim();
    if (
      value &&
      /[\p{L}]/u.test(value) &&
      !allowedStaticText.test(value) &&
      !markdownSyntax.test(value)
    ) {
      issues.push(`${normalized}:${node.loc.start.line}: raw user-visible attribute "${value}"`);
    }
  });
}

const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(workspace, 'packages', 'app', 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const nsis = tauriConfig.bundle?.windows?.nsis;
const expectedInstallerLanguages = ['SimpChinese', 'English', 'Japanese', 'Korean', 'French'];
for (const language of expectedInstallerLanguages) {
  if (!nsis?.languages?.includes(language)) issues.push(`NSIS: missing language ${language}`);
  const relativeFile = nsis?.customLanguageFiles?.[language];
  if (!relativeFile) {
    issues.push(`NSIS: missing custom language file registration for ${language}`);
    continue;
  }
  if (!fs.existsSync(path.join(workspace, 'packages', 'app', 'src-tauri', relativeFile))) {
    issues.push(`NSIS: custom language file does not exist for ${language}: ${relativeFile}`);
  }
}

function nsisKeys(file) {
  const source = fs.readFileSync(file, 'utf8');
  return new Set([...source.matchAll(/^LangString\s+(\S+)\s+/gm)].map((match) => match[1]));
}

const installerRoot = path.join(workspace, 'packages', 'app', 'src-tauri', 'installer-assets');
const englishInstallerKeys = nsisKeys(path.join(installerRoot, 'English.nsh'));
for (const language of expectedInstallerLanguages.filter((language) => language !== 'English')) {
  const keys = nsisKeys(path.join(installerRoot, `${language}.nsh`));
  for (const key of englishInstallerKeys) {
    if (!keys.has(key)) issues.push(`NSIS ${language}: missing LangString ${key}`);
  }
}

if (issues.length > 0) {
  console.error(`i18n check failed with ${issues.length} issue(s):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(
    `i18n check passed: ${sourceKeys.length} message keys, ${localeCodes.length} locales, ${expectedInstallerLanguages.length} NSIS languages.`,
  );
}
