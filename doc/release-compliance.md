# MarkLuck 发行合规与操作流程

版本：v1.0
日期：2026-06-30
适用对象：MarkLuck 两人公司（1 开发 + 1 商务）
说明：本文用于发行准备和内部执行，不替代正式律师意见或税务意见。

## 1. 目标

这份文档回答三个问题：

1. 以当前代码和文档状态，MarkLuck 离“可公开发行”还差哪些合规项。
2. 哪些事项会阻塞首发，哪些可以在首发后补。
3. 以两人团队为前提，发行前后应该按什么顺序执行。

本文只基于当前仓库真实状态规划，不把尚未落地的移动端、在线账号、真实主题商店、云同步、多人协作写成首发前提。

## 2. 当前项目事实

以下事实可直接从仓库文档和代码确认：

- 产品定位仍然是“本地优先、离线可用、纯文本文件笔记工具”。见 [PRODUCT.md](../PRODUCT.md)、[README.md](../README.md)、[doc/PRD.md](./PRD.md)。
- 当前已验证的发行形态是 `Tauri + Windows NSIS` 桌面安装包，且现有验证结论明确写着“当前包仍是 unsigned release package”。见 [KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md)、[memory/release-candidate-final-report.md](../memory/release-candidate-final-report.md)。
- 桌面端会注册 `.md` / `.markdown` / `.mdx` 文件关联，不接管 `.txt`。见 [packages/app/src-tauri/tauri.conf.json](../packages/app/src-tauri/tauri.conf.json)、[README.md](../README.md)。
- 应用当前存在一个真实联网点：GitHub Releases 版本检查。代码位于 [packages/app/src/composables/useVersionCheck.ts](../packages/app/src/composables/useVersionCheck.ts) 与 [packages/app/src/components/modals/SettingsDialog.vue](../packages/app/src/components/modals/SettingsDialog.vue)。欢迎页文案已经写明“仅查询 GitHub 公开版本号，不上传任何笔记内容”。见 [packages/app/src/pages/WelcomePage.vue](../packages/app/src/pages/WelcomePage.vue)。
- 桌面端当前启用了较宽的 Tauri 权限：文件系统读写、对话框、`shell.open`、`process`。见 [packages/app/src-tauri/capabilities/default.json](../packages/app/src-tauri/capabilities/default.json)。
- Tauri 配置当前 `csp` 为 `null`。见 [packages/app/src-tauri/tauri.conf.json](../packages/app/src-tauri/tauri.conf.json)。
- 主题系统允许导入本地 `.mltheme` / `.zip`，并支持 `trusted-code` 主题 runtime；当前策略是不做权限审批、沙箱隔离或社区治理。见 [doc/PRD.md](./PRD.md)、[doc/TAD.md](./TAD.md)、[doc/standards-theme-development.md](./standards-theme-development.md)。
- 导入的本地 `trusted-code` 主题目前默认直接授权，且通过 `Blob` + `import()` 执行。见 [packages/app/src/services/ThemePackInstaller.ts](../packages/app/src/services/ThemePackInstaller.ts)、[packages/app/src/services/ThemeRuntimeHost.ts](../packages/app/src/services/ThemeRuntimeHost.ts)。
- 当前代码里没有真实支付、真实账号、真实远程主题商店；`ThemeCommerceProvider` 仍是本地 mock。见 [packages/app/src/services/ThemeCommerceProvider.ts](../packages/app/src/services/ThemeCommerceProvider.ts)、[spec/progress.md](../spec/progress.md)。
- 应用会在本机写入若干本地数据：最近笔记本、主题状态、主题授权 mock、欢迎页状态、更新检查状态、外部扫描设置，以及 `LOCALAPPDATA/MarkLuck/logs/startup-error.log`。见 [packages/app/src/services/TauriIPCService.ts](../packages/app/src/services/TauriIPCService.ts)、[packages/app/src/services/ThemePackInstaller.ts](../packages/app/src/services/ThemePackInstaller.ts)、[packages/app/src/services/ThemeCommerceProvider.ts](../packages/app/src/services/ThemeCommerceProvider.ts)、[packages/app/src-tauri/src/lib.rs](../packages/app/src-tauri/src/lib.rs)。
- 当前版本号材料不一致：`package.json` / `tauri.conf.json` / `README.md` / `RELEASE_NOTES.md` 使用 `0.15.0` 或 `v0.15`，但 [KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md) 与 [memory/release-candidate-final-report.md](../memory/release-candidate-final-report.md) 使用 `0.3.0-rc.1`。这会直接影响对外发行身份。

