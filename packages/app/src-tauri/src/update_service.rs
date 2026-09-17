//! Process-wide, opt-in update discovery.
//!
//! The webview never talks to release hosts directly.  This keeps policy,
//! caching, migration and de-duplication consistent when several JotLuck
//! windows are open.

use reqwest::{Client, StatusCode};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio_util::sync::CancellationToken;

const UPDATE_EVENT: &str = "jotluck://update-state";
const WELCOME_REVISION: &str = "updates-opt-in-v1";
const WEBSITE_URL: &str = "https://jotluck.com/updates/v1.json";
const GITHUB_REPO: &str = "jiay98528-dev/JotLuck";
const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;
const CHECK_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS: [i64; 3] = [60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub revision: u64,
    pub current_version: String,
    pub channel: String,
    pub auto_check: bool,
    pub status: String,
    pub candidate: Option<UpdateCandidate>,
    pub last_checked: Option<i64>,
    pub welcome_completed: bool,
    pub welcome_revision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCandidate {
    pub version: String,
    pub release_url: String,
    pub notes: String,
    pub download_url: Option<String>,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacySettings {
    pub auto_check: bool,
    pub welcome_completed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferences {
    pub auto_check: bool,
    pub channel: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WelcomeClaim {
    pub show: bool,
    pub mode: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConfig {
    #[serde(default = "default_schema_version")]
    schema_version: u8,
    #[serde(default)]
    migrated_legacy: bool,
    #[serde(default)]
    legacy_welcome_completed: bool,
    #[serde(default)]
    auto_check: bool,
    #[serde(default = "default_channel")]
    channel: String,
    #[serde(default)]
    last_checked: Option<i64>,
    #[serde(default)]
    next_retry_at: Option<i64>,
    #[serde(default)]
    server_not_before: Option<i64>,
    #[serde(default)]
    retry_attempt: usize,
    #[serde(default)]
    candidate: Option<UpdateCandidate>,
    #[serde(default)]
    dismissed_versions: HashSet<String>,
    #[serde(default)]
    completed_welcome_revisions: HashSet<String>,
}

fn default_schema_version() -> u8 {
    1
}
fn default_channel() -> String {
    "stable".to_string()
}

impl Default for StoredConfig {
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            migrated_legacy: false,
            legacy_welcome_completed: false,
            auto_check: false,
            channel: default_channel(),
            last_checked: None,
            next_retry_at: None,
            server_not_before: None,
            retry_attempt: 0,
            candidate: None,
            dismissed_versions: HashSet::new(),
            completed_welcome_revisions: HashSet::new(),
        }
    }
}

struct Inner {
    config: StoredConfig,
    revision: u64,
    status: String,
    task_generation: u64,
    checking: bool,
    cancel_token: Option<CancellationToken>,
    welcome_claimed_by: Option<String>,
    notified_versions: HashSet<String>,
}

pub struct UpdateService {
    inner: Arc<Mutex<Inner>>,
    config_path: Mutex<Option<PathBuf>>,
    app: Mutex<Option<AppHandle>>,
    startup_auto_check_at: Mutex<i64>,
    client: Client,
    current_version: Version,
}

impl UpdateService {
    pub fn new() -> Self {
        let build_channel = env!("JOTLUCK_EMBEDDED_CHANNEL").to_string();
        let mut initial_config = StoredConfig::default();
        initial_config.channel = build_channel.clone();
        Self {
            inner: Arc::new(Mutex::new(Inner {
                config: initial_config,
                revision: 0,
                status: "idle".to_string(),
                task_generation: 0,
                checking: false,
                cancel_token: None,
                welcome_claimed_by: None,
                notified_versions: HashSet::new(),
            })),
            config_path: Mutex::new(None),
            app: Mutex::new(None),
            startup_auto_check_at: Mutex::new(i64::MAX),
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .user_agent("JotLuck update checker")
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() >= 5 || !is_official_metadata_url(attempt.url()) {
                        attempt.error("update redirect is outside official metadata sources")
                    } else {
                        attempt.follow()
                    }
                }))
                .build()
                .expect("update HTTP client should build"),
            current_version: Version::parse(env!("JOTLUCK_EMBEDDED_VERSION"))
                .expect("embedded version must be SemVer"),
        }
    }

    pub fn initialize(&self, app: AppHandle) {
        let path = app
            .path()
            .app_config_dir()
            .ok()
            .map(|dir| dir.join("updates-v1.json"));
        if let Some(path) = &path {
            if path.exists() {
                if let Some(config) = read_config(path)
                    .and_then(|config| validate_stored_config(config, &self.current_version))
                {
                    if let Ok(mut inner) = self.inner.lock() {
                        inner.status = cached_status(&config);
                        inner.config = config;
                    }
                } else if let Ok(mut inner) = self.inner.lock() {
                    // A broken pre-existing update file must not revive an old
                    // webview preference. Default safely to opt-out instead.
                    inner.config = StoredConfig {
                        migrated_legacy: true,
                        ..StoredConfig::default()
                    };
                    inner.status = "idle".to_string();
                    log::warn!("ignoring invalid persisted update configuration");
                }
            }
        }
        if let Ok(mut stored) = self.config_path.lock() {
            *stored = path;
        }
        if let Ok(mut stored) = self.app.lock() {
            *stored = Some(app.clone());
        }
        if let Ok(mut deadline) = self.startup_auto_check_at.lock() {
            *deadline = now_ms() + 15_000;
        }
        self.emit();
        self.spawn_scheduler();
    }

    pub fn remove_window(&self, label: &str) {
        let mut changed = false;
        if let Ok(mut inner) = self.inner.lock() {
            if inner.welcome_claimed_by.as_deref() == Some(label) {
                inner.welcome_claimed_by = None;
                inner.revision += 1;
                changed = true;
            }
        }
        if changed {
            self.emit();
        }
    }

    fn state_locked(&self, inner: &Inner) -> UpdateState {
        UpdateState {
            revision: inner.revision,
            current_version: self.current_version.to_string(),
            channel: inner.config.channel.clone(),
            auto_check: inner.config.auto_check,
            status: inner.status.clone(),
            candidate: inner.config.candidate.clone(),
            last_checked: inner.config.last_checked,
            welcome_completed: inner
                .config
                .completed_welcome_revisions
                .contains(WELCOME_REVISION),
            welcome_revision: WELCOME_REVISION.to_string(),
        }
    }

    pub fn state(&self, legacy: Option<LegacySettings>) -> Result<UpdateState, String> {
        let state = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "update service lock poisoned")?;
            if !inner.config.migrated_legacy && legacy.is_some() {
                let mut next = inner.config.clone();
                next.migrated_legacy = true;
                if let Some(legacy) = legacy {
                    // Missing/false preferences must stay opt-out; only an explicit true migrates.
                    next.auto_check = legacy.auto_check;
                    next.legacy_welcome_completed = legacy.welcome_completed;
                }
                if let Err(error) = self.persist_config(&next) {
                    log::warn!("could not migrate update preferences: {error}");
                    return Ok(self.state_locked(&inner));
                }
                inner.config = next;
                inner.revision += 1;
            }
            self.state_locked(&inner)
        };
        self.emit();
        Ok(state)
    }

    pub fn set_preferences(&self, prefs: UpdatePreferences) -> Result<UpdateState, String> {
        if prefs.channel != "stable" && prefs.channel != "preview" {
            return Err("unsupported update channel".to_string());
        }
        let should_check = prefs.auto_check;
        let state = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "update service lock poisoned")?;
            let mut next = inner.config.clone();
            let channel_changed = next.channel != prefs.channel;
            next.auto_check = prefs.auto_check;
            next.channel = prefs.channel;
            if channel_changed {
                next.candidate = None;
                next.last_checked = None;
            }
            // Persist before changing memory: a failed write must never make an
            // opt-out user appear opted in for this process.
            self.persist_config(&next)?;
            inner.config = next;
            inner.task_generation += 1; // stale requests cannot overwrite a new preference.
            if let Some(token) = inner.cancel_token.take() {
                token.cancel();
            }
            // A replacement request must not inherit the cancelled request's
            // in-flight marker. `task_generation` rejects its late result.
            inner.checking = false;
            inner.status = "idle".to_string();
            inner.revision += 1;
            self.state_locked(&inner)
        };
        self.emit();
        if should_check {
            self.start_check(false);
        }
        Ok(state)
    }

    pub fn manual_check(&self) -> Result<UpdateState, String> {
        self.start_check(true);
        self.state(None)
    }

    /// Called on focus/resume. The persisted 24-hour/retry deadline makes this
    /// a no-op unless an opted-in check is actually due.
    pub fn check_if_due(&self) {
        if self
            .startup_auto_check_at
            .lock()
            .ok()
            .is_some_and(|deadline| now_ms() < *deadline)
        {
            return;
        }
        let due = self.inner.lock().ok().is_some_and(|guard| {
            let next = next_auto_check_at(&guard.config);
            guard.config.auto_check && !guard.checking && now_ms() >= next
        });
        if due {
            self.start_check(false);
        }
    }

    pub fn dismiss(&self, version: &str) -> Result<UpdateState, String> {
        let normalized = parse_version(version)?.to_string();
        let state = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "update service lock poisoned")?;
            let mut next = inner.config.clone();
            next.dismissed_versions
                .insert(dismiss_key(&next.channel, &normalized));
            self.persist_config(&next)?;
            inner.config = next;
            inner.revision += 1;
            self.state_locked(&inner)
        };
        self.emit();
        Ok(state)
    }

    pub fn claim_welcome(
        &self,
        window: &WebviewWindow,
        replay: bool,
    ) -> Result<WelcomeClaim, String> {
        if !window.is_focused().unwrap_or(false) {
            return Ok(WelcomeClaim {
                show: false,
                mode: "upgrade".to_string(),
            });
        }
        let label = window.label().to_string();
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "update service lock poisoned")?;
        let done = inner
            .config
            .completed_welcome_revisions
            .contains(WELCOME_REVISION);
        if !replay && done {
            return Ok(WelcomeClaim {
                show: false,
                mode: "upgrade".to_string(),
            });
        }
        if let Some(owner) = &inner.welcome_claimed_by {
            if owner != &label {
                return Ok(WelcomeClaim {
                    show: false,
                    mode: "upgrade".to_string(),
                });
            }
        }
        inner.welcome_claimed_by = Some(label);
        Ok(WelcomeClaim {
            show: true,
            mode: if !replay && inner.config.legacy_welcome_completed {
                "upgrade"
            } else {
                "new"
            }
            .to_string(),
        })
    }

    pub fn complete_welcome(&self, window: &WebviewWindow) -> Result<UpdateState, String> {
        let state = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "update service lock poisoned")?;
            if inner.welcome_claimed_by.as_deref() == Some(window.label()) {
                let mut next = inner.config.clone();
                next.legacy_welcome_completed = true;
                next.completed_welcome_revisions
                    .insert(WELCOME_REVISION.to_string());
                self.persist_config(&next)?;
                inner.config = next;
                inner.welcome_claimed_by = None;
                inner.revision += 1;
            }
            self.state_locked(&inner)
        };
        self.emit();
        Ok(state)
    }

    pub fn release_welcome(&self, window: &WebviewWindow) {
        self.remove_window(window.label());
    }

    pub fn claim_notification(&self, window: &WebviewWindow) -> bool {
        if !window.is_focused().unwrap_or(false) {
            return false;
        }
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        if inner.welcome_claimed_by.is_some()
            || !matches!(inner.status.as_str(), "available" | "unverified")
        {
            return false;
        }
        let Some(candidate) = &inner.config.candidate else {
            return false;
        };
        if !inner.config.auto_check
            || inner
                .config
                .dismissed_versions
                .contains(&dismiss_key(&inner.config.channel, &candidate.version))
            || inner.notified_versions.contains(&candidate.version)
        {
            return false;
        }
        let version = candidate.version.clone();
        inner.notified_versions.insert(version);
        true
    }

    fn start_check(&self, manual: bool) {
        let (generation, channel, cancel) = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            if inner.checking {
                return;
            }
            if inner
                .config
                .server_not_before
                .is_some_and(|deadline| now_ms() < deadline)
            {
                return;
            }
            if !manual && !inner.config.auto_check {
                return;
            }
            inner.checking = true;
            let cancel = CancellationToken::new();
            inner.cancel_token = Some(cancel.clone());
            inner.status = "checking".to_string();
            inner.revision += 1;
            (inner.task_generation, inner.config.channel.clone(), cancel)
        };
        self.emit();
        let inner = Arc::clone(&self.inner);
        let client = self.client.clone();
        let current = self.current_version.clone();
        let app = self.app.lock().ok().and_then(|app| app.clone());
        let config_path = self.config_path.lock().ok().and_then(|path| path.clone());
        tauri::async_runtime::spawn(async move {
            let outcome = tokio::select! { _ = cancel.cancelled() => return, result = check_remote(&client, &current, &channel) => result };
            let mut should_emit = false;
            if let Ok(mut guard) = inner.lock() {
                if guard.task_generation != generation {
                    return;
                }
                guard.checking = false;
                guard.cancel_token = None;
                match outcome {
                    Ok(result) => {
                        guard.status = result.status;
                        guard.config.candidate = result.candidate;
                        guard.config.last_checked = Some(now_ms());
                        apply_success_schedule(&mut guard, result.partial);
                    }
                    Err(error) => {
                        log::warn!("update check failed: {error}");
                        guard.status = "failed".to_string();
                        apply_failure_schedule(&mut guard, &error);
                    }
                }
                guard.revision += 1;
                should_emit = true;
                if let Some(path) = config_path.as_ref() {
                    let _ = write_config(path, &guard.config);
                }
            }
            if should_emit {
                if let Some(app) = app {
                    if let Ok(guard) = inner.lock() {
                        let _ = app.emit(UPDATE_EVENT, snapshot(&guard, &current));
                    }
                }
            }
        });
    }

    fn spawn_scheduler(&self) {
        let inner = Arc::clone(&self.inner);
        let client = self.client.clone();
        let current = self.current_version.clone();
        let app = self.app.lock().ok().and_then(|app| app.clone());
        let config_path = self.config_path.lock().ok().and_then(|path| path.clone());
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(15)).await;
            loop {
                let run = {
                    let Ok(guard) = inner.lock() else {
                        return;
                    };
                    let due = next_auto_check_at(&guard.config);
                    guard.config.auto_check && !guard.checking && now_ms() >= due
                };
                if run {
                    spawn_check_shared(
                        Arc::clone(&inner),
                        client.clone(),
                        current.clone(),
                        app.clone(),
                        config_path.clone(),
                        false,
                    );
                }
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        });
    }

    fn persist_config(&self, config: &StoredConfig) -> Result<(), String> {
        let path = self
            .config_path
            .lock()
            .map_err(|_| "update config lock poisoned")?
            .clone();
        if let Some(path) = path {
            write_config(&path, config)?;
        } else if self
            .app
            .lock()
            .map_err(|_| "update app lock poisoned")?
            .is_some()
        {
            return Err("update preferences cannot be persisted because the app config directory is unavailable".to_string());
        }
        Ok(())
    }

    fn emit(&self) {
        let Ok(guard) = self.inner.lock() else {
            return;
        };
        let state = self.state_locked(&guard);
        if let Ok(app) = self.app.lock() {
            if let Some(app) = app.as_ref() {
                let _ = app.emit(UPDATE_EVENT, state);
            }
        }
    }
}

