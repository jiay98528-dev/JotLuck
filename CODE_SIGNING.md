# Code Signing Policy

> 适用于 JotLuck 项目的代码签名策略
> 更新日期：2026-07-27

## 当前状态

JotLuck 当前尚未取得或配置可用于正式发行的 Windows 代码签名证书。项目优先申请
[SignPath Foundation](https://signpath.org/) 的开源项目签名服务；在申请获批并完成真实
产物验证前，不得把安装包描述为“已签名”。

## 签名范围

本策略适用于 JotLuck 项目的以下发布产物：

- Windows NSIS `.exe` 安装包
- 安装包内的 Windows `.exe` 可执行文件

macOS 与 Linux 尚未进入正式打包和签名范围。

## 团队职责

| 角色          | 成员                                               | 职责             |
| ------------- | -------------------------------------------------- | ---------------- |
| **Authors**   | [@jiay98528-dev](https://github.com/jiay98528-dev) | 开发与提交代码   |
| **Reviewers** | [@jiay98528-dev](https://github.com/jiay98528-dev) | 审查代码变更     |
| **Approvers** | [@jiay98528-dev](https://github.com/jiay98528-dev) | 授权发布签名请求 |

> 以上角色定义于 GitHub 仓库：https://github.com/jiay98528-dev/JotLuck

## 签名流程

证书或托管签名服务获批后，正式流程为：

1. 发布产物由 CI（GitHub Actions）从精确候选 commit 构建
2. 构建产物提交至已批准的签名服务
3. Approver 审核并批准签名请求
4. 对返回产物执行 Authenticode 验证并重新计算 SHA-256
5. 签名后的产物和校验值发布到 GitHub Releases

## 隐私声明

JotLuck 不收集、不存储、不上传任何用户数据。所有笔记数据完全存储于用户本地设备。

- 无遥测或分析跟踪
- 无用户账户或云端服务
- 无网络通信（除用户主动触发的更新检查外）
- 代码签名仅用于验证发布产物的真实性和完整性

## 产物验证

正式发布必须保存签名验证输出、签名后文件的 SHA-256、候选 commit 和对应 CI run。

```bash
# 验证实际 NSIS 安装包
signtool verify /pa /v JotLuck_0.1.0-preview_x64-setup.exe

# 产物由 GitHub Actions 工作流自动构建
# 工作流定义：.github/workflows/ci.yml
```

## 证书撤销

如发现签名被滥用或安全事件，请联系 SignPath Foundation 进行证书撤销。
