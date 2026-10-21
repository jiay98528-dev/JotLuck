//! Reink-1.0 本地神经网络补全引擎宿主（本机接入，暂不进安装器）。
//!
//! 进程模型：`python reink_bridge.py --runtime <运行包目录>`，stdin/stdout
//! JSON 行协议（协议见 reink_bridge.py 文件头）。spawn 范式照抄
//! completion_decoder/host_actor.rs：单工作线程 + mpsc 请求队列，reader
//! 线程逐行读响应按 id 配对。与 completion_decoder 的差异：
//! - 请求经 Python 单线程桥接脚本串行执行（模型非线程安全），宿主侧 FIFO
//!   下发即可，无需 cancel 帧；
//! - 不套用 completion_decoder 的 192MB Job 内存上限：torch 单档常驻约
//!   600MB-1GB，内存契约见 doc/reink-runtime-requirements.md；
//! - 每个请求带 deadline_ms 超时（超时只回错误，不杀进程）。

use crate::command_error::{CommandErrorPayload, CommandResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const REINK_BRIDGE_SCRIPT: &str = include_str!("reink_bridge.py");
const REINK_BRIDGE_FILENAME: &str = "reink_bridge.py";
/// Python + torch + 模型 import 的冷启动上限（369MB 运行包，首次磁盘加载较慢）。
const REINK_SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(120);
const REINK_CONFIGURE_TIMEOUT: Duration = Duration::from_secs(15);
/// 首次 warmup 需加载模型并推理一次（tier 64m 约 0.4-0.8s，冷盘更慢）。
const REINK_WARMUP_TIMEOUT: Duration = Duration::from_secs(120);
const REINK_MAX_GENERATE_DEADLINE_MS: u64 = 30_000;
const REINK_MAX_PREFIX_BYTES: usize = 64 * 1024;
const REINK_MAX_RESPONSE_LINE_BYTES: usize = 256 * 1024;
const REINK_MAX_CANDIDATES: usize = 8;
const REINK_TIERS: [&str; 2] = ["32m", "64m"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReinkCandidate {
    pub text: String,
    pub kind: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReinkStatusSnapshot {
    pub spawned: bool,
    pub ready: bool,
    pub last_error: Option<String>,
    pub warmup_ms: u64,
    pub last_latency_ms: u64,
    pub tier: String,
    pub fast: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReinkConfigureRequest {
    python_path: String,
    runtime_dir: String,
    tier: String,
    fast: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReinkGenerateRequest {
    prefix: String,
    lang: String,
    n: u8,
    tier: String,
    deadline_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
struct ReinkConfig {
    python_path: String,
    runtime_dir: PathBuf,
    tier: String,
    fast: bool,
}

#[derive(Default)]
struct ReinkSharedStatus {
    ready: bool,
    warmup_ms: u64,
    last_latency_ms: u64,
    last_error: Option<String>,
}

type ReinkPending = HashMap<u64, mpsc::SyncSender<Result<serde_json::Value, String>>>;

#[derive(Clone)]
struct ReinkRuntime {
    command_tx: mpsc::Sender<ReinkWorkerCommand>,
    child: Arc<Mutex<Child>>,
    config: ReinkConfig,
}

enum ReinkWorkerCommand {
    Dispatch {
        id: u64,
        line: String,
        reply: mpsc::SyncSender<Result<serde_json::Value, String>>,
    },
    Shutdown,
}

struct ReinkHost {
    runtime: Option<ReinkRuntime>,
    config: Option<ReinkConfig>,
    next_id: Arc<AtomicU64>,
    shared: Arc<Mutex<ReinkSharedStatus>>,
}

#[derive(Clone, Default)]
pub struct ReinkState {
    host: Arc<Mutex<ReinkHost>>,
}

impl ReinkState {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Default for ReinkHost {
    fn default() -> Self {
        Self {
            runtime: None,
            config: None,
            // id 0 保留给桥接脚本的启动就绪帧，请求 id 从 1 起。
            next_id: Arc::new(AtomicU64::new(1)),
            shared: Arc::new(Mutex::new(ReinkSharedStatus::default())),
        }
    }
}

// ── Tauri 命令 ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn reink_status(state: State<'_, ReinkState>) -> CommandResult<ReinkStatusSnapshot> {
    let host = Arc::clone(&state.host);
    // Tauri 约束：借用 State 的 async 命令必须返回 Result。
    tauri::async_runtime::spawn_blocking(move || read_reink_status(&host))
        .await
        .map_err(|error| {
            CommandErrorPayload::from_diagnostic(format!("reink status task failed: {error}"))
        })
}

#[tauri::command]
pub async fn reink_configure(
    app: AppHandle,
    state: State<'_, ReinkState>,
    request: ReinkConfigureRequest,
) -> CommandResult<()> {
    let config = normalize_reink_config(request)?;
    let host = Arc::clone(&state.host);
    tauri::async_runtime::spawn_blocking(move || configure_reink(&app, &host, config))
        .await
        .map_err(|error| {
            CommandErrorPayload::from_diagnostic(format!("reink configure task failed: {error}"))
        })?
}

#[tauri::command]
pub async fn reink_warmup(app: AppHandle, state: State<'_, ReinkState>) -> CommandResult<bool> {
    let host = Arc::clone(&state.host);
    tauri::async_runtime::spawn_blocking(move || warmup_reink(&app, &host))
        .await
        .map_err(|error| {
            CommandErrorPayload::from_diagnostic(format!("reink warmup task failed: {error}"))
        })?
}

#[tauri::command]
pub async fn reink_generate(
    app: AppHandle,
    state: State<'_, ReinkState>,
    request: ReinkGenerateRequest,
) -> CommandResult<Vec<ReinkCandidate>> {
    validate_reink_generate_request(&request)?;
    let host = Arc::clone(&state.host);
    tauri::async_runtime::spawn_blocking(move || generate_reink(&app, &host, request))
        .await
        .map_err(|error| {
            CommandErrorPayload::from_diagnostic(format!("reink generate task failed: {error}"))
        })?
}

#[tauri::command]
pub async fn reink_dispose(state: State<'_, ReinkState>) -> CommandResult<()> {
    let host = Arc::clone(&state.host);
    tauri::async_runtime::spawn_blocking(move || dispose_reink(&host))
        .await
        .map_err(|error| {
            CommandErrorPayload::from_diagnostic(format!("reink dispose task failed: {error}"))
        })?
}

// ── 宿主实现 ───────────────────────────────────────────────────────────────

fn unused_status_snapshot() -> ReinkStatusSnapshot {
    ReinkStatusSnapshot {
        spawned: false,
        ready: false,
        last_error: None,
        warmup_ms: 0,
        last_latency_ms: 0,
        tier: String::new(),
        fast: false,
    }
}

fn read_reink_status(host: &Arc<Mutex<ReinkHost>>) -> ReinkStatusSnapshot {
    let Ok(guard) = host.lock() else {
        let mut snapshot = unused_status_snapshot();
        snapshot.last_error = Some("reink state lock poisoned".to_string());
        return snapshot;
    };
    let shared = guard
        .shared
        .lock()
        .map(|status| ReinkSharedStatus {
            ready: status.ready,
            warmup_ms: status.warmup_ms,
            last_latency_ms: status.last_latency_ms,
            last_error: status.last_error.clone(),
        })
        .unwrap_or_default();
    ReinkStatusSnapshot {
        spawned: guard.runtime.is_some(),
        ready: shared.ready,
        last_error: shared.last_error,
        warmup_ms: shared.warmup_ms,
        last_latency_ms: shared.last_latency_ms,
        tier: guard
            .config
            .as_ref()
            .map(|config| config.tier.clone())
            .unwrap_or_default(),
        fast: guard.config.as_ref().is_some_and(|config| config.fast),
    }
}

fn normalize_reink_config(request: ReinkConfigureRequest) -> Result<ReinkConfig, CommandErrorPayload> {
    if request.python_path.trim().is_empty() {
        return Err(CommandErrorPayload::from_diagnostic(
            "reink configure requires a pythonPath",
        ));
    }
    if request.runtime_dir.trim().is_empty() {
        return Err(CommandErrorPayload::from_diagnostic(
            "reink configure requires a runtimeDir",
        ));
    }
    if !REINK_TIERS.contains(&request.tier.as_str()) {
        return Err(CommandErrorPayload::from_diagnostic(format!(
            "reink tier must be one of {:?}, got {:?}",
            REINK_TIERS, request.tier
        )));
    }
    Ok(ReinkConfig {
        python_path: request.python_path,
        runtime_dir: PathBuf::from(&request.runtime_dir),
        tier: request.tier,
        fast: request.fast,
    })
}

/// 路径变化则重启进程；tier/fast 变化发 configure 帧。
///
/// 锁纪律：所有命令走 spawn_blocking，宿主锁可能跨缓慢 spawn（最长
/// REINK_SPAWN_READY_TIMEOUT）持有——并发的 status/generate 会排队等待但
/// 不阻塞 UI 线程；shared 状态锁与宿主锁分层（reader/writer 线程只碰
/// shared/pending），不存在反向嵌套，无死锁。
fn configure_reink(
    app: &AppHandle,
    host: &Arc<Mutex<ReinkHost>>,
    config: ReinkConfig,
) -> CommandResult<()> {
    enum Action {
        NothingToDo,
        Reconfigure,
        Respawn,
    }
    let action = {
        let guard = lock_host(host)?;
        match guard.runtime.as_ref() {
            Some(runtime)
                if runtime.config.python_path == config.python_path
                    && runtime.config.runtime_dir == config.runtime_dir =>
            {
                if runtime.config.tier == config.tier && runtime.config.fast == config.fast {
                    Action::NothingToDo
                } else {
                    Action::Reconfigure
                }
            }
            _ => Action::Respawn,
        }
    };

    match action {
        Action::NothingToDo => Ok(()),
        Action::Reconfigure => {
            let runtime = lock_host(host)?
                .runtime
                .clone()
                .ok_or_else(|| CommandErrorPayload::from_diagnostic("reink engine is not running"))?;
            let id = allocate_request_id(host)?;
            let line = serialize_bridge_request(BridgeRequest {
                id,
                op: "configure",
                fast: Some(config.fast),
                tier: None,
                prefix: None,
                lang: None,
                n: None,
            })?;
            dispatch_request(&runtime, id, line, REINK_CONFIGURE_TIMEOUT).map_err(set_error_and_convert(host))?;
            let mut guard = lock_host(host)?;
            if let Some(runtime) = guard.runtime.as_mut() {
                runtime.config = config.clone();
            }
            guard.config = Some(config);
            clear_shared_error(&guard.shared);
            Ok(())
        }
        Action::Respawn => {
            let mut guard = lock_host(host)?;
            if let Some(previous) = guard.runtime.take() {
                let _ = previous.command_tx.send(ReinkWorkerCommand::Shutdown);
                kill_child(&previous.child);
            }
            reset_shared_status(&guard.shared);
            let runtime = spawn_reink_runtime(app, &config, &guard.next_id, &guard.shared)?;
            guard.config = Some(config);
            guard.runtime = Some(runtime);
            Ok(())
        }
    }
}

fn warmup_reink(app: &AppHandle, host: &Arc<Mutex<ReinkHost>>) -> CommandResult<bool> {
    let runtime = ensure_reink_runtime(Some(app), host)?;
    let id = allocate_request_id(host)?;
    let line = serialize_bridge_request(BridgeRequest {
        id,
        op: "warmup",
        tier: Some(runtime.config.tier.as_str()),
        fast: None,
        prefix: None,
        lang: None,
        n: None,
    })?;
    let started = Instant::now();
    let data =
        dispatch_request(&runtime, id, line, REINK_WARMUP_TIMEOUT).map_err(set_error_and_convert(host))?;
    let warmup_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    log::info!(
        "reink warmup ok: tier={} fast={} warmup_ms={} bridge_ms={}",
        runtime.config.tier,
        runtime.config.fast,
        warmup_ms,
        data
            .get("warmupMs")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
    );
    let guard = lock_host(host)?;
    if let Ok(mut shared) = guard.shared.lock() {
        shared.ready = true;
        shared.warmup_ms = warmup_ms;
        shared.last_error = None;
    }
    Ok(true)
}

fn generate_reink(
    app: &AppHandle,
    host: &Arc<Mutex<ReinkHost>>,
    request: ReinkGenerateRequest,
) -> CommandResult<Vec<ReinkCandidate>> {
    let runtime = ensure_reink_runtime(Some(app), host)?;
    let id = allocate_request_id(host)?;
    let line = serialize_bridge_request(BridgeRequest {
        id,
        op: "generate",
        fast: None,
        tier: Some(&request.tier),
        prefix: Some(&request.prefix),
        lang: Some(&request.lang),
        n: Some(request.n),
    })?;
    let started = Instant::now();
    let data = dispatch_request(
        &runtime,
        id,
        line,
        Duration::from_millis(request.deadline_ms),
    )
    .map_err(set_error_and_convert(host))?;
    let latency_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let guard = lock_host(host)?;
    if let Ok(mut shared) = guard.shared.lock() {
        shared.last_latency_ms = latency_ms;
        shared.last_error = None;
    }
    drop(guard);
    parse_reink_candidates(&data)
}

fn dispose_reink(host: &Arc<Mutex<ReinkHost>>) -> CommandResult<()> {
    let mut guard = lock_host(host)?;
    if let Some(runtime) = guard.runtime.take() {
        let _ = runtime.command_tx.send(ReinkWorkerCommand::Shutdown);
        kill_child(&runtime.child);
    }
    guard.config = None;
    reset_shared_status(&guard.shared);
    Ok(())
}

fn parse_reink_candidates(data: &serde_json::Value) -> Result<Vec<ReinkCandidate>, CommandErrorPayload> {
    let candidates = data
        .get("candidates")
        .cloned()
        .ok_or_else(|| {
            CommandErrorPayload::from_diagnostic("reink bridge response missing candidates")
        })?;
    let parsed = serde_json::from_value::<Vec<ReinkCandidate>>(candidates)
        .map_err(|error| {
            CommandErrorPayload::from_diagnostic(format!("invalid reink candidates payload: {error}"))
        })?;
    let mut cleaned: Vec<ReinkCandidate> = parsed
        .into_iter()
        .filter(|candidate| !candidate.text.is_empty() && candidate.score.is_finite())
        .map(|candidate| ReinkCandidate {
            text: candidate.text,
            kind: candidate.kind,
            score: candidate.score.clamp(0.0, 1.0),
        })
        .collect();
    cleaned.truncate(REINK_MAX_CANDIDATES);
    Ok(cleaned)
}

fn validate_reink_generate_request(request: &ReinkGenerateRequest) -> Result<(), CommandErrorPayload> {
    if request.lang != "zh" && request.lang != "en" {
        return Err(CommandErrorPayload::from_diagnostic(format!(
            "reink lang must be zh or en, got {:?}",
            request.lang
        )));
    }
    if !REINK_TIERS.contains(&request.tier.as_str()) {
        return Err(CommandErrorPayload::from_diagnostic(format!(
            "reink tier must be one of {:?}, got {:?}",
            REINK_TIERS, request.tier
        )));
    }
    if request.n == 0 || usize::from(request.n) > REINK_MAX_CANDIDATES {
        return Err(CommandErrorPayload::from_diagnostic(format!(
            "reink n must be within 1..={REINK_MAX_CANDIDATES}, got {}",
            request.n
        )));
    }
    if request.prefix.len() > REINK_MAX_PREFIX_BYTES {
        return Err(CommandErrorPayload::from_diagnostic(format!(
            "reink prefix exceeds {REINK_MAX_PREFIX_BYTES} bytes"
        )));
    }
    if request.deadline_ms == 0 || request.deadline_ms > REINK_MAX_GENERATE_DEADLINE_MS {
        return Err(CommandErrorPayload::from_diagnostic(format!(
            "reink deadlineMs must be within 1..={REINK_MAX_GENERATE_DEADLINE_MS} ms"
        )));
    }
    Ok(())
}

/// 取当前运行时；没有则（已配置时）懒启动。懒启动会跨宿主锁阻塞至桥接
/// 脚本就绪（最长 REINK_SPAWN_READY_TIMEOUT），调用方均为后台线程。
fn ensure_reink_runtime(
    app: Option<&AppHandle>,
    host: &Arc<Mutex<ReinkHost>>,
) -> Result<ReinkRuntime, CommandErrorPayload> {
    {
        let guard = lock_host(host)?;
        if let Some(runtime) = guard.runtime.as_ref() {
            return Ok(runtime.clone());
        }
    }
    let app = app
        .ok_or_else(|| CommandErrorPayload::from_diagnostic("reink engine is not configured"))?;
    let mut guard = lock_host(host)?;
    if let Some(runtime) = guard.runtime.as_ref() {
        return Ok(runtime.clone());
    }
    let config = guard
        .config
        .clone()
        .ok_or_else(|| CommandErrorPayload::from_diagnostic("reink engine is not configured"))?;
    let runtime = spawn_reink_runtime(app, &config, &guard.next_id, &guard.shared)?;
    guard.runtime = Some(runtime.clone());
    Ok(runtime)
}

fn lock_host(host: &Arc<Mutex<ReinkHost>>) -> Result<std::sync::MutexGuard<'_, ReinkHost>, CommandErrorPayload> {
    host.lock()
        .map_err(|_| CommandErrorPayload::from_diagnostic("reink state lock poisoned"))
}

fn allocate_request_id(host: &Arc<Mutex<ReinkHost>>) -> Result<u64, CommandErrorPayload> {
    Ok(lock_host(host)?.next_id.fetch_add(1, Ordering::Relaxed))
}

fn set_error_and_convert(
    host: &Arc<Mutex<ReinkHost>>,
) -> impl FnOnce(String) -> CommandErrorPayload + '_ {
    move |message: String| {
        if let Ok(guard) = host.lock() {
            if let Ok(mut shared) = guard.shared.lock() {
                shared.last_error = Some(message.clone());
            }
        }
        CommandErrorPayload::from_diagnostic(message)
    }
}

fn clear_shared_error(shared: &Arc<Mutex<ReinkSharedStatus>>) {
    if let Ok(mut status) = shared.lock() {
        status.last_error = None;
    }
}

fn reset_shared_status(shared: &Arc<Mutex<ReinkSharedStatus>>) {
    if let Ok(mut status) = shared.lock() {
        status.ready = false;
        status.warmup_ms = 0;
        status.last_latency_ms = 0;
        status.last_error = None;
    }
}

fn kill_child(child: &Arc<Mutex<Child>>) {
    if let Ok(mut guard) = child.lock() {
        let _ = guard.kill();
    }
}

fn fail_all_pending(pending: &Arc<Mutex<ReinkPending>>, message: &str) {
    if let Ok(mut map) = pending.lock() {
        for (_, sender) in map.drain() {
            let _ = sender.send(Err(message.to_string()));
        }
    }
}

// ── 桥接脚本与进程 ─────────────────────────────────────────────────────────

fn materialize_bridge_script(app: &AppHandle) -> PathBuf {
    let directory = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let primary = directory.join(REINK_BRIDGE_FILENAME);
    if std::fs::create_dir_all(&directory).is_ok()
        && std::fs::write(&primary, REINK_BRIDGE_SCRIPT).is_ok()
    {
        return primary;
    }
    let fallback = std::env::temp_dir().join(REINK_BRIDGE_FILENAME);
    let _ = std::fs::write(&fallback, REINK_BRIDGE_SCRIPT);
    fallback
}

/// Windows 处理照抄 completion_decoder/protocol.rs 的 CREATE_NO_WINDOW；
/// 不带 BELOW_NORMAL_PRIORITY_CLASS（推理延迟敏感）——也不套用其 192MB
/// Job 内存上限：torch 单档常驻约 600MB-1GB，内存契约见
/// doc/reink-runtime-requirements.md。
#[cfg(windows)]
fn configure_reink_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_reink_command(_command: &mut Command) {}

fn spawn_reink_runtime(
    app: &AppHandle,
    config: &ReinkConfig,
    next_id: &Arc<AtomicU64>,
    shared: &Arc<Mutex<ReinkSharedStatus>>,
) -> Result<ReinkRuntime, CommandErrorPayload> {
    let bridge_path = materialize_bridge_script(app);
    let mut command = Command::new(&config.python_path);
    command
        .arg(&bridge_path)
        .arg("--runtime")
        .arg(&config.runtime_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 只读纪律：禁止在运行包目录生成 __pycache__（桥接脚本内还有双保险）。
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1");
    configure_reink_command(&mut command);
    let mut child = command.spawn().map_err(|error| {
        // 装机排查锚点：spawn 失败（python 路径不存在等）必须落日志，不能只回错误帧。
        log::warn!(
            "reink bridge spawn failed: python={} runtime={} bridge={} error={error}",
            config.python_path,
            config.runtime_dir.display(),
            bridge_path.display(),
        );
        CommandErrorPayload::from_diagnostic(format!(
            "unable to start reink bridge (python {:?}): {error}",
            config.python_path
        ))
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| CommandErrorPayload::from_diagnostic("reink bridge stdin is unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CommandErrorPayload::from_diagnostic("reink bridge stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| CommandErrorPayload::from_diagnostic("reink bridge stderr is unavailable"))?;
    let child = Arc::new(Mutex::new(child));

    let pending: Arc<Mutex<ReinkPending>> = Arc::new(Mutex::new(HashMap::new()));
    // 启动就绪帧（id 0）：桥接脚本 import 成功后主动上报。
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    pending
        .lock()
        .map_err(|_| CommandErrorPayload::from_diagnostic("reink pending lock poisoned"))?
        .insert(0, ready_tx);

    // reader 线程：逐行读响应，按 id 配对投递。
    {
        let pending = Arc::clone(&pending);
        let shared = Arc::clone(shared);
        thread::spawn(move || run_reink_reader(stdout, pending, shared));
    }
    // stderr 诊断：全文转宿主日志，防止管道写满阻塞 Python。
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(text) if !text.trim().is_empty() => log::info!("reink-bridge: {text}"),
                _ => break,
            }
        }
    });
    // 工作线程：请求 FIFO 串行下发（Python 侧单线程推理）。
    let (command_tx, command_rx) = mpsc::channel();
    {
        let pending = Arc::clone(&pending);
        let worker_child = Arc::clone(&child);
        let worker_shared = Arc::clone(shared);
        thread::spawn(move || {
            run_reink_writer(stdin, command_rx, pending, worker_child, worker_shared)
        });
    }

    let runtime = ReinkRuntime {
        command_tx,
        child: Arc::clone(&child),
        config: config.clone(),
    };

    // 等待 import 就绪帧（超时杀进程）。
    let ready = match ready_rx.recv_timeout(REINK_SPAWN_READY_TIMEOUT) {
        Ok(Ok(data)) => data,
        Ok(Err(error)) => {
            // 就绪帧报错（桥接脚本 import 失败等）：kill 前先落日志。
            log::warn!(
                "reink bridge failed to initialize: python={} runtime={} error={error}",
                config.python_path,
                config.runtime_dir.display(),
            );
            kill_child(&child);
            return Err(CommandErrorPayload::from_diagnostic(format!(
                "reink bridge failed to initialize: {error}"
            )));
        }
        Err(_) => {
            log::warn!(
                "reink bridge did not signal readiness within {:?}: python={} runtime={} \
                 (python/torch import too slow or missing)",
                REINK_SPAWN_READY_TIMEOUT,
                config.python_path,
                config.runtime_dir.display(),
            );
            kill_child(&child);
            return Err(CommandErrorPayload::from_diagnostic(
                "reink bridge did not signal readiness in time (python/torch import too slow or missing)",
            ));
        }
    };
    if ready.get("bridge").and_then(serde_json::Value::as_str) != Some("reink") {
        log::warn!(
            "reink bridge identity mismatch: python={} runtime={} ready_frame={ready}",
            config.python_path,
            config.runtime_dir.display(),
        );
        kill_child(&child);
        return Err(CommandErrorPayload::from_diagnostic(
            "reink bridge identity mismatch",
        ));
    }

    // 初始 configure 帧：固化质量档（fast → N_CAND=8 / MAX_NEW=3）。
    let configure_id = next_id.fetch_add(1, Ordering::Relaxed);
    let configure_line = serialize_bridge_request(BridgeRequest {
        id: configure_id,
        op: "configure",
        fast: Some(config.fast),
        tier: None,
        prefix: None,
        lang: None,
        n: None,
    })?;
    if let Err(error) = dispatch_request(&runtime, configure_id, configure_line, REINK_CONFIGURE_TIMEOUT)
    {
        // 初始 configure 帧被拒（超时/写失败）：错误摘要必须落日志供装机排查。
        log::warn!(
            "reink bridge rejected the initial configure frame: python={} runtime={} \
             timeout={:?} error={error}",
            config.python_path,
            config.runtime_dir.display(),
            REINK_CONFIGURE_TIMEOUT,
        );
        kill_child(&child);
        if let Ok(mut status) = shared.lock() {
            status.last_error = Some(error);
        }
        return Err(CommandErrorPayload::from_diagnostic(
            "reink bridge rejected the initial configure frame",
        ));
    }
    log::info!(
        "reink bridge ready: python={} runtime={} tier={} fast={}",
        config.python_path,
        config.runtime_dir.display(),
        config.tier,
        config.fast
    );
    Ok(runtime)
}

fn run_reink_writer(
    stdin: ChildStdin,
    command_rx: mpsc::Receiver<ReinkWorkerCommand>,
    pending: Arc<Mutex<ReinkPending>>,
    child: Arc<Mutex<Child>>,
    shared: Arc<Mutex<ReinkSharedStatus>>,
) {
    let mut writer = std::io::BufWriter::new(stdin);
    loop {
        let Ok(command) = command_rx.recv() else {
            break;
        };
        match command {
            ReinkWorkerCommand::Dispatch { id, line, reply } => {
                if let Ok(mut map) = pending.lock() {
                    map.insert(id, reply);
                }
                let written = writeln!(writer, "{line}").and_then(|()| writer.flush());
                if written.is_err() {
                    if let Ok(mut map) = pending.lock() {
                        if let Some(sender) = map.remove(&id) {
                            let _ = sender.send(Err("reink bridge write failed".to_string()));
                        }
                    }
                    fail_all_pending(&pending, "reink bridge write failed");
                    mark_shared_failure(&shared, "reink bridge write failed");
                    kill_child(&child);
                    return;
                }
            }
            ReinkWorkerCommand::Shutdown => {
                let _ = writeln!(writer, "{{\"id\":0,\"op\":\"shutdown\"}}");
                let _ = writer.flush();
                kill_child(&child);
                return;
            }
        }
    }
    // 发送端全部释放（运行时被替换/丢弃）：回收子进程，避免孤儿 Python。
    kill_child(&child);
}

fn run_reink_reader(
    stdout: ChildStdout,
    pending: Arc<Mutex<ReinkPending>>,
    shared: Arc<Mutex<ReinkSharedStatus>>,
) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) if line.len() > REINK_MAX_RESPONSE_LINE_BYTES => {
                log::warn!("reink bridge response line exceeds limit; dropping");
                break;
            }
            Ok(_) => {
                let frame: BridgeResponse = match serde_json::from_str(line.trim_end()) {
                    Ok(frame) => frame,
                    Err(error) => {
                        log::warn!("reink bridge emitted an unparsable line: {error}");
                        continue;
                    }
                };
                let sender = pending.lock().ok().and_then(|mut map| map.remove(&frame.id));
                if let Some(sender) = sender {
                    let outcome = if frame.ok {
                        Ok(frame.data.unwrap_or(serde_json::Value::Null))
                    } else {
                        Err(frame
                            .error
                            .unwrap_or_else(|| "reink bridge reported an error".to_string()))
                    };
                    let _ = sender.send(outcome);
                }
            }
            Err(error) => {
                log::warn!("reink bridge stdout read failed: {error}");
                break;
            }
        }
    }
    fail_all_pending(&pending, "reink bridge exited");
    mark_shared_failure(&shared, "reink bridge process exited");
}

