//! Stage A native host. One mutable engine context; Flow alone decides global user history.
//! Host-pinned immutable versions survive process restarts; native History is scratch only.
mod context;
mod journal;
pub use context::{FloatingAction, LayerIdInput};
mod output;
pub use output::OutputFormat;
mod pipeline;
pub mod store;
pub mod wire;
use photocraft_color::{ColorMode, SampleType};
use photocraft_doc::{Document, Layer, LayerContent};
use photocraft_engine::{Session, brush_cmds::LiveStroke, hosted::Checkpoint};
use photocraft_geom::{Rect, Size};
use photocraft_ops::LayerTarget;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc};
use store::{Store, VersionReceipt, sha};

pub type Result<T> = std::result::Result<T, Error>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub code: String,
    pub message: String,
    pub effect: String,
}
impl Error {
    pub fn none(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            effect: "none".into(),
        }
    }
    pub fn retained(code: &str, message: impl Into<String>) -> Self {
        Self {
            effect: "retained".into(),
            ..Self::none(code, message)
        }
    }
    pub fn unknown(message: impl Into<String>) -> Self {
        Self {
            effect: "unknown".into(),
            ..Self::none("unknown-result", message)
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {} ({})", self.code, self.message, self.effect)
    }
}
impl std::error::Error for Error {}
fn native(e: impl std::fmt::Display) -> Error {
    Error::none("engine", e.to_string())
}
pub fn valid_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err(Error::none("invalid-input", "invalid identity"));
    }
    Ok(())
}
pub fn dimensions(w: u32, h: u32) -> Result<()> {
    if w == 0 || h == 0 || w > 8192 || h > 8192 || u64::from(w) * u64::from(h) > 16 << 20 {
        return Err(Error::none("limit", "canvas limit"));
    }
    Ok(())
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub digest: String,
    pub byte_length: u64,
    pub format_hint: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub protocol: u32,
    pub request_id: String,
    pub session_id: String,
    pub incarnation: String,
    pub worker_epoch: u64,
    pub operation_id: String,
    #[serde(default)]
    pub base_version: Option<String>,
    pub body: Command,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Summary {
        #[serde(rename = "maxBytes")]
        max_bytes: usize,
    },
    SelectLayerContext {
        #[serde(rename = "layerId")]
        layer_id: LayerIdInput,
        #[serde(rename = "expectedContextGeneration")]
        expected_context_generation: u64,
    },
    Floating {
        #[serde(rename = "previewId")]
        preview_id: String,
        #[serde(rename = "expectedContextGeneration")]
        expected_context_generation: u64,
        action: FloatingAction,
    },
    New {
        width: u32,
        height: u32,
    },
    Open {
        source: Source,
    },
    Load {
        #[serde(rename = "versionId")]
        version_id: String,
    },
    Edit {
        edit: ImageEdit,
    },
    PipelineStart {
        #[serde(rename = "maxPendingStrokes")]
        max_pending_strokes: usize,
        #[serde(rename = "maxPendingPoints")]
        max_pending_points: usize,
        #[serde(rename = "maxRetainedPixelBytes")]
        max_retained_pixel_bytes: usize,
    },
    PipelinePoll {
        #[serde(rename = "pipelineId")]
        pipeline_id: String,
    },
    PipelineStop {
        #[serde(rename = "pipelineId")]
        pipeline_id: String,
    },
    StrokeBegin {
        #[serde(default, rename = "predecessorOperationId")]
        predecessor_operation_id: Option<String>,
        #[serde(rename = "previewId")]
        preview_id: String,
        brush: Value,
        points: Vec<photocraft_engine::paint::StrokePoint>,
    },
    StrokeAppend {
        #[serde(rename = "previewId")]
        preview_id: String,
        #[serde(rename = "fromSeq")]
        from_seq: u64,
        points: Vec<photocraft_engine::paint::StrokePoint>,
    },
    StrokeFinish {
        #[serde(rename = "previewId")]
        preview_id: String,
        #[serde(rename = "throughSeq")]
        through_seq: u64,
    },
    StrokeCancel {
        #[serde(rename = "previewId")]
        preview_id: String,
    },
    Accept {
        #[serde(rename = "candidateId")]
        candidate_id: String,
    },
    Discard {
        #[serde(rename = "candidateId")]
        candidate_id: String,
    },
    Abandon {
        #[serde(rename = "targetOperationId")]
        target_operation_id: String,
    },
    Install {
        #[serde(rename = "versionId")]
        version_id: String,
    },
    Export {
        #[serde(rename = "versionId")]
        version_id: String,
        format: OutputFormat,
        #[serde(rename = "maxBytes")]
        max_bytes: usize,
    },
    Resume,
    Capture,
    Status {
        #[serde(rename = "targetOperationId")]
        target_operation_id: String,
    },
    Freeze,
    Close,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ImageEdit {
    NewLayer {
        name: String,
    },
    SelectLayer {
        #[serde(rename = "layerId")]
        layer_id: u64,
    },
    Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    Lasso {
        points: Vec<[f64; 2]>,
    },
    Float {
        dx: f64,
        dy: f64,
    },
    DropFloat,
    Transform {
        matrix: [f64; 6],
    },
    Blur {
        radius: f64,
    },
    Fill {
        color: String,
    },
}
impl ImageEdit {
    fn command(&self) -> (&'static str, Value) {
        match self {
            Self::NewLayer { name } => ("layer.new.layer", json!({"name":name})),
            Self::SelectLayer { layer_id } => ("layer.select", json!({"layer":layer_id})),
            Self::Rect {
                x,
                y,
                width,
                height,
            } => (
                "select.rect",
                json!({"x":x,"y":y,"width":width,"height":height}),
            ),
            Self::Lasso { points } => ("select.lasso", json!({"points":points})),
            Self::Float { dx, dy } => ("select.float", json!({"dx":dx,"dy":dy})),
            Self::DropFloat => ("select.drop", json!({})),
            Self::Transform { matrix } => ("edit.transform", json!({"matrix":matrix})),
            Self::Blur { radius } => ("filter.blur.gaussianBlur", json!({"radius":radius})),
            Self::Fill { color } => ("edit.fill", json!({"color":color})),
        }
    }
}
#[derive(Debug)]
pub struct Response {
    pub header: Value,
    pub payload: Vec<u8>,
}
struct Gesture {
    id: String,
    params: Value,
    points: Vec<photocraft_engine::paint::StrokePoint>,
    live: LiveStroke,
    // Includes removed smoothing tails, which may lie outside the latest live bounds.
    dirty: Rect,
    through: u64,
    checkpoint: Checkpoint,
    base: String,
    predecessor: Option<String>,
}
struct Candidate {
    id: String,
    base: Option<String>,
    receipt: VersionReceipt,
    checkpoint: Option<Checkpoint>,
    from_live: bool,
    recovered: bool,
    from_floating: bool,
}
struct StoreSlot {
    value: Option<Store>,
    policy: &'static str,
}
impl StoreSlot {
    fn new(store: Store) -> Self {
        Self {
            policy: store.cache_policy(),
            value: Some(store),
        }
    }
    fn get(&self) -> Result<&Store> {
        self.value
            .as_ref()
            .ok_or_else(|| Error::none("busy", "store owned by pipeline IO"))
    }
    fn get_mut(&mut self) -> Result<&mut Store> {
        self.value
            .as_mut()
            .ok_or_else(|| Error::none("busy", "store owned by pipeline IO"))
    }
    fn take(&mut self) -> Result<Store> {
        self.value
            .take()
            .ok_or_else(|| Error::none("busy", "store already moved"))
    }
    fn put(&mut self, store: Store) -> Result<()> {
        if self.value.is_some() {
            return Err(Error::unknown("store owner already installed"));
        }
        self.value = Some(store);
        Ok(())
    }
    fn context_unsettled(&self) -> bool {
        self.value.as_ref().is_none_or(|s| s.context_unsettled())
    }
    fn cache_policy(&self) -> &'static str {
        self.policy
    }
    fn unresolved(&self) -> Result<Vec<String>> {
        self.get()?.unresolved()
    }
    fn op_read(&self, id: &str, state: &str) -> Result<Option<Value>> {
        self.get()?.op_read(id, state)
    }
    fn op_write(&mut self, id: &str, state: &str, value: &Value) -> Result<()> {
        self.get_mut()?.op_write(id, state, value)
    }
    fn load(&self, id: &str) -> Result<store::Loaded> {
        self.get()?.load(id)
    }
    fn save(
        &mut self,
        doc: &Document,
        target: &LayerTarget,
        source: Option<Source>,
    ) -> Result<VersionReceipt> {
        self.get_mut()?.save(doc, target, source)
    }
}
pub struct Host {
    pub worker_epoch: u64,
    store: StoreSlot,
    pipeline: Option<pipeline::Pipeline>,
    engine: Session,
    context_generation: u64,
    floating_context: Option<context::FloatingContext>,
    identity: Option<(String, String)>,
    current: Option<String>,
    source: Option<Source>,
    candidate: Option<Candidate>,
    gesture: Option<Gesture>,
    frame_seq: u64,
    display_epoch: u64,
    epoch_input_through: u64,
    last_frame: Option<(String, u64, Option<String>)>,
    frozen: bool,
    resume_receipt: Option<(String, String, Value)>,
    closed: bool,
}
fn authorize(id: &str, _params: &Value) -> photocraft_engine::Result<()> {
    if [
        "paint.stroke",
        "layer.new.layer",
        "layer.select",
        "select.rect",
        "select.lasso",
        "select.float",
        "select.drop",
        "edit.transform",
        "filter.blur.gaussianBlur",
        "edit.fill",
    ]
    .contains(&id)
    {
        Ok(())
    } else {
        Err(photocraft_engine::EngineError::Other(format!(
            "host forbids command {id}"
        )))
    }
}
impl Host {
    pub fn open(root: &Path, budget: u64) -> Result<Self> {
        let store = StoreSlot::new(Store::open(root, budget)?);
        let worker_epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(native)?
            .as_millis() as u64
            * 1024
            + u64::from(std::process::id() % 1024);
        let mut engine = Session::new();
        engine.authorize = Some(authorize);
        // No global preference file, external profile, plugin store or scratch path is attached.
        engine.prefs.edit(|p| {
            p.scratch_disks.disks.clear();
            p.performance.history_states = 2;
        });
        Ok(Self {
            worker_epoch,
            store,
            pipeline: None,
            engine,
            context_generation: 0,
            floating_context: None,
            identity: None,
            current: None,
            source: None,
            candidate: None,
            gesture: None,
            frame_seq: 0,
            display_epoch: 0,
            epoch_input_through: 0,
            last_frame: None,
            frozen: false,
            resume_receipt: None,
            closed: false,
        })
    }
    pub fn cache_policy(&self) -> &'static str {
        self.store.cache_policy()
    }
    pub fn is_closed(&self) -> bool {
        self.closed
    }
    fn check(&mut self, r: &Request) -> Result<()> {
        if r.protocol != 1 {
            return Err(Error::none("unsupported-version", "host protocol"));
        }
        for id in [
            &r.request_id,
            &r.operation_id,
            &r.session_id,
            &r.incarnation,
        ] {
            valid_id(id)?;
        }
        if r.worker_epoch != self.worker_epoch {
            return Err(Error::none("stale-authority", "worker epoch mismatch"));
        }
        match &self.identity {
            Some((s, i)) if s != &r.session_id || i != &r.incarnation => {
                return Err(Error::none(
                    "stale-authority",
                    "session incarnation mismatch",
                ));
            }
            None => self.identity = Some((r.session_id.clone(), r.incarnation.clone())),
            _ => {}
        }
        if self.closed {
            return Err(Error::none("closed", "host closed"));
        }
        Ok(())
    }
    fn base(&self, r: &Request) -> Result<()> {
        if r.base_version != self.current {
            return Err(Error::none("conflict", "base version mismatch"));
        }
        Ok(())
    }
    fn idle(&self) -> Result<()> {
        if self.frozen {
            return Err(Error::none("frozen", "host frozen"));
        }
        if self.candidate.is_some() || self.gesture.is_some() {
            return Err(Error::none("busy", "settle candidate or gesture first"));
        }
        if !self.store.unresolved()?.is_empty() {
            return Err(Error::retained(
                "busy",
                "settle recovered operation receipts before a new edit",
            ));
        }
        Ok(())
    }
    fn target(&self) -> Result<LayerTarget> {
        let s = self
            .engine
            .active()
            .ok_or_else(|| Error::none("not-found", "no document"))?;
        Ok(LayerTarget {
            active: s.active_layer,
            selected: s.selected_layers.clone(),
        })
    }
    fn document(&self) -> Result<Arc<Document>> {
        Ok(self
            .engine
            .active()
            .ok_or_else(|| Error::none("not-found", "no document"))?
            .doc
            .clone())
    }
    pub fn handle(&mut self, r: Request, payload: Vec<u8>) -> Response {
        let before = self.context_stamp();
        let generation = self.context_generation;
        let result = self.check(&r).and_then(|_| {
            if self.pipeline.is_some()
                || matches!(
                    r.body,
                    Command::PipelineStart { .. }
                        | Command::PipelinePoll { .. }
                        | Command::PipelineStop { .. }
                )
            {
                pipeline::dispatch(self, &r, &payload)
            } else {
                self.run(&r, &payload)
            }
        });
        if self.context_generation == generation && self.context_stamp() != before {
            self.advance_context();
        }
        let (body, payload) = match result {
            Ok(v) => v,
            Err(e) => (json!({"kind":"failure","error":e}), vec![]),
        };
        Response {
            header: json!({"protocol":1,"requestId":r.request_id,"sessionId":r.session_id,"incarnation":r.incarnation,"workerEpoch":self.worker_epoch,"operationId":r.operation_id,"body":body}),
            payload,
        }
    }
    fn replay(&self, r: &Request) -> Result<Option<Value>> {
        if let Some(intent) = self.store.op_read(&r.operation_id, "intent")? {
            if intent["fingerprint"] != self.fingerprint(r)? {
                return Err(Error::none(
                    "conflict",
                    "operation id reused with different input",
                ));
            }
            for state in ["accepted", "discarded", "prepared", "failed"] {
                if let Some(v) = self.store.op_read(&r.operation_id, state)? {
                    return Ok(Some(v));
                }
            }
            return Err(Error::unknown(
                "operation intent exists without a result; query status, do not replay",
            ));
        }
        Ok(None)
    }
    fn fingerprint(&self, r: &Request) -> Result<String> {
        Ok(sha(&serde_json::to_vec(&json!({"sessionId":r.session_id,"incarnation":r.incarnation,"baseVersion":r.base_version,"body":r.body})).map_err(native)?))
    }
    fn intent(&mut self, r: &Request) -> Result<()> {
        let fingerprint = self.fingerprint(r)?;
        self.store.op_write(
            &r.operation_id,
            "intent",
            &json!({"fingerprint":fingerprint,"baseVersion":r.base_version,"request":r.body}),
        )
    }
    fn prepare(
        &mut self,
        r: &Request,
        checkpoint: Option<Checkpoint>,
        live_input: Option<u64>,
    ) -> Result<Value> {
        if self.engine.active().is_some_and(|s| s.floating.is_some()) {
            // Floating is transient, not a durable version. Such gestures must explicitly drop/cancel.
            return Err(Error::none(
                "busy",
                "floating selection must be dropped before version preparation",
            ));
        }
        let doc = self.document()?;
        let target = self.target()?;
        let receipt = match self.store.save(&doc, &target, self.source.clone()) {
            Ok(v) => v,
            Err(e) => {
                if let Some(c) = checkpoint {
                    if let Some(id) = self.floating_context.as_ref().map(|g| g.id.clone()) {
                        self.restore_float_checkpoint(&id, c)?;
                    } else {
                        self.engine.host_restore(c).map_err(native)?;
                    }
                }
                return Err(e);
            }
        };
        let mut body = json!({"kind":"prepared","candidateId":r.operation_id,"baseVersion":r.base_version,"receipt":receipt});
        if let Some(floating) = &self.floating_context {
            body["floatingPreviewId"] = json!(floating.id);
            body["floatingThroughSeq"] = json!(floating.through);
            body["contextGeneration"] = json!(self.context_generation);
        }
        if let Some(through) = live_input {
            body["fromLive"] = json!(true);
            body["inputThrough"] = json!(through);
        }
        if let Err(e) = self.store.op_write(&r.operation_id, "prepared", &body) {
            if let Some(c) = checkpoint {
                if let Some(id) = self.floating_context.as_ref().map(|g| g.id.clone()) {
                    self.restore_float_checkpoint(&id, c)?;
                } else {
                    self.engine.host_restore(c).map_err(native)?;
                }
            }
            return Err(e);
        }
        self.candidate = Some(Candidate {
            id: r.operation_id.clone(),
            base: r.base_version.clone(),
            receipt,
            checkpoint,
            from_live: live_input.is_some(),
            recovered: false,
            from_floating: self.floating_context.is_some(),
        });
        Ok(body)
    }
    fn run(&mut self, r: &Request, payload: &[u8]) -> Result<(Value, Vec<u8>)> {
        if !matches!(r.body, Command::Open { .. }) && !payload.is_empty() {
            return Err(Error::none("invalid-input", "unexpected binary payload"));
        }
        match &r.body {
            Command::Summary { max_bytes } => {
                Ok((self.context_summary(*max_bytes, false)?, vec![]))
            }
            Command::SelectLayerContext {
                layer_id,
                expected_context_generation,
            } => self.select_context(r, layer_id, *expected_context_generation),
            Command::Floating {
                preview_id,
                expected_context_generation,
                action,
            } => self.floating_command(r, preview_id, *expected_context_generation, action),
            Command::New { width, height } => {
                if let Some(v) = self.replay(r)? {
                    return Ok((v, vec![]));
                }
                self.idle()?;
                self.base(r)?;
                dimensions(*width, *height)?;
                if self.engine.active().is_some() {
                    return Err(Error::none("busy", "one document per stage-A host"));
                }
                self.intent(r)?;
                let mut doc = Document::new(
                    "Flow",
                    Size::new(*width, *height),
                    ColorMode::Rgb,
                    SampleType::U8,
                );
                doc.layers
                    .push(Layer::raster("Drawing", doc.pixel_format()));
                self.engine.add_document(doc, None);
                let v = self.prepare(r, None, None)?;
                Ok((v, vec![]))
            }
            Command::Open { source } => {
                if let Some(v) = self.replay(r)? {
                    return Ok((v, vec![]));
                }
                self.idle()?;
                self.base(r)?;
                if self.engine.active().is_some() {
                    return Err(Error::none("busy", "document already open"));
                }
                if payload.len() > 8 << 20
                    || source.byte_length != payload.len() as u64
                    || !store::is_hash(&source.digest)
                    || sha(payload) != source.digest
                {
                    return Err(Error::none(
                        "invalid-input",
                        "retained input byte identity or budget mismatch",
                    ));
                }
                if !["png", "tiff", "psd"].contains(&source.format_hint.as_str()) {
                    return Err(Error::none("unsupported", "stage-A input format hint"));
                }
                self.intent(r)?;
                let opts = photocraft_io::ImportOptions {
                    psd_max_pixel_bytes: 256 << 20,
                    flat_max_pixel_bytes: 64 << 20,
                    ..Default::default()
                };
                let (import, damaged) = photocraft_io::import_for_open(
                    &format!("retained.{}", source.format_hint),
                    payload,
                    &opts,
                )
                .map_err(native)?;
                if damaged || import.preview_only || !import.warnings.is_empty() {
                    return Err(Error::retained(
                        "unsupported",
                        "stage-A source is damaged, preview-only or reports compatibility warnings",
                    ));
                }
                let doc = import.document;
                dimensions(doc.size.width, doc.size.height)?;
                // Stage A proves native editing on simple synthetic RGB sources. Do not admit external linked dependencies.
                if doc.mode != ColorMode::Rgb
                    || doc.depth != SampleType::U8
                    || doc.walk().iter().any(|(_, _, l)| {
                        !matches!(l.content, LayerContent::Raster(_) | LayerContent::Group(_))
                    })
                {
                    return Err(Error::retained(
                        "unsupported",
                        "stage-A admits RGB8 raster/group documents only",
                    ));
                }
                self.source = Some(source.clone());
                self.engine.add_document(doc, None);
                let v = self.prepare(r, None, None)?;
                Ok((v, vec![]))
            }
            Command::Load { version_id } => {
                if self.frozen || self.candidate.is_some() || self.gesture.is_some() {
                    return Err(Error::none("busy", "settle live context before load"));
                }
                if self.engine.active().is_some() {
                    return Err(Error::none("busy", "load is startup-only; use install"));
                }
                let loaded = self.store.load(version_id)?;
                self.source = loaded.source;
                self.engine.add_document((*loaded.doc).clone(), None);
                self.engine
                    .host_install(loaded.doc, loaded.target)
                    .map_err(native)?;
                self.current = Some(version_id.clone());
                self.display_epoch += 1;
                self.epoch_input_through = 0;
                self.last_frame = None;
                Ok((json!({"kind":"loaded","versionId":version_id}), vec![]))
            }
            Command::Edit { edit } => {
                if matches!(
                    edit,
                    ImageEdit::SelectLayer { .. } | ImageEdit::Float { .. } | ImageEdit::DropFloat
                ) {
                    return Err(Error::none(
                        "unsupported",
                        "legacy context edit retired; use selectLayerContext/floating with explicit identity",
                    ));
                }
                if self.floating_context.is_some() {
                    return Err(Error::none(
                        "busy",
                        "explicitly cancel or drop floating selection before another edit",
                    ));
                }
                if let Some(v) = self.replay(r)? {
                    return Ok((v, vec![]));
                }
                self.idle()?;
                self.base(r)?;
                if self.current.is_none() {
                    return Err(Error::none(
                        "conflict",
                        "edit requires an accepted document version",
                    ));
                }
                let checkpoint = self.engine.host_checkpoint().map_err(native)?;
                self.intent(r)?;
                let (id, params) = edit.command();
                if let Err(e) = self.engine.execute(id, params) {
                    self.engine.host_restore(checkpoint).map_err(native)?;
                    let failure =
                        json!({"kind":"failure","error":Error::retained("engine",e.to_string())});
                    self.store.op_write(&r.operation_id, "failed", &failure)?;
                    return Ok((failure, vec![]));
                }
                let v = self.prepare(r, Some(checkpoint), None)?;
                Ok((v, vec![]))
            }
            Command::StrokeBegin {
                predecessor_operation_id,
                preview_id,
                brush,
                points,
            } => {
                self.idle()?;
                self.base(r)?;
                if predecessor_operation_id.is_some() {
                    return Err(Error::none(
                        "invalid-input",
                        "predecessor requires opt-in pipeline",
                    ));
                }
                valid_id(preview_id)?;
                if self.floating_context.is_some() {
                    return Err(Error::none("busy", "settle floating owner before a stroke"));
                }
                if points.is_empty() || points.len() > 4096 || !brush.is_object() {
                    return Err(Error::none("invalid-input", "stroke begin points/brush"));
                }
                if self.engine.active().is_some_and(|s| s.floating.is_some()) {
                    return Err(Error::none(
                        "busy",
                        "settle floating selection before a stroke",
                    ));
                }
                let next_input = self
                    .epoch_input_through
                    .checked_add(points.len() as u64)
                    .filter(|v| *v <= 9_007_199_254_740_991)
                    .ok_or_else(|| Error::none("limit", "epoch input sequence exhausted"))?;
                let checkpoint = self.engine.host_checkpoint().map_err(native)?;
                let mut params = brush.clone();
                params["points"] = serde_json::to_value(points).map_err(native)?;
                let live = LiveStroke::begin(&self.engine, &params).map_err(native)?;
                params["seed"] = json!(live.seed);
                let through = points.len() as u64;
                self.epoch_input_through = next_input;
                self.gesture = Some(Gesture {
                    id: preview_id.clone(),
                    params,
                    points: points.clone(),
                    dirty: live.bounds(),
                    live,
                    through,
                    checkpoint,
                    predecessor: None,
                    base: self
                        .current
                        .clone()
                        .ok_or_else(|| Error::none("conflict", "stroke requires accepted base"))?,
                });
                self.preview(r)
            }
            Command::StrokeAppend {
                preview_id,
                from_seq,
                points,
            } => {
                self.base(r)?;
                let next_input = self
                    .epoch_input_through
                    .checked_add(points.len() as u64)
                    .filter(|v| *v <= 9_007_199_254_740_991)
                    .ok_or_else(|| Error::none("limit", "epoch input sequence exhausted"))?;
                let g = self
                    .gesture
                    .as_mut()
                    .ok_or_else(|| Error::none("not-found", "gesture missing"))?;
                if &g.id != preview_id || *from_seq != g.through + 1 {
                    return Err(Error::none(
                        "conflict",
                        "gesture id or point sequence mismatch",
                    ));
                }
                if points.is_empty() || points.len() > 4096 || g.points.len() + points.len() > 65536
                {
                    return Err(Error::none("limit", "stroke sample budget"));
                }
                let damage = g.live.push(points).map_err(native)?;
                g.dirty = g.dirty.union(&damage);
                g.points.extend_from_slice(points);
                g.through += points.len() as u64;
                self.epoch_input_through = next_input;
                self.preview(r)
            }
            Command::StrokeFinish {
                preview_id,
                through_seq,
            } => {
                if let Some(v) = self.replay(r)? {
                    return Ok((v, vec![]));
                }
                self.base(r)?;
                let g = self
                    .gesture
                    .as_ref()
                    .ok_or_else(|| Error::none("not-found", "gesture missing"))?;
                if &g.id != preview_id
                    || *through_seq != g.through
                    || Some(&g.base) != self.current.as_ref()
                {
                    return Err(Error::none("conflict", "gesture finish prefix mismatch"));
                }
                self.intent(r)?;
                let mut g = self
                    .gesture
                    .take()
                    .ok_or_else(|| Error::none("not-found", "gesture disappeared"))?;
                g.params["points"] = serde_json::to_value(&g.points).map_err(native)?;
                if let Err(e) = self.engine.offer_live_stroke(g.live) {
                    self.engine.host_restore(g.checkpoint).map_err(native)?;
                    return Err(Error::retained("engine", e.to_string()));
                }
                let result = self.engine.execute("paint.stroke", g.params);
                match result {
                    Err(e) => {
                        self.engine.host_restore(g.checkpoint).map_err(native)?;
                        Err(Error::retained("engine", e.to_string()))
                    }
                    Ok(v) => {
                        if v.get("fromLive") != Some(&json!(true)) {
                            self.engine.host_restore(g.checkpoint).map_err(native)?;
                            return Err(Error::retained(
                                "engine",
                                "native live preview was not adopted",
                            ));
                        }
                        let prepared = self.prepare(r, Some(g.checkpoint), Some(*through_seq))?;
                        Ok((prepared, vec![]))
                    }
                }
            }
            Command::StrokeCancel { preview_id } => {
                let g = self
                    .gesture
                    .as_ref()
                    .ok_or_else(|| Error::none("not-found", "gesture missing"))?;
                if &g.id != preview_id {
                    return Err(Error::none("conflict", "gesture id mismatch"));
                }
                let g = self
                    .gesture
                    .take()
                    .ok_or_else(|| Error::none("not-found", "gesture missing"))?;
                self.engine.host_restore(g.checkpoint).map_err(native)?;
                self.display_epoch += 1;
                self.epoch_input_through = 0;
                self.last_frame = None;
                Ok((json!({"kind":"cancelled"}), vec![]))
            }
            Command::Accept { candidate_id } => {
                valid_id(candidate_id)?;
                if let Some(v) = self.store.op_read(candidate_id, "accepted")? {
                    return Ok((v, vec![]));
                }
                if self.store.op_read(candidate_id, "discarded")?.is_some() {
                    return Err(Error::none(
                        "conflict",
                        "discarded candidate cannot be accepted",
                    ));
                }
                self.base(r)?;
                if self.candidate.is_none() {
                    let v = self
                        .store
                        .op_read(candidate_id, "prepared")?
                        .ok_or_else(|| {
                            Error::unknown("candidate has no durable prepared receipt")
                        })?;
                    let receipt: VersionReceipt =
                        serde_json::from_value(v["receipt"].clone()).map_err(native)?;
                    let base = v["baseVersion"].as_str().map(str::to_string);
                    self.candidate = Some(Candidate {
                        id: candidate_id.clone(),
                        base,
                        receipt,
                        checkpoint: None,
                        from_live: v["fromLive"] == true,
                        recovered: true,
                        from_floating: v["floatingPreviewId"].is_string(),
                    });
                }
                let c = self
                    .candidate
                    .as_ref()
                    .ok_or_else(|| Error::none("not-found", "candidate missing"))?;
                let recovered = c.recovered;
                // Main may already have installed this exact durable candidate before the
                // native accept receipt was flushed. Explicit recovery settles that same version.
                let recovering_installed =
                    recovered && self.current.as_deref() == Some(&c.receipt.version_id);
                if &c.id != candidate_id || (c.base != self.current && !recovering_installed) {
                    return Err(Error::none("conflict", "candidate base mismatch"));
                }
                // Same-host acceptance retains its COW document and tool context. Only recovery
                // after a lost process needs to decode the complete persisted version again.
                let loaded = if recovered {
                    Some(self.store.load(&c.receipt.version_id)?)
                } else {
                    None
                };
                let result =
                    json!({"kind":"accepted","candidateId":candidate_id,"receipt":c.receipt});
                self.store.op_write(candidate_id, "accepted", &result)?;
                if let Some(loaded) = loaded {
                    if self.engine.active().is_none() {
                        self.engine.add_document((*loaded.doc).clone(), None);
                    }
                    self.engine
                        .host_install(loaded.doc, loaded.target)
                        .map_err(|e| {
                            Error::unknown(format!(
                                "accept receipt persisted but context install failed: {e}"
                            ))
                        })?;
                    self.source = loaded.source;
                } else {
                    self.engine.host_clear_history().map_err(|e| {
                        Error::unknown(format!(
                            "accept persisted but context settlement failed: {e}"
                        ))
                    })?;
                }
                let from_floating = c.from_floating;
                self.current = Some(c.receipt.version_id.clone());
                if !recovered && c.from_live {
                    // The exact live pixels were adopted. Promote the previous visual prefix
                    // to the new accepted baseline without a full-canvas upload on every pen-up.
                    if let Some((_, _, preview)) = &mut self.last_frame {
                        *preview = None;
                    }
                } else {
                    self.display_epoch += 1;
                    self.epoch_input_through = 0;
                    self.last_frame = None;
                }
                self.candidate = None;
                if from_floating {
                    self.floating_context = None;
                }
                Ok((result, vec![]))
            }
            Command::Discard { candidate_id } => {
                valid_id(candidate_id)?;
                if let Some(v) = self.store.op_read(candidate_id, "discarded")? {
                    return Ok((v, vec![]));
                }
                if self.store.op_read(candidate_id, "accepted")?.is_some() {
                    return Err(Error::none(
                        "conflict",
                        "accepted candidate cannot be discarded",
                    ));
                }
                self.base(r)?;
                if self.candidate.is_none() {
                    if self.pipeline.is_some()
                        || self.gesture.is_some()
                        || self.floating_context.is_some()
                        || self.engine.active().is_some_and(|s| s.floating.is_some())
                    {
                        return Err(Error::none(
                            "busy",
                            "settle transient context before recovered discard",
                        ));
                    }
                    let v = self
                        .store
                        .op_read(candidate_id, "prepared")?
                        .ok_or_else(|| {
                            Error::none("not-found", "candidate has no durable prepared receipt")
                        })?;
                    let base = v["baseVersion"].as_str().map(str::to_owned);
                    if base != self.current {
                        return Err(Error::none(
                            "conflict",
                            "recovered discard requires original base installed",
                        ));
                    }
                    self.candidate = Some(Candidate {
                        id: candidate_id.clone(),
                        base,
                        receipt: serde_json::from_value(v["receipt"].clone()).map_err(native)?,
                        checkpoint: None,
                        from_live: v["fromLive"] == true,
                        recovered: true,
                        from_floating: v["floatingPreviewId"].is_string(),
                    });
                }
                let c = self
                    .candidate
                    .as_ref()
                    .ok_or_else(|| Error::none("not-found", "candidate missing"))?;
                if &c.id != candidate_id {
                    return Err(Error::none("conflict", "candidate id mismatch"));
                }
                if c.base != self.current {
                    return Err(Error::none(
                        "conflict",
                        "discard requires original candidate base installed",
                    ));
                }
                // Validate a recovered base before recording retirement. On read failure the
                // durable prepared candidate remains queryable and the same host may retry.
                let recovered_base = if c.checkpoint.is_none() {
                    c.base
                        .as_ref()
                        .map(|base| self.store.load(base))
                        .transpose()?
                } else {
                    None
                };
                let result = json!({"kind":"discarded","candidateId":candidate_id});
                // Keep the candidate and its rollback obligation until the durable retirement
                // receipt succeeds. A failed journal write must not unlock new edits on its pixels.
                self.store.op_write(candidate_id, "discarded", &result)?;
                let c = self.candidate.take().ok_or_else(|| {
                    Error::unknown("discard persisted but candidate context missing")
                })?;
                if let Some(checkpoint) = c.checkpoint {
                    self.engine.host_restore(checkpoint).map_err(|e| {
                        Error::unknown(format!("discard persisted but restore failed: {e}"))
                    })?;
                } else if let Some(l) = recovered_base {
                    self.engine.host_install(l.doc, l.target).map_err(|e| {
                        Error::unknown(format!("discard persisted but install failed: {e}"))
                    })?;
                    self.source = l.source;
                } else if let Some(i) = self.engine.active_index() {
                    self.engine.close(i);
                    self.source = None;
                }
                self.display_epoch += 1;
                self.epoch_input_through = 0;
                self.last_frame = None;
                Ok((result, vec![]))
            }
            Command::Abandon {
                target_operation_id,
            } => {
                valid_id(target_operation_id)?;
                if let Some(v) = self.store.op_read(target_operation_id, "discarded")? {
                    return Ok((v, vec![]));
                }
                if self.candidate.is_some() || self.gesture.is_some() {
                    return Err(Error::none(
                        "busy",
                        "settle live transaction before abandoning recovered intent",
                    ));
                }
                if self
                    .store
                    .op_read(target_operation_id, "accepted")?
                    .is_some()
                {
                    return Err(Error::none(
                        "conflict",
                        "accepted operations cannot be abandoned",
                    ));
                }
                if self.store.op_read(target_operation_id, "intent")?.is_none() {
                    return Err(Error::none("not-found", "operation intent missing"));
                }
                let v = json!({"kind":"discarded","candidateId":target_operation_id,"retainedEvidence":true});
                self.store.op_write(target_operation_id, "discarded", &v)?;
                Ok((v, vec![]))
            }
            Command::Install { version_id } => {
                self.context_idle_for_install()?;
                self.base(r)?;
                let loaded = self.store.load(version_id)?;
                self.engine
                    .host_install(loaded.doc, loaded.target)
                    .map_err(native)?;
                self.source = loaded.source;
                self.current = Some(version_id.clone());
                self.display_epoch += 1;
                self.epoch_input_through = 0;
                self.last_frame = None;
                Ok((json!({"kind":"installed","versionId":version_id}), vec![]))
            }
            Command::Export {
                version_id,
                format,
                max_bytes,
            } => {
                self.base(r)?;
                if !self.frozen
                    || self.candidate.is_some()
                    || self.gesture.is_some()
                    || !self.store.unresolved()?.is_empty()
                {
                    return Err(Error::retained(
                        "busy",
                        "export requires a settled frozen host after pipelineStop",
                    ));
                }
                if !store::is_hash(version_id) {
                    return Err(Error::none(
                        "invalid-input",
                        "invalid export version identity",
                    ));
                }
                if *max_bytes == 0 || *max_bytes > wire::MAX_PAYLOAD {
                    return Err(Error::none("limit", "export maxBytes must be 1..64MiB"));
                }
                let loaded = self.store.load(version_id)?;
                if loaded.doc.id != self.document()?.id {
                    return Err(Error::none(
                        "conflict",
                        "export version belongs to another document",
                    ));
                }
                let (mut receipt, bytes) = output::encode(&loaded.doc, format, *max_bytes)?;
                receipt["kind"] = json!("exported");
                receipt["versionId"] = json!(version_id);
                receipt["documentId"] = json!(loaded.doc.id.0.to_string());
                Ok((receipt, bytes))
            }
            Command::Resume => {
                self.base(r)?;
                let fingerprint = self.fingerprint(r)?;
                if let Some((id, previous, receipt)) = &self.resume_receipt {
                    if id == &r.operation_id {
                        if previous != &fingerprint
                            || self.frozen
                            || receipt["epoch"].as_u64() != Some(self.display_epoch)
                        {
                            return Err(Error::none(
                                "conflict",
                                "resume operation cannot cross another freeze/base/epoch",
                            ));
                        }
                        return Ok((receipt.clone(), vec![]));
                    }
                }
                if !self.frozen
                    || self.candidate.is_some()
                    || self.gesture.is_some()
                    || self.floating_context.is_some()
                    || self.engine.active().is_some_and(|s| s.floating.is_some())
                    || !self.store.unresolved()?.is_empty()
                {
                    return Err(Error::retained(
                        "busy",
                        "resume requires a settled frozen host; failed chains cannot resume",
                    ));
                }
                let document_id = self.document()?.id.0.to_string();
                self.frozen = false;
                self.display_epoch += 1;
                self.epoch_input_through = 0;
                self.last_frame = None;
                let receipt = json!({"kind":"resumed","versionId":self.current,"documentId":document_id,"epoch":self.display_epoch});
                self.resume_receipt = Some((r.operation_id.clone(), fingerprint, receipt.clone()));
                Ok((receipt, vec![]))
            }
            Command::Capture => {
                self.base(r)?;
                if self.candidate.is_some() {
                    return Err(Error::none("busy", "candidate not accepted"));
                }
                self.preview(r)
            }
            Command::Status {
                target_operation_id,
            } => {
                valid_id(target_operation_id)?;
                for state in ["accepted", "discarded", "prepared", "failed", "intent"] {
                    if let Some(v) = self.store.op_read(target_operation_id, state)? {
                        return Ok((json!({"kind":"status","state":state,"result":v}), vec![]));
                    }
                }
                Ok((json!({"kind":"status","state":"absent"}), vec![]))
            }
            Command::Freeze => {
                if !self.store.unresolved()?.is_empty() {
                    return Err(Error::retained(
                        "busy",
                        "unsettled durable operation receipts; query/accept/discard explicitly",
                    ));
                }
                if self.gesture.is_some()
                    || self.candidate.is_some()
                    || self.floating_context.is_some()
                    || self.engine.active().is_some_and(|s| s.floating.is_some())
                {
                    return Err(Error::none("busy", "unsettled image obligations"));
                }
                self.frozen = true;
                Ok((json!({"kind":"frozen","versionId":self.current}), vec![]))
            }
            Command::PipelineStart { .. }
            | Command::PipelinePoll { .. }
            | Command::PipelineStop { .. } => Err(Error::none("not-found", "pipeline not active")),
            Command::Close => {
                if !self.frozen {
                    return Err(Error::none("busy", "freeze before close"));
                }
                self.closed = true;
                Ok((json!({"kind":"closed"}), vec![]))
            }
        }
    }
    fn preview(&mut self, r: &Request) -> Result<(Value, Vec<u8>)> {
        if self
            .floating_context
            .as_ref()
            .is_some_and(|g| g.blocked.is_some())
        {
            return Err(Error::retained(
                "engine",
                "floating rollback remains blocked; no frame certified",
            ));
        }
        let (doc, preview_id, dirty) = if let Some(g) = &self.gesture {
            (g.live.doc.clone(), Some(g.id.clone()), Some(g.dirty))
        } else {
            let st = self
                .engine
                .active()
                .ok_or_else(|| Error::none("not-found", "no document"))?;
            (
                if let Some(f) = photocraft_engine::float_cmds::floating(st) {
                    // Do not silently substitute the base document when floating display fails.
                    Arc::new(
                        f.parts
                            .moved(&st.doc, f.offset.0, f.offset.1)
                            .map_err(native)?,
                    )
                } else if self.floating_context.is_some() {
                    return Err(Error::retained(
                        "engine",
                        "floating preview owner has no valid engine continuation",
                    ));
                } else {
                    st.doc.clone()
                },
                self.floating_context.as_ref().map(|g| g.id.clone()),
                None,
            )
        };
        let document_id = doc.id.0.to_string();
        let can_delta = !matches!(r.body, Command::Capture)
            && self
                .last_frame
                .as_ref()
                .is_some_and(|(id, epoch, previous)| {
                    id == &document_id
                        && *epoch == self.display_epoch
                        && (previous.is_none() || previous == &preview_id)
                });
        let bounds = doc.bounds();
        let mut rect = if can_delta {
            dirty.unwrap_or(bounds).intersect(&bounds)
        } else {
            bounds
        };
        if rect.is_empty() {
            rect = bounds;
        }
        let pixels = if rect.is_empty() {
            vec![]
        } else {
            render_srgb(&doc, rect)?
        };
        let base = can_delta.then_some(self.frame_seq);
        self.frame_seq = self
            .frame_seq
            .checked_add(1)
            .ok_or_else(|| Error::none("limit", "frame sequence exhausted"))?;
        self.last_frame = Some((document_id.clone(), self.display_epoch, preview_id.clone()));
        let tiles = if rect.is_empty() {
            vec![]
        } else {
            vec![
                json!({"x":rect.x0,"y":rect.y0,"w":rect.width(),"h":rect.height(),"offset":0,"length":pixels.len()}),
            ]
        };
        let mut frame = json!({"sessionId":r.session_id,"incarnation":r.incarnation,"workerEpoch":self.worker_epoch,"documentId":document_id,
            "epoch":self.display_epoch,"frameSeq":self.frame_seq,"baseFrameSeq":base,"imageVersionRef":self.current,"previewId":preview_id,
            "inputThrough":self.epoch_input_through,"width":doc.size.width,"height":doc.size.height,"encoding":"srgb-rgba8-straight","tiles":tiles});
        if preview_id.is_none() {
            frame
                .as_object_mut()
                .ok_or_else(|| Error::none("frame", "not object"))?
                .remove("previewId");
        }
        Ok((json!({"kind":"frame","frame":frame}), pixels))
    }
}
fn render_srgb(doc: &Document, rect: Rect) -> Result<Vec<u8>> {
    let mut b = photocraft_compose::render(doc, rect);
    let src = photocraft_engine::color_cmds::composite_profile(doc);
    let dst = photocraft_cms::Builtin::Srgb.profile();
    if !src.same_colors(dst) {
        let t = photocraft_cms::Transform::new(
            &src,
            dst,
            photocraft_cms::Intent::RelativeColorimetric,
            true,
        )
        .map_err(native)?;
        for row in b.px.chunks_mut(rect.width() as usize) {
            let mut flat: Vec<f32> = row.iter().flat_map(|p| p.iter().copied()).collect();
            t.apply(&mut flat, 4);
            for (p, c) in row.iter_mut().zip(flat.chunks_exact(4)) {
                p.copy_from_slice(c);
            }
        }
    }
    Ok(b.to_rgba8().pixels)
}

#[cfg(test)]
mod context_tests;