// Scheduler uses the same guarded transition as a manual request but is kept
// free-standing so it can run without a borrowed `UpdateService`.
fn spawn_check_shared(
    inner: Arc<Mutex<Inner>>,
    client: Client,
    current: Version,
    app: Option<AppHandle>,
    config_path: Option<PathBuf>,
    manual: bool,
) {
    let (generation, channel, cancel) = {
        let Ok(mut guard) = inner.lock() else {
            return;
        };
        if guard.checking
            || (!manual && !guard.config.auto_check)
            || guard
                .config
                .server_not_before
                .is_some_and(|deadline| now_ms() < deadline)
        {
            return;
        }
        guard.checking = true;
        guard.status = "checking".to_string();
        guard.revision += 1;
        let cancel = CancellationToken::new();
        guard.cancel_token = Some(cancel.clone());
        (guard.task_generation, guard.config.channel.clone(), cancel)
    };
    if let Some(app) = &app {
        if let Ok(guard) = inner.lock() {
            let _ = app.emit(UPDATE_EVENT, snapshot(&guard, &current));
        }
    }
    tauri::async_runtime::spawn(async move {
        let outcome = tokio::select! { _ = cancel.cancelled() => return, result = check_remote(&client, &current, &channel) => result };
        if let Ok(mut guard) = inner.lock() {
            if guard.task_generation != generation {
                return;
            }
            guard.checking = false;
            guard.cancel_token = None;
            match outcome {
                Ok(result) => {
                    guard.status = result.status;
                    guard.config.candidate = result.candidate;
                    guard.config.last_checked = Some(now_ms());
                    apply_success_schedule(&mut guard, result.partial);
                }
                Err(error) => {
                    log::warn!("update check failed: {error}");
                    guard.status = "failed".to_string();
                    apply_failure_schedule(&mut guard, &error);
                }
            }
            guard.revision += 1;
            if let Some(path) = config_path.as_ref() {
                let _ = write_config(path, &guard.config);
            }
            if let Some(app) = &app {
                let _ = app.emit(UPDATE_EVENT, snapshot(&guard, &current));
            }
        }
    });
}

