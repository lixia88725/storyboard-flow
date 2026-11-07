//! Immutable operation records in append-only segments. Each acknowledged record is file-flushed.
//! Segment names are made durable once at creation. Torn tails are retained; restart opens a new
//! segment and uses only the checksummed complete prefix. No truncation, replacement or GC.
use super::store::{FileStamp, open_plain, stamp, sync_dir, verified_read};
use super::{Error, Result, valid_id};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
const MAX_RECORD: usize = 1 << 20;
const MAX_SEGMENT: usize = 16 << 20;
const STATES: [&str; 5] = ["intent", "prepared", "accepted", "discarded", "failed"];
fn io(e: impl std::fmt::Display) -> Error {
    Error::retained("journal", e.to_string())
}
fn key(id: &str, state: &str) -> Result<String> {
    valid_id(id)?;
    if !STATES.contains(&state) {
        return Err(Error::none("invalid-input", "invalid operation state"));
    }
    Ok(format!("{id}.{state}"))
}
pub(super) struct Journal {
    root: PathBuf,
    current: String,
    file: File,
    number: u64,
    length: usize,
    failed: bool,
    unsettled: HashSet<String>,
    records: HashMap<String, Value>,
    files: HashMap<String, FileStamp>,
}
impl Journal {
    pub fn open(root: &Path) -> Result<Self> {
        let mut segments = Vec::new();
        for entry in fs::read_dir(root).map_err(io)? {
            let entry = entry.map_err(io)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let number = name
                .strip_prefix("segment-")
                .and_then(|s| s.strip_suffix(".log"))
                .filter(|s| s.len() == 20)
                .and_then(|s| s.parse::<u64>().ok())
                .ok_or_else(|| {
                    Error::retained(
                        "unsupported-version",
                        "unknown native operation storage; retained untouched",
                    )
                })?;
            segments.push((number, name));
        }
        segments.sort();
        let mut records = HashMap::new();
        let mut files = HashMap::new();
        let mut max = 0;
        for (number, name) in segments {
            if number != max + 1 {
                return Err(Error::retained(
                    "corrupt",
                    "missing or duplicate operation segment generation",
                ));
            }
            max = number;
            let (bytes, signature) = verified_read(&root.join(&name), MAX_SEGMENT)?;
            let mut at = 0;
            while at < bytes.len() {
                if bytes.len() - at < 36 {
                    break;
                } // Incomplete prefix stays in the old segment as evidence.
                let len = u32::from_le_bytes(bytes[at..at + 4].try_into().map_err(io)?) as usize;
                if len == 0 || len > MAX_RECORD {
                    return Err(Error::retained(
                        "corrupt",
                        "invalid operation record length",
                    ));
                }
                if len > bytes.len() - at - 36 {
                    break;
                }
                let body = &bytes[at + 36..at + 36 + len];
                let digest = Sha256::digest(body);
                if digest[..] != bytes[at + 4..at + 36] {
                    return Err(Error::retained(
                        "corrupt",
                        "operation record checksum mismatch",
                    ));
                }
                let value: Value = serde_json::from_slice(body).map_err(io)?;
                if value["schema"] != "flow.image-operation" {
                    return Err(Error::retained("corrupt", "operation record schema"));
                }
                let id = value["operationId"]
                    .as_str()
                    .ok_or_else(|| Error::retained("corrupt", "operation identity"))?;
                let state = value["state"]
                    .as_str()
                    .ok_or_else(|| Error::retained("corrupt", "operation state"))?;
                let k = key(id, state)?;
                let data = value
                    .get("data")
                    .ok_or_else(|| Error::retained("corrupt", "operation data missing"))?
                    .clone();
                if records.get(&k).is_some_and(|old| old != &data) {
                    return Err(Error::retained(
                        "corrupt",
                        "immutable operation state changed",
                    ));
                }
                records.insert(k, data);
                at += 36 + len;
            }
            files.insert(name, signature);
        }
        let (current, file, signature) = create_segment(
            root,
            max.checked_add(1)
                .ok_or_else(|| Error::retained("limit", "segment generation exhausted"))?,
        )?;
        files.insert(current.clone(), signature);
        let unsettled = records
            .keys()
            .filter_map(|key| key.strip_suffix(".intent"))
            .filter(|id| {
                !["accepted", "discarded", "failed"]
                    .iter()
                    .any(|state| records.contains_key(&format!("{id}.{state}")))
            })
            .map(str::to_owned)
            .collect();
        Ok(Self {
            root: root.to_owned(),
            current,
            file,
            number: max + 1,
            length: 0,
            failed: false,
            unsettled,
            records,
            files,
        })
    }
    pub(super) fn context_unsettled(&self) -> bool {
        self.failed || !self.unsettled.is_empty()
    }
    fn verify(&self) -> Result<()> {
        for (name, signature) in &self.files {
            let file = open_plain(&self.root.join(name), false)?;
            if &stamp(&file)? != signature {
                return Err(Error::retained(
                    "corrupt",
                    "operation segment identity changed; retained untouched",
                ));
            }
        }
        Ok(())
    }
    pub fn get(&self, id: &str, state: &str) -> Result<Option<Value>> {
        self.verify()?;
        Ok(self.records.get(&key(id, state)?).cloned())
    }
    pub fn unresolved(&self) -> Result<Vec<String>> {
        self.verify()?;
        let mut ids = Vec::new();
        for k in self.records.keys() {
            if let Some(id) = k.strip_suffix(".intent") {
                if !["accepted", "discarded", "failed"]
                    .iter()
                    .any(|s| self.records.contains_key(&format!("{id}.{s}")))
                {
                    ids.push(id.into());
                }
            }
        }
        Ok(ids)
    }
    pub fn append(&mut self, id: &str, state: &str, data: &Value, remaining: u64) -> Result<u64> {
        self.verify()?;
        let k = key(id, state)?;
        if let Some(old) = self.records.get(&k) {
            if old == data {
                return Ok(0);
            }
            return Err(Error::retained(
                "conflict",
                "immutable operation receipt differs",
            ));
        }
        if self.failed {
            return Err(Error::unknown(
                "operation journal write failed; restart to retain its tail and open a fresh segment",
            ));
        }
        let encoded = serde_json::to_vec(
            &json!({"schema":"flow.image-operation","operationId":id,"state":state,"data":data}),
        )
        .map_err(io)?;
        if encoded.len() > MAX_RECORD {
            return Err(Error::retained("limit", "operation record budget"));
        }
        let len = 36 + encoded.len();
        if len as u64 > remaining {
            return Err(Error::retained(
                "limit",
                "native store quota exhausted before operation record",
            ));
        }
        if self.length + len > MAX_SEGMENT {
            let n = self
                .number
                .checked_add(1)
                .ok_or_else(|| Error::retained("limit", "journal generation exhausted"))?;
            let (name, file, signature) = create_segment(&self.root, n)?;
            self.current = name;
            self.file = file;
            self.number = n;
            self.length = 0;
            self.files.insert(self.current.clone(), signature);
        }
        let mut record = Vec::with_capacity(len);
        record.extend_from_slice(&(encoded.len() as u32).to_le_bytes());
        record.extend_from_slice(&Sha256::digest(&encoded));
        record.extend_from_slice(&encoded);
        let started = std::time::Instant::now();
        let written = self
            .file
            .write_all(&record)
            .and_then(|()| self.file.sync_all());
        // On any write error, retain the tail and refuse further appends in this process.
        // Existing, previously flushed prefix receipts remain valid; restart checks its bytes.
        self.files.insert(self.current.clone(), stamp(&self.file)?);
        if let Err(e) = written {
            self.failed = true;
            return Err(Error::unknown(format!(
                "operation journal append outcome unknown: {e}"
            )));
        }
        self.length += len;
        self.records.insert(k, data.clone());
        if state == "intent" {
            self.unsettled.insert(id.to_owned());
        } else if ["accepted", "discarded", "failed"].contains(&state) {
            self.unsettled.remove(id);
        }
        if std::env::var_os("FLOW_IMAGE_ENGINE_TRACE").is_some() {
            eprintln!(
                "flow-host-trace {}",
                json!({"phase":"journal","state":state,"bytes":len,"totalUs":started.elapsed().as_micros()})
            );
        }
        Ok(len as u64)
    }
}
fn create_segment(root: &Path, number: u64) -> Result<(String, File, FileStamp)> {
    let name = format!("segment-{number:020}.log");
    let file = OpenOptions::new()
        .write(true)
        .append(true)
        .create_new(true)
        .open(root.join(&name))
        .map_err(io)?;
    file.sync_all().map_err(io)?;
    sync_dir(root)
        .map_err(|e| Error::unknown(format!("new journal segment publication unknown: {e}")))?;
    let signature = stamp(&file)?;
    Ok((name, file, signature))
}
