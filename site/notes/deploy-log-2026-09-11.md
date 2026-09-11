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

## 同日第三次部署：官网接入匿名访问统计（23c8bef，surface）

- 触发 commit：`23c8bef` feat(config): 官网接入自托管匿名访问统计（Umami，无 Cookie）并同步五语隐私文案（分支 `surface/jotluck-analytics`，基于 mac-port 7103878；已推送 origin，待合入）
- 内容：site/index.html 全站挂 `https://analytics.leankom.com/script.js`（defer + data-website-id `8912220a-cdb6-4069-b738-2cf8fa81b5da`）；五语隐私段同步（标题→「你的访问保持匿名」系列；正文改为匿名统计、不识别个人、不跨站、不传第三方；zh meta 去「分析追踪」微调）
- 版本目录：`/var/www/jotluck/releases/20260911-23c8bef`（current 已切换；回滚指回 `releases/20260911-deec3de`）
- 产物：`jotluck-site-20260911-23c8bef.tar.gz`（32,636,830 字节；SHA-256 `93e8e65915e197783b8ec6e1c6706dc8f3710a2e08c222c946105fcc95becef9`）
- 构建：surface pnpm build（vite-ssg + postbuild），dist 80 文件 / 32 HTML；verify-dist 967/970（3 项既有 FAIL：zh changelog 63 字、en download 186 字、fr download 197 字 description 越界，源自 deec3de，未扩大、不属本次）
- 上线核验：16 URL 全 200（五语首页/privacy/download/changelog/themes/studio + sitemap/robots）；tracker 五语页面就位 ✅；zh/en 隐私文案生效 ✅；活站 zh 首页与本地 dist 逐字节一致（断行 diff 为空）✅
- 采集链修复（HK，REGISTRY 已登记 CLAIM→DONE）：采集端 nginx 对 OPTIONS 预检返回 405 → 浏览器跨域上报一直被 CORS 拦截（三站同病）。修复：/api/send 与 /api/record 放行 OPTIONS（备份 `leankom-analytics.conf.bak-cors-20260911`）
- 端到端核验：公网 OPTIONS 204 + `ACAO:*`；Playwright 真浏览器 e2e（/zh/ + /zh/download）script.js、api/send 全 200、pageview 入库（country=SC 正常）；测试数据已清理
- 待办：① `surface/jotluck-analytics` 合入 mac-port（否则下次 Mac 部署将覆盖统计脚本）；② 会话回放 recorder 如需另行设计同意提示条；③ 五语隐私文案措辞请过目
