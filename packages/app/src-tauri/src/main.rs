// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if app_lib::run_document_worker_if_requested() {
        return;
    }
    // WebKitGTK 2.42+ 的 DMABUF 渲染器在部分 Linux 驱动/会话组合下使 WebView
    // 初始化挂起（实测 Linux Mint 22.1 + WebKitGTK 2.52：setup 卡死在
    // build_window，WebProcess 不启动，窗口永不显示）。禁用 DMABUF 渲染后
    // 恢复正常。仅在用户未显式设置时注入，保留手工调优空间。
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    app_lib::run();
}
