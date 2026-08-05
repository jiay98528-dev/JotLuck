import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const tauriConfig = JSON.parse(
  readFileSync(path.join(projectRoot, 'packages/app/src-tauri/tauri.conf.json'), 'utf8'),
) as { bundle?: { fileAssociations?: unknown } };
const hooks = readFileSync(
  path.join(projectRoot, 'packages/app/src-tauri/installer-assets/hooks.nsh'),
  'utf8',
);
const installerLanguages = ['SimpChinese', 'English', 'Japanese', 'Korean', 'French'].map(
  (language) => ({
    language,
    source: readFileSync(
      path.join(projectRoot, `packages/app/src-tauri/installer-assets/${language}.nsh`),
      'utf8',
    ),
  }),
);

describe('Windows optional file association contract', () => {
  it('does not use Tauri APP_ASSOCIATE, which overwrites the current default ProgID', () => {
    expect(tauriConfig.bundle?.fileAssociations).toBeUndefined();
    const optionalMacro = hooks.match(
      /!macro _JotLuck_REGISTER_OPTIONAL_ASSOC[\s\S]*?!macroend/u,
    )?.[0];
    const documentMacro = hooks.match(
      /!macro _JotLuck_REGISTER_DOCUMENT_ASSOC[\s\S]*?!macroend/u,
    )?.[0];
    expect(optionalMacro).toContain('OpenWithProgids');
    expect(optionalMacro).toContain('SupportedTypes');
    expect(optionalMacro).not.toContain('Software\\Classes\\${EXT}" ""');
    expect(documentMacro).toContain('OpenWithProgids');
    expect(documentMacro).toContain('SupportedTypes');
    expect(documentMacro).not.toContain('Software\\Classes\\${EXT}" ""');
    expect(hooks).not.toContain('\\UserChoice');
  });

  it.each(['.md', '.markdown', '.mdx', '.txt'])(
    'registers and removes %s without taking over the default application',
    (extension) => {
      expect(hooks).toContain(`_JotLuck_REGISTER_OPTIONAL_ASSOC "${extension}"`);
      expect(hooks).toContain(`_JotLuck_REMOVE_OPTIONAL_ASSOC "${extension}"`);
    },
  );

  it.each(['.docx', '.pdf', '.xlsx', '.xls'])(
    'registers and removes %s through the isolated document-import ProgID',
    (extension) => {
      expect(hooks).toContain(`_JotLuck_REGISTER_DOCUMENT_ASSOC "${extension}"`);
      expect(hooks).toContain(`_JotLuck_REMOVE_DOCUMENT_ASSOC "${extension}"`);
      expect(hooks).toContain(
        `Capabilities\\FileAssociations" "${extension}" "JotLuck.DocumentImport"`,
      );
    },
  );

  it('registers all eight capabilities without writing an extension default value', () => {
    const postInstall = hooks.match(/!macro NSIS_HOOK_POSTINSTALL[\s\S]*?!macroend/u)?.[0];
    expect(postInstall).toContain('WriteRegStr SHCTX "Software\\RegisteredApplications" "JotLuck"');
    expect(postInstall).toContain('Software\\Classes\\JotLuck.Note\\shell\\open\\command');
    expect(postInstall).toContain(
      'Software\\Classes\\JotLuck.DocumentImport\\shell\\open\\command',
    );
    expect(postInstall).not.toMatch(
      /WriteRegStr SHCTX "Software\\Classes\\\.(?:md|markdown|mdx|txt|docx|pdf|xlsx|xls)" ""/u,
    );
  });

  it('prevents candidate ProgIDs from silently becoming public file type defaults', () => {
    const preventionMacro = hooks.match(
      /!macro _JotLuck_PREVENT_SILENT_DEFAULT[\s\S]*?!macroend/u,
    )?.[0];
    const postInstall = hooks.match(/!macro NSIS_HOOK_POSTINSTALL[\s\S]*?!macroend/u)?.[0];

    expect(preventionMacro).toContain('AllowSilentDefaultTakeOver');
    expect(preventionMacro).toContain('RegSetValueExW');
    expect(preventionMacro).toContain('i 0, p 0, i 0');
    expect(preventionMacro).toContain('${If} $8 == 0');
    expect(postInstall).toContain('_JotLuck_PREVENT_SILENT_DEFAULT "JotLuck.Note"');
    expect(postInstall).toContain('_JotLuck_PREVENT_SILENT_DEFAULT "JotLuck.DocumentImport"');
  });

  it.each(installerLanguages)(
    'defines both ProgID descriptions in the $language installer language table',
    ({ source }) => {
      expect(source).toContain('LangString JotLuckFileType');
      expect(source).toContain('LangString JotLuckDocumentType');
    },
  );

  it('removes only JotLuck OpenWithList slots and preserves the remaining MRU order', () => {
    const removeSlotMacro = hooks.match(
      /!macro _JotLuck_REMOVE_OPENWITH_SLOT[\s\S]*?!macroend/u,
    )?.[0];
    const removeAssociationMacro = hooks.match(
      /!macro _JotLuck_REMOVE_OPTIONAL_ASSOC[\s\S]*?!macroend/u,
    )?.[0];

    expect(removeSlotMacro).toContain('ReadRegStr $4');
    expect(removeSlotMacro).toContain('StrCpy $8 $4 1 $6');
    expect(removeSlotMacro).toContain('${If} $8 != "${SLOT}"');
    expect(removeSlotMacro).toContain('WriteRegStr SHCTX');
    expect(removeSlotMacro).toContain('"MRUList" "$5"');
    expect(removeAssociationMacro).not.toMatch(/DeleteRegValue[^\n]+"MRUList"/u);
  });

  it.each([
    ['cba', ['b'], 'ca'],
    ['dcba', ['b', 'd'], 'ca'],
    ['cba', [], 'cba'],
    ['b', ['b'], ''],
  ])('keeps MRU order for %s after removing %j', (mru, slots, expected) => {
    expect(removeSlotsFromMru(mru, slots)).toBe(expected);
  });
});

function removeSlotsFromMru(mru: string, slots: string[]): string {
  return [...mru].filter((slot) => !slots.includes(slot)).join('');
}
