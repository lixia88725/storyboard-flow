//! Flow product brush settings -> the existing PhotoCraft live renderer.
//! This adapts tips/dynamics; it does not implement stamping or compositing.
use super::*;
use photocraft_engine::paint::{BrushSettings, Control, Dynamic, GrayTile, TipShape};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FlowBrush {
    tip: String,
    spacing: f64,
    hardness: f64,
    grain: f64,
    seed: u64,
    pressure_size: f64,
    pressure_opacity: f64,
}
fn hash(seed: u32, index: u32, salt: u32) -> u32 {
    let mut h = seed
        ^ (index.wrapping_add(1).wrapping_mul(0x9e3779b1))
        ^ (salt.wrapping_add(1).wrapping_mul(0x85ebca6b));
    h ^= h >> 16;
    h = h.wrapping_mul(0x7feb352d);
    h ^= h >> 15;
    h = h.wrapping_mul(0x846ca68b);
    h ^ (h >> 16)
}
fn unit(h: u32) -> f64 {
    f64::from(h) / 4294967296.0
}
fn grain_at(x: f64, y: f64, variant: u32, cell: f64) -> f64 {
    let (gx, gy) = ((x / cell).floor() as i32, (y / cell).floor() as i32);
    let (fx, fy) = (x / cell - f64::from(gx), y / cell - f64::from(gy));
    let sample = |ix: i32, iy: i32| {
        unit(hash(
            1337u32.wrapping_add(variant.wrapping_mul(7919)),
            (ix as u32).wrapping_mul(73856093) ^ (iy as u32).wrapping_mul(19349663),
            31,
        ))
    };
    let (a, b, c, d) = (
        sample(gx, gy),
        sample(gx + 1, gy),
        sample(gx, gy + 1),
        sample(gx + 1, gy + 1),
    );
    let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    (a * (1.0 - sx) + b * sx) * (1.0 - sy) + (c * (1.0 - sx) + d * sx) * sy
}
fn tip(b: &FlowBrush, size: u32) -> GrayTile {
    // The product's procedural tip, sampled once per stroke. Native dynamics then
    // scale/rotate it. This intentionally uses PhotoCraft's sampler and RNG.
    let diameter = f64::from(size);
    let radius = diameter / 2.0;
    let variant = (b.seed % 6) as u32;
    GrayTile::from_fn(size, size, |x, y| {
        let dx = (f64::from(x) + 0.5 - radius) / radius;
        let dy = (f64::from(y) + 0.5 - radius) / radius;
        let distance = dx.hypot(dy);
        let coverage = if b.tip != "pencil" {
            let edge = if size <= 8 { 0.75 } else { 1.0 };
            let feather = (1.0 - b.hardness).max(0.02);
            let inner = 1.0 - feather;
            (((1.0 - distance) / (1.0 - inner * 0.999).max(0.001)).clamp(0.0, 1.0))
                * ((radius * (1.0 - distance) / edge).clamp(0.0, 1.0))
        } else {
            let noise = grain_at(
                f64::from(x),
                f64::from(y),
                variant,
                (diameter * 0.04).max(1.0),
            );
            let rim_jitter = unit(hash(
                variant + 991,
                x.wrapping_mul(131).wrapping_add(y.wrapping_mul(977)),
                5,
            ));
            let rim = 1.0 - b.grain * 0.3 * (rim_jitter - 0.5) * 2.0;
            let falloff = (diameter * 0.1).max(1.5) * (1.0 - b.grain * 0.45);
            ((rim - distance) * radius / falloff).clamp(0.0, 1.0)
                * (1.0 - 0.6 * b.grain * (1.0 - (0.4 + 0.6 * noise)))
        };
        ((coverage.clamp(0.0, 1.0) * 255.0).round() / 255.0) as f32
    })
}
fn pressure(coefficient: f64) -> Dynamic {
    Dynamic {
        control: if coefficient > 0.0 {
            Control::PenPressure
        } else {
            Control::Off
        },
        minimum: (1.0 - coefficient) as f32,
        ..Default::default()
    }
}
pub(super) fn params(value: &Value) -> Result<Value> {
    let Some(raw) = value.get("flowBrush") else {
        return Ok(value.clone());
    };
    let b: FlowBrush = serde_json::from_value(raw.clone()).map_err(native)?;
    if !["hard", "soft", "pencil"].contains(&b.tip.as_str()) {
        return Err(Error::none(
            "unsupported",
            "Flow brush tip is not a current product preset",
        ));
    }
    if b.seed > u64::from(u32::MAX)
        || value.get("seed").and_then(Value::as_u64) != Some(b.seed)
        || ![b.hardness, b.grain, b.pressure_size, b.pressure_opacity]
            .iter()
            .all(|n| n.is_finite() && (0.0..=1.0).contains(n))
        || !b.spacing.is_finite()
        || !(0.01..=1.0).contains(&b.spacing)
    {
        return Err(Error::none(
            "invalid-input",
            "invalid Flow brush dynamics/seed",
        ));
    }
    let size = value
        .get("size")
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && *n > 0.0 && *n <= 1000.0)
        .ok_or_else(|| {
            Error::none(
                "invalid-input",
                "Flow brush size must be finite in (0,1000]",
            )
        })?;
    let mut brush = BrushSettings::default();
    brush.pressure_size = false;
    brush.pressure_opacity = false;
    brush.spacing = b.spacing as f32;
    brush.spacing_enabled = true;
    brush.flow = 1.0;
    brush.tip = TipShape::Sampled(tip(&b, size.round().clamp(1.0, 256.0) as u32));
    brush.shape_dynamics.enabled = b.pressure_size > 0.0 || b.tip == "pencil";
    brush.shape_dynamics.size = pressure(b.pressure_size);
    if b.tip == "pencil" {
        brush.shape_dynamics.angle.jitter = 1.0;
    }
    brush.transfer.enabled = b.pressure_opacity > 0.0;
    brush.transfer.opacity = pressure(b.pressure_opacity);
    brush.smoothing.enabled = false;
    brush.seed = b.seed;
    let mut out = value.clone();
    let map = out
        .as_object_mut()
        .ok_or_else(|| Error::none("invalid-input", "Flow brush must be an object"))?;
    map.remove("flowBrush");
    map.insert("brush".into(), serde_json::to_value(brush).map_err(native)?);
    map.insert("flow".into(), json!(1.0));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_pressure_floors_and_real_grain_in_native_settings() {
        let params=params(&json!({"size":36,"seed":42,"flowBrush":{"tip":"pencil","hardness":0.5,"grain":0.55,"spacing":0.035,"pressureSize":0.45,"pressureOpacity":0.6,"seed":42}})).unwrap();
        let b: BrushSettings = serde_json::from_value(params["brush"].clone()).unwrap();
        assert!(!b.pressure_size && !b.pressure_opacity && !b.smoothing.enabled);
        assert_eq!(b.shape_dynamics.size.control, Control::PenPressure);
        assert_eq!(b.shape_dynamics.size.minimum, 0.55);
        assert_eq!(b.transfer.opacity.minimum, 0.4);
        let tile = b.tip.bitmap().unwrap();
        let values = tile
            .data
            .iter()
            .filter(|v| **v > 0 && **v < u16::MAX)
            .collect::<std::collections::HashSet<_>>();
        assert!(values.len() > 20);
        assert_eq!(b.flow, 1.0);
    }
}
