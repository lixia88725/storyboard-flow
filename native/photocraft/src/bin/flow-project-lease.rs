//! Project writer lease. OS lock + durable Main-owner marker, not a PID-based lock.
//! Abnormal guard loss NEVER publishes release. A live/unknown previous Main refuses
//! takeover even after the OS lock becomes free. No file deletion or lock-inode rename.
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod supported {
    use rustix::fs::{self as rfs, AtFlags, Mode, OFlags};
    use serde::{Deserialize, Serialize};
    use serde_json::{Value, json};
    use std::{
        ffi::OsString,
        fs::File,
        io::{self, BufRead, Read, Write},
        os::unix::fs::MetadataExt,
        path::{Component, Path, PathBuf},
        sync::mpsc,
        time::Duration,
    };
    unsafe extern "C" {
        fn getppid() -> i32;
        fn kill(pid: i32, signal: i32) -> i32;
        fn gethostname(name: *mut std::ffi::c_char, len: usize) -> i32;
    }
    type Result<T> = std::result::Result<T, String>;
    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Stamp {
        dev: u64,
        ino: u64,
    }
    fn stamp(f: &File) -> Result<Stamp> {
        let m = f.metadata().map_err(err)?;
        Ok(Stamp {
            dev: m.dev(),
            ino: m.ino(),
        })
    }
    fn err(e: impl std::fmt::Display) -> String {
        e.to_string()
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
    fn plain(parent: &File, name: &str, create: bool, writable: bool) -> Result<(File, bool)> {
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
    struct Tree {
        parts: Vec<OsString>,
        dirs: Vec<File>,
        stamps: Vec<Stamp>,
    }
    impl Tree {
        fn acquire(root: &Path) -> Result<Self> {
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
        fn root_stamp(&self) -> &Stamp {
            &self.stamps[self.stamps.len() - 3]
        }
        fn parent(&self) -> &File {
            self.dirs
                .last()
                .expect("tree always contains filesystem root")
        }
        fn check(&self) -> Result<()> {
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
    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Owner {
        schema: u32,
        state: String,
        platform: String,
        host: String,
        main_pid: i32,
        nonce: String,
        directories: Vec<Stamp>,
        lock: Stamp,
    }
    fn read_owner(tree: &Tree) -> Result<(Owner, Stamp)> {
        let (mut file, _) = plain(tree.parent(), "owner.json", false, false)?;
        if file.metadata().map_err(err)?.len() > 16384 {
            return Err("owner marker exceeds budget".into());
        }
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take(16385)
            .read_to_end(&mut bytes)
            .map_err(err)?;
        if bytes.len() > 16384 {
            return Err("owner marker exceeds budget".into());
        }
        let marker = serde_json::from_slice(&bytes).map_err(err)?;
        Ok((marker, stamp(&file)?))
    }
    fn publish_owner(
        tree: &Tree,
        owner: &Owner,
        expected: Option<&Stamp>,
        phase: &str,
    ) -> Result<Stamp> {
        tree.check()?;
        if let Some(expected) = expected {
            if read_owner(tree)?.1 != *expected {
                return Err("owner marker identity changed".into());
            }
        } else if rfs::statat(tree.parent(), "owner.json", AtFlags::SYMLINK_NOFOLLOW).is_ok() {
            return Err("unexpected owner marker".into());
        }
        let name = format!(
            ".owner-{}-{}-{}.tmp",
            owner.nonce,
            std::process::id(),
            phase
        );
        // EXCL means retained evidence is never overwritten or cleaned automatically.
        let fd = rfs::openat(
            tree.parent(),
            name.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_bits_truncate(0o600),
        )
        .map_err(err)?;
        let mut temp = File::from(fd);
        let bytes = serde_json::to_vec(owner).map_err(err)?;
        temp.write_all(&bytes).map_err(err)?;
        temp.sync_all().map_err(err)?;
        tree.check()?;
        if let Some(expected) = expected {
            if read_owner(tree)?.1 != *expected {
                return Err("owner marker replaced before publication".into());
            }
        }
        rfs::renameat(tree.parent(), name.as_str(), tree.parent(), "owner.json").map_err(err)?;
        tree.parent().sync_all().map_err(err)?;
        Ok(read_owner(tree)?.1)
    }
    fn host() -> Result<String> {
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
    fn confirmed_dead(pid: i32) -> bool {
        pid > 1
            && unsafe { kill(pid, 0) } == -1
            && io::Error::last_os_error().raw_os_error()
                == Some(rustix::io::Errno::SRCH.raw_os_error())
    }
    struct Lease {
        tree: Tree,
        lock_file: File,
        lock: Stamp,
        owner: Owner,
        owner_stamp: Stamp,
    }
    impl Lease {
        fn acquire(root: &Path, nonce: String) -> Result<Self> {
            let tree = Tree::acquire(root)?;
            let (lock_file, created) = plain(tree.parent(), "writer.lock", true, true)?;
            lock_file
                .try_lock()
                .map_err(|e| format!("OS writer lock unavailable: {e}"))?;
            let lock = stamp(&lock_file)?;
            let parent_pid = unsafe { getppid() };
            if parent_pid <= 1 {
                return Err("Main owner identity unavailable".into());
            }
            let mut owner = Owner {
                schema: 1,
                state: "held".into(),
                platform: std::env::consts::OS.into(),
                host: host()?,
                main_pid: parent_pid,
                nonce,
                directories: tree.stamps.clone(),
                lock: lock.clone(),
            };
            let previous = if created {
                if rfs::statat(tree.parent(), "owner.json", AtFlags::SYMLINK_NOFOLLOW).is_ok() {
                    return Err("new lock has an existing owner marker".into());
                }
                None
            } else {
                let (old, stamp) = read_owner(&tree)?;
                if old.schema != 1
                    || !matches!(old.state.as_str(), "held" | "released")
                    || old.main_pid <= 1
                    || old.nonce.is_empty()
                    || old.platform != owner.platform
                    || old.host != owner.host
                    || old.directories != owner.directories
                    || old.lock != lock
                {
                    return Err("foreign, copied or unrecognized owner marker; retained".into());
                }
                if old.state == "held" && !confirmed_dead(old.main_pid) {
                    return Err(
                        "previous Main owner is alive or cannot be confirmed exited; retained"
                            .into(),
                    );
                }
                Some(stamp)
            };
            tree.check()?;
            let (reopened, _) = plain(tree.parent(), "writer.lock", false, true)?;
            if stamp(&reopened)? != lock {
                return Err("writer lock path replaced".into());
            }
            owner.state = "held".into();
            let owner_stamp = publish_owner(&tree, &owner, previous.as_ref(), "acquire")?;
            let lease = Self {
                tree,
                lock_file,
                lock,
                owner,
                owner_stamp,
            };
            lease.check()?;
            Ok(lease)
        }
        fn check(&self) -> Result<()> {
            self.tree.check()?;
            let (lock, _) = plain(self.tree.parent(), "writer.lock", false, true)?;
            if stamp(&lock)? != self.lock
                || stamp(&self.lock_file)? != self.lock
                || self.lock_file.metadata().map_err(err)?.nlink() != 1
            {
                return Err("writer lock identity changed".into());
            }
            let (owner, stamp) = read_owner(&self.tree)?;
            if stamp != self.owner_stamp || owner != self.owner {
                return Err("owner identity changed".into());
            }
            if unsafe { getppid() } != self.owner.main_pid {
                return Err("Main owner disconnected".into());
            }
            Ok(())
        }
        fn release(&mut self) -> Result<()> {
            self.check()?;
            let mut released = self.owner.clone();
            released.state = "released".into();
            self.owner_stamp =
                publish_owner(&self.tree, &released, Some(&self.owner_stamp), "release")?;
            // Called only after Main has explicitly drained its accepted obligations.
            self.lock_file.unlock().map_err(err)?;
            Ok(())
        }
    }
    fn send(value: Value) -> Result<()> {
        let mut out = io::stdout().lock();
        serde_json::to_writer(&mut out, &value).map_err(err)?;
        out.write_all(b"\n").map_err(err)?;
        out.flush().map_err(err)
    }
    pub fn run() -> Result<()> {
        let mut args = std::env::args_os().skip(1);
        let root = PathBuf::from(args.next().ok_or("project root missing")?);
        let nonce = args
            .next()
            .ok_or("owner nonce missing")?
            .into_string()
            .map_err(|_| "nonce is not UTF-8")?;
        if args.next().is_some()
            || nonce.is_empty()
            || nonce.len() > 128
            || !nonce
                .bytes()
                .all(|v| v.is_ascii_alphanumeric() || v == b'-')
        {
            return Err("invalid lease arguments".into());
        }
        let mut lease = match Lease::acquire(&root, nonce.clone()) {
            Ok(v) => v,
            Err(e) => {
                send(json!({"protocol":1,"kind":"refused","nonce":nonce,"message":e}))?;
                return Err(e);
            }
        };
        send(
            json!({"protocol":1,"kind":"held","nonce":nonce,"ownerPid":lease.owner.main_pid,"guardPid":std::process::id(),"root":{"path":root,"dev":lease.tree.root_stamp().dev.to_string(),"ino":lease.tree.root_stamp().ino.to_string()}}),
        )?;
        let (tx, rx) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut input = io::stdin().lock();
            loop {
                let mut bytes = Vec::new();
                match (&mut input).take(4097).read_until(b'\n', &mut bytes) {
                    Ok(0) => {
                        let _ = tx.send(None);
                        break;
                    }
                    Ok(_) if bytes.len() <= 4096 && bytes.last() == Some(&b'\n') => {
                        if tx.send(Some(bytes)).is_err() {
                            break;
                        }
                    }
                    _ => {
                        let _ = tx.send(None);
                        break;
                    }
                }
            }
        });
        loop {
            if let Err(e) = lease.check() {
                let _ = send(json!({"protocol":1,"kind":"invalidated","nonce":nonce,"message":e}));
                return Err(e);
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) | Ok(None) => return Err("Main input disconnected without a release".into()),
                Ok(Some(bytes)) => {
                    let command: Value = serde_json::from_slice(&bytes).map_err(err)?;
                    let id = command["id"]
                        .as_u64()
                        .filter(|v| *v > 0 && *v <= 9_007_199_254_740_991)
                        .ok_or("invalid request id")?;
                    if command["nonce"].as_str() != Some(nonce.as_str()) {
                        return Err("lease nonce mismatch".into());
                    }
                    match command["kind"].as_str() {
                        Some("check") => {
                            if let Some(binding) = command.get("root") {
                                if binding["path"].as_str() != root.to_str()
                                    || binding["dev"].as_str()
                                        != Some(lease.tree.root_stamp().dev.to_string().as_str())
                                    || binding["ino"].as_str()
                                        != Some(lease.tree.root_stamp().ino.to_string().as_str())
                                {
                                    return Err("project root binding mismatch".into());
                                }
                            }
                            lease.check()?;
                            send(json!({"protocol":1,"kind":"checked","nonce":nonce,"id":id}))?;
                        }
                        Some("release") => {
                            lease.release()?;
                            send(json!({"protocol":1,"kind":"released","nonce":nonce,"id":id}))?;
                            return Ok(());
                        }
                        _ => return Err("invalid lease command".into()),
                    }
                }
            }
        }
    }
}
fn main() {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if let Err(error) = supported::run() {
        eprintln!("project lease refused: {error}");
        std::process::exit(2);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        eprintln!("project lease unavailable on this platform");
        std::process::exit(2);
    }
}
