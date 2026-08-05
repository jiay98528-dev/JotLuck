use crate::command_error::CommandResult;
use crate::document_import::DocumentImportState;
use crate::window_session::ImportedDocumentKind;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::{State, WebviewWindow};

const NOTE_PROG_ID: &str = "JotLuck.Note";
const DOCUMENT_PROG_ID: &str = "JotLuck.DocumentImport";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEditorCandidate {
    pub handler_id: Option<String>,
    pub display_name: String,
    pub available: bool,
    pub fallback_to_open_with: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEditorLaunchResult {
    pub display_name: String,
    pub used_open_with: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssociationApplicationState {
    Applied,
    Partial,
    NotApplied,
    #[cfg(not(windows))]
    Unsupported,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociationGroupStatus {
    pub id: String,
    pub extensions: Vec<String>,
    pub state: AssociationApplicationState,
    pub active_prog_ids: Vec<Option<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsAssociationStatus {
    pub supported: bool,
    pub groups: Vec<AssociationGroupStatus>,
}

#[tauri::command]
pub fn get_document_editor_candidate(
    window: WebviewWindow,
    imports: State<'_, DocumentImportState>,
) -> CommandResult<DocumentEditorCandidate> {
    let source = imports.fresh_source_for_window(window.label())?;
    Ok(platform::editor_candidate(source.kind)?)
}

#[tauri::command]
pub async fn open_document_source_in_editor(
    window: WebviewWindow,
    handler_id: Option<String>,
    imports: State<'_, DocumentImportState>,
) -> CommandResult<DocumentEditorLaunchResult> {
    let source = imports.fresh_source_for_window(window.label())?;
    let parent_window = platform::parent_window_handle(&window);
    Ok(tauri::async_runtime::spawn_blocking(move || {
        platform::open_source_in_editor(
            &source.absolute_path,
            source.kind,
            handler_id.as_deref(),
            parent_window,
        )
    })
    .await
    .map_err(|error| format!("Windows association task failed: {error}"))??)
}

#[tauri::command]
pub fn get_windows_association_status() -> CommandResult<WindowsAssociationStatus> {
    Ok(platform::association_status()?)
}

#[tauri::command]
pub fn open_jotluck_default_apps_settings() -> CommandResult<()> {
    platform::open_default_apps_settings()?;
    Ok(())
}

fn group_status(id: &str, extensions: &[&str], expected: &str) -> AssociationGroupStatus {
    let active_prog_ids = extensions
        .iter()
        .map(|extension| platform::effective_prog_id(extension).ok().flatten())
        .collect::<Vec<_>>();
    let applied = active_prog_ids
        .iter()
        .filter(|prog_id| {
            prog_id
                .as_deref()
                .is_some_and(|prog_id| prog_id.eq_ignore_ascii_case(expected))
        })
        .count();
    let state = if applied == extensions.len() {
        AssociationApplicationState::Applied
    } else if applied > 0 {
        AssociationApplicationState::Partial
    } else {
        AssociationApplicationState::NotApplied
    };
    AssociationGroupStatus {
        id: id.to_string(),
        extensions: extensions
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        state,
        active_prog_ids,
    }
}

fn preferred_user_choice(latest: Option<String>, legacy: Option<String>) -> Option<String> {
    latest
        .filter(|value| !value.trim().is_empty())
        .or_else(|| legacy.filter(|value| !value.trim().is_empty()))
}

fn handler_id(extension: &str, system_name: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(extension.to_ascii_lowercase());
    digest.update([0]);
    digest.update(system_name.to_ascii_lowercase());
    format!("{:x}", digest.finalize())
}

fn launch_with_system_fallback<T>(
    selected: Result<Option<T>, String>,
    invoke: impl FnOnce(&T) -> Result<(), String>,
    open_with: impl FnOnce() -> Result<(), String>,
) -> Result<(Option<T>, bool), String> {
    let selected = match selected {
        Ok(selected) => selected,
        Err(error) => {
            log::warn!("unable to enumerate preferred document editors; using Open With: {error}");
            None
        }
    };
    if let Some(handler) = selected.as_ref() {
        match invoke(handler) {
            Ok(()) => return Ok((selected, false)),
            Err(error) => {
                log::warn!(
                    "unable to invoke the preferred document editor; using Open With: {error}"
                );
            }
        }
    }
    open_with()?;
    Ok((selected, true))
}

fn default_apps_settings_uri_for_build(build_number: Option<u32>) -> &'static str {
    if build_number.is_some_and(|build| build >= 22_000) {
        "ms-settings:defaultapps?registeredAppUser=JotLuck"
    } else {
        "ms-settings:defaultapps"
    }
}

fn preferred_handler_rank(
    kind: ImportedDocumentKind,
    system_name: &str,
    display_name: &str,
) -> Option<u8> {
    let haystack = format!("{} {}", system_name, display_name).to_ascii_lowercase();
    if haystack.contains("jotluck") {
        return None;
    }
    let groups: &[&[&str]] = match kind {
        ImportedDocumentKind::Docx => &[
            &["microsoft word", "winword", "word.exe"],
            &["wps writer", "wps.exe", "kingsoft"],
            &["libreoffice writer", "soffice"],
        ],
        ImportedDocumentKind::Xls | ImportedDocumentKind::Xlsx => &[
            &["microsoft excel", "excel.exe"],
            &["wps spreadsheet", "et.exe", "kingsoft"],
            &["libreoffice calc", "soffice"],
        ],
        ImportedDocumentKind::Pdf => &[
            &["adobe acrobat", "acrobat.exe", "acrobat"],
            &["pdf-xchange", "pdfxedit"],
            &["foxit pdf editor", "foxitpdfeditor"],
            &["wps pdf", "kingsoft"],
        ],
    };
    groups
        .iter()
        .position(|needles| needles.iter().any(|needle| haystack.contains(needle)))
        .map(|value| value as u8)
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use windows::core::{HRESULT, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, IDataObject, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        BHID_DataObject, IAssocHandler, IShellItem, IShellItemArray, SHAssocEnumHandlers,
        SHCreateItemFromParsingName, SHCreateShellItemArrayFromShellItem, SHOpenWithDialog,
        ASSOC_FILTER_NONE, OAIF_EXEC, OPENASINFO,
    };

    #[repr(C)]
    struct RtlOsVersionInfoW {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform_id: u32,
        service_pack: [u16; 128],
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn RtlGetVersion(version: *mut RtlOsVersionInfoW) -> i32;
    }

    struct ComApartment(bool);

    impl ComApartment {
        fn enter() -> Result<Self, String> {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                    .map(|| Self(true))
                    .map_err(|error| {
                        format!("unable to initialize Windows association APIs: {error}")
                    })
            }
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    struct HandlerEntry {
        handler: IAssocHandler,
        system_name: String,
        display_name: String,
        id: String,
        rank: u8,
    }

    pub(super) fn parent_window_handle(window: &WebviewWindow) -> Option<isize> {
        window.hwnd().ok().map(|handle| handle.0 as isize)
    }

    pub(super) fn run_shell_sta<T, F>(operation: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, String> + Send + 'static,
    {
        let thread = std::thread::Builder::new()
            .name("jotluck-windows-shell-sta".to_string())
            .spawn(move || {
                let _apartment = ComApartment::enter()?;
                operation()
            })
            .map_err(|error| format!("unable to start Windows association thread: {error}"))?;
        thread
            .join()
            .map_err(|_| "Windows association thread terminated unexpectedly".to_string())?
    }

    pub(super) fn editor_candidate(
        kind: ImportedDocumentKind,
    ) -> Result<DocumentEditorCandidate, String> {
        run_shell_sta(move || {
            let mut handlers = match enumerate_handlers_in_current_apartment(kind) {
                Ok(handlers) => handlers,
                Err(error) => {
                    log::warn!(
                        "unable to enumerate preferred document editors; exposing Open With: {error}"
                    );
                    Vec::new()
                }
            };
            handlers.sort_by_key(|handler| handler.rank);
            Ok(match handlers.into_iter().next() {
                Some(handler) => DocumentEditorCandidate {
                    handler_id: Some(handler.id),
                    display_name: handler.display_name,
                    available: true,
                    fallback_to_open_with: false,
                },
                None => DocumentEditorCandidate {
                    handler_id: None,
                    display_name: "Choose an app".to_string(),
                    available: false,
                    fallback_to_open_with: true,
                },
            })
        })
    }

    pub(super) fn open_source_in_editor(
        path: &Path,
        kind: ImportedDocumentKind,
        requested_id: Option<&str>,
        parent_window: Option<isize>,
    ) -> Result<DocumentEditorLaunchResult, String> {
        let path = path.to_path_buf();
        let requested_id = requested_id.map(str::to_owned);
        run_shell_sta(move || {
            let selected = enumerate_handlers_in_current_apartment(kind).map(|mut handlers| {
                handlers.sort_by_key(|handler| handler.rank);
                requested_id
                    .as_deref()
                    .and_then(|id| handlers.iter().position(|handler| handler.id == id))
                    .map(|index| handlers.remove(index))
                    .or_else(|| handlers.into_iter().next())
            });
            let (selected, used_open_with) = launch_with_system_fallback(
                selected,
                |handler| invoke_handler(&handler.handler, &path),
                || open_with_dialog(&path, parent_window),
            )?;
            let display_name = selected
                .filter(|_| !used_open_with)
                .map(|handler| handler.display_name)
                .unwrap_or_else(|| "Choose an app".to_string());
            Ok(DocumentEditorLaunchResult {
                display_name,
                used_open_with,
            })
        })
    }

    fn enumerate_handlers_in_current_apartment(
        kind: ImportedDocumentKind,
    ) -> Result<Vec<HandlerEntry>, String> {
        let extension = format!(".{}", kind.extension());
        let extension_wide = HSTRING::from(&extension);
        let enumeration = unsafe { SHAssocEnumHandlers(&extension_wide, ASSOC_FILTER_NONE) }
            .map_err(|error| format!("unable to enumerate Windows document editors: {error}"))?;
        let mut output = Vec::new();
        loop {
            let mut fetched = 0_u32;
            let mut slot = [None];
            if unsafe { enumeration.Next(&mut slot, Some(&mut fetched)) }.is_err() || fetched == 0 {
                break;
            }
            let Some(handler) = slot[0].take() else {
                continue;
            };
            let system_pointer = unsafe { handler.GetName() }
                .map_err(|error| format!("unable to read Windows handler name: {error}"))?;
            let system_name = unsafe { take_com_string(system_pointer) }?;
            let display_name = unsafe { handler.GetUIName() }
                .ok()
                .and_then(|pointer| unsafe { take_com_string(pointer) }.ok())
                .unwrap_or_else(|| system_name.clone());
            let Some(rank) = preferred_handler_rank(kind, &system_name, &display_name) else {
                continue;
            };
            output.push(HandlerEntry {
                id: handler_id(&extension, &system_name),
                handler,
                system_name,
                display_name,
                rank,
            });
        }
        output.sort_by(|left, right| {
            left.rank
                .cmp(&right.rank)
                .then(left.display_name.cmp(&right.display_name))
                .then(left.system_name.cmp(&right.system_name))
        });
        Ok(output)
    }

    unsafe fn take_com_string(pointer: PWSTR) -> Result<String, String> {
        let result = pointer
            .to_string()
            .map_err(|error| format!("invalid Windows association handler name: {error}"));
        CoTaskMemFree(Some(pointer.0.cast::<c_void>()));
        result
    }

    fn invoke_handler(handler: &IAssocHandler, path: &Path) -> Result<(), String> {
        let path = HSTRING::from(path.to_string_lossy().as_ref());
        let item: IShellItem = unsafe { SHCreateItemFromParsingName(&path, None) }
            .map_err(|error| format!("unable to create Windows shell item: {error}"))?;
        let array: IShellItemArray = unsafe { SHCreateShellItemArrayFromShellItem(&item) }
            .map_err(|error| format!("unable to create Windows shell item array: {error}"))?;
        let data: IDataObject = unsafe { array.BindToHandler(None, &BHID_DataObject) }
            .map_err(|error| format!("unable to create Windows document data object: {error}"))?;
        unsafe { handler.Invoke(&data) }
            .map_err(|error| format!("unable to launch selected document editor: {error}"))
    }

    fn open_with_dialog(path: &Path, parent_window: Option<isize>) -> Result<(), String> {
        let path = HSTRING::from(path.to_string_lossy().as_ref());
        let info = OPENASINFO {
            pcszFile: PCWSTR(path.as_ptr()),
            pcszClass: PCWSTR::null(),
            oaifInFlags: OAIF_EXEC,
        };
        let parent_window = parent_window.map(|handle| HWND(handle as *mut c_void));
        match unsafe { SHOpenWithDialog(parent_window, &info) } {
            Ok(()) => Ok(()),
            Err(error) if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) => Ok(()),
            Err(error) => Err(format!(
                "unable to open the Windows Open With dialog: {error}"
            )),
        }
    }

    pub(super) fn association_status() -> Result<WindowsAssociationStatus, String> {
        Ok(WindowsAssociationStatus {
            supported: true,
            groups: vec![
                group_status("markdown", &[".md", ".markdown", ".mdx"], NOTE_PROG_ID),
                group_status("text", &[".txt"], NOTE_PROG_ID),
                group_status("word", &[".docx"], DOCUMENT_PROG_ID),
                group_status("pdf", &[".pdf"], DOCUMENT_PROG_ID),
                group_status("excel", &[".xlsx", ".xls"], DOCUMENT_PROG_ID),
            ],
        })
    }

    pub(super) fn effective_prog_id(extension: &str) -> Result<Option<String>, String> {
        let base = format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\{extension}"
        );
        let latest = read_registry_string(&format!("{base}\\UserChoiceLatest\\ProgId"), "ProgId")?;
        let legacy = read_registry_string(&format!("{base}\\UserChoice"), "ProgId")?;
        Ok(preferred_user_choice(latest, legacy))
    }

    fn read_registry_string(subkey: &str, value_name: &str) -> Result<Option<String>, String> {
        use windows_sys::Win32::System::Registry::{
            RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ, RRF_ZEROONFAILURE,
        };

        const ERROR_FILE_NOT_FOUND: u32 = 2;
        const ERROR_PATH_NOT_FOUND: u32 = 3;

        let subkey = subkey
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let value_name = value_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let flags = RRF_RT_REG_SZ | RRF_ZEROONFAILURE;
        let mut bytes = 0_u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                value_name.as_ptr(),
                flags,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut bytes,
            )
        };
        if matches!(status, ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND) {
            return Ok(None);
        }
        if status != 0 {
            return Err(format!(
                "unable to read Windows association choice: {status}"
            ));
        }
        if bytes <= 2 {
            return Ok(None);
        }

        let mut buffer = vec![0_u16; (bytes as usize).div_ceil(2)];
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                value_name.as_ptr(),
                flags,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        if status != 0 {
            return Err(format!(
                "unable to read Windows association choice: {status}"
            ));
        }
        let used = buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(buffer.len());
        Ok(Some(String::from_utf16_lossy(&buffer[..used])))
    }

    pub(super) fn open_default_apps_settings() -> Result<(), String> {
        std::process::Command::new("explorer.exe")
            .arg(default_apps_settings_uri_for_build(windows_build_number()))
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("unable to open Windows Default Apps settings: {error}"))
    }

    fn windows_build_number() -> Option<u32> {
        let mut version = RtlOsVersionInfoW {
            size: std::mem::size_of::<RtlOsVersionInfoW>() as u32,
            major: 0,
            minor: 0,
            build: 0,
            platform_id: 0,
            service_pack: [0; 128],
        };
        // SAFETY: `version` is a writable, correctly sized RTL_OSVERSIONINFOW-compatible
        // structure and remains alive for the duration of the ntdll call.
        let status = unsafe { RtlGetVersion(&mut version) };
        if status >= 0 {
            Some(version.build)
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub(super) fn editor_candidate(
        _kind: ImportedDocumentKind,
    ) -> Result<DocumentEditorCandidate, String> {
        Ok(DocumentEditorCandidate {
            handler_id: None,
            display_name: "Choose an app".to_string(),
            available: false,
            fallback_to_open_with: true,
        })
    }

    pub(super) fn parent_window_handle(_window: &WebviewWindow) -> Option<isize> {
        None
    }

    pub(super) fn open_source_in_editor(
        _path: &Path,
        _kind: ImportedDocumentKind,
        _requested_id: Option<&str>,
        _parent_window: Option<isize>,
    ) -> Result<DocumentEditorLaunchResult, String> {
        Err("professional editor integration is available on Windows only".to_string())
    }

    pub(super) fn association_status() -> Result<WindowsAssociationStatus, String> {
        Ok(WindowsAssociationStatus {
            supported: false,
            groups: ["markdown", "text", "word", "pdf", "excel"]
                .into_iter()
                .map(|id| AssociationGroupStatus {
                    id: id.to_string(),
                    extensions: Vec::new(),
                    state: AssociationApplicationState::Unsupported,
                    active_prog_ids: Vec::new(),
                })
                .collect(),
        })
    }

    pub(super) fn effective_prog_id(_extension: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    pub(super) fn open_default_apps_settings() -> Result<(), String> {
        Err("Windows Default Apps settings are unavailable on this platform".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn handler_priority_matches_the_product_order_and_excludes_jotluck() {
        assert_eq!(
            preferred_handler_rank(ImportedDocumentKind::Docx, "WINWORD.EXE", "Microsoft Word"),
            Some(0)
        );
        assert_eq!(
            preferred_handler_rank(
                ImportedDocumentKind::Pdf,
                "FoxitPDFEditor.exe",
                "Foxit PDF Editor"
            ),
            Some(2)
        );
        assert_eq!(
            preferred_handler_rank(ImportedDocumentKind::Xlsx, "JotLuck.exe", "JotLuck"),
            None
        );
        assert_eq!(
            preferred_handler_rank(ImportedDocumentKind::Pdf, "notepad.exe", "Notepad"),
            None
        );
    }

    #[test]
    fn opaque_handler_identifier_is_deterministic_and_extension_scoped() {
        assert_eq!(handler_id(".docx", "Word"), handler_id(".docx", "word"));
        assert_ne!(handler_id(".docx", "Word"), handler_id(".pdf", "Word"));
    }

    #[test]
    fn app_specific_default_apps_uri_is_used_only_on_windows_11() {
        assert_eq!(
            default_apps_settings_uri_for_build(Some(22_000)),
            "ms-settings:defaultapps?registeredAppUser=JotLuck"
        );
        assert_eq!(
            default_apps_settings_uri_for_build(Some(19_045)),
            "ms-settings:defaultapps"
        );
        assert_eq!(
            default_apps_settings_uri_for_build(None),
            "ms-settings:defaultapps"
        );
    }

    #[test]
    fn newest_protected_user_choice_wins_without_accepting_empty_fallbacks() {
        assert_eq!(
            preferred_user_choice(
                Some("JotLuck.Note".to_string()),
                Some("Legacy.Note".to_string())
            ),
            Some("JotLuck.Note".to_string())
        );
        assert_eq!(
            preferred_user_choice(Some("  ".to_string()), Some("Legacy.Note".to_string())),
            Some("Legacy.Note".to_string())
        );
        assert_eq!(preferred_user_choice(None, None), None);
    }

    #[test]
    fn failed_handler_invocation_uses_the_system_fallback() {
        let fallback_calls = Cell::new(0_u8);
        let (selected, used_open_with) = launch_with_system_fallback(
            Ok(Some("Microsoft Excel")),
            |_| Err("handler invocation failed".to_string()),
            || {
                fallback_calls.set(fallback_calls.get() + 1);
                Ok(())
            },
        )
        .expect("the Open With fallback should recover the launch");

        assert_eq!(selected, Some("Microsoft Excel"));
        assert!(used_open_with);
        assert_eq!(fallback_calls.get(), 1);
    }

    #[test]
    fn enumeration_failure_still_uses_the_system_fallback() {
        let invoke_calls = Cell::new(0_u8);
        let fallback_calls = Cell::new(0_u8);
        let (selected, used_open_with) = launch_with_system_fallback::<&str>(
            Err("association enumeration failed".to_string()),
            |_| {
                invoke_calls.set(invoke_calls.get() + 1);
                Ok(())
            },
            || {
                fallback_calls.set(fallback_calls.get() + 1);
                Ok(())
            },
        )
        .expect("the Open With fallback should recover enumeration failures");

        assert_eq!(selected, None);
        assert!(used_open_with);
        assert_eq!(invoke_calls.get(), 0);
        assert_eq!(fallback_calls.get(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn shell_operations_use_a_dedicated_sta_even_from_an_mta_caller() {
        use windows::Win32::System::Com::{
            CoGetApartmentType, CoInitializeEx, CoUninitialize, APTTYPE, APTTYPEQUALIFIER,
            APTTYPE_MAINSTA, APTTYPE_STA, COINIT_MULTITHREADED,
        };

        let apartment = std::thread::spawn(|| {
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
                .ok()
                .expect("the caller test thread should enter the MTA");
            let observed = platform::run_shell_sta(|| {
                let mut apartment = APTTYPE::default();
                let mut qualifier = APTTYPEQUALIFIER::default();
                unsafe { CoGetApartmentType(&mut apartment, &mut qualifier) }
                    .map_err(|error| format!("unable to inspect COM apartment: {error}"))?;
                Ok(apartment)
            });
            unsafe { CoUninitialize() };
            observed
        })
        .join()
        .expect("the MTA caller thread should not panic")
        .expect("the dedicated shell thread should initialize");

        assert!(apartment == APTTYPE_STA || apartment == APTTYPE_MAINSTA);
    }
}