fn apply_success_schedule(inner: &mut Inner, partial: bool) {
    if partial {
        let delay = RETRY_DELAYS_MS[inner.config.retry_attempt.min(RETRY_DELAYS_MS.len() - 1)];
        inner.config.retry_attempt =
            (inner.config.retry_attempt + 1).min(RETRY_DELAYS_MS.len() - 1);
        inner.config.next_retry_at = Some(now_ms() + delay);
    } else {
        inner.config.next_retry_at = None;
        inner.config.server_not_before = None;
        inner.config.retry_attempt = 0;
    }
}

fn next_auto_check_at(config: &StoredConfig) -> i64 {
    config
        .next_retry_at
        .or_else(|| {
            config
                .last_checked
                .map(|at| at.saturating_add(CHECK_INTERVAL_MS))
        })
        .unwrap_or(0)
        .max(config.server_not_before.unwrap_or(0))
}

fn apply_failure_schedule(inner: &mut Inner, error: &str) {
    let rate_deadline = error
        .strip_prefix("rate limited until ")
        .and_then(|value| value.parse::<i64>().ok());
    if let Some(deadline) = rate_deadline {
        inner.config.server_not_before = Some(deadline);
    }
    let delay = RETRY_DELAYS_MS[inner.config.retry_attempt.min(RETRY_DELAYS_MS.len() - 1)];
    inner.config.retry_attempt = (inner.config.retry_attempt + 1).min(RETRY_DELAYS_MS.len() - 1);
    inner.config.next_retry_at = Some(now_ms() + delay);
}

