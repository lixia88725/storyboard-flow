use super::{Result, Stamp, err};
use std::{
    ffi::{OsStr, OsString, c_void},
    fs::{self, File, OpenOptions},
    io,
    os::windows::{
        ffi::OsStrExt,
        fs::OpenOptionsExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Component, Path, PathBuf, Prefix},
};
use std::{mem::size_of, ptr::null_mut};

type Handle = *mut c_void;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
const FILE_TRAVERSE: u32 = 0x20;
const FILE_READ_ATTRIBUTES: u32 = 0x80;
const FILE_SHARE_READ_WRITE: u32 = 3;
const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const DELETE: u32 = 0x0001_0000;
const OBJ_CASE_INSENSITIVE: u32 = 0x40;
const OBJ_DONT_REPARSE: u32 = 0x1000;
const FILE_OPEN: u32 = 1;
const FILE_CREATE: u32 = 2;
const FILE_OPEN_IF: u32 = 3;
const FILE_CREATED: usize = 2;
const FILE_DIRECTORY_FILE: u32 = 1;
const FILE_WRITE_THROUGH: u32 = 2;
const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x20;
const FILE_NON_DIRECTORY_FILE: u32 = 0x40;
const FILE_RENAME_INFORMATION_CLASS: u32 = 10;
const MAX_LEAF_UNITS: usize = 255;
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

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *const u16,
}

#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: Handle,
    object_name: *const UnicodeString,
    attributes: u32,
    security_descriptor: Handle,
    security_quality_of_service: Handle,
}

#[repr(C)]
#[derive(Default)]
struct IoStatusBlock {
    // The native union is either an NTSTATUS or a pointer and has pointer alignment.
    status_or_pointer: usize,
    information: usize,
}

#[repr(C)]
struct RenameInformation {
    replace_if_exists: u8,
    root_directory: Handle,
    file_name_length: u32,
    file_name: [u16; MAX_LEAF_UNITS],
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtCreateFile(
        file: *mut Handle,
        desired_access: u32,
        attributes: *const ObjectAttributes,
        status: *mut IoStatusBlock,
        allocation_size: *const i64,
        file_attributes: u32,
        share_access: u32,
        disposition: u32,
        options: u32,
        ea_buffer: Handle,
        ea_length: u32,
    ) -> i32;
    fn NtSetInformationFile(
        file: Handle,
        status: *mut IoStatusBlock,
        information: *const RenameInformation,
        length: u32,
        class: u32,
    ) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
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

fn leaf(name: &OsStr) -> io::Result<Vec<u16>> {
    let units: Vec<_> = name.encode_wide().collect();
    if units.is_empty()
        || units.len() > MAX_LEAF_UNITS
        || units.iter().any(|c| matches!(*c, 0 | 47 | 58 | 92))
        || units.ends_with(&[b'.' as u16])
        || units.ends_with(&[b' ' as u16])
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid lease path component",
        ));
    }
    Ok(units)
}

fn nt_error(status: i32) -> io::Error {
    io::Error::from_raw_os_error(unsafe { RtlNtStatusToDosError(status) } as i32)
}

fn open_child(
    parent: &File,
    name: &OsStr,
    access: u32,
    disposition: u32,
    options: u32,
) -> io::Result<(File, bool)> {
    let units = leaf(name)?;
    let bytes = (units.len() * size_of::<u16>()) as u16;
    let name = UnicodeString {
        length: bytes,
        maximum_length: bytes,
        buffer: units.as_ptr(),
    };
    let attributes = ObjectAttributes {
        length: size_of::<ObjectAttributes>() as u32,
        root_directory: parent.as_raw_handle(),
        object_name: &name,
        attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        security_descriptor: null_mut(),
        security_quality_of_service: null_mut(),
    };
    let mut handle = null_mut();
    let mut result = IoStatusBlock::default();
    // The kernel resolves one leaf under the already opened directory. The
    // reparse policy applies during resolution, before a create can take effect.
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            access | SYNCHRONIZE,
            &attributes,
            &mut result,
            std::ptr::null(),
            0,
            FILE_SHARE_READ_WRITE,
            disposition,
            options | FILE_SYNCHRONOUS_IO_NONALERT,
            null_mut(),
            0,
        )
    };
    if status < 0 {
        return Err(nt_error(status));
    }
    Ok((
        unsafe { File::from_raw_handle(handle) },
        result.information == FILE_CREATED,
    ))
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

