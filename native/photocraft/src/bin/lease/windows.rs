use super::{Result, Stamp, err};
use std::ptr::null_mut;
use std::{
    ffi::{OsStr, c_void},
    fs::{self, File, OpenOptions},
    io,
    os::windows::{
        ffi::OsStrExt,
        fs::OpenOptionsExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Component, Path, PathBuf, Prefix},
};

type Handle = *mut c_void;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
const FILE_LIST_DIRECTORY: u32 = 0x1;
const FILE_READ_ATTRIBUTES: u32 = 0x80;
const FILE_SHARE_READ_WRITE: u32 = 3;
const MOVEFILE_WRITE_THROUGH: u32 = 8;
const MOVEFILE_REPLACE_EXISTING: u32 = 1;
const DRIVE_FIXED: u32 = 3;
const TH32CS_SNAPPROCESS: u32 = 2;
const ERROR_FILE_EXISTS: i32 = 80;
const ERROR_ALREADY_EXISTS: i32 = 183;
const ERROR_INVALID_PARAMETER: i32 = 87;
const ERROR_NO_MORE_FILES: i32 = 18;
const SYNCHRONIZE: u32 = 0x0010_0000;
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
const WAIT_TIMEOUT: u32 = 258;
const WAIT_OBJECT_0: u32 = 0;

#[repr(C)]
#[derive(Default)]
struct FileTime {
    low: u32,
    high: u32,
}

#[repr(C)]
#[derive(Default)]
struct FileInfo {
    attributes: u32,
    created: FileTime,
    accessed: FileTime,
    modified: FileTime,
    volume: u32,
    size_high: u32,
    size_low: u32,
    links: u32,
    index_high: u32,
    index_low: u32,
}

#[repr(C)]
struct ProcessEntry {
    size: u32,
    usage: u32,
    pid: u32,
    heap: usize,
    module: u32,
    threads: u32,
    parent_pid: u32,
    priority: i32,
    flags: u32,
    executable: [u16; 260],
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetFileInformationByHandle(file: Handle, info: *mut FileInfo) -> i32;
    fn GetDriveTypeW(root: *const u16) -> u32;
    fn GetVolumeInformationByHandleW(
        file: Handle,
        name: *mut u16,
        name_size: u32,
        serial: *mut u32,
        component_size: *mut u32,
        flags: *mut u32,
        filesystem: *mut u16,
        filesystem_size: u32,
    ) -> i32;
    fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    fn GetComputerNameW(name: *mut u16, size: *mut u32) -> i32;
    fn CreateToolhelp32Snapshot(flags: u32, process: u32) -> Handle;
    fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
    fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
    fn WaitForSingleObject(handle: Handle, millis: u32) -> u32;
    fn GetProcessTimes(
        handle: Handle,
        created: *mut FileTime,
        exited: *mut FileTime,
        kernel: *mut FileTime,
        user: *mut FileTime,
    ) -> i32;
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

fn info(file: &File) -> Result<FileInfo> {
    let mut value = FileInfo::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut value) } == 0 {
        return Err(err(io::Error::last_os_error()));
    }
    if value.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || value.index_high == 0 && value.index_low == 0
    {
        return Err("reparse point or unavailable file identity".into());
    }
    Ok(value)
}

pub(super) fn stamp(file: &File) -> Result<Stamp> {
    let value = info(file)?;
    Ok(Stamp {
        dev: value.volume.into(),
        ino: (u64::from(value.index_high) << 32) | u64::from(value.index_low),
    })
}

pub(super) fn single_link(file: &File) -> Result<bool> {
    let value = info(file)?;
    Ok(value.attributes & FILE_ATTRIBUTE_DIRECTORY == 0 && value.links == 1)
}

pub(super) struct Parent {
    path: PathBuf,
    handle: File,
}

fn directory(path: PathBuf) -> Result<Parent> {
    // A retained directory handle denies rename/delete. Earlier components stay
    // pinned while each child is opened, and the final entry is never followed.
    let handle = OpenOptions::new()
        .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ_WRITE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(&path)
        .map_err(err)?;
    if info(&handle)?.attributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
        return Err("not a directory".into());
    }
    Ok(Parent { path, handle })
}

pub(super) struct Tree {
    dirs: Vec<Parent>,
    pub(super) stamps: Vec<Stamp>,
}

