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
    assert_eq!(s["layers"][0]["layerId"], top);
    assert_eq!(s["layers"][1]["layerId"], bottom);
    assert_eq!(s["layerCount"], 2);
    assert_eq!(s["activeLayerId"], top);
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
    let out=h.body("choose",json!({"kind":"selectLayerContext","layerId":bottom,"expectedContextGeneration":generation}));
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
    assert_eq!(h.body("stale",json!({"kind":"selectLayerContext","layerId":top,"expectedContextGeneration":generation}))["error"]["code"],"stale-context");
    let generation = h.h.context_generation;
    assert_eq!(h.body("missing",json!({"kind":"selectLayerContext","layerId":999999,"expectedContextGeneration":generation}))["kind"],"failure");
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
    let v=h.body("bottom",json!({"kind":"selectLayerContext","layerId":bottom,"expectedContextGeneration":generation}));
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
    assert_eq!(h.summary()["activeLayerId"], top);
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
    assert_eq!(s["floating"]["sourceLayerId"], top);
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
    assert_eq!(h.body("blockedSelect",json!({"kind":"selectLayerContext","layerId":top,"expectedContextGeneration":generation}))["error"]["code"],"busy");
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
    assert_eq!(h.body("chooseBusy",json!({"kind":"selectLayerContext","layerId":bottom,"expectedContextGeneration":generation}))["error"]["code"],"busy");
    assert_eq!(h.summary()["candidateId"], "blur");
    h.body("discard", json!({"kind":"discard","candidateId":"blur"}));
    let v=h.body("begin",json!({"kind":"strokeBegin","previewId":"paint","brush":{"seed":1,"size":3},"points":[{"x":20,"y":20}]}));
    assert_eq!(v["kind"], "frame", "{v}");
    let generation = h.h.context_generation;
    assert_eq!(h.body("choosePainting",json!({"kind":"selectLayerContext","layerId":bottom,"expectedContextGeneration":generation}))["error"]["code"],"busy");
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
    assert_eq!(h.body("choosePipeline",json!({"kind":"selectLayerContext","layerId":bottom,"expectedContextGeneration":generation}))["kind"],"failure");
    assert_eq!(
        h.body("stop", json!({"kind":"pipelineStop","pipelineId":id}))["kind"],
        "pipelineStopped"
    );
    assert_eq!(h.body("freeze", json!({"kind":"freeze"}))["kind"], "frozen");
    let generation = h.h.context_generation;
    assert_eq!(h.body("chooseFrozen",json!({"kind":"selectLayerContext","layerId":bottom,"expectedContextGeneration":generation}))["error"]["code"],"frozen");
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
    assert_eq!(s["layers"][0]["layerId"], group_id.0);
    assert_eq!(s["layers"][0]["kind"], "group");
    assert_eq!(s["layers"][0]["children"][0]["layerId"], child_id.0);
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
