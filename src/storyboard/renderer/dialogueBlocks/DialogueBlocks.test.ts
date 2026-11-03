import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {DialogueBlocks} from './DialogueBlocks';
const base={shotId:'a',dialogues:[{id:'d1',shotId:'a',text:'第一段'}],onCommit:()=>{}};
const render=(props:Record<string,unknown>={})=>renderToStaticMarkup(createElement(DialogueBlocks,{...base,...props} as never));
describe('dialogue block captions',()=>{
 it('labels the full editor so the host needs no separate caption beside its other field',()=>{
  const html=render();
  expect(html).toContain('class="flow-dialogue-heading"');
  expect(html).toContain('台词');
 });
 it('keeps the caption out of the compact letterbox overlay',()=>{
  expect(render({variant:'compact'})).not.toContain('flow-dialogue-heading');
 });
 it('keeps one caption above every row of a multi-block board',()=>{
  const html=render({dialogues:[{id:'d1',shotId:'a',text:'第一段'},{id:'d2',shotId:'a',text:'第二段'}]});
  expect(html.match(/flow-dialogue-heading/g)).toHaveLength(1);
  expect(html.match(/data-block-id=/g)).toHaveLength(2);
 });
 it('renders no drag handle and accepts no drops by default',()=>{
  const html=render();
  expect(html).not.toContain('flow-dialogue-handle');
  expect(html).toContain('data-allow-drag="false"');
  // Nothing in the default markup is draggable, so no drag source exists to drop here.
  expect(html).not.toContain('draggable="true"');
 });
 it('renders one named, focusable six-dot grip per row when dragging is allowed',()=>{
  const html=render({allowDrag:true,dialogues:[{id:'d1',shotId:'a',text:'第一段'},{id:'d2',shotId:'a',text:'第二段'}]});
  expect(html).toContain('data-allow-drag="true"');
  expect(html.match(/class="flow-dialogue-handle"/g)).toHaveLength(2);
  expect(html.match(/aria-label="Drag dialogue d[12]"/g)).toHaveLength(2);
  expect(html.match(/<button type="button" class="flow-dialogue-handle"/g)).toHaveLength(2);
  // The grip is decorative; the button carries the accessible name and stays keyboard reachable.
  expect(html).toContain('class="flow-dialogue-grip"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain('tabindex="-1"');
  expect(html.match(/draggable="true"/g)).toHaveLength(2);
  // Six dots belong to each grip, not to the board as a whole.
  const grips=html.split('flow-dialogue-handle').slice(1);
  for(const grip of grips)expect(grip.split('<circle ').length-1).toBe(6);
 });
 it('keeps the grip out of the compact overlay unless dragging is allowed',()=>{
  expect(render({variant:'compact'})).not.toContain('flow-dialogue-handle');
  expect(render({variant:'compact',allowDrag:true})).toContain('flow-dialogue-handle');
 });
 it('offers no draggable grip for a blank row or a disabled board',()=>{
  const blank=render({allowDrag:true,dialogues:[{id:'d1',shotId:'a',text:''}]});
  expect(blank).toContain('flow-dialogue-handle');
  expect(blank).toContain('draggable="false"');
  const off=render({allowDrag:true,disabled:true});
  expect(off).toMatch(/class="flow-dialogue-handle"[^>]*disabled=""/);
  expect(off).toContain('draggable="false"');
 });
 });
