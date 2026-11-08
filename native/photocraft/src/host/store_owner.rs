//! One permanent storage writer. CPU-only immutable jobs may run elsewhere;
//! publishing, operation records and verification remain on this owner alone.
use super::*;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc::{self, RecvTimeoutError, SyncSender, TryRecvError},
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

type Reply = Box<dyn FnOnce() + Send>;
type Run = Box<dyn FnOnce(&mut Store) -> Reply + Send>;
enum Task {
    Run(Run),
    Stop,
}
#[derive(Clone)]
struct Snapshot {
    edits: Vec<String>,
    detached_count: usize,
    unsettled: bool,
    error: Option<Error>,
}
fn snapshot(store: &Store) -> Snapshot {
    let result = (|| -> Result<(Vec<String>, Vec<String>)> {
        let all = store.unresolved()?;
        let mut edits = Vec::new();
        for id in &all {
            let intent = store.op_read(id, "intent")?;
            if intent
                .as_ref()
                .is_none_or(|v| v["request"]["kind"] != "detachedPrepare")
            {
                edits.push(id.clone());
            }
        }
        if store.journal_write_failed() {
            return Err(Error::retained(
                "journal",
                "native journal write failed; retain operations and restart before new input",
            ));
        }
        Ok((all, edits))
    })();
    match result {
        Ok((all, edits)) => Snapshot {
            detached_count: all.len().saturating_sub(edits.len()),
            unsettled: store.context_unsettled(),
            edits,
            error: None,
        },
        Err(e) => Snapshot {
            detached_count: 0,
            edits: vec![],
            unsettled: true,
            error: Some(e),
        },
    }
}
struct Inner {
    high: SyncSender<Task>,
    low: SyncSender<Task>,
    snapshot: Arc<Mutex<Snapshot>>,
    input_busy: Arc<AtomicBool>,
    low_running: Arc<AtomicBool>,
    background: AtomicBool,
    join: Mutex<Option<JoinHandle<()>>>,
    policy: &'static str,
}
impl Drop for Inner {
    fn drop(&mut self) {
        let _ = self.high.send(Task::Stop);
        if let Ok(join) = self.join.get_mut() {
            if let Some(join) = join.take() {
                let _ = join.join();
            }
        }
    }
}
#[derive(Clone)]
pub(super) struct StoreProxy(Arc<Inner>);
impl StoreProxy {
    pub(super) fn new(mut store: Store) -> Self {
        let policy = store.cache_policy();
        let initial = snapshot(&store);
        let shared = Arc::new(Mutex::new(initial));
        let busy = Arc::new(AtomicBool::new(false));
        let running = Arc::new(AtomicBool::new(false));
        let (high, hi) = mpsc::sync_channel(8);
        let (low, lo) = mpsc::sync_channel(2);
        let state = shared.clone();
        let input = busy.clone();
        let low_state = running.clone();
        let join = thread::spawn(move || {
            loop {
                let task = match hi.try_recv() {
                    Ok(t) => Some((t, false)),
                    Err(TryRecvError::Disconnected) => break,
                    Err(TryRecvError::Empty) => None,
                };
                let task = task.or_else(|| {
                    if !input.load(Ordering::Acquire) {
                        lo.try_recv().ok().map(|t| (t, true))
                    } else {
                        None
                    }
                });
                let (task, background) = match task {
                    Some(v) => v,
                    None => match hi.recv_timeout(Duration::from_millis(2)) {
                        Ok(t) => (t, false),
                        Err(RecvTimeoutError::Timeout) => continue,
                        Err(RecvTimeoutError::Disconnected) => break,
                    },
                };
                match task {
                    Task::Stop => break,
                    Task::Run(run) => {
                        low_state.store(background, Ordering::Release);
                        let deliver = run(&mut store);
                        let current = snapshot(&store);
                        if let Ok(mut s) = state.lock() {
                            *s = current;
                        }
                        low_state.store(false, Ordering::Release);
                        deliver();
                    }
                }
            }
        });
        Self(Arc::new(Inner {
            high,
            low,
            snapshot: shared,
            input_busy: busy,
            low_running: running,
            background: AtomicBool::new(false),
            join: Mutex::new(Some(join)),
            policy,
        }))
    }
    pub(super) fn call<T: Send + 'static>(
        &self,
        background: bool,
        work: impl FnOnce(&mut Store) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (tx, rx) = mpsc::sync_channel(1);
        let run = Task::Run(Box::new(move |store| {
            let result = work(store);
            Box::new(move || {
                let _ = tx.send(result);
            })
        }));
        (if background {
            &self.0.low
        } else {
            &self.0.high
        })
        .send(run)
        .map_err(|_| Error::unknown("storage owner unavailable; side effect not inferred"))?;
        rx.recv()
            .map_err(|_| Error::unknown("storage owner reply lost; query original operation"))?
    }
    pub(super) fn set_input_busy(&self, value: bool) {
        self.0.input_busy.store(value, Ordering::Release);
    }
    pub(super) fn set_background(&self, value: bool) {
        self.0.background.store(value, Ordering::Release);
    }
    pub(super) fn background_io_active(&self) -> bool {
        self.0.low_running.load(Ordering::Acquire)
    }
    pub(super) fn input_busy(&self) -> bool {
        self.0.input_busy.load(Ordering::Acquire)
    }
    pub(super) fn call_budgeted<T: Send + 'static>(
        &self,
        background: bool,
        maximum: u64,
        work: impl FnOnce(&mut Store) -> Result<T> + Send + 'static,
    ) -> Result<(T, u64)> {
        self.call(background, move |s| s.budgeted(maximum, work))
    }
    pub(super) fn cache_policy(&self) -> &'static str {
        self.0.policy
    }
    pub(super) fn detached_unsettled(&self) -> usize {
        self.0
            .snapshot
            .lock()
            .map_or(usize::MAX, |s| s.detached_count)
    }
    pub(super) fn context_unsettled(&self) -> bool {
        self.0
            .snapshot
            .lock()
            .map_or(true, |s| s.unsettled || s.error.is_some())
    }
    pub(super) fn edit_unresolved(&self) -> Result<Vec<String>> {
        if self.0.background.load(Ordering::Acquire) {
            let s = self
                .0
                .snapshot
                .lock()
                .map_err(|_| Error::unknown("storage admission snapshot unavailable"))?;
            if let Some(e) = &s.error {
                return Err(e.clone());
            }
            return Ok(s.edits.clone());
        }
        self.call(false, |s| {
            let all = s.unresolved()?;
            let mut edits = Vec::new();
            for id in all {
                if s.op_read(&id, "intent")?
                    .is_none_or(|v| v["request"]["kind"] != "detachedPrepare")
                {
                    edits.push(id);
                }
            }
            Ok(edits)
        })
    }
    pub(super) fn unresolved(&self) -> Result<Vec<String>> {
        self.call(false, |s| s.unresolved())
    }
    pub(super) fn op_read(&self, id: &str, state: &str) -> Result<Option<Value>> {
        let (id, state) = (id.to_owned(), state.to_owned());
        self.call(false, move |s| s.op_read(&id, &state))
    }
    pub(super) fn op_write(&self, id: &str, state: &str, value: &Value) -> Result<()> {
        let (id, state, value) = (id.to_owned(), state.to_owned(), value.clone());
        self.call(false, move |s| s.op_write(&id, &state, &value))
    }
    pub(super) fn load(&self, id: &str) -> Result<store::Loaded> {
        let id = id.to_owned();
        self.call(false, move |s| s.load(&id))
    }
    pub(super) fn save(
        &self,
        doc: &Document,
        target: &LayerTarget,
        source: Option<Source>,
    ) -> Result<VersionReceipt> {
        let (doc, target) = (doc.clone(), target.clone());
        self.call(false, move |s| s.save(&doc, &target, source))
    }
}
