// JotLuck Tauri Backend
//
// The desktop host runs as one process with window-scoped notebook and
// external-file sessions. A file association never replaces another window.

mod command_error;
mod completion_decoder;
mod completion_decoder_runtime;
mod completion_retrieval;
mod completion_tokenizer;
mod document_import;
mod file_watcher;
mod fs_ops;
mod path;
mod reink_engine;
mod window_session;
mod windows_integration;

use command_error::CommandResult;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{Emitter, Manager, Runtime, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use uuid::Uuid;

/// Best-effort OS identity for the frontend: 'windows' | 'macos' | 'linux'.
/// The frontend has no other reliable OS signal inside the WebView.
#[tauri::command]
fn platform_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Force-close the calling window after the frontend has completed its save guard.
/// `close()` would emit another CloseRequested event and re-enter the guard.
#[tauri::command]
fn destroy_current_window(window: tauri::WebviewWindow) -> CommandResult<()> {
    window.destroy().map_err(|error| error.to_string())?;
    Ok(())
}

fn is_supported_opened_file_extension(ext: &str) -> bool {
    matches!(
        ext,
        "md" | "markdown" | "mdx" | "txt" | "docx" | "pdf" | "xlsx" | "xls"
    )
}

pub fn run_document_worker_if_requested() -> bool {
    completion_decoder::run_completion_parity_if_requested()
        || completion_decoder::run_completion_worker_if_requested()
        || document_import::run_document_worker_if_requested()
}

fn opened_file_path_from_arg(arg: &str, cwd: &Path) -> Option<PathBuf> {
    let raw_path = PathBuf::from(arg);
    let ext = raw_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())?;
    if !is_supported_opened_file_extension(&ext) {
        return None;
    }
    let absolute = if raw_path.is_absolute() {
        raw_path
    } else {
        cwd.join(raw_path)
    };
    let canonical = absolute.canonicalize().ok()?;
    canonical.is_file().then_some(canonical)
}

fn capture_opened_files_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();
    for arg in args {
        let Some(path) = opened_file_path_from_arg(arg, cwd) else {
            continue;
        };
        let duplicate = files.iter().any(|existing| {
            window_session::canonical_path_key(existing).ok()
                == window_session::canonical_path_key(&path).ok()
        });
        if !duplicate {
            files.push(path);
        }
    }
    files
}

fn startup_log_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("JotLuck").join("logs");
    if fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("startup-error.log"))
}

fn write_startup_error(message: &str) {
    if let Some(path) = startup_log_path() {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "[{}] {}", chrono::Local::now().to_rfc3339(), message);
        }
    }
    eprintln!("{message}");
}

// 窗口辅助函数按 Runtime 泛化：setup 主窗口初始化（open_startup_main_window）
// 需要在 cargo test 里用 tauri::test mock runtime 直接驱动（P5 单测），
// 泛化后生产 Wry 与测试 MockRuntime 共用同一实现。
fn report_window_error<R: Runtime>(app: &tauri::AppHandle<R>, message: &str) {
    write_startup_error(message);
    if let Some(window) = app.webview_windows().into_values().next() {
        let _ = window.emit("jotluck://startup-error", message.to_string());
    }
}

fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        write_startup_error(&format!("panic while running jotluck: {info}"));
    }));
}

fn attach_window_cleanup<R: Runtime>(window: &WebviewWindow<R>) {
    let label = window.label().to_string();
    let app = window.app_handle().clone();
    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }
        app.state::<window_session::WindowSessionRegistry>()
            .remove(&label);
        app.state::<fs_ops::NotebookRoot>().remove_for(&label);
        app.state::<file_watcher::FileWatcherState>()
            .remove_for(&label);
        app.state::<completion_retrieval::CompletionRetrievalStates>()
            .remove_for(&label);
        app.state::<fs_ops::ExternalAccessGrants>()
            .revoke_for_window(&label);
        app.state::<document_import::DocumentImportState>()
            .cleanup_for_window(&label);
    });
}

fn desktop_window_config(label: String) -> tauri::utils::config::WindowConfig {
    // 窗口配置由 tauri.conf.json 迁入代码：主窗口也必须经 build_window 创建，
    // 下方的 CDP 重注入（additional_browser_args）才会作用于主窗口 WebView2。
    // 字段值与原 tauri.conf.json windows[0] 完全一致（fullscreen/decorations
    // 等取 WindowConfig 默认值，与原配置相同）。
    tauri::utils::config::WindowConfig {
        label,
        title: "JotLuck".to_string(),
        width: 1280.0,
        height: 800.0,
        min_width: Some(800.0),
        min_height: Some(600.0),
        resizable: true,
        maximized: true,
        center: true,
        ..Default::default()
    }
}

