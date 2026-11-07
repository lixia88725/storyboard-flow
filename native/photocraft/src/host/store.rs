//! Private immutable objects + native manifests. No GC, repair, user file publication or autosaver.
use super::{Error, Result, Source, dimensions};
use photocraft_doc::Document;
use photocraft_format::{
    ByteSource, FormatError, LoadOptions, PcraftWriter, SnapshotObject, SnapshotSink,
};
use photocraft_ops::LayerTarget;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

pub fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn is_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VersionReceipt {
    pub schema: String,
    pub version: u32,
    pub document_id: String,
    pub version_id: String,
    pub manifest_sha256: String,
    pub object_count: usize,
    pub new_object_bytes: u64,
    pub logical_bytes: u64,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Version {
    schema: String,
    version: u32,
    document_id: String,
    native_manifest: serde_json::Value,
    active_layer: Option<u64>,
    selected_layers: Vec<u64>,
    source: Option<Source>,
}
pub struct Loaded {
    pub doc: Arc<Document>,
    pub target: LayerTarget,
    pub source: Option<Source>,
}
pub struct Store {
    root: PathBuf,
    _lock: File,
    budget: u64,
    used: u64,
    budget_dirty: bool,
    cache_allowed: bool,
    serial: u64,
    journal: super::journal::Journal,
    writer: PcraftWriter,
    last_error: Option<Error>,
    verified: HashMap<String, FileStamp>,
    pending_verification: HashMap<String, FileStamp>,
    last_publication: Option<FileStamp>,
    pending_directories: BTreeSet<PathBuf>,
    test_io_delay_ms: u64,
    pub new_object_bytes: u64,
    pub object_count: usize,
}
fn io(e: impl std::fmt::Display) -> Error {
    Error::retained("storage", e.to_string())
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct FileStamp {
    len: u64,
    modified: std::time::SystemTime,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64, i64, i64),
}
pub(super) fn stamp(file: &File) -> Result<FileStamp> {
    let m = file.metadata().map_err(io)?;
    if !m.is_file() {
        return Err(Error::retained(
            "unsafe-path",
            "object is not a regular file",
        ));
    }
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        (
            m.dev(),
            m.ino(),
            m.ctime(),
            m.ctime_nsec(),
            m.mtime(),
            m.mtime_nsec(),
        )
    };
    Ok(FileStamp {
        len: m.len(),
        modified: m.modified().map_err(io)?,
        #[cfg(unix)]
        identity,
    })
}
pub(super) fn verified_read(path: &Path, max: usize) -> Result<(Vec<u8>, FileStamp)> {
    let mut f = open_plain(path, false)?;
    let before = stamp(&f)?;
    if before.len > max as u64 {
        return Err(Error::none("limit", "stored file exceeds budget"));
    }
    let mut out = Vec::new();
    Read::by_ref(&mut f)
        .take(max as u64 + 1)
        .read_to_end(&mut out)
        .map_err(io)?;
    let after = stamp(&f)?;
    if before != after || out.len() as u64 != before.len {
        return Err(Error::retained(
            "conflict",
            "immutable object changed during read",
        ));
    }
    if out.len() > max {
        return Err(Error::none("limit", "stored file grew past budget"));
    }
    Ok((out, after))
}
fn regular_read(path: &Path, max: usize) -> Result<Vec<u8>> {
    Ok(verified_read(path, max)?.0)
}
pub(super) fn open_plain(path: &Path, create: bool) -> Result<File> {
    #[cfg(unix)]
    {
        use rustix::fs::{Mode, OFlags, open};
        let flags = OFlags::NOFOLLOW
            | OFlags::CLOEXEC
            | OFlags::NONBLOCK
            | if create {
                OFlags::CREATE | OFlags::RDWR
            } else {
                OFlags::RDONLY
            };
        let f = File::from(open(path, flags, Mode::RUSR | Mode::WUSR).map_err(io)?);
        if !f.metadata().map_err(io)?.is_file() {
            return Err(Error::none("unsafe-path", "not a plain file"));
        }
        Ok(f)
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
        let f = OpenOptions::new()
            .read(true)
            .write(create)
            .create(create)
            .custom_flags(0x00200000)
            .open(path)
            .map_err(io)?;
        let m = f.metadata().map_err(io)?;
        if !m.is_file() || m.file_attributes() & 0x400 != 0 {
            return Err(Error::none("unsafe-path", "not a plain file"));
        }
        Ok(f)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, create);
        Err(Error::none("unsupported", "native storage platform"))
    }
}
fn plain_dir(path: &Path) -> Result<()> {
    let m = fs::symlink_metadata(path).map_err(io)?;
    if !m.is_dir() || m.file_type().is_symlink() {
        return Err(Error::none("unsafe-path", "store contains non-directory"));
    }
    Ok(())
}
fn usage(root: &Path) -> Result<u64> {
    let mut total = 0u64;
    for entry in fs::read_dir(root).map_err(io)? {
        let p = entry.map_err(io)?.path();
        let m = fs::symlink_metadata(&p).map_err(io)?;
        if m.file_type().is_symlink() {
            return Err(Error::none("unsafe-path", "store contains symlink"));
        }
        total = total
            .checked_add(if m.is_dir() {
                usage(&p)?
            } else if m.is_file() {
                m.len()
            } else {
                return Err(Error::none("unsafe-path", "store contains special file"));
            })
            .ok_or_else(|| Error::none("limit", "usage overflow"))?;
    }
    Ok(total)
}
fn admit_document(doc: &Document) -> Result<()> {
    dimensions(doc.size.width, doc.size.height)?;
    if doc.mode != photocraft_color::ColorMode::Rgb || doc.depth != photocraft_color::SampleType::U8
    {
        return Err(Error::retained(
            "unsupported",
            "stage-A native documents must be RGB8",
        ));
    }
    if let Some(bytes) = &doc.icc_profile {
        let profile = photocraft_cms::Profile::parse(bytes)
            .map_err(|e| Error::retained("unsupported", format!("invalid RGB ICC: {e}")))?;
        if profile.color_space != photocraft_cms::ColorSpace::Rgb {
            return Err(Error::retained(
                "unsupported",
                "RGB document has non-RGB ICC",
            ));
        }
        photocraft_cms::Transform::new(
            &profile,
            photocraft_cms::Builtin::Srgb.profile(),
            photocraft_cms::Intent::RelativeColorimetric,
            true,
        )
        .map_err(|e| {
            Error::retained(
                "unsupported",
                format!("RGB ICC cannot be rendered reliably: {e}"),
            )
        })?;
    }
    if doc.layer_count() > 64 {
        return Err(Error::retained("limit", "stage-A layer budget exceeded"));
    }
    let mut bytes = 0u64;
    doc.for_each_surface(|s| {
        bytes = bytes.saturating_add(
            (s.tile_count() as u64)
                .saturating_mul(256 * 256)
                .saturating_mul(s.format().bytes_per_pixel() as u64),
        )
    });
    if bytes > 512 << 20 {
        return Err(Error::retained(
            "limit",
            "native materialized pixel budget exceeded",
        ));
    }
    Ok(())
}
impl Store {
    pub fn open(root: &Path, budget: u64) -> Result<Self> {
        if budget == 0 || budget > (8u64 << 30) {
            return Err(Error::none("limit", "invalid store budget"));
        }
        if !root.exists() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                fs::DirBuilder::new().mode(0o700).create(root).map_err(io)?;
            }
            #[cfg(not(unix))]
            fs::create_dir(root).map_err(io)?;
        }
        plain_dir(root)?;
        let root = fs::canonicalize(root).map_err(io)?;
        for sub in ["tiles", "blobs", "versions", "ops", "staging"] {
            let p = root.join(sub);
            if !p.exists() {
                fs::create_dir(&p).map_err(io)?;
            }
            plain_dir(&p)?;
        }
        let lock = open_plain(&root.join("host.lock"), true)?;
        lock.try_lock()
            .map_err(|e| Error::none("busy", format!("one writable native host per store: {e}")))?;
        // Only APFS currently has a verified strong-metadata cache policy. Other volumes
        // keep full content verification, including Windows until its identity path is tested.
        #[cfg(target_os = "macos")]
        let cache_allowed = rustix::fs::fstatfs(&lock).ok().is_some_and(|v| {
            v.f_fstypename
                .iter()
                .take_while(|c| **c != 0)
                .map(|c| *c as u8)
                .collect::<Vec<_>>()
                == b"apfs"
        });
        #[cfg(not(target_os = "macos"))]
        let cache_allowed = false;
        let used = usage(&root)?;
        if used > budget {
            return Err(Error::retained("limit", "retained store exceeds budget"));
        }
        let journal = super::journal::Journal::open(&root.join("ops"))?;
        Ok(Self {
            root,
            _lock: lock,
            budget,
            used,
            budget_dirty: false,
            cache_allowed,
            serial: 0,
            journal,
            writer: PcraftWriter::new(),
            last_error: None,
            verified: HashMap::new(),
            pending_verification: HashMap::new(),
            last_publication: None,
            pending_directories: BTreeSet::new(),
            test_io_delay_ms: match std::env::var("FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS") {
                Ok(value) => value
                    .parse::<u64>()
                    .ok()
                    .filter(|v| *v <= 1000)
                    .ok_or_else(|| {
                        Error::none("invalid-input", "test IO delay must be 0..1000ms")
                    })?,
                Err(std::env::VarError::NotPresent) => 0,
                Err(_) => return Err(Error::none("invalid-input", "invalid test IO delay")),
            },
            new_object_bytes: 0,
            object_count: 0,
        })
    }
    fn path(&self, relative: &str) -> Result<PathBuf> {
        let (dir, name) = relative
            .split_once('/')
            .ok_or_else(|| Error::none("unsafe-path", "invalid object path"))?;
        if !["tiles", "blobs", "versions", "ops", "staging"].contains(&dir)
            || name.is_empty()
            || name.contains('/')
            || name.contains('\\')
            || name == "."
            || name == ".."
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        {
            return Err(Error::none("unsafe-path", "invalid object path"));
        }
        plain_dir(&self.root.join(dir))?;
        Ok(self.root.join(relative))
    }
    pub fn read(&self, relative: &str, max: usize) -> Result<Option<Vec<u8>>> {
        let p = self.path(relative)?;
        match fs::symlink_metadata(&p) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(io(e)),
            Ok(_) => regular_read(&p, max).map(Some),
        }
    }
    fn test_io_delay(&self) {
        // Explicit synthetic-test injection. Real writes/flushes and their errors still run.
        // Every configured publication/journal call is delayed on its owner, including hydration.
        if self.test_io_delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(self.test_io_delay_ms));
        }
    }
    /// File flush -> exclusive hardlink -> directory flush. Unknown publication retains stage.
    /// No existing file is replaced, even when it is corrupt. Every success is re-read verified.
    pub fn publish(&mut self, relative: &str, bytes: &[u8]) -> Result<()> {
        self.publish_inner(relative, bytes, true)
    }
    fn publish_inner(&mut self, relative: &str, bytes: &[u8], flush_directory: bool) -> Result<()> {
        let started = std::time::Instant::now();
        let dst = self.path(relative)?;
        if let Some(old) = self.read(relative, bytes.len())? {
            if old == bytes {
                let (again, signature) = verified_read(&dst, bytes.len())?;
                if again != bytes {
                    return Err(Error::retained(
                        "conflict",
                        "immutable object changed while reusing publication",
                    ));
                }
                self.last_publication = Some(signature);
                return Ok(());
            }
            return Err(Error::retained(
                "conflict",
                format!("immutable output differs: {relative}"),
            ));
        }
        if self.budget_dirty {
            self.used = usage(&self.root)?;
            self.budget_dirty = false;
        }
        if bytes.len() as u64 > self.budget.saturating_sub(self.used) {
            return Err(Error::retained(
                "limit",
                "store quota exhausted; no GC performed",
            ));
        }
        self.serial += 1;
        self.budget_dirty = true;
        let stage = self.path(&format!(
            "staging/{}-{}.tmp",
            std::process::id(),
            self.serial
        ))?;
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&stage)
            .map_err(io)?;
        self.test_io_delay();
        f.write_all(bytes).map_err(io)?;
        let file_sync_started = std::time::Instant::now();
        f.sync_all().map_err(io)?;
        let file_sync_us = file_sync_started.elapsed().as_micros();
        fs::hard_link(&stage, &dst).map_err(|e| {
            Error::retained(
                "publication",
                format!(
                    "exclusive publication failed; retained {}: {e}",
                    stage.display()
                ),
            )
        })?;
        let dir_sync_started = std::time::Instant::now();
        let parent = dst
            .parent()
            .ok_or_else(|| Error::none("unsafe-path", "no parent"))?;
        if flush_directory {
            sync_dir(parent).map_err(|e| {
                Error::unknown(format!("publication outcome unknown for {relative}: {e}"))
            })?;
        } else {
            // No version receipt is returned until SnapshotSink::finish flushes these namespaces.
            self.pending_directories.insert(parent.to_owned());
        }
        let dir_sync_us = dir_sync_started.elapsed().as_micros();
        fs::remove_file(stage).map_err(io)?;
        // Removing our staging hardlink changes inode ctime. Verify and capture identity only
        // after that known mutation, so the cache never mistakes its own cleanup for corruption.
        let (actual, signature) = verified_read(&dst, bytes.len())?;
        if actual != bytes {
            return Err(Error::unknown("published bytes changed"));
        }
        self.used = self.used.saturating_add(bytes.len() as u64);
        self.budget_dirty = false;
        self.last_publication = Some(signature);
        if std::env::var_os("FLOW_IMAGE_ENGINE_TRACE").is_some() {
            eprintln!(
                "flow-host-trace {}",
                serde_json::json!({"phase":"publish","kind":relative.split('/').next(),"bytes":bytes.len(),"totalUs":started.elapsed().as_micros(),"fileSyncUs":file_sync_us,"directorySyncUs":dir_sync_us})
            );
        }
        Ok(())
    }
    pub(super) fn context_unsettled(&self) -> bool {
        self.journal.context_unsettled()
    }
    pub fn cache_policy(&self) -> &'static str {
        if self.cache_allowed {
            "apfs-stable-file-identity"
        } else {
            "full-content-verification"
        }
    }
    pub fn op_read(&self, id: &str, state: &str) -> Result<Option<serde_json::Value>> {
        self.journal.get(id, state)
    }
    pub fn op_write(&mut self, id: &str, state: &str, value: &serde_json::Value) -> Result<()> {
        self.test_io_delay();
        if self.budget_dirty {
            self.used = usage(&self.root)?;
            self.budget_dirty = false;
        }
        match self
            .journal
            .append(id, state, value, self.budget.saturating_sub(self.used))
        {
            Ok(bytes) => {
                self.used = self.used.saturating_add(bytes);
                Ok(())
            }
            Err(e) => {
                self.budget_dirty = true;
                Err(e)
            }
        }
    }
    pub fn unresolved(&self) -> Result<Vec<String>> {
        self.journal.unresolved()
    }
    pub fn save(
        &mut self,
        doc: &Document,
        target: &LayerTarget,
        source: Option<Source>,
    ) -> Result<VersionReceipt> {
        admit_document(doc)?;
        let started = std::time::Instant::now();
        self.used = usage(&self.root)?;
        self.budget_dirty = false;
        self.new_object_bytes = 0;
        self.object_count = 0;
        self.last_error = None;
        let mut writer = std::mem::take(&mut self.writer);
        let prepared = writer.append_snapshot(doc, self);
        self.writer = writer;
        let append_us = started.elapsed().as_micros();
        let native = prepared.map_err(|e| self.last_error.take().unwrap_or_else(|| io(e)))?;
        let version = Version {
            schema: "flow.image-native-snapshot".into(),
            version: 1,
            document_id: doc.id.0.to_string(),
            native_manifest: serde_json::from_slice(&native).map_err(io)?,
            active_layer: target.active.map(|v| v.0),
            selected_layers: target.selected.iter().map(|v| v.0).collect(),
            source: source.clone(),
        };
        let bytes = serde_json::to_vec(&version).map_err(io)?;
        let digest = sha(&bytes);
        self.publish(&format!("versions/{digest}.json"), &bytes)?;
        if std::env::var_os("FLOW_IMAGE_ENGINE_TRACE").is_some() {
            eprintln!(
                "flow-host-trace {}",
                serde_json::json!({"phase":"snapshot","appendUs":append_us,"totalUs":started.elapsed().as_micros(),"verification":self.cache_policy(),"newObjectBytes":self.new_object_bytes})
            );
        }
        Ok(VersionReceipt {
            schema: "flow.image-version".into(),
            version: 1,
            document_id: doc.id.0.to_string(),
            version_id: digest.clone(),
            manifest_sha256: digest,
            object_count: self.object_count,
            new_object_bytes: self.new_object_bytes,
            logical_bytes: self.used,
            width: doc.size.width,
            height: doc.size.height,
            source,
        })
    }
    pub fn load(&self, id: &str) -> Result<Loaded> {
        if !is_hash(id) {
            return Err(Error::none("invalid-input", "invalid version id"));
        }
        let bytes = self
            .read(&format!("versions/{id}.json"), 16 << 20)?
            .ok_or_else(|| Error::none("not-found", "version missing"))?;
        if sha(&bytes) != id {
            return Err(Error::retained("corrupt", "version hash mismatch"));
        }
        let v: Version = serde_json::from_slice(&bytes).map_err(io)?;
        if v.schema != "flow.image-native-snapshot" || v.version != 1 {
            return Err(Error::none("unsupported-version", "native version schema"));
        }
        let native = serde_json::to_vec(&v.native_manifest).map_err(io)?;
        let src = VersionSource {
            store: self,
            native,
        };
        let opts = LoadOptions {
            preserve_ids: true,
            max_total_bytes: 512 << 20,
            max_blob_bytes: 128 << 20,
            max_canvas_side: 8192,
            max_canvas_pixels: 16 << 20,
            ..Default::default()
        };
        let doc = photocraft_format::load_bytes_source(&src, &opts).map_err(io)?;
        admit_document(&doc)?;
        if doc.id.0.to_string() != v.document_id {
            return Err(Error::retained("corrupt", "document identity mismatch"));
        }
        Ok(Loaded {
            doc: Arc::new(doc),
            target: LayerTarget {
                active: v.active_layer.map(photocraft_doc::LayerId),
                selected: v
                    .selected_layers
                    .into_iter()
                    .map(photocraft_doc::LayerId)
                    .collect(),
            },
            source: v.source,
        })
    }
}
impl SnapshotSink for Store {
    fn get(&mut self, path: &str, max: usize) -> photocraft_format::Result<SnapshotObject> {
        self.object_count += 1;
        let result = (|| -> Result<SnapshotObject> {
            let p = self.path(path)?;
            if let Some(prior) = self.verified.get(path) {
                let file = open_plain(&p, false)?;
                let current = stamp(&file)?;
                if &current != prior {
                    return Err(Error::retained(
                        "corrupt",
                        "immutable object identity changed; retained untouched",
                    ));
                }
                if self.cache_allowed {
                    return Ok(SnapshotObject::Verified);
                }
            }
            match fs::symlink_metadata(&p) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SnapshotObject::Missing),
                Err(e) => Err(io(e)),
                Ok(_) => {
                    let (bytes, signature) = verified_read(&p, max)?;
                    self.pending_verification.insert(path.into(), signature);
                    Ok(SnapshotObject::Bytes(bytes))
                }
            }
        })();
        result.map_err(|e| {
            self.last_error = Some(e.clone());
            FormatError::Corrupt(e.message)
        })
    }
    fn verified(&mut self, path: &str) -> photocraft_format::Result<()> {
        let result = (|| -> Result<()> {
            let pending = self
                .pending_verification
                .remove(path)
                .ok_or_else(|| Error::retained("corrupt", "verification has no matching read"))?;
            let file = open_plain(&self.path(path)?, false)?;
            if stamp(&file)? != pending {
                return Err(Error::retained(
                    "conflict",
                    "object changed before verification acknowledgment",
                ));
            }
            self.verified.insert(path.into(), pending);
            Ok(())
        })();
        result.map_err(|e| {
            self.last_error = Some(e.clone());
            FormatError::Corrupt(e.message)
        })
    }
    fn publish(&mut self, path: &str, bytes: &[u8]) -> photocraft_format::Result<()> {
        self.publish_inner(path, bytes, false).map_err(|e| {
            self.last_error = Some(e.clone());
            FormatError::Corrupt(e.message)
        })?;
        let signature = self
            .last_publication
            .clone()
            .ok_or_else(|| FormatError::Corrupt("publication lacks verified signature".into()))?;
        self.verified.insert(path.into(), signature);
        self.new_object_bytes = self.new_object_bytes.saturating_add(bytes.len() as u64);
        Ok(())
    }
    fn finish(&mut self) -> photocraft_format::Result<()> {
        for dir in self.pending_directories.clone() {
            sync_dir(&dir).map_err(|e| {
                let error = Error::unknown(format!("object directory publication unknown: {e}"));
                self.last_error = Some(error.clone());
                FormatError::Corrupt(error.message)
            })?;
            self.pending_directories.remove(&dir);
        }
        Ok(())
    }
}
struct VersionSource<'a> {
    store: &'a Store,
    native: Vec<u8>,
}
impl ByteSource for VersionSource<'_> {
    fn get(&self, path: &str, max: usize) -> photocraft_format::Result<Vec<u8>> {
        if path == "manifest.json" {
            if self.native.len() > max {
                return Err(FormatError::LimitExceeded("manifest".into()));
            }
            return Ok(self.native.clone());
        }
        self.store
            .read(path, max)
            .map_err(|e| FormatError::Corrupt(e.message))?
            .ok_or_else(|| FormatError::Corrupt(format!("missing {path}")))
    }
}
pub(super) fn sync_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        File::open(dir)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
        Ok(())
    } // Windows dir-entry power-loss durability remains a release gate.
}
