# Code Signing Policy

> JotLuck 项目 Windows 发布产物的代码签名政策
> 更新日期：2026-08-14

## 当前状态

JotLuck 目前尚未配置 Windows 代码签名证书。公开发布的安装包（包括
`v0.11.0-preview`、`v0.11.2-preview` 与 `v0.12.0-preview`）均为未签名产物，Windows SmartScreen 可能显示未知发布者警告；
安装前请核对发布页公布的 SHA-256 校验值。

JotLuck 的 Windows 代码签名正在处理中。在签名流程启用之前，所有下载入口都会明确标注未签名状态。

`v0.11.0-preview` 发布于签名申请之前，没有对应的公开 CI 构建记录。首个签名
版本将按下文流程，从精确 commit 经 GitHub Actions 以可验证方式构建。

## 签名服务状态

代码签名正在处理中。

当前 `v0.12.0-preview` 安装包未签名；它绑定 commit
`094d99071d8a2daa74e75045644ef438ab18729a`，公开安装包 SHA-256 为
`a13ee468e77c17f238d57fd17f9951cd51b95f0a1060ec020f4d3cb513a873be`。

## 签名范围

本政策适用于 JotLuck 项目的以下发布产物：

- Windows NSIS `.exe` 安装包
- 安装包内的 Windows `.exe` 可执行文件

macOS 与 Linux 版本尚未进入正式打包与签名范围。

## 团队职责

| 角色          | 成员                                               | 职责             |
| ------------- | -------------------------------------------------- | ---------------- |
| **Authors**   | [@jiay98528-dev](https://github.com/jiay98528-dev) | 开发与提交代码   |
| **Reviewers** | [@jiay98528-dev](https://github.com/jiay98528-dev) | 审查代码变更     |
| **Approvers** | [@jiay98528-dev](https://github.com/jiay98528-dev) | 授权发布签名请求 |

> 以上角色对应 GitHub 仓库权限组：https://github.com/jiay98528-dev/JotLuck

## 签名流程

签名服务获批后，每个签名版本的发布流程为：

1. 发布产物由 CI（GitHub Actions）从精确候选 commit 构建
2. 构建产物提交至已批准的签名服务
3. Approver 审核并批准签名请求
4. 对返回产物执行 Authenticode 验证并重新计算 SHA-256
5. 签名后的产物与校验值发布到 GitHub Releases

## 隐私声明

JotLuck 不收集、不存储、不上传任何用户数据。所有笔记数据完全存储于用户本地设备。
完整说明见 [隐私政策](./PRIVACY.md)。

- 无遥测或分析跟踪
- 无用户账户或云端服务
- 无网络通信（除用户主动触发的更新检查外）
- 代码签名仅用于验证发布产物的真实性与完整性

This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it.

## 产物验证

每个签名版本发布时，将同时公开签名验证输出、签名后文件的 SHA-256、候选
commit 与对应的 CI run，可在发布页直接核对。

```bash
# 当前 preview 安装包（未签名）：核对 SHA-256
certutil -hashfile V12-preview_x64-setup.exe SHA256

# 签名版本发布后：验证 Authenticode 签名
signtool verify /pa /v JotLuck_<version>_x64-setup.exe

# 签名产物由 GitHub Actions 工作流自动构建
# 工作流定义：.github/workflows/ci.yml
```

## 证书撤销

如发现与 JotLuck 相关的签名被滥用或涉及安全事件，请向 SignPath Foundation
（support@signpath.io）报告；项目方将配合核实、调查与处理。