fn build_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) -> Result<WebviewWindow<R>, String> {
    let config = desktop_window_config(label.to_string());
    let builder =
        WebviewWindowBuilder::from_config(app, &config).map_err(|error| error.to_string())?;
    // 导航守卫（wry on_navigation 深度兜底）：前端已拦截锚点/脚本导航并移交
    // 系统浏览器，此处只放行应用自身源——生产 Windows/Android 为 http(s)://
    // tauri.localhost，macOS/iOS 为 tauri://localhost，Linux 生产源与 Vite 开发
    // 服务器同为 localhost（localhost 任意端口：Linux 生产源端口不定、dev
    // server 端口由 Vite 分配，见 allows_webview_navigation 测试注释）——其余
    // 导航一律阻断（about:/blob: 的 scheme 级豁免及论证见该函数注释）。
    let builder = builder.on_navigation(allows_webview_navigation);
    // CDP 环境变量重注入（Windows）：提权进程（CI runner 全程高完整性）中
    // WebView2Loader 会丢弃 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 环境变量——
    // 实测 runner 上浏览器进程命令行缺失 --remote-debugging-port、UDF 变量却生效，
    // 而 API 通道（CoreWebView2EnvironmentOptions）不受此限。msedgedriver 驱动
    // WebView2 时正是通过该环境变量下发调试端口，故在此显式转入 API 通道。
    // 仅变量存在时启用；默认值与 wry 0.55 内置参数保持一致（tauri 文档警告：
    // 调用 additional_browser_args 会整体替换 wry 默认参数，需自行补齐）。
    #[cfg(windows)]
    let builder = match std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        Ok(extra) if !extra.trim().is_empty() => builder.additional_browser_args(&format!(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required {}",
            extra.trim()
        )),
        _ => builder,
    };
    builder.build().map_err(|error| error.to_string())
}

/// WebView 导航白名单判定：仅应用自身源可通过（见 build_window 注释）。
fn allows_webview_navigation(url: &tauri::Url) -> bool {
    // about:/blob: 按 scheme 豁免（不带 origin 复查）：wry 0.55.1 的
    // on_navigation 主/子框架共用同一回调，而 Windows WebView2 只对主框架
    // 触发该事件——PDF 导出预览经 iframe srcdoc（about:srcdoc）与文档资产
    // blob: object URL 在 macOS/Linux 会被本守卫取消，砍掉 PDF 导出。
    // 豁免安全性：不宽于 Windows 现状（Windows 上子框架导航根本不经本
    // 回调，全部放行）。已接受的豁免面 = 顶层 about:/blob: 兜底缺口：若
    // 应用内脚本被诱导发起顶层 about:/blob: 导航，此守卫不再拦截——前端
    // 导航拦截仍是第一道防线，about: 无远端载荷、blob: 仅本应用进程可
    // 创建且生命周期受控，残余风险已知并接受。
    if matches!(url.scheme(), "about" | "blob") {
        return true;
    }
    let host = url.host_str().unwrap_or_default();
    matches!(url.scheme(), "http" | "https" | "tauri")
        && matches!(host, "tauri.localhost" | "localhost")
}

fn focus_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// 窗口几何是否落在任一已连接显示器的可见区域内（macOS/Linux 共用）。
/// Linux 覆盖 suspend/resume 后 Wayland/X11 下 maximized 窗口未恢复的场景。
/// 熄屏/锁屏状态下启动时 WindowServer 可能给出失效的 display 配置
/// （SkyLight 报 "invalid display identifier"），tao 对 maximized 窗口
/// 直接取 screen frame，screen 无效时窗口会停留在 0×0 或离屏 frame，
/// 且显示器唤醒后 AppKit 不会自动纠正——2026-09-09 安装版 P0 实锤。
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn window_geometry_is_sane<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let Ok(size) = window.outer_size() else {
        return false;
    };
    if size.width == 0 || size.height == 0 {
        return false;
    }
    let Ok(position) = window.outer_position() else {
        return false;
    };
    let Ok(monitors) = window.available_monitors() else {
        return true;
    };
    // 无头/远程会话可能拿不到显示器列表——无法判定时不干预，
    // 避免 guard 在 5 分钟窗口内反复重置窗口（SSH DISPLAY 冒烟实测教训）。
    if monitors.is_empty() {
        return true;
    }
    monitors.iter().any(|monitor| {
        let origin = monitor.position();
        let bounds = monitor.size();
        position.x < origin.x + bounds.width as i32
            && position.x + size.width as i32 > origin.x
            && position.y < origin.y + bounds.height as i32
            && position.y + size.height as i32 > origin.y
    })
}

