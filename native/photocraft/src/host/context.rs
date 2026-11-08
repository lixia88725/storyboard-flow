//! Bounded read-only tool context and explicit transient floating ownership.
use super::*;
use photocraft_doc::LayerId;

pub const MAX_SUMMARY_BYTES: usize = 48 << 10;
/// Valid wire identities are canonical decimal strings. Keep malformed JSON only
/// long enough to return a normal rejection, never coerce a legacy Number to u64.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LayerIdInput {
    Decimal(String),
    Invalid(Value),
}
impl LayerIdInput {
    pub(super) fn parse(&self) -> Result<LayerId> {
        let Self::Decimal(value) = self else {
            return Err(Error::none(
                "invalid-input",
                "layerId must be a canonical decimal string; numeric IDs are unsupported",
            ));
        };
        let id = value.parse::<u64>().map_err(|_| {
            Error::none(
                "invalid-input",
                "layerId must be a canonical decimal u64 string",
            )
        })?;
        if id.to_string() != *value {
            return Err(Error::none(
                "invalid-input",
                "layerId must be a canonical decimal u64 string",
            ));
        }
        Ok(LayerId(id))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum FloatingAction {
    Begin {
        dx: i32,
        dy: i32,
    },
    Move {
        #[serde(rename = "fromSeq")]
        from_seq: u64,
        dx: i32,
        dy: i32,
    },
    Cancel {
        #[serde(rename = "throughSeq")]
        through_seq: u64,
    },
    Drop {
        #[serde(rename = "throughSeq")]
        through_seq: u64,
    },
}
pub(super) struct FloatingContext {
    pub id: String,
    pub base: String,
    pub through: u64,
    pub layer: u64,
    pub offset: (i32, i32),
    pub outline: Option<Rect>,
    pub original: Option<Checkpoint>,
    pub blocked: Option<Error>,
}
#[derive(PartialEq)]
pub(super) struct Stamp {
    doc: Option<u64>,
    active: Option<u64>,
    selected: Vec<u64>,
}
impl Host {
    pub(super) fn context_stamp(&self) -> Stamp {
        Stamp {
            doc: self.engine.active().map(|s| s.doc.id.0),
            active: self
                .engine
                .active()
                .and_then(|s| s.active_layer)
                .map(|id| id.0),
            selected: self
                .engine
                .active()
                .map(|s| s.selected_layers.iter().map(|id| id.0).collect())
                .unwrap_or_default(),
        }
    }
    pub(super) fn advance_context(&mut self) {
        self.context_generation = self.context_generation.saturating_add(1);
        if let Some(selection) = self.temporary_selection.as_mut() {
            selection.generation = self.context_generation;
        }
    }
    fn selection_token(&self) -> Option<String> {
        self.engine
            .active()
            .filter(|s| s.doc.selection.is_some())
            .map(|s| {
                format!(
                    "selection-{}-{}-{}",
                    self.worker_epoch, s.doc.id.0, self.context_generation
                )
            })
    }
    pub(super) fn check_context(&self, generation: u64) -> Result<()> {
        if generation != self.context_generation {
            return Err(Error::none(
                "stale-context",
                "context generation changed; query summary before retry",
            ));
        }
        Ok(())
    }
    pub(super) fn context_idle(&self) -> Result<()> {
        if self.pipeline.is_some() {
            return Err(Error::none(
                "busy",
                "stop and settle pipeline before changing tool context",
            ));
        }
        self.idle()?;
        if self.floating_context.is_some()
            || self.engine.active().is_some_and(|s| s.floating.is_some())
        {
            return Err(Error::none(
                "busy",
                "explicitly cancel or drop floating selection first",
            ));
        }
        Ok(())
    }
    pub(super) fn context_idle_for_install(&self) -> Result<()> {
        self.context_idle()
    }
    pub(super) fn context_summary(&self, max_bytes: usize, pipeline_active: bool) -> Result<Value> {
        if max_bytes == 0 || max_bytes > MAX_SUMMARY_BYTES {
            return Err(Error::none("limit", "summary maxBytes must be 1..48KiB"));
        }
        let state = self
            .engine
            .active()
            .ok_or_else(|| Error::none("not-found", "no document"))?;
        let doc = &state.doc;
        let layers = bounded_layer_tree(doc, max_bytes)?;
        fn bounds(r: Rect) -> Value {
            json!([r.x0, r.y0, r.width(), r.height()])
        }
        let floating=self.floating_context.as_ref().map(|g| {
            let phase=if g.blocked.is_some(){"blocked"}else if self.candidate.as_ref().is_some_and(|c|c.from_floating){"dropPrepared"}else{"active"};
            json!({"previewId":g.id,"throughSeq":g.through,"sourceLayerId":g.layer.to_string(),"offset":[g.offset.0,g.offset.1],"phase":phase,"baseVersion":g.base,"outlineBounds":g.outline.map(|r|json!([i64::from(r.x0)+i64::from(g.offset.0),i64::from(r.y0)+i64::from(g.offset.1),r.width(),r.height()]))})
        });
        let general_busy = self.edit_preview.is_some()
            || self.frozen
            || self.candidate.is_some()
            || self.gesture.is_some()
            || pipeline_active
            || self.store.context_unsettled();
        let float_active = self.floating_context.is_some();
        let mut tools = serde_json::Map::new();
        for (name, id) in [
            ("newLayer", "layer.new.layer"),
            ("rect", "select.rect"),
            ("lasso", "select.lasso"),
            ("transform", "edit.transform"),
            ("blur", "filter.blur.gaussianBlur"),
            ("fill", "paint.bucket"),
            ("setLayer", "layer.setProps"),
            ("setLayerOpacities", "layer.setProps"),
            ("removeLayer", "layer.delete"),
            ("moveLayers", "layer.moveTo"),
            ("clear", "edit.clear"),
            ("merge", "layer.mergeLayers"),
            ("mergeVisible", "layer.mergeVisible"),
            ("paint", "paint.stroke"),
            ("floatBegin", "select.float"),
        ] {
            let mut native_reason = photocraft_engine::commands::find(id).map_or_else(
                || Some("native command unavailable".into()),
                |spec| (spec.enabled)(&self.engine).err(),
            );
            // Upstream enabled predicates often check only the content kind. Surface locks
            // are checked later during execute; expose those refusals without mutating pixels.
            if matches!(name, "paint" | "blur" | "fill")
                && state.active_layer.is_some_and(|id| {
                    let locks = doc.effective_locks(id);
                    locks.all || locks.pixels
                })
            {
                native_reason = Some("active layer pixels are locked".into());
            }
            if name == "paint" && photocraft_ops::History::new(1).pixel_bytes(doc) > 256 << 20 {
                native_reason = Some(
                    "document exceeds the 256MiB current live-pipeline retained-pixel budget"
                        .into(),
                );
            }
            if name == "paint" && doc.selection.is_some() {
                native_reason=Some("source intrinsic selection is not exposed as a product paint constraint; product painting is refused".into());
            }
            let reason = if general_busy {
                Some("settle active/frozen/pipeline obligations".to_owned())
            } else if float_active {
                Some("settle floating selection".to_owned())
            } else {
                native_reason
            };
            tools.insert(
                name.into(),
                json!({"enabled":reason.is_none(),"reason":reason}),
            );
        }
        let float_ready = self
            .floating_context
            .as_ref()
            .is_some_and(|f| f.blocked.is_none())
            && !self.frozen
            && self.candidate.is_none()
            && self.gesture.is_none()
            && !pipeline_active;
        tools.insert(
            "selectLayerContext".into(),
            json!({"enabled":!general_busy&&!float_active}),
        );
        tools.insert("selectionContext".into(),json!({"enabled":!general_busy&&!float_active&&state.active_layer.is_some_and(|id|doc.layer(id).is_some_and(|l|matches!(l.content,LayerContent::Raster(_))))}));
        tools.insert("floatMove".into(), json!({"enabled":float_ready}));
        tools.insert("floatCancel".into(), json!({"enabled":float_ready}));
        tools.insert(
            "floatDrop".into(),
            json!({"enabled":float_ready&&!self.store.context_unsettled()}),
        );
        let erased_to_background = state
            .active_layer
            .is_some_and(|id| doc.effective_locks(id).transparency);
        let result = json!({"kind":"contextSummary","documentId":doc.id.0.to_string(),"imageVersionRef":self.current,"epoch":self.display_epoch,"contextGeneration":self.context_generation,"maxSummaryBytes":MAX_SUMMARY_BYTES,"layerCount":doc.layer_count(),"layers":layers,"activeLayerId":state.active_layer.map(|id|id.0.to_string()),"selectedLayerIds":state.selected_layers.iter().map(|id|id.0.to_string()).collect::<Vec<_>>(),"background":self.detached.activity(&self.store.shared),"editPreview":self.edit_preview.as_ref().map(|p|p.summary()),"temporarySelection":self.temporary_selection.as_ref().map(|s|s.summary(self)),"selection":{"present":doc.selection.is_some(),"token":self.selection_token(),"bounds":doc.selection.as_ref().map(|s|bounds(s.content_bounds()))},"floating":floating,"candidateId":self.candidate.as_ref().map(|c|&c.id),"inputActive":self.gesture.is_some(),"pipelineActive":pipeline_active,"frozen":self.frozen,"settlementRequired":self.store.context_unsettled()||self.candidate.is_some()||self.edit_preview.is_some(),"tools":tools,"sourceDisplayPolicy":self.source.as_ref().and_then(|s|s.display_policy.as_ref()),"paintScope":if doc.selection.is_some(){"source-selection-refused"}else{"full-layer"},"eraserBehavior":if erased_to_background {"backgroundColor"}else{"alpha"}});
        if serde_json::to_vec(&result).map_err(native)?.len() > max_bytes {
            return Err(Error::none(
                "limit",
                "context summary exceeds maxBytes; no partial tree returned",
            ));
        }
        Ok(result)
    }
    pub(super) fn select_context(
        &mut self,
        r: &Request,
        layer_id: &LayerIdInput,
        generation: u64,
    ) -> Result<(Value, Vec<u8>)> {
        let layer_id = layer_id.parse()?;
        self.base(r)?;
        self.check_context(generation)?;
        self.context_idle()?;
        // Public upstream context operation: no dispatch auto-drop and no native/Flow history step.
        self.engine.select_layer(layer_id).map_err(native)?;
        self.temporary_selection = None;
        self.advance_context();
        Ok((
            json!({"kind":"contextUpdated","documentId":self.document()?.id.0.to_string(),"imageVersionRef":self.current,"contextGeneration":self.context_generation,"activeLayerId":layer_id.0.to_string(),"selectedLayerIds":[layer_id.0.to_string()]}),
            vec![],
        ))
    }
    pub(super) fn floating_command(
        &mut self,
        r: &Request,
        id: &str,
        generation: u64,
        action: &FloatingAction,
    ) -> Result<(Value, Vec<u8>)> {
        if matches!(action, FloatingAction::Drop { .. }) {
            if let Some(v) = self.replay(r)? {
                return Ok((v, vec![]));
            }
        }
        self.base(r)?;
        self.check_context(generation)?;
        valid_id(id)?;
        if self.pipeline.is_some()
            || self.frozen
            || self.gesture.is_some()
            || self.candidate.is_some()
        {
            return Err(Error::none(
                "busy",
                "settle paint/candidate/pipeline before floating control",
            ));
        }
        if let FloatingAction::Begin { dx, dy } | FloatingAction::Move { dx, dy, .. } = action {
            let offset = self.floating_context.as_ref().map_or((0, 0), |g| g.offset);
            if [
                i64::from(*dx),
                i64::from(*dy),
                i64::from(offset.0) + i64::from(*dx),
                i64::from(offset.1) + i64::from(*dy),
            ]
            .iter()
            .any(|v| v.abs() > 10_000_000)
            {
                return Err(Error::none(
                    "limit",
                    "floating offset exceeds exact native coordinate budget",
                ));
            }
        }
        match action {
            FloatingAction::Begin { dx, dy } => {
                if self
                    .engine
                    .active()
                    .and_then(|s| s.active_layer)
                    .is_some_and(|id| source_guard::protected_target(self, id).unwrap_or(true))
                {
                    return Err(Error::none(
                        "protected-source",
                        "floating cannot cut the protected reference base",
                    ));
                }
                self.context_idle()?;
                let checkpoint = self.engine.host_checkpoint().map_err(native)?;
                if let Err(error) = self
                    .engine
                    .execute("select.float", json!({"dx":dx,"dy":dy}))
                {
                    self.restore_float_checkpoint(id, checkpoint)?;
                    return Err(Error::retained("engine", error.to_string()));
                }
                let (layer, offset, outline) = match self.float_native_state() {
                    Ok(state) => state,
                    Err(error) => {
                        self.restore_float_checkpoint(id, checkpoint)?;
                        return Err(error);
                    }
                };
                self.floating_context = Some(FloatingContext {
                    id: id.into(),
                    base: self.current.clone().ok_or_else(|| {
                        Error::none("conflict", "floating requires accepted base")
                    })?,
                    through: 1,
                    layer,
                    offset,
                    outline,
                    original: Some(checkpoint),
                    blocked: None,
                });
                self.advance_context();
                Ok((self.floating_ack("floatingPreview"), vec![]))
            }
            FloatingAction::Move { from_seq, dx, dy } => {
                let g = self
                    .floating_context
                    .as_ref()
                    .ok_or_else(|| Error::none("not-found", "floating gesture missing"))?;
                if g.id != id
                    || g.base != self.current.clone().unwrap_or_default()
                    || g.through
                        .checked_add(1)
                        .filter(|v| *v <= 9_007_199_254_740_991)
                        != Some(*from_seq)
                {
                    return Err(Error::none(
                        "conflict",
                        "floating identity/input prefix mismatch; query summary",
                    ));
                }
                if g.blocked.is_some() {
                    return Err(Error::retained("busy", "floating rollback is unresolved"));
                }
                let checkpoint = self.engine.host_checkpoint().map_err(native)?;
                if let Err(error) = self
                    .engine
                    .execute("select.float", json!({"dx":dx,"dy":dy}))
                {
                    self.restore_float_checkpoint(id, checkpoint)?;
                    return Err(Error::retained("engine", error.to_string()));
                }
                let (_, offset, outline) = match self.float_native_state() {
                    Ok(state) => state,
                    Err(error) => {
                        self.restore_float_checkpoint(id, checkpoint)?;
                        return Err(error);
                    }
                };
                let g = self
                    .floating_context
                    .as_mut()
                    .ok_or_else(|| Error::unknown("floating owner missing"))?;
                g.through += 1;
                g.offset = offset;
                g.outline = outline;
                self.advance_context();
                Ok((self.floating_ack("floatingPreview"), vec![]))
            }
            FloatingAction::Cancel { through_seq } => {
                self.float_prefix(id, *through_seq)?;
                let mut g = self
                    .floating_context
                    .take()
                    .ok_or_else(|| Error::unknown("floating owner missing"))?;
                let Some(checkpoint) = g.original.take() else {
                    let error = Error::retained("busy", "original floating checkpoint unavailable");
                    g.blocked = Some(error.clone());
                    self.floating_context = Some(g);
                    self.advance_context();
                    return Err(error);
                };
                if let Err(error) = self.engine.host_restore(checkpoint) {
                    let error = Error::retained(
                        "engine",
                        format!("cancel restore failed; floating evidence retained: {error}"),
                    );
                    g.blocked = Some(error.clone());
                    self.floating_context = Some(g);
                    self.advance_context();
                    return Err(error);
                }
                self.display_epoch += 1;
                self.epoch_input_through = 0;
                self.last_frame = None;
                self.advance_context();
                Ok((
                    json!({"kind":"floatingCancelled","previewId":id,"throughSeq":through_seq,"durable":false,"contextGeneration":self.context_generation,"epoch":self.display_epoch,"selectionToken":self.selection_token()}),
                    vec![],
                ))
            }
            FloatingAction::Drop { through_seq } => {
                self.float_prefix(id, *through_seq)?;
                if !self.store.unresolved()?.is_empty() {
                    return Err(Error::retained(
                        "busy",
                        "settle durable operation evidence before floating drop",
                    ));
                }
                let checkpoint = self.engine.host_checkpoint().map_err(native)?;
                self.intent(r)?;
                if let Err(error) = self.engine.execute("select.drop", json!({})) {
                    self.restore_float_checkpoint(id, checkpoint)?;
                    return Err(Error::retained("engine", error.to_string()));
                }
                self.advance_context();
                let prepared = self.prepare(r, Some(checkpoint), None)?;
                Ok((prepared, vec![]))
            }
        }
    }
    pub(super) fn restore_float_checkpoint(
        &mut self,
        id: &str,
        checkpoint: Checkpoint,
    ) -> Result<()> {
        if let Err(error) = self.engine.host_restore(checkpoint) {
            let error = Error::retained(
                "engine",
                format!("floating rollback refused; owner remains blocked: {error}"),
            );
            if let Some(g) = self.floating_context.as_mut() {
                g.blocked = Some(error.clone());
            } else {
                let (layer, offset, outline) =
                    self.float_native_state().unwrap_or((0, (0, 0), None));
                self.floating_context = Some(FloatingContext {
                    id: id.into(),
                    base: self.current.clone().unwrap_or_default(),
                    through: 0,
                    layer,
                    offset,
                    outline,
                    original: None,
                    blocked: Some(error.clone()),
                });
            }
            self.advance_context();
            return Err(error);
        }
        Ok(())
    }
    fn float_native_state(&self) -> Result<(u64, (i32, i32), Option<Rect>)> {
        let state = self
            .engine
            .active()
            .ok_or_else(|| Error::unknown("floating document missing"))?;
        let f = photocraft_engine::float_cmds::floating(state)
            .ok_or_else(|| Error::unknown("floating continuation missing"))?;
        Ok((
            f.layer.0,
            f.offset,
            f.parts.outline().map(|s| s.content_bounds()),
        ))
    }
    fn float_prefix(&self, id: &str, through: u64) -> Result<()> {
        let g = self
            .floating_context
            .as_ref()
            .ok_or_else(|| Error::none("not-found", "floating gesture missing"))?;
        if g.id != id || g.base != self.current.clone().unwrap_or_default() || g.through != through
        {
            return Err(Error::none(
                "conflict",
                "floating identity/whole prefix mismatch",
            ));
        }
        if g.blocked.is_some() {
            return Err(Error::retained("busy", "floating rollback unresolved"));
        }
        Ok(())
    }
    fn floating_ack(&self, kind: &str) -> Value {
        match &self.floating_context {
            Some(g) => {
                json!({"kind":kind,"previewId":g.id,"throughSeq":g.through,"offset":[g.offset.0,g.offset.1],"durable":false,"contextGeneration":self.context_generation,"selectionToken":self.selection_token()})
            }
            None => json!({"kind":"failure","error":Error::unknown("floating owner unavailable")}),
        }
    }
}

pub(super) fn bounded_layer_tree(doc: &Document, max_bytes: usize) -> Result<Value> {
    // Bound temporary JSON allocation before cloning names or traversing a large tree.
    fn preflight(layers: &[Layer], depth: usize, remaining: &mut usize) -> Result<()> {
        if depth > 128 {
            return Err(Error::none("limit", "layer tree exceeds summary depth"));
        }
        for layer in layers {
            *remaining = remaining
                .checked_sub(layer.name.len().saturating_add(64))
                .ok_or_else(|| {
                    Error::none(
                        "limit",
                        "layer tree exceeds summary budget; no partial tree returned",
                    )
                })?;
            if let Some(children) = layer.children() {
                preflight(children, depth + 1, remaining)?;
            }
        }
        Ok(())
    }

    fn tree(doc: &Document, layers: &[Layer]) -> Vec<Value> {
        layers.iter().rev().map(|l|json!({"layerId":l.id.0.to_string(),"name":l.name,"kind":match l.content {LayerContent::Raster(_)=>"raster",LayerContent::Group(_)=>"group",_=>"unsupported"},"visible":l.visible,"opacity":l.opacity,"blend":l.blend,"locks":l.locks,"effectiveLocks":doc.effective_locks(l.id),"children":l.children().map(|c|tree(doc,c)).unwrap_or_default()})).collect()
    }

    let mut remaining = max_bytes;
    preflight(&doc.layers, 0, &mut remaining)?;
    let value = json!(tree(doc, &doc.layers));
    if serde_json::to_vec(&value).map_err(native)?.len() > max_bytes {
        return Err(Error::none("limit", "layer summary exceeds budget"));
    }
    Ok(value)
}