impl Tree {
    pub(super) fn acquire(root: &Path) -> Result<Self> {
        let mut parts = root.components();
        let Some(Component::Prefix(prefix)) = parts.next() else {
            return Err("absolute drive-letter project root required".into());
        };
        if !matches!(prefix.kind(), Prefix::Disk(_)) || parts.next() != Some(Component::RootDir) {
            return Err("local drive-letter project root required".into());
        }
        let canonical_root = fs::canonicalize(root).map_err(err)?;
        let expanded = PathBuf::from(format!(r"\\?\{}", root.display()));
        if canonical_root.as_os_str() != expanded.as_os_str() {
            return Err("symbolic or aliased project root refused".into());
        }
        let drive = PathBuf::from(format!("{}\\", prefix.as_os_str().to_string_lossy()));
        if drive == root
            || unsafe { GetDriveTypeW(wide(drive.as_os_str()).as_ptr()) } != DRIVE_FIXED
        {
            return Err("project must be on a fixed local NTFS drive".into());
        }
        let drive = directory(drive)?;
        let mut filesystem = [0u16; 32];
        if unsafe {
            GetVolumeInformationByHandleW(
                drive.handle.as_raw_handle(),
                null_mut(),
                0,
                null_mut(),
                null_mut(),
                null_mut(),
                filesystem.as_mut_ptr(),
                filesystem.len() as u32,
            )
        } == 0
            || !filesystem
                .into_iter()
                .take_while(|unit| *unit != 0)
                .eq("NTFS".encode_utf16())
        {
            return Err("project must be on a fixed local NTFS drive".into());
        }
        let volume = stamp(&drive.handle)?;
        let mut tree = Self {
            dirs: vec![drive],
            stamps: vec![volume],
        };
        let mut canonical = tree.parent().path.clone();
        for part in parts {
            let Component::Normal(name) = part else {
                return Err("non-canonical project path".into());
            };
            if name.encode_wide().any(|c| c == 0 || c == b':' as u16)
                || name.to_string_lossy().ends_with(['.', ' '])
            {
                return Err("invalid project path component".into());
            }
            canonical.push(name);
            tree.push(name, false)?;
        }
        // Windows path equality can normalize separators or dot components.
        if canonical.as_os_str() != root.as_os_str() {
            return Err("non-canonical project path".into());
        }
        tree.push(OsStr::new(".storyboard-flow"), true)?;
        tree.push(OsStr::new("image-project-v2"), true)?;
        tree.check()?;
        Ok(tree)
    }

    fn push(&mut self, name: &OsStr, create: bool) -> Result<()> {
        let next = self.parent().path.join(name);
        if create {
            match fs::create_dir(&next) {
                Ok(()) => (),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(err(e)),
            }
        }
        let next = directory(next)?;
        let identity = stamp(&next.handle)?;
        if identity.dev != self.stamps[0].dev {
            return Err("project path changed volumes".into());
        }
        self.dirs.push(next);
        self.stamps.push(identity);
        Ok(())
    }

    pub(super) fn root_stamp(&self) -> &Stamp {
        &self.stamps[self.stamps.len() - 3]
    }
    pub(super) fn parent(&self) -> &Parent {
        self.dirs.last().expect("tree contains drive root")
    }
    pub(super) fn check(&self) -> Result<()> {
        for (pinned, expected) in self.dirs.iter().zip(&self.stamps) {
            let current = directory(pinned.path.clone())?;
            if stamp(&pinned.handle)? != *expected || stamp(&current.handle)? != *expected {
                return Err("project directory identity changed".into());
            }
        }
        Ok(())
    }
}

pub(super) fn plain(
    parent: &Parent,
    name: &str,
    create: bool,
    writable: bool,
) -> Result<(File, bool)> {
    let target = parent.path.join(name);
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(writable)
        .share_mode(FILE_SHARE_READ_WRITE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    let (file, created) = if create {
        match options.create_new(true).open(&target) {
            Ok(file) => (file, true),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                return plain(parent, name, false, writable);
            }
            Err(e) => return Err(err(e)),
        }
    } else {
        (options.open(&target).map_err(err)?, false)
    };
    if !single_link(&file)? {
        return Err("non-regular or multiply linked lease file".into());
    }
    if created {
        file.sync_all().map_err(err)?;
    }
    Ok((file, created))
}

pub(super) fn entry_exists(parent: &Parent, name: &str) -> Result<bool> {
    match fs::symlink_metadata(parent.path.join(name)) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(err(e)),
    }
}