/// macOS：启动后轮询窗口几何，发现 0×0/离屏时重置为默认尺寸并居中。
/// 覆盖「熄屏启动 → 用户稍后唤醒显示器」的时序：几何自愈会在显示器
/// 恢复后的下一轮轮询生效。窗口销毁、几何恢复正常或 5 分钟超时即退出。
/// 正常启动时首轮（1s 延迟后）检测即通过，此后零开销。
/// label 按运行时 String 传入：除 main 外，file-* 外链窗口（运行时生成
/// 的 UUID 标签）同样需要挂 guard（P6）。
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn spawn_window_geometry_guard<R: Runtime>(app: tauri::AppHandle<R>, label: String) {
    std::thread::spawn(move || {
        // 首轮延迟 1s：tao 的 maximized zoom 异步派发到主队列，留出余量，
        // 避免窗口尚在初始正常 frame 时过早判定 sane 退出。
        std::thread::sleep(std::time::Duration::from_millis(1000));
        for _ in 0..600 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let Some(window) = app.get_webview_window(&label) else {
                return;
            };
            if window_geometry_is_sane(&window) {
                return;
            }
            log::warn!("window {label} has invalid geometry; resetting to default size");
            let _ = window.unminimize();
            let _ = window.set_size(tauri::LogicalSize::new(1280.0, 800.0));
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

fn open_external_file_in_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &Path,
    preferred_label: Option<&str>,
) -> Result<(), String> {
    let sessions = app.state::<window_session::WindowSessionRegistry>();
    if let Some(existing_label) = sessions.label_for_path(path)? {
        if let Some(existing) = app.get_webview_window(&existing_label) {
            focus_window(&existing);
            return Ok(());
        }
        sessions.remove(&existing_label);
        app.state::<fs_ops::ExternalAccessGrants>()
            .revoke_for_window(&existing_label);
    }

    let label = preferred_label
        .map(str::to_string)
        .unwrap_or_else(|| format!("file-{}", Uuid::new_v4().simple()));
    let existing_window = app.get_webview_window(&label);
    let access = app.state::<fs_ops::ExternalAccessGrants>();
    let is_document_import = window_session::ImportedDocumentKind::from_path(path).is_some();
    if is_document_import {
        sessions.register_document_import(&label, path)?;
    } else {
        let handle = access.grant_for_existing_file(&path.to_string_lossy(), &label)?;
        if let Err(error) = sessions.register_external(&label, handle) {
            access.revoke_for_window(&label);
            return Err(error);
        }
    }

    let (window, created_new_window) = match existing_window {
        Some(window) => (window, false),
        None => match build_window(app, &label) {
            Ok(window) => (window, true),
            Err(error) => {
                sessions.remove(&label);
                access.revoke_for_window(&label);
                return Err(format!(
                    "failed to create window for {}: {error}",
                    path.display()
                ));
            }
        },
    };
    attach_window_cleanup(&window);
    focus_window(&window);
    // P6：新建的 file-* 外链窗口与主窗口共享同一套熄屏/锁屏启动几何
    // 自愈 guard（见 spawn_window_geometry_guard 注释）；复用已存在
    // 窗口（如冷启动复用 main）时该窗口已挂 guard，不重复。
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        if created_new_window {
            spawn_window_geometry_guard(app.clone(), label);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = created_new_window;
    }
    Ok(())
}

fn create_workspace_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        focus_window(&window);
        return Ok(());
    }
    app.state::<window_session::WindowSessionRegistry>()
        .ensure_workspace(label);
    let window = build_window(app, label)?;
    attach_window_cleanup(&window);
    focus_window(&window);
    Ok(())
}

fn open_secondary_invocation<R: Runtime>(app: tauri::AppHandle<R>, files: Vec<PathBuf>) {
    let schedule = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if files.is_empty() {
            if let Err(error) = create_workspace_window(&schedule, "main") {
                report_window_error(&schedule, &error);
            }
            return;
        }
        for path in files {
            if let Err(error) = open_external_file_in_window(&schedule, &path, None) {
                report_window_error(&schedule, &error);
            }
        }
    }) {
        report_window_error(
            &app,
            &format!("failed to schedule external file window: {error}"),
        );
    }
}

