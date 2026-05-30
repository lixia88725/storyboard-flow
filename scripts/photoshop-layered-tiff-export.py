#!/usr/bin/env python3
"""Write a Photoshop-readable layered TIFF from a Storyboard Workbench manifest."""

from __future__ import annotations

import argparse
import base64
import hashlib
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
from psdtags import (
    PsdBlendMode,
    PsdChannel,
    PsdChannelId,
    PsdClippingType,
    PsdColorSpaceType,
    PsdCompressionType,
    PsdEmpty,
    PsdFilterMask,
    PsdFormat,
    PsdKey,
    PsdLayer,
    PsdLayerFlag,
    PsdLayerMask,
    PsdLayers,
    PsdRectangle,
    PsdString,
    PsdUserMask,
    TiffImageSourceData,
    overlay,
)


def full_canvas_rectangle(image: numpy.ndarray) -> PsdRectangle:
    return PsdRectangle(0, 0, image.shape[0], image.shape[1])


def blend_mode(value: str) -> PsdBlendMode:
    if value == "multiply":
        return PsdBlendMode.MULTIPLY
    if value == "screen":
        return PsdBlendMode.SCREEN
    return PsdBlendMode.NORMAL


def read_rgba_png(file_path: Path, width: int, height: int) -> numpy.ndarray:
    image = imagecodecs.imread(file_path)
    if image.ndim == 2:
        image = numpy.stack([image, image, image, numpy.full_like(image, 255)], axis=-1)
    elif image.shape[2] == 3:
        alpha = numpy.full((image.shape[0], image.shape[1], 1), 255, dtype=image.dtype)
        image = numpy.concatenate([image, alpha], axis=-1)
    elif image.shape[2] > 4:
        image = image[..., :4]

    if image.shape[0] != height or image.shape[1] != width:
        raise ValueError(
            f"Layer dimensions must match canvas: {file_path} is "
            f"{image.shape[1]}x{image.shape[0]}, expected {width}x{height}"
        )

    if image.dtype != numpy.uint8:
        image = image.astype(numpy.uint8)

    return image


def apply_opacity(image: numpy.ndarray, opacity: float) -> numpy.ndarray:
    clamped = max(0.0, min(1.0, opacity))
    if clamped >= 1.0:
        return image

    result = image.copy()
    result[..., 3] = numpy.round(result[..., 3].astype(numpy.float32) * clamped).astype(numpy.uint8)
    return result


def flatten_over_white(image: numpy.ndarray) -> numpy.ndarray:
    if image.shape[2] < 4:
        return image

    alpha = image[..., 3:4].astype(numpy.float32) / 255.0
    rgb = numpy.round(
        image[..., :3].astype(numpy.float32) * alpha + 255.0 * (1.0 - alpha)
    ).astype(numpy.uint8)
    opaque_alpha = numpy.full((image.shape[0], image.shape[1], 1), 255, dtype=numpy.uint8)
    return numpy.concatenate([rgb, opaque_alpha], axis=-1)


def composite_fingerprint(image: numpy.ndarray) -> str:
    contiguous = numpy.ascontiguousarray(image)
    digest = hashlib.sha256()
    digest.update(f"{contiguous.shape[1]}x{contiguous.shape[0]}:{contiguous.shape[2]}:".encode("utf8"))
    digest.update(contiguous.tobytes())
    return digest.hexdigest()