## 3. 首发建议结论

结合当前产品边界，首发最稳的发行形态应当是：

- 首发范围：`Windows x64 桌面版`
- 发行性质：`公开 Beta / RC`，不是“已完成全部签名与全平台验证的稳定版”
- 收费入口：`官网/平台页收款`，不是应用内嵌真实支付
- 默认网络策略：`手动检查更新或用户显式开启后再联网`
- 风险功能策略：
  - 推荐首发时关闭或隐藏“导入任意 trusted-code 主题”
  - 若不关闭，则必须把它改成“开发者实验功能 + 明示风险 + 单独确认”

原因很直接：当前最大的发行风险不是笔记功能，而是“桌面包信任链 + 本地代码主题执行 + 对外材料缺失”。

## 4. 合规项目分级

### 4.1 P0：首发阻塞项

以下事项建议在公开发行前完成，否则不应把产品描述为“正式稳定发布”。

| 事项                     | 当前状态                                                                                  | 为什么阻塞                                                           | 负责人             | 完成标准                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| 版本与发行身份统一       | 当前存在 `0.15.0` 与 `0.3.0-rc.1` 双版本体系                                              | 用户、支付、发票、客服、下载页、哈希校验都会混乱                     | 开发               | 安装包名、应用内版本、README、Release Notes、Known Limitations、GitHub Release 全部一致 |
| 主题导入风险策略定稿     | 当前 `.mltheme` 可导入，`trusted-code` 默认直接授权                                       | 这本质上是“本地执行第三方代码”能力，必须决定是否对普通用户开放       | 开发 + 商务        | 二选一：A. 正式版关闭/隐藏该功能；B. 保留但有风险提示、确认流、文档披露和实验标签       |
| Tauri 权限最小化         | 当前 `process:default` 已启用，但仓库未见实际使用；`shell.open` 和 `csp: null` 仍偏宽     | 首发前要把“实际不用的能力”去掉，降低审计和信任成本                   | 开发               | 移除未使用插件/权限；形成一份最终权限说明                                               |
| Windows 签名与安装信任链 | 当前已知是 unsigned NSIS installer                                                        | 对公司正式发行来说，未签名安装包会直接影响信任、拦截率和售后解释成本 | 开发 + 商务        | 已获得可用代码签名证书并完成签名验证                                                    |
| 对外政策材料             | 仓库内暂无隐私政策、用户协议/EULA、第三方许可证清单、支持/退款说明                        | 公司主体对外收费或公开分发时，至少要把规则写清楚                     | 商务主责，开发配合 | 文档齐全并挂到下载页、官网、应用“关于”页                                                |
| 发行说明闭环             | README 还引用了不存在的 `memory/release-hardening-execution-log.md`；发行材料版本也不一致 | 发行包说明不完整会直接损害可信度                                     | 开发               | README、Release Notes、Known Limitations、下载页、校验值、安装说明可互相对应            |

### 4.2 P1：首发前强烈建议完成

| 事项                   | 当前状态                                                         | 建议动作                                                       |
| ---------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 联网说明               | 已有 GitHub 更新检查，但缺少正式隐私政策与 FAQ 统一说法          | 把“什么时候联网、请求什么、存什么”写进隐私政策和设置页说明     |
| 本地日志与本地状态说明 | 已存在 `startup-error.log`、最近笔记本、主题状态等本地持久化数据 | 在隐私政策和支持文档中列明路径、用途、删除方式                 |
| WebView2 依赖说明      | 安装器用 WebView2 bootstrapper，离线设备可能失败                 | 下载页增加在线安装版/离线依赖说明；必要时准备离线依赖包策略    |
| 发行证据归档           | 目前验证证据分散在 README、Release Notes、RC report              | 形成“单次发行证据包”：命令结果、截图、哈希、构建时间、签名信息 |
| 投诉/支持入口          | 当前应用“关于”页只有 GitHub 和 MIT 链接                          | 增加官网支持邮箱、工单入口、商务联系和退款说明入口             |

