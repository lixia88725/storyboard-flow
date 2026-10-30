"""Certified synthetic fixture producer; never accepts personal media."""
import os
import sys
sys.path.insert(0, os.environ['FLOW_PYTHON_DEPS_DIR'])
from pathlib import Path
import numpy as np
import tifffile
from codec import RasterUnicodeName
from psdtags import (TiffImageSourceData, PsdBlendMode, PsdEmpty, PsdKey,
                     PsdLayerMask, PsdRectangle, PsdString, PsdCompressionType)

mode, source, dest = sys.argv[1:]
if mode == 'png16':
    import imagecodecs
    Path(dest).write_bytes(imagecodecs.png_encode(np.zeros((1, 2, 4), np.uint16)))
elif mode in ('plain', 'sixteen', 'pages', 'gray', 'oriented', 'large', 'xmp'):
    a = np.array([[[10, 30, 50, 0], [200, 100, 30, 128]]], np.uint8)
    tags = []
    if mode == 'sixteen': a = a.astype(np.uint16) * 257
    if mode == 'pages': a = np.stack([a, a])
    if mode == 'gray': a = a[..., 0]
    if mode == 'large': a = np.zeros((17, 17, 4), np.uint8)
    if mode == 'oriented': tags = [(274, 3, 1, 6, True)]
    if mode == 'xmp': tags = [(700, 1, None, b'<unknown>data</unknown>', True)]
    tifffile.imwrite(dest, a, photometric='minisblack' if mode == 'gray' else 'rgb',
                     extrasamples=None if mode == 'gray' else ['unassalpha'], metadata=None, extratags=tags)
else:
    d = TiffImageSourceData.fromtiff(source)
    with tifffile.TiffFile(source) as t:
        a = t.pages[0].asarray()
        xmp = t.pages[0].tags[700].value
    layer = d.layers[0]
    if mode in ('raw', 'zip', 'rle'):
        compression = {'raw': PsdCompressionType.RAW, 'zip': PsdCompressionType.ZIP, 'rle': PsdCompressionType.RLE}[mode]
        for record in d.layers:
            for c in record.channels: c.compression = compression
    if mode in ('zipbomb', 'rlebomb'):
        layer.channels[0].compression = PsdCompressionType.ZIP if mode == 'zipbomb' else PsdCompressionType.RLE
        layer.channels[0].data = np.zeros((1, 1000), np.uint8)
    if mode == 'blend': layer.blendmode = PsdBlendMode.OVERLAY
    if mode == 'mask': layer.mask = PsdLayerMask(rectangle=PsdRectangle(0, 0, 1, 2))
    if mode == 'group': layer.info.append(PsdEmpty(PsdKey.SECTION_DIVIDER_SETTING))
    if mode == 'channel': layer.channels.pop(0)
    if mode == 'offcanvas': layer.rectangle = PsdRectangle(0, 100, 1, 102)
    if mode == 'bigrect': layer.rectangle = PsdRectangle(0, 0, 100000, 100000)
    if mode == 'generic': xmp = None
    if mode == 'empty':
        layer.rectangle = PsdRectangle(0, 0, 0, 0)
        for c in layer.channels: c.data = np.empty((0, 0), np.uint8)
        xmp = None
    if mode == 'opacity': layer.opacity = 200
    if mode in ('version', 'field'):
        import base64, json, re
        match = re.search(rb'<flow:metadata>(.*?)</flow:metadata>', xmp)
        envelope = json.loads(base64.b64decode(match[1]))
        if mode == 'version': envelope['rasterVersion'] = 2
        else: envelope['unknown'] = True
        xmp = xmp.replace(match[1], base64.b64encode(json.dumps(envelope).encode()))
    if mode == 'name': layer.info = [PsdString(PsdKey.UNICODE_LAYER_NAME, '外部重命名')]
    for record in d.layers:
        record.info = [RasterUnicodeName(info.key, info.value) if info.key == PsdKey.UNICODE_LAYER_NAME else info for info in record.info]
    tags = [d.tifftag(maxworkers=1)]
    if xmp is not None: tags.append((700, 1, None, xmp, True))
    tifffile.imwrite(dest, a, photometric='rgb', extrasamples=['unassalpha'], metadata=None, extratags=tags)
