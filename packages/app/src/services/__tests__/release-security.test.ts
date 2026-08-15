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
    const csp = tauriConfig.app?.security?.csp ?? '';
    const imageDirective = csp
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('img-src '));
    expect(imageDirective).toContain('https:');
    expect(imageDirective).not.toMatch(/(?:^|\s)http:(?:\s|$)/);
    expect(imageDirective).not.toContain('*');
    expect(csp).toContain("connect-src 'self' ipc: http://ipc.localhost");
  });

  it('does not grant unscoped shell, process, or fs capabilities', () => {
    const capability = JSON.parse(
      readFileSync(appPath('src-tauri/capabilities/default.json'), 'utf8'),
    ) as { permissions?: string[] };
    const permissions = capability.permissions ?? [];

    expect(permissions).not.toContain('core:window:allow-close');
    expect(permissions).toContain('shell:default');
    expect(permissions).not.toContain('shell:allow-open');
    expect(permissions.some((permission) => permission.startsWith('process:'))).toBe(false);
    expect(permissions.some((permission) => permission.startsWith('fs:'))).toBe(false);

    const tauriEntry = readFileSync(appPath('src-tauri/src/lib.rs'), 'utf8');
    expect(tauriEntry).toContain('fn destroy_current_window(window: tauri::WebviewWindow)');
    expect(tauriEntry).toContain('window.destroy()');
  });
});
