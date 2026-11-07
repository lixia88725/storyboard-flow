#!/usr/bin/env python3
"""Real opt-in pipeline subprocess, bounded input, durable Main-surrogate FIFO decisions.
Main-surrogate records are synthetic test evidence, not Flow integration certification.
"""
import argparse,hashlib,json,os,pathlib,resource,sys,tempfile,time
from host_process import Client
from host_continuous_bench import stats,install_frame

def main():
 p=argparse.ArgumentParser();p.add_argument('binary');p.add_argument('--size',type=int,choices=[2048,4096],default=2048);p.add_argument('--strokes',type=int,default=40);p.add_argument('--sample-gap-ms',type=float,default=0);p.add_argument('--io-delay-ms',type=int,default=0);args=p.parse_args()
 os.environ['FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS']=str(args.io_delay_ms)
 root=pathlib.Path(tempfile.mkdtemp(prefix='flow-native-pipeline-'));c=Client(args.binary,root/'store',record=False)
 prepared,_=c.call('new',{'kind':'new','width':args.size,'height':args.size});c.accept('new',prepared)
 prepared,_=c.call('fill',{'kind':'edit','edit':{'kind':'fill','color':'#778899'}});initial_version=c.accept('fill',prepared)
 started,_=c.call('start',{'kind':'pipelineStart','maxPendingStrokes':4,'maxPendingPoints':65536,'maxRetainedPixelBytes':256<<20});assert started['kind']=='pipelineReady',started
 pipeline=started['pipelineId'];anchor=started['anchorVersion'];assert anchor==initial_version
 initial,frame=c.capture();pixels=bytearray(initial);entries={};order=[];native_base=anchor;project_base=anchor;last=None;last_frame=None
 begin_times=[];append_times=[];queue_times=[];prepare_times=[];accept_times=[];end_accepted=[];gaps=[];budget_waits=[];queue_peak=0;pixel_peak=0;point_peak=0;backpressure=0;cross_stroke=0;poll_seq=0;events_log=[]
 decisions=open(root/'main-surrogate-cas.jsonl','ab',buffering=0)
 def pump():
  nonlocal native_base,project_base,poll_seq,queue_peak,pixel_peak,point_peak
  poll_seq+=1;state,_=c.call('poll'+str(poll_seq),{'kind':'pipelinePoll','pipelineId':pipeline});assert state['kind']=='pipelineState',state;assert state['blocked'] is None,state
  queue_peak=max(queue_peak,state['queueDepth']);pixel_peak=max(pixel_peak,state['retainedPixelBytes']);point_peak=max(point_peak,state['pendingPoints'])
  for event in state['events']:
   now=time.perf_counter();op=event['operationId'];body=event['result'];assert op in entries,(op,entries);e=entries[op];events_log.append(event)
   if body['kind']=='prepared':
    assert 'prepared' not in e,(op,body);e['prepared']=body;prepare_times.append((now-e['end'])*1000)
   elif body['kind']=='accepted':
    assert e.get('accept_sent') and not e.get('accepted'),(op,body);e['accepted']=body;native_base=body['receipt']['versionId'];accept_times.append((now-e['accept_sent'])*1000);end_accepted.append((now-e['end'])*1000)
   else:raise AssertionError(event)
  for op in order:
   e=entries[op]
   if e.get('accepted'):continue
   if e.get('prepared') and not e.get('accept_sent'):
    prepared=e['prepared'];assert prepared['baseVersion']==project_base,(prepared,project_base)
    # Simulate an explicit Main project CAS with a real fsynced synthetic journal before accept.
    record={'operationId':op,'expectedVersion':project_base,'versionId':prepared['receipt']['versionId']}
    decisions.write((json.dumps(record)+'\n').encode());os.fsync(decisions.fileno());project_base=record['versionId']
    c.base=native_base;accepted,_=c.call('accept-'+op,{'kind':'accept','candidateId':op});c.base=anchor;assert accepted['kind']=='acceptQueued' and accepted['durable'] is False,accepted;e['accept_sent']=time.perf_counter()
   break
  return state
 for i in range(args.strokes):
  preview=f'p{i}';y=200+(i%5)*3;brush={'size':24,'opacity':.5,'flow':1,'seed':i+1,'erase':i%4==3,'color':'#ee2244' if i%2==0 else '#2255ee'}
  waiting=time.perf_counter()
  while True:
   start=time.perf_counter();shown,payload=c.call('begin'+str(i),{'kind':'strokeBegin','previewId':preview,'predecessorOperationId':last,'brush':brush,'points':[{'x':200,'y':y,'pressure':1}]});now=time.perf_counter()
   if shown['kind']=='frame':break
   assert shown['kind']=='failure' and shown['error']['code']=='backpressure',shown;backpressure+=1;pump();time.sleep(.001)
  budget_waits.append((start-waiting)*1000);begin_times.append((now-start)*1000)
  if any(not entries[op].get('accepted') for op in order):cross_stroke+=1
  if last_frame is not None:gaps.append((now-last_frame)*1000)
  last_frame=now;install_frame(pixels,shown['frame'],payload)
  for seq,x in enumerate([240,280,320,280,240,200],2):
   if args.sample_gap_ms:time.sleep(args.sample_gap_ms/1000)
   start=time.perf_counter();shown,payload=c.call(f'append{i}-{seq}',{'kind':'strokeAppend','previewId':preview,'fromSeq':seq,'points':[{'x':x,'y':y,'pressure':.75}]});now=time.perf_counter();append_times.append((now-start)*1000);gaps.append((now-last_frame)*1000);last_frame=now
   assert shown['kind']=='frame',shown;install_frame(pixels,shown['frame'],payload)
   if args.sample_gap_ms:pump()
  op='finish'+str(i);end=time.perf_counter();queued,_=c.call(op,{'kind':'strokeFinish','previewId':preview,'throughSeq':7});queue_times.append((time.perf_counter()-end)*1000);assert queued['kind']=='queued' and queued['durable'] is False,queued
  entries[op]={'end':end,'queued':queued};order.append(op);last=op;queue_peak=max(queue_peak,queued['queueDepth']);pump()
 deadline=time.monotonic()+max(30,args.strokes*args.io_delay_ms*.02)
 while any(not entries[op].get('accepted') for op in order):
  pump();assert time.monotonic()<deadline,'native obligations did not settle';time.sleep(.001)
 pump();final,frame=c.capture();assert final==pixels,'absolute delta chain != durable committed capture'
 # Lost ACK remains queryable even after poll frees an admission slot; duplicate accept is terminal.
 status,_=c.call('query-last',{'kind':'status','targetOperationId':last});assert status['state']=='accepted',status
 duplicate,_=c.call('accept-again',{'kind':'accept','candidateId':last});assert duplicate['kind']=='accepted',duplicate
 stopped,_=c.call('stop',{'kind':'pipelineStop','pipelineId':pipeline});assert stopped['kind']=='pipelineStopped',stopped;c.base=native_base
 c.close();decisions.close();rss=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
 result={'scope':'real native subprocess; explicit fsynced synthetic Main-surrogate CAS; excludes real Main/renderer/screen/physical pen','canvas':[args.size,args.size],'strokes':args.strokes,'eraserStrokes':args.strokes//4,'ioDelayPerPublicationOrJournalMs':args.io_delay_ms,'requestedSampleGapMs':args.sample_gap_ms,'scene':'24px brush, 50% opacity, 6 reversal appends per stroke, 25% eraser, uniform 2K/4K background','beginToPreview':stats(begin_times),'appendToPreview':stats(append_times),'endToVolatileQueued':stats(queue_times),'endToDurablePrepared':stats(prepare_times),'explicitAcceptToDurable':stats(accept_times),'endToDurableAccepted':stats(end_accepted),'frameGapIncludingBudgetBackpressure':stats(gaps),'budgetWaitBeforeAdmission':stats(budget_waits),'backpressureRejections':backpressure,'crossStrokeInflightBegins':cross_stroke,'queuePeak':queue_peak,'pendingPointsPeak':point_peak,'retainedPixelBytesPeak':pixel_peak,'peakNativeChildResidentBytes':rss if sys.platform=='darwin' else rss*1024,'finalRgbaSha256':hashlib.sha256(final).hexdigest(),'previewCommitByteEqual':True,'operationCount':len(entries),'durableAcceptedCount':sum(bool(e.get('accepted')) for e in entries.values()),'finalVersion':native_base}
 (root/'result.json').write_text(json.dumps(result,indent=2));(root/'events.json').write_text(json.dumps(events_log,indent=2));print(json.dumps({'evidence':str(root),'result':result}))
if __name__=='__main__':main()
