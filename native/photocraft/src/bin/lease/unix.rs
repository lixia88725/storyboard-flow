use super::{Result, Stamp, err};
use rustix::fs::{self as rfs, AtFlags, Mode, OFlags};
use std::{
    ffi::OsString,
    fs::File,
    io,
    os::unix::fs::MetadataExt,
    path::{Component, Path},
};

unsafe extern "C" {
    fn getppid() -> i32;
    fn kill(pid: i32, signal: i32) -> i32;
    fn gethostname(name: *mut std::ffi::c_char, len: usize) -> i32;
}
pub(super) type Parent = File;
pub(super) fn stamp(f: &File) -> Result<Stamp> {
    let m = f.metadata().map_err(err)?;
    Ok(Stamp {
        dev: m.dev(),
        ino: m.ino(),
    })
}
fn directory(parent: &File, name: &std::ffi::OsStr, create: bool) -> Result<File> {
    if create {
        match rfs::mkdirat(parent, name, Mode::from_bits_truncate(0o700)) {
            Ok(()) => parent.sync_all().map_err(err)?,
            Err(e) if e == rustix::io::Errno::EXIST => (),
            Err(e) => return Err(err(e)),
        }
    }
    let fd = rfs::openat(
        parent,
        name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(err)?;
    let file = File::from(fd);
    if !file.metadata().map_err(err)?.is_dir() {
        return Err("not a directory".into());
    }
    Ok(file)
}
pub(super) fn plain(
    parent: &File,
    name: &str,
    create: bool,
    writable: bool,
) -> Result<(File, bool)> {
    let mode = if writable {
        OFlags::RDWR
    } else {
        OFlags::RDONLY
    };
    let flags = mode | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
    let (file, created) = if create {
        match rfs::openat(
            parent,
            name,
            flags | OFlags::CREATE | OFlags::EXCL,
            Mode::from_bits_truncate(0o600),
        ) {
            Ok(fd) => (File::from(fd), true),
            Err(e) if e == rustix::io::Errno::EXIST => {
                return plain(parent, name, false, writable);
            }
            Err(e) => return Err(err(e)),
        }
    } else {
        let before = rfs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(err)?;
        if rfs::FileType::from_raw_mode(before.st_mode) != rfs::FileType::RegularFile
            || before.st_nlink != 1
        {
            return Err("non-regular, symbolic or multiply linked lease file".into());
        }
        let file = File::from(rfs::openat(parent, name, flags, Mode::empty()).map_err(err)?);
        if stamp(&file)?
            != (Stamp {
                dev: before.st_dev as u64,
                ino: before.st_ino as u64,
            })
        {
            return Err("lease file changed while opening".into());
        }
        (file, false)
    };
    let m = file.metadata().map_err(err)?;
    if !m.is_file() || m.nlink() != 1 {
        return Err("non-regular or multiply linked lease file".into());
    }
    if created {
        parent.sync_all().map_err(err)?;
    }
    Ok((file, created))
}
pub(super) struct Tree {
    parts: Vec<OsString>,
    dirs: Vec<File>,
    pub(super) stamps: Vec<Stamp>,
}
impl Tree {
    pub(super) fn acquire(root: &Path) -> Result<Self> {
        if root == Path::new("/")
            || !root.is_absolute()
            || root
                .components()
                .any(|c| !matches!(c, Component::RootDir | Component::Normal(_)))
        {
            return Err("canonical absolute project root required".into());
        }
        if std::fs::canonicalize(root).map_err(err)? != root {
            return Err("symbolic or aliased project root refused".into());
        }
        let filesystem = File::from(
            rfs::open(
                "/",
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(err)?,
        );
        let mut tree = Self {
            parts: vec![],
            stamps: vec![stamp(&filesystem)?],
            dirs: vec![filesystem],
        };
        for part in root.components() {
            if let Component::Normal(name) = part {
                tree.push(name, false)?;
            }
        }
        tree.push(std::ffi::OsStr::new(".storyboard-flow"), true)?;
        tree.push(std::ffi::OsStr::new("image-project-v2"), true)?;
        tree.check()?;
        Ok(tree)
    }
    fn push(&mut self, name: &std::ffi::OsStr, create: bool) -> Result<()> {
        let file = directory(self.dirs.last().ok_or("missing parent")?, name, create)?;
        self.stamps.push(stamp(&file)?);
        self.parts.push(name.to_owned());
        self.dirs.push(file);
        Ok(())
    }
    pub(super) fn root_stamp(&self) -> &Stamp {
        &self.stamps[self.stamps.len() - 3]
    }
    pub(super) fn parent(&self) -> &File {
        self.dirs
            .last()
            .expect("tree always contains filesystem root")
    }
    pub(super) fn check(&self) -> Result<()> {
        let mut current = File::from(
            rfs::open(
                "/",
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(err)?,
        );
        if stamp(&current)? != self.stamps[0] {
            return Err("filesystem root changed".into());
        }
        for (index, part) in self.parts.iter().enumerate() {
            current = directory(&current, part, false)?;
            if stamp(&current)? != self.stamps[index + 1]
                || stamp(&self.dirs[index + 1])? != self.stamps[index + 1]
            {
                return Err("project directory identity changed".into());
            }
        }
        Ok(())
    }
}
pub(super) fn host() -> Result<String> {
    let mut buf = [0u8; 256];
    // POSIX host/PID checks are used only to refuse uncertain owners, never to steal a live lock.
    if unsafe { gethostname(buf.as_mut_ptr().cast(), buf.len()) } != 0 {
        return Err(err(io::Error::last_os_error()));
    }
    let end = buf
        .iter()
        .position(|v| *v == 0)
        .ok_or("host name is truncated")?;
    let name = std::str::from_utf8(&buf[..end]).map_err(err)?;
    if name.is_empty() {
        return Err("empty host identity".into());
    }
    Ok(name.to_owned())
}
pub(super) fn confirmed_dead(pid: i32) -> bool {
    pid > 1
        && unsafe { kill(pid, 0) } == -1
        && io::Error::last_os_error().raw_os_error() == Some(rustix::io::Errno::SRCH.raw_os_error())
}
pub(super) fn entry_exists(parent: &Parent, name: &str) -> Result<bool> {
    match rfs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(_) => Ok(true),
        Err(e) if e == rustix::io::Errno::NOENT => Ok(false),
        Err(e) => Err(err(e)),
    }
}

pub(super) fn create_temporary(parent: &Parent, name: &str) -> Result<File> {
    rfs::openat(
        parent,
        name,
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::from_bits_truncate(0o600),
    )
    .map(File::from)
    .map_err(err)
}

pub(super) fn publish(parent: &Parent, from: &str, to: &str, replace: bool) -> Result<bool> {
    let moved = if replace {
        rfs::renameat(parent, from, parent, to).map_err(err)?;
        true
    } else {
        match rfs::renameat_with(parent, from, parent, to, rfs::RenameFlags::NOREPLACE) {
            Ok(()) => true,
            Err(e) if e == rustix::io::Errno::EXIST => false,
            Err(e) => return Err(err(e)),
        }
    };
    parent.sync_all().map_err(err)?;
    Ok(moved)
}

pub(super) fn single_link(file: &File) -> Result<bool> {
    Ok(file.metadata().map_err(err)?.nlink() == 1)
}

pub(super) struct MainOwner(i32);
impl MainOwner {
    pub(super) fn current() -> Result<Self> {
        let pid = unsafe { getppid() };
        if pid <= 1 {
            return Err("Main owner identity unavailable".into());
        }
        Ok(Self(pid))
    }
    pub(super) fn pid(&self) -> i32 {
        self.0
    }
    pub(super) fn check(&self) -> Result<()> {
        if unsafe { getppid() } != self.0 {
            return Err("Main owner disconnected".into());
        }
        Ok(())
    }
}
