import {useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import type {Shot} from '../../shared/types';
import {CanvasPresentationContext, PresentationPreview} from '../canvasPresentation';
import {useMediaSource} from '../mediaSource';
import {canvasSizeForShot, cssBlendMode} from '../sketchRendering';

/** Temporary inspection state. Only the supplied canvas can issue editing commands. */
export function FlowInspection({shots, initialId, revision, canNavigate, renderCanvas, onClose, issue}: {
  shots: Shot[]; initialId?: string; revision: number; issue?: string;
  canNavigate: () => boolean;
  renderCanvas: (shot: Shot, previous?: Shot, next?: Shot) => ReactNode;
  onClose: (id?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState(initialId);
  const [playing, setPlaying] = useState(false);
  const [onion, setOnion] = useState(false);
  const [fps, setFps] = useState(2);
  const [ready, setReady] = useState('');
  const [error, setError] = useState('');
  const index = Math.max(0, shots.findIndex(s => s.id === id));
  const shot = shots[index];
  const token = `${shot?.id}/${revision}`;
  const presentation = useContext(CanvasPresentationContext)[shot?.id ?? ''];
  const size = shot ? canvasSizeForShot(shot) : {width: 1, height: 1};
  const ratio = size.width / (size.height + (presentation?.mode === 'expanded' ? 150 : 0));
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const pause = () => setPlaying(false);
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', pause);
    return () => {window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', pause);};
  }, []);
  useEffect(() => {
    if (!playing || ready !== token || !shot) return;
    const timer = window.setTimeout(() => {
      if (index + 1 < shots.length) setId(shots[index + 1].id);
      else setPlaying(false);
    }, 1000 / fps);
    return () => window.clearTimeout(timer);
  }, [playing, ready, token, index, shots, fps]);
  const change = (action: () => void) => {if (canNavigate()) {setError(''); action();} else setError('Finish the current edit first');};
  const close = () => change(() => {setPlaying(false); onClose(shot?.id);});
  const step = (offset: number) => change(() => {
    setPlaying(false); setId(shots[Math.max(0, Math.min(shots.length - 1, index + offset))]?.id);
  });
  return <dialog ref={dialog} className="flow-inspection" aria-label="Storyboard inspection"
    onCancel={e => {e.preventDefault(); close();}}
    onKeyDown={e => {
      // Keep the editor's global Undo shortcuts from changing images during playback.
      if (playing && (e.metaKey || e.ctrlKey)) e.stopPropagation();
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1);}
    }}>
    <header>
      <button onClick={close}>Back to board</button>
      <button disabled={!index} onClick={() => step(-1)}>Previous</button>
      <button disabled={!shot || index === shots.length - 1} onClick={() => step(1)}>Next</button>
      <button disabled={!shot} onClick={() => change(() => {
        if (!playing) {setReady(''); if (index === shots.length - 1) setId(shots[0].id);}
        setPlaying(!playing);
      })}>{playing ? 'Pause' : 'Play'}</button>
      <label>Inspection speed <select aria-label="Inspection speed" value={fps} onChange={e => setFps(Number(e.target.value))}>
        {[1,2,4,8,12].map(n => <option key={n} value={n}>{n} images/s</option>)}
      </select></label>
      <button disabled={playing} aria-pressed={onion} onClick={() => change(() => setOnion(!onion))}>Onion skin</button>
      <span aria-label="Inspection position">{shot ? index + 1 : 0} / {shots.length}</span>
    </header>
    <p role="status">{error || issue || (playing ? (ready === token ? 'Playing' : 'Loading image…') : 'Paused — onion skin is a drawing reference only')}</p>
    {shot && <div className="flow-inspection-frame" data-inspection-shot={shot.id} data-playing={playing} style={{width:`min(100%, calc((100vh - 220px) * ${ratio}))`}}>
      {playing ? <InspectionImage key={token} shot={shot} onReady={() => setReady(token)} onError={() => {setPlaying(false); setError('Image could not be displayed; playback paused');}} />
        : renderCanvas(shot, onion ? shots[index - 1] : undefined, onion ? shots[index + 1] : undefined)}
    </div>}
    <input aria-label="Inspection position" type="range" min={0} max={Math.max(0,shots.length - 1)} value={index} disabled={!shots.length}
      onChange={e => {const next=Number(e.target.value); change(() => {setPlaying(false);setId(shots[next].id);});}} />
  </dialog>;
}

/** Decode visible layers before starting this frame's dwell; no flattening or disk writes. */
function InspectionImage({shot, onReady, onError}: {shot:Shot; onReady:()=>void; onError:()=>void}) {
  const media=useMediaSource(), size=canvasSizeForShot(shot);
  const layers=(shot.layers ?? []).filter(l => l.visible);
  const sources=layers.map(l => media.layerAssetUrl({folderPath:'flow',bitmapPath:l.bitmapPath,revision:0}));
  const signature=JSON.stringify(sources);
  const [decoded,setDecoded]=useState('');
  const callbacks=useRef({onReady,onError}); callbacks.current={onReady,onError};
  useEffect(() => {
    let cancelled=false;
    if(sources.some(s=>!s))return;
    const images=sources.map(src=>{const image=new Image(); image.src=src; return image;});
    void Promise.all(images.map(image=>image.decode())).then(()=>{if(!cancelled){setDecoded(signature);callbacks.current.onReady();}},()=>{if(!cancelled)callbacks.current.onError();});
    return ()=>{cancelled=true;};
  },[signature]);
  return <PresentationPreview shotId={shot.id} width={size.width} height={size.height}>
    <div className="flow-inspection-image" style={{aspectRatio:`${size.width}/${size.height}`,visibility:decoded===signature?'visible':'hidden'}}>
      {layers.map((layer,i)=><img key={layer.id} src={sources[i] || undefined} alt="" draggable={false} style={{opacity:layer.opacity,mixBlendMode:cssBlendMode(layer.blendMode)}}/>)}
    </div>
  </PresentationPreview>;
}
