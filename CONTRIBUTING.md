# Contributing to JotLuck

感谢你愿意帮助改进 JotLuck。缺陷报告、真实使用场景和范围清晰的代码改进都很有价值。

## 开始之前

1. 阅读 [产品原则](./PRODUCT.md) 和 [已知限制](./KNOWN_LIMITATIONS.md)。
2. 搜索现有 [Issues](https://github.com/jiay98528-dev/JotLuck/issues)，避免重复工作。
3. 较大的功能或架构变化请先创建 Feature request，确认方向后再实现。
4. 不要把真实笔记、个人路径、凭据或其他敏感数据加入测试和提交记录。

## 本地开发

环境要求：

- Node.js 20+
- pnpm 9+，仓库当前锁定 pnpm 11.x
- Rust 1.88+，仅桌面开发与打包需要

```powershell
pnpm.cmd install
pnpm.cmd --filter @jotluck/app dev
```

提交代码前至少运行与改动相关的检查：

```powershell
pnpm.cmd --filter @jotluck/app typecheck
pnpm.cmd --filter @jotluck/app test
pnpm.cmd --filter @jotluck/app build
```

涉及 Rust、Tauri、文件读写、导出、主题运行时或发行流程时，请同时阅读仓库内对应规格与验证要求。

## Pull Request 要求

- 一个 Pull Request 只解决一个明确问题。
- 说明用户场景、改动内容、风险和验证方法。
- 产品行为变化应同步更新相关文档和测试。
- 界面变化请附脱敏截图，并覆盖必要的键盘和响应式状态。
- 不提交构建产物、测试报告、临时截图、日志或私人数据。

## 许可证

除非另有明确说明，提交到本仓库并被接受的贡献将按项目当前的 [MIT License](./LICENSE) 提供。提交贡献代表你有权以该协议提供相关内容。

Copyright © 2026 鸰湖科技（深圳）有限公司<br>
Linghu Technology (Shenzhen) Co., Ltd.
