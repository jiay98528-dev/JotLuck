# Code Signing Policy

> JotLuck 项目桌面发布产物的代码签名政策
> 更新日期：2026-09-17

## 当前状态

`v0.15.0-preview` 是本轮仅面向 macOS Apple Silicon 的预览版本。DMG 使用
ad-hoc 签名但尚未 notarize；首次打开时可能需要右键应用选择“打开”。Windows
x64 与 Linux x86_64 继续保留归档的 `v0.14.0-preview` 未签名产物，安装前请核对
对应 GitHub Release 与官网清单中的 SHA-256 校验值。

首个签名版本将按下文流程，从精确 commit 经 GitHub Actions 以可验证方式构建。

## 签名范围

本政策适用于 JotLuck 项目的以下发布产物：

- Windows NSIS `.exe` 安装包
- 安装包内的 Windows `.exe` 可执行文件

macOS v0.15 Preview 已进入 Apple Silicon 打包范围，但仍未进行 Apple notarization。
Linux x86_64 预览 `.deb` 继续使用归档的 `v0.14.0-preview`，同样未签名；校验以
SHA-256 为准。

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

JotLuck 不收集、不存储、不上传笔记内容、文件名、路径、账户标识或设备唯一标识。所有笔记数据完全存储于用户本地设备。用户开启更新检查后，应用会读取官网的公开版本清单并向 GitHub 请求公开 Release 元数据；请求包含所查询的公开 Release 标识和标准 HTTP 技术信息，当前版本比较和平台选择在本地完成。官网与 GitHub 可能看到请求 IP 和时间，具体以各自隐私政策为准。
完整说明见 [隐私政策](./PRIVACY.md)。

- 无遥测或分析跟踪
- 无用户账户或云端服务
- 无网络通信（除用户开启或主动触发的更新检查外）
- 代码签名仅用于验证发布产物的真实性与完整性

官网更新清单地址为 `https://jotluck.com/updates/v1.json`，目标 HTTP 缓存时间为 5 分钟。清单中的 SHA-256 用于下载后完整性核对；它不能替代 Windows Authenticode、macOS notarization 或其他平台签名。

This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it.

## 产物验证

每个签名版本发布时，将同时公开签名验证输出、签名后文件的 SHA-256、候选
commit 与对应的 CI run，可在发布页直接核对。

```bash
# 归档 Windows preview 安装包：核对 SHA-256
certutil -hashfile JotLuck_0.14.0_x64-setup.exe SHA256

# v0.15 macOS Apple Silicon DMG：使用 shasum 核对 GitHub Release/官网清单值
shasum -a 256 JotLuck_0.15.0-preview_aarch64.dmg
codesign --verify --deep --strict --verbose=2 JotLuck.app

# 签名版本发布后：验证 Authenticode 签名
signtool verify /pa /v JotLuck_<version>_x64-setup.exe

# 签名产物由 GitHub Actions 工作流自动构建
# 工作流定义：.github/workflows/ci.yml
```

## 证书撤销

签名证书启用后，如发现与 JotLuck 相关的签名被滥用或涉及安全事件，请通过
[GitHub Issues](https://github.com/jiay98528-dev/JotLuck/issues) 报告；证书签发
机构的撤销通道将随首个签名版本一并公布。
