# V2 免费补全模型：远程训练控制面

本目录只提供可审查的训练合同和 Windows PowerShell 7 模板。交付和测试这些文件不会安装软件、连接 FX15/VPS、创建账号、下发密钥、开放公网 SSH、配置 FRP 或执行训练。`Initialize-Fx15.ps1` 默认也只输出探针与计划；只有用户在 FX15 本地管理员终端显式传入 `-Apply` 后，才会执行其列出的初始化动作。训练数据仍必须满足 V2 免费公共候选源的许可与 512 MiB 上限；用户笔记、反馈、个人词表和本地指标不得进入训练包。

## 边界和身份

- `RemoteTrainingJob` 固定绑定 `jobId`、Git commit/tree、源包 SHA-256、配方及参数、模型矩阵、seed、每个输入的字节数/SHA-256、续训策略、输出位置和截止时间。
- `TrainingResult` 只允许 `queued → running ↔ checkpointed → completed|failed` 合法方向，心跳与状态使用同目录临时文件加原子替换写入。
- `RemoteBundleManifest` 对排序后的文件清单、角色、字节数和 SHA-256 生成内容身份。最终接收方仍须复核清单内每个文件，不能只相信外层包哈希。
- 正式候选矩阵仍为 `16m-q4`、`24m-q4`、`32m-q4` 与 `16m-q8`，engine 固定为 `public-v2-free-decoder-v1`。远程训练 job 只能调度 `16m-q4`、`24m-q4`、`32m-q4` 三档 recipe；`16m-q4` 必须在同一次训练中导出 Q4/Q8 两个候选，禁止独立调度 `16m-q8` 训练。
- 远程训练和导出格式固定为 `JLFDQ02`；`JLFDQ01` 任务必须拒绝，不能在运行器中静默升级。
- 任务 JSON 和 recipe arguments 不得包含口令、私钥、Tailscale auth key、VPS token 或其他凭据。凭据只存在于操作系统/覆盖网络自身的安全存储。

## 建议执行顺序

1. 普通用户运行 `Probe-Fx15.ps1`。该脚本只把机器、GPU、磁盘、命令和服务的观察结果写到 stdout；保存报告由调用者显式重定向完成。
2. 若机器没有 PowerShell 7、Python 3.12 或 Git，先在管理员终端运行 `Install-Fx15TrainingTools.ps1` 的默认 plan；显式 `-Apply` 后它只向专用训练根目录安装固定 PowerShell、Python 与 MinGit，不修改 PATH、SSH、防火墙或账号。PowerShell 使用发布页固定 SHA，Python 必须通过 Python Software Foundation Authenticode 签名，MinGit 使用固定 GitHub release asset digest。
3. 在 FX15 物理控制台打开 PowerShell 7 管理员终端，先不带 `-Apply` 运行 `Initialize-Fx15.ps1` 并审查 JSON 计划。确认 Tailscale 地址、软件下载源、目录与可选动作后，再决定是否执行下节的一次性初始化。
4. 在控制机生成完整训练包与 job JSON；冻结文件字节后再计算 SHA-256。源包必须在传输前已包含全部语料，训练期间不从互联网拉取数据。
5. 经 Tailscale 内网的普通 Microsoft OpenSSH/SCP 上传到目标根目录下的临时目录：`.最终目录名.upload-传输ID.tmp`。Windows 不使用 Tailscale SSH server；不要给 `0.0.0.0:22` 添加入站规则。
6. 在 FX15 本地调用 `Finalize-VerifiedUpload.ps1`，同时传入 manifest 文件 SHA-256 和 manifest 内部 bundle SHA-256。脚本检查路径穿越、junction/symlink、意外文件、字节数与逐文件 SHA-256，全部通过后才用同卷 `Directory.Move` 原子转正；已存在的正式目录绝不覆盖。
7. 管理员审查探针和路径后，显式以 `Bootstrap-Fx15.ps1 -Apply` 注册一次计划任务。模板拒绝覆盖同名任务，并在注册前复核 runner/job 文件 SHA-256。
8. 计划任务使用现有专用非管理员账号、`S4U`、`RunLevel Limited`、开机触发、失败重启和无限任务时限。实际训练由任务进程持有，不依赖 SSH 会话，因此控制连接断开后继续运行。
9. `Invoke-TrainingJob.ps1` 再次验证 job、recipe、所有输入、Git commit/tree、续训包和 deadline；fresh job 不预建 checkpoint 目录，`if-available` 只在目录已存在时恢复，`required` 则要求已验证的续训目录。训练过程每 15 秒原子更新状态与心跳，超期或非零退出写 `failed`。成功只有在输出 manifest 与逐文件内容复核后才写 `completed`。
10. 训练配方每次写 checkpoint 后生成冻结的 checkpoint index。对该 index 计算 SHA-256，再显式运行 `Invoke-CheckpointRetention.ps1 -Apply`，只保留最近两份与 validation 最优一份。脚本会先复核所有 checkpoint 的路径、字节数和 SHA-256；删除不可恢复，索引必须先归档。

