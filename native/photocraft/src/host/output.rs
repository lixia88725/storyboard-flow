//! Read-only, bounded transport export from a pinned immutable native version.
//! No user path, file publication, project acceptance, or legacy PNG writer is involved.
use super::*;
use std::io::{self, Cursor, Seek, SeekFrom, Write};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Psd,
    Tiff,
}
impl OutputFormat {
    fn ext(&self) -> &'static str {
        match self {
            Self::Psd => "psd",
            Self::Tiff => "tiff",
        }
    }
}
struct BoundedBytes {
    cursor: Cursor<Vec<u8>>,
    max: u64,
}
impl Write for BoundedBytes {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self
            .cursor
            .position()
            .checked_add(bytes.len() as u64)
            .is_none_or(|end| end > self.max)
        {
            return Err(io::Error::other("encoded output exceeds transport budget"));
        }
        self.cursor.write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
impl Seek for BoundedBytes {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let old = self.cursor.position();
        let next = self.cursor.seek(pos)?;
        if next > self.max {
            self.cursor.set_position(old);
            return Err(io::Error::other("encoded seek exceeds transport budget"));
        }
        Ok(next)
    }
}
// Exporters may regenerate modeled blocks, but opaque bytes retained in Document must
// not disappear silently. This is a runtime guard, not independent compatibility evidence.
fn opaque_preserved(before: &Document, after: &Document) -> Result<usize> {
    fn missing<'a, T: Eq + std::hash::Hash>(before: &'a [T], after: &[T]) -> Option<&'a T> {
        let mut counts = std::collections::HashMap::<&T, usize>::new();
        for value in after {
            *counts.entry(value).or_default() += 1;
        }
        for value in before {
            match counts.get_mut(value) {
                Some(count) if *count > 0 => *count -= 1,
                _ => return Some(value),
            }
        }
        None
    }
    let mut count = 0;
    if missing(
        &before.metadata.psd_resources,
        &after.metadata.psd_resources,
    )
    .is_some()
    {
        return Err(Error::none(
            "export-loss",
            "retained PSD image resource was not preserved",
        ));
    }
    count += before.metadata.psd_resources.len();
    if missing(
        &before.metadata.psd_global_blocks,
        &after.metadata.psd_global_blocks,
    )
    .is_some()
    {
        return Err(Error::none(
            "export-loss",
            "retained PSD global block was not preserved",
        ));
    }
    count += before.metadata.psd_global_blocks.len();
    let old = before.walk();
    let new = after.walk();
    if old.len() != new.len() {
        return Err(Error::none(
            "export-loss",
            "layer count changed; flat fallback refused",
        ));
    }
    for ((old_path, old_depth, old), (new_path, new_depth, new)) in old.iter().zip(&new) {
        if old.name != new.name || old_path != new_path || old_depth != new_depth {
            return Err(Error::none("export-loss", "layer identity/order changed"));
        }
        if let Some(entry) = missing(&old.psd_blocks, &new.psd_blocks) {
            return Err(Error::none(
                "export-loss",
                format!(
                    "retained layer block {} ({} bytes) was not preserved",
                    String::from_utf8_lossy(&entry.0),
                    entry.1.len()
                ),
            ));
        }
        count += old.psd_blocks.len();
    }
    Ok(count)
}
pub(super) fn encode(
    doc: &Document,
    format: &OutputFormat,
    max_bytes: usize,
) -> Result<(Value, Vec<u8>)> {
    if max_bytes == 0 || max_bytes > wire::MAX_PAYLOAD {
        return Err(Error::none("limit", "export maxBytes must be 1..64MiB"));
    }
    if doc.layer_count() == 0 {
        return Err(Error::none(
            "unsupported",
            "layered output requires at least one layer",
        ));
    }
    let options = photocraft_io::ExportOptions {
        tiff_layers: true,
        tiff_force_layer_data: true,
        tiff_transparency: Some(true),
        preserve_alpha: true,
        read_linked_files: false,
        document_path: None,
        ..Default::default()
    };
    let result = photocraft_io::encode_with(
        doc,
        format.ext(),
        &options,
        &photocraft_raster::Interrupt::NONE,
    )
    .map_err(native)?;
    if !result.warnings.is_empty() {
        let notes = result
            .warnings
            .iter()
            .take(8)
            .map(|w| w.chars().take(256).collect::<String>())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(Error::none(
            "export-loss",
            format!(
                "export refused {} warning(s): {notes}",
                result.warnings.len()
            ),
        ));
    }
    if let photocraft_io::Encoded::Psd(file) = &result.encoded {
        if file.header.version != photocraft_psd::Version::Psd {
            return Err(Error::none(
                "unsupported",
                "PSB promotion refused for explicit PSD output",
            ));
        }
    }
    let length = result.encoded.encoded_len().map_err(native)?;
    if length == 0 || length > max_bytes as u64 {
        return Err(Error::none(
            "limit",
            "encoded output exceeds maxBytes; no bytes returned",
        ));
    }
    let mut output = BoundedBytes {
        cursor: Cursor::new(Vec::with_capacity(length as usize)),
        max: max_bytes as u64,
    };
    result.encoded.write_to(&mut output).map_err(native)?;
    let bytes = output.cursor.into_inner();
    if bytes.len() as u64 != length {
        return Err(Error::none("export", "encoded length mismatch"));
    }
    if matches!(format, OutputFormat::Tiff)
        && photocraft_codecs::tiff_photoshop_tags(&bytes)
            .1
            .is_none_or(|data| data.is_empty())
    {
        return Err(Error::none(
            "export-loss",
            "explicit TIFF layer data missing; flat fallback refused",
        ));
    }
    let options = photocraft_io::ImportOptions {
        psd_max_pixel_bytes: 512 << 20,
        flat_max_pixel_bytes: 256 << 20,
        ..Default::default()
    };
    let (decoded, damaged) =
        photocraft_io::import_for_open(&format!("retained.{}", format.ext()), &bytes, &options)
            .map_err(native)?;
    if damaged || decoded.preview_only || !decoded.warnings.is_empty() {
        return Err(Error::none(
            "export-loss",
            "output layer structure could not be read without loss warnings",
        ));
    }
    if decoded.document.metadata.xmp.as_deref() != doc.metadata.xmp.as_deref() {
        return Err(Error::none(
            "export-loss",
            "source/output XMP bytes were not preserved",
        ));
    }
    let blocks = opaque_preserved(doc, &decoded.document)?;
    let receipt = json!({"format":format,"sha256":sha(&bytes),"byteLength":bytes.len(),"width":doc.size.width,"height":doc.size.height,"layerCount":doc.layer_count(),"layered":true,"opaqueBlockCount":blocks,"warnings":[]});
    Ok((receipt, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lossy_metadata_warning_refuses_and_locked_single_raster_retains_explicit_tiff_layer_data() {
        let mut doc = Document::new("synthetic", Size::new(8, 4), ColorMode::Rgb, SampleType::U8);
        doc.layers
            .push(Layer::raster("Drawing", doc.pixel_format()));
        doc.metadata
            .text
            .push(("author".into(), "synthetic-only".into()));
        let warning = encode(&doc, &OutputFormat::Psd, wire::MAX_PAYLOAD).unwrap_err();
        assert_eq!(warning.code, "export-loss");
        doc.metadata.text.clear();
        doc.layers[0].locks.transparency = true;
        doc.layers[0].locks.position = true;
        assert!(!photocraft_io::tiff_layers::would_write_layers(&doc));
        let before = doc.clone();
        let (receipt, bytes) = encode(&doc, &OutputFormat::Tiff, wire::MAX_PAYLOAD).unwrap();
        assert_eq!(receipt["layerCount"], 1);
        assert_eq!(receipt["layered"], true);
        assert!(
            photocraft_codecs::tiff_photoshop_tags(&bytes)
                .1
                .is_some_and(|data| !data.is_empty())
        );
        let (read, damaged) =
            photocraft_io::import_for_open("read.tiff", &bytes, &Default::default()).unwrap();
        assert!(!damaged);
        assert!(read.warnings.is_empty());
        assert_eq!(read.document.layers[0].name, doc.layers[0].name);
        assert_eq!(read.document.layers[0].locks, doc.layers[0].locks);
        assert_eq!(doc, before);
        // Upstream's default remains unchanged; only the host opts in.
        let ordinary = photocraft_io::encode_with(
            &doc,
            "tiff",
            &photocraft_io::ExportOptions {
                tiff_layers: true,
                ..Default::default()
            },
            &photocraft_raster::Interrupt::NONE,
        )
        .unwrap()
        .encoded
        .into_bytes()
        .unwrap();
        assert!(
            photocraft_codecs::tiff_photoshop_tags(&ordinary)
                .1
                .is_none()
        );
    }
}

// Shared metadata/policy output path for bounded immutable background reads.
pub(super) fn immutable(
    version_id: &str,
    loaded: store::Loaded,
    format: &OutputFormat,
    max: usize,
    metadata: &output_metadata::MetadataRef,
    expected: Option<&source_guard::ProtectedPolicy>,
    payload: &[u8],
) -> Result<(Value, Vec<u8>)> {
    let policy = loaded
        .source
        .as_ref()
        .and_then(|s| s.display_policy.as_ref());
    if policy != expected {
        return Err(Error::none(
            "protected-source",
            "Main protected origin does not match pinned native source policy",
        ));
    }
    let mut doc = output_metadata::overlay(&loaded.doc, metadata, payload)?;
    let source_sha = if let Some(policy) = policy {
        let (d, sha) = output_metadata::overlay_source(&doc, policy)?;
        doc = d;
        Some(sha)
    } else {
        None
    };
    let (mut receipt, bytes) = encode(&doc, format, max)?;
    receipt["kind"] = json!("exported");
    receipt["versionId"] = json!(version_id);
    receipt["exportedDocumentId"] = json!(doc.id.0.to_string());
    receipt["metadataSha256"] = json!(metadata.sha256);
    if let Some(sha) = source_sha {
        receipt["sourceReferenceSha256"] = json!(sha);
        receipt["sourceReferenceVersion"] = json!(1);
    }
    Ok((receipt, bytes))
}
