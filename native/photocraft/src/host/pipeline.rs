//! Opt-in bounded input actor / exclusive persistence owner. No native user-history authority.
use super::*;
use std::{
    collections::{HashMap, VecDeque},
    sync::mpsc::{self, Receiver, SyncSender, TryRecvError},
    thread::{self, JoinHandle},
};

const MAX_STROKES: usize = 4;
const MAX_POINTS: usize = 65536;
const MAX_PIXELS: usize = 256 << 20;
const MAX_OPERATIONS: usize = 65536;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Limits {
    max_pending_strokes: usize,
    max_pending_points: usize,
    max_retained_pixel_bytes: usize,
}
struct Entry {
    id: String,
    fingerprint: String,
    doc: Arc<Document>,
    points: Vec<photocraft_engine::paint::StrokePoint>,
    state: Value,
    admission: Value,
    prepared: Option<Value>,
    accepting: bool,
    accepted: bool,
}
struct RetainedActive {
    id: String,
    params: Value,
    doc: Arc<Document>,
    through: u64,
}
enum Work {
    Prepare {
        request: Request,
        fingerprint: String,
        predecessor: Option<String>,
        anchor: String,
        doc: Arc<Document>,
        target: LayerTarget,
        source: Option<Source>,
        through: u64,
        frame_through: u64,
        epoch: u64,
        input_digest: String,
    },
    Accept {
        id: String,
        base: String,
    },
}
struct Completion {
    id: String,
    result: Result<Value>,
}
pub(super) struct Pipeline {
    id: String,
    anchor: String,
    limits: Limits,
    tx: Option<SyncSender<Work>>,
    rx: Receiver<Completion>,
    thread: Option<JoinHandle<Store>>,
    entries: VecDeque<Entry>,
    events: VecDeque<Value>,
    recent: VecDeque<(String, String, Value)>,
    seen: HashMap<String, String>,
    last_completed: Option<String>,
    accepted_doc: Arc<Document>,
    failed_active: Option<RetainedActive>,
    blocked: Option<Error>,
    sealed: bool,
}
fn writer(mut store: Store, rx: Receiver<Work>, tx: SyncSender<Completion>) -> Store {
    let mut blocked = false;
    let mut waiting = VecDeque::new();
    loop {
        if waiting.is_empty() {
            match rx.recv() {
                Ok(work) => waiting.push_back(work),
                Err(_) => break,
            }
        }
        while let Ok(work) = rx.try_recv() {
            waiting.push_back(work);
        }
        // Main has already installed this prefix. Give its explicit settlement priority
        // over not-yet-started descendant snapshots; never reorder snapshot preparation.
        let selected = waiting
            .iter()
            .position(|w| matches!(w, Work::Accept { .. }))
            .unwrap_or(0);
        let Some(work) = waiting.remove(selected) else {
            break;
        };
        let id = match &work {
            Work::Prepare { request, .. } => request.operation_id.clone(),
            Work::Accept { id, .. } => id.clone(),
        };
        let result = match work {
            Work::Prepare {
                request,
                fingerprint,
                predecessor,
                anchor,
                doc,
                target,
                source,
                through,
                frame_through,
                epoch,
                input_digest,
            } => (|| {
                if blocked {
                    return Err(Error::retained(
                        "predecessor-blocked",
                        "earlier IO failed; dependent snapshot retained in actor",
                    ));
                }
                if let Some(intent) = store.op_read(&id, "intent")? {
                    if intent["fingerprint"] != fingerprint
                        || intent["inputDigest"] != input_digest
                        || intent["predecessorOperationId"] != json!(predecessor)
                    {
                        return Err(Error::none(
                            "conflict",
                            "operation ID reused with different input",
                        ));
                    }
                    for state in ["accepted", "discarded", "prepared", "failed"] {
                        if let Some(v) = store.op_read(&id, state)? {
                            return Ok(v);
                        }
                    }
                    return Err(Error::unknown(
                        "prior operation intent has no durable result; never replay",
                    ));
                }
                let base = if let Some(pred) = &predecessor {
                    let previous = store
                        .op_read(pred, "accepted")?
                        .or(store.op_read(pred, "prepared")?)
                        .ok_or_else(|| {
                            Error::retained(
                                "predecessor-blocked",
                                "predecessor has no durable version",
                            )
                        })?;
                    previous["receipt"]["versionId"]
                        .as_str()
                        .ok_or_else(|| Error::retained("corrupt", "predecessor version missing"))?
                        .to_owned()
                } else {
                    anchor
                };
                store.op_write(&id,"intent",&json!({"fingerprint":fingerprint,"baseVersion":base,"request":request.body,"predecessorOperationId":predecessor,"inputDigest":input_digest}))?;
                let receipt = store.save(&doc, &target, source)?;
                let result = json!({"kind":"prepared","candidateId":id,"baseVersion":base,"receipt":receipt,"fromLive":true,"inputThrough":through,"frameInputThrough":frame_through,"epoch":epoch,"predecessorOperationId":predecessor,"inputDigest":input_digest});
                store.op_write(&id, "prepared", &result)?;
                Ok(result)
            })(),
            Work::Accept {
                id: ref candidate,
                base,
            } => (|| {
                if let Some(v) = store.op_read(candidate, "accepted")? {
                    return Ok(v);
                }
                if blocked {
                    return Err(Error::retained(
                        "pipeline-blocked",
                        "IO failed before native acceptance; Main must query/reconcile",
                    ));
                }
                let prepared = store
                    .op_read(candidate, "prepared")?
                    .ok_or_else(|| Error::unknown("candidate has no durable prepare"))?;
                if prepared["baseVersion"] != base {
                    return Err(Error::none("conflict", "FIFO accept base mismatch"));
                }
                let result = json!({"kind":"accepted","candidateId":candidate,"receipt":prepared["receipt"]});
                store.op_write(candidate, "accepted", &result)?;
                Ok(result)
            })(),
        };
        if result.is_err() {
            blocked = true;
        }
        // Only IO can wait here. Actor always uses try_recv/try_send. At most four admitted
        // entries each produce prepare+accept, below this channel's sixteen-completion cap.
        if tx.send(Completion { id, result }).is_err() {
            break;
        }
    }
    store
}
impl Pipeline {
    fn drain(&mut self, h: &mut Host) -> Result<()> {
        loop {
            match self.rx.try_recv() {
                Ok(done) => {
                    let entry = self
                        .entries
                        .iter_mut()
                        .find(|e| e.id == done.id)
                        .ok_or_else(|| Error::unknown("IO completion has no retained operation"))?;
                    match done.result {
                        Ok(body) => {
                            if body["kind"] == "accepted" {
                                h.current = Some(
                                    body["receipt"]["versionId"]
                                        .as_str()
                                        .ok_or_else(|| Error::unknown("accepted version missing"))?
                                        .to_owned(),
                                );
                                self.accepted_doc = entry.doc.clone();
                                entry.accepted = true;
                            } else if body["kind"] == "prepared" {
                                entry.prepared = Some(body.clone());
                            } else {
                                self.blocked = Some(Error::retained(
                                    "pipeline-blocked",
                                    "recovered terminal operation conflicts with active chain",
                                ));
                            }
                            entry.state = body.clone();
                            self.events
                                .push_back(json!({"operationId":done.id,"result":body}));
                        }
                        Err(error) => {
                            self.blocked = Some(error.clone());
                            entry.state = json!({"kind":"failure","error":error});
                            self.events
                                .push_back(json!({"operationId":done.id,"result":entry.state}));
                        }
                    }
                }
                Err(TryRecvError::Empty) => return Ok(()),
                Err(TryRecvError::Disconnected) => {
                    self.blocked
                        .get_or_insert_with(|| Error::unknown("persistence owner disconnected"));
                    return Ok(());
                }
            }
        }
    }
    fn points(&self, h: &Host) -> usize {
        self.entries.iter().map(|e| e.points.len()).sum::<usize>()
            + h.gesture.as_ref().map_or(0, |g| g.points.len())
            + self
                .failed_active
                .as_ref()
                .map_or(0, |g| g.through as usize)
    }
    fn pixels(&self, h: &Host, extra: Option<&Document>) -> Result<usize> {
        let doc = h.document()?;
        let history = photocraft_ops::History::new(1);
        let mut held: Vec<&Document> = self.entries.iter().map(|e| e.doc.as_ref()).collect();
        held.push(&self.accepted_doc);
        if let Some(g) = &h.gesture {
            held.push(&g.live.doc)
        }
        if let Some(failed) = &self.failed_active {
            held.push(&failed.doc);
        }
        if let Some(extra) = extra {
            held.push(extra)
        }
        Ok(history
            .pixel_bytes(&doc)
            .saturating_add(history.extra_bytes(&doc, &held)))
    }
    fn slots(&self, h: &Host) -> usize {
        self.entries.len()
            + usize::from(h.gesture.is_some())
            + usize::from(self.failed_active.is_some())
    }
    fn input_base(&self, r: &Request) -> Result<()> {
        if r.base_version.as_deref() != Some(&self.anchor) {
            Err(Error::none(
                "conflict",
                "pipeline input requires its fixed anchor",
            ))
        } else {
            Ok(())
        }
    }
    fn admission(&self, h: &Host) -> Result<()> {
        if self.sealed || h.frozen {
            Err(Error::none("frozen", "pipeline admission frozen"))
        } else if self.blocked.is_some() {
            Err(Error::retained(
                "pipeline-blocked",
                "retained failed lineage requires reconciliation",
            ))
        } else {
            Ok(())
        }
    }
    fn decorate(&self, h: &mut Host, r: &Request) -> Result<(Value, Vec<u8>)> {
        let (mut body, payload) = h.preview(r)?;
        let pending: Vec<&str> = self
            .entries
            .iter()
            .filter(|e| !e.accepted)
            .map(|e| e.id.as_str())
            .collect();
        body["frame"]["pipelineId"] = json!(self.id);
        body["frame"]["pendingOperationIds"] = json!(pending);
        if let Some(head) = pending.last() {
            body["frame"]["workingHeadOperationId"] = json!(head);
            if h.gesture.is_none() {
                body["frame"]["previewId"] = json!(format!("working-{head}"));
            }
        }
        Ok((body, payload))
    }
    fn state(&mut self, h: &Host) -> Result<Value> {
        let events: Vec<Value> = self.events.drain(..).collect();
        // A delivered event may be lost on the transport. Keep its terminal result queryable
        // in a bounded recent cache; disk remains the authority after settled stop/restart.
        while self.entries.front().is_some_and(|e| e.accepted) {
            let e = self
                .entries
                .pop_front()
                .ok_or_else(|| Error::unknown("settled prefix disappeared"))?;
            self.recent.push_back((e.id, e.fingerprint, e.state));
            if self.recent.len() > 64 {
                self.recent.pop_front();
            }
        }
        let active = h.gesture.as_ref().map(|g| -> Result<Value> {
            let mut params = g.params.clone();
            params["points"] = serde_json::to_value(&g.points).map_err(native)?;
            Ok(json!({"previewId":g.id,"throughSeq":g.through,"inputDigest":sha(&serde_json::to_vec(&json!({"params":params,"firstSeq":1,"throughSeq":g.through})).map_err(native)?)}))
        }).transpose()?;
        let retained_active = self.failed_active.as_ref().map(|g| -> Result<Value> {
            Ok(json!({"previewId":g.id,"throughSeq":g.through,"inputDigest":sha(&serde_json::to_vec(&json!({"params":g.params,"firstSeq":1,"throughSeq":g.through})).map_err(native)?)}))
        }).transpose()?;
        let active = active.or(retained_active);
        Ok(
            json!({"kind":"pipelineState","pipelineId":self.id,"anchorVersion":self.anchor,"acceptedVersion":h.current,"events":events,"blocked":self.blocked,"active":active,"operations":self.entries.iter().map(|e|json!({"operationId":e.id,"admission":e.admission,"state":e.state["kind"],"acceptPending":e.accepting&&!e.accepted})).collect::<Vec<_>>(),"queueDepth":self.slots(h),"pendingPoints":self.points(h),"retainedPixelBytes":self.pixels(h,None)?,"limits":self.limits,"availableSlots":self.limits.max_pending_strokes.saturating_sub(self.slots(h))}),
        )
    }
    fn rebuild(h: &Host, g: &mut Gesture) -> Result<()> {
        let mut params = g.params.clone();
        params["points"] = serde_json::to_value(&g.points).map_err(native)?;
        g.live = LiveStroke::begin(&h.engine, &params).map_err(native)?;
        g.dirty = g.dirty.union(&g.live.bounds());
        Ok(())
    }
    fn run(&mut self, h: &mut Host, r: &Request, payload: &[u8]) -> Result<(Value, Vec<u8>)> {
        if !payload.is_empty() {
            return Err(Error::none(
                "invalid-input",
                "pipeline command has unexpected payload",
            ));
        }
        self.drain(h)?;
        match &r.body {
            Command::PipelinePoll { pipeline_id } => {
                if pipeline_id != &self.id {
                    return Err(Error::none("conflict", "pipeline ID mismatch"));
                }
                Ok((self.state(h)?, vec![]))
            }
            Command::StrokeBegin {
                preview_id,
                predecessor_operation_id,
                brush,
                points,
            } => {
                self.admission(h)?;
                self.input_base(r)?;
                valid_id(preview_id)?;
                if self.seen.len() >= MAX_OPERATIONS {
                    return Err(Error::none(
                        "backpressure",
                        "pipeline identity budget full; stop before another stroke",
                    ));
                }
                if h.gesture.is_some() {
                    return Err(Error::none("busy", "active stroke already admitted"));
                }
                if predecessor_operation_id != &self.last_completed {
                    return Err(Error::none("conflict", "pointer-down predecessor mismatch"));
                }
                if self.slots(h) >= self.limits.max_pending_strokes
                    || self.points(h).saturating_add(points.len()) > self.limits.max_pending_points
                {
                    return Err(Error::none(
                        "backpressure",
                        "pipeline slot or point budget full",
                    ));
                }
                if points.is_empty() || points.len() > 4096 || !brush.is_object() {
                    return Err(Error::none("invalid-input", "stroke begin points/brush"));
                }
                if brush
                    .get("seed")
                    .and_then(Value::as_u64)
                    .filter(|v| *v <= 9_007_199_254_740_991)
                    .is_none()
                {
                    return Err(Error::none(
                        "invalid-input",
                        "pipeline requires an explicit safe integer seed retained by Main",
                    ));
                }
                let next = h
                    .epoch_input_through
                    .checked_add(points.len() as u64)
                    .filter(|v| *v <= 9_007_199_254_740_991)
                    .ok_or_else(|| Error::none("limit", "epoch input sequence exhausted"))?;
                let checkpoint = h.engine.host_checkpoint().map_err(native)?;
                let mut params = brush.clone();
                params["points"] = serde_json::to_value(points).map_err(native)?;
                let live = LiveStroke::begin(&h.engine, &params).map_err(native)?;
                params["seed"] = json!(live.seed);
                if self.pixels(h, Some(&live.doc))? > self.limits.max_retained_pixel_bytes {
                    return Err(Error::none(
                        "backpressure",
                        "retained pixel budget full; no samples admitted",
                    ));
                }
                h.gesture = Some(Gesture {
                    id: preview_id.clone(),
                    params,
                    points: points.clone(),
                    dirty: live.bounds(),
                    live,
                    through: points.len() as u64,
                    checkpoint,
                    base: self.anchor.clone(),
                    predecessor: predecessor_operation_id.clone(),
                });
                h.epoch_input_through = next;
                self.decorate(h, r).map_err(|e| {
                    Error::retained(
                        &e.code,
                        format!(
                            "admitted begin prefix retained; query active status: {}",
                            e.message
                        ),
                    )
                })
            }
            Command::StrokeAppend {
                preview_id,
                from_seq,
                points,
            } => {
                self.admission(h)?;
                self.input_base(r)?;
                let g = h
                    .gesture
                    .as_ref()
                    .ok_or_else(|| Error::none("not-found", "active stroke missing"))?;
                if &g.id != preview_id || *from_seq != g.through + 1 {
                    return Err(Error::none(
                        "conflict",
                        "gesture sample prefix mismatch; query active prefix",
                    ));
                }
                if points.is_empty() || points.len() > 4096 {
                    return Err(Error::none(
                        "invalid-input",
                        "append batch must contain 1..4096 points",
                    ));
                }
                if self.points(h).saturating_add(points.len()) > self.limits.max_pending_points {
                    return Err(Error::none(
                        "backpressure",
                        "pipeline point budget full; no samples admitted",
                    ));
                }
                let next = h
                    .epoch_input_through
                    .checked_add(points.len() as u64)
                    .filter(|v| *v <= 9_007_199_254_740_991)
                    .ok_or_else(|| Error::none("limit", "epoch input sequence exhausted"))?;
                let mut g = h
                    .gesture
                    .take()
                    .ok_or_else(|| Error::unknown("gesture disappeared"))?;
                let pushed = g.live.push(points).map_err(native);
                let over = match &pushed {
                    Ok(_) => self
                        .pixels(h, Some(&g.live.doc))
                        .map(|b| b > self.limits.max_retained_pixel_bytes),
                    Err(e) => Err(e.clone()),
                };
                match (pushed, over) {
                    (Ok(damage), Ok(false)) => {
                        g.dirty = g.dirty.union(&damage);
                        g.points.extend_from_slice(points);
                        g.through += points.len() as u64;
                        h.epoch_input_through = next;
                        h.gesture = Some(g);
                        self.decorate(h, r).map_err(|e| {
                            Error::retained(
                                &e.code,
                                format!(
                                    "admitted append prefix retained; query active status: {}",
                                    e.message
                                ),
                            )
                        })
                    }
                    (_, error) => {
                        let failure = match error {
                            Err(e) => e,
                            _ => Error::none(
                                "backpressure",
                                "retained pixel budget full; entire batch rejected",
                            ),
                        };
                        let restored = Self::rebuild(h, &mut g);
                        h.gesture = Some(g);
                        if let Err(e) = restored {
                            self.blocked = Some(e.clone());
                            return Err(Error::retained(
                                "pipeline-blocked",
                                format!("accepted prefix retained but preview rebuild failed: {e}"),
                            ));
                        }
                        Err(failure)
                    }
                }
            }
            Command::StrokeFinish {
                preview_id,
                through_seq,
            } => {
                self.input_base(r)?;
                let fingerprint = h.fingerprint(r)?;
                if self.seen.contains_key(&r.operation_id)
                    && h.gesture.as_ref().is_some_and(|g| &g.id == preview_id)
                {
                    return Err(Error::none(
                        "conflict",
                        "operation ID belongs to an earlier stroke; active input is retained",
                    ));
                }
                if let Some(e) = self.entries.iter().find(|e| e.id == r.operation_id) {
                    if e.fingerprint != fingerprint {
                        return Err(Error::none("conflict", "finish operation input changed"));
                    }
                    return Ok((e.state.clone(), vec![]));
                }
                if let Some((_, fp, state)) =
                    self.recent.iter().find(|(id, _, _)| id == &r.operation_id)
                {
                    if fp != &fingerprint {
                        return Err(Error::none("conflict", "finish operation input changed"));
                    }
                    return Ok((state.clone(), vec![]));
                }
                if self.seen.contains_key(&r.operation_id) {
                    return Err(Error::retained(
                        "needs-settled-query",
                        "operation outside in-worker receipt window; stop/query durable status",
                    ));
                }
                if self.seen.len() >= MAX_OPERATIONS {
                    return Err(Error::none(
                        "backpressure",
                        "pipeline operation identity budget full; finish after settled stop",
                    ));
                }
                let g = h
                    .gesture
                    .as_ref()
                    .ok_or_else(|| Error::none("not-found", "active stroke missing"))?;
                if &g.id != preview_id || *through_seq != g.through {
                    return Err(Error::none(
                        "conflict",
                        "finish must name admitted whole prefix",
                    ));
                }
                let mut g = h
                    .gesture
                    .take()
                    .ok_or_else(|| Error::unknown("gesture disappeared"))?;
                g.params["points"] = serde_json::to_value(&g.points).map_err(native)?;
                let digest = sha(&serde_json::to_vec(
                    &json!({"params":g.params,"firstSeq":1,"throughSeq":g.through}),
                )
                .map_err(native)?);
                let saved_params = g.params.clone();
                let saved_points = g.points;
                let saved_id = g.id;
                let saved_pred = g.predecessor;
                self.failed_active = Some(RetainedActive {
                    id: saved_id,
                    params: saved_params,
                    doc: g.live.doc.clone(),
                    through: *through_seq,
                });
                let adopted = h
                    .engine
                    .offer_live_stroke(g.live)
                    .and_then(|_| h.engine.execute("paint.stroke", g.params));
                if !adopted.as_ref().is_ok_and(|v| v["fromLive"] == true) {
                    let restored = h.engine.host_restore(g.checkpoint);
                    let error = Error::retained(
                        "pipeline-blocked",
                        format!(
                            "live adoption failed; original full input and preview snapshot retained; rollback: {:?}",
                            restored.err().map(|e| e.to_string())
                        ),
                    );
                    self.blocked = Some(error.clone());
                    return Err(error);
                }
                let (doc, target) = match h
                    .document()
                    .and_then(|doc| h.target().map(|target| (doc, target)))
                {
                    Ok(value) => value,
                    Err(error) => {
                        let error = Error::retained(
                            "pipeline-blocked",
                            format!(
                                "adopted stroke context unavailable; full input retained: {error}"
                            ),
                        );
                        self.blocked = Some(error.clone());
                        return Err(error);
                    }
                };
                let queued = json!({"kind":"queued","candidateId":r.operation_id,"pipelineId":self.id,"predecessorOperationId":saved_pred,"durable":false,"inputThrough":through_seq,"frameInputThrough":h.epoch_input_through,"epoch":h.display_epoch,"queueDepth":self.entries.len()+1,"availableSlots":self.limits.max_pending_strokes.saturating_sub(self.entries.len()+1),"inputDigest":digest});
                self.entries.push_back(Entry {
                    id: r.operation_id.clone(),
                    fingerprint: fingerprint.clone(),
                    doc: doc.clone(),
                    points: saved_points,
                    state: queued.clone(),
                    admission: queued.clone(),
                    prepared: None,
                    accepting: false,
                    accepted: false,
                });
                self.seen
                    .insert(r.operation_id.clone(), fingerprint.clone());
                self.last_completed = Some(r.operation_id.clone());
                self.failed_active = None;
                if let Err(error) = h.engine.host_clear_history() {
                    let error = Error::retained(
                        "pipeline-blocked",
                        format!(
                            "adopted stroke and full input retained; scratch settlement failed: {error}"
                        ),
                    );
                    if let Some(entry) = self.entries.back_mut() {
                        entry.state = json!({"kind":"failure","error":error});
                    }
                    self.blocked = Some(error.clone());
                    return Err(error);
                }
                if let Some((_, _, preview)) = &mut h.last_frame {
                    *preview = None;
                }
                let work = Work::Prepare {
                    request: r.clone(),
                    fingerprint,
                    predecessor: saved_pred,
                    anchor: self.anchor.clone(),
                    doc,
                    target,
                    source: h.source.clone(),
                    through: *through_seq,
                    frame_through: h.epoch_input_through,
                    epoch: h.display_epoch,
                    input_digest: digest,
                };
                if self
                    .tx
                    .as_ref()
                    .ok_or_else(|| Error::unknown("persistence owner missing"))?
                    .try_send(work)
                    .is_err()
                {
                    self.blocked = Some(Error::unknown(
                        "persistence submission failed; immutable stroke and input retained",
                    ));
                    return Err(self.blocked.clone().unwrap());
                }
                self.decorate_queue_only(queued)
            }
            Command::Accept { candidate_id } => {
                valid_id(candidate_id)?;
                if let Some((_, _, state)) =
                    self.recent.iter().find(|(id, _, _)| id == candidate_id)
                {
                    if state["kind"] == "accepted" {
                        return Ok((state.clone(), vec![]));
                    }
                }
                if let Some(entry) = self
                    .entries
                    .iter()
                    .find(|e| &e.id == candidate_id && e.accepted)
                {
                    return Ok((entry.state.clone(), vec![]));
                }
                let index = self
                    .entries
                    .iter()
                    .position(|e| !e.accepted)
                    .ok_or_else(|| Error::none("not-found", "no pending pipeline candidate"))?;
                let e = &mut self.entries[index];
                if &e.id != candidate_id {
                    return Err(Error::none(
                        "conflict",
                        "Main must accept prepared candidates FIFO",
                    ));
                }
                if e.accepting {
                    return Ok((
                        json!({"kind":"acceptQueued","candidateId":candidate_id,"pipelineId":self.id,"durable":false}),
                        vec![],
                    ));
                }
                let prepared = e
                    .prepared
                    .as_ref()
                    .ok_or_else(|| Error::none("busy", "candidate is not durably prepared"))?;
                if r.base_version != h.current || prepared["baseVersion"] != json!(h.current) {
                    return Err(Error::none(
                        "conflict",
                        "accepted project base differs from candidate predecessor",
                    ));
                }
                if self.blocked.is_some() {
                    return Err(Error::retained(
                        "pipeline-blocked",
                        "IO failed; query/reconcile before native accept",
                    ));
                }
                self.tx
                    .as_ref()
                    .ok_or_else(|| Error::unknown("persistence owner missing"))?
                    .try_send(Work::Accept {
                        id: candidate_id.clone(),
                        base: h
                            .current
                            .clone()
                            .ok_or_else(|| Error::none("conflict", "accepted base missing"))?,
                    })
                    .map_err(|_| Error::retained("busy", "accept work queue full; not enqueued"))?;
                e.accepting = true;
                Ok((
                    json!({"kind":"acceptQueued","candidateId":candidate_id,"pipelineId":self.id,"durable":false}),
                    vec![],
                ))
            }
            Command::Status {
                target_operation_id,
            } => {
                if let Some(e) = self.entries.iter().find(|e| &e.id == target_operation_id) {
                    return Ok((
                        json!({"kind":"status","state":e.state["kind"],"result":e.state,"admission":e.admission,"acceptPending":e.accepting&&!e.accepted}),
                        vec![],
                    ));
                }
                if let Some((_, _, state)) = self
                    .recent
                    .iter()
                    .find(|(id, _, _)| id == target_operation_id)
                {
                    return Ok((
                        json!({"kind":"status","state":state["kind"],"result":state}),
                        vec![],
                    ));
                }
                Err(Error::retained(
                    "needs-settled-query",
                    "historical status requires settled pipelineStop; not reported absent",
                ))
            }
            Command::StrokeCancel { preview_id } => {
                let g = h
                    .gesture
                    .as_ref()
                    .ok_or_else(|| Error::none("not-found", "active stroke missing"))?;
                if &g.id != preview_id {
                    return Err(Error::none("conflict", "gesture ID mismatch"));
                }
                let g = h
                    .gesture
                    .take()
                    .ok_or_else(|| Error::unknown("gesture disappeared"))?;
                h.engine.host_restore(g.checkpoint).map_err(native)?;
                h.display_epoch += 1;
                h.epoch_input_through = 0;
                h.last_frame = None;
                Ok((
                    json!({"kind":"cancelled","previewId":preview_id,"durable":false}),
                    vec![],
                ))
            }
            Command::Capture => {
                if self.failed_active.is_some() {
                    return Err(Error::retained(
                        "pipeline-blocked",
                        "failed active preview retained; keep last display until reconciliation",
                    ));
                }
                self.input_base(r)?;
                self.decorate(h, r)
            }
            Command::Freeze => {
                self.sealed = true;
                if h.gesture.is_some() || !self.entries.is_empty() || self.blocked.is_some() {
                    return Err(Error::retained(
                        "busy",
                        "pipeline sealed; retain/finish active prefix and settle IO obligations",
                    ));
                }
                h.frozen = true;
                Ok((json!({"kind":"frozen","versionId":h.current}), vec![]))
            }
            _ => Err(Error::none(
                "busy",
                "settled pipelineStop required before this command",
            )),
        }
    }
    fn decorate_queue_only(&self, value: Value) -> Result<(Value, Vec<u8>)> {
        Ok((value, vec![]))
    }
}
pub(super) fn dispatch(h: &mut Host, r: &Request, payload: &[u8]) -> Result<(Value, Vec<u8>)> {
    if let Command::PipelineStart {
        max_pending_strokes,
        max_pending_points,
        max_retained_pixel_bytes,
    } = &r.body
    {
        if h.pipeline.is_some() {
            return Err(Error::none("busy", "pipeline already active"));
        }
        h.idle()?;
        h.base(r)?;
        if !payload.is_empty() {
            return Err(Error::none("invalid-input", "unexpected pipeline payload"));
        }
        if *max_pending_strokes == 0
            || *max_pending_strokes > MAX_STROKES
            || *max_pending_points == 0
            || *max_pending_points > MAX_POINTS
            || *max_retained_pixel_bytes == 0
            || *max_retained_pixel_bytes > MAX_PIXELS
        {
            return Err(Error::none("limit", "pipeline limits exceed host caps"));
        }
        let anchor = h
            .current
            .clone()
            .ok_or_else(|| Error::none("conflict", "pipeline requires accepted document"))?;
        let accepted_doc = h.document()?;
        let history = photocraft_ops::History::new(1);
        if history.pixel_bytes(&accepted_doc) > *max_retained_pixel_bytes {
            return Err(Error::none(
                "limit",
                "accepted document exceeds pipeline pixel budget",
            ));
        }
        let store = h.store.take()?;
        let (tx, work_rx) = mpsc::sync_channel(10);
        let (done_tx, rx) = mpsc::sync_channel(16);
        let thread = thread::spawn(move || writer(store, work_rx, done_tx));
        let id = format!(
            "pipeline-{}-{}",
            h.worker_epoch,
            &sha(r.operation_id.as_bytes())[..24]
        );
        let limits = Limits {
            max_pending_strokes: *max_pending_strokes,
            max_pending_points: *max_pending_points,
            max_retained_pixel_bytes: *max_retained_pixel_bytes,
        };
        h.display_epoch += 1;
        let result = json!({"kind":"pipelineReady","pipelineId":id,"anchorVersion":anchor,"limits":limits,"epoch":h.display_epoch,"documentId":accepted_doc.id.0.to_string()});
        h.epoch_input_through = 0;
        h.last_frame = None;
        h.pipeline = Some(Pipeline {
            id,
            anchor,
            limits,
            tx: Some(tx),
            rx,
            thread: Some(thread),
            entries: VecDeque::new(),
            events: VecDeque::new(),
            recent: VecDeque::new(),
            seen: HashMap::new(),
            last_completed: None,
            accepted_doc,
            failed_active: None,
            blocked: None,
            sealed: false,
        });
        return Ok((result, vec![]));
    }
    let mut pipeline = h
        .pipeline
        .take()
        .ok_or_else(|| Error::none("not-found", "pipeline not active"))?;
    if let Command::PipelineStop { pipeline_id } = &r.body {
        if !payload.is_empty() {
            h.pipeline = Some(pipeline);
            return Err(Error::none(
                "invalid-input",
                "unexpected pipeline stop payload",
            ));
        }
        if let Err(error) = pipeline.drain(h) {
            pipeline.blocked = Some(error.clone());
            h.pipeline = Some(pipeline);
            return Err(error);
        }
        if pipeline_id != &pipeline.id
            || h.gesture.is_some()
            || !pipeline.entries.is_empty()
            || !pipeline.events.is_empty()
            || pipeline.blocked.is_some()
        {
            h.pipeline = Some(pipeline);
            return Err(Error::retained(
                "busy",
                "pipeline stop requires matching ID and fully settled obligations",
            ));
        }
        pipeline.tx.take();
        let store = pipeline
            .thread
            .take()
            .ok_or_else(|| Error::unknown("persistence owner missing"))?
            .join()
            .map_err(|_| Error::unknown("persistence owner panicked"))?;
        h.store.put(store)?;
        h.display_epoch += 1;
        h.epoch_input_through = 0;
        h.last_frame = None;
        return Ok((
            json!({"kind":"pipelineStopped","pipelineId":pipeline_id,"versionId":h.current,"epoch":h.display_epoch,"documentId":h.document()?.id.0.to_string()}),
            vec![],
        ));
    }
    let result = pipeline.run(h, r, payload);
    h.pipeline = Some(pipeline);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revoked_engine_authority_at_finish_preserves_whole_admitted_prefix() {
        let root = std::env::temp_dir().join(format!(
            "flow-native-adoption-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut host = Host::open(&root, 32 << 20).unwrap();
        fn call(host: &mut Host, op: &str, base: Option<&str>, body: Value) -> Value {
            let request:Request=serde_json::from_value(json!({"protocol":1,"requestId":op,"sessionId":"s","incarnation":"i","workerEpoch":host.worker_epoch,"operationId":op,"baseVersion":base,"body":body})).unwrap();
            host.handle(request, vec![]).header["body"].clone()
        }
        let new = call(
            &mut host,
            "new",
            None,
            json!({"kind":"new","width":512,"height":64}),
        );
        let base = new["receipt"]["versionId"].as_str().unwrap().to_owned();
        assert_eq!(
            call(
                &mut host,
                "accept",
                None,
                json!({"kind":"accept","candidateId":"new"})
            )["kind"],
            "accepted"
        );
        let started = call(
            &mut host,
            "start",
            Some(&base),
            json!({"kind":"pipelineStart","maxPendingStrokes":2,"maxPendingPoints":32,"maxRetainedPixelBytes":16777216}),
        );
        let id = started["pipelineId"].clone();
        assert_eq!(
            call(
                &mut host,
                "begin",
                Some(&base),
                json!({"kind":"strokeBegin","previewId":"p","brush":{"seed":9,"size":12},"points":[{"x":20,"y":20}]})
            )["kind"],
            "frame"
        );
        assert_eq!(
            call(
                &mut host,
                "append",
                Some(&base),
                json!({"kind":"strokeAppend","previewId":"p","fromSeq":2,"points":[{"x":80,"y":20}]})
            )["kind"],
            "frame"
        );
        fn deny(_id: &str, _params: &Value) -> photocraft_engine::Result<()> {
            Err(photocraft_engine::EngineError::Other(
                "synthetic revoked command authority".into(),
            ))
        }
        host.engine.authorize = Some(deny);
        let failed = call(
            &mut host,
            "finish",
            Some(&base),
            json!({"kind":"strokeFinish","previewId":"p","throughSeq":2}),
        );
        assert_eq!(failed["kind"], "failure");
        assert_eq!(failed["error"]["effect"], "retained");
        let state = call(
            &mut host,
            "poll",
            Some(&base),
            json!({"kind":"pipelinePoll","pipelineId":id}),
        );
        assert_eq!(state["pendingPoints"], 2);
        assert_eq!(state["queueDepth"], 1);
        assert_eq!(state["active"]["throughSeq"], 2);
        assert!(state["blocked"].is_object());
        assert_eq!(
            call(&mut host, "capture", Some(&base), json!({"kind":"capture"}))["error"]["code"],
            "pipeline-blocked"
        );
        assert_eq!(
            call(&mut host, "freeze", Some(&base), json!({"kind":"freeze"}))["kind"],
            "failure"
        );
        eprintln!(
            "revoked authority retained input evidence: {}",
            root.display()
        );
    }
}