## FX15 一次性初始化

`Initialize-Fx15.ps1` 有 `#requires -RunAsAdministrator`，必须在 FX15 物理控制台执行，不能在尚未收紧的远程 SSH 会话内执行。默认调用仅观察 Windows capability、账号、服务和工具，并输出计划：

```powershell
pwsh -NoProfile -File .\Initialize-Fx15.ps1
```

应用时使用 `Get-Credential` 取得内存中的 `PSCredential`；用户名固定为 `jotluck-train`。命令行只接收公钥文件，不接收私钥、明文密码、Tailscale auth key 或 VPS token：

```powershell
$trainingCredential = Get-Credential -UserName '.\jotluck-train'
pwsh -NoProfile -File .\Initialize-Fx15.ps1 -Apply `
  -TrainingCredential $trainingCredential `
  -PublicKeyPath 'D:\staging\control-ed25519.pub' `
  -Fx15TailscaleIPv4 '100.64.10.20' `
  -ControlTailscaleIPv4 '100.64.10.10'
```

基础 `-Apply` 会创建或校验固定非管理员账号、收紧训练目录和 `authorized_keys` ACL、安装/启用 Windows OpenSSH Server、生成只监听 FX15 Tailscale 地址的 `sshd_config`、关闭密码和交互认证、设置 `AllowUsers jotluck-train`、禁用默认 OpenSSH 入站规则，并仅允许控制机 Tailscale `/32` 访问 TCP 22。现有 `sshd_config` 会先备份；新配置以同目录临时文件完成 `sshd -t` 后原子替换，安装后再次验证才重启服务，失败会恢复备份并复验。

下列动作各自默认关闭：

- `-InstallPackages`：先用 `winget show --source winget` 复核，再按精确 ID 安装 Tailscale 与 Python 3.12。
- `-EnableTailscaleUnattended`：仅执行 `tailscale set --unattended=true`，不接收或生成 auth key。
- `-InstallTrainingEnvironment -ApprovePythonPackageSource -ApprovePyTorchDownloadSource`：三个开关必须同时提供。只允许从 `https://pypi.org/simple` 安装 `numpy==2.3.2`、`sentencepiece==0.2.1`，从 `https://download.pytorch.org/whl/cu126` 安装 `torch==2.8.0`；版本与仓库根 `requirements.lock.txt` 保持一致，创建独立 venv、验证全部版本与 CUDA `12.6`，并写 `requirements.resolved.lock.txt` 及 SHA-256。没有 `py.exe` 时可通过 `-BasePythonPath` 显式指定已核验的 Python 3.12。
- `-ConfigureAcPowerPolicy`：先保存完整 `powercfg /query` 并复制当前电源方案，再只修改接电状态的睡眠、休眠和合盖策略。

脚本从不自动重启 Windows。输出的 `restartNeeded=true` 表示用户应停止并人工重启；不能绕过重启继续注册训练任务。

### 初始化回滚和重启复验

- 每次应用会返回 `backupRoot`。其中保存原 `sshd_config`、被禁用的默认防火墙规则名、原电源配置和可直接重新激活的备份电源方案 GUID。
- SSH 配置安装或服务重启失败会自动回滚配置。人工回滚时，从 `backupRoot` 恢复 `sshd_config`，先运行 `sshd.exe -t -f <配置路径>`，通过后才能重启服务。
- 防火墙回滚必须在物理控制台操作：删除精确规则 `JotLuck-FX15-Tailscale-SSH-In`。不要直接恢复默认公网规则；确需恢复时，只按备份名单逐条处理并先建立新的 Tailscale `/32` 限制。
- 电源策略回滚使用结果中的 `powerBackupScheme` 执行 `powercfg /setactive <GUID>`。venv、账号、目录或 winget capability 的卸载均是独立破坏性动作，不由脚本自动执行。
- 人工重启后重新运行 `Probe-Fx15.ps1` 和初始化 plan，执行 `sshd -t`，确认 sshd 仅监听 FX15 Tailscale 地址、默认 OpenSSH 入站规则保持禁用、唯一自定义规则的远端地址为控制机 `/32`，再从控制机用公钥登录。公网/局域网非控制地址连接必须失败。

