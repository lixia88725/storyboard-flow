#!/usr/bin/env python3
"""Generate a minimal Photoshop-readable layered TIFF spike.

This is intentionally not wired into Storyboard Flow Save. It answers one
question: can we write a TIFF that Photoshop opens as multiple layers?
"""

from __future__ import annotations

import argparse
from pathlib import Path

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


CANVAS_SHAPE = (180, 320)


def full_canvas_rectangle(image: numpy.ndarray) -> PsdRectangle:
    return PsdRectangle(0, 0, image.shape[0], image.shape[1])


def layer_record(name: str, image: numpy.ndarray, *, background: bool = False) -> PsdLayer:
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
    if background:
        flags |= PsdLayerFlag.TRANSPARENCY_PROTECTED

    return PsdLayer(
        name=name,
        rectangle=full_canvas_rectangle(image),
        channels=channels,
        mask=PsdLayerMask(),
        opacity=255,
        blendmode=PsdBlendMode.NORMAL,
        blending_ranges=(),
        clipping=PsdClippingType.BASE,
        flags=flags,
        info=[PsdString(PsdKey.UNICODE_LAYER_NAME, name)],
    )


def make_layers() -> tuple[numpy.ndarray, numpy.ndarray]:
    height, width = CANVAS_SHAPE

    image = numpy.empty((height, width, 4), numpy.uint8)
    image[..., 0] = 205
    image[..., 1] = 220
    image[..., 2] = 255
    image[..., 3] = 255

    paint = numpy.zeros((height, width, 4), numpy.uint8)
    paint[42:138, 72:250, 0] = 240
    paint[42:138, 72:250, 1] = 80
    paint[42:138, 72:250, 2] = 40
    paint[42:138, 72:250, 3] = 190

    for index in range(28):
        row = 38 + index * 4
        col_start = 64 + index * 5
        paint[row : row + 8, col_start : col_start + 96, 0] = 45
        paint[row : row + 8, col_start : col_start + 96, 1] = 35
        paint[row : row + 8, col_start : col_start + 96, 2] = 25
        paint[row : row + 8, col_start : col_start + 96, 3] = 230

    return image, paint


def write_layered_tiff(output: Path) -> None:
    image, paint = make_layers()
    layers = [("Image", image, True), ("Paint 1", paint, False)]

    image_source_data = TiffImageSourceData(
        name="SWB Photoshop Layered TIFF Spike",
        psdformat=PsdFormat.LE32BIT,
        layers=PsdLayers(
            key=PsdKey.LAYER,
            has_transparency=False,
            layers=[layer_record(name, data, background=background) for name, data, background in layers],
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

    composite = overlay((image, (0, 0)), (paint, (0, 0)), shape=CANVAS_SHAPE)

    output.parent.mkdir(parents=True, exist_ok=True)
    tifffile.imwrite(
        output,
        composite,
        photometric="rgb",
        compression="adobe_deflate",
        resolution=((720000, 10000), (720000, 10000)),
        resolutionunit="inch",
        metadata=None,
        extratags=[
            image_source_data.tifftag(maxworkers=4),
            (34675, 7, None, imagecodecs.cms_profile("srgb"), True),
        ],
    )

    reread = TiffImageSourceData.fromtiff(output)
    layer_names = [layer.name for layer in reread.layers]
    print(f"wrote={output}")
    print(f"psdtags_layers={len(layer_names)}")
    print(f"psdtags_layer_names={layer_names}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="/private/tmp/swb-photoshop-layered-spike.tiff",
        help="Layered TIFF output path.",
    )
    args = parser.parse_args()
    write_layered_tiff(Path(args.output))


if __name__ == "__main__":
    main()
