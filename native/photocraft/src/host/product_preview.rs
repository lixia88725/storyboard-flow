//! One volatile product preview. Each absolute update starts at the same COW
//! document, restores the real engine checkpoint, and publishes only a display.
use super::*;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewStamp {
    pub document_id: String,
    pub worker_epoch: u64,
    pub epoch: u64,
    pub preview_id: String,
    pub through_seq: u64,
    pub base_version: String,
    pub source_context_generation: u64,
    pub edit_digest: String,
}
pub(super) struct EditPreview {
    pub stamp: PreviewStamp,
    pub doc: Arc<Document>,
    pub target: LayerTarget,
    pub blocked: Option<Error>,
    pub pending_operation: Option<String>,
}
impl EditPreview {
    pub(super) fn summary(&self) -> Value {
        json!({"stamp":self.stamp,"pendingOperationId":self.pending_operation,"blockedReason":self.blocked.as_ref().map(|e|&e.message)})
    }
}
fn digest(edit: &ProductEdit) -> Result<String> {
    Ok(sha(&serde_json::to_vec(edit).map_err(native)?))
}
impl Host {
    fn pending_preview_settled(&self, p: &EditPreview) -> Result<()> {
        if let Some(id) = &p.pending_operation {
            if self.store.op_read(id, "failed")?.is_none()
                && self.store.op_read(id, "discarded")?.is_none()
            {
                return Err(Error::retained(
                    "busy",
                    "preview preparation has a pending durable operation; Main must query/settle it before cancellation",
                ));
            }
        }
        Ok(())
    }
    pub(super) fn match_edit_preview(
        &self,
        stamp: &PreviewStamp,
        edit: &ProductEdit,
    ) -> Result<()> {
        let p = self
            .edit_preview
            .as_ref()
            .ok_or_else(|| Error::none("not-found", "product edit preview missing"))?;
        if &p.stamp != stamp
            || stamp.worker_epoch != self.worker_epoch
            || stamp.epoch != self.display_epoch
            || Some(&stamp.base_version) != self.current.as_ref()
            || stamp.document_id != self.document()?.id.0.to_string()
            || stamp.source_context_generation != self.context_generation
            || stamp.edit_digest != digest(edit)?
        {
            return Err(Error::none(
                "conflict",
                "product preview identity, prefix, base or final edit changed",
            ));
        }
        if let Some(e) = &p.blocked {
            return Err(e.clone());
        }
        self.pending_preview_settled(p)
    }
    pub(super) fn preview_edit(
        &mut self,
        r: &Request,
        id: &str,
        seq: u64,
        edit: &ProductEdit,
        generation: u64,
    ) -> Result<(Value, Vec<u8>)> {
        self.base(r)?;
        self.check_context(generation)?;
        valid_id(id)?;
        if !matches!(
            edit,
            ProductEdit::SetLayerOpacities { .. } | ProductEdit::Transform { .. }
        ) {
            return Err(Error::none(
                "unsupported",
                "temporary preview supports opacity sets and transforms only",
            ));
        }
        if seq == 0 || seq > 9_007_199_254_740_991 {
            return Err(Error::none(
                "invalid-input",
                "preview prefix must be a positive safe integer",
            ));
        }
        let hash = digest(edit)?;
        let first = self.edit_preview.is_none();
        if let Some(p) = &self.edit_preview {
            if let Some(e) = &p.blocked {
                return Err(e.clone());
            }
            self.pending_preview_settled(p)?;
            if p.stamp.preview_id != id
                || Some(&p.stamp.base_version) != self.current.as_ref()
                || p.stamp.source_context_generation != generation
            {
                return Err(Error::none(
                    "conflict",
                    "another product preview owns the fixed source",
                ));
            }
            if seq == p.stamp.through_seq && hash == p.stamp.edit_digest {
                let stamp = p.stamp.clone();
                let (mut frame, bytes) = self.preview(r)?;
                frame["editPreview"] = json!(stamp);
                return Ok((frame, bytes));
            }
            if p.stamp.through_seq.checked_add(1) != Some(seq) {
                return Err(Error::none(
                    "conflict",
                    "preview sequence gap or conflicting repeated update",
                ));
            }
        } else {
            self.context_idle()?;
            if seq != 1 || self.current.is_none() {
                return Err(Error::none(
                    "conflict",
                    "preview begins at one on an accepted document",
                ));
            }
        }
        self.validate_product_edit(edit)?;
        let source = self.document()?;
        let source_target = self.target()?;
        if photocraft_ops::History::new(1).pixel_bytes(&source) > 256 << 20 {
            return Err(Error::none(
                "limit",
                "preview retained pixel budget exceeds 256MiB",
            ));
        }
        let checkpoint = self.engine.host_checkpoint().map_err(native)?;
        let applied = self
            .apply_product(edit)
            .and_then(|_| Ok((self.document()?, self.target()?)));
        // Restore on every path; no caller can observe a mutated real Document.
        if let Err(e) = self.engine.host_restore(checkpoint) {
            let error = Error::retained(
                "engine",
                format!("product preview rollback failed; owner retained: {e}"),
            );
            self.edit_preview = Some(EditPreview {
                stamp: PreviewStamp {
                    document_id: source.id.0.to_string(),
                    worker_epoch: self.worker_epoch,
                    epoch: self.display_epoch,
                    preview_id: id.into(),
                    through_seq: seq,
                    base_version: self.current.clone().unwrap_or_default(),
                    source_context_generation: generation,
                    edit_digest: hash,
                },
                doc: source,
                target: source_target,
                blocked: Some(error.clone()),
                pending_operation: None,
            });
            return Err(error);
        }
        let (doc, target) = applied?;
        if photocraft_ops::History::new(1).pixel_bytes(&doc) > 256 << 20 {
            return Err(Error::none(
                "limit",
                "preview retained pixel budget exceeds 256MiB",
            ));
        }
        if first {
            self.display_epoch += 1;
            self.epoch_input_through = 0;
            self.last_frame = None;
        }
        let stamp = PreviewStamp {
            document_id: source.id.0.to_string(),
            worker_epoch: self.worker_epoch,
            epoch: self.display_epoch,
            preview_id: id.into(),
            through_seq: seq,
            base_version: self.current.clone().unwrap_or_default(),
            source_context_generation: generation,
            edit_digest: hash,
        };
        self.edit_preview = Some(EditPreview {
            stamp: stamp.clone(),
            doc,
            target,
            blocked: None,
            pending_operation: None,
        });
        // An output error after admission retains this prefix in summary. It is
        // never permission to resend a different edit at the same sequence.
        let (mut frame, bytes) = self
            .preview(r)
            .map_err(|e| Error::retained(&e.code, e.message))?;
        frame["editPreview"] = json!(stamp);
        Ok((frame, bytes))
    }
    pub(super) fn cancel_edit_preview(
        &mut self,
        r: &Request,
        stamp: &PreviewStamp,
    ) -> Result<(Value, Vec<u8>)> {
        self.base(r)?;
        if self.candidate.is_some() {
            return Err(Error::none(
                "busy",
                "candidate exists; only Main settlement can retire it",
            ));
        }
        let p = self
            .edit_preview
            .as_ref()
            .ok_or_else(|| Error::none("not-found", "product edit preview missing"))?;
        if &p.stamp != stamp
            || stamp.worker_epoch != self.worker_epoch
            || stamp.epoch != self.display_epoch
            || stamp.source_context_generation != self.context_generation
            || Some(&stamp.base_version) != self.current.as_ref()
        {
            return Err(Error::none(
                "conflict",
                "cancel does not match active product preview",
            ));
        }
        if let Some(e) = &p.blocked {
            return Err(e.clone());
        }
        self.pending_preview_settled(p)?;
        self.edit_preview = None;
        self.display_epoch += 1;
        self.epoch_input_through = 0;
        self.last_frame = None;
        Ok((
            json!({"kind":"editPreviewCancelled","previewId":stamp.preview_id,"throughSeq":stamp.through_seq,"versionId":self.current,"durable":false}),
            vec![],
        ))
    }
}
