# 部署记录:jotluck.com 文本补全区块上线

- 日期:2026-09-08(Asia/Singapore)
- 触发 commit:`273f5d8` docs: 首页新增「文本补全」区块——自研本地补全五语上线
- 内容:首页五语「文本补全」区块(自研本地补全 + 动态学习 + 设置开关);下载页保持 v0.14.0 Preview 口径
- 版本目录:`/var/www/jotluck/releases/20260908-273f5d8`
- current 指向:`releases/20260908-273f5d8`(原子切换 ln -sfn + mv -T)
- 产物:dist tarball 32,527,662 字节,SHA-256 `bc1ce8abc0812346e0d111cc2291425b2be22e9bc47f7bca2dc69e1034768e6f`
- 回滚目标:`releases/20260905-5559e82`(ln -sfn 指回 + mv -T 即可)
- 上线核验:五语首页补全区块 ✅;zh 动态学习句 ✅;下载页 v0.14.0 ✅;www 301 ✅;门页 200 ✅
