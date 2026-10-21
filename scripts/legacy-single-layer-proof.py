#!/usr/bin/env python3
"""Read-only, deliberately finite TIFF admissibility probe; not a PSD reader."""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys

if os.environ.get("SWB_PYTHON_DEPS_DIR"):
    sys.path.insert(0, os.environ["SWB_PYTHON_DEPS_DIR"])
import tifffile
from psdtags import PsdKey


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("importer")
    parser.add_argument("source")
    parser.add_argument("result")
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("existing_tiff_importer", args.importer)
    if spec is None or spec.loader is None:
        raise ValueError("Importer unavailable")
    importer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(importer)
    source = Path(args.source)
    # Count the raw list, not the importer's visible/nonempty filtered list.
    layers = list(importer.read_image_source_data(source).layers or [])
    if len(layers) != 1:
        raise ValueError("Not exactly one raw Photoshop layer")
    layer = layers[0]
    if any(getattr(info, "key", None) != PsdKey.UNICODE_LAYER_NAME for info in layer.info):
        raise ValueError("Additional Photoshop metadata is not proved")
    with tifffile.TiffFile(source) as tiff:
        if len(tiff.pages) != 1:
            raise ValueError("Multipage TIFF is not proved")
        page = tiff.pages[0]
        orientation = int(page.tags[274].value) if 274 in page.tags else 1
        if orientation != 1 or page.dtype.name != "uint8" or int(page.photometric) != 2:
            raise ValueError("Only upright 8-bit RGB source is proved")
        # The first finite initializer does not guess how arbitrary XMP/EXIF
        # maps to Project. Absence is a real equivalence condition, not ignored data.
        if any(tag in page.tags for tag in (700, 34665, 34853)):
            raise ValueError("XMP/EXIF/GPS metadata requires a separate semantic proof")
        icc = bytes(page.tags[34675].value) if 34675 in page.tags else None
        if icc is not None:
            if len(icc) < 128 or int.from_bytes(icc[:4], 'big') != len(icc) or icc[36:40] != b'acsp':
                raise ValueError("Malformed ICC profile is not proved")
            # ICC header creation date is an lcms wall-clock stamp, not a color
            # transform. All other bytes (including profile ID) must still match.
            icc = icc[:24] + bytes(12) + icc[36:]
        result = {
            "rawLayerCount": len(layers),
            "orientation": orientation,
            "icc": icc.hex() if icc is not None else None,
            "resolution": [str(page.tags[tag].value) if tag in page.tags else None for tag in (282, 283, 296)],
            "photometric": int(page.photometric),
            "dtype": page.dtype.name,
            "samples": int(page.samplesperpixel),
        }
    Path(args.result).write_text(json.dumps(result), encoding="utf8")


if __name__ == "__main__":
    main()
