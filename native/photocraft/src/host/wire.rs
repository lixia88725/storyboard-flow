use super::{Error, Request, Response, Result};
use std::io::{Read, Write};
pub const MAX_HEADER: usize = 64 << 10;
pub const MAX_PAYLOAD: usize = 64 << 20;
// Reserve half of a bounded wire message for the independent display PNG.
pub const MAX_SOURCE: usize = MAX_PAYLOAD / 2;
pub fn read(reader: &mut impl Read) -> Result<Option<(Request, Vec<u8>)>> {
    let mut lengths = [0u8; 8];
    let mut first = [0u8; 1];
    if reader
        .read(&mut first)
        .map_err(|e| Error::none("transport", e.to_string()))?
        == 0
    {
        return Ok(None);
    }
    lengths[0] = first[0];
    reader
        .read_exact(&mut lengths[1..])
        .map_err(|e| Error::none("transport", format!("truncated frame length: {e}")))?;
    let h = u32::from_le_bytes(
        lengths[..4]
            .try_into()
            .map_err(|_| Error::none("transport", "header length"))?,
    ) as usize;
    let p = u32::from_le_bytes(
        lengths[4..]
            .try_into()
            .map_err(|_| Error::none("transport", "payload length"))?,
    ) as usize;
    if h == 0 || h > MAX_HEADER || p > MAX_PAYLOAD {
        return Err(Error::none("limit", "frame exceeds protocol budget"));
    }
    let mut header = vec![0; h];
    let mut payload = vec![0; p];
    reader
        .read_exact(&mut header)
        .and_then(|()| reader.read_exact(&mut payload))
        .map_err(|e| Error::none("transport", format!("truncated frame: {e}")))?;
    let request = serde_json::from_slice(&header)
        .map_err(|e| Error::none("invalid-input", format!("invalid UTF8/JSON request: {e}")))?;
    Ok(Some((request, payload)))
}
pub fn write(writer: &mut impl Write, r: &Response) -> Result<()> {
    let header =
        serde_json::to_vec(&r.header).map_err(|e| Error::none("transport", e.to_string()))?;
    if header.len() > MAX_HEADER || r.payload.len() > MAX_PAYLOAD {
        return Err(Error::none("limit", "response frame exceeds budget"));
    }
    writer
        .write_all(&(header.len() as u32).to_le_bytes())
        .and_then(|()| writer.write_all(&(r.payload.len() as u32).to_le_bytes()))
        .and_then(|()| writer.write_all(&header))
        .and_then(|()| writer.write_all(&r.payload))
        .and_then(|()| writer.flush())
        .map_err(|e| Error::unknown(format!("response delivery failed: {e}")))
}
