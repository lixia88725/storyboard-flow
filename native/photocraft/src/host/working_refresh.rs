//! Authorized working-TIFF re-entry. A marker never supplies original authority;
//! the exact prior immutable version and Main policy must agree first.
use super::*;
use base64::Engine;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkingInput {
    pub digest: String,
    pub byte_length: u64,
    pub format: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizedOrigin {
    pub version: VersionIdentity,
    pub policy: source_guard::ProtectedPolicy,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Marker {
    schema: String,
    version: u32,
    original: source_guard::Original,
    reference_rgba_sha256: String,
    base_psd_layer_id: u32,
    width: u32,
    height: u32,
}
fn refuse(message: impl Into<String>) -> Error {
    Error::none("protected-working-refresh-refused", message)
}
fn marker(doc: &Document) -> Result<Marker> {
    let xml = doc
        .metadata
        .xmp
        .as_deref()
        .ok_or_else(|| refuse("protected working TIFF lost its source-reference marker"))?;
    let parsed = source_metadata::parse_xmp(xml)?;
    let mut values = Vec::new();
    let containers: Vec<_> = parsed
        .descendants()
        .filter(|n| n.has_tag_name((source_metadata::RDF_NS, "RDF")))
        .collect();
    if containers.len() != 1 {
        return Err(refuse("ambiguous source-reference RDF container"));
    }
    let rdf = containers[0];
    for node in parsed.descendants().filter(|n| n.is_element()) {
        if node.has_tag_name((source_metadata::FLOW_NS, "sourceReference")) {
            if !node.parent().is_some_and(|p| {
                p.has_tag_name((source_metadata::RDF_NS, "Description")) && p.parent() == Some(rdf)
            }) || node.children().any(|n| n.is_element())
                || node.attributes().len() != 0
            {
                return Err(refuse("ambiguous source-reference marker"));
            }
            values.push(node.text().unwrap_or_default());
        }
        for a in node.attributes().filter(|a| {
            a.namespace() == Some(source_metadata::FLOW_NS) && a.name() == "sourceReference"
        }) {
            if !node.has_tag_name((source_metadata::RDF_NS, "Description"))
                || node.parent() != Some(rdf)
            {
                return Err(refuse("ambiguous source-reference attribute owner"));
            }
            values.push(a.value());
        }
    }
    if values.len() != 1 || values[0].len() > ((16384 + 2) / 3) * 4 {
        return Err(refuse("source-reference marker must be unique and bounded"));
    }
    let raw = base64::engine::general_purpose::STANDARD
        .decode(values[0])
        .map_err(|_| refuse("invalid source-reference encoding"))?;
    if raw.len() > 16384 {
        return Err(refuse("source-reference marker exceeds 16KiB"));
    }
    let value: Marker = serde_json::from_slice(&raw)
        .map_err(|e| refuse(format!("invalid source-reference marker: {e}")))?;
    if value.schema != "flow.protected-source-reference"
        || value.version != 1
        || value.base_psd_layer_id == 0
    {
        return Err(refuse("unsupported source-reference marker"));
    }
    Ok(value)
}
// TIFF PSD transcoding emits these default records even for a pristine raster.
// Only exact, unique inert records are admitted; typed advanced fields are
// checked independently and any unknown block still refuses protected re-entry.
fn inert_export_records(layer: &Layer) -> bool {
    let mut seen = std::collections::HashSet::new();
    layer.psd_blocks.iter().all(|(k, v)| {
        seen.insert(*k)
            && match k {
                b"lnsr" => v.as_slice() == b"layr",
                b"clbl" => v.as_slice() == [1, 0, 0, 0],
                b"infx" | b"knko" => v.as_slice() == [0, 0, 0, 0],
                _ => false,
            }
    })
}
pub(super) fn prepare(
    working: Source,
    payload: &[u8],
    display: &source_guard::DisplayRef,
    old: store::Loaded,
    authorized: &AuthorizedOrigin,
) -> Result<(Document, LayerTarget, Source)> {
    if working.format_hint != "tiff" {
        return Err(refuse("working refresh accepts TIFF only"));
    }
    source_guard::preflight(&working, Some(display), payload)?;
    let old_source = old
        .source
        .ok_or_else(|| refuse("authorized version has no original binding"))?;
    if old_source.display_policy.as_ref() != Some(&authorized.policy) {
        return Err(refuse("authorized version/policy mismatch"));
    }
    let old_base = old
        .doc
        .layers
        .first()
        .filter(|l| l.id.0.to_string() == authorized.policy.base_layer_id)
        .ok_or_else(|| refuse("authorized protected root base missing"))?;
    let stable = old_base
        .psd_id
        .ok_or_else(|| refuse("authorized base has no stable PSD identity"))?;
    let mut doc = detached::decode_source(&working, &payload[..working.byte_length as usize])?;
    let mark = marker(&doc)?;
    if mark.original != authorized.policy.original
        || mark.reference_rgba_sha256 != authorized.policy.reference_rgba_sha256
        || mark.base_psd_layer_id != stable
        || mark.width != old.doc.size.width
        || mark.height != old.doc.size.height
        || doc.size != old.doc.size
    {
        return Err(refuse(
            "working source marker differs from the authorized original/reference/geometry",
        ));
    }
    if source_guard::rgb_transform(doc.icc_profile.as_ref().map(|p| p.as_slice()))?.is_some() {
        return Err(refuse(
            "protected working TIFF must retain sRGB-equivalent color interpretation",
        ));
    }
    // A Photoshop save may explicitly embed equivalent sRGB. Normalize only that
    // equivalent profile; no pixel/color conversion or base repair is performed.
    doc.icc_profile = None;
    if doc
        .walk()
        .iter()
        .filter(|(_, _, l)| l.psd_id == Some(stable))
        .count()
        != 1
    {
        return Err(refuse("protected PSD layer identity missing or ambiguous"));
    }
    let base = doc
        .layers
        .first()
        .ok_or_else(|| refuse("protected root base missing"))?;
    if base.psd_id != Some(stable)
        || base.name != old_base.name
        || !base.visible
        || !base.locks.all
        || base.opacity != 1.0
        || base.fill_opacity != 1.0
        || base.blend != photocraft_color::BlendMode::Normal
        || base.clipped
        || base.mask.is_some()
        || base.vector_mask.is_some()
        || base.frame.is_some()
        || base.link_group.is_some()
        || base.video.is_some()
        || base.excluded_channels != 0
        || base.blend_if != Default::default()
        || base.advanced != Default::default()
        || !inert_export_records(base)
        || base.effects != Layer::new("", base.content.clone()).effects
        || !matches!(base.content, LayerContent::Raster(_))
    {
        return Err(refuse(
            "protected base position, visibility, lock, opacity or structure changed",
        ));
    }
    let new_base_id = base.id.0.to_string();
    let mut isolated = doc.clone();
    isolated.layers = vec![base.clone()];
    isolated.selection = None;
    let mut rgba = render_srgb(&isolated, isolated.bounds())?;
    for p in rgba.chunks_exact_mut(4) {
        if p[3] == 0 {
            p[..3].fill(0);
        }
    }
    if sha(&rgba) != authorized.policy.reference_rgba_sha256 {
        return Err(refuse("protected reference base pixels changed"));
    }
    let reference = source_guard::independent_display(&working, display, payload)?;
    if (display.width, display.height) != (doc.size.width, doc.size.height)
        || source_guard::difference(&reference, &render_srgb(&doc, doc.bounds())?)? > 8
    {
        return Err(refuse(
            "working upper-layer composition differs from independent embedded display",
        ));
    }
    // Refresh creates an independent immutable image, never aliases the old DocId.
    doc.id = photocraft_doc::DocId::fresh();
    let target = detached::initial_target(&doc)?;
    let mut source = old_source;
    source.display_policy = Some(source_guard::ProtectedPolicy {
        base_layer_id: new_base_id,
        ..authorized.policy.clone()
    });
    source.protected_base_manifest_sha256 = None;
    source.working_input = Some(WorkingInput {
        digest: working.digest,
        byte_length: working.byte_length,
        format: "tiff".into(),
    });
    Ok((doc, target, source))
}
