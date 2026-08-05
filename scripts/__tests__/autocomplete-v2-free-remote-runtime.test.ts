import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { selectLastTwoAndBest } from '../autocomplete-v2-free/remote/checkpoints';
import type { RemoteCheckpointRecord } from '../autocomplete-v2-free/remote/contract';
import { assessTailscalePath, ONE_GIBIBYTE } from '../autocomplete-v2-free/remote/network-path';
import {
  canTransitionRemoteTrainingStatus,
  isHeartbeatStale,
} from '../autocomplete-v2-free/remote/status';
import {
  createAtomicUploadPlan,
  verifyUploadedBytes,
} from '../autocomplete-v2-free/remote/transfer';

function checkpoint(step: number, score: number): RemoteCheckpointRecord {
  return {
    relativePath: `checkpoints/step-${step}.bin`,
    step,
    score,
    bytes: 100 + step,
    sha256: step.toString(16).padStart(64, '0'),
    createdAt: new Date(Date.UTC(2026, 7, 5, 10, 0, step)).toISOString(),
  };
}

function script(name: string): string {
  return readFileSync(new URL(`../autocomplete-v2-free/remote/${name}`, import.meta.url), 'utf8');
}

const REMOTE_DIRECTORY = fileURLToPath(new URL('../autocomplete-v2-free/remote/', import.meta.url));

