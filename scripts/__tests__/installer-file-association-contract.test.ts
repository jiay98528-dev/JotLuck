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

describe('Windows optional file association contract', () => {
  it('does not use Tauri APP_ASSOCIATE, which overwrites the current default ProgID', () => {
    expect(tauriConfig.bundle?.fileAssociations).toBeUndefined();
    const optionalMacro = hooks.match(
      /!macro _JotLuck_REGISTER_OPTIONAL_ASSOC[\s\S]*?!macroend/u,
    )?.[0];
    expect(optionalMacro).toContain('OpenWithProgids');
    expect(optionalMacro).toContain('SupportedTypes');
    expect(optionalMacro).not.toContain('Software\\Classes\\${EXT}" ""');
  });

  it.each(['.md', '.markdown', '.mdx', '.txt'])(
    'registers and removes %s without taking over the default application',
    (extension) => {
      expect(hooks).toContain(`_JotLuck_REGISTER_OPTIONAL_ASSOC "${extension}"`);
      expect(hooks).toContain(`_JotLuck_REMOVE_OPTIONAL_ASSOC "${extension}"`);
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