fn drive_directory(path: &Path) -> Result<File> {
    let handle = OpenOptions::new()
        .access_mode(FILE_TRAVERSE | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ_WRITE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(err)?;
    require_directory(&handle)?;
    Ok(handle)
}

fn require_directory(handle: &File) -> Result<()> {
    if info(&handle)?.attributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
        return Err("not a directory".into());
    }
    Ok(())
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
        let mut expanded = OsString::from(r"\\?\");
        expanded.push(root.as_os_str());
        if canonical_root.as_os_str() != expanded {
            return Err("symbolic or aliased project root refused".into());
        }
        let drive = PathBuf::from(format!("{}\\", prefix.as_os_str().to_string_lossy()));
        if drive == root
            || unsafe { GetDriveTypeW(wide(drive.as_os_str()).as_ptr()) } != DRIVE_FIXED
        {
            return Err("project must be on a fixed local NTFS drive".into());
        }
        let drive = Parent {
            handle: drive_directory(&drive)?,
            path: drive,
        };
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
        let parent = self.parent();
        let (handle, _) = open_child(
            &parent.handle,
            name,
            FILE_TRAVERSE | FILE_READ_ATTRIBUTES,
            if create { FILE_OPEN_IF } else { FILE_OPEN },
            FILE_DIRECTORY_FILE,
        )
        .map_err(err)?;
        require_directory(&handle)?;
        let identity = stamp(&handle)?;
        if identity.dev != self.stamps[0].dev {
            return Err("project path changed volumes".into());
        }
        self.dirs.push(Parent {
            path: parent.path.join(name),
            handle,
        });
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
        let mut current = drive_directory(&self.dirs[0].path)?;
        for (index, (pinned, expected)) in self.dirs.iter().zip(&self.stamps).enumerate() {
            if index > 0 {
                let name = pinned
                    .path
                    .file_name()
                    .ok_or("missing pinned directory name")?;
                current = open_child(
                    &current,
                    name,
                    FILE_TRAVERSE | FILE_READ_ATTRIBUTES,
                    FILE_OPEN,
                    FILE_DIRECTORY_FILE,
                )
                .map_err(err)?
                .0;
            }
            if stamp(&pinned.handle)? != *expected || stamp(&current)? != *expected {
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
    let access = GENERIC_READ | if writable { GENERIC_WRITE } else { 0 };
    let (file, created) = open_child(
        &parent.handle,
        OsStr::new(name),
        access,
        if create { FILE_OPEN_IF } else { FILE_OPEN },
        FILE_NON_DIRECTORY_FILE,
    )
    .map_err(err)?;
    if !single_link(&file)? {
        return Err("non-regular or multiply linked lease file".into());
    }
    if created {
        file.sync_all().map_err(err)?;
    }
    Ok((file, created))
}

pub(super) fn entry_exists(parent: &Parent, name: &str) -> Result<bool> {
    match open_child(
        &parent.handle,
        OsStr::new(name),
        FILE_READ_ATTRIBUTES,
        FILE_OPEN,
        0,
    ) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(err(e)),
    }
}

pub(super) fn create_temporary(parent: &Parent, name: &str) -> Result<File> {
    open_child(
        &parent.handle,
        OsStr::new(name),
        GENERIC_WRITE | DELETE,
        FILE_CREATE,
        FILE_NON_DIRECTORY_FILE | FILE_WRITE_THROUGH,
    )
    .map(|(file, _)| file)
    .map_err(err)
}

pub(super) fn publish(
    _parent: &Parent,
    file: File,
    _from: &str,
    to: &str,
    replace: bool,
) -> Result<bool> {
    let name = leaf(OsStr::new(to)).map_err(err)?;
    if !single_link(&file)? {
        return Err("non-regular or multiply linked lease temporary file".into());
    }
    // A simple destination name and NULL RootDirectory rename the open file
    // inside its current directory. No DOS pathname is resolved for either end.
    // The marker was file-synced; this is not a journal directory flush.
    let mut rename = RenameInformation {
        replace_if_exists: u8::from(replace),
        root_directory: null_mut(),
        file_name_length: (name.len() * size_of::<u16>()) as u32,
        file_name: [0; MAX_LEAF_UNITS],
    };
    rename.file_name[..name.len()].copy_from_slice(&name);
    let status = unsafe {
        NtSetInformationFile(
            file.as_raw_handle(),
            &mut IoStatusBlock::default(),
            &rename,
            size_of::<RenameInformation>() as u32,
            FILE_RENAME_INFORMATION_CLASS,
        )
    };
    if status >= 0 {
        file.sync_all().map_err(err)?;
        return Ok(true);
    }
    let error = nt_error(status);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, time::SystemTime};

    #[test]
    fn lease_mutations_use_open_handles_instead_of_remembered_path() {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sandbox = std::env::temp_dir().join(format!(
            "flow-lease-relative-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&sandbox).unwrap();
        let pinned = sandbox.join("pinned");
        let other = sandbox.join("other");
        fs::create_dir(&pinned).unwrap();
        fs::create_dir(&other).unwrap();
        let handle = drive_directory(&pinned).unwrap();
        let identity = stamp(&handle).unwrap();

        // Give the retained handle a different path label to catch accidental
        // pathname-based creates or publication without relying on race timing.
        let mut tree = Tree {
            dirs: vec![Parent {
                path: other.clone(),
                handle,
            }],
            stamps: vec![identity],
        };
        tree.push(OsStr::new("namespace"), true).unwrap();
        let parent = tree.parent();
        drop(plain(parent, "writer.lock", true, true).unwrap());
        let mut temp = create_temporary(parent, "marker.tmp").unwrap();
        temp.write_all(b"owner").unwrap();
        temp.sync_all().unwrap();
        assert!(publish(parent, temp, "marker.tmp", "owner.json", false).unwrap());
        assert_eq!(
            fs::read(pinned.join("namespace").join("owner.json")).unwrap(),
            b"owner"
        );
        assert!(pinned.join("namespace").join("writer.lock").is_file());
        assert!(!other.join("namespace").exists());
        drop(tree);
        fs::remove_dir_all(sandbox).unwrap();
    }
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