def swb_metadata_xmp(metadata: dict[str, Any], fingerprint: str) -> str:
    next_metadata = dict(metadata)
    next_metadata["baseFingerprint"] = fingerprint
    encoded = base64.b64encode(
        json.dumps(next_metadata, separators=(",", ":")).encode("utf8")
    ).decode("ascii")
    return f"""<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:swb="https://storyboard-workbench.local/ns/1.0/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="">
      <swb:metadata>{encoded}</swb:metadata>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""


def macroman_safe_name(name: str) -> str:
    safe = name.encode("macroman", errors="replace").decode("macroman")
    return safe if safe.strip("?") else "Layer"


def layer_record(layer: dict[str, Any], image: numpy.ndarray, *, background: bool) -> PsdLayer:
    channels = []

    if not background:
        channels.append(
            PsdChannel(
                channelid=PsdChannelId.TRANSPARENCY_MASK,
                compression=PsdCompressionType.ZIP_PREDICTED,
                data=image[..., 3],
            )
        )

    channels.extend(
        [
            PsdChannel(
                channelid=PsdChannelId.CHANNEL0,
                compression=PsdCompressionType.ZIP_PREDICTED,
                data=image[..., 0],
            ),
            PsdChannel(
                channelid=PsdChannelId.CHANNEL1,
                compression=PsdCompressionType.ZIP_PREDICTED,
                data=image[..., 1],
            ),
            PsdChannel(
                channelid=PsdChannelId.CHANNEL2,
                compression=PsdCompressionType.ZIP_PREDICTED,
                data=image[..., 2],
            ),
        ]
    )

    flags = PsdLayerFlag.PHOTOSHOP5
    if not layer.get("visible", True):
        flags |= PsdLayerFlag.VISIBLE
    if background:
        flags |= PsdLayerFlag.TRANSPARENCY_PROTECTED

    name = str(layer["name"])
    return PsdLayer(
        name=macroman_safe_name(name),
        rectangle=full_canvas_rectangle(image),
        channels=channels,
        mask=PsdLayerMask(),
        opacity=255,
        blendmode=blend_mode(str(layer.get("blendMode", "normal"))),
        blending_ranges=(),
        clipping=PsdClippingType.BASE,
        flags=flags,
        info=[PsdString(PsdKey.UNICODE_LAYER_NAME, name)],
    )


def write_layered_tiff(manifest_path: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    width = int(manifest["width"])
    height = int(manifest["height"])
    layers = manifest["layers"]
    if not layers:
        raise ValueError("Manifest must contain at least one layer")

    loaded_layers = []
    for index, layer in enumerate(layers):
        image = read_rgba_png(Path(layer["path"]), width, height)
        image = apply_opacity(image, float(layer.get("opacity", 1)))
        loaded_layers.append((layer, image, index == 0 and bool(layer.get("background", False))))

    image_source_data = TiffImageSourceData(
        name=str(manifest.get("documentName", "Storyboard Workbench")),
        psdformat=PsdFormat.LE32BIT,
        layers=PsdLayers(
            key=PsdKey.LAYER,
            has_transparency=False,
            layers=[
                layer_record(layer, image, background=background)
                for layer, image, background in loaded_layers
            ],
        ),
        usermask=PsdUserMask(
            colorspace=PsdColorSpaceType.RGB,
            components=(65535, 0, 0, 0),
            opacity=50,
        ),
        info=[
            PsdEmpty(PsdKey.PATTERNS),
            PsdFilterMask(
                colorspace=PsdColorSpaceType.RGB,
                components=(65535, 0, 0, 0),
                opacity=50,
            ),
        ],
    )

    composite_layers = [(image, (0, 0)) for _layer, image, _background in loaded_layers]
    composite = flatten_over_white(overlay(*composite_layers, shape=(height, width)))
    output = Path(manifest["outputPath"])
    output.parent.mkdir(parents=True, exist_ok=True)
    extra_tags = [
        image_source_data.tifftag(maxworkers=4),
        (34675, 7, None, imagecodecs.cms_profile("srgb"), True),
    ]
    xmp = manifest.get("xmp")
    if manifest.get("swbMetadata"):
        xmp = swb_metadata_xmp(manifest["swbMetadata"], composite_fingerprint(composite))
    if xmp:
        extra_tags.append((700, 1, None, str(xmp).encode("utf8"), True))

    tifffile.imwrite(
        output,
        composite,
        photometric="rgb",
        compression="adobe_deflate",
        resolution=((720000, 10000), (720000, 10000)),
        resolutionunit="inch",
        metadata=None,
        extratags=extra_tags,
    )

    reread = TiffImageSourceData.fromtiff(output)
    print(f"wrote={output}")
    print(f"psdtags_layers={len(reread.layers)}")
    print(f"psdtags_layer_names={[layer.name for layer in reread.layers]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", help="Path to the Photoshop TIFF export manifest.")
    args = parser.parse_args()
    write_layered_tiff(Path(args.manifest))


if __name__ == "__main__":
    main()
