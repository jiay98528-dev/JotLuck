fn main() {
    // Windows 应用清单改由 MSVC 链接器统一内嵌（见下方函数注释），
    // tauri-build 侧须关闭 .res 内置清单——否则 bin 上 RT_MANIFEST 资源
    // 重复（CVT1100，最小 cargo 探针实锤）。
    let attributes = tauri_build::Attributes::default().windows_attributes(
        tauri_build::WindowsAttributes::new_without_app_manifest(),
    );
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
    embed_common_controls_manifest();
}

/// Common-Controls v6 应用清单：以无作用域 cargo:rustc-link-arg 落到本包
/// 全部链接目标（bin/cdylib/单测 exe）。背景：tauri 默认开启
/// common-controls-v6 feature（default 列表可见），链入窗口/菜单代码的
/// 二进制会导入 TaskDialogIndirect（comctl32 v6 独有导出，System32 v5
/// comctl32 无此符号）；lib 单测经 MockRuntime 窗口路径也链入该代码，而
/// tauri-build 的 .res 清单只对 bin 目标生效（embed-resource 走
/// rustc-link-arg-bins），cargo:rustc-link-arg-tests 又只覆盖独立测试目标
/// （本包无 tests/ 目录，指令直接非法）——2026-10-25 门禁实锤：测试 exe
/// 编译成功但启动即 STATUS_ENTRYPOINT_NOT_FOUND（0xc0000139）。改由
/// 链接器 /MANIFEST:EMBED 对所有目标统一内嵌同款清单（内容与 tauri
/// 内置 windows-app-manifest.xml 一致），并关闭 .res 内置清单避免重复。
/// 最小 cargo 探针已验证：bin（含 .res 版本信息）/cdylib/lib 单测均可
/// 链接并正常运行。注意 /MANIFESTINPUT 需绝对路径且不含空格。
fn embed_common_controls_manifest() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os != "windows" || target_env != "msvc" {
        return;
    }
    let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") else {
        return;
    };
    let manifest = std::path::Path::new(&manifest_dir).join("windows-app-manifest.xml");
    if manifest.display().to_string().contains(' ') {
        panic!("windows-app-manifest.xml 路径含空格，MSVC /MANIFESTINPUT 无法传递");
    }
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
}
