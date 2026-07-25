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
});
