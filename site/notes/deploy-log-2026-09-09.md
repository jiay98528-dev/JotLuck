# 部署记录:jotluck.com 更新日志页上线

- 日期:2026-09-09(Asia/Singapore)
- 触发 commit:`7b075bc` feat: 新增五语更新日志页——GitHub Releases 同步,下载页与页脚入口
- 内容:五语 `/changelog` 页(GitHub Releases 数据经 sync-changelog.mjs 同步,构建期 marked 渲染);下载页与页脚新增入口
- 版本目录:`/var/www/jotluck/releases/20260909-7b075bc`
- current 指向:`releases/20260909-7b075bc`(原子切换 ln -sfn + mv -T)
- 产物:dist tarball,SHA-256 `44146fb97e11eafaf4393c00711f96946c4a8b7574f1f06d391cf696d703199d`
- 回滚目标:`releases/20260908-273f5d8`(ln -sfn 指回 + mv -T 即可)
- 上线核验:五语 /changelog ✅(各语标记命中);下载页 v0.14.0 ✅;首页补全区块 ✅;门页 200 ✅
- 同步方式备注:数据由 `pnpm sync:changelog` 从 GitHub Releases 拉取并提交入库;后续每次发行后重跑一次即可