fn mark_shared_failure(shared: &Arc<Mutex<ReinkSharedStatus>>, message: &str) {
    if let Ok(mut status) = shared.lock() {
        status.ready = false;
        status.last_error = Some(message.to_string());
    }
}

// ── 协议帧 ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct BridgeRequest<'a> {
    id: u64,
    op: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    fast: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tier: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prefix: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lang: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    n: Option<u8>,
}

#[derive(Deserialize)]
struct BridgeResponse {
    id: u64,
    ok: bool,
    #[serde(default)]
    data: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

fn serialize_bridge_request(request: BridgeRequest<'_>) -> Result<String, CommandErrorPayload> {
    serde_json::to_string(&request).map_err(|error| {
        CommandErrorPayload::from_diagnostic(format!("unable to serialize reink request: {error}"))
    })
}

fn dispatch_request(
    runtime: &ReinkRuntime,
    id: u64,
    line: String,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    runtime
        .command_tx
        .send(ReinkWorkerCommand::Dispatch {
            id,
            line,
            reply: reply_tx,
        })
        .map_err(|_| "reink engine worker is unavailable".to_string())?;
    match reply_rx.recv_timeout(timeout) {
        Ok(outcome) => outcome,
        // 超时只回错误，不杀进程；迟到的响应由 reader 丢弃（接收端已释放）。
        Err(mpsc::RecvTimeoutError::Timeout) => Err("reink engine deadline expired".to_string()),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("reink engine worker is unavailable".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_script_is_embedded_and_read_only_contracted() {
        assert!(REINK_BRIDGE_SCRIPT.contains("--runtime"));
        assert!(REINK_BRIDGE_SCRIPT.contains("sys.dont_write_bytecode = True"));
        assert!(REINK_BRIDGE_SCRIPT.contains("suggestion_generator"));
    }

    #[test]
    fn candidate_payload_round_trips() {
        let data = serde_json::json!({
            "candidates": [
                {"text": "运行时", "kind": "phrase", "score": 0.8},
                {"text": "", "kind": "word", "score": 0.5},
                {"text": "hello", "kind": "word", "score": 1.7},
            ]
        });
        let cleaned = parse_reink_candidates(&data).expect("parse candidates");
        assert_eq!(cleaned.len(), 2);
        assert_eq!(cleaned[0].text, "运行时");
        assert!((cleaned[1].score - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn generate_request_validation_rejects_bad_input() {
        let base = ReinkGenerateRequest {
            prefix: "前缀".to_string(),
            lang: "zh".to_string(),
            n: 8,
            tier: "32m".to_string(),
            deadline_ms: 2_500,
        };
        assert!(validate_reink_generate_request(&base).is_ok());
        let mut bad_lang = base.clone();
        bad_lang.lang = "jp".to_string();
        assert!(validate_reink_generate_request(&bad_lang).is_err());
        let mut bad_n = base.clone();
        bad_n.n = 9;
        assert!(validate_reink_generate_request(&bad_n).is_err());
        let mut bad_deadline = base;
        bad_deadline.deadline_ms = 0;
        assert!(validate_reink_generate_request(&bad_deadline).is_err());
    }
}