计划任务动作使用 `-ExecutionPolicy AllSigned`，所以 runner 应由本机信任的代码签名证书签名并在注册前验证签名。模板不生成证书，也不会弱化执行策略。专用训练账号需要“作为批处理作业登录”，但不应加入 Administrators、Remote Desktop Users 或 SSH 操作员组。

注册计划任务时必须把 venv 的 `python.exe` 和用于复核 source commit/tree 的 `git.exe` 作为显式路径传给 `Bootstrap-Fx15.ps1`，并同时提供各自 SHA-256。bootstrap 会复算后把路径与哈希写入任务参数；runner 再次复算，Python 配方只允许使用这份 venv 解释器。不得依赖管理员或训练账号的交互式 `PATH`。

## 最小权限划分

| 身份             | 允许                                                                               | 禁止                                                                 |
| ---------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 覆盖网络操作员   | 通过 tailnet 访问 FX15 的 TCP 22；上传冻结临时包；读取状态                         | 以训练账号交互登录；写正式 bundle；开放公网端口                      |
| 训练任务账号     | 只读源码、recipe、冻结输入；写指定 output/checkpoint/state 目录；启动本地训练 host | 管理员权限；写仓库其他位置；读取操作员私钥；修改防火墙/服务/计划任务 |
| 一次性管理员引导 | 核对 SHA 后注册固定计划任务；可选开启 Tailscale unattended                         | 安装未知软件；嵌入密钥；覆盖既有任务；直接执行模型训练               |
| peer relay/VPS   | 只转发已加密的 Tailscale 流量                                                      | 保存训练包；获得 FX15 shell；终止覆盖网络加密                        |

目录 ACL 应让上传暂存区只对操作员可写、正式输入只读、output/checkpoint/state 只对训练账号可写。不要让上传方与训练账号共同写同一个已验证目录，否则“校验后、重命名前”的内容身份可能被破坏。

`tailscale-policy.example.hujson` 只允许指定操作员访问训练节点的 TCP 22，并只把 `tailscale.com/cap/relay` 授予训练节点到专用 relay。替换示例邮箱后必须先运行 Tailscale policy tests。它不启用 Tailscale SSH，也没有训练节点反向连接操作员机器的权限。

## 1 GiB 链路决策

链路基准必须使用精确 `1,073,741,824` 字节的同一不可压缩测试文件并记录毫秒时长。`network-path.ts` 的固定决策为：

- Tailscale direct ≥ 20 Mbps：使用 direct。
- direct < 20 Mbps：测同一文件的 peer relay。
- peer relay ≥ 10 Mbps：使用 peer relay。
- peer relay < 10 Mbps：停止自动切换，建议另行评估最小权限 WireGuard hub。

VPS 只在 peer relay 或后续明确批准的 WireGuard 方案中转密文，不承载训练。反向 SSH/FRP 不在本控制面内；它们会扩大凭据与公网监听面，不能作为自动 fallback。

## 恢复、心跳与停止条件

- `resume.mode=never` 要求 checkpoint 目录尚不存在，由 trainer 原子建立 fresh 状态；`if-available` 在目录不存在时 fresh 启动、存在时自动选择最新 step；`required` 时 `checkpointDirectory/checkpoint-bundle.json` 必须存在且匹配 job 中的 SHA-256。runner 不得为了检查路径而预先创建 checkpoint 目录。
- 监控方应把超过 `3 × HeartbeatSeconds` 未更新视为 stale，再结合计划任务状态、进程退出码和 stderr 判断；不能仅凭 SSH 断线认定训练失败。
- deadline 到达、输入/recipe/commit/tree/hash 不一致、损坏模型、输出 manifest 缺失、路径逃逸或 reparse point 都必须失败关闭，不能降级继续。
- `last two + best` 最多保留三份：若最优项同时属于最近两份，则只保留两份。删除前必须保留 checkpoint index 及其 SHA-256 作为可复核记录。

这些模板是 dev/E2E 训练控制面，不会把训练结果安装到生产 `public`，也不会切换默认引擎。Oracle 预检、双 final 和 Windows GUI 闭环仍是后续独立门禁。
