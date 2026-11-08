//! RGB-only admission of the existing upstream JPEG decoder. Never assumes
//! that a four-component JPEG is sRGB or ignores a broken multipart ICC tag.
use super::*;
fn color(message: &str) -> Error {
    Error::none("unsupported-source-color", message)
}
pub(super) fn validate(bytes: &[u8]) -> Result<()> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return Err(Error::none(
            "invalid-input",
            "JPEG hint does not match input bytes",
        ));
    }
    let mut offset = 2;
    let mut frame = None;
    let mut profiles = Vec::new();
    while offset < bytes.len() {
        if bytes[offset] != 0xff {
            return Err(Error::none("invalid-input", "malformed JPEG header marker"));
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let marker = *bytes
            .get(offset)
            .ok_or_else(|| Error::none("invalid-input", "truncated JPEG marker"))?;
        offset += 1;
        if marker == 0xda || marker == 0xd9 {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        let length = bytes
            .get(offset..offset + 2)
            .map(|v| u16::from_be_bytes([v[0], v[1]]) as usize)
            .ok_or_else(|| Error::none("invalid-input", "truncated JPEG segment"))?;
        if length < 2 {
            return Err(Error::none("invalid-input", "invalid JPEG segment length"));
        }
        let segment = bytes
            .get(offset + 2..offset + length)
            .ok_or_else(|| Error::none("invalid-input", "truncated JPEG segment payload"))?;
        offset += length;
        if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
            if segment.len() < 6 || frame.is_some() {
                return Err(Error::none("invalid-input", "missing/ambiguous JPEG frame"));
            }
            if segment[0] != 8 || segment[5] != 3 {
                return Err(color(
                    "current JPEG admission requires 8-bit three-component RGB/YCbCr; grayscale, CMYK and YCCK are not assumed sRGB",
                ));
            }
            let (w, h) = (
                u16::from_be_bytes([segment[3], segment[4]]) as u32,
                u16::from_be_bytes([segment[1], segment[2]]) as u32,
            );
            dimensions(w, h)?;
            frame = Some((w, h));
        }
        if marker == 0xe2 && segment.starts_with(b"ICC_PROFILE") {
            if segment.len() < 14
                || &segment[..12] != b"ICC_PROFILE\0"
                || segment[12] == 0
                || segment[13] == 0
            {
                return Err(color("malformed JPEG ICC segment"));
            }
            profiles.push((segment[12], segment[13], &segment[14..]));
        }
    }
    if frame.is_none() {
        return Err(Error::none("invalid-input", "JPEG frame unavailable"));
    }
    if !profiles.is_empty() {
        profiles.sort_unstable();
        let total = profiles[0].1 as usize;
        if profiles.len() != total
            || profiles
                .iter()
                .enumerate()
                .any(|(i, p)| p.0 as usize != i + 1 || p.1 as usize != total || p.2.is_empty())
        {
            return Err(color(
                "missing, duplicate or inconsistent JPEG ICC segments",
            ));
        }
        let profile: Vec<u8> = profiles.iter().flat_map(|p| p.2.iter().copied()).collect();
        source_guard::rgb_transform(Some(&profile))?;
    }
    Ok(())
}
