//! Actual hosted engine state checks, including masks (not inferred from composites).
use super::*;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(1);
struct Harness {
    h: Host,
    root: PathBuf,
    base: Option<String>,
    seq: u64,
}
impl Harness {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "flow-tool-context-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        Self {
            h: Host::open(&root, 128 << 20).unwrap(),
            root,
            base: None,
            seq: 0,
        }
    }
    fn call(&mut self, id: &str, body: Value) -> Response {
        self.seq += 1;
        let r:Request=serde_json::from_value(json!({"protocol":1,"requestId":format!("r{}",self.seq),"sessionId":"context","incarnation":"one","workerEpoch":self.h.worker_epoch,"operationId":id,"baseVersion":self.base,"body":body})).unwrap();
        self.h.handle(r, vec![])
    }
    fn body(&mut self, id: &str, body: Value) -> Value {
        self.call(id, body).header["body"].clone()
    }
    fn summary(&mut self) -> Value {
        let v = self.body("summary", json!({"kind":"summary","maxBytes":49152}));
        assert_eq!(v["kind"], "contextSummary", "{v}");
        v
    }
    fn edit(&mut self, id: &str, edit: Value) -> Value {
        self.body(id, json!({"kind":"edit","edit":edit}))
    }
    fn accept(&mut self, id: &str, v: &Value) -> String {
        assert_eq!(v["kind"], "prepared", "{v}");
        let version = v["receipt"]["versionId"].as_str().unwrap().to_owned();
        let v = self.body("accept", json!({"kind":"accept","candidateId":id}));
        assert_eq!(v["kind"], "accepted", "{v}");
        self.base = Some(version.clone());
        version
    }
    fn floating(&mut self, id: &str, action: Value) -> Value {
        self.body(id,json!({"kind":"floating","previewId":"floatPreview","expectedContextGeneration":self.h.context_generation,"action":action}))
    }
    fn capture(&mut self) -> Response {
        let r = self.call("capture", json!({"kind":"capture"}));
        assert_eq!(r.header["body"]["kind"], "frame", "{}", r.header);
        r
    }
    fn selected_fixture(&mut self) -> (String, u64, u64) {
        let v = self.body("new", json!({"kind":"new","width":32,"height":32}));
        self.accept("new", &v);
        let bottom = self.h.engine.active().unwrap().active_layer.unwrap().0;
        let v = self.edit("lowerFill", json!({"kind":"fill","color":"#224466"}));
        self.accept("lowerFill", &v);
        let v = self.edit("newLayer", json!({"kind":"newLayer","name":"top"}));
        self.accept("newLayer", &v);
        let top = self.h.engine.active().unwrap().active_layer.unwrap().0;
        let v = self.edit("topFill", json!({"kind":"fill","color":"#ff0000"}));
        self.accept("topFill", &v);
        let v = self.edit(
            "rect",
            json!({"kind":"rect","x":4,"y":5,"width":8,"height":7}),
        );
        (self.accept("rect", &v), bottom, top)
    }
    fn reopen(self, version: &str) -> Self {
        let root = self.root.clone();
        drop(self);
        let mut h = Self {
            h: Host::open(&root, 128 << 20).unwrap(),
            root,
            base: None,
            seq: 0,
        };
        let v = h.body("load", json!({"kind":"load","versionId":version}));
        assert_eq!(v["kind"], "loaded", "{v}");
        h.base = Some(version.into());
        h
    }
}
#[derive(Debug, PartialEq)]
struct State {
    pixels: Vec<u8>,
    mask: Option<Vec<u32>>,
    target: (Option<u64>, Vec<u64>),
    foreground: [f32; 4],
    brush_size: f32,
    undo: bool,
}
fn state(h: &Host) -> State {
    let s = h.engine.active().unwrap();
    State {
        pixels: photocraft_compose::flatten(&s.doc).to_rgba8().pixels,
        mask: s.doc.selection.as_ref().map(|m| {
            m.read_region(Rect::new(0, 0, 32, 32))
                .iter()
                .map(|v| v.to_bits())
                .collect()
        }),
        target: (
            s.active_layer.map(|id| id.0),
            s.selected_layers.iter().map(|id| id.0).collect(),
        ),
        foreground: h.engine.tools.foreground,
        brush_size: h.engine.tools.brush.size,
        undo: s.history.can_undo(),
    }
}
fn assert_mask(h: &Host, rect: Rect) {
    let s = h.engine.active().unwrap().doc.selection.as_ref().unwrap();
    for y in 0..32 {
        for x in 0..32 {
            assert_eq!(
                s.pixel(x, y)[0],
                if x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1 {
                    1.0
                } else {
                    0.0
                },
                "mask {x},{y}"
            );
        }
    }
}
#[test]
fn readonly_tree_budget_and_context_only_layer_selection() {
    let mut h = Harness::new();
    let (saved, bottom, top) = h.selected_fixture();
    let before = state(&h.h);
    let files = fs::read_dir(h.root.join("versions")).unwrap().count();
    let s = h.summary();
    assert_eq!(s["layers"][0]["layerId"], top.to_string());
    assert_eq!(s["layers"][1]["layerId"], bottom.to_string());
    assert_eq!(s["layerCount"], 2);
    assert_eq!(s["activeLayerId"], top.to_string());
    assert_eq!(s["selection"]["bounds"], json!([4, 5, 8, 7]));
    assert_eq!(s["tools"]["floatBegin"]["enabled"], true);
    assert!(s["layers"][0]["effectiveLocks"].is_object());
    let generation = h.h.context_generation;
    let token = s["selection"]["token"].clone();
    assert_eq!(
        h.body("tiny", json!({"kind":"summary","maxBytes":1}))["error"]["code"],
        "limit"
    );
    assert_eq!(h.h.context_generation, generation);
    assert_eq!(state(&h.h), before);
    let out=h.body("choose",json!({"kind":"selectLayerContext","layerId":bottom.to_string(),"expectedContextGeneration":generation}));
    assert_eq!(out["kind"], "contextUpdated", "{out}");
    assert_eq!(out["imageVersionRef"], saved);
    assert_eq!(out["contextGeneration"], generation + 1);
    assert_eq!(h.h.current.as_deref(), Some(saved.as_str()));
    assert_eq!(h.h.engine.active().unwrap().active_layer.unwrap().0, bottom);
    assert!(!h.h.engine.active().unwrap().history.can_undo());
    assert_eq!(
        fs::read_dir(h.root.join("versions")).unwrap().count(),
        files
    );
    assert_eq!(
        h.summary()["selection"]["token"],
        json!(format!(
            "selection-{}-{}-{}",
            h.h.worker_epoch,
            h.h.engine.active().unwrap().doc.id.0,
            generation + 1
        ))
    );
    assert_ne!(token, h.summary()["selection"]["token"]);
    assert_eq!(h.body("stale",json!({"kind":"selectLayerContext","layerId":top.to_string(),"expectedContextGeneration":generation}))["error"]["code"],"stale-context");
    let generation = h.h.context_generation;
    assert_eq!(h.body("missing",json!({"kind":"selectLayerContext","layerId":"999999","expectedContextGeneration":generation}))["kind"],"failure");
    assert_eq!(h.h.context_generation, generation);
    assert_eq!(
        h.edit("legacySelect", json!({"kind":"selectLayer","layerId":top}))["error"]["code"],
        "unsupported"
    );
    assert!(
        h.h.store
            .op_read("legacySelect", "intent")
            .unwrap()
            .is_none()
    );
    let v = h.body("restoreTarget", json!({"kind":"install","versionId":saved}));
    assert_eq!(v["kind"], "installed");
    assert_eq!(state(&h.h), before);
    assert_mask(&h.h, Rect::new(4, 5, 12, 12));
    eprintln!("context-only tree/state evidence: {}", h.root.display());
}
#[test]
fn actual_mask_target_accept_discard_install_load_and_failure_matrix() {
    let mut h = Harness::new();
    let (rect, bottom, top) = h.selected_fixture();
    let baseline = state(&h.h);
    let v = h.edit(
        "lasso",
        json!({"kind":"lasso","points":[[1,1],[20,1],[12,18]]}),
    );
    assert_eq!(v["kind"], "prepared");
    assert_ne!(state(&h.h).mask, baseline.mask);
    let v = h.body(
        "discardLasso",
        json!({"kind":"discard","candidateId":"lasso"}),
    );
    assert_eq!(v["kind"], "discarded");
    assert_eq!(state(&h.h), baseline);
    let v = h.edit(
        "singular",
        json!({"kind":"transform","matrix":[0,0,0,0,0,0]}),
    );
    assert_eq!(v["kind"], "failure");
    assert_eq!(state(&h.h), baseline);
    assert!(!h.summary()["settlementRequired"].as_bool().unwrap());
    let generation = h.h.context_generation;
    let v=h.body("bottom",json!({"kind":"selectLayerContext","layerId":bottom.to_string(),"expectedContextGeneration":generation}));
    assert_eq!(v["kind"], "contextUpdated");
    let v = h.edit(
        "newLasso",
        json!({"kind":"lasso","points":[[2,2],[20,2],[20,20],[2,20]]}),
    );
    let lasso = h.accept("newLasso", &v);
    let saved = state(&h.h);
    assert_ne!(saved.mask, baseline.mask);
    assert_eq!(saved.target, (Some(bottom), vec![bottom]));
    h = h.reopen(&lasso);
    assert_eq!(state(&h.h), saved);
    assert!(h.h.engine.active().unwrap().floating.is_none());
    assert_eq!(
        h.body("rectUndo", json!({"kind":"install","versionId":rect}))["kind"],
        "installed"
    );
    h.base = Some(rect);
    assert_eq!(state(&h.h), baseline);
    assert_eq!(h.summary()["activeLayerId"], top.to_string());
    assert_eq!(
        h.body("lassoRedo", json!({"kind":"install","versionId":lasso}))["kind"],
        "installed"
    );
    h.base = Some(lasso);
    assert_eq!(state(&h.h), saved);
    eprintln!("mask/target durable matrix evidence: {}", h.root.display());
}
#[test]
fn floating_preview_drop_discard_continue_and_cancel_full_checkpoint() {
    let mut h = Harness::new();
    let (base, _, top) = h.selected_fixture();
    h.h.engine.tools.foreground = [0.0, 1.0, 0.0, 1.0];
    h.h.engine.tools.brush.size = 17.0;
    let original = state(&h.h);
    let original_doc = h.h.document().unwrap();
    let s = h.summary();
    let token = s["selection"]["token"].clone();
    let v = h.floating("floatBegin", json!({"kind":"begin","dx":3,"dy":2}));
    assert_eq!(v["kind"], "floatingPreview", "{v}");
    assert_eq!(v["throughSeq"], 1);
    assert_eq!(v["durable"], false);
    assert_eq!(state(&h.h), original);
    assert!(Arc::ptr_eq(&original_doc, &h.h.document().unwrap()));
    assert_ne!(token, h.summary()["selection"]["token"]);
    let frame = h.capture();
    assert_eq!(frame.header["body"]["frame"]["previewId"], "floatPreview");
    assert_ne!(frame.payload, original.pixels);
    let s = h.summary();
    assert_eq!(s["floating"]["sourceLayerId"], top.to_string());
    assert_eq!(s["floating"]["outlineBounds"], json!([7, 7, 8, 7]));
    assert_eq!(s["tools"]["floatCancel"]["enabled"], true);
    assert_eq!(s["tools"]["paint"]["enabled"], false);
    let v = h.floating(
        "floatMove",
        json!({"kind":"move","fromSeq":2,"dx":2,"dy":-1}),
    );
    assert_eq!(v["offset"], json!([5, 1]));
    let moved = h.capture().payload;
    let generation = h.h.context_generation;
    assert_eq!(
        h.floating(
            "floatMoveAgain",
            json!({"kind":"move","fromSeq":2,"dx":2,"dy":-1})
        )["error"]["code"],
        "conflict"
    );
    assert_eq!(h.h.context_generation, generation);
    assert_eq!(h.capture().payload, moved);
    assert_eq!(
        h.floating(
            "overLimit",
            json!({"kind":"move","fromSeq":3,"dx":10000001,"dy":0})
        )["error"]["code"],
        "limit"
    );
    assert_eq!(h.capture().payload, moved);
    for edit in [
        json!({"kind":"fill","color":"#00ff00"}),
        json!({"kind":"float","dx":1,"dy":1}),
        json!({"kind":"dropFloat"}),
    ] {
        assert_eq!(h.edit("noImplicitDrop", edit)["kind"], "failure");
        assert!(photocraft_engine::float_cmds::floating(h.h.engine.active().unwrap()).is_some());
    }
    assert_eq!(h.body("blockedSelect",json!({"kind":"selectLayerContext","layerId":top.to_string(),"expectedContextGeneration":generation}))["error"]["code"],"busy");
    assert_eq!(
        h.body("blockedInstall", json!({"kind":"install","versionId":base}))["error"]["code"],
        "busy"
    );
    let v = h.floating("drop", json!({"kind":"drop","throughSeq":2}));
    assert_eq!(v["kind"], "prepared", "{v}");
    assert_eq!(v["floatingPreviewId"], "floatPreview");
    assert!(h.h.engine.active().unwrap().floating.is_none());
    assert_mask(&h.h, Rect::new(9, 6, 17, 13));
    assert_eq!(h.summary()["floating"]["phase"], "dropPrepared");
    let v = h.body(
        "discardDrop",
        json!({"kind":"discard","candidateId":"drop"}),
    );
    assert_eq!(v["kind"], "discarded");
    assert_eq!(state(&h.h), original);
    assert!(photocraft_engine::float_cmds::floating(h.h.engine.active().unwrap()).is_some());
    assert_eq!(h.summary()["floating"]["offset"], json!([5, 1]));
    assert_eq!(h.capture().payload, moved);
    assert_eq!(h.h.current.as_deref(), Some(base.as_str()));
    // Confirm cancellation restores tool fields too, not only document pixels.
    h.h.engine.tools.foreground = [0.0, 0.0, 1.0, 1.0];
    h.h.engine.tools.brush.size = 99.0;
    let epoch = h.h.display_epoch;
    let v = h.floating("cancel", json!({"kind":"cancel","throughSeq":2}));
    assert_eq!(v["kind"], "floatingCancelled");
    assert_eq!(v["epoch"], epoch + 1);
    assert_eq!(state(&h.h), original);
    assert!(Arc::ptr_eq(&original_doc, &h.h.document().unwrap()));
    assert!(h.summary()["floating"].is_null());
    assert!(h.capture().header["body"]["frame"]["previewId"].is_null());
    assert_eq!(h.h.current.as_deref(), Some(base.as_str()));
    assert!(!h.h.engine.active().unwrap().history.can_undo());
    eprintln!(
        "floating checkpoint/discard/cancel evidence: {}",
        h.root.display()
    );
}
#[test]
fn floating_drop_accept_and_restart_recovered_accept_or_discard() {
    for accept in [false, true] {
        let mut h = Harness::new();
        let (base, _, _) = h.selected_fixture();
        let original = state(&h.h);
        assert_eq!(
            h.floating("begin", json!({"kind":"begin","dx":5,"dy":1}))["kind"],
            "floatingPreview"
        );
        let visual = h.capture().payload;
        let p = h.floating("drop", json!({"kind":"drop","throughSeq":1}));
        assert_eq!(p["kind"], "prepared");
        let dropped = state(&h.h);
        assert_ne!(original, dropped);
        assert_eq!(visual, dropped.pixels);
        assert_mask(&h.h, Rect::new(9, 6, 17, 13));
        if accept {
            let version = h.accept("drop", &p);
            assert!(h.summary()["floating"].is_null());
            assert!(!h.h.engine.active().unwrap().history.can_undo());
            let saved = state(&h.h);
            h = h.reopen(&version);
            assert_eq!(state(&h.h), saved);
            assert_mask(&h.h, Rect::new(9, 6, 17, 13));
            assert!(h.summary()["floating"].is_null());
            let v = h.body("undo", json!({"kind":"install","versionId":base}));
            assert_eq!(v["kind"], "installed");
            h.base = Some(base);
            assert_eq!(state(&h.h), original);
        } else {
            h = h.reopen(&base);
            assert_eq!(state(&h.h), original);
            assert!(h.summary()["floating"].is_null());
            assert_eq!(h.summary()["settlementRequired"], true);
            let v = h.body(
                "discardRecovered",
                json!({"kind":"discard","candidateId":"drop"}),
            );
            assert_eq!(v["kind"], "discarded", "{v}");
            assert_eq!(state(&h.h), original);
            assert_eq!(h.summary()["settlementRequired"], false);
            assert!(h.summary()["floating"].is_null());
        }
        eprintln!(
            "floating accepted/recovered-discard={accept}: {}",
            h.root.display()
        );
    }
    // Main installed the prepared version before the worker's durable accept: settle exact candidate.
    let mut h = Harness::new();
    let (base, _, _) = h.selected_fixture();
    h.floating("begin", json!({"kind":"begin","dx":5,"dy":1}));
    let p = h.floating("drop", json!({"kind":"drop","throughSeq":1}));
    let version = p["receipt"]["versionId"].as_str().unwrap().to_owned();
    h = h.reopen(&version);
    assert_ne!(Some(base), h.base);
    assert_eq!(
        h.body(
            "acceptRecovered",
            json!({"kind":"accept","candidateId":"drop"})
        )["kind"],
        "accepted"
    );
    assert_mask(&h.h, Rect::new(9, 6, 17, 13));
    assert!(h.summary()["floating"].is_null());
    assert!(!h.h.engine.active().unwrap().history.can_undo());
}
#[test]
fn floating_failures_preserve_prefix_mask_target_and_obligations() {
    fn deny(_: &str, _: &Value) -> photocraft_engine::Result<()> {
        Err(photocraft_engine::EngineError::Other(
            "synthetic revoked authority".into(),
        ))
    }
    let mut h = Harness::new();
    h.selected_fixture();
    let original = state(&h.h);
    h.h.engine.authorize = Some(deny);
    assert_eq!(
        h.floating("deniedBegin", json!({"kind":"begin","dx":3,"dy":1}))["kind"],
        "failure"
    );
    assert_eq!(state(&h.h), original);
    assert!(h.summary()["floating"].is_null());
    h.h.engine.authorize = Some(authorize);
    h.floating("begin", json!({"kind":"begin","dx":3,"dy":1}));
    let visual = h.capture().payload;
    let offset = h.summary()["floating"]["offset"].clone();
    h.h.engine.authorize = Some(deny);
    assert_eq!(
        h.floating(
            "deniedMove",
            json!({"kind":"move","fromSeq":2,"dx":2,"dy":1})
        )["kind"],
        "failure"
    );
    assert_eq!(state(&h.h), original);
    assert_eq!(h.capture().payload, visual);
    assert_eq!(h.summary()["floating"]["offset"], offset);
    assert_eq!(h.summary()["floating"]["throughSeq"], 1);
    let failed = h.floating("deniedDrop", json!({"kind":"drop","throughSeq":1}));
    assert_eq!(failed["kind"], "failure");
    assert_eq!(failed["error"]["effect"], "retained");
    assert_eq!(state(&h.h), original);
    assert_eq!(h.capture().payload, visual);
    assert_eq!(h.summary()["settlementRequired"], true);
    assert!(h.h.candidate.is_none());
    assert_eq!(
        h.floating("cancel", json!({"kind":"cancel","throughSeq":1}))["kind"],
        "floatingCancelled"
    );
    assert_eq!(state(&h.h), original);
    assert_eq!(h.summary()["settlementRequired"], true);
    assert_eq!(
        h.body(
            "abandon",
            json!({"kind":"abandon","targetOperationId":"deniedDrop"})
        )["kind"],
        "discarded"
    );
    assert_eq!(h.summary()["settlementRequired"], false);
    eprintln!("floating failure evidence: {}", h.root.display());
}
#[test]
fn context_guards_candidate_paint_pipeline_and_frozen_without_dropping_input() {
    let mut h = Harness::new();
    let (_, bottom, _) = h.selected_fixture();
    let p = h.edit("blur", json!({"kind":"blur","radius":1}));
    assert_eq!(p["kind"], "prepared");
    let generation = h.h.context_generation;
    assert_eq!(h.body("chooseBusy",json!({"kind":"selectLayerContext","layerId":bottom.to_string(),"expectedContextGeneration":generation}))["error"]["code"],"busy");
    assert_eq!(h.summary()["candidateId"], "blur");
    h.body("discard", json!({"kind":"discard","candidateId":"blur"}));
    let v=h.body("begin",json!({"kind":"strokeBegin","previewId":"paint","brush":{"seed":1,"size":3},"points":[{"x":20,"y":20}]}));
    assert_eq!(v["kind"], "frame", "{v}");
    let generation = h.h.context_generation;
    assert_eq!(h.body("choosePainting",json!({"kind":"selectLayerContext","layerId":bottom.to_string(),"expectedContextGeneration":generation}))["error"]["code"],"busy");
    assert_eq!(h.summary()["inputActive"], true);
    let p = h.body(
        "finish",
        json!({"kind":"strokeFinish","previewId":"paint","throughSeq":1}),
    );
    h.accept("finish", &p);
    let p=h.body("start",json!({"kind":"pipelineStart","maxPendingStrokes":2,"maxPendingPoints":32,"maxRetainedPixelBytes":16777216}));
    assert_eq!(p["kind"], "pipelineReady", "{p}");
    let id = p["pipelineId"].clone();
    let s = h.summary();
    assert_eq!(s["pipelineActive"], true);
    assert_eq!(s["tools"]["selectLayerContext"]["enabled"], false);
    let generation = h.h.context_generation;
    assert_eq!(h.body("choosePipeline",json!({"kind":"selectLayerContext","layerId":bottom.to_string(),"expectedContextGeneration":generation}))["kind"],"failure");
    assert_eq!(
        h.body("stop", json!({"kind":"pipelineStop","pipelineId":id}))["kind"],
        "pipelineStopped"
    );
    assert_eq!(h.body("freeze", json!({"kind":"freeze"}))["kind"], "frozen");
    let generation = h.h.context_generation;
    assert_eq!(h.body("chooseFrozen",json!({"kind":"selectLayerContext","layerId":bottom.to_string(),"expectedContextGeneration":generation}))["error"]["code"],"frozen");
    assert_eq!(h.summary()["tools"]["floatBegin"]["enabled"], false);
}
#[test]
fn real_group_tree_and_inherited_lock_capabilities_and_bounded_names() {
    let mut h = Harness::new();
    let mut doc = Document::new("tree", Size::new(32, 32), ColorMode::Rgb, SampleType::U8);
    let child = Layer::raster("child", doc.pixel_format());
    let child_id = child.id;
    let mut group = Layer::group("locked group", vec![child]);
    let group_id = group.id;
    group.locks.all = true;
    doc.layers.push(group);
    h.h.engine.add_document(doc, None);
    h.h.engine.select_layer(child_id).unwrap();
    h.h.engine.host_clear_history().unwrap();
    let receipt =
        h.h.store
            .save(&h.h.document().unwrap(), &h.h.target().unwrap(), None)
            .unwrap();
    h.h.current = Some(receipt.version_id.clone());
    h.base = Some(receipt.version_id.clone());
    let before = state(&h.h);
    let s = h.summary();
    assert_eq!(s["layers"][0]["layerId"], group_id.0.to_string());
    assert_eq!(s["layers"][0]["kind"], "group");
    assert_eq!(
        s["layers"][0]["children"][0]["layerId"],
        child_id.0.to_string()
    );
    assert_eq!(s["layers"][0]["children"][0]["effectiveLocks"]["all"], true);
    assert_eq!(s["tools"]["paint"]["enabled"], false);
    assert_eq!(s["tools"]["fill"]["enabled"], false);
    assert_eq!(s["tools"]["blur"]["enabled"], false);
    assert_eq!(s["tools"]["floatBegin"]["enabled"], false);
    assert_eq!(s["selection"]["present"], false);
    assert_eq!(state(&h.h), before);
    // An admitted long source name cannot make summary allocate an unbounded JSON tree.
    let st = h.h.engine.active_mut().unwrap();
    Arc::make_mut(&mut st.doc).layers[0].name = "x".repeat(49153);
    assert_eq!(
        h.body("names", json!({"kind":"summary","maxBytes":49152}))["error"]["code"],
        "limit"
    );
}
#[test]
fn floating_preparation_storage_failure_restores_live_context_and_retains_evidence() {
    let mut h = Harness::new();
    h.selected_fixture();
    let original = state(&h.h);
    h.floating("begin", json!({"kind":"begin","dx":5,"dy":1}));
    let visual = h.capture().payload;
    // Corrupt every fixture object: the first directory entry may be an obsolete
    // selection tile not referenced by the working version and correctly reusable.
    let tiles = fs::read_dir(h.root.join("tiles"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect::<Vec<_>>();
    assert!(!tiles.is_empty());
    for tile in &tiles {
        fs::write(tile, b"synthetic retained corrupt object").unwrap();
    }
    let v = h.floating("storageDrop", json!({"kind":"drop","throughSeq":1}));
    assert_eq!(v["kind"], "failure", "{v}");
    assert_eq!(state(&h.h), original);
    assert_eq!(h.capture().payload, visual);
    assert!(h.h.candidate.is_none());
    assert_eq!(h.summary()["floating"]["phase"], "active");
    assert_eq!(h.summary()["floating"]["throughSeq"], 1);
    assert_eq!(h.summary()["settlementRequired"], true);
    for tile in &tiles {
        assert_eq!(
            fs::read(tile).unwrap(),
            b"synthetic retained corrupt object"
        );
    }
    assert_eq!(
        h.floating("cancel", json!({"kind":"cancel","throughSeq":1}))["kind"],
        "floatingCancelled"
    );
    assert_eq!(state(&h.h), original);
    assert_eq!(h.summary()["settlementRequired"], true);
    eprintln!(
        "failed storage drop evidence retained: {}",
        h.root.display()
    );
}
#[test]
fn unavailable_floating_checkpoint_is_blocked_without_losing_owner_or_claiming_cancel() {
    let mut h = Harness::new();
    h.selected_fixture();
    h.floating("begin", json!({"kind":"begin","dx":3,"dy":2}));
    let before = state(&h.h);
    // Internal damaged-checkpoint fault; public commands never remove this checkpoint.
    h.h.floating_context.as_mut().unwrap().original = None;
    let v = h.floating("cancel", json!({"kind":"cancel","throughSeq":1}));
    assert_eq!(v["kind"], "failure");
    assert_eq!(v["error"]["effect"], "retained");
    assert_eq!(state(&h.h), before);
    let s = h.summary();
    assert_eq!(s["floating"]["phase"], "blocked");
    assert_eq!(s["tools"]["floatCancel"]["enabled"], false);
    assert_eq!(s["tools"]["paint"]["enabled"], false);
}
#[test]
fn upstream_restore_refusal_blocks_owner_and_does_not_certify_a_frame() {
    fn deny(_: &str, _: &Value) -> photocraft_engine::Result<()> {
        Err(photocraft_engine::EngineError::Other(
            "synthetic revoke after revision exhaustion".into(),
        ))
    }
    let mut h = Harness::new();
    h.selected_fixture();
    h.floating("begin", json!({"kind":"begin","dx":3,"dy":2}));
    // Force the public upstream restore guard to fail without replacing its implementation.
    let st = h.h.engine.active_mut().unwrap();
    st.revision = u64::MAX;
    st.floating.as_mut().unwrap().revision = u64::MAX;
    h.h.engine.authorize = Some(deny);
    let result = h.floating("move", json!({"kind":"move","fromSeq":2,"dx":1,"dy":1}));
    assert_eq!(result["kind"], "failure");
    assert_eq!(result["error"]["effect"], "retained");
    let s = h.summary();
    assert_eq!(s["floating"]["phase"], "blocked");
    assert_eq!(s["floating"]["throughSeq"], 1);
    assert_eq!(s["tools"]["floatCancel"]["enabled"], false);
    assert_eq!(
        h.body("captureBlocked", json!({"kind":"capture"}))["kind"],
        "failure"
    );
}
#[test]
fn decimal_layer_ids_real_node_roundtrip_preserves_adjacent_unsafe_integers() {
    use photocraft_color::PixelFormat;
    use photocraft_doc::LayerId;
    use std::process::{Command as ProcessCommand, Stdio};
    let mut fixture = Harness::new();
    let mut doc = Document::new(
        "Node exact IDs",
        Size::new(4, 4),
        ColorMode::Rgb,
        SampleType::U8,
    );
    let a = LayerId(9_007_199_254_740_995);
    let b = LayerId(9_007_199_254_740_996);
    for (id, color) in [(a, [1.0, 0.0, 0.0, 1.0]), (b, [0.0, 0.0, 1.0, 1.0])] {
        let mut l = Layer::raster(id.0.to_string(), doc.pixel_format());
        l.id = id;
        l.surface_mut().unwrap().fill_rect(doc.bounds(), &color);
        doc.layers.push(l);
    }
    let mut mask = photocraft_raster::Surface::new(PixelFormat::new(
        ColorMode::Grayscale,
        SampleType::U8,
        false,
    ));
    mask.fill_rect(doc.bounds(), &[1.0]);
    doc.selection = Some(mask);
    fixture.h.engine.add_document(doc, None);
    fixture.h.engine.select_layer(b).unwrap();
    fixture.h.engine.host_clear_history().unwrap();
    let receipt = fixture
        .h
        .store
        .save(
            &fixture.h.document().unwrap(),
            &fixture.h.target().unwrap(),
            None,
        )
        .unwrap();
    fixture.h.current = Some(receipt.version_id.clone());
    fixture.h.advance_context();
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/context_layer_ids.mjs");
    let mut child = ProcessCommand::new("node")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("installed Node required for the real cross-language test");
    let mut to_node = child.stdin.take().unwrap();
    let mut from_node = child.stdout.take().unwrap();
    wire::write(&mut to_node,&Response{header:json!({"protocol":1,"kind":"hello","workerEpoch":fixture.h.worker_epoch,"baseVersion":receipt.version_id,"capabilities":["decimalLayerIdsV1"]}),payload:vec![]}).unwrap();
    while let Some((request, payload)) = wire::read(&mut from_node).unwrap() {
        let response = fixture.h.handle(request, payload);
        wire::write(&mut to_node, &response).unwrap();
        if fixture.h.is_closed() {
            break;
        }
    }
    drop(to_node);
    drop(from_node);
    let result = child.wait_with_output().unwrap();
    fs::write(fixture.root.join("node-result.log"), &result.stderr).unwrap();
    assert!(
        result.status.success(),
        "real Node failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(fixture.h.engine.active().unwrap().active_layer, Some(a));
    assert_eq!(fixture.h.current, Some(receipt.version_id));
    eprintln!("Node exact-ID evidence: {}", fixture.root.display());
    eprintln!("{}", String::from_utf8_lossy(&result.stderr));
}

#[test]
fn settled_empty_host_resume_preserves_absent_image_until_new_document_is_prepared() {
    let mut h = Harness::new();
    assert_eq!(h.body("freeze", json!({"kind":"freeze"}))["kind"], "frozen");
    let resumed = h.body("resume", json!({"kind":"resume"}));
    assert_eq!(resumed["kind"], "resumed");
    assert!(resumed["documentId"].is_null() && resumed["versionId"].is_null());
    assert!(h.h.engine.active().is_none());
    let new = h.body("new", json!({"kind":"new","width":32,"height":32}));
    h.accept("new", &new);
}

fn product(h: &mut Harness, id: &str, edit: Value) -> Value {
    h.body(id,json!({"kind":"productEdit","expectedContextGeneration":h.h.context_generation,"edit":edit}))
}
fn temporary(h: &mut Harness, layer: u64, selection: Value) -> Value {
    h.body("temporary",json!({"kind":"selectionContext","layerId":layer.to_string(),"selection":selection,"expectedContextGeneration":h.h.context_generation}))
}
fn polygon_fixture() -> Value {
    json!([{"x":4,"y":5},{"x":12,"y":5},{"x":12,"y":12},{"x":4,"y":12}])
}
#[test]
fn product_temporary_selection_never_enters_content_and_discard_restores_context() {
    let mut h = Harness::new();
    let (saved, _bottom, top) = h.selected_fixture();
    let before = state(&h.h);
    let count = fs::read_dir(h.root.join("versions")).unwrap().count();
    let v = temporary(&mut h, top, polygon_fixture());
    assert_eq!(v["kind"], "selectionContextUpdated", "{v}");
    assert_eq!(state(&h.h), before);
    assert_eq!(h.base.as_deref(), Some(saved.as_str()));
    assert_eq!(
        fs::read_dir(h.root.join("versions")).unwrap().count(),
        count
    );
    let generation = h.h.context_generation;
    let p = product(
        &mut h,
        "opacity",
        json!({"kind":"setLayerOpacities","changes":[{"layerId":top.to_string(),"before":1,"opacity":0.4}]}),
    );
    assert_eq!(p["kind"], "prepared", "{p}");
    assert_ne!(state(&h.h).pixels, before.pixels);
    assert!(h.h.temporary_selection.is_none());
    let d = h.body("discard", json!({"kind":"discard","candidateId":"opacity"}));
    assert_eq!(d["kind"], "discarded", "{d}");
    assert_eq!(state(&h.h), before);
    assert!(h.h.temporary_selection.is_some());
    assert_eq!(h.h.context_generation, generation);
    assert_mask(&h.h, Rect::new(4, 5, 12, 12));
    let clear = temporary(&mut h, top, Value::Null);
    assert_eq!(clear["kind"], "selectionContextUpdated");
    assert!(h.h.temporary_selection.is_none());
    assert_eq!(state(&h.h), before);
}
#[test]
fn product_transform_blur_fill_are_real_candidates_and_preserve_intrinsic_and_layer_masks() {
    let mut h = Harness::new();
    let (_, bottom, top) = h.selected_fixture();
    // Persist a source layer mask; UI temporary selection must never overwrite it.
    Arc::make_mut(&mut h.h.engine.active_mut().unwrap().doc)
        .layer_mut(photocraft_doc::LayerId(top))
        .unwrap()
        .mask = Some(photocraft_doc::LayerMask::reveal_all());
    let original_mask =
        h.h.document()
            .unwrap()
            .layer(photocraft_doc::LayerId(top))
            .unwrap()
            .mask
            .clone();
    let intrinsic = state(&h.h).mask;
    let t = product(
        &mut h,
        "transformProduct",
        json!({"kind":"transform","layerId":top.to_string(),"selection":polygon_fixture(),"matrix":[1,0,0,1,6,3]}),
    );
    assert_eq!(t["kind"], "prepared", "{t}");
    let moved = state(&h.h).pixels;
    assert_ne!(
        moved[(6 * 32 + 6) * 4..(6 * 32 + 6) * 4 + 4],
        [255, 0, 0, 255]
    );
    assert_eq!(state(&h.h).mask, intrinsic);
    h.accept("transformProduct", &t);
    assert_eq!(
        h.h.document()
            .unwrap()
            .layer(photocraft_doc::LayerId(top))
            .unwrap()
            .mask
            .clone(),
        original_mask
    );
    let b = product(
        &mut h,
        "blurProduct",
        json!({"kind":"blur","layerId":top.to_string(),"selection":polygon_fixture(),"radius":3}),
    );
    assert_eq!(b["kind"], "prepared", "{b}");
    assert_ne!(state(&h.h).pixels, moved);
    h.accept("blurProduct", &b);
    assert_eq!(state(&h.h).mask, intrinsic);
    let f = product(
        &mut h,
        "bucketProduct",
        json!({"kind":"fill","layerId":bottom.to_string(),"x":1,"y":1,"color":[0,255,0,128],"tolerance":0}),
    );
    assert_eq!(f["kind"], "prepared", "{f}");
    let version = h.accept("bucketProduct", &f);
    let expected = state(&h.h);
    let h = h.reopen(&version);
    assert_eq!(state(&h.h), expected);
    assert_eq!(
        h.h.document()
            .unwrap()
            .layer(photocraft_doc::LayerId(top))
            .unwrap()
            .mask
            .clone(),
        original_mask
    );
}
#[test]
fn product_layer_edit_sequence_and_failure_are_atomic() {
    let mut h = Harness::new();
    let (_, bottom, top) = h.selected_fixture();
    let p = product(
        &mut h,
        "props",
        json!({"kind":"setLayer","layerId":top.to_string(),"patch":{"name":"named","opacity":0.5,"blendMode":"multiply","visible":false}}),
    );
    h.accept("props", &p);
    let doc = h.h.document().unwrap();
    let l = doc.layer(photocraft_doc::LayerId(top)).unwrap();
    assert_eq!(l.name, "named");
    assert_eq!(l.opacity, 0.5);
    assert!(!l.visible);
    assert_eq!(l.blend, photocraft_color::BlendMode::Multiply);
    let p = product(
        &mut h,
        "move",
        json!({"kind":"moveLayers","layerIds":[top.to_string()],"targetLayerId":bottom.to_string(),"placement":"after"}),
    );
    h.accept("move", &p);
    assert_eq!(h.h.document().unwrap().layers[0].id.0, top);
    let p = product(
        &mut h,
        "show",
        json!({"kind":"setLayer","layerId":top.to_string(),"patch":{"visible":true}}),
    );
    h.accept("show", &p);
    let p = product(
        &mut h,
        "clear",
        json!({"kind":"clear","layerId":top.to_string()}),
    );
    h.accept("clear", &p);
    assert!(
        h.h.document()
            .unwrap()
            .layer(photocraft_doc::LayerId(top))
            .unwrap()
            .surface()
            .unwrap()
            .content_bounds()
            .is_empty()
    );
    let p = product(
        &mut h,
        "merge",
        json!({"kind":"merge","layerIds":[bottom.to_string(),top.to_string()]}),
    );
    h.accept("merge", &p);
    assert_eq!(h.h.document().unwrap().layer_count(), 1);
    let id = h.h.engine.active().unwrap().active_layer.unwrap().0;
    let before = state(&h.h);
    let failure = product(
        &mut h,
        "deleteLast",
        json!({"kind":"removeLayer","layerId":id.to_string()}),
    );
    assert_eq!(failure["kind"], "failure", "{failure}");
    assert_eq!(state(&h.h), before);
    assert_eq!(
        h.body(
            "status",
            json!({"kind":"status","targetOperationId":"deleteLast"})
        )["state"],
        "failed"
    );
    let p = product(
        &mut h,
        "lock",
        json!({"kind":"setLayer","layerId":id.to_string(),"patch":{"locked":true}}),
    );
    h.accept("lock", &p);
    let before = state(&h.h);
    let fail = product(
        &mut h,
        "lockedBlur",
        json!({"kind":"blur","layerId":id.to_string(),"radius":3}),
    );
    assert_eq!(fail["error"]["code"], "locked");
    assert_eq!(state(&h.h), before);
    assert!(h.h.store.op_read("lockedBlur", "intent").unwrap().is_none());
}
#[test]
fn product_paint_preserves_context_generation_and_temporary_outline_until_install() {
    let mut h = Harness::new();
    let (saved, _, top) = h.selected_fixture();
    assert_eq!(
        temporary(&mut h, top, polygon_fixture())["kind"],
        "selectionContextUpdated"
    );
    let generation = h.h.context_generation;
    let v=h.body("begin",json!({"kind":"strokeBegin","previewId":"paint","brush":{"size":3,"opacity":0.5,"color":"#00ff00","brush":{"pressureSize":false,"pressureOpacity":false}},"points":[{"x":8,"y":8,"pressure":1}]}));
    assert_eq!(v["kind"], "frame", "{v}");
    let p = h.body(
        "paint",
        json!({"kind":"strokeFinish","previewId":"paint","throughSeq":1}),
    );
    h.accept("paint", &p);
    assert_eq!(h.h.context_generation, generation);
    assert!(h.h.temporary_selection.is_some());
    let v = h.body("undo", json!({"kind":"install","versionId":saved}));
    assert_eq!(v["kind"], "installed", "{v}");
    assert!(h.h.temporary_selection.is_none());
}

fn opacity_edit(top: u64, bottom: u64, opacity: f64) -> Value {
    json!({"kind":"setLayerOpacities","changes":[{"layerId":top.to_string(),"before":1,"opacity":opacity},{"layerId":bottom.to_string(),"before":1,"opacity":opacity}]})
}
fn edit_preview(h: &mut Harness, seq: u64, edit: Value) -> Response {
    h.call("previewControl",json!({"kind":"previewEdit","previewId":"properties","fromSeq":seq,"expectedContextGeneration":h.h.context_generation,"edit":edit}))
}
#[test]
fn product_preview_opacity_is_fixed_cow_atomic_and_cancellable_without_versions() {
    let mut h = Harness::new();
    let (_, bottom, top) = h.selected_fixture();
    let original = state(&h.h);
    let original_doc = h.h.document().unwrap();
    let count = fs::read_dir(h.root.join("versions")).unwrap().count();
    let generation = h.h.context_generation;
    let first = edit_preview(&mut h, 1, opacity_edit(top, bottom, 0.25));
    assert_eq!(first.header["body"]["kind"], "frame", "{}", first.header);
    let first_stamp = first.header["body"]["editPreview"].clone();
    assert_eq!(state(&h.h), original);
    assert!(Arc::ptr_eq(&original_doc, &h.h.document().unwrap()));
    let second = edit_preview(&mut h, 2, opacity_edit(top, bottom, 0.6));
    let stamp = second.header["body"]["editPreview"].clone();
    assert_ne!(first.payload, second.payload);
    assert_eq!(h.h.context_generation, generation);
    assert_eq!(state(&h.h), original);
    assert_eq!(
        fs::read_dir(h.root.join("versions")).unwrap().count(),
        count
    );
    let repeated = edit_preview(&mut h, 2, opacity_edit(top, bottom, 0.6));
    assert_eq!(repeated.header["body"]["editPreview"], stamp);
    assert_eq!(repeated.payload, second.payload);
    let gap = edit_preview(&mut h, 4, opacity_edit(top, bottom, 0.2));
    assert_eq!(gap.header["body"]["error"]["code"], "conflict");
    assert_eq!(h.capture().payload, second.payload);
    assert_eq!(
        h.body("freeze", json!({"kind":"freeze"}))["error"]["code"],
        "busy"
    );
    assert_eq!(
        h.body(
            "oldCancel",
            json!({"kind":"cancelEditPreview","stamp":first_stamp})
        )["error"]["code"],
        "conflict"
    );
    assert_eq!(
        h.body("cancel", json!({"kind":"cancelEditPreview","stamp":stamp}))["kind"],
        "editPreviewCancelled"
    );
    assert_eq!(state(&h.h), original);
    assert_eq!(h.capture().payload, original.pixels);
    assert_eq!(h.h.context_generation, generation);
}
#[test]
fn product_preview_adopts_exact_final_pixels_then_main_settles_accept_or_discard() {
    for accept in [false, true] {
        let mut h = Harness::new();
        let (_, bottom, top) = h.selected_fixture();
        let original = state(&h.h);
        let count = fs::read_dir(h.root.join("versions")).unwrap().count();
        let edit = opacity_edit(top, bottom, 0.4);
        let preview = edit_preview(&mut h, 1, edit.clone());
        let stamp = preview.header["body"]["editPreview"].clone();
        let wrong=h.body("wrongFinal",json!({"kind":"productEdit","expectedContextGeneration":h.h.context_generation,"preview":stamp,"edit":opacity_edit(top,bottom,0.2)}));
        assert_eq!(wrong["error"]["code"], "conflict");
        assert!(h.h.store.op_read("wrongFinal", "intent").unwrap().is_none());
        let prepared=h.body("final",json!({"kind":"productEdit","expectedContextGeneration":h.h.context_generation,"preview":stamp,"edit":edit}));
        assert_eq!(prepared["kind"], "prepared", "{prepared}");
        assert_eq!(prepared["editPreview"], stamp);
        assert_eq!(state(&h.h).pixels, preview.payload);
        let receipt =
            h.h.store
                .load(prepared["receipt"]["versionId"].as_str().unwrap())
                .unwrap();
        assert_eq!(
            photocraft_compose::flatten(&receipt.doc).to_rgba8().pixels,
            preview.payload
        );
        assert_eq!(
            fs::read_dir(h.root.join("versions")).unwrap().count(),
            count + 1
        );
        assert_eq!(
            h.body(
                "cancelCandidate",
                json!({"kind":"cancelEditPreview","stamp":stamp})
            )["error"]["code"],
            "busy"
        );
        if accept {
            let version = h.accept("final", &prepared);
            assert_eq!(h.capture().payload, preview.payload);
            h = h.reopen(&version);
            assert_eq!(h.capture().payload, preview.payload);
        } else {
            assert_eq!(
                h.body("discard", json!({"kind":"discard","candidateId":"final"}))["kind"],
                "discarded"
            );
            assert_eq!(state(&h.h), original);
            assert_eq!(h.capture().payload, original.pixels);
        }
        assert!(h.h.edit_preview.is_none());
    }
}
#[test]
fn product_transform_preview_recomputes_from_original_and_preserves_source_masks() {
    let mut h = Harness::new();
    let (_, _, top) = h.selected_fixture();
    let p = h.edit("selectedColor", json!({"kind":"fill","color":"#000000"}));
    h.accept("selectedColor", &p);
    let original = state(&h.h);
    let edit = |dx| json!({"kind":"transform","layerId":top.to_string(),"selection":polygon_fixture(),"matrix":[1,0,0,1,dx,3]});
    let checkpoint = h.h.engine.host_checkpoint().unwrap();
    let final_edit: ProductEdit = serde_json::from_value(edit(7)).unwrap();
    h.h.apply_product(&final_edit).unwrap();
    let expected = state(&h.h).pixels;
    h.h.engine.host_restore(checkpoint).unwrap();
    let first = edit_preview(&mut h, 1, edit(3));
    assert_eq!(first.header["body"]["kind"], "frame");
    let second = edit_preview(&mut h, 2, edit(7));
    assert_eq!(second.payload, expected);
    assert_ne!(first.payload, second.payload);
    assert_eq!(state(&h.h), original);
    let stamp = second.header["body"]["editPreview"].clone();
    assert_eq!(
        h.body("cancel", json!({"kind":"cancelEditPreview","stamp":stamp}))["kind"],
        "editPreviewCancelled"
    );
    assert_eq!(state(&h.h), original);
}
#[test]
fn product_preview_failed_persistence_retains_owner_and_requires_main_resolution() {
    let mut h = Harness::new();
    let (_, bottom, top) = h.selected_fixture();
    let original = state(&h.h);
    let edit = opacity_edit(top, bottom, 0.4);
    let preview = edit_preview(&mut h, 1, edit.clone());
    let stamp = preview.header["body"]["editPreview"].clone();
    for tile in fs::read_dir(h.root.join("tiles")).unwrap() {
        fs::write(tile.unwrap().path(), b"retained synthetic corruption").unwrap();
    }
    let v=h.body("failedFinal",json!({"kind":"productEdit","expectedContextGeneration":h.h.context_generation,"preview":stamp,"edit":edit}));
    assert_eq!(v["kind"], "failure", "{v}");
    assert_eq!(state(&h.h), original);
    assert_eq!(h.capture().payload, preview.payload);
    assert_eq!(
        h.summary()["editPreview"]["pendingOperationId"],
        "failedFinal"
    );
    assert_eq!(
        h.body("cancel", json!({"kind":"cancelEditPreview","stamp":stamp}))["error"]["code"],
        "busy"
    );
    assert_eq!(
        h.body(
            "resolve",
            json!({"kind":"abandon","targetOperationId":"failedFinal"})
        )["kind"],
        "discarded"
    );
    assert_eq!(
        h.body(
            "cancelAfterDecision",
            json!({"kind":"cancelEditPreview","stamp":stamp})
        )["kind"],
        "editPreviewCancelled"
    );
    assert_eq!(state(&h.h), original);
    eprintln!(
        "product preview failure evidence retained: {}",
        h.root.display()
    );
}

fn immutable_wait(h: &mut Harness, id: &str) -> Response {
    let until = std::time::Instant::now() + std::time::Duration::from_secs(15);
    loop {
        let reply = h.call("immutablePoll", json!({"kind":"detachedPoll","jobId":id}));
        if reply.header["body"]["finished"] == true {
            return reply;
        }
        assert!(
            std::time::Instant::now() < until,
            "immutable job stalled: {}",
            reply.header
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}
fn immutable_new(h: &mut Harness, id: &str, width: u32, height: u32) -> Value {
    let queued=h.body(id,json!({"kind":"detachedPrepare","input":{"kind":"new","width":width,"height":height},"maxAdditionalBytes":2<<20}));
    assert_eq!(queued["kind"], "detachedQueued", "{queued}");
    let result = immutable_wait(h, id);
    assert_eq!(
        result.header["body"]["result"]["kind"], "prepared",
        "{}",
        result.header
    );
    result.header["body"]["result"].clone()
}
fn immutable_settle(h: &mut Harness, id: &str, prepared: &Value) -> Value {
    let queued=h.body("settleImmutable",json!({"kind":"settleDetached","candidateId":id,"versionId":prepared["receipt"]["versionId"]}));
    assert_eq!(queued["kind"], "detachedQueued", "{queued}");
    let response = immutable_wait(h, id);
    let result = response.header["body"]["result"].clone();
    assert_eq!(result["kind"], "accepted", "{result}");
    result
}
#[test]
fn detached_candidates_preserve_active_document_and_settle_without_activating() {
    let mut h = Harness::new();
    let (base, _, _) = h.selected_fixture();
    let original = state(&h.h);
    let identity = h.summary();
    let first = immutable_new(&mut h, "newDetached", 64, 48);
    assert_eq!(state(&h.h), original);
    assert_ne!(first["receipt"]["documentId"], identity["documentId"]);
    assert_eq!(h.h.current.as_deref(), Some(base.as_str()));
    let queued=h.body("copyDetached",json!({"kind":"detachedPrepare","input":{"kind":"duplicate","source":{"versionId":base,"documentId":identity["documentId"],"width":32,"height":32}},"maxAdditionalBytes":2<<20}));
    assert_eq!(queued["kind"], "detachedQueued");
    let copy = immutable_wait(&mut h, "copyDetached").header["body"]["result"].clone();
    assert_eq!(copy["kind"], "prepared", "{copy}");
    assert_ne!(copy["receipt"]["documentId"], identity["documentId"]);
    assert_eq!(h.capture().payload, original.pixels);
    assert_eq!(h.summary()["epoch"], identity["epoch"]);
    assert_eq!(
        h.summary()["contextGeneration"],
        identity["contextGeneration"]
    );
    assert_eq!(
        h.body(
            "wrongAccept",
            json!({"kind":"accept","candidateId":"newDetached"})
        )["error"]["code"],
        "unsupported"
    );
    assert_eq!(
        h.body("freeze", json!({"kind":"freeze"}))["error"]["code"],
        "busy"
    );
    // Synthetic Main-surrogate decision: one durable batch, not two native project decisions.
    let file = std::fs::File::create(h.root.join("main-batch-decision.json")).unwrap();
    serde_json::to_writer(
        &file,
        &json!({"candidates":[first["receipt"],copy["receipt"]]}),
    )
    .unwrap();
    file.sync_all().unwrap();
    immutable_settle(&mut h, "newDetached", &first);
    immutable_settle(&mut h, "copyDetached", &copy);
    assert_eq!(state(&h.h), original);
    assert_eq!(h.summary()["documentId"], identity["documentId"]);
    let activate = h.body(
        "activateNew",
        json!({"kind":"activate","versionId":first["receipt"]["versionId"]}),
    );
    assert_eq!(activate["kind"], "activated", "{activate}");
    h.base = Some(first["receipt"]["versionId"].as_str().unwrap().into());
    assert_eq!(h.h.document().unwrap().size, Size::new(64, 48));
    assert!(h.capture().payload.iter().all(|v| *v == 255));
    let restore = h.body("activateOld", json!({"kind":"activate","versionId":base}));
    assert_eq!(restore["kind"], "activated", "{restore}");
    h.base = Some(base);
    assert_eq!(state(&h.h), original);
    let generation = h.h.context_generation;
    let epoch = h.h.display_epoch;
    let v = h.body(
        "sameActivation",
        json!({"kind":"activate","versionId":h.base}),
    );
    assert_eq!(v["kind"], "activated");
    assert_eq!(h.h.context_generation, generation + 1);
    assert_eq!(h.h.display_epoch, epoch + 1);
}
#[test]
fn detached_cpu_and_io_wait_for_live_input_without_blocking_accepted_samples() {
    let mut h = Harness::new();
    let p = h.body("new", json!({"kind":"new","width":64,"height":64}));
    h.accept("new", &p);
    let earlier = immutable_new(&mut h, "earlier", 16, 16);
    let frame=h.call("begin",json!({"kind":"strokeBegin","previewId":"live","brush":{"size":8,"opacity":0.5,"color":"#ff0000"},"points":[{"x":12,"y":12,"pressure":1}]}));
    assert_eq!(frame.header["body"]["kind"], "frame");
    let epoch = h.h.display_epoch;
    let q=h.body("background",json!({"kind":"detachedPrepare","input":{"kind":"new","width":32,"height":32},"maxAdditionalBytes":2<<20}));
    assert_eq!(q["kind"], "detachedQueued");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let pending = h.body("poll", json!({"kind":"detachedPoll","jobId":"background"}));
        assert_eq!(pending["finished"], false, "{pending}");
        if pending["phase"] == "waitingForIdleCpu" {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "background admission stalled: {pending}"
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let proof = std::fs::File::create(h.root.join("earlier-main-decision.json")).unwrap();
    serde_json::to_writer(&proof, &earlier["receipt"]).unwrap();
    proof.sync_all().unwrap();
    // Explicit settlement is control work and must not wait for unrelated B's
    // idle-only CPU job while A's live foreground gesture is still admitted.
    immutable_settle(&mut h, "earlier", &earlier);
    assert_eq!(
        h.body(
            "queryEarlier",
            json!({"kind":"detachedStatus","targetOperationId":"earlier"})
        )["state"],
        "accepted"
    );
    let frame=h.call("append",json!({"kind":"strokeAppend","previewId":"live","fromSeq":2,"points":[{"x":40,"y":24,"pressure":0.5}]}));
    assert_eq!(frame.header["body"]["kind"], "frame");
    assert_eq!(h.h.display_epoch, epoch);
    let prepared = h.body(
        "stroke",
        json!({"kind":"strokeFinish","previewId":"live","throughSeq":2}),
    );
    h.accept("stroke", &prepared);
    let committed = h.capture().payload;
    let result = immutable_wait(&mut h, "background");
    assert_eq!(result.header["body"]["result"]["kind"], "prepared");
    assert_eq!(h.capture().payload, committed);
    assert_eq!(h.h.display_epoch, epoch);
    let r = result.header["body"]["result"].clone();
    immutable_settle(&mut h, "background", &r);
}
#[test]
fn detached_budget_is_reserved_before_pixels_and_failed_source_keeps_original_target() {
    let mut h = Harness::new();
    let p = h.body("new", json!({"kind":"new","width":16,"height":16}));
    h.accept("new", &p);
    let original = state(&h.h);
    let mut n = 9327u32;
    let mut raw = Vec::new();
    for _ in 0..128 * 128 {
        for _ in 0..3 {
            n ^= n << 13;
            n ^= n >> 17;
            n ^= n << 5;
            raw.push(n as u8);
        }
        raw.push(255);
    }
    let image =
        photocraft_codecs::Image::from_u8(128, 128, photocraft_codecs::ChannelLayout::Rgba, raw)
            .unwrap();
    let bytes =
        photocraft_codecs::encode(&image, photocraft_codecs::Format::Png, &Default::default())
            .unwrap();
    let r:Request=serde_json::from_value(json!({"protocol":1,"requestId":"source","sessionId":"context","incarnation":"one","workerEpoch":h.h.worker_epoch,"operationId":"limited","baseVersion":null,"body":{"kind":"detachedPrepare","input":{"kind":"source","source":{"digest":sha(&bytes),"byteLength":bytes.len(),"formatHint":"png"}},"maxAdditionalBytes":16384}})).unwrap();
    let response = h.h.handle(r, bytes);
    assert_eq!(response.header["body"]["kind"], "detachedQueued");
    let result = immutable_wait(&mut h, "limited");
    assert_eq!(
        result.header["body"]["result"]["kind"], "failed",
        "{}",
        result.header
    );
    assert_eq!(result.header["body"]["result"]["globalFailure"], false);
    assert_eq!(state(&h.h), original);
    let status = h.body(
        "status",
        json!({"kind":"detachedStatus","targetOperationId":"limited"}),
    );
    assert_eq!(status["state"], "failed");
    assert!(!h.h.store.shared.context_unsettled());
}

#[test]
fn product_bucket_preserves_requested_rgba_alpha_at_full_command_coverage() {
    for alpha in [255, 128] {
        let mut h = Harness::new();
        let created = h.body("new", json!({"kind":"new","width":4,"height":4}));
        h.accept("new", &created);
        let layer = h.h.engine.active().unwrap().active_layer.unwrap().0;
        let before = state(&h.h);
        let prepared = product(&mut h, "rgbaFill", json!({"kind":"fill","layerId":layer.to_string(),"x":1,"y":1,"color":[255,0,0,alpha],"tolerance":0}));
        assert_eq!(prepared["kind"], "prepared", "{prepared}");
        assert!(state(&h.h).pixels.chunks_exact(4).all(|p| p == [255,0,0,alpha]));
        let discarded = h.body("discard",json!({"kind":"discard","candidateId":"rgbaFill"}));assert_eq!(discarded["kind"],"discarded");assert_eq!(state(&h.h),before);
        let prepared = product(&mut h, "acceptedFill", json!({"kind":"fill","layerId":layer.to_string(),"x":1,"y":1,"color":[255,0,0,alpha],"tolerance":0}));
        let version=h.accept("acceptedFill", &prepared);let reopened=h.reopen(&version);assert!(state(&reopened.h).pixels.chunks_exact(4).all(|p| p == [255,0,0,alpha]));
    }
}

#[test]
fn detached_pending_source_does_not_disable_current_layer_capabilities() {
    let mut h = Harness::new();
    let p = h.body("new", json!({"kind":"new","width":32,"height":32}));
    h.accept("new", &p);
    let background = immutable_new(&mut h, "backgroundSource", 16, 16);
    assert!(h.h.store.shared.context_unsettled());
    let s = h.summary();
    assert_eq!(s["tools"]["paint"]["enabled"], true, "{s}");
    assert_eq!(s["tools"]["newLayer"]["enabled"], true, "{s}");
    // Real foreground commands already allow unrelated detached obligations.
    let p = h.edit("foregroundLayer", json!({"kind":"newLayer","name":"artist"}));
    assert_eq!(p["kind"], "prepared");
    assert_eq!(h.summary()["tools"]["paint"]["enabled"], false);
    h.accept("foregroundLayer", &p);
    assert_eq!(h.summary()["tools"]["paint"]["enabled"], true);
    immutable_settle(&mut h, "backgroundSource", &background);
}
