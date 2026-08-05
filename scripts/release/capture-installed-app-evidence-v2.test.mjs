import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const scriptPath = path.join(projectRoot, 'scripts/release/capture-installed-app-evidence-v2.mjs');
const workflowPath = path.join(projectRoot, '.github/workflows/ci.yml');

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

  it('defers a capture failure exit until the fixed adapter cleanup has completed', () => {
    const source = readFileSync(scriptPath, 'utf8');
    const captureTryIndex = source.indexOf('try {', source.indexOf('let captureError'));
    const catchIndex = source.indexOf('} catch (error) {', captureTryIndex);
    const finallyIndex = source.indexOf('} finally {', catchIndex);
    const disposeIndex = source.indexOf(
      'await adapters.disposeInstalledAppEvidence()',
      finallyIndex,
    );
    const diagnosticIndex = source.indexOf('const diagnosticRoot', disposeIndex);
    const exitIndex = source.indexOf('fail(captureError.message)', diagnosticIndex);

    expect(captureTryIndex).toBeGreaterThan(0);
    expect(catchIndex).toBeGreaterThan(captureTryIndex);
    expect(finallyIndex).toBeGreaterThan(catchIndex);
    expect(disposeIndex).toBeGreaterThan(finallyIndex);
    expect(diagnosticIndex).toBeGreaterThan(disposeIndex);
    expect(exitIndex).toBeGreaterThan(diagnosticIndex);
    expect(source.slice(catchIndex, finallyIndex)).not.toContain('fail(');
    expect(source).toContain('const diagnosticRoot = `${outputRoot}-diagnostics`');
    expect(source).toContain('jotluck.installed-app.capture-failure.v1');

    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('Upload installed-app failure diagnostics');
    expect(workflow).toContain('installed-app-evidence-diagnostics/**');
  });

  it('pins the capture driver and passes the independently resolved candidate application', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow.match(/cargo install tauri-driver --version 2\.0\.6 --locked/gu)).toHaveLength(
      2,
    );
    expect(workflow).toContain('$env:USERPROFILE\\.cargo\\bin\\tauri-driver.exe');
    expect(workflow).toContain('unexpected tauri-driver version');
    expect(workflow).toContain('expected exactly one candidate jotluck.exe');
    expect(workflow).toContain('JOTLUCK_CANDIDATE_APPLICATION_PATH');
  });

  it('materializes provenance-bound evidence for a separate evidence-only commit', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: Installed-app Evidence Materialization');
    expect(workflow).toContain('Resolve current-run provenance');
    expect(workflow).toContain('resolve-current-run-provenance.mjs');
    expect(workflow).toContain('Materialize managed evidence bundle');
    expect(workflow).toContain('materialize-installed-app-evidence-v2.mjs');
    expect(workflow).toContain('jotluck-installed-app-managed-evidence-v2-');
    expect(workflow).toContain('for evidence-only commit');
  });
});