### 4.3 P2：稳定版前后补强项

| 事项                       | 当前状态                     | 说明                                         |
| -------------------------- | ---------------------------- | -------------------------------------------- |
| 软件著作权登记             | 仓库未见相关材料             | 不是发行前硬前提，但建议作为公司资产证明补齐 |
| 商标注册                   | 仓库未见相关材料             | 不是首发阻塞项，但对品牌保护有价值           |
| macOS / Linux 主机实机验证 | 当前仍以 Windows RC 验证为主 | 若外宣跨平台，应补真实验证、签名与打包流程   |
| 安全披露机制               | 仓库未见 `SECURITY.md`       | 建议补安全联系渠道与漏洞处理流程             |

## 5. 当前项目最需要你先做的产品决策

### 5.1 关于“本地代码主题”

这是当前发行判断里的头号变量。

当前实现不是“换颜色的主题”，而是“可导入并执行本地第三方代码的 UX 插件主题”。这和普通主题市场不是一个风险级别。

对首发我建议这样选：

#### 方案 A：正式发行默认关闭

适合：面向普通用户的公开 Windows 首发。

动作：

- 生产构建中隐藏“导入主题文件”入口。
- 生产构建中禁用 `trusted-code` runtime。
- 只保留内置主题与官方主题。

优点：

- 最容易解释产品安全边界。
- 能明显降低安全、售后、误报毒、崩溃归因问题。
- 更适合公司首次公开发行。

#### 方案 B：保留，但降级为实验功能

适合：仍希望保留面向开发者的主题扩展能力。

动作：

- UI 增加显著风险提示。
- 首次导入前弹出一次性确认。
- 文案明确写成“仅导入你信任的主题包，本功能可执行主题作者提供的本地代码”。
- 在隐私政策、用户协议、Known Limitations 中同步披露。
- 把功能标签改成“开发者实验功能”，不写成普通主题能力。

如果不做 A 或 B，而是按当前状态直接公开发行，会让后续所有合规材料都很难自洽。

## 6. 与公司收款和服务器现状相关的合规判断

结合你们当前条件：

- 公司主体：有限责任公司
- 服务器：香港 + 日本
- 经营范围：已覆盖软件服务

可以得出几个直接判断：

1. 当前首发并不需要把“应用内真实支付”作为前提，因为代码里本来也没有真实支付后端。
2. 如果官网继续部署在香港/日本，下载页本身通常不按“中国内地服务器网站备案”路径处理；但一旦未来要在自有官网直接接大陆常规支付，ICP备案和主体一致性要重新评估。
3. 以现阶段的产品形态，最稳的是“下载页/产品页放在境外服务器，收款放在平台页或合同页，应用内只做跳转，不做内嵌支付”。
4. 只要官网、支持表单、支付页、邮件系统会收集邮箱、订单、发票抬头、客服记录，就已经进入个人信息处理范围；如果数据落到香港/日本服务器或第三方境外服务，就要在隐私政策里明确写清楚。

## 7. 首发前必须准备的文档清单

建议在仓库根目录或 `doc/` 下补齐以下文件：

- `PRIVACY.md`
- `TERMS.md` 或 `EULA.md`
- `THIRD_PARTY_NOTICES.md`
- `SUPPORT_AND_REFUND.md`
- `SECURITY.md`
- `RELEASE_CHECKLIST.md`

每个文件至少应覆盖：

### `PRIVACY.md`

- 产品默认离线，本地笔记不上传
- 何时会联网：GitHub 更新检查、下载页、支付页、客服邮箱等
- 会收集哪些数据：订单信息、邮箱、日志、设备基本错误信息
- 本地持久化项：最近笔记本、主题状态、欢迎页状态、更新检查状态、日志路径
- 数据保存地点与第三方服务商
- 用户删除和联系渠道

### `TERMS.md` / `EULA.md`

- 软件按 MIT 开源发布的边界
- 官方发行版、支持计划、模板包、周边的交易规则
- 禁止保证类表述，例如“绝不丢数据”“完全无 bug”
- 实验性功能说明，尤其是主题导入
- 责任限制、适用范围、支持边界

### `THIRD_PARTY_NOTICES.md`