fn snapshot(inner: &Inner, current: &Version) -> UpdateState {
    UpdateState {
        revision: inner.revision,
        current_version: current.to_string(),
        channel: inner.config.channel.clone(),
        auto_check: inner.config.auto_check,
        status: inner.status.clone(),
        candidate: inner.config.candidate.clone(),
        last_checked: inner.config.last_checked,
        welcome_completed: inner
            .config
            .completed_welcome_revisions
            .contains(WELCOME_REVISION),
        welcome_revision: WELCOME_REVISION.to_string(),
    }
}

struct CheckResult {
    status: String,
    candidate: Option<UpdateCandidate>,
    partial: bool,
}

#[derive(Debug)]
enum FetchError {
    Network(String),
    Invalid(String),
    RateLimited(i64),
}
impl FetchError {
    fn text(self) -> String {
        match self {
            Self::Network(s) | Self::Invalid(s) => s,
            Self::RateLimited(deadline) => format!("rate limited until {deadline}"),
        }
    }
}

async fn check_remote(
    client: &Client,
    current: &Version,
    channel: &str,
) -> Result<CheckResult, String> {
    match fetch_json(client, WEBSITE_URL).await {
        Ok(json) => match website_release(&json, channel)? {
            None => Ok(CheckResult {
                status: "latest".to_string(),
                candidate: None,
                partial: false,
            }),
            Some(site) => match github_tag(
                client,
                &site.tag,
                site.asset.as_ref().map(|asset| asset.name.as_str()),
            )
            .await
            {
                Ok(github) => reconcile(site, github, current),
                Err(GithubLookupError::NotFound) => Ok(CheckResult {
                    status: "outOfSync".to_string(),
                    candidate: None,
                    partial: true,
                }),
                Err(GithubLookupError::Network(error)) => {
                    log::warn!("GitHub update verification unavailable: {error}");
                    result_for(current, site.into_candidate("website"))
                }
                Err(GithubLookupError::Invalid(error)) => {
                    log::warn!("invalid GitHub release: {error}");
                    Ok(CheckResult {
                        status: "outOfSync".to_string(),
                        candidate: None,
                        partial: true,
                    })
                }
                Err(GithubLookupError::RateLimited(deadline)) => {
                    Err(format!("rate limited until {deadline}"))
                }
            },
        },
        Err(FetchError::Network(site_error)) => {
            log::warn!("website update manifest unavailable: {site_error}");
            let github = github_latest(client, channel)
                .await
                .map_err(FetchError::text)?;
            result_for(current, github.into_candidate("github"))
        }
        Err(FetchError::Invalid(error)) => {
            log::warn!("invalid website manifest: {error}");
            Ok(CheckResult {
                status: "outOfSync".into(),
                candidate: None,
                partial: true,
            })
        }
        Err(FetchError::RateLimited(deadline)) => Err(format!("rate limited until {deadline}")),
    }
}

fn result_for(current: &Version, candidate: UpdateCandidate) -> Result<CheckResult, String> {
    let version = parse_version(&candidate.version)?;
    let partial = candidate.source != "confirmed";
    Ok(CheckResult {
        status: if partial {
            "unverified"
        } else if version > *current {
            "available"
        } else {
            "latest"
        }
        .to_string(),
        candidate: (version > *current).then_some(candidate),
        partial,
    })
}

fn reconcile(
    site: ReleaseInfo,
    github: ReleaseInfo,
    current: &Version,
) -> Result<CheckResult, String> {
    if parse_version(&site.version)? != parse_version(&github.version)?
        || site.tag != github.tag
        || !release_urls_match(&site.release_url, &github.release_url)
    {
        return Ok(CheckResult {
            status: "outOfSync".to_string(),
            candidate: None,
            partial: true,
        });
    }
    let download = match (&site.asset, &github.asset) {
        (Some(site_asset), Some(github_asset))
            if assets_match(site_asset, github_asset, &site.tag) =>
        {
            Some(github_asset.url.clone())
        }
        (None, None) => {
            return Ok(CheckResult {
                status: "unsupported".to_string(),
                candidate: None,
                partial: false,
            })
        }
        _ => {
            return Ok(CheckResult {
                status: "outOfSync".to_string(),
                candidate: None,
                partial: true,
            })
        }
    };
    result_for(
        current,
        UpdateCandidate {
            version: site.version,
            release_url: github.release_url,
            notes: github.notes.or(site.notes).unwrap_or_default(),
            download_url: download,
            source: "confirmed".to_string(),
        },
    )
}

#[derive(Clone)]
struct Asset {
    name: String,
    url: String,
    size: Option<u64>,
    sha256: Option<String>,
}
#[derive(Clone)]
struct ReleaseInfo {
    version: String,
    tag: String,
    release_url: String,
    notes: Option<String>,
    asset: Option<Asset>,
}
impl ReleaseInfo {
    fn into_candidate(self, source: &str) -> UpdateCandidate {
        UpdateCandidate {
            version: self.version,
            release_url: self.release_url,
            notes: self.notes.unwrap_or_default(),
            download_url: self.asset.map(|asset| asset.url),
            source: source.to_string(),
        }
    }
}

#[derive(Debug)]
enum GithubLookupError {
    NotFound,
    Network(String),
    Invalid(String),
    RateLimited(i64),
}

async fn github_tag(
    client: &Client,
    tag: &str,
    preferred_asset: Option<&str>,
) -> Result<ReleaseInfo, GithubLookupError> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/tags/{tag}");
    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| GithubLookupError::Network(e.to_string()))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Err(GithubLookupError::NotFound);
    }
    let json = response_json(response).await.map_err(|error| match error {
        FetchError::Network(message) => GithubLookupError::Network(message),
        FetchError::Invalid(message) => GithubLookupError::Invalid(message),
        FetchError::RateLimited(deadline) => GithubLookupError::RateLimited(deadline),
    })?;
    let mut release = github_release(&json).map_err(GithubLookupError::Invalid)?;
    if let Some(name) = preferred_asset {
        release.asset = json
            .get("assets")
            .and_then(Value::as_array)
            .and_then(|assets| {
                assets
                    .iter()
                    .find(|asset| asset.get("name").and_then(Value::as_str) == Some(name))
            })
            .and_then(github_asset_for_platform);
    }
    Ok(release)
}

