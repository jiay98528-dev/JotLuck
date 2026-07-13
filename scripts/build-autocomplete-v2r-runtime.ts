import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalSha256,
  resolveV2RCacheRoot,
  sha256,
  V2R_REPOSITORY_ROOT,
} from './autocomplete-v2r/index';

const ORT_VERSION = '1.27.0';
const ORT_TAG = `v${ORT_VERSION}`;
const ORT_SOURCE_COMMIT = '8f0278c77bf44b0cc83c098c6c722b92a36ac4b5';
const ORT_REPOSITORY = 'https://github.com/microsoft/onnxruntime.git';
const RUNTIME_LIMIT_BYTES = 12 * 1024 * 1024;
const EXPECTED_PYTHON_VERSION = '3.12.10';
const EXPECTED_CMAKE_VERSION = '3.31.6';
const EXPECTED_NINJA_VERSION = '1.13.0';
const EXPECTED_EMSCRIPTEN_VERSION = '4.0.23';

const BUILD_FLAGS = [
  '--config',
  'MinSizeRel',
  '--build_wasm',
  '--skip_tests',
  '--compile_no_warning_as_error',
  '--disable_wasm_exception_catching',
  '--disable_rtti',
  '--disable_ml_ops',
  '--disable_contrib_ops',
  '--disable_generation_ops',
  '--enable_wasm_simd',
  '--enable_wasm_threads',
  '--include_ops_by_config',
] as const;

interface RuntimeBuildOptions {
  workspaceRoot?: string;
  candidateDir: string;
  cloneIfMissing?: boolean;
}

export async function buildAutocompleteV2RRuntime(options: RuntimeBuildOptions): Promise<string> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const cacheRoot = resolveV2RCacheRoot(workspaceRoot);
  const candidateDir = resolveCacheChild(workspaceRoot, options.candidateDir, 'candidateDir');
  const modelPath = path.join(candidateDir, 'model.int8.onnx');
  const operatorConfigPath = path.join(candidateDir, 'required-operators.config');
  const trainingReportPath = path.join(candidateDir, 'training-report.json');
  const [modelBytes, operatorConfigBytes, trainingReportBytes] = await Promise.all([
    readFile(modelPath),
    readFile(operatorConfigPath),
    readFile(trainingReportPath),
  ]);
  const trainingReport = JSON.parse(trainingReportBytes.toString('utf8')) as {
    schema?: unknown;
    assets?: {
      int8?: { sha256?: unknown };
      operatorConfig?: { sha256?: unknown };
    };
  };
  if (
    trainingReport?.schema !== 'jotluck.autocomplete.v2r-training-report.v1' ||
    trainingReport.assets?.int8?.sha256 !== sha256(modelBytes) ||
    trainingReport.assets?.operatorConfig?.sha256 !== sha256(operatorConfigBytes)
  ) {
    throw new Error('Candidate model/operator config does not match its training report.');
  }

  // Keep the Emscripten toolchain close to the repository root. Its bundled
  // Node archive contains deeply nested npm paths and fails to unpack under
  // the much longer corpus cache path on Windows even with long-path-aware
  // Node/Python binaries.
  const ortSourceRoot = path.join(workspaceRoot, '.v2r', 'toolchains', `onnxruntime-${ORT_TAG}`);
  if (!existsSync(ortSourceRoot)) {
    if (!options.cloneIfMissing) {
      throw new Error('Pinned ONNX Runtime source is missing; pass --clone-if-missing.');
    }
    await mkdir(path.dirname(ortSourceRoot), { recursive: true });
    await runProcess(
      'git',
      [
        'clone',
        '--branch',
        ORT_TAG,
        '--depth',
        '1',
        '--recurse-submodules',
        '--shallow-submodules',
        ORT_REPOSITORY,
        ortSourceRoot,
      ],
      workspaceRoot,
    );
  }
  const sourceCommit = (
    await runProcess('git', ['-C', ortSourceRoot, 'rev-parse', 'HEAD'], workspaceRoot, true)
  ).trim();
  if (sourceCommit !== ORT_SOURCE_COMMIT) {
    throw new Error(`ONNX Runtime source commit mismatch: ${sourceCommit}.`);
  }
  const nodeModuleScopeSha256 = await ensureCommonJsToolchainScope(ortSourceRoot);

  const venvScripts = path.join(cacheRoot, '.venv', 'Scripts');
  const toolchain = await readPinnedBuildToolchain(venvScripts, workspaceRoot);
  const buildScript = path.join(ortSourceRoot, 'build.bat');
  if (!existsSync(buildScript)) throw new Error('Pinned ONNX Runtime build.bat is missing.');
  const buildArguments = [...BUILD_FLAGS, operatorConfigPath, '--parallel'];
  await runWindowsBatch(buildScript, buildArguments, ortSourceRoot, {
    ...process.env,
    PATH: `${venvScripts}${path.delimiter}${process.env.PATH ?? ''}`,
  });

  const builtRuntimePath = await findSingleRuntime(path.join(ortSourceRoot, 'build'));
  const runtimePath = path.join(candidateDir, 'ort-wasm-simd-threaded.reduced.wasm');
  await copyFile(builtRuntimePath, runtimePath);
  const runtimeBytes = await readFile(runtimePath);
  const runtimeBuildWithoutIdentity = {
    schema: 'jotluck.autocomplete.v2r-runtime-build.v1',
    schemaVersion: 1,
    ortVersion: ORT_VERSION,
    ortSourceCommit: ORT_SOURCE_COMMIT,
    modelFormat: 'onnx',
    reducedOperatorBuild: true,
    minimalBuild: false,
    buildConfiguration: 'MinSizeRel',
    buildFlags: [...BUILD_FLAGS],
    parallelBuild: true,
    toolchain: { ...toolchain, emscripten: EXPECTED_EMSCRIPTEN_VERSION },
    nodeModuleScope: {
      mode: 'isolated-commonjs-package',
      sha256: nodeModuleScopeSha256,
    },
    modelSha256: sha256(modelBytes),
    operatorConfigSha256: sha256(operatorConfigBytes),
    runtimeSha256: sha256(runtimeBytes),
    runtimeBytes: runtimeBytes.byteLength,
    runtimeLimitBytes: RUNTIME_LIMIT_BYTES,
    passed: runtimeBytes.byteLength <= RUNTIME_LIMIT_BYTES,
  };
  const runtimeBuildReport = {
    ...runtimeBuildWithoutIdentity,
    reportSha256: canonicalSha256(runtimeBuildWithoutIdentity),
  };
  const reportPath = path.join(candidateDir, 'runtime-build-report.json');
  await writeJsonAtomic(reportPath, runtimeBuildReport);
  if (!runtimeBuildReport.passed) {
    throw new Error(`Reduced ONNX Runtime WASM is ${runtimeBytes.byteLength} bytes (>12 MiB).`);
  }
  return reportPath;
}

