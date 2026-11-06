//! One-shot, file-only bridge. It only receives a private job directory, never a user path.
#![forbid(unsafe_code)]
use std::{fs, path::Path};
use photocraft_cms::{Builtin, ColorSpace, Intent, Profile, Transform};
use photocraft_color::{ColorMode, SampleType};
use photocraft_doc::{Document, Layer, LayerContent};
use serde::Serialize;

const VERSION: &str = "a259993118ac7ce1d4c828a385abbc3191841e86";
const MAX_SOURCE: u64 = 128 << 20;
const MAX_PIXELS: u64 = 16 << 20;
const MAX_DIM: u32 = 8192;
const MAX_PNG: usize = 32 << 20;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutLayer { name: String, visible: bool, locked: bool, opacity: f32, blend_mode: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output { protocol: u8, upstream: &'static str, width: u32, height: u32, layers: Vec<OutLayer>, reference: bool, warnings: Vec<String> }
fn simple(layer: &Layer) -> bool {
    use photocraft_color::blend::BlendMode;
    matches!(layer.content, LayerContent::Raster(_)) && layer.mask.is_none() && layer.vector_mask.is_none()
        && layer.frame.is_none() && !layer.clipped && layer.fill_opacity == 1.0
        && layer.effects == Layer::new("", layer.content.clone()).effects
        && layer.blend_if == Default::default() && layer.advanced == Default::default()
        && layer.excluded_channels == 0 && layer.video.is_none()
        && layer.psd_blocks.is_empty()
        && matches!(layer.blend, BlendMode::Normal | BlendMode::Multiply | BlendMode::Screen)
}
fn transform(doc: &Document) -> Result<Option<Transform>, String> {
    // RGB composition retains document RGB; CMYK/Lab/Gray composition is already sRGB.
    if doc.mode != ColorMode::Rgb { return Ok(None); }
    match doc.icc_profile.as_ref() {
        None => Ok(None),
        Some(bytes) => {
            let src = Profile::parse(bytes).map_err(|e| format!("Invalid RGB profile: {e}"))?;
            if src.color_space != ColorSpace::Rgb { return Err("RGB document has non-RGB profile".into()); }
            let dst = Builtin::Srgb.profile();
            if src.same_colors(dst) { Ok(None) }
            else { Transform::new(&src, dst, Intent::RelativeColorimetric, true).map(Some).map_err(|e| e.to_string()) }
        }
    }
}
fn pixels(doc: &Document) -> Result<Vec<u8>, String> {
    let mut buffer = photocraft_compose::flatten(doc);
    let w = doc.size.width; let h = doc.size.height;
    if buffer.px.len() as u64 != u64::from(w) * u64::from(h) { return Err("Composite size mismatch".into()); }
    if let Some(t) = transform(doc)? {
        for row in buffer.px.chunks_mut(w as usize) {
            let mut values: Vec<f32> = row.iter().flat_map(|p| p.iter().copied()).collect();
            t.apply(&mut values, 4);
            for (p, v) in row.iter_mut().zip(values.chunks_exact(4)) { p.copy_from_slice(v); }
        }
    }
    let raw = buffer.to_rgba8();
    Ok(raw.pixels)
}
fn write_png(raw: Vec<u8>, w:u32,h:u32,root:&Path,index:usize)->Result<(),String>{
    let img = photocraft_codecs::Image::from_u8(w, h, photocraft_codecs::ChannelLayout::Rgba, raw).map_err(|e| e.to_string())?;
    let bytes = photocraft_codecs::encode(&img, photocraft_codecs::Format::Png, &Default::default()).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PNG { return Err("Prepared PNG exceeds limit".into()); }
    use std::io::Write;
    fs::OpenOptions::new().write(true).create_new(true).open(root.join(format!("{index}.png"))).and_then(|mut f| f.write_all(&bytes)).map_err(|e| e.to_string())
}
fn png(doc:&Document,root:&Path,index:usize)->Result<(),String>{ write_png(pixels(doc)?,doc.size.width,doc.size.height,root,index) }

fn decode(root: &Path) -> Result<Output, String> {
    if fs::metadata(root.join("request.json")).map_err(|e| e.to_string())?.len() > 4096 { return Err("Request exceeds metadata limit".into()); }
    let request: serde_json::Value = serde_json::from_slice(&fs::read(root.join("request.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if request["protocol"] != 1 { return Err("Unknown bridge protocol".into()); }
    let format = request["format"].as_str().ok_or("Missing format")?;
    if !matches!(format, "tiff" | "psd") { return Err("Unsupported input format".into()); }
    let source = root.join("source.bin");
    if fs::metadata(&source).map_err(|e| e.to_string())?.len() > MAX_SOURCE { return Err("Source exceeds byte limit".into()); }
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    if (format == "psd" && !bytes.starts_with(b"8BPS")) || (format == "tiff" && !bytes.starts_with(b"II*\0") && !bytes.starts_with(b"MM\0*")) { return Err("Source signature does not match format".into()); }
    if format == "tiff" {
        let info = photocraft_codecs::tiff_info(&bytes).map_err(|e| e.to_string())?;
        if !info.complete || info.page_count() != 1 { return Err("Multipage or incomplete TIFF has no single-frame meaning".into()); }
        let page=info.pages.get(info.default_page().ok_or("Missing TIFF page")?).ok_or("Missing TIFF geometry")?;
        if page.width > MAX_DIM || page.height > MAX_DIM || u64::from(page.width)*u64::from(page.height)>MAX_PIXELS {return Err("Canvas exceeds Flow limits".into());}
    }
    let opts = photocraft_io::ImportOptions { psd_max_pixel_bytes: 512 << 20, flat_max_pixel_bytes: 256 << 20, ..Default::default() };
    let (imported, damaged) = photocraft_io::import_for_open(if format == "psd" { "source.psd" } else { "source.tiff" }, &bytes, &opts).map_err(|e| e.to_string())?;
    if damaged || imported.preview_only { return Err("Damaged or placeholder source; reliable display unavailable".into()); }
    let doc = imported.document;
    let w = doc.size.width; let h = doc.size.height;
    if w == 0 || h == 0 || w > MAX_DIM || h > MAX_DIM || u64::from(w) * u64::from(h) > MAX_PIXELS { return Err("Canvas exceeds Flow limits".into()); }
    if doc.layer_count() > 64 { return Err("Source exceeds 64-layer limit".into()); }
    // Do not certify an approximation from upstream as a reliable composition.
    if imported.warnings.iter().any(|w| !w.starts_with("the vertical resolution (")) { return Err(format!("PhotoCraft compatibility: {}", imported.warnings.join("; "))); }
    let mut warnings=imported.warnings;
    let mut merged_display=None;
    if format=="psd" {
        let file=photocraft_psd::PsdFile::from_bytes(&bytes).map_err(|e| e.to_string())?;
        let mut merged=photocraft_io::merged_composite(&file).map_err(|e| format!("Reliable PSD merged image unavailable: {e}"))?;
        if merged.len() as u64 != u64::from(w)*u64::from(h) {return Err("PSD merged size mismatch".into());}
        if let Some(t)=transform(&doc)? {
            for row in merged.chunks_mut(w as usize) {
                let mut vals:Vec<f32>=row.iter().flat_map(|p|p.iter().copied()).collect();t.apply(&mut vals,4);
                for(p,v)in row.iter_mut().zip(vals.chunks_exact(4)){p.copy_from_slice(v);}
            }
        }
        let raw:Vec<u8>=merged.iter().flat_map(|p|p.iter().map(|v|(v.clamp(0.0,1.0)*255.0+0.5)as u8)).collect();
        let rendered=pixels(&doc)?;
        let max=raw.chunks_exact(4).zip(rendered.chunks_exact(4)).flat_map(|(a,b)|a.iter().zip(b).enumerate().map(move |(c,(x,y))| if c!=3 && a[3]==0 && b[3]==0 {0} else{x.abs_diff(*y)})).max().unwrap_or(0);
        if max>2 {warnings.push(format!("PSD 层合成与内嵌画面不一致（最大 {max} 色阶）；采用受保护的内嵌画面，原始层数据保留。"));merged_display=Some(raw);}
    }
    let editable = merged_display.is_none() && doc.mode == ColorMode::Rgb && doc.depth == SampleType::U8 && !doc.layers.is_empty()
        && doc.layers.iter().all(simple) && u64::from(w) * u64::from(h) * (doc.layers.len() as u64 + 1) <= MAX_PIXELS
        && transform(&doc)?.is_none();
    let mut layers = Vec::new();
    if editable {
        for (i, layer) in doc.layers.iter().enumerate() {
            let mut single = doc.clone();
            let mut raster = layer.clone(); raster.visible = true; raster.opacity = 1.0;
            raster.blend = photocraft_color::blend::BlendMode::Normal;
            single.layers = vec![raster];
            png(&single, root, i)?;
            layers.push(OutLayer { name: layer.name.clone(), visible: layer.visible, locked: layer.locks.any(), opacity: layer.opacity, blend_mode: format!("{:?}", layer.blend).to_lowercase() });
        }
    } else {
        if let Some(raw)=merged_display {write_png(raw,w,h,root,0)?;} else {png(&doc, root, 0)?;}
        layers.push(OutLayer { name: "PhotoCraft · 受保护来源显示底图".into(), visible: true, locked: true, opacity: 1.0, blend_mode: "normal".into() });
    }
    Ok(Output { protocol: 1, upstream: VERSION, width: w, height: h, layers, reference: !editable, warnings })
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 2 && args[1] == "--version" { println!("flow-photocraft protocol=1 upstream={VERSION}"); return; }
    if args.len() != 2 { eprintln!("Expected one private job directory"); std::process::exit(2); }
    let root = Path::new(&args[1]);
    let result = std::panic::catch_unwind(|| decode(root)).unwrap_or_else(|_| Err("PhotoCraft decoder panicked".into()));
    let response = match result { Ok(value) => serde_json::json!({"ok":true,"value":value}), Err(message) => serde_json::json!({"ok":false,"error":{"code":"unsupported-input","message":message}}) };
    if let Err(e) = fs::write(root.join("response.json"), response.to_string()) { eprintln!("{e}"); std::process::exit(1); }
}