async fn github_latest(client: &Client, channel: &str) -> Result<ReleaseInfo, FetchError> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=30");
    let json = fetch_json(client, &url).await?;
    let releases = json
        .as_array()
        .ok_or_else(|| FetchError::Invalid("GitHub releases response is not an array".into()))?;
    releases
        .iter()
        .filter_map(|item| github_release(item).ok())
        .filter(|release| release_allowed(&release.version, channel))
        .max_by_key(|release| parse_version(&release.version).ok())
        .ok_or_else(|| FetchError::Invalid("GitHub has no compatible release".into()))
}

fn release_allowed(version: &str, channel: &str) -> bool {
    parse_version(version)
        .map(|v| channel == "preview" || v.pre.is_empty())
        .unwrap_or(false)
}

async fn fetch_json(client: &Client, url: &str) -> Result<Value, FetchError> {
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| FetchError::Network(e.to_string()))?;
    response_json(response).await
}

async fn response_json(response: reqwest::Response) -> Result<Value, FetchError> {
    let reset = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .map(|seconds| now_ms().saturating_add(seconds.max(0).saturating_mul(1000)))
        .or_else(|| {
            response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| chrono::DateTime::parse_from_rfc2822(value).ok())
                .map(|date| date.timestamp_millis())
        })
        .or_else(|| {
            response
                .headers()
                .get("x-ratelimit-reset")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<i64>().ok())
                .map(|seconds| seconds.max(0).saturating_mul(1000))
        });
    if response.status() == StatusCode::TOO_MANY_REQUESTS
        || (response.status() == StatusCode::FORBIDDEN && reset.is_some())
    {
        return Err(FetchError::RateLimited(
            reset.unwrap_or_else(|| now_ms() + RETRY_DELAYS_MS[0]),
        ));
    }
    if !response.status().is_success() {
        return Err(FetchError::Network(format!("HTTP {}", response.status())));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES)
    {
        return Err(FetchError::Invalid("response exceeds 1 MiB".into()));
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| FetchError::Network(e.to_string()))?
    {
        if bytes.len().saturating_add(chunk.len()) as u64 > MAX_RESPONSE_BYTES {
            return Err(FetchError::Invalid("response exceeds 1 MiB".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|e| FetchError::Invalid(format!("invalid JSON: {e}")))
}

fn website_release(root: &Value, channel: &str) -> Result<Option<ReleaseInfo>, String> {
    if root.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("unsupported website manifest schema".to_string());
    }
    let channel_value = root
        .get("channels")
        .and_then(|channels| channels.get(channel))
        .or_else(|| root.get(channel))
        .ok_or("website manifest has no selected channel")?;
    let enabled = channel_value
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or("website channel has no enabled flag")?;
    if !enabled {
        return Ok(None);
    }
    let release = channel_value.get("release").unwrap_or(channel_value);
    if release.is_null() {
        return Ok(None);
    }
    let release = release_from_value(release, false)?;
    if !release_allowed(&release.version, channel) {
        return Err("website release does not match the selected channel".into());
    }
    Ok(Some(release))
}

fn github_release(value: &Value) -> Result<ReleaseInfo, String> {
    if value.get("draft").and_then(Value::as_bool) != Some(false) {
        return Err("GitHub release draft flag is missing or true".to_string());
    }
    let tag = value
        .get("tag_name")
        .and_then(Value::as_str)
        .ok_or("GitHub release has no tag")?
        .to_string();
    let version = parse_version(&tag)?.to_string();
    let prerelease = value
        .get("prerelease")
        .and_then(Value::as_bool)
        .ok_or("GitHub release prerelease flag is missing")?;
    if prerelease != !parse_version(&version)?.pre.is_empty() {
        return Err("GitHub prerelease flag does not match its SemVer tag".to_string());
    }
    let release_url = value
        .get("html_url")
        .and_then(Value::as_str)
        .ok_or("GitHub release has no URL")?
        .to_string();
    if !is_exact_release_url(&release_url, &tag) {
        return Err("GitHub release URL does not match its exact tag".to_string());
    }
    let notes = value
        .get("body")
        .and_then(Value::as_str)
        .map(str::to_string);
    let asset = value
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| assets.iter().find_map(github_asset_for_platform));
    Ok(ReleaseInfo {
        version,
        tag,
        release_url,
        notes,
        asset,
    })
}

