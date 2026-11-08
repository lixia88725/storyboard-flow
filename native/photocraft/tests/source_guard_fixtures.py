#!/usr/bin/env python3
"""Own synthetic sources only; no installation or user-media access."""
import pathlib,sys,numpy as np,tifffile
from host_output_process import fixture
root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
white=np.full((12,16,4),255,np.uint8)
tifffile.imwrite(root/'flat.tiff',white,photometric='rgb',extrasamples=['unassalpha'],metadata=None)
tifffile.imwrite(root/'bad-icc.tiff',white,photometric='rgb',extrasamples=['unassalpha'],metadata=None,extratags=[(34675,7,None,b'invalid-ICC',True)])
tifffile.imwrite(root/'cmyk-no-icc.tiff',np.zeros((12,16,4),np.uint8),photometric='separated',metadata=None)
original,_=fixture(with_opaque=False);(root/'matching.psd').write_bytes(original)
small=bytearray(original);small[-8*4*4+4]=max(0,small[-8*4*4+4]-4);(root/'small-difference.psd').write_bytes(small)
changed=bytearray(original);changed[-8*4*4:-8*4*3]=b'\x00'*(8*4);(root/'stale-merged.psd').write_bytes(changed)