pub(super) fn create_temporary(parent: &Parent, name: &str) -> Result<File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .share_mode(FILE_SHARE_READ_WRITE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(parent.path.join(name))
        .map_err(err)
}

pub(super) fn publish(parent: &Parent, from: &str, to: &str, replace: bool) -> Result<bool> {
    // The marker is file-synced before this same-volume move. This does not
    // establish Windows directory-entry durability for the project journal.
    let from = wide(parent.path.join(from).as_os_str());
    let to = wide(parent.path.join(to).as_os_str());
    let flags = MOVEFILE_WRITE_THROUGH
        | if replace {
            MOVEFILE_REPLACE_EXISTING
        } else {
            0
        };
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), flags) } != 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if !replace
        && matches!(
            error.raw_os_error(),
            Some(ERROR_FILE_EXISTS | ERROR_ALREADY_EXISTS)
        )
    {
        return Ok(false);
    }
    Err(err(error))
}

pub(super) fn host() -> Result<String> {
    let mut name = [0; 256];
    let mut size = name.len() as u32;
    if unsafe { GetComputerNameW(name.as_mut_ptr(), &mut size) } == 0 || size == 0 {
        return Err(err(io::Error::last_os_error()));
    }
    String::from_utf16(&name[..size as usize]).map_err(err)
}

fn open_process(pid: u32) -> io::Result<OwnedHandle> {
    let handle = unsafe { OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn created(handle: Handle) -> Result<u64> {
    let mut start = FileTime::default();
    let mut exit = FileTime::default();
    let mut kernel = FileTime::default();
    let mut user = FileTime::default();
    if unsafe { GetProcessTimes(handle, &mut start, &mut exit, &mut kernel, &mut user) } == 0 {
        return Err(err(io::Error::last_os_error()));
    }
    Ok((u64::from(start.high) << 32) | u64::from(start.low))
}

pub(super) fn confirmed_dead(pid: i32) -> bool {
    if pid <= 1 {
        return false;
    }
    match open_process(pid as u32) {
        Ok(handle) => unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) == WAIT_OBJECT_0 },
        // ERROR_INVALID_PARAMETER for an absent PID. Access denied, PID
        // reuse by a live process, and all uncertain results refuse takeover.
        Err(e) => {
            e.raw_os_error() == Some(ERROR_INVALID_PARAMETER)
                && matches!(parent_process_id(pid as u32), Ok(None))
        }
    }
}

fn parent_process_id(pid: u32) -> Result<Option<u32>> {
    let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if raw as isize == -1 {
        return Err(err(io::Error::last_os_error()));
    }
    let snapshot = unsafe { OwnedHandle::from_raw_handle(raw) };
    // PROCESSENTRY32W consists of zero-initializable C integer fields.
    let mut entry: ProcessEntry = unsafe { std::mem::zeroed() };
    entry.size = std::mem::size_of::<ProcessEntry>() as u32;
    if unsafe { Process32FirstW(snapshot.as_raw_handle(), &mut entry) } == 0 {
        return Err(err(io::Error::last_os_error()));
    }
    loop {
        if entry.pid == pid {
            return Ok(Some(entry.parent_pid));
        }
        if unsafe { Process32NextW(snapshot.as_raw_handle(), &mut entry) } == 0 {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_NO_MORE_FILES) {
                Ok(None)
            } else {
                Err(err(error))
            };
        }
    }
}

pub(super) struct MainOwner {
    pid: i32,
    process: OwnedHandle,
}

impl MainOwner {
    pub(super) fn current() -> Result<Self> {
        let guard_pid = std::process::id();
        let parent = parent_process_id(guard_pid)?
            .filter(|pid| *pid > 1)
            .ok_or("Main parent process unavailable")?;
        let pid = i32::try_from(parent).map_err(err)?;
        let process = open_process(parent).map_err(err)?;
        let guard = open_process(guard_pid).map_err(err)?;
        if created(process.as_raw_handle())? >= created(guard.as_raw_handle())? {
            return Err("Main parent PID has been reused or cannot be verified".into());
        }
        let owner = Self { pid, process };
        owner.check()?;
        Ok(owner)
    }

    pub(super) fn pid(&self) -> i32 {
        self.pid
    }
    pub(super) fn check(&self) -> Result<()> {
        if unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) } != WAIT_TIMEOUT {
            return Err("Main owner disconnected".into());
        }
        Ok(())
    }
}
