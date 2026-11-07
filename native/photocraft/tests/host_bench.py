#!/usr/bin/env python3
"""Synthetic native-only latency sample; excludes Electron, actual screen and physical input."""
import argparse,json,pathlib,statistics,struct,tempfile,time,zlib
from host_process import Client

def sample(w,h):
    raw=bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):raw.extend(((x+y)&255,((x//256)*17+y*3)&255,((x^y)>>3)&255,255))
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
def stats(values):
    values=sorted(values)
    return {'p50Ms':statistics.median(values),'p95Ms':values[min(len(values)-1,int(len(values)*.95))],'maxMs':max(values)}
def main():
    p=argparse.ArgumentParser();p.add_argument('binary');p.add_argument('--strokes',type=int,default=20);p.add_argument('--profile',choices=['debug','release'],default='debug');args=p.parse_args()
    root=pathlib.Path(tempfile.mkdtemp(prefix='flow-native-bench-'));src=sample(2048,2048)
    import hashlib
    client=Client(args.binary,root/'store');start=time.perf_counter()
    prepared,_=client.call('open',{'kind':'open','source':{'digest':hashlib.sha256(src).hexdigest(),'byteLength':len(src),'formatHint':'png'}},src)
    client.accept('open',prepared);open_ms=(time.perf_counter()-start)*1000
    client.capture();preview=[];prepare=[];accept=[];delta_bytes=[];new_objects=[]
    for i in range(args.strokes):
        y=100+i*25;preview_id=f'p{i}'
        start=time.perf_counter();frame,payload=client.call('begin'+str(i),{'kind':'strokeBegin','previewId':preview_id,'brush':{'size':14,'opacity':.5,'seed':i+1,'color':'#ff0000'},'points':[{'x':100,'y':y,'pressure':1}]});preview.append((time.perf_counter()-start)*1000)
        assert frame['kind']=='frame',frame;delta_bytes.append(len(payload))
        frame,_=client.call('append'+str(i),{'kind':'strokeAppend','previewId':preview_id,'fromSeq':2,'points':[{'x':200,'y':y,'pressure':1}]});assert frame['kind']=='frame',frame
        start=time.perf_counter();prepared,_=client.call('stroke'+str(i),{'kind':'strokeFinish','previewId':preview_id,'throughSeq':2});prepare.append((time.perf_counter()-start)*1000);assert prepared['kind']=='prepared',prepared
        new_objects.append(prepared['receipt']['newObjectBytes']);start=time.perf_counter();client.accept('stroke'+str(i),prepared);accept.append((time.perf_counter()-start)*1000)
        # Exact live adoption promotes the display baseline; the next stroke remains a delta.
        assert frame['frame']['baseFrameSeq'] is not None
    client.close();result={'scope':f'native subprocess only; {args.profile} profile; excludes Electron/screen/physical input','canvas':[2048,2048],'sourceBytes':len(src),'strokes':args.strokes,'openPrepareAcceptMs':open_ms,'previewRoundTrip':stats(preview),'durablePrepare':stats(prepare),'accept':stats(accept),'deltaPayloadBytes':delta_bytes,'newObjectBytes':new_objects}
    (root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps({'evidence':str(root),'result':result}))
if __name__=='__main__':main()
