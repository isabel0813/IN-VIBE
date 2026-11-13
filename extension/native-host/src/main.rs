#![cfg_attr(windows, windows_subsystem = "windows")]
// stdout is exclusively Chrome's length-prefixed protocol. Never log activity.
use annyong_native_protocol::{read_frame, write_frame, origin_valid, Message, Status, HOST};
fn main() { if run().is_err() { std::process::exit(1); } }
#[cfg(windows)]
fn run() -> Result<(), Box<dyn std::error::Error>> {
    use annyong_native_protocol::pipe::Pipe;
    let exe=std::env::current_exe()?.canonicalize()?;
    let manifest:serde_json::Value=serde_json::from_slice(&std::fs::read(exe.parent().ok_or("path")?.join(format!("{HOST}.json")))?)?;
    let origin=std::env::args().nth(1).ok_or("origin required")?;
    let origins=manifest["allowed_origins"].as_array().ok_or("origins")?;
    if !origin_valid(&origin) || origins.len()!=1 || origins[0].as_str()!=Some(&origin) || manifest["name"]!=HOST
        || std::path::Path::new(manifest["path"].as_str().ok_or("path")?).canonicalize()?!=exe { return Err("host registration mismatch".into()); }
    let mut input=std::io::stdin().lock(); let mut output=std::io::stdout().lock();
    let mut pipe:Option<Pipe>=None; let mut seq=0;
    loop {
        let bytes=match read_frame(&mut input) { Ok(b)=>b, Err(e) if e.kind()==std::io::ErrorKind::UnexpectedEof=>return Ok(()), Err(e)=>return Err(e.into()) };
        let message:Message=serde_json::from_slice(&bytes)?;
        if !message.valid() || message.seq<=seq { return Err("invalid message".into()); } seq=message.seq;
        if pipe.is_none() { pipe=Pipe::client().ok(); }
        let response=pipe.as_mut().and_then(|p| p.request(&bytes).ok());
        let status=match response.and_then(|b| serde_json::from_slice::<Status>(&b).ok()) {
            Some(s)=>s, None=>{pipe=None; Status::offline()}
        };
        write_frame(&mut output,&serde_json::to_vec(&status)?)?;
    }
}
#[cfg(not(windows))]
fn run() -> Result<(), Box<dyn std::error::Error>> { Err("Windows only".into()) }