async function ensureCommonJsToolchainScope(ortSourceRoot: string): Promise<string> {
  // The project root is ESM. Without a nearer package boundary, Node treats
  // ORT's pinned CommonJS wasm_post_build.js as ESM and the final link fails.
  // This generated, ignored scope file does not patch the pinned ORT source.
  const filePath = path.join(ortSourceRoot, 'package.json');
  const expected = '{"private":true,"type":"commonjs"}\n';
  if (existsSync(filePath)) {
    const existing = await readFile(filePath, 'utf8');
    if (existing !== expected) {
      throw new Error('Pinned ORT checkout has an unexpected package.json scope.');
    }
  } else {
    await writeFile(filePath, expected, { encoding: 'utf8', flag: 'wx' });
  }
  return sha256(expected);
}

async function readPinnedBuildToolchain(
  venvScripts: string,
  workspaceRoot: string,
): Promise<{ python: string; cmake: string; ninja: string }> {
  const pythonOutput = await runProcess(
    path.join(venvScripts, 'python.exe'),
    ['--version'],
    workspaceRoot,
    true,
  );
  const cmakeOutput = await runProcess(
    path.join(venvScripts, 'cmake.exe'),
    ['--version'],
    workspaceRoot,
    true,
  );
  const ninjaOutput = await runProcess(
    path.join(venvScripts, 'ninja.exe'),
    ['--version'],
    workspaceRoot,
    true,
  );
  const python = /^Python\s+([^\s]+)$/mu.exec(pythonOutput.trim())?.[1];
  const cmake = /^cmake version\s+([^\s]+)$/mu.exec(cmakeOutput)?.[1];
  const ninja = ninjaOutput.trim();
  if (
    python !== EXPECTED_PYTHON_VERSION ||
    cmake !== EXPECTED_CMAKE_VERSION ||
    !ninja.startsWith(EXPECTED_NINJA_VERSION)
  ) {
    throw new Error(
      `V2R runtime build toolchain mismatch: python=${python ?? 'missing'}, cmake=${cmake ?? 'missing'}, ninja=${ninja || 'missing'}.`,
    );
  }
  return { python, cmake, ninja };
}

function resolveCacheChild(workspaceRoot: string, value: string, label: string): string {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`${label} must be a repository-relative V2R cache path.`);
  }
  const cacheRoot = resolveV2RCacheRoot(workspaceRoot);
  const resolved = path.resolve(workspaceRoot, value);
  const relative = path.relative(cacheRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped the V2R cache.`);
  }
  return resolved;
}

async function findSingleRuntime(buildRoot: string): Promise<string> {
  const entries = await readdir(buildRoot, { recursive: true, withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isFile() && entry.name === 'ort-wasm-simd-threaded.wasm')
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((entry) => entry.toLocaleLowerCase('en-US').includes('minsizerel'));
  if (matches.length !== 1) {
    throw new Error(`Expected one MinSizeRel WASM runtime, found ${matches.length}.`);
  }
  return matches[0]!;
}

async function runWindowsBatch(
  script: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const command = process.env.ComSpec ?? 'cmd.exe';
  await runProcess(command, ['/d', '/s', '/c', script, ...args], cwd, false, env);
}

async function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  capture = false,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (capture) {
      child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`${command} exited with code ${code} and signal ${signal ?? 'none'}.`));
    });
  });
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

function parseArguments(argv: readonly string[]): RuntimeBuildOptions {
  const options: Partial<RuntimeBuildOptions> = {};
  for (const argument of argv) {
    if (argument === '--clone-if-missing') options.cloneIfMissing = true;
    else if (argument.startsWith('--candidate-dir=')) {
      options.candidateDir = argument.slice('--candidate-dir='.length);
    } else if (argument.startsWith('--workspace-root=')) {
      options.workspaceRoot = argument.slice('--workspace-root='.length);
    } else throw new Error(`Unknown V2R runtime-build argument: ${argument}`);
  }
  if (!options.candidateDir) throw new Error('--candidate-dir is required.');
  return options as RuntimeBuildOptions;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAutocompleteV2RRuntime(parseArguments(process.argv.slice(2)))
    .then((reportPath) => console.log(reportPath))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
