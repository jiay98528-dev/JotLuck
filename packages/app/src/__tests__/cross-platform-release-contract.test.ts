import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 跨平台发行契约（波次4 P1–P8 的配置/资产/源码级钉子）。本机 Windows 无法
// 执行 macOS/Linux 行为，这里的静态断言 + Rust 单测共同构成回归防线；行为面
// 由 linux-preview-pack.sh（Linux 主机）与 macOS 冒烟承接。
// 注意：同目录契约历史上也有挂在 scripts/__tests__（vitest.scripts.config）
// 的先例；本文件按 vitest 默认配置（include src/**）直接可跑的要求落在
// packages/app/src/__tests__，两者断言不得冲突。
// packages/app/src/__tests__ → 上溯四级到仓库根（__tests__ → src → app → packages → root）。
const projectRoot = path.resolve(import.meta.dirname, '../../../..');
const tauriConfig = JSON.parse(
  readFileSync(path.join(projectRoot, 'packages/app/src-tauri/tauri.conf.json'), 'utf8'),
) as {
  bundle?: {
    fileAssociations?: unknown;
    macOS?: { minimumSystemVersion?: string; infoPlist?: string };
    linux?: { deb?: { depends?: string[]; desktopTemplate?: string } };
  };
};
const desktopTemplate = readFileSync(
  path.join(projectRoot, 'packages/app/src-tauri/installer-assets/linux/jotluck.desktop'),
  'utf8',
);
const cargoToml = readFileSync(path.join(projectRoot, 'packages/app/src-tauri/Cargo.toml'), 'utf8');
const libRs = readFileSync(path.join(projectRoot, 'packages/app/src-tauri/src/lib.rs'), 'utf8');
const fsOpsRs = readFileSync(
  path.join(projectRoot, 'packages/app/src-tauri/src/fs_ops.rs'),
  'utf8',
);
const infoPlist = readFileSync(path.join(projectRoot, 'packages/app/src-tauri/Info.plist'), 'utf8');

describe('cross-platform release contract', () => {
  it('desktop Exec carries the %f field code so GLib lists JotLuck in Open With', () => {
    // P2：GLib GDesktopAppInfo 的 supports_files 只认 Exec 字段码——
    // 没有 %f/%F 时「打开方式」菜单不列出本应用，MimeType 声明形同虚设。
    expect(desktopTemplate).toMatch(/^Exec=\{\{exec\}\} %f$/m);
  });

  it('pins macOS minimumSystemVersion to the WebKit engine baseline', () => {
    // P3 定值依据（2026-10 源内审计）：oklch() 与 Array.prototype.at 需
    // Safari 15.4（tokens.css/useDialogFocus 等）；color-mix(in oklch, …)
    // 需 16.2（main.css 与大量组件）；相对色语法
    // oklch(from var(--…) l c h / …) 需 16.4（editor.css 的 caption/阴影
    // 透明度派生）——16.4 为最高要求。macOS 13.3 起系统自带 Safari ≥ 16.4
    // （Ventura 起 Safari 随 OS 更新分发），故 LSMinimumSystemVersion 提至
    // 13.3；旧值 11.0 会让 Big Sur 用户装上后界面大面积丢色/错乱。
    expect(tauriConfig.bundle?.macOS?.minimumSystemVersion).toBe('13.3');
  });

  it('deb depends floors libwebkit2gtk-4.1-0 at 2.40 for color-mix', () => {
    // P4：color-mix() 需 WebKitGTK 2.40（对应 Safari 16.2 引擎基线）；无
    // 下限时老发行版（如 Ubuntu 22.04 的 2.38）装得上但样式崩坏。
    expect(tauriConfig.bundle?.linux?.deb?.depends).toContain('libwebkit2gtk-4.1-0 (>= 2.40)');
  });

  it('drops the unused tray-icon feature and its libayatana deb dependency', () => {
    // P7：全项目（Rust/前端）零托盘调用，tray-icon feature 与 deb 的
    // libayatana-appindicator3-1 均为冗余装机负担。
    expect(cargoToml).not.toMatch(/tray-icon/);
    expect(tauriConfig.bundle?.linux?.deb?.depends).not.toContain('libayatana-appindicator3-1');
  });

  it('consumes RunEvent::Opened instead of discarding AppleEvent delivery', () => {
    // P1：macOS Finder/拖拽投递的文件经 AppleEvent 到达 RunEvent::Opened，
    // Builder::run 的空回调会把事件整批丢弃。Windows 本机无法执行
    // macOS 行为，此断言静态钉住事件接线（URL 过滤逻辑由 Rust 单测
    // opened_files_from_urls_keeps_supported_local_files_only 覆盖）。
    expect(libRs).toMatch(/RunEvent::Opened/);
    expect(libRs).toMatch(/fn handle_macos_opened_urls/);
  });

  it('startup external-file failure degrades gracefully instead of failing setup', () => {
    // P5：setup 内外链打开失败曾以 ? 传播令 Builder 退出（应用拒启）；
    // 现由 open_startup_main_window 内部降级回 ensure_workspace(main)。
    // 行为由 Rust 单测 startup_main_window_survives_external_file_open_failure
    // 钉住，此断言钉住调用面（setup 不再直接传播该错误）。
    expect(libRs).toContain('open_startup_main_window(app.handle(), &startup_files)?');
    expect(libRs).not.toMatch(
      /open_external_file_in_window\(app\.handle\(\), first, Some\("main"\)\)\?/,
    );
  });

  it('unix replace_file syncs the parent directory after rename', () => {
    // P8：非 Windows rename 后 fsync 父目录（对齐 Windows WRITE_THROUGH
    // 的掉电语义）。Windows 本机只执行 helper 单测（Windows 生产路径
    // MoveFileExW 不变），此断言静态钉住 Unix 分支的组合关系。
    expect(fsOpsRs).toMatch(
      /#\[cfg\(not\(windows\)\)\]\s*fn replace_file[\s\S]*?sync_parent_directory\(target\)/,
    );
  });
});

