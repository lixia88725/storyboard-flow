"""Bounded raster TIFF worker. Invoked only with a private adapter-owned workspace.
Reuses installed tifffile/imagecodecs/psdtags; intentionally does not call the
legacy importer/writer, which drop layers and bake opacity respectively.
"""
import base64
import json
import io
import os
from pathlib import Path
import sys
import zlib
import struct
import xml.etree.ElementTree as ET

sys.path.insert(0, os.environ['FLOW_PYTHON_DEPS_DIR'])
import imagecodecs
import numpy as np
import tifffile
from psdtags import (PsdBlendMode, PsdChannel, PsdChannelId, PsdClippingType,
                     PsdCompressionType, PsdFormat, PsdKey, PsdLayer,
                     PsdLayerFlag, PsdLayerMask, PsdLayers, PsdRectangle,
                     PsdString, PsdInteger, PsdUserMask, TiffImageSourceData)

BLENDS = {'normal': PsdBlendMode.NORMAL, 'multiply': PsdBlendMode.MULTIPLY, 'screen': PsdBlendMode.SCREEN}
NS = '{https://storyboard-flow.local/ns/1.0/}metadata'

class Refusal(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

class RasterUnicodeName(PsdString):
    # Installed psdtags counts code points rather than UTF-16 code units.
    # Keep this compatibility repair local: never patch the shared dependency.
    def write(self, fh, psdformat):
        encoded = self.value.encode(psdformat.utf16)
        return psdformat.write(fh, 'I', len(encoded)//2) + fh.write(encoded)

def require(condition, message, code='unsupported-input'):
    if not condition:
        raise Refusal(code, message)

def dimensions(w, h, count, limits):
    require(w > 0 and h > 0 and w <= limits['maxDimension'] and h <= limits['maxDimension']
            and w * h * count <= limits['maxTotalPixels'], 'Canvas/layer pixels exceed limits', 'resource-limit')

def rgba(a):
    require(a.dtype == np.uint8 and a.ndim == 3 and a.shape[2] in (3, 4), 'Only 8-bit RGB/RGBA raster pixels are supported')
    if a.shape[2] == 3:
        a = np.concatenate([a, np.full((*a.shape[:2], 1), 255, np.uint8)], axis=2)
    return np.ascontiguousarray(a)

def write_png(root, index, a, limits):
    encoded = imagecodecs.png_encode(a)
    require(len(encoded) <= limits['maxPngBytes'], 'Encoded PNG exceeds limit', 'resource-limit')
    (root / f'{index}.png').write_bytes(encoded)

def preflight(source, w, h, limits):
    # Inspect every layer descriptor BEFORE psdtags decompresses channel arrays.
    with tifffile.TiffFile(source) as t:
        raw = bytes(t.pages[0].tags[37724].value)
    stream = io.BytesIO(raw)
    require(stream.read(len(TiffImageSourceData.SIGNATURE)) == TiffImageSourceData.SIGNATURE,
            'Malformed Photoshop layer signature', 'invalid-input')
    fmt = PsdFormat(stream.read(4))
    stream.seek(-4, 1)
    found = False
    while stream.tell() < len(raw):
        signature = stream.read(4)
        if not signature or signature == b'\0' * len(signature): break
        require(signature == fmt, 'Malformed Photoshop tag signature', 'invalid-input')
        key = PsdKey(stream.read(4))
        size = fmt.read_size(stream, key)
        pos = stream.tell()
        require(0 <= size <= len(raw)-pos, 'Truncated Photoshop tag', 'invalid-input')
        require(key in (PsdKey.LAYER, PsdKey.USER_MASK), 'Unsupported document-level Photoshop structure')
        if key == PsdKey.LAYER:
            require(not found, 'Duplicate layer records', 'invalid-input')
            found = True
            count = abs(fmt.read(stream, 'h'))
            require(0 < count <= limits['maxLayers'], 'Layer count exceeds limit', 'resource-limit')
            dimensions(w, h, count, limits)
            descriptors = []
            for _ in range(count):
                layer = PsdLayer.read(stream, fmt, unknown=True)
                r = layer.rectangle
                require(0 <= r.left <= r.right <= w and 0 <= r.top <= r.bottom <= h,
                        'Off-canvas/oversized layer rectangle is unsupported')
                require(layer.mask is None or layer.mask == PsdLayerMask(), 'Layer masks are unsupported')
                ids = [int(c.channelid) for c in layer.channels]
                require(sorted(ids) in ([0, 1, 2], [-1, 0, 1, 2]), 'Missing, extra or duplicate raster channels')
                require(stream.tell() <= pos+size, 'Truncated layer records', 'invalid-input')
                descriptors.append(layer)
            # Prove compressed-channel expansion bounds before the existing
            # library's eager decoding (its ZIP/RLE routines are not capped).
            for layer in descriptors:
                for channel in layer.channels:
                    length = channel._data_length
                    require(2 <= length <= pos+size-stream.tell(), 'Truncated channel bytes', 'invalid-input')
                    compression = PsdCompressionType(fmt.read(stream, 'H'))
                    encoded = stream.read(length-2)
                    expected = layer.shape[0] * layer.shape[1]
                    if compression == PsdCompressionType.RAW:
                        require(len(encoded) == expected, 'RAW channel length mismatch', 'invalid-input')
                    elif compression in (PsdCompressionType.ZIP, PsdCompressionType.ZIP_PREDICTED):
                        if expected == 0:
                            require(not encoded, 'Nonempty data in zero-area channel', 'invalid-input')
                        else:
                            inflater = zlib.decompressobj()
                            bounded = inflater.decompress(encoded, expected+1)
                            require(len(bounded) == expected and inflater.eof and not inflater.unconsumed_tail
                                    and not inflater.unused_data, 'ZIP channel expansion mismatch', 'invalid-input')
                    elif compression == PsdCompressionType.RLE:
                        offset = layer.shape[0] * (4 if fmt.isb64 else 2)
                        require(offset <= len(encoded), 'RLE row table truncated', 'invalid-input')
                        sizes = struct.unpack(fmt.byteorder + ('I' if fmt.isb64 else 'H') * layer.shape[0], encoded[:offset])
                        require(sum(sizes) == len(encoded)-offset, 'RLE row byte counts disagree', 'invalid-input')
                        for row_size in sizes:
                            end = offset + row_size
                            expanded = 0
                            while offset < end:
                                command = encoded[offset]
                                offset += 1
                                if command < 128:
                                    expanded += command+1
                                    offset += command+1
                                elif command > 128:
                                    expanded += 257-command
                                    offset += 1
                                require(offset <= end and expanded <= layer.shape[1], 'RLE row expansion exceeds bounds', 'invalid-input')
                            require(expanded == layer.shape[1], 'RLE row width mismatch', 'invalid-input')
                    else:
                        raise Refusal('unsupported-input', 'Unsupported Photoshop channel compression')
        stream.seek(pos + size + (4-size % 4) % 4)
    require(found, 'No supported 8-bit layer records')

def decode(root, limits):
    source = root / 'source.tiff'
    with tifffile.TiffFile(source) as t:
        require(len(t.pages) == 1, 'Multipage TIFF is unsupported; export a single RGB raster document')
        p = t.pages[0]
        require(p.photometric == 2 and p.bitspersample == 8 and p.samplesperpixel in (3, 4)
                and p.planarconfig == 1, 'Only contiguous 8-bit RGB/RGBA TIFF is supported')
        require(p.tags.get(274) is None or p.tags[274].value == 1, 'Non-default orientation is unsupported')
        require(not p.extrasamples or all(int(v) == 2 for v in p.extrasamples), 'Associated/unknown alpha is unsupported')
        require(34377 not in p.tags, 'Photoshop image resources require a separate preservation contract')
        profile = p.tags.get(34675)
        require(profile is None or profile.value == imagecodecs.cms_profile('srgb'), 'Only unprofiled or standard sRGB TIFF is supported')
        w, h = p.imagewidth, p.imagelength
        dimensions(w, h, 1, limits)
        envelope = None
        if 700 in p.tags:
            try:
                xml = ET.fromstring(bytes(p.tags[700].value).rstrip(b'\0'))
                entries = xml.findall('.//' + NS)
                nodes = list(xml.iter())
                require(len(entries) == 1 and [node.tag for node in nodes] == [
                    '{adobe:ns:meta/}xmpmeta', '{http://www.w3.org/1999/02/22-rdf-syntax-ns#}RDF',
                    '{http://www.w3.org/1999/02/22-rdf-syntax-ns#}Description', NS]
                    and all(not node.attrib for node in nodes), 'Unknown XMP fields cannot be preserved')
                envelope = json.loads(base64.b64decode(entries[0].text, validate=True))
                require(envelope.get('app') == 'Storyboard Flow' and envelope.get('format') == 'flow-tiff'
                        and envelope.get('rasterVersion') in (1, 2, 3), 'Unsupported Flow TIFF metadata version')
            except Refusal:
                raise
            except Exception as e:
                raise Refusal('invalid-input', f'Malformed Flow XMP: {e}')
        layered = 37724 in p.tags
        if not layered:
            require(envelope is None, 'Flow metadata requires matching raster layer records')
            write_png(root, 0, rgba(p.asarray()), limits)
            return {'kind': 'plain', 'width': w, 'height': h, 'envelope': None, 'layers': [
                {'name': 'Image', 'visible': True, 'locked': False, 'opacity': 1, 'blendMode': 'normal'}]}
    preflight(source, w, h, limits)
    data = TiffImageSourceData.fromtiff(source, unknown=True)
    layers = list(data.layers or [])
    require(0 < len(layers) <= limits['maxLayers'], 'Empty or excessive layer records', 'resource-limit')
    dimensions(w, h, len(layers), limits)
    require(not data.info and data.usermask == PsdUserMask(), 'Document-level Photoshop extras are unsupported')
    result = []
    for i, layer in enumerate(layers):
        require(layer.blendmode in BLENDS.values(), f'Layer {i}: unsupported blend mode {layer.blendmode}')
        require(layer.clipping == PsdClippingType.BASE and not layer.blending_ranges,
                f'Layer {i}: clipping or blending ranges are unsupported')
        require(layer.mask is None or layer.mask == PsdLayerMask(), f'Layer {i}: masks are unsupported')
        require(all(info.key in (PsdKey.UNICODE_LAYER_NAME, PsdKey.LAYER_ID) for info in layer.info),
                f'Layer {i}: groups, effects, text, adjustments or unknown layer tags are unsupported')
        require(not int(layer.flags) & ~int(PsdLayerFlag.VISIBLE | PsdLayerFlag.TRANSPARENCY_PROTECTED | PsdLayerFlag.PHOTOSHOP5),
                f'Layer {i}: unknown layer flags')
        ids = [int(c.channelid) for c in layer.channels]
        require(sorted(ids) in ([0, 1, 2], [-1, 0, 1, 2]), f'Layer {i}: missing, extra or duplicate channels')
        r = layer.rectangle
        require(0 <= r.left <= r.right <= w and 0 <= r.top <= r.bottom <= h,
                f'Layer {i}: off-canvas pixels cannot be preserved')
        dimensions(w, h, len(layers), limits)
        if r.top == r.bottom or r.left == r.right:
            a = np.zeros((h, w, 4), np.uint8)
        else:
            a0 = rgba(layer.asarray())
            require(a0.shape[:2] == (r.bottom-r.top, r.right-r.left), f'Layer {i}: malformed pixel dimensions', 'invalid-input')
            a = np.zeros((h, w, 4), np.uint8)
            a[r.top:r.bottom, r.left:r.right] = a0
        write_png(root, i, a, limits)
        names = [v.value for v in layer.info if v.key == PsdKey.UNICODE_LAYER_NAME]
        require(len(names) <= 1, f'Layer {i}: duplicate Unicode names')
        native_ids = [v.value for v in layer.info if v.key == PsdKey.LAYER_ID]
        require(len(native_ids) <= 1 and all(isinstance(v, int) and 0 < v < 2147483648 for v in native_ids), 'Invalid native layer identity', 'invalid-input')
        result.append({'nativeId': native_ids[0] if native_ids else None, 'name': str(names[0] if names else layer.name),
                       'visible': not bool(layer.flags & PsdLayerFlag.VISIBLE),
                       'locked': bool(layer.flags & PsdLayerFlag.TRANSPARENCY_PROTECTED),
                       'opacity': layer.opacity / 255,
                       'blendMode': next(k for k, v in BLENDS.items() if v == layer.blendmode)})
    native_ids = [l['nativeId'] for l in result if l['nativeId'] is not None]
    require(len(set(native_ids)) == len(native_ids), 'Duplicate native layer identity', 'invalid-input')
    return {'kind': 'layered', 'width': w, 'height': h, 'envelope': envelope, 'layers': result}

def composite(loaded, h, w):
    # Straight-alpha W3C source-over compositing with separable blend functions.
    color = np.zeros((h, w, 3), np.float64)
    alpha = np.zeros((h, w, 1), np.float64)
    for layer, pixels in loaded:
        if not layer['visible']:
            continue
        src = pixels[..., :3].astype(np.float64) / 255
        sa = pixels[..., 3:4].astype(np.float64) / 255 * layer['opacity']
        blend = src if layer['blendMode'] == 'normal' else color * src if layer['blendMode'] == 'multiply' else color + src - color * src
        outa = sa + alpha * (1-sa)
        premult = sa * ((1-alpha)*src + alpha*blend) + (1-sa)*alpha*color
        color = np.divide(premult, outa, out=np.zeros_like(color), where=outa != 0)
        alpha = outa
    return np.round(np.concatenate([color, alpha], axis=2) * 255).clip(0, 255).astype(np.uint8)

def encode(root, manifest, limits):
    image = manifest['image']
    w, h = image['width'], image['height']
    dimensions(w, h, len(image['layers']), limits)
    loaded, records = [], []
    for i, layer in enumerate(image['layers']):
        a = rgba(imagecodecs.imread(root / f'{i}.png'))
        require(a.shape == (h, w, 4), 'PNG dimensions disagree with layer', 'invalid-input')
        loaded.append((layer, a))
        channels = [PsdChannel(channelid=PsdChannelId(c), compression=PsdCompressionType.ZIP_PREDICTED,
                               data=a[..., j]) for c, j in [(0, 0), (1, 1), (2, 2), (-1, 3)]]
        flags = PsdLayerFlag.PHOTOSHOP5
        if not layer['visible']: flags |= PsdLayerFlag.VISIBLE
        if layer['locked']: flags |= PsdLayerFlag.TRANSPARENCY_PROTECTED
        name = layer['name']
        records.append(PsdLayer(name=name.encode('macroman', errors='replace').decode('macroman')[:255],
            rectangle=PsdRectangle(0, 0, h, w), channels=channels, mask=PsdLayerMask(),
            opacity=int(layer['opacity']*255+0.5), blendmode=BLENDS[layer['blendMode']], flags=flags,
            info=[RasterUnicodeName(PsdKey.UNICODE_LAYER_NAME, name), PsdInteger(PsdKey.LAYER_ID, manifest['envelope']['image']['layers'][i]['nativeId'])]))
    data = TiffImageSourceData(name='Storyboard Flow', psdformat=PsdFormat.LE32BIT,
                              layers=PsdLayers(key=PsdKey.LAYER, has_transparency=True, layers=records), usermask=PsdUserMask(), info=[])
    encoded = base64.b64encode(json.dumps(manifest['envelope'], ensure_ascii=False, separators=(',', ':')).encode()).decode()
    xmp = f'<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:flow="https://storyboard-flow.local/ns/1.0/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description><flow:metadata>{encoded}</flow:metadata></rdf:Description></rdf:RDF></x:xmpmeta>'
    tifffile.imwrite(root / 'output.tiff', composite(loaded, h, w), photometric='rgb', extrasamples=['unassalpha'],
                     compression='adobe_deflate', metadata=None, extratags=[data.tifftag(maxworkers=1), (700, 1, None, xmp.encode(), True)])
    require((root / 'output.tiff').stat().st_size <= limits['maxTiffBytes'], 'Encoded TIFF exceeds limit', 'resource-limit')
    return {}

def main():
    root = Path(sys.argv[2])
    request = json.loads((root / 'request.json').read_text())
    try:
        result = decode(root, request['limits']) if sys.argv[1] == 'decode' else encode(root, request, request['limits'])
        response = {'ok': True, 'value': result}
    except Refusal as e:
        response = {'ok': False, 'error': {'code': e.code, 'message': str(e)}}
    except Exception as e:
        response = {'ok': False, 'error': {'code': 'invalid-input', 'message': f'TIFF codec refused input: {type(e).__name__}: {e}'}}
    (root / 'response.json').write_text(json.dumps(response, ensure_ascii=False))

if __name__ == '__main__':
    main()
