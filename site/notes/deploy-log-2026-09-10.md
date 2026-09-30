# 部署记录：jotluck.com Linux 下载入口与 0.14.0 重发布同步

- 日期：2026-09-10(Asia/Singapore)
- 触发 commit：`c228c44` docs: 0.14.0 重发布登记——最终 deb SHA 与字节数同步
- 内容：五语下载页 Linux x86_64 入口与最终 SHA 上线；补全引擎资产修复与平台兼容批次随同发布
- 版本目录：`/var/www/jotluck/releases/20260910-c228c44`
- current 指向：`releases/20260910-c228c44`(原子切换 ln -sfn + mv -T)
- 产物：dist tarball 32,626,874 字节，SHA-256 `3f2e49e0c96023f7c028ee6e9361e89705104bb1a25e091f079501121ffbe7a6`
- 回滚目标：`releases/20260909-7b075bc`(ln -sfn 指回 + mv -T 即可)
- 上线核验：五语首页 ✅;zh/en 下载页 200 ✅;下载页 Linux x86_64 入口 ×3 ✅;页面 SHA `3d5f7b70…` ✅;zh changelog 200 ✅
- Release 同步：v0.14.0-preview 资产已替换为最终 deb(39,678,902 字节，SHA-256 `3d5f7b709c0eaf9fea2877593696c30cbc15f0a640733d208a040d8fc3a3ed77`)，body 英/中 SHA 与字节数已更新
