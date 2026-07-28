import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const rootPackage = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const appPackage = JSON.parse(
  readFileSync(path.join(projectRoot, 'packages/app/package.json'), 'utf8'),
);
const tauriConfig = JSON.parse(
  readFileSync(path.join(projectRoot, 'packages/app/src-tauri/tauri.conf.json'), 'utf8'),
);
const cargoManifest = readFileSync(
  path.join(projectRoot, 'packages/app/src-tauri/Cargo.toml'),
  'utf8',
);
const hooks = readFileSync(
  path.join(projectRoot, 'packages/app/src-tauri/installer-assets/hooks.nsh'),
  'utf8',
);
const cargoVersion = cargoManifest.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/mu)?.[1];
const optionalAssociationMacro =
  hooks.match(/!macro _JotLuck_REGISTER_OPTIONAL_ASSOC[\s\S]*?!macroend/mu)?.[0] ?? '';
const removeAssociationMacro =
  hooks.match(/!macro _JotLuck_REMOVE_OPTIONAL_ASSOC[\s\S]*?!macroend/mu)?.[0] ?? '';
const publicDocuments = [
  'README.md',
  'README.en.md',
  'KNOWN_LIMITATIONS.md',
  'RELEASE_NOTES.md',
  'SECURITY.md',
].map((file) => ({
  file,
  content: readFileSync(path.join(projectRoot, file), 'utf8'),
}));

describe('public release facts', () => {
  it('derives the unpublished preview candidate version from every build manifest', () => {
    const version = '0.1.0-preview';

    expect(rootPackage.version).toBe(version);
    expect(appPackage.version).toBe(version);
    expect(tauriConfig.version).toBe(version);
    expect(cargoVersion).toBe(version);
    for (const document of publicDocuments) {
      expect(document.content, document.file).toContain(`v${version}`);
      expect(document.content, document.file).not.toContain('v0.15.0-rc.1');
    }

    expect(readDocument('README.md')).toContain('未发布、未签名的内部预览候选');
    expect(readDocument('README.en.md')).toContain(
      'Unpublished, unsigned internal preview candidate',
    );
    expect(readDocument('KNOWN_LIMITATIONS.md')).toContain(
      'unpublished, unsigned internal candidate',
    );
    expect(readDocument('RELEASE_NOTES.md')).toMatch(
      /unpublished Windows x64 preview candidate[\s\S]*unsigned/iu,
    );
    expect(readDocument('SECURITY.md')).toMatch(
      /not currently distributed[\s\S]*internal candidate/iu,
    );
    for (const document of publicDocuments) {
      expect(document.content, document.file).not.toMatch(
        /已公开的未签名预览版|\bpublished, unsigned preview|\bpublished Windows x64 preview/iu,
      );
    }
  });

  it('derives four optional Open With extensions from the actual NSIS installer contract', () => {
    const extensions = ['.md', '.markdown', '.mdx', '.txt'];
    for (const extension of extensions) {
      expect(hooks).toContain(`_JotLuck_REGISTER_OPTIONAL_ASSOC "${extension}"`);
      expect(hooks).toContain(`_JotLuck_REMOVE_OPTIONAL_ASSOC "${extension}"`);
    }

    const associationDocuments = [
      readDocument('README.md'),
      readDocument('README.en.md'),
      readDocument('KNOWN_LIMITATIONS.md'),
      readDocument('RELEASE_NOTES.md'),
    ];
    for (const document of associationDocuments) {
      for (const extension of extensions) expect(document).toContain(`\`${extension}\``);
      expect(document).toMatch(/打开方式|Open With/u);
      expect(document).toMatch(/不改写|不替换|does not replace|never replaces/u);
      expect(document).not.toContain('does not hijack the default `.txt` association');
    }

    expect(optionalAssociationMacro).toContain('OpenWithProgids');
    expect(optionalAssociationMacro).toContain('SupportedTypes');
    expect(optionalAssociationMacro).not.toContain('Software\\Classes\\${EXT}" ""');
    expect(removeAssociationMacro).toContain('OpenWithProgids');
    expect(tauriConfig.bundle.fileAssociations).toBeUndefined();
  });

  it('does not preserve obsolete release counters or a placeholder checksum', () => {
    const notes = readDocument('RELEASE_NOTES.md');
    const limitations = readDocument('KNOWN_LIMITATIONS.md');

    expect(notes).not.toMatch(/\b\d+ passed\b|137 passed|140 passed|Validation Matrix/u);
    expect(notes).not.toMatch(/SHA256:/u);
    expect(limitations).not.toMatch(/\b\d+ passed\b|L1\/L2, coverage/u);
    expect(limitations).not.toContain('SHA256 recorded');
    expect(`${limitations}\n${notes}`).not.toMatch(/\b0{64}\b/u);
    expect(limitations).toMatch(/lru 0\.12\.5[\s\S]*memmap2 0\.9\.10[\s\S]*tantivy 0\.22\.1/iu);
    expect(limitations).toContain('must therefore not be described as a zero-warning');
  });

  it('documents the real first-run notebook gate rather than the removed welcome flow', () => {
    const readme = readDocument('README.md');
    const englishReadme = readDocument('README.en.md');
    const notes = readDocument('RELEASE_NOTES.md');

    expect(readme).toContain('“打开笔记本”门页');
    expect(readme).toContain('`Ctrl/Cmd+O`');
    expect(readme).not.toContain('第一次启动会显示欢迎页');
    expect(englishReadme).toContain('Open Notebook gate');
    expect(englishReadme).not.toContain('Welcome screen');
    expect(notes).toContain('Open Notebook gate');
    expect(notes).toContain('writable temporary');
  });
});

function readDocument(file) {
  return publicDocuments.find((document) => document.file === file)?.content ?? '';
}
