use flow_photocraft::host::{Host, Request, Response, store};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};
static NEXT_FIXTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
struct Harness {
    host: Host,
    root: PathBuf,
    base: Option<String>,
    seq: u64,
}
impl Harness {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "flow-native-host-{}-{:?}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let host = Host::open(&root, 128 << 20).unwrap();
        Self {
            host,
            root,
            base: None,
            seq: 0,
        }
    }
    fn call(&mut self, op: &str, body: Value) -> Response {
        self.seq += 1;
        let r:Request=serde_json::from_value(json!({"protocol":1,"requestId":format!("r{}",self.seq),"sessionId":"s","incarnation":"i","workerEpoch":self.host.worker_epoch,"operationId":op,"baseVersion":self.base,"body":body})).unwrap();
        self.host.handle(r, vec![])
    }
    fn accept(&mut self, op: &str, v: &Response) -> String {
        assert_eq!(v.header["body"]["kind"], "prepared", "{}", v.header);
        let id = v.header["body"]["receipt"]["versionId"]
            .as_str()
            .unwrap()
            .to_string();
        let out = self.call(
            &format!("accept{op}"),
            json!({"kind":"accept","candidateId":op}),
        );
        assert_eq!(out.header["body"]["kind"], "accepted", "{}", out.header);
        self.base = Some(id.clone());
        id
    }
    fn edit(&mut self, op: &str, edit: Value) -> Response {
        self.call(op, json!({"kind":"edit","edit":edit}))
    }
    fn capture(&mut self) -> Vec<u8> {
        let r = self.call("capture", json!({"kind":"capture"}));
        assert_eq!(r.header["body"]["kind"], "frame", "{}", r.header);
        r.payload
    }
}
#[test]
fn native_live_commit_immutable_reload_host_undo_and_replay() {
    let mut h = Harness::new();
    let initial = h.call("new", json!({"kind":"new","width":512,"height":32}));
    let v0 = h.accept("new", &initial);
    let blank = h.capture();
    let began=h.call("begin",json!({"kind":"strokeBegin","previewId":"p","brush":{"size":12,"opacity":0.5,"pressureSize":false,"seed":9,"color":"#ff0000"},"points":[{"x":10.0,"y":15.0,"pressure":1.0}]}));
    assert_eq!(began.header["body"]["kind"], "frame", "{}", began.header);
    let appended=h.call("append",json!({"kind":"strokeAppend","previewId":"p","fromSeq":2,"points":[{"x":40.0,"y":15.0,"pressure":1.0},{"x":10.0,"y":15.0,"pressure":1.0}]}));
    assert_eq!(
        appended.header["body"]["kind"], "frame",
        "{}",
        appended.header
    );
    // Full capture while gesture is live gives the same native composite as the adopted final stroke.
    let preview = h.capture();
    let finished = h.call(
        "stroke",
        json!({"kind":"strokeFinish","previewId":"p","throughSeq":3}),
    );
    assert_eq!(
        finished.header["body"]["fromLive"], true,
        "{}",
        finished.header
    );
    let same = h.call(
        "stroke",
        json!({"kind":"strokeFinish","previewId":"p","throughSeq":3}),
    );
    assert_eq!(finished.header["body"], same.header["body"]);
    let v1 = h.accept("stroke", &finished);
    let committed = h.capture();
    assert_eq!(preview, committed);
    assert_ne!(blank, committed);
    let objects = fs::read_dir(h.root.join("tiles")).unwrap().count();
    assert!(objects > 0);
    assert!(
        finished.header["body"]["receipt"]["newObjectBytes"]
            .as_u64()
            .unwrap()
            > 0
    );
    // A metadata/selection version shares pixels: no new compressed object is written.
    let select = h.edit(
        "select",
        json!({"kind":"rect","x":0.0,"y":0.0,"width":50.0,"height":30.0}),
    );
    h.accept("select", &select);
    let duplicate = h.call(
        "stroke",
        json!({"kind":"strokeFinish","previewId":"p","throughSeq":3}),
    );
    assert_eq!(duplicate.header["body"]["kind"], "failure"); // changed base is a different operation request
    let root = h.root.clone();
    drop(h);
    let mut h = Harness {
        host: Host::open(&root, 128 << 20).unwrap(),
        root: root.clone(),
        base: None,
        seq: 100,
    };
    let loaded = h.call("load", json!({"kind":"load","versionId":v1}));
    assert_eq!(loaded.header["body"]["kind"], "loaded");
    h.base = Some(v1.clone());
    assert_eq!(h.capture(), committed);
    let undone = h.call("undo", json!({"kind":"install","versionId":v0}));
    assert_eq!(
        undone.header["body"]["kind"], "installed",
        "{}",
        undone.header
    );
    h.base = Some(v0);
    assert_eq!(h.capture(), blank);
    let redone = h.call("redo", json!({"kind":"install","versionId":v1}));
    assert_eq!(redone.header["body"]["kind"], "installed");
    h.base = Some(v1);
    assert_eq!(h.capture(), committed);
    eprintln!("native evidence retained: {}", root.display());
}
#[test]
fn real_selection_transform_blur_and_failed_command_preserves_pixels() {
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":64,"height":64}));
    h.accept("n", &n);
    let fill = h.edit("fill", json!({"kind":"fill","color":"#224466"}));
    h.accept("fill", &fill);
    let select = h.edit(
        "select",
        json!({"kind":"lasso","points":[[5.0,5.0],[45.0,5.0],[45.0,45.0],[5.0,45.0]]}),
    );
    h.accept("select", &select);
    let x = h.edit(
        "transform",
        json!({"kind":"transform","matrix":[1.0,0.0,0.0,1.0,2.0,3.0]}),
    );
    h.accept("transform", &x);
    let blur = h.edit("blur", json!({"kind":"blur","radius":2.0}));
    h.accept("blur", &blur);
    let before = h.capture();
    let failed = h.edit(
        "badtransform",
        json!({"kind":"transform","matrix":[0.0,0.0,0.0,0.0,0.0,0.0]}),
    );
    assert_eq!(
        failed.header["body"]["kind"], "failure",
        "{}",
        failed.header
    );
    assert_eq!(h.capture(), before);
    eprintln!("selection evidence retained: {}", h.root.display());
}
#[test]
fn operation_receipt_survives_lost_response_and_accept_restarts() {
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":32,"height":32}));
    h.accept("n", &n);
    let req = json!({"kind":"edit","edit":{"kind":"fill","color":"#ff0000"}});
    let prepared = h.call("lost", req.clone());
    assert_eq!(prepared.header["body"]["kind"], "prepared");
    let repeated = h.call("lost", req.clone());
    assert_eq!(prepared.header["body"], repeated.header["body"]);
    let root = h.root.clone();
    let base = h.base.clone();
    drop(h);
    let mut h = Harness {
        host: Host::open(&root, 128 << 20).unwrap(),
        root,
        base: None,
        seq: 0,
    };
    let loaded = h.call("load", json!({"kind":"load","versionId":base}));
    assert_eq!(loaded.header["body"]["kind"], "loaded");
    h.base = base;
    let repeated = h.call("lost", req);
    assert_eq!(repeated.header["body"]["kind"], "prepared");
    h.accept("lost", &repeated);
    assert!(h.capture().chunks_exact(4).all(|p| p == [255, 0, 0, 255]));
    let status = h.call(
        "status",
        json!({"kind":"status","targetOperationId":"lost"}),
    );
    assert_eq!(status.header["body"]["state"], "accepted");
    let bad = h.call(
        "lost",
        json!({"kind":"edit","edit":{"kind":"fill","color":"#00ff00"}}),
    );
    assert_eq!(bad.header["body"]["error"]["code"], "conflict");
}
#[test]
fn append_only_corruption_retained_and_exclusive_writer() {
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":32,"height":32}));
    h.accept("n", &n);
    assert!(Host::open(&h.root, 128 << 20).is_err());
    let fill = h.edit("fill", json!({"kind":"fill","color":"#ff0000"}));
    h.accept("fill", &fill);
    let tile = fs::read_dir(h.root.join("tiles"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::write(&tile, b"broken-evidence").unwrap();
    let edit = h.edit("corrupt", json!({"kind":"newLayer","name":"new"}));
    assert_eq!(edit.header["body"]["kind"], "failure");
    assert_eq!(fs::read(tile).unwrap(), b"broken-evidence");
    let mut s = store::Store::open(
        &std::env::temp_dir().join(format!("flow-host-small-{}", std::process::id())),
        1,
    )
    .unwrap();
    assert!(s.publish("ops/x.intent.json", b"too big").is_err());
}

#[test]
fn hosted_checkpoint_restores_pre_admission_floating_side_effect_and_tools() {
    use photocraft_color::{ColorMode, SampleType};
    use photocraft_doc::{Document, Layer};
    use photocraft_engine::{Session, float_cmds};
    use photocraft_geom::{Rect, Size};
    use photocraft_ops::LayerTarget;
    let mut session = Session::new();
    let mut doc = Document::new(
        "synthetic",
        Size::new(64, 64),
        ColorMode::Rgb,
        SampleType::U8,
    );
    let mut layer = Layer::raster("paint", doc.pixel_format());
    layer
        .surface_mut()
        .unwrap()
        .fill_rect(Rect::new(4, 4, 40, 40), &[1.0, 0.0, 0.0, 1.0]);
    doc.layers.push(layer);
    session.add_document(doc, None);
    session.host_clear_history().unwrap();
    assert!(!session.active().unwrap().history.can_undo());
    session
        .execute("select.rect", json!({"x":5,"y":5,"width":20,"height":20}))
        .unwrap();
    session
        .execute("select.float", json!({"dx":7,"dy":2}))
        .unwrap();
    assert!(float_cmds::floating(session.active().unwrap()).is_some());
    let original = session.active().unwrap().doc.clone();
    let displayed = float_cmds::displayed(session.active().unwrap(), (0, 0)).unwrap();
    let before = photocraft_compose::flatten(&displayed).to_rgba8().pixels;
    session.tools.foreground = [0.0, 1.0, 0.0, 1.0];
    session.tools.brush.size = 17.0;
    let checkpoint = session.host_checkpoint().unwrap();
    session.tools.foreground = [0.0, 0.0, 1.0, 1.0];
    session.tools.brush.size = 99.0;
    // Dispatch auto-drops the floating selection BEFORE rejecting the invalid target.
    let failure = session.execute(
        "edit.transform",
        json!({"layer":9876543u64,"matrix":[1,0,0,1,3,2]}),
    );
    assert!(failure.is_err());
    assert!(float_cmds::floating(session.active().unwrap()).is_none());
    session.host_restore(checkpoint).unwrap();
    assert!(float_cmds::floating(session.active().unwrap()).is_some());
    assert!(std::sync::Arc::ptr_eq(
        &original,
        &session.active().unwrap().doc
    ));
    assert_eq!(session.tools.foreground, [0.0, 1.0, 0.0, 1.0]);
    assert_eq!(session.tools.brush.size, 17.0);
    let after = photocraft_compose::flatten(
        &float_cmds::displayed(session.active().unwrap(), (0, 0)).unwrap(),
    )
    .to_rgba8()
    .pixels;
    assert_eq!(before, after);
    let target = LayerTarget {
        active: session.active().unwrap().active_layer,
        selected: session.active().unwrap().selected_layers.clone(),
    };
    assert!(
        session
            .host_install(original.clone(), target.clone())
            .is_err()
    );
    session.execute("select.drop", json!({})).unwrap();
    session.host_install(original, target).unwrap();
    assert!(!session.active().unwrap().history.can_undo());
    assert!(session.active().unwrap().snapshots.is_empty());
}

#[test]
fn bad_point_prefix_and_epoch_refuse_without_committing_or_dropping_live_stroke() {
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":64,"height":64}));
    h.accept("n", &n);
    let begin = h.call(
        "b",
        json!({"kind":"strokeBegin","previewId":"p","brush":{"size":5},"points":[{"x":10,"y":10}]}),
    );
    assert_eq!(begin.header["body"]["kind"], "frame");
    let wrong = h.call(
        "wrong",
        json!({"kind":"strokeAppend","previewId":"p","fromSeq":5,"points":[{"x":30,"y":10}]}),
    );
    assert_eq!(wrong.header["body"]["error"]["code"], "conflict");
    let freeze = h.call("f", json!({"kind":"freeze"}));
    assert_eq!(freeze.header["body"]["error"]["code"], "busy");
    let finish = h.call(
        "done",
        json!({"kind":"strokeFinish","previewId":"p","throughSeq":1}),
    );
    h.accept("done", &finish);
    let r:Request=serde_json::from_value(json!({"protocol":1,"requestId":"stale","sessionId":"s","incarnation":"i","workerEpoch":h.host.worker_epoch+1,"operationId":"stale","baseVersion":h.base,"body":{"kind":"capture"}})).unwrap();
    let result = h.host.handle(r, vec![]);
    assert_eq!(result.header["body"]["error"]["code"], "stale-authority");
}

#[test]
fn wire_rejects_truncation_and_oversize_before_allocating() {
    use flow_photocraft::host::wire;
    assert!(wire::read(&mut &[][..]).unwrap().is_none());
    assert!(wire::read(&mut &[1, 2, 3][..]).is_err());
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&65537u32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    assert!(wire::read(&mut bytes.as_slice()).is_err());
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&2u32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(b"{");
    assert!(wire::read(&mut bytes.as_slice()).is_err());
}

#[test]
fn same_length_rewrite_with_restored_mtime_invalidates_verified_object_cache() {
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":64,"height":64}));
    h.accept("n", &n);
    let fill = h.edit("fill", json!({"kind":"fill","color":"#223344"}));
    h.accept("fill", &fill);
    let tile = fs::read_dir(h.root.join("tiles"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let time = fs::metadata(&tile).unwrap().modified().unwrap();
    let mut bytes = fs::read(&tile).unwrap();
    bytes[0] ^= 0x40;
    fs::write(&tile, &bytes).unwrap();
    fs::File::options()
        .write(true)
        .open(&tile)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(time))
        .unwrap();
    let edit = h.edit("tampered", json!({"kind":"newLayer","name":"new"}));
    assert_eq!(edit.header["body"]["kind"], "failure");
    assert_eq!(edit.header["body"]["error"]["effect"], "retained");
    assert_eq!(fs::read(&tile).unwrap(), bytes);
}

#[test]
fn operation_receipt_checksum_refuses_tampering_before_replay() {
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":16,"height":16}));
    h.accept("n", &n);
    let root = h.root.clone();
    drop(h);
    let path = fs::read_dir(root.join("ops"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut bytes = fs::read(&path).unwrap();
    let last = bytes.len() - 2;
    bytes[last] ^= 1;
    fs::write(&path, &bytes).unwrap();
    assert!(Host::open(&root, 128 << 20).is_err());
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn torn_journal_tail_is_retained_and_restart_uses_complete_prefix() {
    use std::io::Write;
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":16,"height":16}));
    h.accept("n", &n);
    let root = h.root.clone();
    let base = h.base.clone();
    drop(h);
    let path = fs::read_dir(root.join("ops"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(&[32, 0, 0, 0, 1, 2, 3]).unwrap();
    file.sync_all().unwrap();
    drop(file);
    let retained = fs::read(&path).unwrap();
    let mut h = Harness {
        host: Host::open(&root, 128 << 20).unwrap(),
        root: root.clone(),
        base: None,
        seq: 1,
    };
    let status = h.call("status", json!({"kind":"status","targetOperationId":"n"}));
    assert_eq!(status.header["body"]["state"], "accepted");
    let load = h.call("load", json!({"kind":"load","versionId":base}));
    assert_eq!(load.header["body"]["kind"], "loaded");
    assert_eq!(fs::read(path).unwrap(), retained);
    assert_eq!(fs::read_dir(root.join("ops")).unwrap().count(), 2);
}

#[test]
fn discarded_candidate_is_idempotent_and_cannot_later_be_accepted() {
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":16,"height":16}));
    h.accept("n", &n);
    let before = h.capture();
    let prepared = h.edit("edit", json!({"kind":"fill","color":"#ff0000"}));
    assert_eq!(prepared.header["body"]["kind"], "prepared");
    let discard = h.call("discard", json!({"kind":"discard","candidateId":"edit"}));
    assert_eq!(discard.header["body"]["kind"], "discarded");
    let again = h.call("again", json!({"kind":"discard","candidateId":"edit"}));
    assert_eq!(again.header["body"], discard.header["body"]);
    assert_eq!(h.capture(), before);
    let illegal = h.call("late", json!({"kind":"accept","candidateId":"edit"}));
    assert_eq!(illegal.header["body"]["error"]["code"], "conflict");
}

#[test]
fn display_input_prefix_accumulates_across_accept_capture_and_next_stroke() {
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":64,"height":64}));
    h.accept("n", &n);
    let initial = h.call("initial", json!({"kind":"capture"}));
    let epoch = initial.header["body"]["frame"]["epoch"].clone();
    assert_eq!(initial.header["body"]["frame"]["inputThrough"], 0);
    for i in 0..3 {
        let p = format!("p{i}");
        let op = format!("stroke{i}");
        let begin=h.call(&format!("begin{i}"),json!({"kind":"strokeBegin","previewId":p,"brush":{"size":5,"opacity":0.5},"points":[{"x":10,"y":10}]}));
        assert_eq!(begin.header["body"]["frame"]["inputThrough"], i * 2 + 1);
        assert_eq!(begin.header["body"]["frame"]["epoch"], epoch);
        let append = h.call(
            &format!("append{i}"),
            json!({"kind":"strokeAppend","previewId":p,"fromSeq":2,"points":[{"x":20,"y":20}]}),
        );
        assert_eq!(append.header["body"]["frame"]["inputThrough"], i * 2 + 2);
        let finish = h.call(
            &op,
            json!({"kind":"strokeFinish","previewId":p,"throughSeq":2}),
        );
        h.accept(&op, &finish);
        let capture = h.call(&format!("capture{i}"), json!({"kind":"capture"}));
        assert_eq!(capture.header["body"]["frame"]["inputThrough"], i * 2 + 2);
        assert_eq!(capture.header["body"]["frame"]["epoch"], epoch);
    }
    let begin=h.call("cancelBegin",json!({"kind":"strokeBegin","previewId":"cancel","brush":{"size":5},"points":[{"x":30,"y":30}]}));
    assert_eq!(begin.header["body"]["frame"]["inputThrough"], 7);
    h.call(
        "cancel",
        json!({"kind":"strokeCancel","previewId":"cancel"}),
    );
    let reset = h.call("reset", json!({"kind":"capture"}));
    assert_ne!(reset.header["body"]["frame"]["epoch"], epoch);
    assert_eq!(reset.header["body"]["frame"]["inputThrough"], 0);
}

#[test]
fn incremental_frames_erase_removed_tail_on_reversing_pressure_stroke() {
    fn apply(dst: &mut [u8], width: usize, r: Response) {
        assert_eq!(r.header["body"]["kind"], "frame", "{}", r.header);
        for tile in r.header["body"]["frame"]["tiles"].as_array().unwrap() {
            let x = tile["x"].as_u64().unwrap() as usize;
            let y = tile["y"].as_u64().unwrap() as usize;
            let w = tile["w"].as_u64().unwrap() as usize;
            let h = tile["h"].as_u64().unwrap() as usize;
            let offset = tile["offset"].as_u64().unwrap() as usize;
            for row in 0..h {
                let target = ((y + row) * width + x) * 4;
                let source = offset + row * w * 4;
                dst[target..target + w * 4].copy_from_slice(&r.payload[source..source + w * 4]);
            }
        }
    }
    let mut h = Harness::new();
    let n = h.call("n", json!({"kind":"new","width":512,"height":256}));
    h.accept("n", &n);
    let fill = h.edit("fill", json!({"kind":"fill","color":"#778899"}));
    h.accept("fill", &fill);
    let mut display = h.capture();
    for i in 0..8 {
        let id = format!("p{i}");
        let begin = h.call(&format!("begin{i}"), json!({"kind":"strokeBegin","previewId":id,"brush":{"size":24,"opacity":0.5,"flow":1,"seed":i+1,"erase":i%4==3,"color":"#ee2244"},"points":[{"x":200,"y":200,"pressure":1}]}));
        apply(&mut display, 512, begin);
        for (index, x) in [240, 280, 320, 280, 240, 200].iter().enumerate() {
            let frame = h.call(&format!("append{i}_{index}"), json!({"kind":"strokeAppend","previewId":id,"fromSeq":index+2,"points":[{"x":x,"y":200,"pressure":0.75}]}));
            apply(&mut display, 512, frame);
        }
        // Compare the transported delta chain with the native preview before pen-up.
        assert!(
            display == h.capture(),
            "stale removed tail before finish {i}"
        );
        let finish = format!("finish{i}");
        let prepared = h.call(
            &finish,
            json!({"kind":"strokeFinish","previewId":id,"throughSeq":7}),
        );
        h.accept(&finish, &prepared);
        assert!(
            display == h.capture(),
            "live adoption differs at stroke {i}"
        );
    }
    eprintln!("reversing-tail evidence retained: {}", h.root.display());
}

#[test]
fn bounded_pipeline_preserves_fixed_bases_fifo_and_explicit_durable_accept() {
    let mut h = Harness::new();
    let n = h.call("new", json!({"kind":"new","width":512,"height":64}));
    h.accept("new", &n);
    let anchor = h.base.clone();
    let old = h.call("capture", json!({"kind":"capture"}));
    let started=h.call("start",json!({"kind":"pipelineStart","maxPendingStrokes":2,"maxPendingPoints":8,"maxRetainedPixelBytes":16777216}));
    assert_eq!(
        started.header["body"]["kind"], "pipelineReady",
        "{}",
        started.header
    );
    let pipeline = started.header["body"]["pipelineId"].clone();
    let mut last = None;
    let mut expected = None;
    for i in 0..2 {
        let id = format!("p{i}");
        let begin=h.call(&format!("begin{i}"),json!({"kind":"strokeBegin","previewId":id,"predecessorOperationId":last,"brush":{"size":12,"opacity":0.5,"seed":i+1,"color":"#ff0000"},"points":[{"x":20,"y":20,"pressure":1}]}));
        assert_eq!(begin.header["body"]["kind"], "frame", "{}", begin.header);
        assert!(
            begin.header["body"]["frame"]["epoch"].as_u64().unwrap()
                > old.header["body"]["frame"]["epoch"].as_u64().unwrap()
        );
        let append=h.call(&format!("append{i}"),json!({"kind":"strokeAppend","previewId":id,"fromSeq":2,"points":[{"x":60,"y":20,"pressure":1}]}));
        assert_eq!(append.header["body"]["kind"], "frame");
        expected = Some(h.capture());
        let op = format!("finish{i}");
        let finish = h.call(
            &op,
            json!({"kind":"strokeFinish","previewId":id,"throughSeq":2}),
        );
        assert_eq!(finish.header["body"]["kind"], "queued", "{}", finish.header);
        assert_eq!(finish.header["body"]["durable"], false);
        let again = h.call(
            &op,
            json!({"kind":"strokeFinish","previewId":id,"throughSeq":2}),
        );
        assert_ne!(again.header["body"]["kind"], "failure");
        last = Some(op);
    }
    let full=h.call("full",json!({"kind":"strokeBegin","previewId":"full","predecessorOperationId":last,"brush":{},"points":[{"x":100,"y":20}]}));
    assert_eq!(full.header["body"]["error"]["code"], "backpressure");
    let mut prepared = std::collections::HashMap::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while prepared.len() < 2 {
        let poll = h.call("poll", json!({"kind":"pipelinePoll","pipelineId":pipeline}));
        for event in poll.header["body"]["events"].as_array().unwrap() {
            if event["result"]["kind"] == "prepared" {
                prepared.insert(
                    event["operationId"].as_str().unwrap().to_owned(),
                    event["result"].clone(),
                );
            }
        }
        assert!(std::time::Instant::now() < deadline, "{}", poll.header);
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    assert_eq!(prepared["finish0"]["baseVersion"], json!(anchor));
    assert_eq!(
        prepared["finish1"]["baseVersion"],
        prepared["finish0"]["receipt"]["versionId"]
    );
    let wrong = h.call("wrong", json!({"kind":"accept","candidateId":"finish1"}));
    assert_eq!(wrong.header["body"]["error"]["code"], "conflict");
    for i in 0..2 {
        let op = format!("finish{i}");
        let request = h.call(
            &format!("accept{i}"),
            json!({"kind":"accept","candidateId":op}),
        );
        assert_eq!(
            request.header["body"]["kind"], "acceptQueued",
            "{}",
            request.header
        );
        assert_eq!(request.header["body"]["durable"], false);
        loop {
            // Poll is control-plane; input envelopes retain anchor, accept uses current Main CAS base.
            h.base = anchor.clone();
            let poll = h.call("poll", json!({"kind":"pipelinePoll","pipelineId":pipeline}));
            if poll.header["body"]["events"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["operationId"] == op && e["result"]["kind"] == "accepted")
            {
                break;
            }
            assert!(std::time::Instant::now() < deadline, "{}", poll.header);
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        h.base = Some(
            prepared[&op]["receipt"]["versionId"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
        let duplicate = h.call(
            &format!("acceptDuplicate{i}"),
            json!({"kind":"accept","candidateId":op}),
        );
        assert_eq!(duplicate.header["body"]["kind"], "accepted");
    }
    let accepted = h.base.clone();
    h.base = anchor;
    assert_eq!(h.capture(), expected.unwrap());
    let stopped = h.call("stop", json!({"kind":"pipelineStop","pipelineId":pipeline}));
    assert_eq!(
        stopped.header["body"]["kind"], "pipelineStopped",
        "{}",
        stopped.header
    );
    h.base = accepted;
    assert!(!h.capture().is_empty());
    eprintln!("pipeline evidence retained: {}", h.root.display());
}

#[test]
fn pipeline_batches_reject_whole_prefix_and_freeze_keeps_admitted_obligation() {
    let mut h = Harness::new();
    let n = h.call("new", json!({"kind":"new","width":512,"height":64}));
    h.accept("new", &n);
    let started=h.call("start",json!({"kind":"pipelineStart","maxPendingStrokes":2,"maxPendingPoints":3,"maxRetainedPixelBytes":16777216}));
    let pipeline = started.header["body"]["pipelineId"].clone();
    let unseeded = h.call("unseeded", json!({"kind":"strokeBegin","previewId":"missingSeed","brush":{"size":12},"points":[{"x":20,"y":20}]}));
    assert_eq!(unseeded.header["body"]["error"]["code"], "invalid-input");
    let begin=h.call("begin",json!({"kind":"strokeBegin","previewId":"p","brush":{"size":12,"seed":8},"points":[{"x":20,"y":20}]}));
    assert_eq!(begin.header["body"]["frame"]["inputThrough"], 1);
    let original = h.capture();
    let bad=h.call("invalid",json!({"kind":"strokeAppend","previewId":"p","fromSeq":2,"points":[{"x":30,"y":20},{"x":1e30,"y":20}]}));
    assert_eq!(bad.header["body"]["kind"], "failure");
    assert_eq!(original, h.capture());
    let over=h.call("over",json!({"kind":"strokeAppend","previewId":"p","fromSeq":2,"points":[{"x":30,"y":20},{"x":40,"y":20},{"x":50,"y":20}]}));
    assert_eq!(over.header["body"]["error"]["code"], "backpressure");
    assert_eq!(original, h.capture());
    let poll = h.call("poll", json!({"kind":"pipelinePoll","pipelineId":pipeline}));
    assert_eq!(poll.header["body"]["active"]["throughSeq"], 1);
    assert_eq!(poll.header["body"]["pendingPoints"], 1);
    let freeze = h.call("freeze", json!({"kind":"freeze"}));
    assert_eq!(freeze.header["body"]["error"]["effect"], "retained");
    let append = h.call(
        "appendFrozen",
        json!({"kind":"strokeAppend","previewId":"p","fromSeq":2,"points":[{"x":30,"y":20}]}),
    );
    assert_eq!(append.header["body"]["error"]["code"], "frozen");
    let close = h.call("close", json!({"kind":"close"}));
    assert_eq!(close.header["body"]["kind"], "failure");
    let finish = h.call(
        "finish",
        json!({"kind":"strokeFinish","previewId":"p","throughSeq":1}),
    );
    assert_eq!(finish.header["body"]["kind"], "queued", "{}", finish.header);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let poll = h.call("poll", json!({"kind":"pipelinePoll","pipelineId":pipeline}));
        if poll.header["body"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["result"]["kind"] == "prepared")
        {
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    let accepted = h.call("accept", json!({"kind":"accept","candidateId":"finish"}));
    assert_eq!(accepted.header["body"]["kind"], "acceptQueued");
    loop {
        let poll = h.call("poll", json!({"kind":"pipelinePoll","pipelineId":pipeline}));
        if poll.header["body"]["queueDepth"] == 0 {
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    let frozen = h.call("freezeAgain", json!({"kind":"freeze"}));
    assert_eq!(frozen.header["body"]["kind"], "frozen");
    let stopped = h.call("stop", json!({"kind":"pipelineStop","pipelineId":pipeline}));
    assert_eq!(stopped.header["body"]["kind"], "pipelineStopped");
    let closed = h.call("close", json!({"kind":"close"}));
    assert_eq!(closed.header["body"]["kind"], "closed");
}

#[test]
fn pipeline_pixel_budget_rejects_entire_append_without_losing_old_samples() {
    let mut h = Harness::new();
    let n = h.call("new", json!({"kind":"new","width":512,"height":64}));
    h.accept("new", &n);
    let started=h.call("start",json!({"kind":"pipelineStart","maxPendingStrokes":2,"maxPendingPoints":20,"maxRetainedPixelBytes":262144}));
    assert_eq!(
        started.header["body"]["kind"], "pipelineReady",
        "{}",
        started.header
    );
    let pipeline = started.header["body"]["pipelineId"].clone();
    let begin=h.call("begin",json!({"kind":"strokeBegin","previewId":"p","brush":{"size":12,"seed":8},"points":[{"x":20,"y":20}]}));
    assert_eq!(begin.header["body"]["kind"], "frame", "{}", begin.header);
    let old = h.capture();
    let append=h.call("over",json!({"kind":"strokeAppend","previewId":"p","fromSeq":2,"points":[{"x":40,"y":20},{"x":300,"y":20}]}));
    assert_eq!(
        append.header["body"]["error"]["code"], "backpressure",
        "{}",
        append.header
    );
    assert_eq!(h.capture(), old);
    let poll = h.call("poll", json!({"kind":"pipelinePoll","pipelineId":pipeline}));
    assert_eq!(poll.header["body"]["active"]["throughSeq"], 1);
    assert_eq!(poll.header["body"]["pendingPoints"], 1);
    let valid = h.call(
        "valid",
        json!({"kind":"strokeAppend","previewId":"p","fromSeq":2,"points":[{"x":40,"y":20}]}),
    );
    assert_eq!(
        valid.header["body"]["frame"]["inputThrough"], 2,
        "{}",
        valid.header
    );
    let cancelled = h.call("cancel", json!({"kind":"strokeCancel","previewId":"p"}));
    assert_eq!(cancelled.header["body"]["kind"], "cancelled");
    let stop = h.call("stop", json!({"kind":"pipelineStop","pipelineId":pipeline}));
    assert_eq!(stop.header["body"]["kind"], "pipelineStopped");
}

#[test]
fn explicit_recovered_accept_can_settle_exact_main_installed_candidate_version() {
    let mut h = Harness::new();
    let n = h.call("new", json!({"kind":"new","width":64,"height":32}));
    h.accept("new", &n);
    let prepared = h.edit("lostAccept", json!({"kind":"fill","color":"#1144aa"}));
    assert_eq!(prepared.header["body"]["kind"], "prepared");
    let version = prepared.header["body"]["receipt"]["versionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let root = h.root.clone();
    drop(h);
    let mut h = Harness {
        host: Host::open(&root, 128 << 20).unwrap(),
        root,
        base: None,
        seq: 0,
    };
    let load = h.call("load", json!({"kind":"load","versionId":version}));
    assert_eq!(load.header["body"]["kind"], "loaded");
    h.base = Some(version.clone());
    let status = h.call(
        "status",
        json!({"kind":"status","targetOperationId":"lostAccept"}),
    );
    assert_eq!(status.header["body"]["state"], "prepared");
    let explicit = h.call(
        "settle",
        json!({"kind":"accept","candidateId":"lostAccept"}),
    );
    assert_eq!(
        explicit.header["body"]["kind"], "accepted",
        "{}",
        explicit.header
    );
    assert_eq!(explicit.header["body"]["receipt"]["versionId"], version);
    let status = h.call(
        "statusAfter",
        json!({"kind":"status","targetOperationId":"lostAccept"}),
    );
    assert_eq!(status.header["body"]["state"], "accepted");
}

#[test]
fn recovered_accept_origin_survives_load_and_journal_failure_then_same_host_retry() {
    fn usage(root: &std::path::Path) -> u64 {
        fs::read_dir(root)
            .unwrap()
            .map(|e| {
                let p = e.unwrap().path();
                if p.is_dir() {
                    usage(&p)
                } else {
                    p.metadata().unwrap().len()
                }
            })
            .sum()
    }
    for installed in [false, true] {
        for journal_failure in [false, true] {
            let mut h = Harness::new();
            let n = h.call("new", json!({"kind":"new","width":64,"height":32}));
            let old = h.accept("new", &n);
            let old_pixels = h.capture();
            let prepared = h.edit("candidate", json!({"kind":"fill","color":"#33aa66"}));
            let new = prepared.header["body"]["receipt"]["versionId"]
                .as_str()
                .unwrap()
                .to_owned();
            let root = h.root.clone();
            drop(h);
            let reservation = root.join("staging/test-reservation.tmp");
            fs::write(&reservation, vec![0u8; 16384]).unwrap();
            let budget = if journal_failure {
                usage(&root)
            } else {
                128 << 20
            };
            let mut h = Harness {
                host: Host::open(&root, budget).unwrap(),
                root: root.clone(),
                base: None,
                seq: 0,
            };
            let base = if installed { new.clone() } else { old.clone() };
            let loaded = h.call("load", json!({"kind":"load","versionId":base}));
            assert_eq!(loaded.header["body"]["kind"], "loaded");
            h.base = Some(base);
            let _before = h.capture();
            let manifest = root.join(format!("versions/{new}.json"));
            let retained = root.with_extension("retained-candidate.json");
            if !journal_failure {
                fs::rename(&manifest, &retained).unwrap();
            }
            let failed = h.call(
                "firstAccept",
                json!({"kind":"accept","candidateId":"candidate"}),
            );
            assert_eq!(
                failed.header["body"]["kind"], "failure",
                "installed={installed} journal={journal_failure}: {}",
                failed.header
            );
            let status = h.call(
                "afterFailure",
                json!({"kind":"status","targetOperationId":"candidate"}),
            );
            assert_eq!(
                status.header["body"]["state"], "prepared",
                "failure cannot claim accepted"
            );
            if journal_failure {
                fs::rename(
                    &reservation,
                    root.with_extension("retained-test-reservation"),
                )
                .unwrap();
            } else {
                fs::rename(&retained, &manifest).unwrap();
            }
            let retry = h.call(
                "retryAccept",
                json!({"kind":"accept","candidateId":"candidate"}),
            );
            assert_eq!(
                retry.header["body"]["kind"], "accepted",
                "installed={installed} journal={journal_failure}: {}",
                retry.header
            );
            h.base = Some(new.clone());
            let after = h.capture();
            assert_ne!(after, old_pixels);
            assert!(after.chunks_exact(4).all(|p| p == [51, 170, 102, 255]));
            eprintln!(
                "recovery retry evidence retained: installed={installed} journal_failure={journal_failure} {}",
                root.display()
            );
        }
    }
}