describe('macOS bundle file association contract', () => {
  // bundle.fileAssociations 是全局开关：开启后 Tauri 的 NSIS 打包器会用
  // 内建注册（APP_ASSOCIATE 同源路径）覆盖当前默认 ProgID，直接违反
  // scripts/__tests__/installer-file-association-contract.test.ts 的 Windows
  // 契约；linux-preview-pack.sh 也有同款 grep 门禁。macOS 侧改用
  // tauri.conf.json 同目录 Info.plist（bundle.macOS.infoPlist 显式接线）
  // 合并注入 CFBundleDocumentTypes——只影响 macOS bundle，Windows/Linux
  // 打包零变化。文件投递由 lib.rs 消费 RunEvent::Opened 接管（P1）。
  it('declares file types via Info.plist merge instead of bundle.fileAssociations', () => {
    expect(tauriConfig.bundle?.fileAssociations).toBeUndefined();
    expect(tauriConfig.bundle?.macOS?.infoPlist).toBe('Info.plist');
    expect(infoPlist).toContain('<key>CFBundleDocumentTypes</key>');
  });

  it.each(['md', 'markdown', 'mdx', 'txt', 'docx', 'pdf', 'xlsx', 'xls'])(
    'declares %s as an openable document type on macOS',
    (extension) => {
      expect(infoPlist).toContain(`<string>${extension}</string>`);
    },
  );

  it('registers as an alternate handler without claiming default ownership', () => {
    // LSHandlerRank=Alternate：只在「打开方式」里出现，不抢占默认应用——
    // 与 Windows 契约「不接管 UserChoice/默认 ProgID」同构。
    expect(infoPlist).not.toContain('<string>Owner</string>');
    const ranks = [...infoPlist.matchAll(/<key>LSHandlerRank<\/key>\s*<string>([^<]+)<\/string>/g)];
    expect(ranks.length).toBeGreaterThan(0);
    for (const rank of ranks) {
      expect(rank[1]).toBe('Alternate');
    }
  });
});
