import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const scriptPath = path.join(projectRoot, 'scripts/release/capture-installed-app-evidence-v2.mjs');

describe('installed-app evidence capture entrypoint', () => {
  it('fails closed outside GitHub workflow_dispatch', () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, 'fixture-release', projectRoot, path.join(projectRoot, 'fixture-output')],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_EVENT_NAME: '' },
      },
    );
    expect(result.status).toBe(14);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/restricted to GitHub workflow_dispatch/u);
  });

  it('binds one checked-in adapter module and accepts no command argument or environment override', () => {
    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain('e2e/tauri/installed-app-evidence-adapters.mjs');
    expect(source).not.toContain('JOTLUCK_INSTALLED_APP_ADAPTER');
    expect(source).not.toContain('exec(');
    expect(source).not.toContain('spawn(');
  });
});
