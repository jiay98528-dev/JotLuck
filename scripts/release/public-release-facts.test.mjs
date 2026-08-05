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
  'README.zh.md',
  'KNOWN_LIMITATIONS.md',
  'RELEASE_NOTES.md',
  'SECURITY.md',
].map((file) => ({
  file,
  content: readFileSync(path.join(projectRoot, file), 'utf8'),
}));

describe('public release facts', () => {
  it('derives the unsigned signing candidate version from every build manifest', () => {
    const version = rootPackage.version;

    expect(appPackage.version).toBe(version);
    expect(tauriConfig.version).toBe(version);
    expect(cargoVersion).toBe(version);
    for (const document of publicDocuments) {
      expect(document.content, document.file).toContain(`v${version}`);
      expect(document.content, document.file).not.toContain('v0.10.0-rc.1');
    }

    expect(readDocument('README.md')).toContain('unsigned signing candidate');
    expect(readDocument('README.zh.md')).toContain('未签名的签名申请候选');
    expect(readDocument('KNOWN_LIMITATIONS.md')).toContain(
      'unpublished, unsigned signing candidate',
    );
    expect(readDocument('RELEASE_NOTES.md')).toMatch(
      /unpublished Windows x64 signing candidate[\s\S]*unsigned/iu,
    );
    expect(readDocument('SECURITY.md')).toMatch(
      /not currently distributed[\s\S]*signing candidate/iu,
    );
    for (const document of publicDocuments) {
      expect(document.content, document.file).not.toMatch(
        /已公开的未签名版本|\bpublished, unsigned|\bpublished Windows x64/iu,
      );
    }
  });

  it('derives eight optional Open With extensions from the actual NSIS installer contract', () => {
    const noteExtensions = ['.md', '.markdown', '.mdx', '.txt'];
    const documentExtensions = ['.docx', '.pdf', '.xlsx', '.xls'];
    for (const extension of noteExtensions) {
      expect(hooks).toContain(`_JotLuck_REGISTER_OPTIONAL_ASSOC "${extension}"`);
      expect(hooks).toContain(`_JotLuck_REMOVE_OPTIONAL_ASSOC "${extension}"`);
    }
    for (const extension of documentExtensions) {
      expect(hooks).toContain(`_JotLuck_REGISTER_DOCUMENT_ASSOC "${extension}"`);
      expect(hooks).toContain(`_JotLuck_REMOVE_DOCUMENT_ASSOC "${extension}"`);
    }

    const associationDocuments = [
      readDocument('README.md'),
      readDocument('README.zh.md'),
      readDocument('KNOWN_LIMITATIONS.md'),
      readDocument('RELEASE_NOTES.md'),
    ];
    for (const document of associationDocuments) {
      for (const extension of [...noteExtensions, ...documentExtensions]) {
        expect(document).toContain(`\`${extension}\``);
      }
      expect(document).toMatch(/打开方式|Open With/u);
      expect(document).toMatch(/不改写|不替换|does not replace|never replaces?/u);
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

  it('documents the real welcome association choice and notebook gate', () => {
    const readme = readDocument('README.md');
    const chineseReadme = readDocument('README.zh.md');
    const notes = readDocument('RELEASE_NOTES.md');

    expect(readme).toContain('Welcome screen');
    expect(readme).toContain('Open Notebook gate');
    expect(readme).toContain('`Ctrl/Cmd+O`');
    expect(chineseReadme).toContain('欢迎页');
    expect(chineseReadme).toContain('“打开笔记本”门页');
    expect(notes).toContain('Open Notebook gate');
    expect(notes).toContain('Welcome screen');
  });
});

function readDocument(file) {
  return publicDocuments.find((document) => document.file === file)?.content ?? '';
}