/// RunEvent::Opened 的 URL 列表 → 受支持的外部文件路径（复用命令行捕获
/// 规则：扩展名白名单、canonicalize、去重）。在所有平台编译以供单测
/// 钉住过滤规则，实际仅 macOS 事件回调消费（tauri 只在 macos/ios/
/// android 编译 Opened 变体）。
#[cfg_attr(all(not(target_os = "macos"), not(test)), allow(dead_code))]
fn opened_files_from_urls(urls: Vec<tauri::Url>) -> Vec<PathBuf> {
    let args = urls
        .into_iter()
        // 仅接受 file:// URL：http(s) 链接不是本地文件投递（to_file_path
        // 对非 file scheme 返回 Err），并顺带完成百分号解码。
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    capture_opened_files_from_args(&args, &cwd)
}

/// macOS AppleEvent 文件投递（Finder「打开方式」/双击/拖到 Dock 图标，
/// P1）→ 既有 open_external_file_in_window 会话链。过滤后没有受支持
/// 文件时不动任何窗口（应用重激活走 RunEvent::Reopen，不在此处理）。
#[cfg(target_os = "macos")]
fn handle_macos_opened_urls(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    let files = opened_files_from_urls(urls);
    if files.is_empty() {
        return;
    }
    open_secondary_invocation(app.clone(), files);
}

/// setup 阶段主窗口初始化（P5）：冷启动首外链文件复用 main 窗口打开；
/// 打开失败时优雅降级——report_window_error 报错并回退
/// ensure_workspace(main)，与二次唤起路径（open_secondary_invocation）
/// 一致。该错误绝不能以 ? 传给 setup：那会使 Builder 整体退出、应用
/// 拒启（外链打不开是文件级故障，不应升级为应用级故障）。仅 main
/// 窗口本身创建失败仍向上传播——没有主窗口就无可降级。
fn open_startup_main_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    startup_files: &[PathBuf],
) -> Result<(), String> {
    let main = build_window(app, "main")?;
    if let Some(first) = startup_files.first() {
        if let Err(error) = open_external_file_in_window(app, first, Some("main")) {
            report_window_error(app, &error);
            app.state::<window_session::WindowSessionRegistry>()
                .ensure_workspace("main");
            attach_window_cleanup(&main);
            focus_window(&main);
        }
    } else {
        app.state::<window_session::WindowSessionRegistry>()
            .ensure_workspace("main");
        attach_window_cleanup(&main);
        // 对齐 create_workspace_window / open_external_file_in_window：
        // setup 建主窗口后同样显式 show + set_focus（Windows 上对已
        // 可见的前台窗口为幂等 no-op，行为不变）。
        focus_window(&main);
    }
    Ok(())
}

