fn main() {
    println!("cargo:rerun-if-env-changed=JOTLUCK_RELEASE_VERSION");
    println!("cargo:rerun-if-env-changed=JOTLUCK_RELEASE_CHANNEL");
    let version = std::env::var("JOTLUCK_RELEASE_VERSION").unwrap_or_else(|_| {
        std::env::var("CARGO_PKG_VERSION").expect("Cargo package version is set")
    });
    let parsed = semver::Version::parse(&version)
        .unwrap_or_else(|_| panic!("JOTLUCK_RELEASE_VERSION must be strict SemVer: {version}"));
    let inferred_channel = if parsed.pre.is_empty() {
        "stable"
    } else {
        "preview"
    };
    let channel =
        std::env::var("JOTLUCK_RELEASE_CHANNEL").unwrap_or_else(|_| inferred_channel.to_string());
    if !matches!(channel.as_str(), "stable" | "preview") || channel != inferred_channel {
        panic!("JOTLUCK_RELEASE_CHANNEL must match the version prerelease identity (stable or preview)");
    }
    println!("cargo:rustc-env=JOTLUCK_EMBEDDED_VERSION={version}");
    println!("cargo:rustc-env=JOTLUCK_EMBEDDED_CHANNEL={channel}");
    tauri_build::build()
}