fn release_from_value(value: &Value, github: bool) -> Result<ReleaseInfo, String> {
    let raw_version = value
        .get("version")
        .and_then(Value::as_str)
        .ok_or("release has no version")?;
    let version = Version::parse(raw_version)
        .map_err(|_| "website version is not strict SemVer")?
        .to_string();
    let tag = value
        .get("tag")
        .or_else(|| value.get("githubTag"))
        .and_then(Value::as_str)
        .unwrap_or(raw_version)
        .to_string();
    let release_url = value
        .get("releaseUrl")
        .or_else(|| value.get("url"))
        .and_then(Value::as_str)
        .ok_or("release has no URL")?
        .to_string();
    if parse_version(&tag)?.to_string() != version || !is_exact_release_url(&release_url, &tag) {
        return Err("release URL or tag does not match its version".to_string());
    }
    let notes = value
        .get("notes")
        .or_else(|| value.get("summary"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let asset = website_asset_for_platform(value.get("assets").and_then(Value::as_array))?;
    if let Some(asset) = &asset {
        if !is_exact_download_url(&asset.url, &tag, &asset.name) {
            return Err("website asset URL does not match its exact tag and name".to_string());
        }
    }
    if github {
        unreachable!()
    }
    Ok(ReleaseInfo {
        version,
        tag,
        release_url,
        notes,
        asset,
    })
}

fn github_asset_for_platform(value: &Value) -> Option<Asset> {
    let name = value.get("name")?.as_str()?.to_string();
    if !asset_name_matches_platform(&name) {
        return None;
    }
    let url = value.get("browser_download_url")?.as_str()?.to_string();
    if !is_safe_download_url(&url) {
        return None;
    }
    let sha256 = match value.get("digest") {
        None | Some(Value::Null) => None,
        Some(Value::String(digest)) => {
            let hash = digest.strip_prefix("sha256:")?;
            if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return None;
            }
            Some(hash.to_string())
        }
        _ => return None,
    };
    Some(Asset {
        name,
        url,
        size: value
            .get("size")
            .and_then(Value::as_u64)
            .filter(|size| *size > 0),
        sha256,
    })
}

fn website_asset_for_platform(values: Option<&Vec<Value>>) -> Result<Option<Asset>, String> {
    let Some(values) = values else {
        return Ok(None);
    };
    let mut matches: Vec<&Value> = values
        .iter()
        .filter(|value| {
            value.get("os").and_then(Value::as_str) == Some(platform_os())
                && value
                    .get("arch")
                    .and_then(Value::as_str)
                    .is_some_and(arch_matches)
        })
        .collect();
    let mut packages = HashSet::new();
    for value in &matches {
        let package = value
            .get("packageType")
            .and_then(Value::as_str)
            .ok_or("website asset has no package type")?;
        let valid = matches!(
            (platform_os(), package),
            ("windows", "nsis") | ("macos", "dmg") | ("linux", "deb" | "appimage")
        );
        if !valid || !packages.insert(package) {
            return Err("website manifest has an invalid or duplicate package target".into());
        }
    }
    // Linux can publish both formats. Prefer the deb package, then match the
    // GitHub asset by this exact name rather than the API array order.
    matches.sort_by_key(|value| {
        if value.get("packageType").and_then(Value::as_str) == Some("appimage") {
            1
        } else {
            0
        }
    });
    let Some(value) = matches.first() else {
        return Ok(None);
    };
    let package_type = value
        .get("packageType")
        .and_then(Value::as_str)
        .ok_or("website asset has no package type")?;
    if package_type.is_empty() {
        return Err("website asset has an empty package type".to_string());
    }
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .ok_or("website asset has no name")?
        .to_string();
    if !asset_name_matches_platform(&name) {
        return Err("website asset name does not identify this platform".to_string());
    }
    let url = value
        .get("downloadUrl")
        .or_else(|| value.get("url"))
        .and_then(Value::as_str)
        .ok_or("website asset has no download URL")?
        .to_string();
    if !is_safe_download_url(&url) {
        return Err("website asset URL is outside official sources".to_string());
    }
    let size = value
        .get("size")
        .and_then(Value::as_u64)
        .ok_or("website asset has no size")?;
    if size == 0 {
        return Err("website asset is empty".into());
    }
    let sha256 = value
        .get("sha256")
        .and_then(Value::as_str)
        .ok_or("website asset has no SHA-256")?
        .to_string();
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("website asset SHA-256 is invalid".to_string());
    }
    Ok(Some(Asset {
        name,
        url,
        size: Some(size),
        sha256: Some(sha256),
    }))
}

