//! Source display guard and persistent protected base. Layer composition never
//! proves its own embedded display; Main alone accepts any derived candidate.
use super::*;
pub(super) fn rgb_transform(profile: Option<&[u8]>) -> Result<Option<photocraft_cms::Transform>> {
    let Some(bytes) = profile else {
        return Ok(None);
    };
    let profile = photocraft_cms::Profile::parse(bytes).map_err(|e| {
        Error::none(
            "unsupported-source-color",
            format!("invalid embedded RGB ICC: {e}"),
        )
    })?;
    if profile.color_space != photocraft_cms::ColorSpace::Rgb {
        return Err(Error::none(
            "unsupported-source-color",
            "RGB source has a non-RGB ICC",
        ));
    }
    let dst = photocraft_cms::Builtin::Srgb.profile();
    if profile.same_colors(dst) {
        Ok(None)
    } else {
        photocraft_cms::Transform::new(
            &profile,
            dst,
            photocraft_cms::Intent::RelativeColorimetric,
            true,
        )
        .map(Some)
        .map_err(|e| {
            Error::none(
                "unsupported-source-color",
                format!("RGB transform unavailable: {e}"),
            )
        })
    }
}
fn embedded(source: &Source, bytes: &[u8]) -> Result<(u32, u32, Vec<u8>)> {
    match source.format_hint.as_str() {
        "tiff" => {
            let info = photocraft_codecs::tiff_info(bytes).map_err(native)?;
            if !info.complete || info.page_count() != 1 {
                return Err(Error::none(
                    "unsupported-source-display",
                    "source must be one complete TIFF page",
                ));
            }
            let decoded = photocraft_codecs::decode_as_with(
                photocraft_codecs::Format::Tiff,
                bytes,
                &photocraft_codecs::DecodeOptions {
                    limits: photocraft_codecs::Limits {
                        max_width: 8192,
                        max_height: 8192,
                        max_pixels: 16 << 20,
                        max_alloc: 256 << 20,
                    },
                    ..Default::default()
                },
            )
            .map_err(native)?;
            let (w, h) = decoded.dimensions();
            dimensions(w, h)?;
            if !decoded.layout().is_rgb() {
                return Err(Error::none(
                    "unsupported-source-color",
                    "this source guard admits RGB only; CMYK/other models cannot fall back to a default ICC",
                ));
            }
            rgb_transform(decoded.icc.as_deref())?;
            if !decoded.warnings.is_empty() {
                return Err(Error::none(
                    "unsupported-source-display",
                    "embedded TIFF decode reports incomplete/unsupported content",
                ));
            }
            let imported =
                photocraft_io::image_to_document("embedded.tiff", &decoded).map_err(native)?;
            if !imported.warnings.is_empty() {
                return Err(Error::none(
                    "unsupported-source-display",
                    "embedded TIFF interpretation reports compatibility warnings",
                ));
            }
            Ok((
                w,
                h,
                render_srgb(&imported.document, imported.document.bounds())?,
            ))
        }
        "psd" => {
            let file = photocraft_psd::PsdFile::from_bytes(bytes).map_err(native)?;
            let (w, h) = (file.header.width, file.header.height);
            dimensions(w, h)?;
            if file.header.color_mode != photocraft_psd::ColorMode::Rgb
                || !matches!(file.header.depth, 8 | 16)
            {
                return Err(Error::none(
                    "unsupported-source-color",
                    "this source guard requires RGB 8/16-bit PSD; CMYK/other models cannot use a default ICC",
                ));
            }
            if file.resources.iter().filter(|r| r.id == 1039).count() > 1 {
                return Err(Error::none(
                    "unsupported-source-color",
                    "ambiguous duplicate RGB ICC profiles",
                ));
            }
            let transform = rgb_transform(
                file.resources
                    .iter()
                    .find(|r| r.id == 1039)
                    .map(|r| r.data.as_slice()),
            )?;
            let mut pixels = photocraft_io::merged_composite(&file).map_err(|e| {
                Error::none(
                    "unsupported-source-display",
                    format!("PSD embedded merged display unavailable: {e}"),
                )
            })?;
            if pixels.len() != w as usize * h as usize {
                return Err(Error::none(
                    "unsupported-source-display",
                    "PSD embedded merged geometry mismatch",
                ));
            }
            if let Some(t) = transform {
                for row in pixels.chunks_mut(w as usize) {
                    let mut flat: Vec<f32> = row.iter().flat_map(|p| p.iter().copied()).collect();
                    t.apply(&mut flat, 4);
                    for (p, c) in row.iter_mut().zip(flat.chunks_exact(4)) {
                        p.copy_from_slice(c);
                    }
                }
            }
            Ok((
                w,
                h,
                pixels
                    .iter()
                    .flat_map(|p| p.iter().map(|c| (c.clamp(0.0, 1.0) * 255.0 + 0.5) as u8))
                    .collect(),
            ))
        }
        _ => Err(Error::none(
            "unsupported-source-display",
            "guard expects TIFF or PSD; PNG follows its direct raster path",
        )),
    }
}
fn difference(a: &[u8], b: &[u8]) -> Result<u8> {
    if a.len() != b.len() {
        return Err(Error::none(
            "unsupported-source-display",
            "layer/embedded geometry mismatch",
        ));
    }
    Ok(a.chunks_exact(4)
        .zip(b.chunks_exact(4))
        .flat_map(|(a, b)| {
            a.iter().zip(b).enumerate().map(move |(c, (x, y))| {
                if c != 3 && a[3] == 0 && b[3] == 0 {
                    0
                } else {
                    x.abs_diff(*y)
                }
            })
        })
        .max()
        .unwrap_or(0))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayRef {
    pub source_digest: String,
    pub sha256: String,
    pub byte_length: usize,
    pub rgba_sha256: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Original {
    pub digest: String,
    pub byte_length: u64,
    pub format: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectedPolicy {
    pub kind: String,
    pub base_layer_id: String,
    pub reference_rgba_sha256: String,
    pub original: Original,
}
pub(super) fn preflight(
    source: &Source,
    display: Option<&DisplayRef>,
    payload: &[u8],
) -> Result<()> {
    let len = usize::try_from(source.byte_length).map_err(native)?;
    let original = payload
        .get(..len)
        .ok_or_else(|| Error::none("invalid-input", "truncated original grant"))?;
    detached::preflight_source(source, original)?;
    if source.format_hint == "tiff" && display.is_none() {
        return Err(Error::none(
            "independent-display-required",
            "TIFF guard requires Main independent embedded display of the exact retained source",
        ));
    }
    if let Some(d) = display {
        dimensions(d.width, d.height)?;
        if source.format_hint != "tiff"
            || d.source_digest != source.digest
            || d.byte_length == 0
            || d.byte_length > 32 << 20
            || payload.len() != len + d.byte_length
            || !store::is_hash(&d.sha256)
            || !store::is_hash(&d.rgba_sha256)
            || sha(&payload[len..]) != d.sha256
        {
            return Err(Error::none(
                "invalid-input",
                "independent display grant/32MiB bound/digest mismatch",
            ));
        }
    } else if payload.len() != len {
        return Err(Error::none(
            "invalid-input",
            "unexpected source display payload",
        ));
    }
    Ok(())
}
pub(super) fn default_tolerance() -> u8 {
    2
}
pub(super) fn prepare(
    mut source: Source,
    display: Option<&DisplayRef>,
    payload: &[u8],
    tolerance: u8,
) -> Result<(Document, LayerTarget, Source, Value, String)> {
    if tolerance > 16 {
        return Err(Error::none(
            "invalid-input",
            "display tolerance must be 0..16",
        ));
    }
    preflight(&source, display, payload)?;
    let original = &payload[..source.byte_length as usize];
    // Always validate original color interpretation; an external cached display
    // cannot authorize unprofiled CMYK or broken RGB ICC fallback.
    let (mut w, mut h, mut reference) = embedded(&source, original)?;
    if let Some(d) = display {
        let png = photocraft_codecs::decode_as_with(
            photocraft_codecs::Format::Png,
            &payload[source.byte_length as usize..],
            &photocraft_codecs::DecodeOptions {
                limits: photocraft_codecs::Limits {
                    max_width: 8192,
                    max_height: 8192,
                    max_pixels: 16 << 20,
                    max_alloc: 64 << 20,
                },
                ..Default::default()
            },
        )
        .map_err(native)?;
        if png.dimensions() != (d.width, d.height)
            || png.icc.is_some()
            || !png.layout().is_rgb()
            || !png.warnings.is_empty()
        {
            return Err(Error::none(
                "invalid-input",
                "independent display must be complete untagged sRGB RGBA8",
            ));
        }
        reference = png.to_rgba8();
        if sha(&reference) != d.rgba_sha256 {
            return Err(Error::none(
                "invalid-input",
                "independent display RGBA mismatch",
            ));
        }
        w = d.width;
        h = d.height;
    }
    for p in reference.chunks_exact_mut(4) {
        if p[3] == 0 {
            p[..3].fill(0);
        }
    }
    let reference_sha = sha(&reference);
    let decoded = detached::decode_source(&source, original).and_then(|doc| {
        rgb_transform(doc.icc_profile.as_ref().map(|p| p.as_slice()))?;
        if doc.size.width != w || doc.size.height != h {
            return Err(Error::none(
                "unsupported-source-display",
                "layer/embedded orientation or geometry differs",
            ));
        }
        let rgba = render_srgb(&doc, doc.bounds())?;
        let delta = difference(&reference, &rgba)?;
        Ok((doc, sha(&rgba), delta))
    });
    let (native_sha, delta, reason, editable) = match decoded {
        Ok((doc, hash, delta)) if delta <= tolerance => (Some(hash), Some(delta), None, Some(doc)),
        Ok((_, hash, delta)) => (
            Some(hash),
            Some(delta),
            Some(
                json!({"code":"source-display-mismatch","message":format!("layer composition differs from independent embedded display by {delta} levels; protected reference base preserves original")}),
            ),
            None,
        ),
        Err(e) => (
            None,
            None,
            Some(json!({"code":e.code,"message":e.message.chars().take(512).collect::<String>()})),
            None,
        ),
    };
    let proof = json!({"schema":"flow.source-display-proof","version":1,"source":source,"width":w,"height":h,"embeddedRgbaSha256":reference_sha,"nativeRgbaSha256":native_sha,"maxChannelDifference":delta,"tolerance":tolerance,"reason":reason});
    if let Some(doc) = editable {
        let target = detached::initial_target(&doc)?;
        return Ok((doc, target, source, proof, "editable".into()));
    }
    let image =
        photocraft_codecs::Image::from_u8(w, h, photocraft_codecs::ChannelLayout::Rgba, reference)
            .map_err(native)?;
    let mut doc = photocraft_io::image_to_document("protected-reference", &image)
        .map_err(native)?
        .document;
    if doc.layers.len() != 1 {
        return Err(Error::none(
            "engine",
            "reference construction did not produce one raster base",
        ));
    }
    let base = &mut doc.layers[0];
    base.name = "PhotoCraft · 受保护的来源参考底图".into();
    base.locks = photocraft_doc::Locks {
        all: true,
        ..Default::default()
    };
    base.psd_id =
        Some((u32::from_str_radix(&source.digest[..8], 16).map_err(native)? & 0x7fffffff).max(1));
    source.display_policy = Some(ProtectedPolicy {
        kind: "protected-reference".into(),
        base_layer_id: base.id.0.to_string(),
        reference_rgba_sha256: reference_sha,
        original: Original {
            digest: source.digest.clone(),
            byte_length: source.byte_length,
            format: source.format_hint.clone(),
        },
    });
    let layer = Layer::raster("Drawing", doc.pixel_format());
    let target = LayerTarget {
        active: Some(layer.id),
        selected: vec![layer.id],
    };
    doc.layers.push(layer);
    Ok((doc, target, source, proof, "reference".into()))
}

pub(super) fn bind_manifest(source: &mut Source, manifest: &Value, initialize: bool) -> Result<()> {
    let Some(p) = &source.display_policy else {
        if source.protected_base_manifest_sha256.is_some() {
            return Err(Error::retained(
                "corrupt",
                "protection fingerprint has no policy",
            ));
        }
        return Ok(());
    };
    let base = p.base_layer_id.parse::<u64>().map_err(native)?;
    if p.kind != "protected-reference"
        || base.to_string() != p.base_layer_id
        || !store::is_hash(&p.reference_rgba_sha256)
        || p.original.digest != source.digest
        || p.original.byte_length != source.byte_length
        || p.original.format != source.format_hint
        || !matches!(p.original.format.as_str(), "tiff" | "psd")
    {
        return Err(Error::retained(
            "corrupt",
            "invalid protected source binding",
        ));
    }
    let document = &manifest["document"];
    let layer = &document["layers"][0];
    if layer["id"].as_u64() != Some(base)
        || layer["visible"] != true
        || layer["locks"]["all"] != true
        || layer["opacity"] != 1.0
        || layer["blend"] != "Normal"
        || document["mode"] != "Rgb"
        || document["depth"] != "U8"
        || !document["icc_profile"].is_null()
    {
        return Err(Error::retained(
            "protected-source",
            "reference base must remain the original locked visible bottom raster",
        ));
    }
    let fingerprint=sha(&serde_json::to_vec(&json!({"base":layer,"size":document["size"],"mode":document["mode"],"depth":document["depth"],"icc":document["icc_profile"]})).map_err(native)?);
    match &source.protected_base_manifest_sha256 {
        Some(expected) if expected != &fingerprint => Err(Error::retained(
            "protected-source",
            "protected base structure, properties or pixels changed",
        )),
        Some(_) => Ok(()),
        None if initialize => {
            source.protected_base_manifest_sha256 = Some(fingerprint);
            Ok(())
        }
        None => Err(Error::retained(
            "corrupt",
            "protected source fingerprint missing",
        )),
    }
}
fn contains(layer: &Layer, base: photocraft_doc::LayerId) -> bool {
    layer.id == base
        || layer
            .children()
            .is_some_and(|c| c.iter().any(|l| contains(l, base)))
}
pub(super) fn protected_target(h: &Host, id: photocraft_doc::LayerId) -> Result<bool> {
    let Some(policy) = h.source.as_ref().and_then(|s| s.display_policy.as_ref()) else {
        return Ok(false);
    };
    let base = photocraft_doc::LayerId(policy.base_layer_id.parse().map_err(native)?);
    Ok(h.document()?.layer(id).is_some_and(|l| contains(l, base)))
}
pub(super) fn check_edit(h: &Host, edit: &ProductEdit) -> Result<()> {
    let Some(policy) = h.source.as_ref().and_then(|s| s.display_policy.as_ref()) else {
        return Ok(());
    };
    let base = policy.base_layer_id.parse::<u64>().map_err(native)?;
    let mut selected = Vec::new();
    match edit {
        ProductEdit::NewLayer { .. } => {}
        ProductEdit::SetLayer { layer_id, .. }
        | ProductEdit::RemoveLayer { layer_id }
        | ProductEdit::Clear { layer_id }
        | ProductEdit::Blur { layer_id, .. }
        | ProductEdit::Fill { layer_id, .. }
        | ProductEdit::Transform { layer_id, .. } => selected.push(layer_id.parse()?),
        ProductEdit::SetLayerOpacities { changes } => {
            for c in changes {
                selected.push(c.layer_id.parse()?);
            }
        }
        ProductEdit::Merge { layer_ids } => {
            for id in layer_ids {
                selected.push(id.parse()?);
            }
        }
        ProductEdit::MergeVisible => {
            return Err(Error::none(
                "protected-source",
                "merging visible layers would replace the protected reference base",
            ));
        }
        ProductEdit::MoveLayers {
            layer_ids,
            target_layer_id,
            placement,
        } => {
            for id in layer_ids {
                selected.push(id.parse()?);
            }
            if target_layer_id.parse()?.0 == base
                && serde_json::to_value(placement).map_err(native)? == "after"
            {
                return Err(Error::none(
                    "protected-source",
                    "new layers must remain above the protected reference base",
                ));
            }
        }
    }
    for id in selected {
        if protected_target(h, id)? {
            return Err(Error::none(
                "protected-source",
                "protected reference base and its ancestors cannot be modified",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_manifest_fingerprint_rejects_hidden_base_changes_but_permits_upper_layers_and_duplicate()
     {
        let root = std::env::temp_dir().join(format!(
            "flow-protected-manifest-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut store = Store::open(&root, 8 << 20).unwrap();
        let image = photocraft_codecs::Image::from_u8(
            8,
            4,
            photocraft_codecs::ChannelLayout::Rgba,
            vec![255; 8 * 4 * 4],
        )
        .unwrap();
        let mut doc = photocraft_io::image_to_document("reference", &image)
            .unwrap()
            .document;
        doc.layers[0].locks.all = true;
        let base = doc.layers[0].id;
        let top = Layer::raster("Drawing", doc.pixel_format());
        let target = LayerTarget {
            active: Some(top.id),
            selected: vec![top.id],
        };
        doc.layers.push(top);
        let digest = sha(b"source");
        let source:Source=serde_json::from_value(json!({"digest":digest,"byteLength":6,"formatHint":"tiff","displayPolicy":{"kind":"protected-reference","baseLayerId":base.0.to_string(),"referenceRgbaSha256":sha(&vec![255;128]),"original":{"digest":digest,"byteLength":6,"format":"tiff"}}})).unwrap();
        let receipt = store.save(&doc, &target, Some(source)).unwrap();
        let source = receipt.source.unwrap();
        assert!(source.protected_base_manifest_sha256.is_some());
        for kind in ["unlock", "rename", "pixels", "ancestor", "below", "canvas"] {
            let mut changed = doc.clone();
            match kind {
                "unlock" => changed.layers[0].locks.all = false,
                "rename" => changed.layers[0].name = "changed".into(),
                "pixels" => {
                    let bounds = changed.bounds();
                    changed.layers[0]
                        .surface_mut()
                        .unwrap()
                        .fill_rect(bounds, &[1.0, 0.0, 0.0, 1.0]);
                }
                "ancestor" => {
                    let base = changed.layers.remove(0);
                    changed
                        .layers
                        .insert(0, Layer::group("ancestor", vec![base]));
                }
                "below" => changed.layers.swap(0, 1),
                _ => changed.size = Size::new(7, 4),
            }
            let error = store
                .save(&changed, &target, Some(source.clone()))
                .unwrap_err();
            assert_eq!(error.code, "protected-source", "{kind}: {error}");
            let old = store.load(&receipt.version_id).unwrap();
            assert_eq!(*old.doc, doc);
        }
        doc.layers.push(Layer::raster("Upper", doc.pixel_format()));
        store.save(&doc, &target, Some(source.clone())).unwrap();
        doc.id = photocraft_doc::DocId::fresh();
        let duplicated = store.save(&doc, &target, Some(source.clone())).unwrap();
        assert_eq!(
            duplicated.source.unwrap().display_policy,
            source.display_policy
        );
    }
}
