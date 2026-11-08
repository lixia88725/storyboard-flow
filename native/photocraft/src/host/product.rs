//! Product intent translation. The host owns temporary geometry; native Document
//! selections and source layer masks remain immutable content, never UI scratch.
use super::*;
use photocraft_doc::LayerId;
use photocraft_raster::Surface;
use std::collections::HashSet;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectionPoint {
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerPatch {
    pub name: Option<String>,
    pub visible: Option<bool>,
    pub locked: Option<bool>,
    pub opacity: Option<f64>,
    pub blend_mode: Option<Blend>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Blend {
    Normal,
    Multiply,
    Screen,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpacityChange {
    pub layer_id: LayerIdInput,
    pub before: f64,
    pub opacity: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Placement {
    Before,
    After,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProductEdit {
    NewLayer {
        name: String,
    },
    SetLayer {
        #[serde(rename = "layerId")]
        layer_id: LayerIdInput,
        patch: LayerPatch,
    },
    SetLayerOpacities {
        changes: Vec<OpacityChange>,
    },
    RemoveLayer {
        #[serde(rename = "layerId")]
        layer_id: LayerIdInput,
    },
    MoveLayers {
        #[serde(rename = "layerIds")]
        layer_ids: Vec<LayerIdInput>,
        #[serde(rename = "targetLayerId")]
        target_layer_id: LayerIdInput,
        placement: Placement,
    },
    Clear {
        #[serde(rename = "layerId")]
        layer_id: LayerIdInput,
    },
    Merge {
        #[serde(rename = "layerIds")]
        layer_ids: Vec<LayerIdInput>,
    },
    MergeVisible,
    Blur {
        #[serde(rename = "layerId")]
        layer_id: LayerIdInput,
        radius: f64,
        selection: Option<Vec<SelectionPoint>>,
    },
    Fill {
        #[serde(rename = "layerId")]
        layer_id: LayerIdInput,
        x: f64,
        y: f64,
        color: [u8; 4],
        tolerance: u8,
    },
    Transform {
        #[serde(rename = "layerId")]
        layer_id: LayerIdInput,
        selection: Vec<SelectionPoint>,
        matrix: [f64; 6],
    },
}
#[derive(Clone)]
pub(super) struct TemporarySelection {
    pub layer: LayerId,
    pub points: Vec<SelectionPoint>,
    pub mask: Surface,
    pub generation: u64,
    pub document: u64,
}
impl TemporarySelection {
    pub(super) fn summary(&self, host: &Host) -> Value {
        let r = self.mask.content_bounds();
        json!({"layerId":self.layer.0.to_string(),"documentId":self.document.to_string(),"contextGeneration":self.generation,"pointCount":self.points.len(),"token":format!("temporary-{}-{}-{}",host.worker_epoch,self.document,self.generation),"bounds":[r.x0,r.y0,r.width(),r.height()]})
    }
}
fn invalid(message: impl Into<String>) -> Error {
    Error::none("invalid-input", message)
}
fn coord(n: f64) -> bool {
    n.is_finite() && n.abs() <= 1_000_000.0
}
fn unit(n: f64) -> bool {
    n.is_finite() && (0.0..=1.0).contains(&n)
}
fn polygon(points: &[SelectionPoint]) -> Result<()> {
    if !(3..=4096).contains(&points.len()) || points.iter().any(|p| !coord(p.x) || !coord(p.y)) {
        return Err(invalid("selection requires 3..4096 finite points"));
    }
    let (mut lo, mut hi) = (
        (f64::INFINITY, f64::INFINITY),
        (f64::NEG_INFINITY, f64::NEG_INFINITY),
    );
    for p in points {
        lo = (lo.0.min(p.x), lo.1.min(p.y));
        hi = (hi.0.max(p.x), hi.1.max(p.y));
    }
    if lo.0 >= hi.0 || lo.1 >= hi.1 {
        return Err(invalid("selection has no two-dimensional extent"));
    }
    Ok(())
}
fn mask(doc: &Document, points: &[SelectionPoint]) -> Result<Surface> {
    polygon(points)?;
    // Bounded one-document COW scratch context. No IO, globals or original mask
    // modification; upstream owns antialias/rasterization semantics.
    let mut scratch = Session::new();
    scratch.add_document(doc.clone(), None);
    scratch.execute("select.lasso",json!({"points":points.iter().map(|p|[p.x,p.y]).collect::<Vec<_>>(),"mode":"replace","antiAlias":true,"feather":0})).map_err(native)?;
    scratch
        .active()
        .and_then(|s| s.doc.selection.clone())
        .ok_or_else(|| invalid("selection does not intersect the canvas"))
}
fn ids(values: &[LayerIdInput], minimum: usize) -> Result<Vec<LayerId>> {
    if !(minimum..=64).contains(&values.len()) {
        return Err(invalid("layer set budget"));
    }
    let ids = values
        .iter()
        .map(LayerIdInput::parse)
        .collect::<Result<Vec<_>>>()?;
    if ids.iter().copied().collect::<HashSet<_>>().len() != ids.len() {
        return Err(invalid("duplicate layer identity"));
    }
    Ok(ids)
}
fn layer(doc: &Document, id: LayerId, pixels: bool, moving: bool) -> Result<()> {
    let l = doc
        .layer(id)
        .ok_or_else(|| Error::none("not-found", "layer not found"))?;
    let locks = doc.effective_locks(id);
    if locks.all || (pixels && locks.pixels) || (moving && locks.position) {
        return Err(Error::none("locked", "target layer is locked"));
    }
    if pixels && !matches!(l.content, LayerContent::Raster(_)) {
        return Err(Error::none(
            "unsupported",
            "pixel tool requires a raster layer",
        ));
    }
    Ok(())
}
impl Host {
    pub(super) fn selection_context(
        &mut self,
        r: &Request,
        id: &LayerIdInput,
        generation: u64,
        points: Option<&[SelectionPoint]>,
    ) -> Result<(Value, Vec<u8>)> {
        self.base(r)?;
        self.check_context(generation)?;
        self.context_idle()?;
        let id = id.parse()?;
        let doc = self.document()?;
        if self.engine.active().and_then(|s| s.active_layer) != Some(id) {
            return Err(Error::none(
                "conflict",
                "temporary selection requires the current layer",
            ));
        }
        if !matches!(
            doc.layer(id).map(|l| &l.content),
            Some(LayerContent::Raster(_))
        ) {
            return Err(Error::none(
                "unsupported",
                "temporary selection requires a raster layer",
            ));
        }
        let selection = points
            .map(|points| {
                Ok(TemporarySelection {
                    document: doc.id.0,
                    layer: id,
                    points: points.to_vec(),
                    mask: mask(&doc, points)?,
                    generation: self.context_generation.saturating_add(1),
                })
            })
            .transpose()?;
        self.temporary_selection = selection;
        self.advance_context();
        Ok((
            json!({"kind":"selectionContextUpdated","imageVersionRef":self.current,"temporarySelection":self.temporary_selection.as_ref().map(|s|s.summary(self)),"durable":false}),
            vec![],
        ))
    }
    /// Validate every referenced layer before recording intent or changing context.
    pub(super) fn validate_product_edit(&self, edit: &ProductEdit) -> Result<()> {
        source_guard::check_edit(self, edit)?;
        let doc = self.document()?;
        match edit {
            ProductEdit::NewLayer { name } => {
                if name.len() > 16384 {
                    return Err(invalid("layer name budget"));
                }
            }
            ProductEdit::SetLayer { layer_id, patch } => {
                let id = layer_id.parse()?;
                if patch.name.is_none()
                    && patch.visible.is_none()
                    && patch.locked.is_none()
                    && patch.opacity.is_none()
                    && patch.blend_mode.is_none()
                {
                    return Err(invalid("empty layer patch"));
                }
                if patch.name.as_ref().is_some_and(|n| n.len() > 16384)
                    || patch.opacity.is_some_and(|n| !unit(n))
                {
                    return Err(invalid("layer property bounds"));
                }
                if doc.layer(id).is_none() {
                    return Err(Error::none("not-found", "layer not found"));
                }
                if (patch.name.is_some() || patch.opacity.is_some() || patch.blend_mode.is_some())
                    && doc.effective_locks(id).all
                {
                    return Err(Error::none(
                        "locked",
                        "unlock before editing layer properties",
                    ));
                }
            }
            ProductEdit::SetLayerOpacities { changes } => {
                if changes.is_empty() || changes.len() > 64 {
                    return Err(invalid("opacity layer count"));
                }
                let mut seen = HashSet::new();
                for c in changes {
                    let id = c.layer_id.parse()?;
                    layer(&doc, id, false, false)?;
                    if !seen.insert(id) || !unit(c.before) || !unit(c.opacity) {
                        return Err(invalid("opacity change bounds/duplicate"));
                    }
                    if (f64::from(doc.layer(id).unwrap().opacity) - c.before).abs() > 1e-6 {
                        return Err(Error::none("conflict", "opacity source changed"));
                    }
                }
            }
            ProductEdit::RemoveLayer { layer_id } => {
                layer(&doc, layer_id.parse()?, false, false)?;
            }
            ProductEdit::MoveLayers {
                layer_ids,
                target_layer_id,
                ..
            } => {
                let source = ids(layer_ids, 1)?;
                let target = target_layer_id.parse()?;
                if source.contains(&target) {
                    return Err(invalid("move target is selected"));
                }
                if doc.layer(target).is_none() {
                    return Err(Error::none("not-found", "move target not found"));
                }
                for id in source {
                    layer(&doc, id, false, true)?;
                }
            }
            ProductEdit::Merge { layer_ids } => {
                for id in ids(layer_ids, 2)? {
                    layer(&doc, id, false, false)?;
                }
            }
            ProductEdit::MergeVisible => {
                for (_, _, l) in doc.walk() {
                    if l.visible {
                        layer(&doc, l.id, false, false)?;
                    }
                }
            }
            ProductEdit::Clear { layer_id } => layer(&doc, layer_id.parse()?, true, false)?,
            ProductEdit::Blur {
                layer_id,
                radius,
                selection,
            } => {
                layer(&doc, layer_id.parse()?, true, false)?;
                if !radius.is_finite() || !(1.0..=50.0).contains(radius) {
                    return Err(invalid("blur radius must be 1..50"));
                }
                if let Some(p) = selection {
                    polygon(p)?;
                }
            }
            ProductEdit::Fill { layer_id, x, y, .. } => {
                layer(&doc, layer_id.parse()?, true, false)?;
                if !coord(*x) || !coord(*y) {
                    return Err(invalid("fill coordinate bounds"));
                }
            }
            ProductEdit::Transform {
                layer_id,
                selection,
                matrix,
            } => {
                layer(&doc, layer_id.parse()?, true, true)?;
                polygon(selection)?;
                if matrix.iter().any(|v| !coord(*v))
                    || (matrix[0] * matrix[3] - matrix[1] * matrix[2]).abs() <= 1e-12
                {
                    return Err(invalid("transform requires a finite invertible matrix"));
                }
            }
        }
        Ok(())
    }
    pub(super) fn apply_product(&mut self, edit: &ProductEdit) -> Result<()> {
        let selection = self.document()?.selection.clone();
        let geometry = match edit {
            ProductEdit::Blur { selection, .. } => selection.as_deref(),
            ProductEdit::Transform { selection, .. } => Some(selection.as_slice()),
            _ => None,
        };
        let selected = geometry
            .map(|p| mask(self.document()?.as_ref(), p))
            .transpose()?;
        let pixel = matches!(
            edit,
            ProductEdit::Clear { .. }
                | ProductEdit::Fill { .. }
                | ProductEdit::Blur { .. }
                | ProductEdit::Transform { .. }
        );
        if pixel {
            Arc::make_mut(&mut self.engine.active_mut().unwrap().doc).selection = selected;
        }
        let target = match edit {
            ProductEdit::Clear { layer_id }
            | ProductEdit::Fill { layer_id, .. }
            | ProductEdit::Blur { layer_id, .. }
            | ProductEdit::Transform { layer_id, .. } => Some(layer_id.parse()?),
            _ => None,
        };
        if let Some(id) = target {
            self.engine.select_layer(id).map_err(native)?;
        }
        let run = |host: &mut Host, id: &str, p: Value| {
            host.engine.execute(id, p).map(|_| ()).map_err(native)
        };
        let result = match edit {
            ProductEdit::NewLayer { name } => run(self, "layer.new.layer", json!({"name":name})),
            ProductEdit::SetLayer { layer_id, patch } => {
                let mut p = json!({"layer":layer_id.parse()?.0});
                if let Some(v) = &patch.name {
                    p["name"] = json!(v);
                }
                if let Some(v) = patch.visible {
                    p["visible"] = json!(v);
                }
                if let Some(v) = patch.locked {
                    p["locked"] = json!(v);
                }
                if let Some(v) = patch.opacity {
                    p["opacity"] = json!(v);
                }
                if let Some(v) = &patch.blend_mode {
                    p["blend"] = json!(v);
                }
                run(self, "layer.setProps", p)
            }
            ProductEdit::SetLayerOpacities { changes } => {
                for c in changes {
                    run(
                        self,
                        "layer.setProps",
                        json!({"layer":c.layer_id.parse()?.0,"opacity":c.opacity}),
                    )?;
                }
                Ok(())
            }
            ProductEdit::RemoveLayer { layer_id } => {
                run(self, "layer.delete", json!({"layer":layer_id.parse()?.0}))
            }
            ProductEdit::MoveLayers {
                layer_ids,
                target_layer_id,
                placement,
            } => run(
                self,
                "layer.moveTo",
                json!({"layers":ids(layer_ids,1)?.iter().map(|id|id.0).collect::<Vec<_>>(),"target":target_layer_id.parse()?.0,"position":match placement{Placement::Before=>"above",Placement::After=>"below"},"copy":false}),
            ),
            ProductEdit::Clear { layer_id } => run(
                self,
                "edit.clear",
                json!({"layer":layer_id.parse()?.0,"target":"pixels"}),
            ),
            ProductEdit::Merge { layer_ids } => {
                let ids = ids(layer_ids, 2)?;
                let active = ids.last().copied();
                photocraft_engine::layer_multi_cmds::set_selection(
                    &mut self.engine,
                    ids,
                    active,
                    active,
                )
                .map_err(native)?;
                run(self, "layer.mergeLayers", json!({}))
            }
            ProductEdit::MergeVisible => run(self, "layer.mergeVisible", json!({})),
            ProductEdit::Blur { radius, .. } => run(
                self,
                "filter.blur.gaussianBlur",
                json!({"radius":radius,"target":"pixels"}),
            ),
            ProductEdit::Fill {
                layer_id,
                x,
                y,
                color,
                tolerance,
            } => run(
                self,
                "paint.bucket",
                json!({"layer":layer_id.parse()?.0,"x":x,"y":y,"color":color.map(|v|f64::from(v)/255.0),"tolerance":tolerance,"contiguous":true,"antiAlias":false,"sampleAllLayers":false,"opacity":100,"target":"pixels"}),
            ),
            ProductEdit::Transform { matrix, .. } => run(
                self,
                "edit.transform",
                json!({"matrix":matrix,"target":"pixels"}),
            ),
        };
        // Restoring only this temporary attachment is safe even when the command
        // failed; the caller then restores the complete transaction checkpoint.
        if pixel {
            Arc::make_mut(&mut self.engine.active_mut().unwrap().doc).selection = selection;
        }
        result
    }
    pub(super) fn product_edit(
        &mut self,
        r: &Request,
        edit: &ProductEdit,
        generation: u64,
        stamp: Option<&PreviewStamp>,
    ) -> Result<(Value, Vec<u8>)> {
        if let Some(v) = self.replay(r)? {
            return Ok((v, vec![]));
        }
        let preview = if let Some(stamp) = stamp {
            self.match_edit_preview(stamp, edit)?;
            let mut p = self
                .edit_preview
                .take()
                .ok_or_else(|| Error::none("not-found", "edit preview missing"))?;
            p.pending_operation = None;
            Some(p)
        } else {
            None
        };
        let result = self.product_edit_transaction(r, edit, generation, preview.as_ref());
        if match &result {
            Ok((body, _)) => body["kind"] != "prepared",
            Err(_) => true,
        } {
            if let Some(mut p) = preview {
                if self
                    .store
                    .op_read(&r.operation_id, "intent")
                    .is_ok_and(|v| v.is_none())
                {
                    p.pending_operation = None;
                } else {
                    p.pending_operation = Some(r.operation_id.clone());
                }
                self.edit_preview = Some(p);
            }
        }
        result
    }
    fn product_edit_transaction(
        &mut self,
        r: &Request,
        edit: &ProductEdit,
        generation: u64,
        preview: Option<&product_preview::EditPreview>,
    ) -> Result<(Value, Vec<u8>)> {
        self.base(r)?;
        self.check_context(generation)?;
        self.context_idle()?;
        if self.current.is_none() {
            return Err(Error::none(
                "conflict",
                "product edit requires an accepted version",
            ));
        }
        self.validate_product_edit(edit)?;
        let checkpoint = self.engine.host_checkpoint().map_err(native)?;
        self.intent(r)?;
        let applied = if let Some(p) = preview {
            self.engine
                .host_install(p.doc.clone(), p.target.clone())
                .map_err(native)
        } else {
            self.apply_product(edit)
        };
        if let Err(e) = applied {
            self.engine.host_restore(checkpoint).map_err(native)?;
            let failure = json!({"kind":"failure","error":Error::retained(&e.code,e.message)});
            self.store.op_write(&r.operation_id, "failed", &failure)?;
            return Ok((failure, vec![]));
        }
        let prepared = self.prepare(r, Some(checkpoint), None)?;
        self.temporary_selection = None;
        Ok((prepared, vec![]))
    }
}
