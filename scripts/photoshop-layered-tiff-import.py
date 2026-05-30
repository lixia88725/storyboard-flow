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
from psdtags import PsdBlendMode, PsdKey, PsdLayerFlag, PsdSectionDividerType, TiffImageSourceData


SUPPORTED_BLEND_MODES = {
    PsdBlendMode.NORMAL: "normal",
    PsdBlendMode.MULTIPLY: "multiply",
    PsdBlendMode.SCREEN: "screen",
}
NO_LAYERS_MARKER = "SWB_PHOTOSHOP_TIFF_NO_LAYERS"


class NoPhotoshopLayersError(Exception):
    pass


def layer_visible(layer: Any) -> bool:
    # Photoshop stores this bit as hidden-state data in the ImageSourceData
    # records, despite the psdtags enum name.
    return not bool(layer.flags & PsdLayerFlag.VISIBLE)


def layer_locked(layer: Any) -> bool:
    if bool(layer.flags & PsdLayerFlag.TRANSPARENCY_PROTECTED):
        return True

    for info in getattr(layer, "info", []):
        if getattr(info, "key", None) == PsdKey.PROTECTED_SETTING:
            try:
                return int(getattr(info, "value", 0)) != 0
            except (TypeError, ValueError):
                return True

    return False


def section_divider(layer: Any) -> Any | None:
    for info in getattr(layer, "info", []):
        if getattr(info, "key", None) == PsdKey.SECTION_DIVIDER_SETTING:
            return info
    return None


def effective_layer_visibility(layers: list[Any]) -> list[bool]:
    visible = [False] * len(layers)
    parent_visibility: list[bool] = []

    for index in range(len(layers) - 1, -1, -1):
        layer = layers[index]
        section = section_divider(layer)
        self_visible = layer_visible(layer)
        visible[index] = self_visible and all(parent_visibility)

        if section is None:
            continue
        if section.kind in (PsdSectionDividerType.OPEN_FOLDER, PsdSectionDividerType.CLOSED_FOLDER):
            parent_visibility.append(self_visible)
        elif section.kind == PsdSectionDividerType.BOUNDING_SECTION_DIVIDER and parent_visibility:
            parent_visibility.pop()

    return visible


def has_visible_pixels(image: numpy.ndarray) -> bool:
    return bool(image.shape[0] and image.shape[1] and image[..., 3].max() > 0)


def layer_name(layer: Any) -> str:
    for info in getattr(layer, "info", []):
        if getattr(info, "key", None) == PsdKey.UNICODE_LAYER_NAME:
            name = str(getattr(info, "value", "")).strip()
            if name:
                return name
    return str(layer.name)


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
        target_top = max(0, top)
        target_left = max(0, left)
        target_bottom = min(height, bottom)
        target_right = min(width, right)
        if target_top >= target_bottom or target_left >= target_right:
            return canvas

        source_top = target_top - top
        source_left = target_left - left
        source_bottom = source_top + (target_bottom - target_top)
        source_right = source_left + (target_right - target_left)
        canvas[target_top:target_bottom, target_left:target_right, :] = image[
            source_top:source_bottom,
            source_left:source_right,
            :,
        ]
        return canvas

    return numpy.ascontiguousarray(image)


def safe_layer_name(name: str, index: int) -> str:
    cleaned = "".join(char if char.isalnum() or char in " ._-" else "_" for char in name).strip()
    cleaned = cleaned[:80].rstrip()
    return cleaned or f"Layer {index + 1}"


def read_image_source_data(source: Path) -> TiffImageSourceData:
    try:
        return TiffImageSourceData.fromtiff(source)
    except ValueError as error:
        if "contains no ImageSourceData tag" in str(error):
            raise NoPhotoshopLayersError(str(error)) from error
        raise


def extract_layered_tiff(source: Path, output_dir: Path, manifest_path: Path) -> None:
    image_source_data = read_image_source_data(source)
    layers = list(image_source_data.layers or [])
    if not layers:
        raise NoPhotoshopLayersError("No Photoshop layers found")

    with tifffile.TiffFile(source) as tiff:
        page = tiff.pages[0]
        height, width = page.shape[:2]

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_layers = []
    warnings = []
    effective_visibility = effective_layer_visibility(layers)

    for index, layer in enumerate(layers):
        name = layer_name(layer)
        if not effective_visibility[index]:
            warnings.append(f"Skipped hidden Photoshop layer '{name}'.")
            continue

        image = normalize_rgba(layer.asarray(), layer, width, height)
        if not has_visible_pixels(image):
            warnings.append(f"Skipped empty Photoshop layer '{name}'.")
            continue

        file_name = f"{index:04d}-{safe_layer_name(name, index)}.png"
        output_path = output_dir / file_name
        imagecodecs.imwrite(output_path, image)

        blend_mode = SUPPORTED_BLEND_MODES.get(layer.blendmode)
        if blend_mode is None:
            blend_mode = "normal"
            warnings.append(f"Layer '{name}' used unsupported blend mode {layer.blendmode}; imported as normal.")

        manifest_layers.append(
            {
                "name": name,
                "assetPath": str(output_path),
                "visible": True,
                "locked": layer_locked(layer),
                "opacity": max(0, min(1, int(layer.opacity) / 255)),
                "blendMode": blend_mode,
                "order": index,
            }
        )

    if not manifest_layers:
        raise ValueError("No visible non-empty Photoshop raster layers found")

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

    try:
        extract_layered_tiff(Path(args.source), Path(args.output_dir), Path(args.manifest))
    except NoPhotoshopLayersError as error:
        print(f"{NO_LAYERS_MARKER}: {error}", file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
