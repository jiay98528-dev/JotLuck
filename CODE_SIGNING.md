# Code Signing Policy

> 适用于 JotLuck 项目的代码签名策略
> 更新日期：2026-06-13

## 签名服务

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## 签名范围

本策略适用于 JotLuck 项目的以下发布产物：

- Windows `.msi` 安装包（NSIS）
- Windows `.exe` 可执行文件
- macOS `.dmg` 磁盘映像
- Linux `.AppImage` 可执行包

## 团队职责

| 角色          | 成员                                               | 职责             |
| ------------- | -------------------------------------------------- | ---------------- |
| **Authors**   | [@jiay98528-dev](https://github.com/jiay98528-dev) | 开发与提交代码   |
| **Reviewers** | [@jiay98528-dev](https://github.com/jiay98528-dev) | 审查代码变更     |
| **Approvers** | [@jiay98528-dev](https://github.com/jiay98528-dev) | 授权发布签名请求 |

> 以上角色定义于 GitHub 仓库：https://github.com/jiay98528-dev/MarkLuck

## 签名流程

1. 所有发布产物由 CI（GitHub Actions）自动构建
2. 构建产物提交至 SignPath 进行签名
3. Approver 手动审核并批准签名请求
4. 签名后的产物发布到 GitHub Releases

## 隐私声明

JotLuck 不收集、不存储、不上传任何用户数据。所有笔记数据完全存储于用户本地设备。

- 无遥测或分析跟踪
- 无用户账户或云端服务
- 无网络通信（除用户主动触发的更新检查外）
- 代码签名仅用于验证发布产物的真实性和完整性

## 构建可验证性

JotLuck 使用可重现构建（reproducible builds）。所有签名产物均可通过以下方式验证：

```bash
# 验证签名
signtool verify /pa /v JotLuck.msi

# 产物由 GitHub Actions 工作流自动构建
# 工作流定义：.github/workflows/ci.yml
```

## 证书撤销

如发现签名被滥用或安全事件，请联系 SignPath Foundation 进行证书撤销。