/// Initialize all IPC commands and plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let startup_args: Vec<String> = std::env::args().collect();
    let startup_files = capture_opened_files_from_args(&startup_args, &cwd);

    let app = match tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let cwd = PathBuf::from(cwd);
            let files = capture_opened_files_from_args(&argv, &cwd);
            open_secondary_invocation(app.clone(), files);
        }))
        .manage(fs_ops::NotebookRoot::new())
        .manage(fs_ops::ExternalAccessGrants::new())
        .manage(fs_ops::FileMutationCoordinator::new())
        .manage(window_session::WindowSessionRegistry::new())
        .manage(document_import::DocumentImportState::new())
        .manage(file_watcher::FileWatcherState::new())
        .manage(completion_decoder::CompletionDecoderState::new())
        .manage(completion_retrieval::CompletionRetrievalStates::new())
        .manage(reink_engine::ReinkState::new())
        .setup(move |app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // 主窗口在 setup 内经 build_window 创建（tauri.conf.json 不再自动创建），
            // 使 additional_browser_args 重注入覆盖主窗口——config 自动创建路径
            // 会绕过注入（2026-08-09 CI 探针实锤：浏览器进程命令行无调试端口）。
            // 外链文件打开失败在 open_startup_main_window 内部优雅降级（P5），
            // 不再以 ? 传播令 setup Err、Builder 退出。
            open_startup_main_window(app.handle(), &startup_files)?;
            // macOS 熄屏/锁屏启动时窗口 frame 可能损坏且不会自愈（见上），
            // 挂几何 guard 兜底；其他平台无此故障路径，零影响。
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                spawn_window_geometry_guard(app.handle().clone(), "main".to_string());
            }
            for path in startup_files.iter().skip(1) {
                if let Err(error) = open_external_file_in_window(app.handle(), path, None) {
                    report_window_error(app.handle(), &error);
                }
            }

            log::info!("JotLuck Tauri backend initialized");
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            destroy_current_window,
            platform_os,
            window_session::get_window_bootstrap,
            window_session::enable_external_edit,
            window_session::promote_external_file_to_notebook,
            document_import::start_document_conversion,
            document_import::cancel_document_conversion,
            document_import::read_document_conversion_asset,
            document_import::refresh_document_source_revision,
            document_import::save_converted_document_as,
            windows_integration::get_document_editor_candidate,
            windows_integration::open_document_source_in_editor,
            windows_integration::get_windows_association_status,
            windows_integration::open_jotluck_default_apps_settings,
            fs_ops::open_notebook,
            fs_ops::open_external_notebook,
            fs_ops::open_sample_notebook,
            fs_ops::get_notebook_root,
            fs_ops::list_directory,
            fs_ops::read_file,
            fs_ops::read_file_snapshot,
            fs_ops::read_external_note_file,
            fs_ops::read_external_note_file_snapshot,
            fs_ops::read_external_note_asset,
            fs_ops::write_file,
            fs_ops::write_file_if_unchanged,
            fs_ops::read_external_markdown_file,
            fs_ops::write_external_markdown_file,
            fs_ops::write_external_note_file,
            fs_ops::write_external_note_file_if_unchanged,
            fs_ops::save_external_note_as,
            fs_ops::revoke_external_access,
            fs_ops::read_binary_file,
            fs_ops::write_binary_file,
            fs_ops::delete_file,
            fs_ops::create_directory,
            fs_ops::rename_file,
            fs_ops::get_file_meta,
            completion_decoder::completion_decoder_warmup,
            completion_decoder::completion_decoder_generate,
            completion_decoder::completion_decoder_cancel,
            completion_decoder::completion_decoder_dispose,
            completion_retrieval::completion_v2_set_scope,
            completion_retrieval::completion_v2_replace_document,
            completion_retrieval::completion_v2_remove_document,
            completion_retrieval::completion_v2_rename_document,
            completion_retrieval::completion_v2_clear,
            completion_retrieval::completion_v2_apply_batch,
            completion_retrieval::completion_v2_query,
            completion_retrieval::completion_v2_diagnostics,
            reink_engine::reink_status,
            reink_engine::reink_configure,
            reink_engine::reink_warmup,
            reink_engine::reink_generate,
            reink_engine::reink_dispose,
            file_watcher::start_file_watcher,
            file_watcher::stop_file_watcher,
        ])
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(error) => {
            write_startup_error(&format!("error while running jotluck: {error:?}"));
            return;
        }
    };
    // 以 build + 事件回调替代 Builder::run 的空回调（P1）：macOS 上
    // Finder「打开方式」/双击/拖拽投递的文件经 AppleEvent 到达
    // RunEvent::Opened，空回调会把事件整批丢弃（文件打开全链缺失），
    // 此处接入既有 open_external_file_in_window 会话链。Windows/Linux
    // 无 Opened 事件（命令行与二次唤起走 single-instance 插件），回调
    // 保持占位。App::run 阻塞至事件循环退出。
    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        {
            if let tauri::RunEvent::Opened { urls } = event {
                handle_macos_opened_urls(app_handle, urls);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opened_file_capture_accepts_all_supported_extensions() {
        let root = std::env::temp_dir().join(format!("JotLuck-opened-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        for extension in ["md", "markdown", "mdx", "txt", "docx", "pdf", "xlsx", "xls"] {
            fs::write(root.join(format!("target.{extension}")), "content").unwrap();
        }
        let args = ["md", "markdown", "mdx", "txt", "docx", "pdf", "xlsx", "xls"]
            .into_iter()
            .map(|extension| format!("target.{extension}"))
            .collect::<Vec<_>>();
        let files = capture_opened_files_from_args(&args, &root);
        assert_eq!(files.len(), 8);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn opened_file_capture_ignores_unsupported_and_missing_files() {
        let root = std::env::temp_dir();
        let args = vec!["missing.pdf".to_string(), "missing.md".to_string()];
        assert!(capture_opened_files_from_args(&args, &root).is_empty());
    }

    #[test]
    fn webview_navigation_guard_allows_only_app_origins() {
        let allowed = [
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "tauri://localhost/",
            // Linux 生产源与 Vite 开发服务器（端口任意）都在 localhost 上。
            "http://localhost/",
            "http://localhost:5173/",
            // about:/blob: scheme 级豁免（PDF 导出 iframe srcdoc 与资产
            // object URL，见函数注释）：豁免只看 scheme，blob: 携带任意
            // origin 序列化均放行——不宽于 Windows（子框架不经守卫）现状。
            "about:blank",
            "about:srcdoc",
            "blob:tauri.localhost/6bd34a1f-9e5e-4a1f-8e8c-e6f6e6e6e6e6",
            "blob:https://example.com/id",
        ];
        for source in allowed {
            assert!(
                allows_webview_navigation(&source.parse().unwrap()),
                "expected allowed: {source}"
            );
        }
        let blocked = [
            "https://example.com/",
            "http://evil.example/note.md",
            "file:///C:/Windows/win.ini",
            "data:text/html,<script>",
            "javascript:alert(1)",
            "tauri://evil.example/",
            "http://tauri.localhost.evil.com/",
        ];
        for source in blocked {
            assert!(
                !allows_webview_navigation(&source.parse().unwrap()),
                "expected blocked: {source}"
            );
        }
    }

    #[test]
    fn opened_files_from_urls_keeps_supported_local_files_only() {
        let root = std::env::temp_dir().join(format!("JotLuck-urls-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let markdown = root.join("note.md");
        fs::write(&markdown, "content").unwrap();
        // 带空格文件名：URL 百分号编码（%20）必须还原后再定位文件。
        let spaced = root.join("with space.md");
        fs::write(&spaced, "content").unwrap();

        let markdown_url = tauri::Url::from_file_path(&markdown).unwrap();
        let files = opened_files_from_urls(vec![
            markdown_url.clone(),
            // 同一文件重复投递 → 去重
            markdown_url,
            // http(s) 链接不是本地文件投递 → 过滤
            tauri::Url::parse("https://example.com/note.md").unwrap(),
            // 不受支持的扩展名 → 过滤
            tauri::Url::from_file_path(root.join("tool.exe")).unwrap(),
            // 本地文件但不存在 → 过滤
            tauri::Url::from_file_path(root.join("missing.pdf")).unwrap(),
            // 空格路径经百分号解码后正常命中
            tauri::Url::from_file_path(&spaced).unwrap(),
        ]);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0], markdown.canonicalize().unwrap());
        assert_eq!(files[1], spaced.canonicalize().unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    /// P5：冷启动外链打开失败只降级为工作区主窗口，不得把错误传给
    /// setup（原 ? 传播会使 Builder 退出、应用拒启）。用 tauri::test
    /// mock runtime 驱动与生产同一份 open_startup_main_window 实现。
    #[test]
    fn startup_main_window_survives_external_file_open_failure() {
        let root = std::env::temp_dir().join(format!("JotLuck-startup-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let external = root.join("external.md");
        fs::write(&external, "# external").unwrap();
        let missing = root.join("missing.md");

        // 对照组：存在的 .md 正常把 main 注册为外部只读会话（证明下方
        // 失败用例的 Ok 不是空转）。
        let ok_app = tauri::test::mock_builder()
            .manage(fs_ops::ExternalAccessGrants::new())
            .manage(window_session::WindowSessionRegistry::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        assert!(open_startup_main_window(ok_app.handle(), &[external]).is_ok());
        assert!(matches!(
            ok_app
                .state::<window_session::WindowSessionRegistry>()
                .payload_for("main"),
            window_session::WindowBootstrapPayload::ExternalReadonly { .. }
        ));

        // 失败组：文件不存在 → 授权报错 → 降级 ensure_workspace(main)，
        // 返回 Ok 而非把错误抛给 setup。
        let failing_app = tauri::test::mock_builder()
            .manage(fs_ops::ExternalAccessGrants::new())
            .manage(window_session::WindowSessionRegistry::new())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        assert!(open_startup_main_window(failing_app.handle(), &[missing]).is_ok());
        assert!(matches!(
            failing_app
                .state::<window_session::WindowSessionRegistry>()
                .payload_for("main"),
            window_session::WindowBootstrapPayload::Workspace { .. }
        ));

        fs::remove_dir_all(root).unwrap();
    }
}
