import test from 'node:test';
import assert from 'node:assert/strict';
import {localSamplePlayer, mountMicTest} from '../public/mic-test.js';
import {microphoneReadings, monitorMicrophone} from '../public/mic-test-level.js';
import {limitingCurve} from '../public/voice-playback.js';

const wave = amplitude => Float32Array.from({length:2048},(_,i)=>amplitude*Math.sin(2*Math.PI*i/96));

test('la medición usa RMS temporal y distingue silencio, voz baja, nivel alto y saturación de entrada',()=>{
  function sample(amp,raw) {
    const result=microphoneReadings();
    let level;
    for(let i=0;i<3;i++) level=result.add(wave(amp),raw);
    for(let i=0;i<30;i++) result.add(wave(0));
    return {level,summary:result.summary()};
  }
  assert.equal(microphoneReadings().summary(),'');
  assert.match(sample(0).summary,/silencio/);
  assert.match(sample(0.01).summary,/débil/);
  assert.ok(Math.abs(sample(0.1).level - (-23.01)) < 0.04);
  assert.match(sample(0.1).summary,/−?\-23 dBFS/);
  assert.match(sample(0.6).summary,/nivel es alto/);
  assert.match(sample(0.4,wave(1)).summary,/entrada alcanza su límite/);
  const isolated=wave(0.1);isolated[20]=1;
  assert.doesNotMatch(sample(0.1,isolated).summary,/límite/);
});

function mockMedia(t) {
  const elements=[],contexts=[];
  class Element extends EventTarget {
    constructor(tag){super();this.tag=tag;this._volume=1;this.playCount=0;}
    set volume(v){assert.ok(v>=0 && v<=1,'HTMLMediaElement.volume admite 0..1');this._volume=v;}
    get volume(){return this._volume;}
    async setSinkId(id){this.sink=id;}
    async play(){this.playCount++;}
    pause(){this.paused=true;}
    load(){}
    setAttribute(){}
    removeAttribute(){}
    replaceChildren(...children){this.children=children;}
  }
  function node() {
    return {connect(next){this.next=next;return next;},disconnect(){this.disconnected=true;}};
  }
  class Context {
    constructor(){this.sampleRate=48000;this.state='running';contexts.push(this);}
    async close(){this.state='closed';}
    async resume(){this.state='running';}
    createMediaElementSource(source){this.source=Object.assign(node(),{element:source});return this.source;}
    createMediaStreamSource(stream){return Object.assign(node(),{stream});}
    createGain(){this.gain=Object.assign(node(),{gain:{value:1}});return this.gain;}
    createWaveShaper(){this.limiter=node();return this.limiter;}
    createAnalyser(){return Object.assign(node(),{getFloatTimeDomainData(samples){samples.fill(0.1);}});}
    createMediaStreamDestination(){
      this.track={stop(){this.stopped=true;}};
      this.dest={stream:{getTracks:()=>[this.track]}};
      return this.dest;
    }
  }
  const doc=new EventTarget();
  doc.createElement=tag=>{const element=new Element(tag);elements.push(element);return element;};
  doc.getElementById=()=>null;
  t.mock.method(globalThis,'setInterval',()=>123);
  t.mock.method(globalThis,'clearInterval',()=>{});
  const original=Object.fromEntries(['AudioContext','document','window','MediaRecorder'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries({AudioContext:Context,document:doc,window:new EventTarget()}))
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  t.after(()=>{for(const [key,descriptor] of Object.entries(original)) {
    if(descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }});
  return {elements,contexts,doc,Context};
}

test('reproduce 0–100 % directamente y 200 % con el mismo limitador de voz y una sola salida seleccionada',async t=>{
  const {elements,contexts}=mockMedia(t);
  for(const [setting,expected] of [[-1,0],[0,0],[0.7,0.7],[1,1]]) {
    const p=localSamplePlayer('blob:sample',{listenVolume:setting,outputId:'usb'},()=>{},()=>{});
    await p.play();const audio=elements.at(-1);
    assert.equal(audio.volume,expected);assert.equal(audio.sink,'usb');assert.equal(audio.playCount,1);
    assert.equal(contexts.length,0);p.close();
  }
  for (const setting of [1.5,2,4]) {
    const p=localSamplePlayer('blob:sample',{listenVolume:setting,outputId:'usb'},()=>{},()=>{});
    await p.play();
    const ctx=contexts.at(-1),source=elements.at(-2),output=elements.at(-1);
    assert.equal(source,ctx.source.element);assert.equal(ctx.source.next,ctx.gain);
    assert.equal(ctx.gain.next,ctx.limiter);assert.equal(ctx.limiter.next,ctx.dest);
    assert.equal(ctx.gain.gain.value,Math.min(2,setting)/2);
    assert.equal(ctx.limiter.curve,limitingCurve());
    assert.ok(Math.max(...ctx.limiter.curve)<0.97);
    assert.equal(output.srcObject,ctx.dest.stream);
    assert.equal(output.volume,1);assert.equal(output.sink,'usb');
    p.close();assert.equal(ctx.state,'closed');assert.ok(ctx.track.stopped);
    assert.ok(source.paused && output.paused);assert.equal(output.srcObject,null);
  }
});

test('cancelar al elegir una salida impide que la muestra empiece tarde',async t=>{
  const {elements,contexts}=mockMedia(t);
  const p=localSamplePlayer('blob:sample',{listenVolume:2,outputId:'usb'},()=>{},()=>{});
  const route=Promise.withResolvers();elements.at(-1).setSinkId=()=>route.promise;
  const playing=p.play();p.close();route.resolve();await playing;
  assert.ok(elements.every(audio=>audio.playCount===0));assert.equal(contexts[0].state,'closed');
});

test('durante la grabación comparte el contexto del filtro y detiene el muestreo al cerrar',t=>{
  const {Context}=mockMedia(t);
  let sample, interval, cleared;
  t.mock.method(globalThis,'setInterval',(cb,ms)=>{sample=cb;interval=ms;return 123;});
  t.mock.method(globalThis,'clearInterval',id=>{cleared=id;});
  const ctx=new Context(),meter={hidden:true};
  const stream={};
  const monitor=monitorMicrophone(stream,{audioContext:ctx,stream},meter);
  assert.equal(interval,100);
  for(let i=0;i<3;i++)sample();
  assert.ok(Math.abs(meter.value+20)<0.01);assert.equal(meter.hidden,false);
  assert.match(monitor.summary(),/-20 dBFS/);
  monitor.stop();assert.equal(cleared,123);assert.equal(meter.hidden,true);
  assert.equal(ctx.state,'running','el medidor no cierra el contexto compartido');
});

test('navegar mientras se espera permiso cierra cualquier pista tardía y nunca graba',async t=>{
  const {doc}=mockMedia(t);
  globalThis.MediaRecorder=class {constructor(){assert.fail('grabación después de salir');}};
  const descriptor=Object.getOwnPropertyDescriptor(navigator,'mediaDevices');
  const permission=Promise.withResolvers(),track={stop(){this.stopped=true;}};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>permission.promise}});
  t.after(()=>{if(descriptor)Object.defineProperty(navigator,'mediaDevices',descriptor);else delete navigator.mediaDevices;});
  const container=doc.createElement('div'),mic=mountMicTest(container,()=>({}),()=>({}));
  const [button]=container.children;
  const pending=button.onclick();assert.equal(button.textContent,'Cancelar prueba');
  window.dispatchEvent(new Event('hashchange'));
  permission.resolve({getTracks:()=>[track]});await pending;
  assert.ok(track.stopped);assert.match(button.textContent,/Grabar/);mic.dispose();
});
