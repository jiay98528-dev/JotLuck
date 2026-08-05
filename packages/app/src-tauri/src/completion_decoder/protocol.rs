use super::*;

pub(super) fn write_worker_frame<W: Write + Send>(
    writer: &Arc<Mutex<W>>,
    frame: WorkerFrame,
) -> Result<(), String> {
    let mut guard = writer
        .lock()
        .map_err(|_| "completion worker output lock poisoned".to_string())?;
    write_frame(&mut *guard, &frame)
        .map_err(|error| format!("unable to write completion worker frame: {error}"))
}

pub(super) fn write_frame<T: Serialize>(writer: &mut impl Write, value: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if bytes.is_empty() || bytes.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "completion frame exceeds limit",
        ));
    }
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()
}

pub(super) fn read_frame<T: for<'de> Deserialize<'de>>(reader: &mut impl Read) -> io::Result<T> {
    let mut length = [0_u8; 4];
    reader.read_exact(&mut length)?;
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid completion frame length",
        ));
    }
    let mut bytes = vec![0_u8; length];
    reader.read_exact(&mut bytes)?;
    serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub(super) fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(windows)]
pub(super) fn configure_worker_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::{BELOW_NORMAL_PRIORITY_CLASS, CREATE_NO_WINDOW};
    command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
}

#[cfg(not(windows))]
pub(super) fn configure_worker_command(_command: &mut Command) {}

#[cfg(windows)]
pub(super) struct WindowsJobHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for WindowsJobHandle {}

#[cfg(windows)]
impl Drop for WindowsJobHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(not(windows))]
pub(super) struct WindowsJobHandle;

#[cfg(windows)]
pub(super) fn assign_worker_limits(child: &Child) -> Result<Option<WindowsJobHandle>, String> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION, PROCESS_SET_QUOTA,
        PROCESS_TERMINATE,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() || job == INVALID_HANDLE_VALUE {
            return Err(format!(
                "unable to create completion worker Job Object: {}",
                io::Error::last_os_error()
            ));
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        limits.ProcessMemoryLimit = PEAK_MEMORY_LIMIT_BYTES;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            let error = io::Error::last_os_error();
            let _ = CloseHandle(job);
            return Err(format!(
                "unable to configure completion worker limits: {error}"
            ));
        }
        let process = OpenProcess(
            PROCESS_SET_QUOTA
                | PROCESS_SET_INFORMATION
                | PROCESS_TERMINATE
                | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            child.id(),
        );
        if process.is_null() || process == INVALID_HANDLE_VALUE {
            let error = io::Error::last_os_error();
            let _ = CloseHandle(job);
            return Err(format!("unable to open completion worker: {error}"));
        }
        if AssignProcessToJobObject(job, process) == 0
            || SetPriorityClass(process, BELOW_NORMAL_PRIORITY_CLASS) == 0
        {
            let error = io::Error::last_os_error();
            let _ = CloseHandle(process);
            let _ = CloseHandle(job);
            return Err(format!("unable to isolate completion worker: {error}"));
        }
        let _ = CloseHandle(process);
        Ok(Some(WindowsJobHandle(job)))
    }
}

#[cfg(not(windows))]
pub(super) fn assign_worker_limits(_child: &Child) -> Result<Option<WindowsJobHandle>, String> {
    Ok(None)
}
