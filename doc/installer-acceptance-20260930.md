# Windows 安装包实际验收报告（0.14.0 NSIS）

日期：2026-09-30 | 安装包：`JotLuck_0.14.0_x64-setup.exe`（21.9 MB）| SHA-256：`6f823d4598174067fc50acb7e565abacf98dac36eac6287f8150ffbefd479321` | 机器：本机 Windows x86_64（无触摸屏）

> 说明：安装包构建自审计处置提交（5d4fd9c）之前的功能批次代码；随后两个提交（审计处置 5d4fd9c 后的清理与远端 Linux 线合并 70478a3）不涉及安装/启动/关联/重启/卸载流程行为，流程级验收结论不受影响。

## 结论：全流程通过，附一项低优先级发现

| 阶段              | 操作                                                                                             | 结果                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 静默安装          | `setup.exe /S`（currentUser 模式）                                                               | ✅ 程序落 `%LOCALAPPDATA%\JotLuck`（jotluck.exe 10.2 MB + uninstall.exe + V2.5 引擎资产 autocomplete/autocomplete-v25 + 图标）；注册表卸载项（JotLuck 0.14.0）✅；开始菜单快捷方式 ✅；ProgId（JotLuck.Note / JotLuck.DocumentImport）注册 ✅ |
| 文件关联          | 注册表核对（五组约 8 扩展：markdown .md/.markdown/.mdx、text .txt、word .docx、pdf .pdf、excel） | ✅ ProgId 就绪、不抢占系统默认（`.md` UserChoice 未被改写——符合「不强制接管」设计；用户经应用内「默认应用」入口自行启用）                                                                                                                     |
| 启动 + 真窗口冒烟 | tauri WebDriver（Edge WebView2 154）驱动**安装版** GUI 全流程                                    | ✅ 证据 `installed-smoke-evidence-0930b.json`：status=pass；Unicode 中文文件名笔记经文件抽屉打开、marker 全程一致；68 事件/31 命令；生产构建无调试桥（hasProductionE2EBridge=false）✅；V2.5 引擎 sha 校验在位                                |
| 重启持久化        | WebView reload 前后状态                                                                          | ✅ afterReload appMounted=true、tauri.localhost 生产源、引擎清单可读                                                                                                                                                                          |
| 静默卸载          | `uninstall.exe /S`                                                                               | ✅ 注册表卸载项清除、开始菜单快捷方式清除、程序本体移除；⚠️ 发现：`%LOCALAPPDATA%\JotLuck\autocomplete` 目录残留（5 KB 空壳，引擎主资产已随目录主体删除）                                                                                     |

## 验收发现（1 项，低优先级）

- **卸载器残留 autocomplete 目录**：卸载后 `%LOCALAPPDATA%\JotLuck\autocomplete` 空目录未清（5 KB）。属程序资产清理遗漏，不影响用户笔记数据；建议 RC 线处理（NSIS 卸载段补 rmdir）。

## 环境备注

- msedgedriver 曾因 Edge 自动更新失配（151 vs 154）导致 WebDriver 起不来；`msedgedriver-tool` 未成功落位，手动下载 154 覆盖 `~/.cargo/bin/msedgedriver.exe` 解决——此坑已记错题本。
- ARM64 实机验证仍不可行（无设备），KO-004 的 ARM64 部分维持待办。

## 证据索引

- 安装包 SHA：`e2e/test-results/installer-sha-0930.txt`
- 冒烟证据：`e2e/test-results/installed-smoke-evidence-0930b.json` + `.webdriver.ndjson`
- 冒烟日志：`e2e/test-results/installed-smoke-0930b.log`
