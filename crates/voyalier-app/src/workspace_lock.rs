//! OS lifetime custody outside SQLite's replaceable generation (ADR-0030).

use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

use voyalier_core::{AppError, ErrorCode};

use crate::{PENDING_RESTORE_MARKER, canonical_key_path, storage_error};

pub(crate) struct WorkspaceLock {
    file: File,
    path: PathBuf,
    operation: Mutex<()>,
}

type Registry = Mutex<HashMap<PathBuf, Weak<WorkspaceLock>>>;
static REGISTRY: OnceLock<Registry> = OnceLock::new();

impl WorkspaceLock {
    pub(crate) fn acquire(database: &Path) -> Result<Arc<Self>, AppError> {
        let path = database
            .canonicalize()
            .unwrap_or_else(|_| canonical_key_path(database));
        let mut registry = REGISTRY
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(storage_error)?;
        registry.retain(|_, value| value.strong_count() > 0);
        if let Some(guard) = registry.get(&path).and_then(Weak::upgrade) {
            guard.validate_path()?;
            if canonical_key_path(database)
                .with_file_name(PENDING_RESTORE_MARKER)
                .exists()
                || path.with_file_name(PENDING_RESTORE_MARKER).exists()
            {
                return Err(in_use_error());
            }
            return Ok(guard);
        }
        let name = path.file_name().ok_or_else(in_use_error)?.to_string_lossy();
        let lock_path = path.with_file_name(format!(".{name}.workspace-lock"));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
            options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        if let Ok(metadata) = std::fs::symlink_metadata(&lock_path) {
            if !metadata.file_type().is_file() {
                return Err(invalid_surface_error());
            }
        }
        let file = options.open(&lock_path).map_err(storage_error)?;
        lock_file(&file)?;
        let guard = Arc::new(Self {
            file,
            path: lock_path,
            operation: Mutex::new(()),
        });
        guard.validate_path()?;
        registry.insert(path, Arc::downgrade(&guard));
        Ok(guard)
    }

    pub(crate) fn operation(&self) -> Result<std::sync::MutexGuard<'_, ()>, AppError> {
        self.validate_path()?;
        self.operation.lock().map_err(storage_error)
    }

    pub(crate) fn require_quiescent(self: &Arc<Self>, database: &Path) -> Result<(), AppError> {
        if database.with_file_name(PENDING_RESTORE_MARKER).exists() && Arc::strong_count(self) > 1 {
            return Err(in_use_error());
        }
        Ok(())
    }

    fn validate_path(&self) -> Result<(), AppError> {
        let path_metadata = std::fs::symlink_metadata(&self.path).map_err(storage_error)?;
        let file_metadata = self.file.metadata().map_err(storage_error)?;
        if !path_metadata.file_type().is_file() || !file_metadata.file_type().is_file() {
            return Err(invalid_surface_error());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            // SAFETY: geteuid takes no arguments and only reports process ownership.
            let owner = unsafe { libc::geteuid() };
            if file_metadata.uid() != owner
                || file_metadata.mode() & 0o077 != 0
                || path_metadata.dev() != file_metadata.dev()
                || path_metadata.ino() != file_metadata.ino()
            {
                return Err(invalid_surface_error());
            }
        }
        #[cfg(windows)]
        validate_windows_identity(&self.file, &self.path)?;
        Ok(())
    }
}

#[cfg(windows)]
fn validate_windows_identity(file: &File, path: &Path) -> Result<(), AppError> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_FLAG_OPEN_REPARSE_POINT, GetFileInformationByHandle,
    };
    let current = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(storage_error)?;
    if !current
        .metadata()
        .map_err(storage_error)?
        .file_type()
        .is_file()
    {
        return Err(invalid_surface_error());
    }
    fn identity(file: &File) -> Result<(u32, u32, u32), AppError> {
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: the owned file handle and initialized output are live for
        // this metadata-only synchronous call.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(storage_error(std::io::Error::last_os_error()));
        }
        Ok((
            info.dwVolumeSerialNumber,
            info.nFileIndexHigh,
            info.nFileIndexLow,
        ))
    }
    if identity(file)? != identity(&current)? {
        return Err(invalid_surface_error());
    }
    Ok(())
}

fn invalid_surface_error() -> AppError {
    AppError::new(
        ErrorCode::StorageFailure,
        "the workspace custody file is replaced, unsafe, or not private; recovery was refused",
    )
}