fn assets_match(site: &Asset, github: &Asset, tag: &str) -> bool {
    site.name == github.name
        && site.url == github.url
        && site
            .size
            .zip(github.size)
            .map(|(a, b)| a == b)
            .unwrap_or(false)
        && site
            .sha256
            .as_ref()
            .zip(github.sha256.as_ref())
            .map(|(a, b)| a.eq_ignore_ascii_case(b))
            .unwrap_or(true)
        && is_exact_download_url(&site.url, tag, &site.name)
}
fn platform_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}
fn arch_matches(arch: &str) -> bool {
    matches!(
        (std::env::consts::ARCH, arch),
        ("aarch64", "aarch64" | "arm64") | ("x86_64", "x86_64" | "amd64") | ("x86", "x86" | "i686")
    )
}
fn asset_name_matches_platform(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let os = platform_os();
    let os_match = match os {
        "macos" => lower.contains("mac") || lower.ends_with(".dmg"),
        "windows" => lower.contains("win") || lower.ends_with(".exe") || lower.ends_with(".msi"),
        _ => lower.contains("linux") || lower.ends_with(".appimage") || lower.ends_with(".deb"),
    };
    os_match && arch_matches_name(&lower)
}
fn arch_matches_name(name: &str) -> bool {
    match std::env::consts::ARCH {
        "aarch64" => name.contains("aarch64") || name.contains("arm64"),
        "x86_64" => name.contains("x86_64") || name.contains("amd64") || name.contains("x64"),
        _ => true,
    }
}
fn parse_version(raw: &str) -> Result<Version, String> {
    Version::parse(
        raw.strip_prefix('v')
            .or_else(|| raw.strip_prefix('V'))
            .unwrap_or(raw),
    )
    .map_err(|_| "release version is not strict SemVer".to_string())
}
fn dismiss_key(channel: &str, version: &str) -> String {
    format!("{channel}:{version}")
}
fn clean_https_url(raw: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(raw).ok()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none())
    .then_some(url)
}
fn is_safe_release_url(url: &str) -> bool {
    let Some(url) = clean_https_url(url) else {
        return false;
    };
    url.host_str() == Some("github.com")
        && url
            .path()
            .starts_with(&format!("/{GITHUB_REPO}/releases/tag/"))
}
fn is_safe_download_url(url: &str) -> bool {
    let Some(url) = clean_https_url(url) else {
        return false;
    };
    url.host_str() == Some("github.com")
        && url
            .path()
            .starts_with(&format!("/{GITHUB_REPO}/releases/download/"))
}
fn is_exact_release_url(url: &str, tag: &str) -> bool {
    exact_official_url(
        url,
        &format!("https://github.com/{GITHUB_REPO}/releases/tag/{tag}"),
    )
}
fn is_exact_download_url(url: &str, tag: &str, name: &str) -> bool {
    // The expected URL is parsed rather than string-compared so legal spaces
    // and '+' build metadata receive the same canonical percent encoding as a
    // manifest URL. A package name can never introduce a new path segment.
    if name.is_empty() || name.contains(['/', '\\']) || matches!(name, "." | "..") {
        return false;
    }
    exact_official_url(
        url,
        &format!("https://github.com/{GITHUB_REPO}/releases/download/{tag}/{name}"),
    )
}
fn exact_official_url(raw: &str, expected: &str) -> bool {
    let Some(actual) = clean_https_url(raw) else {
        return false;
    };
    let Ok(expected) = reqwest::Url::parse(expected) else {
        return false;
    };
    if actual.host_str() != expected.host_str() {
        return false;
    }
    let decode = |url: &reqwest::Url| -> Option<Vec<String>> {
        url.path_segments()?
            .map(|segment| {
                percent_encoding::percent_decode_str(segment)
                    .decode_utf8()
                    .ok()
                    .map(|s| s.into_owned())
            })
            .collect()
    };
    decode(&actual)
        .zip(decode(&expected))
        .is_some_and(|(actual, expected)| actual == expected)
}
fn is_official_metadata_url(url: &reqwest::Url) -> bool {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return false;
    }
    match url.host_str() {
        Some("jotluck.com" | "www.jotluck.com") => url.path() == "/updates/v1.json",
        Some("api.github.com") => url
            .path()
            .starts_with(&format!("/repos/{GITHUB_REPO}/releases")),
        _ => false,
    }
}
fn release_urls_match(a: &str, b: &str) -> bool {
    a == b
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn cached_status(config: &StoredConfig) -> String {
    match &config.candidate {
        Some(candidate) if candidate.source == "confirmed" => "available".to_string(),
        Some(_) => "unverified".to_string(),
        None => "idle".to_string(),
    }
}

fn validate_stored_config(mut config: StoredConfig, current: &Version) -> Option<StoredConfig> {
    if config.schema_version != 1 || !matches!(config.channel.as_str(), "stable" | "preview") {
        return None;
    }
    if let Some(candidate) = &config.candidate {
        let version = parse_version(&candidate.version).ok();
        let source_ok = matches!(
            candidate.source.as_str(),
            "website" | "github" | "confirmed"
        );
        let download_ok = candidate
            .download_url
            .as_ref()
            .is_none_or(|url| is_safe_download_url(url));
        if !source_ok
            || version.is_none_or(|version| version <= *current)
            || !is_safe_release_url(&candidate.release_url)
            || !download_ok
        {
            config.candidate = None;
        }
    }
    Some(config)
}

fn read_config(path: &PathBuf) -> Option<StoredConfig> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}
fn write_config(path: &PathBuf, config: &StoredConfig) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("update config has no parent directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let serialized = serde_json::to_vec(config).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serialized).map_err(|e| e.to_string())?;
    fs::rename(&temporary, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_update_state(
    service: tauri::State<'_, UpdateService>,
    legacy: Option<LegacySettings>,
) -> Result<UpdateState, String> {
    service.state(legacy)
}
#[tauri::command]
pub fn set_update_preferences(
    service: tauri::State<'_, UpdateService>,
    auto_check: bool,
    channel: String,
) -> Result<UpdateState, String> {
    service.set_preferences(UpdatePreferences {
        auto_check,
        channel,
    })
}
#[tauri::command]
pub fn check_for_updates(service: tauri::State<'_, UpdateService>) -> Result<UpdateState, String> {
    service.manual_check()
}
#[tauri::command]
pub fn dismiss_update_version(
    service: tauri::State<'_, UpdateService>,
    version: String,
) -> Result<UpdateState, String> {
    service.dismiss(&version)
}
#[tauri::command]
pub fn claim_welcome(
    service: tauri::State<'_, UpdateService>,
    window: WebviewWindow,
    replay: bool,
) -> Result<WelcomeClaim, String> {
    service.claim_welcome(&window, replay)
}
#[tauri::command]
pub fn complete_welcome(
    service: tauri::State<'_, UpdateService>,
    window: WebviewWindow,
) -> Result<UpdateState, String> {
    service.complete_welcome(&window)
}
#[tauri::command]
pub fn release_welcome(service: tauri::State<'_, UpdateService>, window: WebviewWindow) {
    service.release_welcome(&window)
}
#[tauri::command]
pub fn claim_update_notification(
    service: tauri::State<'_, UpdateService>,
    window: WebviewWindow,
) -> bool {
    service.claim_notification(&window)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_short_retry_after_does_not_bypass_automatic_failure_backoff() {
        let service = UpdateService::new();
        let mut inner = service.inner.lock().unwrap();
        let before = now_ms();
        apply_failure_schedule(
            &mut inner,
            &format!("rate limited until {}", before + 10_000),
        );
        assert!(next_auto_check_at(&inner.config) >= before + RETRY_DELAYS_MS[0]);
        assert_eq!(inner.config.server_not_before, Some(before + 10_000));
    }
    #[test]
    fn an_expired_server_limit_cannot_override_a_later_retry() {
        let mut config = StoredConfig::default();
        config.server_not_before = Some(1);
        config.next_retry_at = Some(100);
        assert_eq!(next_auto_check_at(&config), 100);
        config.server_not_before = Some(200);
        assert_eq!(next_auto_check_at(&config), 200);
    }
    #[test]
    fn urls_support_encoded_build_tags_and_names_without_path_escape() {
        assert!(is_exact_release_url(
            "https://github.com/jiay98528-dev/JotLuck/releases/tag/v1.2.3%2Bbuild",
            "v1.2.3+build"
        ));
        assert!(is_exact_download_url("https://github.com/jiay98528-dev/JotLuck/releases/download/v1.2.3%2Bbuild/JotLuck%20x64.exe", "v1.2.3+build", "JotLuck x64.exe"));
        assert!(!is_exact_download_url(
            "https://github.com/jiay98528-dev/JotLuck/releases/download/v1.2.3/app.exe",
            "v1.2.3",
            "../app.exe"
        ));
    }
    #[test]
    fn stable_website_channel_cannot_offer_a_preview() {
        let value = serde_json::json!({"schemaVersion": 1, "channels": {"stable": {"enabled": true, "release": {
            "version": "1.2.3-preview", "tag": "v1.2.3-preview", "releaseUrl": "https://github.com/jiay98528-dev/JotLuck/releases/tag/v1.2.3-preview", "assets": []
        }}}});
        assert!(website_release(&value, "stable").is_err());
    }
    #[test]
    fn missing_github_digest_does_not_claim_hash_verification_or_block_updates() {
        let site = Asset {
            name: "app.exe".into(),
            url: "https://github.com/jiay98528-dev/JotLuck/releases/download/v1.2.3/app.exe".into(),
            size: Some(10),
            sha256: Some("a".repeat(64)),
        };
        let mut github = site.clone();
        github.sha256 = None;
        assert!(assets_match(&site, &github, "v1.2.3"));
        github.sha256 = Some("b".repeat(64));
        assert!(!assets_match(&site, &github, "v1.2.3"));
    }
    #[test]
    fn metadata_redirects_never_follow_other_hosts_or_insecure_transport() {
        for raw in [
            "https://evil.invalid/updates/v1.json",
            "http://jotluck.com/updates/v1.json",
            "https://jotluck.com/other",
        ] {
            assert!(!is_official_metadata_url(
                &reqwest::Url::parse(raw).unwrap()
            ));
        }
        assert!(is_official_metadata_url(
            &reqwest::Url::parse(WEBSITE_URL).unwrap()
        ));
    }
    #[test]
    fn failed_preference_write_does_not_enable_the_service() {
        let service = UpdateService::new();
        let root =
            std::env::temp_dir().join(format!("JotLuck-update-write-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let blocker = root.join("not-a-directory");
        fs::write(&blocker, b"test fixture").unwrap();
        *service.config_path.lock().unwrap() = Some(blocker.join("updates.json"));
        assert!(service
            .set_preferences(UpdatePreferences {
                auto_check: true,
                channel: "stable".into()
            })
            .is_err());
        assert!(!service.inner.lock().unwrap().config.auto_check);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn accepts_strict_semver_and_rejects_loose_versions() {
        assert_eq!(
            parse_version("v1.2.3-preview.1").unwrap(),
            Version::parse("1.2.3-preview.1").unwrap()
        );
        assert!(parse_version("1.2").is_err());
        assert!(parse_version("release-1.2.3").is_err());
    }
    #[test]
    fn stable_ignores_preview() {
        assert!(!release_allowed("1.1.0-preview.1", "stable"));
        assert!(release_allowed("1.1.0", "stable"));
        assert!(release_allowed("1.1.0-preview.1", "preview"));
    }
    #[test]
    fn website_manifest_requires_schema_and_safe_urls() {
        let value: Value = serde_json::json!({"schemaVersion":1,"stable":{"enabled":true,"release":{"version":"1.2.3","tag":"v1.2.3","releaseUrl":"https://github.com/jiay98528-dev/JotLuck/releases/tag/v1.2.3"}}});
        assert_eq!(
            website_release(&value, "stable").unwrap().unwrap().version,
            "1.2.3"
        );
        let unsafe_value: Value = serde_json::json!({"schemaVersion":1,"stable":{"version":"1.2.3","releaseUrl":"https://evil.invalid/release"}});
        assert!(website_release(&unsafe_value, "stable").is_err());
    }
    #[test]
    fn disabled_website_channel_is_not_a_github_fallback() {
        let value: Value = serde_json::json!({"schemaVersion":1,"stable":{"enabled":false}});
        assert!(website_release(&value, "stable").unwrap().is_none());
    }
    #[test]
    fn dismissals_are_channel_scoped() {
        assert_ne!(
            dismiss_key("stable", "1.2.3"),
            dismiss_key("preview", "1.2.3")
        );
    }
    #[test]
    fn legacy_migration_keeps_an_explicit_false_and_only_runs_once() {
        let service = UpdateService::new();
        service
            .state(Some(LegacySettings {
                auto_check: false,
                welcome_completed: true,
            }))
            .unwrap();
        service
            .state(Some(LegacySettings {
                auto_check: true,
                welcome_completed: false,
            }))
            .unwrap();
        let guard = service.inner.lock().unwrap();
        assert!(guard.config.migrated_legacy);
        assert!(!guard.config.auto_check);
        assert!(guard.config.legacy_welcome_completed);
    }
    #[test]
    fn replacing_preferences_cancels_and_clears_an_inflight_task() {
        let service = UpdateService::new();
        let token = CancellationToken::new();
        {
            let mut guard = service.inner.lock().unwrap();
            guard.checking = true;
            guard.cancel_token = Some(token.clone());
        }
        service
            .set_preferences(UpdatePreferences {
                auto_check: false,
                channel: "stable".into(),
            })
            .unwrap();
        let guard = service.inner.lock().unwrap();
        assert!(token.is_cancelled());
        assert!(!guard.checking);
        assert!(guard.task_generation > 0);
    }
    #[test]
    fn partial_success_uses_retry_backoff() {
        let mut inner = Inner {
            config: StoredConfig::default(),
            revision: 0,
            status: "idle".into(),
            task_generation: 0,
            checking: false,
            cancel_token: None,
            welcome_claimed_by: None,
            notified_versions: HashSet::new(),
        };
        apply_success_schedule(&mut inner, true);
        assert!(inner.config.next_retry_at.unwrap() > now_ms());
        assert_eq!(inner.config.retry_attempt, 1);
        apply_success_schedule(&mut inner, false);
        assert_eq!(inner.config.retry_attempt, 0);
        assert!(inner.config.next_retry_at.is_none());
    }
    #[test]
    fn invalid_cached_candidate_is_dropped_without_enabling_checks() {
        let mut config = StoredConfig::default();
        config.candidate = Some(UpdateCandidate {
            version: "not-semver".into(),
            release_url: "https://evil.invalid".into(),
            notes: String::new(),
            download_url: None,
            source: "confirmed".into(),
        });
        let validated = validate_stored_config(config, &Version::parse("0.14.0").unwrap()).unwrap();
        assert!(validated.candidate.is_none());
        assert!(!validated.auto_check);
    }
    #[test]
    fn release_urls_cannot_carry_credentials_or_the_wrong_tag() {
        assert!(!is_exact_release_url(
            "https://user@github.com/jiay98528-dev/JotLuck/releases/tag/v1.2.3",
            "v1.2.3"
        ));
        assert!(!is_exact_release_url(
            "https://github.com/jiay98528-dev/JotLuck/releases/tag/v1.2.4",
            "v1.2.3"
        ));
    }
    #[test]
    fn checked_in_website_manifest_matches_the_client_contract() {
        let manifest: Value =
            serde_json::from_str(include_str!("../../../../site/public/updates/v1.json")).unwrap();
        assert!(website_release(&manifest, "stable").unwrap().is_none());
        let preview = website_release(&manifest, "preview").unwrap().unwrap();
        assert_eq!(
            parse_version(&preview.tag).unwrap().to_string(),
            preview.version
        );
    }
    #[test]
    fn reconciliation_rejects_mismatched_assets() {
        let site = ReleaseInfo { version:"1.2.3".into(), tag:"v1.2.3".into(), release_url:"https://github.com/jiay98528-dev/JotLuck/releases/tag/v1.2.3".into(), notes:None, asset:Some(Asset{name:"JotLuck_1.2.3_x64.dmg".into(),url:"https://github.com/jiay98528-dev/JotLuck/releases/download/v1.2.3/JotLuck_1.2.3_x64.dmg".into(),size:Some(1),sha256:None}) };
        let github = ReleaseInfo { asset:Some(Asset{name:"different.dmg".into(),url:"https://github.com/jiay98528-dev/JotLuck/releases/download/v1.2.3/different.dmg".into(),size:Some(1),sha256:None}), ..site.clone() };
        assert_eq!(
            reconcile(site, github, &Version::parse("1.0.0").unwrap())
                .unwrap()
                .status,
            "outOfSync"
        );
    }
}
