#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultTokensPath = path.join(
  rootDir,
  'packages',
  'app',
  'src',
  'assets',
  'styles',
  'tokens.css',
);
const defaultSourceDir = path.join(rootDir, 'packages', 'app', 'src');
const sourceExtensions = new Set(['.css', '.ts', '.vue']);
const spacingDefinitionPattern = /(--space-\d+)\s*:/g;
const spacingReferencePattern = /var\(\s*(--space-\d+)\b/g;

/**
 * Read the spacing custom properties declared by the shared token source.
 *
 * @param {string} tokenSource
 * @returns {Set<string>}
 */
export function getDefinedSpacingTokens(tokenSource) {
  return new Set([...tokenSource.matchAll(spacingDefinitionPattern)].map((match) => match[1]));
}

/**
 * Locate every spacing token reference, including CSS embedded in TypeScript strings.
 *
 * @param {string} source
 * @param {string} filePath
 * @returns {{ token: string; filePath: string; line: number }[]}
 */
export function findSpacingTokenReferences(source, filePath) {
  return [...source.matchAll(spacingReferencePattern)].map((match) => ({
    token: match[1],
    filePath,
    line: source.slice(0, match.index).split('\n').length,
  }));
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
export function collectTokenSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTokenSourceFiles(entryPath);
    }

    return entry.isFile() && sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

/**
 * @param {{ tokensPath?: string; sourceDir?: string }} [options]
 */
export function lintSpacingTokens(options = {}) {
  const tokensPath = options.tokensPath ?? defaultTokensPath;
  const sourceDir = options.sourceDir ?? defaultSourceDir;
  const definedTokens = getDefinedSpacingTokens(readFileSync(tokensPath, 'utf8'));
  const references = collectTokenSourceFiles(sourceDir).flatMap((filePath) =>
    findSpacingTokenReferences(readFileSync(filePath, 'utf8'), filePath),
  );
  const unknownReferences = references.filter(({ token }) => !definedTokens.has(token));

  return { definedTokens, unknownReferences };
}

function printUnknownTokens(unknownReferences) {
  console.error('[lint:tokens] Unknown spacing token references:');

  for (const { token, filePath, line } of unknownReferences) {
    console.error(`  ${path.relative(rootDir, filePath)}:${line} ${token}`);
  }
}

function main() {
  const { unknownReferences } = lintSpacingTokens();

  if (unknownReferences.length > 0) {
    printUnknownTokens(unknownReferences);
    process.exitCode = 1;
    return;
  }

  console.log('[lint:tokens] Spacing token references are valid.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
