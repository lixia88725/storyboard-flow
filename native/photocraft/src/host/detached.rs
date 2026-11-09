//! Narrow immutable hydration/creation jobs. One bounded CPU job; no active
//! Session, project decision, native Undo or user path crosses this module.
use super::*;
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    thread::{self, JoinHandle},
};
const MAX_JOBS: usize = 64;
const SETTLEMENT_RESERVE: u64 = 8192;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VersionIdentity {
    pub version_id: String,
    pub document_id: String,
    pub width: u32,
    pub height: u32,
}
impl VersionIdentity {
    fn validate(&self) -> Result<()> {
        if !store::is_hash(&self.version_id)
            || self
                .document_id
                .parse::<u64>()
                .ok()
                .is_none_or(|id| id.to_string() != self.document_id)
        {
            return Err(Error::none(
                "invalid-input",
                "invalid immutable version identity",
            ));
        }
        dimensions(self.width, self.height)
    }
    fn matches(&self, loaded: &store::Loaded) -> Result<()> {
        if loaded.doc.id.0.to_string() != self.document_id
            || loaded.doc.size.width != self.width
            || loaded.doc.size.height != self.height
        {
            return Err(Error::none(
                "conflict",
                "immutable version identity/geometry mismatch",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThumbnailOptions {
    pub max_edge: u32,
    pub max_bytes: usize,
}
impl ThumbnailOptions {
    fn validate(&self) -> Result<()> {
        if self.max_edge == 0
            || self.max_edge > 512
            || self.max_bytes == 0
            || self.max_bytes > 1 << 20
        {
            return Err(Error::none(
                "limit",
                "thumbnail limit is edge 1..512 and bytes 1..1MiB",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum DetachedInput {
    New {
        width: u32,
        height: u32,
    },
    Duplicate {
        source: VersionIdentity,
    },
    WorkingRefresh {
        source: Source,
        display: Option<source_guard::DisplayRef>,
        #[serde(rename = "authorizedOrigin")]
        authorized_origin: Option<working_refresh::AuthorizedOrigin>,
    },
    Source {
        source: Source,
    },
    GuardedSource {
        source: Source,
        display: Option<source_guard::DisplayRef>,
        #[serde(
            rename = "displayTolerance",
            default = "source_guard::default_tolerance"
        )]
        display_tolerance: u8,
    },
}
struct State {
    phase: String,
    result: Option<Value>,
    payload: Vec<u8>,
    finished: bool,
}
struct Job {
    control: bool,
    streamed: bool,
    fingerprint: String,
    state: Arc<Mutex<State>>,
    thread: Option<JoinHandle<()>>,
}
pub(super) struct DetachedLedger {
    jobs: HashMap<String, Job>,
    order: VecDeque<String>,
}
impl DetachedLedger {
    pub(super) fn new() -> Self {
        Self {
            jobs: HashMap::new(),
            order: VecDeque::new(),
        }
    }
    pub(super) fn reap(&mut self) {
        for job in self.jobs.values_mut() {
            if job.thread.as_ref().is_some_and(|t| t.is_finished()) {
                if let Some(t) = job.thread.take() {
                    if t.join().is_err() {
                        if let Ok(mut state) = job.state.lock() {
                            state.phase = "failed".into();
                            state.finished = true;
                            state.result = Some(
                                json!({"kind":"failed","globalFailure":true,"error":Error::unknown("immutable CPU worker panicked; query original operation before any retry")}),
                            );
                        }
                    }
                }
            }
        }
    }
    pub(super) fn has_export_result(&self) -> bool {
        self.jobs.values().any(|j| {
            j.streamed
                && j.state.lock().map_or(true, |s| {
                    !s.finished
                        || !matches!(
                            s.result.as_ref().and_then(|v| v["kind"].as_str()),
                            Some("exportReleased")
                        )
                })
        })
    }
    fn read_export(&self, id: &str, offset: usize, length: usize) -> Result<(Value, Vec<u8>)> {
        if length == 0 || length > 1 << 20 {
            return Err(Error::none("limit", "export chunk must be 1..1MiB"));
        }
        let job = self
            .jobs
            .get(id)
            .filter(|j| j.streamed)
            .ok_or_else(|| Error::none("not-found", "readonly export handle absent"))?;
        let s = job
            .state
            .lock()
            .map_err(|_| Error::unknown("readonly export owner unavailable"))?;
        if !s.finished || s.result.as_ref().is_none_or(|r| r["kind"] != "exported") {
            return Err(Error::none("busy", "export not ready for bounded read"));
        }
        let end = offset
            .checked_add(length)
            .filter(|e| *e <= s.payload.len())
            .ok_or_else(|| Error::none("invalid-input", "export chunk outside result"))?;
        Ok((
            json!({"kind":"exportChunk","jobId":id,"offset":offset,"length":length,"byteLength":s.payload.len()}),
            s.payload[offset..end].to_vec(),
        ))
    }
    fn release_export(&mut self, id: &str) -> Result<(Value, Vec<u8>)> {
        let job = self
            .jobs
            .get_mut(id)
            .filter(|j| j.streamed)
            .ok_or_else(|| Error::none("not-found", "readonly export handle absent"))?;
        let mut s = job
            .state
            .lock()
            .map_err(|_| Error::unknown("readonly export owner unavailable"))?;
        if !s.finished {
            return Err(Error::none(
                "busy",
                "export is in flight; drain before release",
            ));
        }
        s.payload.clear();
        s.payload.shrink_to_fit();
        s.result = Some(json!({"kind":"exportReleased","jobId":id}));
        s.phase = "exportReleased".into();
        Ok((json!({"kind":"exportReleased","jobId":id}), vec![]))
    }
    pub(super) fn has_inflight(&self) -> bool {
        self.jobs
            .values()
            .any(|j| j.state.lock().map_or(true, |s| !s.finished))
    }
    pub(super) fn activity(&self, proxy: &StoreProxy) -> Value {
        let mut active = 0;
        let mut prepared = 0;
        let mut waiting = 0;
        for job in self.jobs.values() {
            if let Ok(s) = job.state.lock() {
                if !s.finished {
                    active += 1;
                }
                if s.phase == "prepared" {
                    prepared += 1;
                }
                if s.phase == "waitingForIdleIo" {
                    waiting += 1;
                }
            }
        }
        json!({"activeJobs":active,"preparedCandidates":prepared,"durableUnsettled":proxy.detached_unsettled(),"waitingForIdleIo":waiting,"ioActive":proxy.background_io_active(),"inputBusy":proxy.input_busy()})
    }
    fn capacity(&mut self) -> Result<()> {
        while self.jobs.len() >= MAX_JOBS {
            let Some(index) = self.order.iter().position(|id| {
                self.jobs.get(id).is_some_and(|j| {
                    j.state.lock().is_ok_and(|s| {
                        s.finished
                            && (!j.streamed
                                || s.result
                                    .as_ref()
                                    .is_some_and(|r| r["kind"] == "exportReleased"))
                            && s.result.as_ref().is_some_and(|r| {
                                matches!(
                                    r["kind"].as_str(),
                                    Some(
                                        "accepted"
                                            | "discarded"
                                            | "failed"
                                            | "inspected"
                                            | "exportReleased"
                                    )
                                )
                            })
                    })
                })
            }) else {
                return Err(Error::none(
                    "backpressure",
                    "64 detached candidates retained; settle before admitting more",
                ));
            };
            if let Some(id) = self.order.remove(index) {
                self.jobs.remove(&id);
            }
        }
        Ok(())
    }
    fn poll(&self, id: &str) -> Result<(Value, Vec<u8>)> {
        let job = self.jobs.get(id).ok_or_else(|| {
            Error::none(
                "not-found",
                "volatile job missing; query durable operation status",
            )
        })?;
        let s = job
            .state
            .lock()
            .map_err(|_| Error::unknown("background result owner unavailable"))?;
        Ok((
            json!({"kind":"detachedState","jobId":id,"phase":s.phase,"finished":s.finished,"result":s.result}),
            if job.streamed {
                vec![]
            } else {
                s.payload.clone()
            },
        ))
    }
    fn begin(
        &mut self,
        id: &str,
        fingerprint: String,
        control: bool,
        work: impl FnOnce(Arc<Mutex<State>>) -> Result<(Value, Vec<u8>)> + Send + 'static,
    ) -> Result<(Value, Vec<u8>)> {
        if let Some(j) = self.jobs.get(id) {
            if j.fingerprint != fingerprint {
                return Err(Error::none(
                    "conflict",
                    "detached job ID reused with different input",
                ));
            }
            return self.poll(id);
        }
        let active_controls = self
            .jobs
            .values()
            .filter(|j| j.control && j.state.lock().map_or(true, |s| !s.finished))
            .count();
        let active_cpu = self
            .jobs
            .values()
            .any(|j| !j.control && j.state.lock().map_or(true, |s| !s.finished));
        if (!control && active_cpu) || (control && active_controls >= 4) {
            return Err(Error::none(
                "backpressure",
                "immutable CPU/control job budget is full",
            ));
        }
        self.capacity()?;
        let state = Arc::new(Mutex::new(State {
            phase: "queued".into(),
            result: None,
            payload: vec![],
            finished: false,
        }));
        let worker = state.clone();
        let handle = thread::spawn(move || {
            let result = work(worker.clone());
            if let Ok(mut s) = worker.lock() {
                match result {
                    Ok((body, payload)) => {
                        s.phase = body["kind"].as_str().unwrap_or("failed").into();
                        s.result = Some(body);
                        s.payload = payload;
                    }
                    Err(error) => {
                        s.phase = "failed".into();
                        s.result =
                            Some(json!({"kind":"failed","globalFailure":true,"error":error}));
                    }
                }
                s.finished = true;
            }
        });
        self.jobs.insert(
            id.into(),
            Job {
                control,
                streamed: false,
                fingerprint,
                state,
                thread: Some(handle),
            },
        );
        self.order.push_back(id.into());
        Ok((
            json!({"kind":"detachedQueued","jobId":id,"durable":false}),
            vec![],
        ))
    }
}
fn progress(state: &Arc<Mutex<State>>, phase: &str) {
    if let Ok(mut s) = state.lock() {
        s.phase = phase.into();
    }
}
pub(super) fn is_command(command: &Command) -> bool {
    matches!(
        command,
        Command::ListDetached { .. }
            | Command::DetachedPrepare { .. }
            | Command::InspectVersion { .. }
            | Command::ExportImmutable { .. }
            | Command::ReadExport { .. }
            | Command::ReleaseExport { .. }
            | Command::DetachedPoll { .. }
            | Command::DetachedStatus { .. }
            | Command::SettleDetached { .. }
            | Command::DiscardDetached { .. }
    )
}
fn idle_cpu(proxy: &StoreProxy, state: &Arc<Mutex<State>>) {
    while proxy.input_busy() {
        progress(state, "waitingForIdleCpu");
        thread::sleep(std::time::Duration::from_millis(2));
    }
}
pub(super) fn preflight_source(source: &Source, payload: &[u8]) -> Result<()> {
    if source.display_policy.is_some()
        || source.protected_base_manifest_sha256.is_some()
        || source.working_input.is_some()
    {
        return Err(Error::none(
            "invalid-input",
            "source display policy is native-derived, never caller supplied",
        ));
    }
    if source
        .interpretation_id
        .as_deref()
        .is_some_and(|v| v != "photocraft-v1" && v != "flow-v1-upgrade")
    {
        return Err(Error::none(
            "unsupported",
            "source interpretation is not supported by this native capability",
        ));
    }
    if payload.len() > wire::MAX_SOURCE
        || source.byte_length != payload.len() as u64
        || !store::is_hash(&source.digest)
        || sha(payload) != source.digest
    {
        return Err(Error::none(
            "invalid-input",
            "retained input identity or 32MiB source admission mismatch",
        ));
    }
    if !["png", "tiff", "psd", "jpeg"].contains(&source.format_hint.as_str()) {
        return Err(Error::none("unsupported", "immutable source format hint"));
    }
    if source.format_hint == "jpeg"
        || photocraft_codecs::detect(payload) == Some(photocraft_codecs::Format::Jpeg)
    {
        jpeg_admission::validate(payload)?;
    }
    Ok(())
}
pub(super) fn decode_source(source: &Source, payload: &[u8]) -> Result<Document> {
    preflight_source(source, payload)?;
    let options = photocraft_io::ImportOptions {
        psd_max_pixel_bytes: 512 << 20,
        flat_max_pixel_bytes: 64 << 20,
        ..Default::default()
    };
    let (import, damaged) = photocraft_io::import_for_open(
        &format!("retained.{}", source.format_hint),
        payload,
        &options,
    )
    .map_err(native)?;
    if damaged || import.preview_only || !import.warnings.is_empty() {
        return Err(Error::none(
            "unsupported",
            "source is damaged, preview-only or reports compatibility warnings",
        ));
    }
    let mut doc = import.document;
    dimensions(doc.size.width, doc.size.height)?;
    if doc.mode != ColorMode::Rgb
        || doc.depth != SampleType::U8
        || doc
            .walk()
            .iter()
            .any(|(_, _, l)| !matches!(l.content, LayerContent::Raster(_) | LayerContent::Group(_)))
    {
        return Err(Error::none(
            "unsupported",
            "immutable hydration admits RGB8 raster/group documents only",
        ));
    }
    source_guard::rgb_transform(doc.icc_profile.as_ref().map(|p| p.as_slice()))?;
    if source.interpretation_id.as_deref() == Some("flow-v1-upgrade") {
        if source.format_hint != "tiff" {
            return Err(Error::none(
                "unsupported-source-interpretation",
                "V1 upgrade is a TIFF-only interpretation",
            ));
        }
        source_metadata::restore_v1(&mut doc, payload)?;
    }
    Ok(doc)
}
pub(super) fn initial_target(doc: &Document) -> Result<LayerTarget> {
    let mut scratch = Session::new();
    scratch.add_document(doc.clone(), None);
    let s = scratch
        .active()
        .ok_or_else(|| Error::none("unsupported", "source has no native document"))?;
    Ok(LayerTarget {
        active: s.active_layer,
        selected: s.selected_layers.clone(),
    })
}
fn summary(doc: &Document, target: &LayerTarget, version: &str) -> Result<Value> {
    let layers = context::bounded_layer_tree(doc, 48 << 10)?;
    let value = json!({"versionId":version,"documentId":doc.id.0.to_string(),"width":doc.size.width,"height":doc.size.height,"layers":layers,"layerCount":doc.layer_count(),"activeLayerId":target.active.map(|id|id.0.to_string()),"selectedLayerIds":target.selected.iter().map(|id|id.0.to_string()).collect::<Vec<_>>(),"sourceSelectionPresent":doc.selection.is_some(),"paintScope":if doc.selection.is_some(){"source-selection-refused"}else{"full-layer"}});
    if serde_json::to_vec(&value).map_err(native)?.len() > 48 << 10 {
        return Err(Error::none("limit", "immutable summary exceeds 48KiB"));
    }
    Ok(value)
}
fn thumbnail(doc: &Document, options: &ThumbnailOptions) -> Result<(Value, Vec<u8>)> {
    options.validate()?;
    let raw = render_srgb(doc, doc.bounds())?;
    let (w, h) = (doc.size.width, doc.size.height);
    let scale = (options.max_edge as f64 / w.max(h) as f64).min(1.0);
    let (tw, th) = (
        ((w as f64 * scale).round() as u32).max(1),
        ((h as f64 * scale).round() as u32).max(1),
    );
    let mut small = vec![0u8; tw as usize * th as usize * 4];
    for y in 0..th {
        for x in 0..tw {
            let sx = (u64::from(x) * u64::from(w) / u64::from(tw)) as usize;
            let sy = (u64::from(y) * u64::from(h) / u64::from(th)) as usize;
            let source = (sy * w as usize + sx) * 4;
            let dest = (y as usize * tw as usize + x as usize) * 4;
            small[dest..dest + 4].copy_from_slice(&raw[source..source + 4]);
        }
    }
    let image =
        photocraft_codecs::Image::from_u8(tw, th, photocraft_codecs::ChannelLayout::Rgba, small)
            .map_err(native)?;
    let bytes =
        photocraft_codecs::encode(&image, photocraft_codecs::Format::Png, &Default::default())
            .map_err(native)?;
    if bytes.len() > options.max_bytes {
        return Err(Error::none(
            "limit",
            "encoded thumbnail exceeds explicit byte budget",
        ));
    }
    Ok((
        json!({"format":"png","width":tw,"height":th,"byteLength":bytes.len(),"sha256":sha(&bytes)}),
        bytes,
    ))
}
// Read-only presentation/encoding failures have no publication to reconcile.
// Keep storage, protocol and unknown failures global even when reported as none.
fn readonly_result(result: Result<(Value, Vec<u8>)>) -> Result<(Value, Vec<u8>)> {
    match result {
        Err(error) if error.effect == "none"
            && matches!(error.code.as_str(), "limit" | "unsupported" | "engine") =>
        {
            Ok((json!({"kind":"failed","globalFailure":false,"error":error}), vec![]))
        }
        other => other,
    }
}

fn read_result(store: &Store, id: &str) -> Result<Option<Value>> {
    for state in ["accepted", "discarded", "prepared", "failed"] {
        if let Some(value) = store.op_read(id, state)? {
            return Ok(Some(value));
        }
    }
    Ok(None)
}
fn native_failure(
    proxy: &StoreProxy,
    id: &str,
    mut error: Error,
    remaining: u64,
) -> Result<(Value, Vec<u8>)> {
    error.message = error.message.chars().take(2048).collect();
    let global = matches!(
        error.code.as_str(),
        "journal" | "storage" | "corrupt" | "unsafe-path" | "unknown-result"
    );
    let body = json!({"kind":"failed","detached":true,"candidateId":id,"globalFailure":global,"error":error});
    let (op, value) = (id.to_owned(), body.clone());
    if let Err(journal) =
        proxy.call_budgeted(false, remaining, move |s| s.op_write(&op, "failed", &value))
    {
        return Ok((
            json!({"kind":"failed","detached":true,"candidateId":id,"globalFailure":true,"error":journal}),
            vec![],
        ));
    }
    Ok((body, vec![]))
}
fn prepare(
    proxy: StoreProxy,
    r: Request,
    input: DetachedInput,
    payload: Vec<u8>,
    maximum: u64,
    fingerprint: String,
    state: Arc<Mutex<State>>,
) -> Result<(Value, Vec<u8>)> {
    let id = r.operation_id.clone();
    progress(&state, "checkingDurableOperation");
    let op = id.clone();
    let fp = fingerprint.clone();
    let prior = proxy.call(false, move |s| {
        if let Some(intent) = s.op_read(&op, "intent")? {
            if intent["fingerprint"] != fp {
                return Err(Error::none(
                    "conflict",
                    "operation id reused with different immutable input",
                ));
            }
            return read_result(s, &op)?.map(Some).ok_or_else(|| {
                Error::unknown("prior immutable intent has no durable result; do not replay")
            });
        }
        Ok(None)
    })?;
    if let Some(result) = prior {
        return finish_existing(&proxy, result, &state);
    }
    let request = r.body.clone();
    let op = id.clone();
    let fp = fingerprint;
    let (_, intent_bytes) = proxy.call_budgeted(false, maximum - SETTLEMENT_RESERVE, move |s| {
        s.op_write(
            &op,
            "intent",
            &json!({"fingerprint":fp,"baseVersion":null,"request":request}),
        )
    })?;
    idle_cpu(&proxy, &state);
    progress(&state, "decoding");
    let mut display_proof = None;
    let mut classification = None;
    let decoded = (|| -> Result<(Document, LayerTarget, Option<Source>)> {
        match input {
            DetachedInput::New { width, height } => {
                let mut doc = Document::new(
                    "Flow",
                    Size::new(width, height),
                    ColorMode::Rgb,
                    SampleType::U8,
                );
                doc.layers
                    .push(Layer::raster("Drawing", doc.pixel_format()));
                // Product New keeps the established editable white canvas. The
                // synthetic Stage-A New command remains transparent independently.
                let mut scratch = Session::new();
                scratch.add_document(doc, None);
                scratch
                    .execute("edit.fill", json!({"color":"#ffffff","target":"pixels"}))
                    .map_err(native)?;
                let doc = (*scratch
                    .active()
                    .ok_or_else(|| Error::none("engine", "new canvas context missing"))?
                    .doc)
                    .clone();
                let target = initial_target(&doc)?;
                Ok((doc, target, None))
            }
            DetachedInput::GuardedSource {
                source,
                display,
                display_tolerance,
            } => {
                let (doc, target, source, proof, kind) =
                    source_guard::prepare(source, display.as_ref(), &payload, display_tolerance)?;
                display_proof = Some(proof);
                classification = Some(kind);
                Ok((doc, target, Some(source)))
            }
            DetachedInput::WorkingRefresh {
                source,
                display,
                authorized_origin,
            } => if let Some(authorized) = authorized_origin {
                progress(&state, "waitingForIdleIo");
                let identity = authorized.version.clone();
                let loaded = proxy.call(true, move |s| {
                    let old = s.load(&identity.version_id)?;
                    identity.matches(&old)?;
                    Ok(old)
                })?;
                idle_cpu(&proxy, &state);
                progress(&state, "validatingProtectedWorkingBase");
                working_refresh::prepare(
                    source,
                    &payload,
                    display.as_ref().ok_or_else(|| {
                        Error::none(
                            "independent-display-required",
                            "working TIFF requires Main display",
                        )
                    })?,
                    loaded,
                    &authorized,
                )
            } else {
                let identity = working_refresh::WorkingInput {
                    digest: source.digest.clone(),
                    byte_length: source.byte_length,
                    format: "tiff".into(),
                };
                let (doc, target, mut source, proof, kind) =
                    source_guard::prepare(source, display.as_ref(), &payload, 8)?;
                source.working_input = Some(identity);
                display_proof = Some(proof);
                classification = Some(kind);
                Ok((doc, target, source))
            }
            .map(|(doc, target, source)| (doc, target, Some(source))),
            DetachedInput::Source { source } => {
                let doc = decode_source(&source, &payload)?;
                let target = initial_target(&doc)?;
                Ok((doc, target, Some(source)))
            }
            DetachedInput::Duplicate { source } => {
                progress(&state, "waitingForIdleIo");
                let loaded = proxy.call(true, move |s| {
                    let loaded = s.load(&source.version_id)?;
                    source.matches(&loaded)?;
                    Ok(loaded)
                })?;
                progress(&state, "cloningImmutableDocument");
                let mut doc = (*loaded.doc).clone();
                doc.id = photocraft_doc::DocId::fresh();
                Ok((doc, loaded.target, loaded.source))
            }
        }
    })();
    let (doc, target, source) = match decoded {
        Ok(v) => v,
        Err(e) => return native_failure(&proxy, &id, e, maximum.saturating_sub(intent_bytes)),
    };
    idle_cpu(&proxy, &state);
    let prepared_views = (|| {
        let mut view = summary(&doc, &target, "")?;
        progress(&state, "renderingThumbnail");
        let (meta, bytes) = thumbnail(
            &doc,
            &ThumbnailOptions {
                max_edge: 256,
                max_bytes: 1 << 20,
            },
        )?;
        view["thumbnail"] = meta;
        view["sourceDisplayPolicy"] =
            json!(source.as_ref().and_then(|s| s.display_policy.as_ref()));
        Ok::<_, Error>((view, bytes))
    })();
    let (mut view, bytes) = match prepared_views {
        Ok(v) => v,
        Err(e) => return native_failure(&proxy, &id, e, maximum.saturating_sub(intent_bytes)),
    };
    progress(&state, "waitingForIdleIo");
    let publishing_state = state.clone();
    let op = id.clone();
    let result=proxy.call_budgeted(true,maximum.saturating_sub(intent_bytes).saturating_sub(SETTLEMENT_RESERVE),move|s|{
        progress(&publishing_state,"persistingImmutableVersion");let before=s.retained_bytes();
        let receipt=s.save(&doc,&target,source)?;let before_prepared=intent_bytes+s.retained_bytes().saturating_sub(before);
        let mut prepared=json!({"kind":"prepared","detached":true,"candidateId":op,"baseVersion":null,"receipt":receipt,"reservation":{"maxAdditionalBytes":maximum,"spentBeforePrepared":before_prepared}});
        if let Some(proof)=display_proof {prepared["sourceDisplayProof"]=proof;prepared["classification"]=json!(classification);}
        let cost=journal::Journal::record_bytes(&op,"prepared",&prepared)?;
        if before_prepared.saturating_add(cost).saturating_add(SETTLEMENT_RESERVE)>maximum{return Err(Error::retained("limit","immutable candidate must retain reserved settlement space"));}
        s.op_write(&op,"prepared",&prepared)?;Ok(prepared)
    });
    let (result, _spent) = match result {
        Ok(v) => v,
        Err(e) => return native_failure(&proxy, &id, e, SETTLEMENT_RESERVE),
    };
    view["versionId"] = result["receipt"]["versionId"].clone();
    let mut result = result;
    result["summary"] = view;
    Ok((result, bytes))
}
fn finish_existing(
    proxy: &StoreProxy,
    mut result: Value,
    state: &Arc<Mutex<State>>,
) -> Result<(Value, Vec<u8>)> {
    if result["detached"] != true {
        return Err(Error::none(
            "conflict",
            "operation belongs to ordinary image editing",
        ));
    }
    if result["kind"] != "prepared" && result["kind"] != "accepted" {
        return Ok((result, vec![]));
    }
    let version = result["receipt"]["versionId"]
        .as_str()
        .ok_or_else(|| Error::retained("corrupt", "immutable receipt missing version"))?
        .to_owned();
    progress(state, "waitingForIdleIo");
    let loaded = proxy.call(true, move |s| s.load(&version))?;
    let mut view = summary(
        &loaded.doc,
        &loaded.target,
        result["receipt"]["versionId"].as_str().unwrap_or_default(),
    )?;
    idle_cpu(proxy, state);
    progress(state, "renderingThumbnail");
    let (meta, bytes) = thumbnail(
        &loaded.doc,
        &ThumbnailOptions {
            max_edge: 256,
            max_bytes: 1 << 20,
        },
    )?;
    view["thumbnail"] = meta;
    view["sourceDisplayPolicy"] = json!(
        loaded
            .source
            .as_ref()
            .and_then(|s| s.display_policy.as_ref())
    );
    result["summary"] = view;
    Ok((result, bytes))
}
fn settle(
    proxy: StoreProxy,
    id: String,
    version: Option<String>,
    discard: bool,
) -> Result<(Value, Vec<u8>)> {
    let result=proxy.call(false,move|s|{
        if let Some(done)=s.op_read(&id,if discard{"discarded"}else{"accepted"})?{if done["detached"]!=true||version.as_ref().is_some_and(|v|done["receipt"]["versionId"]!=*v){return Err(Error::none("conflict","settled immutable version/purpose mismatch"));}return Ok(done);}
        if s.op_read(&id,if discard{"accepted"}else{"discarded"})?.is_some(){return Err(Error::none("conflict","immutable candidate has opposite settled decision"));}
        let Some(prepared)=s.op_read(&id,"prepared")? else {
            if !discard{return Err(Error::unknown("immutable candidate is not prepared"));}
            let intent=s.op_read(&id,"intent")?.ok_or_else(||Error::none("not-found","immutable operation absent"))?;
            if intent["request"]["kind"]!="detachedPrepare"{return Err(Error::none("conflict","operation is not an immutable creation"));}
            let result=json!({"kind":"discarded","detached":true,"candidateId":id,"retainedEvidence":true});
            s.budgeted(SETTLEMENT_RESERVE,|s|s.op_write(&id,"discarded",&result))?;return Ok(result);
        };
        if prepared["detached"]!=true||version.as_ref().is_some_and(|v|prepared["receipt"]["versionId"]!=*v){return Err(Error::none("conflict","detached settlement identity mismatch"));}
        let maximum=prepared["reservation"]["maxAdditionalBytes"].as_u64().ok_or_else(||Error::retained("corrupt","candidate reservation missing"))?;
        let spent=prepared["reservation"]["spentBeforePrepared"].as_u64().ok_or_else(||Error::retained("corrupt","candidate expenditure missing"))?+journal::Journal::record_bytes(&id,"prepared",&prepared)?;
        let mut result=if discard{json!({"kind":"discarded","detached":true,"candidateId":id})}else{json!({"kind":"accepted","detached":true,"candidateId":id,"receipt":prepared["receipt"]})};
        if !discard && prepared.get("sourceDisplayProof").is_some(){result["sourceDisplayProof"]=prepared["sourceDisplayProof"].clone();result["classification"]=prepared["classification"].clone();}
        s.budgeted(maximum.saturating_sub(spent),|s|s.op_write(&id,if discard{"discarded"}else{"accepted"},&result))?;Ok(result)
    })?;
    Ok((result, vec![]))
}
impl Host {
    pub(super) fn detached_command(
        &mut self,
        r: &Request,
        payload: &[u8],
    ) -> Result<(Value, Vec<u8>)> {
        if !matches!(
            r.body,
            Command::DetachedPrepare {
                input: DetachedInput::Source { .. },
                ..
            } | Command::DetachedPrepare {
                input: DetachedInput::GuardedSource { .. },
                ..
            } | Command::DetachedPrepare {
                input: DetachedInput::WorkingRefresh { .. },
                ..
            }
        ) && !matches!(r.body, Command::ExportImmutable { .. })
            && !payload.is_empty()
        {
            return Err(Error::none(
                "invalid-input",
                "unexpected immutable job payload",
            ));
        }
        match &r.body {
            Command::ReadExport {
                job_id,
                offset,
                length,
            } => {
                valid_id(job_id)?;
                self.detached.read_export(job_id, *offset, *length)
            }
            Command::ReleaseExport { job_id } => {
                valid_id(job_id)?;
                self.detached.release_export(job_id)
            }
            Command::ExportImmutable {
                source,
                format,
                max_bytes,
                metadata,
                expected_source_policy,
            } => {
                source.validate()?;
                if *max_bytes == 0 || *max_bytes > wire::MAX_PAYLOAD {
                    return Err(Error::none("limit", "export budget must be 1..64MiB"));
                }
                output_metadata::validate(payload, metadata)?;
                if !self.detached.jobs.contains_key(&r.operation_id)
                    && self.detached.has_export_result()
                {
                    return Err(Error::none(
                        "backpressure",
                        "drain/release the existing bounded output before another export",
                    ));
                }
                let (proxy, source, format, max, metadata, expected, bytes) = (
                    self.store.proxy(),
                    source.clone(),
                    format.clone(),
                    *max_bytes,
                    metadata.clone(),
                    expected_source_policy.clone(),
                    payload.to_vec(),
                );
                self.store.shared.set_background(true);
                let result = self.detached.begin(
                    &r.operation_id,
                    self.fingerprint(r)?,
                    false,
                    move |state| readonly_result((|| {
                        progress(&state, "waitingForIdleIo");
                        let identity = source.clone();
                        let loaded = proxy.call(true, move |s| {
                            let l = s.load(&identity.version_id)?;
                            identity.matches(&l)?;
                            Ok(l)
                        })?;
                        idle_cpu(&proxy, &state);
                        progress(&state, "encodingImmutableVersion");
                        output::immutable(
                            &source.version_id,
                            loaded,
                            &format,
                            max,
                            &metadata,
                            expected.as_ref(),
                            &bytes,
                        )
                    })()),
                )?;
                if let Some(j) = self.detached.jobs.get_mut(&r.operation_id) {
                    j.streamed = true;
                }
                Ok(result)
            }
            Command::ListDetached {
                cursor,
                limit,
                snapshot_token,
            } => {
                if self.store.shared.input_busy() || self.pipeline.is_some() {
                    return Err(Error::none(
                        "busy",
                        "recovery enumeration requires an idle stopped input pipeline",
                    ));
                }
                if let Some(cursor) = cursor {
                    valid_id(cursor)?;
                }
                let (cursor, limit, token) = (cursor.clone(), *limit, snapshot_token.clone());
                let value = self
                    .store
                    .proxy()
                    .call(false, move |s| s.list_detached(cursor, limit, token))?;
                Ok((value, vec![]))
            }
            Command::DetachedPoll { job_id } => {
                valid_id(job_id)?;
                self.detached.poll(job_id)
            }
            Command::DetachedStatus {
                target_operation_id,
            } => {
                valid_id(target_operation_id)?;
                if let Some(job) = self.detached.jobs.get(target_operation_id) {
                    let state = job
                        .state
                        .lock()
                        .map_err(|_| Error::unknown("job result owner unavailable"))?;
                    if !state.finished {
                        return Ok((
                            json!({"kind":"detachedStatus","state":"pending","phase":state.phase}),
                            vec![],
                        ));
                    }
                    if let Some(result) = &state.result {
                        if result["detached"] == true
                            && result["globalFailure"] != true
                            && matches!(
                                result["kind"].as_str(),
                                Some("prepared" | "accepted" | "discarded" | "failed")
                            )
                        {
                            return Ok((
                                json!({"kind":"detachedStatus","state":result["kind"],"result":result}),
                                vec![],
                            ));
                        }
                    }
                }
                if self.store.shared.input_busy() {
                    return Err(Error::none(
                        "needs-idle-query",
                        "historical immutable status requires idle input; no absent result inferred",
                    ));
                }
                let op = target_operation_id.clone();
                let result=self.store.proxy().call(false,move|s|{let intent=s.op_read(&op,"intent")?;if intent.as_ref().is_some_and(|v|v["request"]["kind"]!="detachedPrepare"){return Err(Error::none("conflict","operation is not an immutable creation"));}if let Some(v)=read_result(s,&op)?{return Ok(json!({"kind":"detachedStatus","state":v["kind"],"result":v}));}Ok(json!({"kind":"detachedStatus","state":if intent.is_some(){"intent"}else{"absent"}}))})?;
                Ok((result, vec![]))
            }
            Command::DetachedPrepare {
                input,
                max_additional_bytes,
            } => {
                if self.frozen {
                    return Err(Error::none(
                        "frozen",
                        "cannot begin immutable creation on frozen host",
                    ));
                }
                if *max_additional_bytes < 16384 || *max_additional_bytes > 8u64 << 30 {
                    return Err(Error::none("limit", "Main reservation must be 16KiB..8GiB"));
                }
                match input {
                    DetachedInput::New { width, height } => dimensions(*width, *height)?,
                    DetachedInput::Duplicate { source } => source.validate()?,
                    DetachedInput::Source { source } => preflight_source(source, payload)?,
                    DetachedInput::WorkingRefresh {
                        source,
                        display,
                        authorized_origin,
                    } => {
                        if source.format_hint != "tiff" {
                            return Err(Error::none(
                                "invalid-input",
                                "working refresh accepts TIFF only",
                            ));
                        }
                        source_guard::preflight(source, display.as_ref(), payload)?;
                        if let Some(origin) = authorized_origin {
                            origin.version.validate()?;
                        }
                    }
                    DetachedInput::GuardedSource {
                        source,
                        display,
                        display_tolerance,
                    } => {
                        if *display_tolerance > 16 {
                            return Err(Error::none(
                                "invalid-input",
                                "display tolerance must be 0..16",
                            ));
                        }
                        source_guard::preflight(source, display.as_ref(), payload)?
                    }
                };
                // A completed settle uses the candidate ID for its control
                // receipt. Re-enter through the durable original fingerprint;
                // never mistake the control-cache fingerprint for new input.
                if let Some(job) = self.detached.jobs.get(&r.operation_id) {
                    if job.control {
                        if job.state.lock().map_or(true, |s| !s.finished) {
                            return Err(Error::none(
                                "busy",
                                "immutable settlement still in flight; query status",
                            ));
                        }
                        self.detached.jobs.remove(&r.operation_id);
                        self.detached.order.retain(|id| id != &r.operation_id);
                    }
                }
                let (proxy, request, input, bytes, maximum, fingerprint) = (
                    self.store.proxy(),
                    r.clone(),
                    input.clone(),
                    payload.to_vec(),
                    *max_additional_bytes,
                    self.fingerprint(r)?,
                );
                self.store.shared.set_background(true);
                self.detached
                    .begin(&r.operation_id, fingerprint.clone(), false, move |state| {
                        prepare(proxy, request, input, bytes, maximum, fingerprint, state)
                    })
            }
            Command::InspectVersion {
                source,
                thumbnail: options,
            } => {
                source.validate()?;
                options.validate()?;
                let (proxy, source, options) =
                    (self.store.proxy(), source.clone(), options.clone());
                self.store.shared.set_background(true);
                self.detached
                    .begin(&r.operation_id, self.fingerprint(r)?, false, move |state| readonly_result((|| {
                        progress(&state, "waitingForIdleIo");
                        let source_copy = source.clone();
                        let loaded = proxy.call(true, move |s| {
                            let loaded = s.load(&source_copy.version_id)?;
                            source_copy.matches(&loaded)?;
                            Ok(loaded)
                        })?;
                        let mut view = summary(&loaded.doc, &loaded.target, &source.version_id)?;
                        progress(&state, "renderingThumbnail");
                        let (meta, bytes) = thumbnail(&loaded.doc, &options)?;
                        view["thumbnail"] = meta;
                        view["sourceDisplayPolicy"] = json!(
                            loaded
                                .source
                                .as_ref()
                                .and_then(|s| s.display_policy.as_ref())
                        );
                        Ok((json!({"kind":"inspected","summary":view}), bytes))
                    })()))
            }
            Command::SettleDetached {
                candidate_id,
                version_id,
            } => {
                valid_id(candidate_id)?;
                if !store::is_hash(version_id) {
                    return Err(Error::none("invalid-input", "candidate version hash"));
                }
                if let Some(job) = self.detached.jobs.get(candidate_id) {
                    if job.state.lock().map_or(true, |s| !s.finished) {
                        if job.fingerprint == format!("accept-{version_id}") {
                            return self.detached.poll(candidate_id);
                        }
                        return Err(Error::none(
                            "busy",
                            "target immutable operation is still in flight",
                        ));
                    }
                }
                let proxy = self.store.proxy();
                let id = candidate_id.clone();
                let version = version_id.clone();
                self.detached.jobs.remove(candidate_id);
                self.detached.order.retain(|v| v != candidate_id);
                self.detached.begin(
                    candidate_id,
                    format!("accept-{version_id}"),
                    true,
                    move |_| settle(proxy, id, Some(version), false),
                )
            }
            Command::DiscardDetached { candidate_id } => {
                valid_id(candidate_id)?;
                if let Some(job) = self.detached.jobs.get(candidate_id) {
                    if job.state.lock().map_or(true, |s| !s.finished) {
                        if job.fingerprint == "discard" {
                            return self.detached.poll(candidate_id);
                        }
                        return Err(Error::none(
                            "busy",
                            "target immutable operation is still in flight",
                        ));
                    }
                }
                let proxy = self.store.proxy();
                let id = candidate_id.clone();
                self.detached.jobs.remove(candidate_id);
                self.detached.order.retain(|v| v != candidate_id);
                self.detached
                    .begin(candidate_id, "discard".into(), true, move |_| {
                        settle(proxy, id, None, true)
                    })
            }
            _ => Err(Error::none("internal", "not an immutable job command")),
        }
    }
}

#[cfg(test)]
mod failure_scope_tests {
    use super::*;
    #[test]
    fn readonly_refusals_do_not_block_editing_but_unknown_and_integrity_errors_do() {
        for code in ["limit", "unsupported", "engine"] {
            let (body, _) = readonly_result(Err(Error::none(code, "synthetic refusal"))).unwrap();
            assert_eq!(body["globalFailure"], false);
            assert_eq!(body["error"]["effect"], "none");
            assert!(readonly_result(Err(Error::retained(code, "retained"))).is_err());
        }
        for code in ["storage", "corrupt", "journal", "unsafe-path", "protocol"] {
            assert!(readonly_result(Err(Error::none(code, "integrity failure"))).is_err());
        }
        assert!(readonly_result(Err(Error::unknown("unknown result"))).is_err());
    }
}