describe('remote V2 free training runtime policies', () => {
  it.runIf(process.platform === 'win32')(
    'parses every PowerShell template without executing it',
    () => {
      const powershellFiles = readdirSync(REMOTE_DIRECTORY)
        .filter((name) => name.endsWith('.ps1'))
        .sort();
      expect(powershellFiles.length).toBeGreaterThanOrEqual(6);
      for (const name of powershellFiles) {
        const pathLiteral = `'${`${REMOTE_DIRECTORY}${name}`.replaceAll("'", "''")}'`;
        const parser = [
          '$tokens = $null',
          '$errors = $null',
          `[void][System.Management.Automation.Language.Parser]::ParseFile(${pathLiteral}, [ref]$tokens, [ref]$errors)`,
          "if ($errors.Count -gt 0) { throw ($errors.Message -join ' | ') }",
        ].join('; ');
        expect(() =>
          execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', parser], {
            encoding: 'utf8',
          }),
        ).not.toThrow();
      }
    },
  );

  it('retains the last two checkpoints plus an older best checkpoint', () => {
    const records = [checkpoint(1, 0.9), checkpoint(2, 0.4), checkpoint(3, 0.5)];
    const retention = selectLastTwoAndBest(records);
    expect(retention.keep.map((item) => item.step)).toEqual([3, 2, 1]);
    expect(retention.reasons[records[0]!.relativePath]).toEqual(['best']);
    expect(() => selectLastTwoAndBest([records[0]!, records[0]!])).toThrow(/Duplicate/u);
  });

  it('uses the exact 1 GiB Tailscale thresholds', () => {
    const durationAt20Mbps = (ONE_GIBIBYTE * 8 * 1_000) / 20_000_000;
    const durationAt10Mbps = (ONE_GIBIBYTE * 8 * 1_000) / 10_000_000;
    expect(
      assessTailscalePath({ path: 'direct', bytes: ONE_GIBIBYTE, durationMs: durationAt20Mbps }),
    ).toMatchObject({ decision: 'use-direct', directMbps: 20 });
    expect(
      assessTailscalePath({
        path: 'direct',
        bytes: ONE_GIBIBYTE,
        durationMs: durationAt20Mbps + 1,
      }),
    ).toMatchObject({ decision: 'test-peer-relay' });
    expect(
      assessTailscalePath(
        { path: 'direct', bytes: ONE_GIBIBYTE, durationMs: durationAt20Mbps + 1 },
        { path: 'peer-relay', bytes: ONE_GIBIBYTE, durationMs: durationAt10Mbps },
      ),
    ).toMatchObject({ decision: 'use-peer-relay', peerRelayMbps: 10 });
    expect(
      assessTailscalePath(
        { path: 'direct', bytes: ONE_GIBIBYTE, durationMs: durationAt20Mbps + 1 },
        { path: 'peer-relay', bytes: ONE_GIBIBYTE, durationMs: durationAt10Mbps + 1 },
      ),
    ).toMatchObject({ decision: 'recommend-wireguard' });
    expect(() =>
      assessTailscalePath({
        path: 'direct',
        bytes: (ONE_GIBIBYTE - 1) as typeof ONE_GIBIBYTE,
        durationMs: 1,
      }),
    ).toThrow(/exact 1 GiB/u);
  });

  it('plans a sibling temporary upload and verifies bytes before promotion', () => {
    const bytes = Buffer.from('frozen training bundle', 'utf8');
    const plan = createAtomicUploadPlan({
      transferId: 'trial-001',
      finalRelativePath: 'incoming/job-42.bundle',
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(plan.temporaryRelativePath).toBe('incoming/.job-42.bundle.upload-trial-001.tmp');
    expect(() => verifyUploadedBytes(bytes, plan)).not.toThrow();
    expect(() => verifyUploadedBytes(Buffer.from('tampered'), plan)).toThrow(/byte count|SHA-256/u);
    expect(() =>
      createAtomicUploadPlan({ ...plan, finalRelativePath: '../outside.bundle' }),
    ).toThrow(/safe relative path/u);
  });

  it('enforces monotonic state transitions and heartbeat staleness', () => {
    expect(canTransitionRemoteTrainingStatus('queued', 'running')).toBe(true);
    expect(canTransitionRemoteTrainingStatus('checkpointed', 'running')).toBe(true);
    expect(canTransitionRemoteTrainingStatus('completed', 'running')).toBe(false);
    expect(
      isHeartbeatStale(
        { heartbeatAt: '2026-08-05T12:00:00.000Z' },
        Date.parse('2026-08-05T12:00:46.000Z'),
        45_000,
      ),
    ).toBe(true);
  });

  it('keeps probe read-only and bootstrap explicit, limited, and hash-bound', () => {
    const probe = script('Probe-Fx15.ps1');
    expect(probe).toContain('readOnly = $true');
    expect(probe).not.toMatch(
      /\b(?:Register-ScheduledTask|New-ScheduledTask|Set-Service|Start-Service|Stop-Service|New-NetFirewallRule|Install-|Remove-Item)\b/u,
    );

    const bootstrap = script('Bootstrap-Fx15.ps1');
    expect(bootstrap).toContain('[Parameter(Mandatory)][switch]$Apply');
    expect(bootstrap).toContain('#requires -RunAsAdministrator');
    expect(bootstrap).toContain('ExpectedRunnerSha256');
    expect(bootstrap).toContain('ExpectedJobSha256');
    expect(bootstrap).toContain('-LogonType S4U -RunLevel Limited');
    expect(bootstrap).toContain("'AllSigned'");
    expect(bootstrap).toContain('set --unattended=true');
  });

  it('keeps one-time FX15 initialization plan-only by default and closes public SSH', () => {
    const initialize = script('Initialize-Fx15.ps1');
    expect(initialize).toContain('#requires -Version 7.0');
    expect(initialize).toContain('#requires -RunAsAdministrator');
    expect(initialize).toContain('[switch]$Apply');
    expect(initialize).toContain('[PSCredential]$TrainingCredential');
    expect(initialize).toContain('if (-not $Apply -or $WhatIfPreference)');
    expect(initialize.indexOf('if (-not $Apply -or $WhatIfPreference)')).toBeLessThan(
      initialize.indexOf('Add-WindowsCapability'),
    );
    expect(initialize).not.toMatch(/\[string\]\$(?:Password|PrivateKey|AuthKey|VpsToken)/iu);
    expect(initialize).not.toContain('Restart-Computer');

    expect(initialize).toContain("$OPENSSH_CAPABILITY = 'OpenSSH.Server~~~~0.0.1.0'");
    expect(initialize).toContain('PasswordAuthentication no');
    expect(initialize).toContain('KbdInteractiveAuthentication no');
    expect(initialize).toContain('AllowUsers $TRAINING_USER');
    expect(initialize).toContain('ListenAddress $fx15Address');
    expect(initialize).toContain('Disable-NetFirewallRule');
    expect(initialize).toContain('-RemoteAddress "$controlAddress/32"');
    expect(initialize).toContain("@('-t', '-f', $sshdTemporaryPath)");
    expect(initialize).toContain('[IO.File]::Move($sshdTemporaryPath, $sshdConfigPath, $true)');
  });

  it('pins optional FX15 packages, CUDA training environment, and AC power backup', () => {
    const initialize = script('Initialize-Fx15.ps1');
    expect(initialize).toContain("$PYTHON_WINGET_ID = 'Python.Python.3.12'");
    expect(initialize).toContain("$TAILSCALE_WINGET_ID = 'Tailscale.Tailscale'");
    expect(initialize).toContain("$PYTORCH_VERSION = '2.8.0'");
    expect(initialize).toContain("$PYTORCH_CUDA_VERSION = '12.6'");
    expect(initialize).toContain("$PYTORCH_INDEX_URL = 'https://download.pytorch.org/whl/cu126'");
    expect(initialize).toContain(
      '-InstallTrainingEnvironment requires -ApprovePyTorchDownloadSource',
    );
    expect(initialize).toContain("'show', '--id', $PackageId, '--exact', '--source', 'winget'");
    expect(initialize).toContain("@('/query')");
    expect(initialize).toContain("@('/duplicatescheme', $activeMatch.Value)");
    expect(initialize).toContain('automaticRestartPerformed = $false');
  });

  it('makes the scheduled runner durable and verifies atomic bundle promotion', () => {
    const runner = script('Invoke-TrainingJob.ps1');
    expect(runner).toContain('-WindowStyle Hidden -PassThru');
    expect(runner).toContain('heartbeatAt');
    expect(runner).toContain('Job deadline exceeded.');
    expect(runner).toContain('Get-FileHash');
    expect(runner).toContain("'HEAD^{tree}'");
    expect(runner).toContain('standalone 16m-q8 is forbidden');
    expect(runner).toContain('JOTLUCK_REMOTE_CANDIDATE_MATRIX_IDS');

    const finalizer = script('Finalize-VerifiedUpload.ps1');
    expect(finalizer).toContain('.upload-$TransferId.tmp');
    expect(finalizer).toContain('ExpectedManifestFileSha256');
    expect(finalizer).toContain('[IO.Directory]::Move($incoming, $final)');
    expect(finalizer).toContain('ReparsePoint');

    const retention = script('Invoke-CheckpointRetention.ps1');
    expect(retention).toContain('last-two-plus-best');
    expect(retention).toContain('[Parameter(Mandatory)][switch]$Apply');
    expect(retention).toContain('Get-FileHash');
  });

  it('documents overlay-only least privilege and excludes public tunnel fallbacks', () => {
    const readme = script('README.md');
    expect(readme).toContain('用户笔记、反馈、个人词表和本地指标不得进入训练包');
    expect(readme).toContain('direct ≥ 20 Mbps');
    expect(readme).toContain('peer relay ≥ 10 Mbps');
    expect(readme).toContain('不会把训练结果安装到生产 `public`');
    expect(readme).not.toMatch(/建议使用\s*(?:FRP|公网 SSH)/u);

    const policy = script('tailscale-policy.example.hujson');
    expect(policy).toContain('tailscale.com/cap/relay');
    expect(policy).toContain('tag:jotluck-training-node:22');
    expect(policy).not.toContain('"src": ["*"]');
  });
});
