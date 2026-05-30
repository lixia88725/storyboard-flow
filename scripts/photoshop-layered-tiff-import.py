#!/usr/bin/env python3
"""Extract Photoshop layered TIFF raster layers into SWB import assets."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

deps_dir = os.environ.get("SWB_PYTHON_DEPS_DIR")
if deps_dir:
    sys.path.insert(0, deps_dir)

import imagecodecs
import numpy
import tifffile
from psdtags import PsdBlendMode, PsdLayerFlag, TiffImageSourceData


SUPPORTED_BLEND_MODES = {
    PsdBlendMode.NORMAL: "normal",
    PsdBlendMode.MULTIPLY: "multiply",
    PsdBlendMode.SCREEN: "screen",
}


def layer_visible(layer: Any) -> bool:
    # Current SWB exports set VISIBLE for visible layers. Layers without that
    # flag import as hidden.
    return bool(layer.flags & PsdLayerFlag.VISIBLE)


def normalize_rgba(image: numpy.ndarray, layer: Any, width: int, height: int) -> numpy.ndarray:
    if image.dtype != numpy.uint8:
        raise ValueError(f"Only 8-bit Photoshop TIFF layers are supported; got {image.dtype}")

    if image.ndim == 2:
        image = numpy.stack([image, image, image, numpy.full_like(image, 255)], axis=-1)
    elif image.ndim == 3:
        channels = image.shape[2]
        if channels < 3:
            raise ValueError(f"Unsupported Photoshop TIFF layer channel count: {channels}")
        if channels == 3:
            alpha = numpy.full((image.shape[0], image.shape[1], 1), 255, dtype=image.dtype)
            image = numpy.concatenate([image, alpha], axis=-1)
        elif channels > 4:
            image = image[..., :4]
    else:
        raise ValueError(f"Unsupported Photoshop TIFF layer dimensions: {image.ndim}")

    if image.shape[0] != height or image.shape[1] != width:
        canvas = numpy.zeros((height, width, 4), dtype=numpy.uint8)
        top = int(layer.rectangle.top)
        left = int(layer.rectangle.left)
        bottom = top + image.shape[0]
        right = left + image.shape[1]
        if top < 0 or left < 0 or bottom > height or right > width:
            raise ValueError(
                f"Layer '{layer.name}' rectangle places pixels outside the canvas: "
                f"left={left}, top={top}, right={right}, bottom={bottom}, canvas={width}x{height}"
            )
        canvas[top : top + image.shape[0], left : left + image.shape[1], :] = image
        return canvas

    return numpy.ascontiguousarray(image)


def safe_layer_name(name: str, index: int) -> str:
    cleaned = "".join(char if char.isalnum() or char in " ._-" else "_" for char in name).strip()
    cleaned = cleaned[:80].rstrip()
    return cleaned or f"Layer {index + 1}"


def extract_layered_tiff(source: Path, output_dir: Path, manifest_path: Path) -> None:
    image_source_data = TiffImageSourceData.fromtiff(source)
    layers = list(image_source_data.layers or [])
    if not layers:
        raise ValueError("No Photoshop layers found")

    with tifffile.TiffFile(source) as tiff:
        page = tiff.pages[0]
        height, width = page.shape[:2]

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_layers = []
    warnings = []

    for index, layer in enumerate(layers):
        image = normalize_rgba(layer.asarray(), layer, width, height)
        file_name = f"{index:04d}-{safe_layer_name(str(layer.name), index)}.png"
        output_path = output_dir / file_name
        imagecodecs.imwrite(output_path, image)

        blend_mode = SUPPORTED_BLEND_MODES.get(layer.blendmode)
        if blend_mode is None:
            blend_mode = "normal"
            warnings.append(f"Layer '{layer.name}' used unsupported blend mode {layer.blendmode}; imported as normal.")

        manifest_layers.append(
            {
                "name": str(layer.name),
                "assetPath": str(output_path),
                "visible": layer_visible(layer),
                "opacity": max(0, min(1, int(layer.opacity) / 255)),
                "blendMode": blend_mode,
                "order": index,
            }
        )

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(
            {
                "sourcePath": str(source),
                "width": width,
                "height": height,
                "layers": manifest_layers,
                "warnings": warnings,
            },
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Path to a Photoshop layered TIFF.")
    parser.add_argument("output_dir", help="Directory for extracted PNG layer assets.")
    parser.add_argument("manifest", help="Path for the JSON import manifest.")
    args = parser.parse_args()

    extract_layered_tiff(Path(args.source), Path(args.output_dir), Path(args.manifest))


if __name__ == "__main__":
    main()
