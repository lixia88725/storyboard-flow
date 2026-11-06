//! Limited append-only PSD export. Original file-model fields are not regenerated.
use crate::{MAX_DIM, MAX_PIXELS, MAX_PNG, MAX_SOURCE, VERSION};
use photocraft_cms::{Builtin, Profile};
use photocraft_psd::{ChannelData, Compression, LayerRecord, PsdFile, Rect, TaggedBlock};
use serde::Deserialize;
use std::{fs, io::Write, path::Path};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Paint {
    name: String,
    visible: bool,
    locked: bool,
    opacity: f64,
    blend_mode: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol: u8,
    operation: String,
    width: u32,
    height: u32,
    layers: Vec<Paint>,
}
fn raw_png(file: &Path, w: u32, h: u32) -> Result<Vec<u8>, String> {
    if fs::metadata(file).map_err(|e| e.to_string())?.len() > MAX_PNG as u64 {
        return Err("PNG exceeds limit".into());
    }
    let opts = photocraft_codecs::DecodeOptions {
        limits: photocraft_codecs::Limits {
            max_width: MAX_DIM,
            max_height: MAX_DIM,
            max_pixels: MAX_PIXELS,
            max_alloc: MAX_PIXELS * 4,
        },
        ..Default::default()
    };
    let img = photocraft_codecs::decode_as_with(
        photocraft_codecs::Format::Png,
        &fs::read(file).map_err(|e| e.to_string())?,
        &opts,
    )
    .map_err(|e| e.to_string())?;
    if img.width() != w
        || img.height() != h
        || img.sample_type() != photocraft_codecs::SampleType::U8
    {
        return Err("PNG geometry/depth mismatch".into());
    }
    if let Some(icc) = img.icc.as_ref() {
        let p = Profile::parse(icc).map_err(|e| e.to_string())?;
        if !p.same_colors(Builtin::Srgb.profile()) {
            return Err("Flow绘画PNG不是sRGB像素，已拒绝混用颜色空间".into());
        }
    }
    if img.icc.is_none() && img.cicp.is_some() {
        return Err("Flow绘画PNG带未验证的CICP颜色声明".into());
    }
    Ok(img.to_rgba8())
}
fn max_diff(a: &[u8], b: &[u8]) -> u8 {
    a.chunks_exact(4)
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
        .unwrap_or(0)
}
pub fn run(root: &Path) -> Result<serde_json::Value, String> {
    let req: Request =
        serde_json::from_slice(&fs::read(root.join("request.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if req.protocol != 1
        || req.operation != "export-psd"
        || req.layers.is_empty()
        || req.layers.len() > 63
        || req.width == 0
        || req.height == 0
        || req.width > MAX_DIM
        || req.height > MAX_DIM
        || u64::from(req.width) * u64::from(req.height) * (req.layers.len() as u64 + 1) > MAX_PIXELS
    {
        return Err("PSD export request exceeds limits".into());
    }
    let original_path = root.join("source.bin");
    if fs::metadata(&original_path)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_SOURCE
    {
        return Err("Source exceeds limit".into());
    }
    let source = fs::read(original_path).map_err(|e| e.to_string())?;
    let mut file = PsdFile::from_bytes(&source).map_err(|e| e.to_string())?;
    if file.header.version != photocraft_psd::Version::Psd
        || file.header.depth != 8
        || file.header.color_mode != photocraft_psd::ColorMode::Rgb
    {
        return Err(
            "PSD另存目前仅支持8-bit RGB PSD来源，PSB/CMYK/高位深来源仍可在Flow中显示和绘画".into(),
        );
    }
    if file.header.width != req.width
        || file.header.height != req.height
        || file.layers().is_empty()
        || file.layers().len() + req.layers.len() > 64
    {
        return Err("PSD source geometry or retained-layer count is unsupported".into());
    }
    if file.header.channels != 3 + u16::from(file.merged_has_alpha()) {
        return Err("PSD额外Alpha/专色通道尚未验证，已阻止另存；来源与Flow编辑均保留".into());
    }
    if let Some(icc) = file.icc_profile() {
        let p = Profile::parse(icc).map_err(|e| e.to_string())?;
        if !p.same_colors(Builtin::Srgb.profile()) {
            return Err(
                "PSD另存目前需要sRGB等效ICC；新增Flow像素是sRGB，已阻止混用其他颜色空间".into(),
            );
        }
    }
    let opts = photocraft_io::ImportOptions {
        psd_max_pixel_bytes: 512 << 20,
        flat_max_pixel_bytes: 256 << 20,
        ..Default::default()
    };
    let (imported, damaged) =
        photocraft_io::import_for_open("source.psd", &source, &opts).map_err(|e| e.to_string())?;
    if damaged || imported.preview_only || !imported.warnings.is_empty() {
        return Err(format!(
            "PSD来源兼容性不能确认：{}",
            imported.warnings.join("; ")
        ));
    }
    let merged = photocraft_io::merged_composite(&file).map_err(|e| e.to_string())?;
    let base: Vec<u8> = merged
        .iter()
        .flat_map(|p| p.iter().map(|v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8))
        .collect();
    let rendered = crate::pixels(&imported.document)?;
    if max_diff(&base, &rendered) > 1 {
        return Err("PSD源层与内嵌画面不一致，无法保证复杂层另存；Flow显示与保存仍可使用".into());
    }
    let reference = raw_png(&root.join("base.png"), req.width, req.height)?;
    if max_diff(&reference, &base) > 1 {
        return Err("PSD受保护底图与原件合成图不一致，已停止另存".into());
    }
    let original = file.clone();
    let old_layers = file.layers().len();
    let area = req.width as usize * req.height as usize;
    let mut composite: Vec<[f64; 4]> = reference
        .chunks_exact(4)
        .map(|p| std::array::from_fn(|i| f64::from(p[i]) / 255.0))
        .collect();
    let mut next_id = file
        .layers()
        .iter()
        .filter_map(|l| l.layer_id())
        .max()
        .unwrap_or(0);
    for (i, paint) in req.layers.iter().enumerate() {
        if !paint.opacity.is_finite()
            || !(0.0..=1.0).contains(&paint.opacity)
            || paint.name.contains('\0')
            || paint.name.len() > 65536
        {
            return Err("Invalid Flow layer properties".into());
        }
        let blend = match paint.blend_mode.as_str() {
            "normal" => photocraft_psd::BlendMode::Normal,
            "multiply" => photocraft_psd::BlendMode::Multiply,
            "screen" => photocraft_psd::BlendMode::Screen,
            _ => return Err("Unsupported Flow blend".into()),
        };
        let raw = raw_png(&root.join(format!("{i}.png")), req.width, req.height)?;
        next_id = next_id
            .checked_add(1)
            .ok_or("PSD layer identity exhausted")?;
        let mut record = LayerRecord {
            rect: Rect::from_xywh(0, 0, req.width, req.height),
            blend_mode: blend,
            opacity: (paint.opacity * 255.0).round() as u8,
            name: b"Flow drawing".to_vec(),
            blocks: vec![
                TaggedBlock::unicode_name(&paint.name),
                TaggedBlock::layer_id(next_id),
                TaggedBlock::protection(if paint.locked { 0x80000000 } else { 0 }),
            ],
            ..Default::default()
        };
        record.flags.set_hidden(!paint.visible);
        for c in 0..4 {
            let plane: Vec<u8> = raw.chunks_exact(4).map(|p| p[c]).collect();
            record.channels.push(
                ChannelData::encode(
                    if c == 3 { -1 } else { c as i16 },
                    Compression::Rle,
                    &plane,
                    req.width as usize,
                    req.height as usize,
                    8,
                    file.header.version,
                )
                .map_err(|e| e.to_string())?,
            );
        }
        file.layers_mut().push(record);
        if paint.visible {
            for (dst, p) in composite.iter_mut().zip(raw.chunks_exact(4)) {
                let sa = f64::from(p[3]) / 255.0 * paint.opacity;
                let da = dst[3];
                let oa = sa + da * (1.0 - sa);
                for c in 0..3 {
                    let s = f64::from(p[c]) / 255.0;
                    let b = dst[c];
                    let mix = match paint.blend_mode.as_str() {
                        "multiply" => s * b,
                        "screen" => s + b - s * b,
                        _ => s,
                    };
                    dst[c] = if oa > 0.0 {
                        (sa * (1.0 - da) * s + sa * da * mix + da * (1.0 - sa) * b) / oa
                    } else {
                        0.0
                    };
                }
                dst[3] = oa;
            }
        }
    }
    // PSD's merged RGB is matted over white when its transparency marker is set.
    // Layer RGBA channels above remain straight and entirely separate.
    let alpha = file.merged_has_alpha();
    let mut planes = vec![0u8; area * file.header.channels as usize];
    for (i, p) in composite.iter().enumerate() {
        for c in 0..3 {
            let v = if alpha {
                p[c] * p[3] + 1.0 - p[3]
            } else {
                p[c]
            };
            planes[c * area + i] = (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        }
        if alpha {
            planes[3 * area + i] = (p[3].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        }
    }
    // Refresh recognized preview resources; preserve every other resource verbatim.
    let thumb_w = req.width.min(160);
    let thumb_h = ((u64::from(req.height) * u64::from(thumb_w) / u64::from(req.width))
        .max(1)
        .min(160)) as u32;
    let thumb_w = ((u64::from(req.width) * u64::from(thumb_h) / u64::from(req.height))
        .max(1)
        .min(160)) as u32;
    let mut rgb = Vec::with_capacity(thumb_w as usize * thumb_h as usize * 3);
    for y in 0..thumb_h {
        for x in 0..thumb_w {
            let sx = u64::from(x) * u64::from(req.width) / u64::from(thumb_w);
            let sy = u64::from(y) * u64::from(req.height) / u64::from(thumb_h);
            let p = composite[(sy * u64::from(req.width) + sx) as usize];
            for v in &p[..3] {
                rgb.push(((v * p[3] + 1.0 - p[3]).clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
            }
        }
    }
    let img = photocraft_codecs::Image::from_u8(
        thumb_w,
        thumb_h,
        photocraft_codecs::ChannelLayout::Rgb,
        rgb,
    )
    .map_err(|e| e.to_string())?;
    let jpg = photocraft_codecs::encode(
        &img,
        photocraft_codecs::Format::Jpeg,
        &photocraft_codecs::EncodeOptions {
            jpeg_quality: 80,
            embed_icc: false,
            embed_metadata: false,
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    let row = thumb_w.saturating_mul(24).div_ceil(32) * 4;
    let mut thumb = Vec::new();
    for value in [1, thumb_w, thumb_h, row, row * thumb_h, jpg.len() as u32] {
        thumb.extend_from_slice(&value.to_be_bytes());
    }
    thumb.extend_from_slice(&24u16.to_be_bytes());
    thumb.extend_from_slice(&1u16.to_be_bytes());
    thumb.extend(jpg);
    file.resources.retain(|r| r.id != 1033 && r.id != 1036);
    file.resources
        .push(photocraft_psd::ImageResource::new(1036, thumb));
    // Version Info stores hasRealMergedData after its 4-byte version number.
    if let Some(info) = file.resources.iter_mut().find(|r| r.id == 1057) {
        if let Some(flag) = info.data.get_mut(4) {
            *flag = 1;
        } else {
            return Err("Invalid PSD version-info resource".into());
        }
    }
    file.image_data = photocraft_psd::ImageData::encode(Compression::Rle, &planes, &file.header)
        .map_err(|e| e.to_string())?;
    let bytes = file.to_bytes().map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_SOURCE {
        return Err("PSD output exceeds128MiB limit".into());
    }
    let checked = PsdFile::from_bytes(&bytes).map_err(|e| e.to_string())?;
    let mut expected_resources = original.resources.clone();
    expected_resources.retain(|r| r.id != 1033 && r.id != 1036);
    if let Some(info) = expected_resources.iter_mut().find(|r| r.id == 1057) {
        if let Some(flag) = info.data.get_mut(4) {
            *flag = 1;
        }
    }

    if checked.layers().get(..old_layers) != Some(original.layers())
        || checked
            .resources
            .iter()
            .filter(|r| r.id != 1033 && r.id != 1036)
            .collect::<Vec<_>>()
            != expected_resources.iter().collect::<Vec<_>>()
        || checked.global_blocks != original.global_blocks
        || checked.global_layer_mask != original.global_layer_mask
        || checked.color_mode_data != original.color_mode_data
        || checked.layer_mask_trailing != original.layer_mask_trailing
    {
        return Err("Retained PSD structures changed; output refused".into());
    }
    let (doc, damaged) =
        photocraft_io::import_for_open("output.psd", &bytes, &opts).map_err(|e| e.to_string())?;
    if damaged || !doc.warnings.is_empty() {
        return Err("Exported PSD cannot be reliably recomposed".into());
    }
    let actual = crate::pixels(&doc.document)?;
    let expected: Vec<u8> = composite
        .iter()
        .flat_map(|p| p.iter().map(|v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8))
        .collect();
    if max_diff(&actual, &expected) > 2 {
        return Err("PSD图层重新合成与当前Flow画面不一致，已阻止另存".into());
    }
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join("output.psd"))
        .and_then(|mut f| f.write_all(&bytes))
        .map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"protocol":1,"upstream":VERSION,"operation":"export-psd","width":req.width,"height":req.height,"layersAdded":req.layers.len(),"retainedLayers":old_layers}),
    )
}
