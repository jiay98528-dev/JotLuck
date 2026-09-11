# 部署记录：jotluck.com macOS Apple Silicon 下载入口与 0.14.0 dmg 上线

- 日期：2026-09-11(Asia/Shanghai)
- 触发 commit：`741138d` docs: 登记 macOS 0.14.0 预览发布——CHANGELOG 哈希与五语下载入口
- 内容：五语下载页 macOS Apple Silicon 入口（平台状态/按钮/SHA 区块）上线；macOS 移植批次（双击打开/中文菜单/关窗驻留/拖放/启动日志/NFC/⌘ 文案/平台门控）随同发布
- 版本目录：`/var/www/jotluck/releases/20260911-741138d`
- current 指向：`releases/20260911-741138d`(原子切换 ln -sfn + mv -T)
- 产物：dist tarball 35MB（gzip 内 30,932 字节首页），SHA-256 `f8991c92946c6c15800bd90fe4e454d5fa1f5a4a1a47a518f49d384afee9104d`
- 回滚目标：`releases/20260910-c228c44`(ln -sfn 指回 + mv -T 即可)
- 上线核验：五语首页 ✅ ×5；zh/en 下载页 200 ✅；下载页 macOS 入口（按钮/SHA fb10381d…/平台状态）✅；www 301 ✅；zh changelog 200(/zh/changelog) ✅
- Release 同步：v0.14.0-preview 新增资产 `JotLuck_0.14.0_aarch64.dmg`(41,242,396 字节，SHA-256 `fb10381d0c0e199921ba691a32db7e52910060cb59a2aab8a0735ad5fd10e1c6`)，body 增补 macOS Apple Silicon preview 段（下载往返哈希核验一致）；分支 mac-port(12 提交)已推送 origin

## 同日第二次部署：官网文案与现状同步（deec3de）

- 触发 commit：`deec3de` fix(config): 官网文案与 0.14.0 三平台现状同步
- 版本目录：`/var/www/jotluck/releases/20260911-deec3de`（current 已切换；回滚指回 `releases/20260911-741138d`）
- 内容：五语下载/更新日志页 meta 去 Windows 限定；signNote 五语补 macOS ad-hoc 右键打开；扩展名计数 4→8；JSON-LD operatingSystem/keywords 三平台；changelog 数据重同步（0.14.0 含 macOS/Linux 段+dmg SHA）；sitemap lastmod → 2026-09-11
- 上线核验：五语下载页三处检查全过；changelog macOS 段 ✅；JSON-LD "Windows, macOS, Linux" ✅；sitemap download lastmod 2026-09-11 ✅
- 分支：deec3de 已推送（--force-with-lease 覆盖被 amend 重写的 7d9800c，内容为 7d9800c+文案修复的合并）

## 同日第三次部署：下载页三平台官方图标（6a528f4）

- 触发 commit：`6a528f4` feat(ui): 下载页三平台按钮增加官方图标
- 版本目录：`/var/www/jotluck/releases/20260911-6a528f4`（回滚指回 `releases/20260911-deec3de`）
- 内容：Windows 四格窗/macOS Apple/Linux Tux 内联 SVG（simple-icons，currentColor，15px 与 gh-icon 同规则）；排版复用 .pv-actions flex 语义零新增规则
- 上线核验：zh/en/fr 下载页 pf-icon 各 4 处（3 按钮 SVG + 1 样式类）✅；本地视觉终审截图通过（三图标齐全/对齐协调/整组整齐）
