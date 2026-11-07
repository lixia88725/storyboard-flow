#!/usr/bin/env python3
"""Actual subprocess check of the old synchronous reader/flush admission obstruction."""
import argparse,hashlib,json,os,pathlib,tempfile,time
from host_process import Client
from host_bench import sample
p=argparse.ArgumentParser();p.add_argument('binary');p.add_argument('--io-delay-ms',type=int,default=0);args=p.parse_args()
os.environ['FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS']=str(args.io_delay_ms)
root=pathlib.Path(tempfile.mkdtemp(prefix='flow-native-blocking-'));src=sample(2048,2048)
c=Client(args.binary,root/'store');prepared,_=c.call('open',{'kind':'open','source':{'digest':hashlib.sha256(src).hexdigest(),'byteLength':len(src),'formatHint':'png'}},src);c.accept('open',prepared);c.capture()
c.call('begin',{'kind':'strokeBegin','previewId':'p1','brush':{'size':14,'opacity':.5,'seed':9},'points':[{'x':100,'y':100}]})
c.call('append',{'kind':'strokeAppend','previewId':'p1','fromSeq':2,'points':[{'x':200,'y':100}]})
end=time.perf_counter();c.send('finish',{'kind':'strokeFinish','previewId':'p1','throughSeq':2})
next_sent=time.perf_counter();c.send('nextBegin',{'kind':'strokeBegin','previewId':'p2','brush':{'size':14,'opacity':.5},'points':[{'x':100,'y':110}]})
a,_=c.read();end_to_prepared=(time.perf_counter()-end)*1000;assert a['operationId']=='finish' and a['body']['kind']=='prepared',a
b,_=c.read();input_dispatch=(time.perf_counter()-next_sent)*1000;assert b['operationId']=='nextBegin' and b['body']['kind']=='failure' and b['body']['error']['code']=='busy',b
c.accept('finish',a['body']);c.close()
result={'scope':'native subprocess request dispatch; rejected next input is not admitted preview','canvas':[2048,2048],'injectedIoDelayMs':args.io_delay_ms,'endToDurablePreparedMs':end_to_prepared,'nextBeginResponseDelayMs':input_dispatch,'nextBeginResult':b['body']}
(root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps({'evidence':str(root),'result':result}))
