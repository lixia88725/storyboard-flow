use flow_photocraft::host::{Host, Response, wire};
use serde_json::json;
use std::{io, path::PathBuf};
fn main() {
    if let Err(e) = run() {
        eprintln!("flow-photocraft-host: {e}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("--store") {
        return Err("usage: flow-photocraft-host --store PRIVATE_ROOT [--budget BYTES]".into());
    }
    let root = PathBuf::from(args.next().ok_or("missing store root")?);
    let budget = match args.next() {
        None => 8u64 << 30,
        Some(flag) if flag == "--budget" => args.next().ok_or("missing budget")?.parse()?,
        Some(_) => return Err("unknown argument".into()),
    };
    if args.next().is_some() {
        return Err("unexpected argument".into());
    }
    let mut host = Host::open(&root, budget)?;
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    wire::write(
        &mut stdout,
        &Response {
            header: json!({"protocol":1,"kind":"hello","workerEpoch":host.worker_epoch,"upstream":"a259993118ac7ce1d4c828a385abbc3191841e86","stage":"A","objectVerification":host.cache_policy(),"maxHeaderBytes":wire::MAX_HEADER,"maxPayloadBytes":wire::MAX_PAYLOAD}),
            payload: vec![],
        },
    )?;
    while let Some((request, payload)) = wire::read(&mut stdin)? {
        let response = host.handle(request, payload);
        wire::write(&mut stdout, &response)?;
        if host.is_closed() {
            break;
        }
    }
    Ok(())
}
