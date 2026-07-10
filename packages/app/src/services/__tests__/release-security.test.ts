import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function appPath(...segments: string[]): string {
  const direct = resolve(process.cwd(), ...segments);
  if (existsSync(direct)) return direct;
  return resolve(process.cwd(), 'packages/app', ...segments);
}

describe('release security configuration', () => {
  it('keeps Tauri global API and CSP locked down', () => {
    const tauriConfig = JSON.parse(readFileSync(appPath('src-tauri/tauri.conf.json'), 'utf8')) as {
      app?: { withGlobalTauri?: boolean; security?: { csp?: string | null } };
    };

    expect(tauriConfig.app?.withGlobalTauri).toBe(false);
    expect(tauriConfig.app?.security?.csp).toEqual(expect.any(String));
    expect(tauriConfig.app?.security?.csp).not.toBe('');
  });

  it('does not grant unscoped shell, process, or fs capabilities', () => {
    const capability = JSON.parse(
      readFileSync(appPath('src-tauri/capabilities/default.json'), 'utf8'),
    ) as { permissions?: string[] };
    const permissions = capability.permissions ?? [];

    expect(permissions).toContain('shell:default');
    expect(permissions).not.toContain('shell:allow-open');
    expect(permissions.some((permission) => permission.startsWith('process:'))).toBe(false);
    expect(permissions.some((permission) => permission.startsWith('fs:'))).toBe(false);
  });
});
