#!/usr/bin/env python3
"""Native serial baseline. Synthetic media only; no Electron/screen latency claim."""
import argparse,hashlib,json,math,os,pathlib,resource,statistics,sys,tempfile,time
from host_process import Client

def stats(values):
    ordered=sorted(values)
    def q(f):return ordered[min(len(ordered)-1,max(0,math.ceil(len(ordered)*f)-1))]
    return {'count':len(values),'p50Ms':statistics.median(values),'p95Ms':q(.95),'p99Ms':q(.99),'maxMs':max(values)}

def install_frame(pixels,header,payload):
    for tile in header['tiles']:
        x,y,w,h,offset,length=(tile[k] for k in ('x','y','w','h','offset','length'))
        assert length==w*h*4 and offset+length<=len(payload),tile
        for row in range(h):
            dst=((y+row)*header['width']+x)*4;src=offset+row*w*4
            pixels[dst:dst+w*4]=payload[src:src+w*4]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('binary');parser.add_argument('--size',type=int,choices=[2048,4096],default=2048);parser.add_argument('--strokes',type=int,default=40);parser.add_argument('--diagnose-each',action='store_true');parser.add_argument('--io-delay-ms',type=int,default=0);args=parser.parse_args()
    assert 2<=args.strokes<=200
    os.environ['FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS']=str(args.io_delay_ms)
    root=pathlib.Path(tempfile.mkdtemp(prefix='flow-native-continuous-'));c=Client(args.binary,root/'store')
    setup=time.perf_counter();prepared,_=c.call('new',{'kind':'new','width':args.size,'height':args.size});c.accept('new',prepared)
    prepared,_=c.call('fill',{'kind':'edit','edit':{'kind':'fill','color':'#778899'}});c.accept('fill',prepared)
    initial,frame=c.capture();pixels=bytearray(initial);setup_ms=(time.perf_counter()-setup)*1000
    begin_times=[];append_times=[];prepare_times=[];accept_times=[];gaps=[];end_to_durable=[];events=[];last_frame_at=None;erasers=0
    for i in range(args.strokes):
        preview=f'p{i}';y=200+(i%5)*3;erase=i%4==3;erasers+=erase
        brush={'size':24,'opacity':.5,'flow':1,'seed':i+1,'erase':erase,'color':'#ee2244' if i%2==0 else '#2255ee'}
        start=time.perf_counter();shown,payload=c.call('begin'+str(i),{'kind':'strokeBegin','previewId':preview,'brush':brush,'points':[{'x':200,'y':y,'pressure':1}]});now=time.perf_counter();begin_times.append((now-start)*1000)
        assert shown['kind']=='frame',shown
        if last_frame_at is not None:gaps.append((now-last_frame_at)*1000)
        last_frame_at=now;install_frame(pixels,shown['frame'],payload)
        for seq,x in enumerate([240,280,320,280,240,200],2):
            start=time.perf_counter();shown,payload=c.call(f'append{i}-{seq}',{'kind':'strokeAppend','previewId':preview,'fromSeq':seq,'points':[{'x':x,'y':y,'pressure':.75}]});now=time.perf_counter();append_times.append((now-start)*1000);gaps.append((now-last_frame_at)*1000);last_frame_at=now
            assert shown['kind']=='frame',shown;install_frame(pixels,shown['frame'],payload)
        end=time.perf_counter();prepared,_=c.call('finish'+str(i),{'kind':'strokeFinish','previewId':preview,'throughSeq':7});prepare_times.append((time.perf_counter()-end)*1000);assert prepared['kind']=='prepared' and prepared['fromLive'] is True,prepared
        start=time.perf_counter();c.accept('finish'+str(i),prepared);accept_times.append((time.perf_counter()-start)*1000);end_to_durable.append((time.perf_counter()-end)*1000)
        if args.diagnose_each:
            committed,_=c.capture()
            if pixels!=committed:
                differences=[n for n,(a,b) in enumerate(zip(pixels,committed)) if a!=b]
                failure={'evidence':str(root),'stroke':i,'erase':erase,'differentBytes':len(differences),'firstDifferences':[{'offset':n,'preview':pixels[n],'committed':committed[n]} for n in differences[:20]]}
                (root/'failure.json').write_text(json.dumps(failure,indent=2));(root/'preview.rgba').write_bytes(pixels);(root/'committed.rgba').write_bytes(committed);c.close();raise AssertionError(failure)
        events.append({'stroke':i,'erase':erase,'preparedVersion':prepared['receipt']['versionId'],'newObjectBytes':prepared['receipt']['newObjectBytes']})
    final,frame=c.capture()
    if pixels!=final:
        (root/'preview.rgba').write_bytes(pixels);(root/'committed.rgba').write_bytes(final);(root/'failure.json').write_text(json.dumps({'evidence':str(root),'error':'incremental preview != committed capture'}));c.close();raise AssertionError(str(root))
    assert pixels!=initial,'overlapping brush/eraser scene must change'
    c.close();rss=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    result={'scope':'actual native subprocess only; serial baseline; excludes Main/renderer/screen/physical input','size':[args.size,args.size],'strokes':args.strokes,'eraserStrokes':erasers,'injectedDelayPerIoPublicationOrJournalMs':args.io_delay_ms,'setupMs':setup_ms,'beginToPreview':stats(begin_times),'appendToPreview':stats(append_times),'endToDurablePrepared':stats(prepare_times),'explicitAcceptToDurable':stats(accept_times),'endToDurableAccepted':stats(end_to_durable),'frameResponseGapIncludingPersistence':stats(gaps),'peakPendingCompletedStrokes':1,'crossStrokeInflight':False,'peakNativeChildResidentBytes':rss if sys.platform=='darwin' else rss*1024,'previewCommitByteEqual':True,'finalRgbaSha256':hashlib.sha256(final).hexdigest(),'events':events}
    (root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps({'evidence':str(root),'result':result}))
if __name__=='__main__':main()
