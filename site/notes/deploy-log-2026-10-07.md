# 部署记录：jotluck.com v0.3.0-preview 发布同步

- 日期：2026-10-07（Asia/Singapore）
- 触发 commit：`492949b` docs(tauri): 站点更新日志同步 v0.3.0-preview 发行数据（前序 `f2134d0` 发布准备）
- 内容：v0.3.0-preview（编辑器代际完整版）发布同步——下载页版本/日期/SHA 更新（Windows x64 轮，Linux 区块按可空守卫隐藏，deb 维持 v0.14.0）；更新日志页新增 v0.3.0-preview 条目（GitHub Release 正文经 sync-changelog 同步）；GitHub Release 已上架（含安装包资产，Pre-release）
- 版本目录：`/var/www/jotluck/releases/20261007-492949b`
- current 指向：`releases/20261007-492949b`（原子切换 ln -sfn）
- 产物：dist tarball（32.6 MB），SHA-256 `fec3367b9654f01a5ed503425341b92e805f4c7a61e71553e3a1f3711f122b47`；下载页展示的安装包 SHA-256 `342df185d2024b3c5bdd119f382ce0cb19b880d8dabe3423bdcc67369251ba18`（与 GitHub Release 资产一致）
- 回滚目标：`releases/20260923-25379c6`（ln -sfn 指回即可）
- 上线核验：首页 200 含 0.3.0-preview ✅；`/en/changelog` 200 含 v0.3.0-preview ✅；`/en/download` 含新 SHA ✅；服务器本机 Host 头探测 200 ✅
- 同步方式备注：数据由 `pnpm sync:changelog` 从 GitHub Releases 拉取入库；发行体例见 RELEASE_NOTES.md / CHANGELOG.md 顶部条目（版本编号切换为代际编号，更新说明已向用户解释）