- 前端依赖许可证
- Rust/Tauri 依赖许可证
- 图标、图片、字体、安装器资源来源

### `SUPPORT_AND_REFUND.md`

- 支持渠道
- 响应时效
- 数字商品退款规则
- 实物周边退换货规则
- 企业客户合同与开票流程

### `SECURITY.md`

- 安全问题联系邮箱
- 报告格式
- 响应时间
- 暂不接受的报告范围

## 8. 具体操作流程

下面给出适合两人公司的实际执行顺序。

### 阶段 0：冻结首发范围（D-14 到 D-12）

负责人：商务主导，开发参与

要做的事：

1. 明确首发 SKU：`Windows x64 官方安装包`
2. 明确首发标签：`公开 Beta` 或 `RC`，不要直接叫“稳定正式版”
3. 明确首发发行渠道：
   - GitHub Releases
   - 官网下载页
   - 国内支持页/平台页
4. 明确首发不包含：
   - 移动端
   - 真实主题商店
   - 应用内真实支付
   - 自动更新安装
5. 对“导入 trusted-code 主题”做最终决定：关闭，或实验性保留

输出物：

- 一页发行范围确认单
- 一套统一版本号命名规则

### 阶段 1：工程侧合规收口（D-12 到 D-7）

负责人：开发

要做的事：

1. 统一版本号、安装包名、Release Notes、Known Limitations、README。
2. 审查并收缩 Tauri 权限：
   - 优先检查 `process:default`
   - 复核 `shell:allow-open`
   - 评估是否能恢复非空 CSP
3. 根据第 0 阶段结论处理主题导入能力：
   - 关闭生产导入入口；或
   - 补风险提示、确认框、实验标签
4. 在“关于”页增加正式的政策与支持链接。
5. 整理日志路径、本地状态路径、导出行为、文件关联行为说明。
6. 处理 README 中失效或缺失的发行材料链接。

建议触达文件：

- [packages/app/src-tauri/tauri.conf.json](../packages/app/src-tauri/tauri.conf.json)
- [packages/app/src-tauri/capabilities/default.json](../packages/app/src-tauri/capabilities/default.json)
- [packages/app/src-tauri/src/lib.rs](../packages/app/src-tauri/src/lib.rs)
- [packages/app/src/components/theme/ThemeDialog.vue](../packages/app/src/components/theme/ThemeDialog.vue)
- [packages/app/src/services/ThemePackInstaller.ts](../packages/app/src/services/ThemePackInstaller.ts)
- [packages/app/src/services/ThemeRuntimeHost.ts](../packages/app/src/services/ThemeRuntimeHost.ts)
- [packages/app/src/pages/WelcomePage.vue](../packages/app/src/pages/WelcomePage.vue)
- [packages/app/src/components/modals/SettingsDialog.vue](../packages/app/src/components/modals/SettingsDialog.vue)
- [README.md](../README.md)
- [RELEASE_NOTES.md](../RELEASE_NOTES.md)
- [KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md)

完成标准：

- 功能边界和对外说法一致
- 生产包权限最小化
- 风险功能不再“默认静默开启”

### 阶段 2：商务与法务材料准备（D-10 到 D-5）

负责人：商务主导，开发提供技术事实

要做的事：

1. 编写隐私政策、用户协议/EULA、支持与退款说明。
2. 准备第三方许可证清单。
3. 准备下载页文案：
   - 公司主体信息
   - 支持系统版本
   - 是否签名
   - SHA256
   - WebView2 依赖说明
   - 已知限制
4. 准备收款与开票规则：
   - 国内个人
   - 企业对公
   - 海外个人/团队
5. 准备客服与故障应答模板：
   - 安装失败
   - WebView2 缺失
   - 文件关联失败
   - 导入主题导致异常

完成标准：

- 每一种交易路径都有对应规则说明
- 每一种常见故障都有回复模板

### 阶段 3：签名、构建与验证（D-5 到 D-2）

负责人：开发

要做的事：

1. 获取并配置 Windows 代码签名证书。
2. 运行完整发行闸门：
   - `typecheck`
   - `eslint`
   - `prettier`
   - `stylelint`
   - `vitest`
   - `build`
   - `playwright chromium`
   - `playwright firefox`
   - `cargo check`
   - `cargo audit`（补装后执行）
