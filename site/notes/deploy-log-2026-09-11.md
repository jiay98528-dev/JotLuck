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
