"""Independent psd-tools/Pillow oracle for a synthetic export and expected PNG.
The caller supplies a task-local oracle directory; no module install occurs here.
"""
import os,sys,json,hashlib
from pathlib import Path
sys.path.insert(0,os.environ['FLOW_PSD_ORACLE_DIR'])
from psd_tools import PSDImage
from PIL import Image
import numpy as np
source,target,expected,*extra=sys.argv[1:]
a,b=PSDImage.open(source),PSDImage.open(target)
x=a._record.layer_and_mask_information.layer_info
y=b._record.layer_and_mask_information.layer_info
n=len(x.layer_records)
assert len(y.layer_records)>n
for i in range(n):
 assert x.layer_records[i].tobytes()==y.layer_records[i].tobytes(),('source record changed',i)
 assert x.channel_image_data[i].tobytes()==y.channel_image_data[i].tobytes(),('source channel bytes changed',i)
for resource in a.image_resources:
 if int(resource)not in [1033,1036,1057]:assert a.image_resources[resource].tobytes()==b.image_resources[resource].tobytes(),('resource changed',resource)
assert [l.name for l in list(a)]==[l.name for l in list(b)[:len(a)]]
assert [l.kind for l in a.descendants()]==[l.kind for l in list(b.descendants())[:len(list(a.descendants()))]]
assert any(b'zFlw'in layer.tagged_blocks for layer in b.descendants()),'unknown group block missing'
reference=np.array(Image.open(expected).convert('RGBA'),dtype=np.int16)
merged=np.array(b.topil().convert('RGBA'),dtype=np.int16)
composed=np.array(b.composite(force=True,ignore_preview=True).convert('RGBA'),dtype=np.int16)
assert merged.shape==reference.shape==composed.shape
merged_delta=int(abs(merged-reference).max());composed_delta=int(abs(composed-reference).max())
assert merged_delta<=1,('merged preview differs',merged_delta)
assert composed_delta<=2,('independently recomposed layers differ',composed_delta)
assert a.image_resources[1036].tobytes()!=b.image_resources[1036].tobytes(),'stale thumbnail'
if extra:
 specs=json.loads(Path(extra[0]).read_text())
 added=list(b)[len(a):]
 assert len(added)==len(specs)
 modes={'normal':b'norm','multiply':b'mul ','screen':b'scrn'}
 for layer,spec in zip(added,specs):
  assert layer.name==spec['name'] and layer.kind=='pixel'
  assert layer.opacity==int(spec['opacity']*255+0.5) and layer.visible==spec['visible']
  assert layer.blend_mode.value==modes[spec['blendMode']]
  actual=np.array(layer.topil(apply_icc=False).convert('RGBA'),dtype=np.int16)
  expected_layer=np.array(Image.open(spec['png']).convert('RGBA'),dtype=np.int16)
  assert int(abs(actual-expected_layer).max())==0,('new layer raw pixels changed',spec['name'])
print(json.dumps({'passed':True,'reader':'psd-tools','source_layer_records':n,'export_layer_records':len(y.layer_records),'merged_max_delta':merged_delta,'independent_recompose_max_delta':composed_delta,'unknown_block_preserved':True,'thumbnail_updated':True,'layers':[{'name':l.name,'kind':l.kind,'opacity':l.opacity,'visible':l.visible,'blend':str(l.blend_mode)}for l in b.descendants()]},ensure_ascii=False))