3. 生成安装包并签名。
4. 重新计算 SHA256。
5. 做一轮“安装包级”人工回归：
   - 全新安装
   - 首次启动欢迎页
   - 文件关联
   - 打开现有笔记本
   - 编辑/保存/导出
   - 更新检查关闭态不联网、开启态可联网
   - 卸载

完成标准：

- 发行包有唯一哈希
- 人工验证记录可复查
- 签名信息可截图留档

### 阶段 4：发布日执行（D-1 到 D0）

负责人：商务 + 开发

要做的事：

1. 创建 GitHub Release，上传安装包和 SHA256。
2. 发布官网下载页与政策页。
3. 核对应用“关于”页链接是否全部可访问。
4. 在支付平台页和商务联系页上线正式文案。
5. 保存发行证据包：
   - 安装包
   - 哈希
   - 签名截图
   - 自动化测试结果
   - GUI 验证记录
   - Release Notes 快照

### 阶段 5：发布后 7 天内（D+1 到 D+7）

负责人：商务主导，开发支持

要做的事：

1. 收集安装失败、支付失败、文件关联失败、误报毒反馈。
2. 观察更新检查和下载页访问是否带来异常请求。
3. 记录退款、售后和咨询问题，回写到 FAQ。
4. 若保留实验性主题导入，单独跟踪这条能力带来的支持工单比例。

## 9. 你们两个人的分工建议

### 开发

- 版本统一
- 权限收缩
- 主题导入策略实现
- 签名与构建
- 校验值生成
- 技术类政策事实提供
- 安装与升级 FAQ 技术部分

### 商务

- 公司主体信息整理
- 收款链路整理
- 开票与合同模板
- 隐私政策/协议初稿
- 官网下载页与购买页文案
- 客服回复模板
- 发布后售后汇总

## 10. 外部依据

以下外部资料与当前发行判断直接相关：

- 支付宝电脑网站支付官方文档：要求网站完成 ICP 备案，且备案主体与签约主体一致
  [https://opendocs.alipay.com/open/270/105898](https://opendocs.alipay.com/open/270/105898)
- 阿里云关于“境外服务器无需走中国内地备案流程”的说明
  [https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/icp-filing-application-for-enterprises-outside-the-chinese-mainland](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/icp-filing-application-for-enterprises-outside-the-chinese-mainland)
- 《中华人民共和国消费者权益保护法实施条例》
  [https://www.gov.cn/zhengce/content/202403/content_6940158.htm](https://www.gov.cn/zhengce/content/202403/content_6940158.htm)
- 《中华人民共和国个人信息保护法》
  [https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)
- 《促进和规范数据跨境流动规定》
  [https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm](https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm)
- 《网络购买商品七日无理由退货暂行办法》
  [https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzbmgz/201701/t20170124_145952.html](https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzbmgz/201701/t20170124_145952.html)
- 国家版权局关于软件著作权登记的官方说明
  [https://www.ncac.gov.cn/xxfb/flfg/bmgz/202410/t20241015_869486.html](https://www.ncac.gov.cn/xxfb/flfg/bmgz/202410/t20241015_869486.html)
- Tauri 官方文档：Windows code signing
  [https://v2.tauri.app/distribute/sign/windows/](https://v2.tauri.app/distribute/sign/windows/)
- Tauri 官方文档：权限与 capabilities
  [https://v2.tauri.app/security/capabilities/](https://v2.tauri.app/security/capabilities/)

## 11. 最终建议

对 MarkLuck 当前阶段，最现实的路径不是“把一切商业化和主题扩展一次做完”，而是：

1. 先把 `Windows 官方桌面发行` 做成一条可信、可解释、可售后的路径。
2. 首发只保留低风险核心能力，把“本地代码主题导入”降为实验功能或暂时关闭。
3. 把政策文档、签名、哈希、支持入口、支付与开票规则补齐。
4. 等首发闭环稳定后，再逐步恢复更高风险、更高复杂度的扩展能力。

如果只能优先做 3 件事，顺序应当是：

1. 统一版本号与发行身份
2. 处理 `trusted-code` 主题导入策略
3. 补齐隐私政策、用户协议和签名安装包