fn in_use_error() -> AppError {
    AppError::new(
        ErrorCode::StorageFailure,
        "this workspace is already open; close its other app or browser service before recovery",
    )
}

#[cfg(unix)]
fn lock_file(file: &File) -> Result<(), AppError> {
    use std::os::fd::AsRawFd;
    // SAFETY: the descriptor is owned by the returned guard; flock neither
    // takes ownership nor accesses Rust memory. Closing it releases the lock.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::WouldBlock {
            Err(in_use_error())
        } else {
            Err(storage_error(error))
        }
    }
}

#[cfg(windows)]
fn lock_file(file: &File) -> Result<(), AppError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{
        Storage::FileSystem::{LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY, LockFileEx},
        System::IO::OVERLAPPED,
    };
    let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
    // SAFETY: synchronous file handle and initialized OVERLAPPED are live for
    // the call; locking the first byte is an OS lock independent of file size.
    if unsafe {
        LockFileEx(
            file.as_raw_handle(),
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            1,
            0,
            &mut overlapped,
        )
    } != 0
    {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(33) {
            Err(in_use_error())
        } else {
            Err(storage_error(error))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead as _, Write as _};
    use std::process::{Command, Stdio};

    #[test]
    #[cfg(unix)]
    fn file_aliases_share_the_same_guard() {
        let database = crate::tests::temp_database("lock-file-alias");
        std::fs::write(&database, b"synthetic fixture").unwrap();
        let alias = database.with_file_name("alias.sqlite3");
        std::os::unix::fs::symlink(&database, &alias).unwrap();
        let guard = WorkspaceLock::acquire(&database).unwrap();
        let shared = WorkspaceLock::acquire(&alias).unwrap();
        assert!(Arc::ptr_eq(&guard, &shared));
        std::fs::write(
            database.with_file_name(PENDING_RESTORE_MARKER),
            b"synthetic marker",
        )
        .unwrap();
        assert!(WorkspaceLock::acquire(&alias).is_err());
        drop(shared);
        drop(guard);
        crate::tests::cleanup_database(database);
    }

    #[test]
    #[cfg(unix)]
    fn custody_rejects_symlinks_and_detectable_replacement() {
        let database = crate::tests::temp_database("lock-surface");
        let lock_path = database.with_file_name(".voyalier.sqlite3.workspace-lock");
        let unrelated = database.with_file_name("unrelated");
        std::fs::write(&unrelated, b"do not mutate").unwrap();
        std::os::unix::fs::symlink(&unrelated, &lock_path).unwrap();
        assert!(WorkspaceLock::acquire(&database).is_err());
        assert_eq!(std::fs::read(&unrelated).unwrap(), b"do not mutate");
        std::fs::remove_file(&lock_path).unwrap();
        let guard = WorkspaceLock::acquire(&database).unwrap();
        std::fs::rename(&lock_path, database.with_file_name("moved-custody")).unwrap();
        std::fs::write(&lock_path, b"replacement").unwrap();
        assert!(WorkspaceLock::acquire(&database).is_err());
        drop(guard);
        crate::tests::cleanup_database(database);
    }

    #[test]
    #[ignore = "subprocess helper, invoked by process_death_releases_workspace_custody"]
    fn hold_workspace_child() {
        let database = PathBuf::from(std::env::var("VOYALIER_LOCK_FIXTURE").unwrap());
        let _guard = WorkspaceLock::acquire(&database).unwrap();
        println!("LOCK_HELD");
        std::io::stdout().flush().unwrap();
        let mut line = String::new();
        std::io::stdin().lock().read_line(&mut line).unwrap();
    }

    #[test]
    fn process_death_releases_workspace_custody() {
        let database = crate::tests::temp_database("lock-process-death");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "workspace_lock::tests::hold_workspace_child",
                "--ignored",
                "--nocapture",
            ])
            .env("VOYALIER_LOCK_FIXTURE", &database)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut output = std::io::BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        loop {
            line.clear();
            assert!(output.read_line(&mut line).unwrap() > 0);
            if line.contains("LOCK_HELD") {
                break;
            }
        }
        assert!(WorkspaceLock::acquire(&database).is_err());
        child.kill().unwrap();
        child.wait().unwrap();
        let guard = WorkspaceLock::acquire(&database).unwrap();
        drop(guard);
        crate::tests::cleanup_database(database);
    }
}
