//! Explicit portable-source interpretation and bounded XMP parsing. Native
//! raster properties are never inferred from positional layer indices.
use super::*;
use base64::Engine;
use std::collections::{HashMap, HashSet};
pub(super) const FLOW_NS: &str = "https://storyboard-flow.local/ns/1.0/";
pub(super) const RDF_NS: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
pub(super) const XMP_NS: &str = "adobe:ns:meta/";
pub(super) const MAX_METADATA: usize = 1 << 20;
pub(super) const MAX_XMP: usize = 2 << 20;
fn reject(message: impl Into<String>) -> Error {
    Error::none("unsupported-source-interpretation", message)
}
pub(super) fn parse_xmp(value: &str) -> Result<roxmltree::Document<'_>> {
    if value.len() > MAX_XMP {
        return Err(Error::none("limit", "source XMP exceeds 2MiB"));
    }
    roxmltree::Document::parse_with_options(
        value,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: 16384,
        },
    )
    .map_err(|e| {
        reject(format!(
            "source XMP is not a supported bounded XML packet: {e}"
        ))
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    app: String,
    format: String,
    raster_version: u32,
    image: Image,
    text: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Image {
    id: String,
    revision: u64,
    layers: Vec<PortableLayer>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortableLayer {
    id: String,
    kind: String,
    opacity: f64,
    native_id: u32,
}
fn envelope(doc: &Document) -> Result<Envelope> {
    let xml =
        doc.metadata.xmp.as_deref().ok_or_else(|| {
            reject("Flow V1 upgrade requires the digest-bound portable XMP envelope")
        })?;
    let parsed = parse_xmp(xml)?;
    let nodes = parsed
        .descendants()
        .filter(|n| n.is_element())
        .collect::<Vec<_>>();
    let expected = [
        (XMP_NS, "xmpmeta"),
        (RDF_NS, "RDF"),
        (RDF_NS, "Description"),
        (FLOW_NS, "metadata"),
    ];
    if nodes.len() != expected.len()
        || nodes.iter().zip(expected).any(|(n, (namespace, name))| {
            n.tag_name().namespace() != Some(namespace)
                || n.tag_name().name() != name
                || n.attributes().len() != 0
        })
    {
        return Err(reject(
            "Flow V1 upgrade accepts only the strict ordinary portable packet, not unknown metadata or complex source references",
        ));
    }
    let encoded = nodes[3]
        .text()
        .ok_or_else(|| reject("Flow metadata payload missing"))?;
    if encoded.len() > ((MAX_METADATA + 2) / 3) * 4 {
        return Err(Error::none(
            "limit",
            "Flow V1 envelope exceeds 1MiB decoded",
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| reject("Flow portable metadata is not canonical base64"))?;
    if bytes.len() > MAX_METADATA {
        return Err(Error::none("limit", "Flow V1 envelope exceeds 1MiB"));
    }
    let env: Envelope = serde_json::from_slice(&bytes)
        .map_err(|e| reject(format!("invalid ordinary Flow V1 envelope: {e}")))?;
    if env.app != "Storyboard Flow"
        || env.format != "flow-tiff"
        || env.raster_version != 2
        || env.image.revision > 9_007_199_254_740_991
    {
        return Err(reject(
            "unsupported Flow portable version or complex source profile",
        ));
    }
    valid_id(&env.image.id)?;
    if env.image.layers.is_empty() || env.image.layers.len() > 64 {
        return Err(reject("portable layer count"));
    }
    // Text remains opaque source metadata. It is not a project mutation or a
    // second authority for the current storyboard/dialogue state.
    let _ = &env.text;
    Ok(env)
}
pub(super) fn restore_v1(doc: &mut Document, bytes: &[u8]) -> Result<()> {
    if !bytes.starts_with(b"II*\0") && !bytes.starts_with(b"MM\0*") {
        return Err(reject(
            "Flow V1 upgrade requires its strict classic TIFF source",
        ));
    }
    let info = photocraft_codecs::tiff_info(bytes).map_err(native)?;
    if !info.complete || info.page_count() != 1 {
        return Err(reject("portable source must be one complete TIFF page"));
    }
    let env = envelope(doc)?;
    let (_, data) = photocraft_codecs::tiff_photoshop_tags(bytes);
    let data = data.ok_or_else(|| reject("portable layer records missing"))?;
    let (isd, warnings) =
        photocraft_psd::tiff::ImageSourceData::from_bytes(data).map_err(native)?;
    if !warnings.is_empty() || !isd.global_blocks.is_empty() || isd.trailing.iter().any(|v| *v != 0)
    {
        return Err(reject("portable source has unknown global layer structure"));
    }
    let records = isd
        .layer_info
        .ok_or_else(|| reject("portable raster records missing"))?
        .layers;
    if records.len() != env.image.layers.len()
        || doc.layers.len() != records.len()
        || doc.layer_count() != records.len()
        || doc.selection.is_some()
        || !doc.channels.is_empty()
    {
        return Err(reject(
            "portable/native layer mapping or channel structure differs",
        ));
    }
    let mut ids = HashSet::new();
    let mut logical = HashSet::new();
    let mut portable = HashMap::new();
    for identity in env.image.layers {
        valid_id(&identity.id)?;
        let bound_id = (u32::from_str_radix(&sha(identity.id.as_bytes())[..8], 16)
            .map_err(|_| reject("portable identity digest"))?
            & 0x7fffffff)
            .max(1);
        if identity.native_id != bound_id
            || !matches!(identity.kind.as_str(), "image" | "paint")
            || !identity.opacity.is_finite()
            || !(0.0..=1.0).contains(&identity.opacity)
            || identity.native_id == 0
            || identity.native_id > 0x7fffffff
            || !ids.insert(identity.native_id)
            || !logical.insert(identity.id.clone())
        {
            return Err(reject(
                "portable identities/opacity are not a unique ordinary raster mapping",
            ));
        }
        portable.insert(identity.native_id, identity);
    }
    // Validate the entire graph before changing a single property.
    let mut changes = Vec::new();
    let mut raw_ids = HashSet::new();
    for record in records {
        let id = record
            .layer_id()
            .ok_or_else(|| reject("native PSD layer id missing"))?;
        if !raw_ids.insert(id) {
            return Err(reject("duplicate native PSD layer id"));
        }
        let identity = portable
            .get(&id)
            .ok_or_else(|| reject("unknown native PSD layer id"))?;
        let layer = doc
            .layers
            .iter()
            .find(|l| l.psd_id == Some(id))
            .ok_or_else(|| reject("portable id has no imported native layer"))?;
        let blend = match record.blend_mode {
            photocraft_psd::BlendMode::Normal => photocraft_color::BlendMode::Normal,
            photocraft_psd::BlendMode::Multiply => photocraft_color::BlendMode::Multiply,
            photocraft_psd::BlendMode::Screen => photocraft_color::BlendMode::Screen,
            _ => return Err(reject("portable blend is not supported")),
        };
        if record.rect.left != 0
            || record.rect.top != 0
            || record.rect.right != doc.size.width as i32
            || record.rect.bottom != doc.size.height as i32
            || record.clipping != 0
            || record.flags.0 & !11 != 0
            || !record.blending_ranges.data.is_empty()
            || record.extra_trailing.iter().any(|v| *v != 0)
            || record
                .blocks
                .iter()
                .any(|b| b.key != *b"luni" && b.key != *b"lyid")
            || !matches!(record.mask, photocraft_psd::MaskData::None)
        {
            return Err(reject(
                "source is not the strict V1 full-canvas raster representation",
            ));
        }
        if !matches!(layer.content, LayerContent::Raster(_))
            || layer.name != record.name()
            || layer.visible != record.is_visible()
            || layer.blend != blend
            || (f64::from(layer.opacity) * 255.0).round() as u8 != record.opacity
            || (identity.opacity * 255.0).round() as u8 != record.opacity
            || layer.mask.is_some()
            || layer.vector_mask.is_some()
            || !layer.effects.items.is_empty()
            || layer.effects.psd_raw.is_some()
            || layer.clipped
            || layer.fill_opacity != 1.0
            || layer.locks.all
            || layer.locks.pixels
            || layer.locks.position
            || layer.locks.artboard
            || layer.locks.transparency != record.flags.transparency_protected()
        {
            return Err(reject(
                "portable name/visibility/blend/locks/quantized opacity disagree with native records",
            ));
        }
        changes.push((
            layer.id,
            identity.opacity as f32,
            record.flags.transparency_protected(),
        ));
    }
    if raw_ids.len() != portable.len() {
        return Err(reject("portable layer identity is missing from records"));
    }
    for (id, opacity, locked) in changes {
        let layer = doc
            .layer_mut(id)
            .ok_or_else(|| reject("validated layer disappeared"))?;
        layer.opacity = opacity;
        layer.locks = photocraft_doc::Locks {
            all: locked,
            ..Default::default()
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_xml_rejects_dtd_and_excessive_packet() {
        assert!(parse_xmp("<!DOCTYPE x [<!ENTITY p 'payload'>]><x>&p;</x>").is_err());
        assert!(parse_xmp(&"x".repeat(MAX_XMP + 1)).is_err());
        assert!(parse_xmp("<x><broken></x>").is_err());
    }
    #[test]
    fn portable_profile_refuses_unknown_metadata_properties() {
        let mut doc = Document::new("test", Size::new(1, 1), ColorMode::Rgb, SampleType::U8);
        doc.metadata.xmp = Some(Arc::from(format!(
            "<x:xmpmeta xmlns:x='{XMP_NS}' xmlns:rdf='{RDF_NS}' xmlns:flow='{FLOW_NS}'><rdf:RDF><rdf:Description><flow:metadata>e30=</flow:metadata><flow:unknown/></rdf:Description></rdf:RDF></x:xmpmeta>"
        )));
        assert!(envelope(&doc).is_err());
    }
}
