import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSpeakerTest} from '../public/speaker-test.js';

function fixture(options={}) {
  const audio=[], urls=new Map(), timers=new Map();
  let next=0,captures=0;
  const view=new EventTarget(),doc=new EventTarget(),panel=new EventTarget();
  const host=new EventTarget(),devices=new EventTarget();
  devices.getUserMedia=()=>{captures++;throw Error('No debe capturar el micro')};
  Object.assign(view,{Blob,URL:{
    createObjectURL(blob){const url='blob:test/'+ ++next;urls.set(url,blob);return url;},
    revokeObjectURL(url){urls.delete(url);}
  },navigator:{mediaDevices:devices},squadBridge:host,
  setTimeout(fn){const id=++next;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
  doc.defaultView=view;
  doc.getElementById=()=>panel;
  doc.createElement=tag=>{
    if(tag!=='audio') return {setAttribute(){}};
    const element={volume:1,plays:0,pauses:0,loads:0,sinks:[],
      async setSinkId(id){this.sinks.push(id);if(options.route)await options.route();},
      async play(){this.plays++;if(options.play)await options.play();},
      pause(){this.pauses++;},load(){this.loads++;},removeAttribute(name){delete this[name];}};
    if(options.noSink)delete element.setSinkId;
    audio.push(element); return element;
  };
  panel.open=true;
  const container={ownerDocument:doc,replaceChildren(...children){this.children=children;},closest(){return null;}};
  const prefs={outputId:'headset-1',listenVolume:2};
  const widget=mountSpeakerTest(container,()=>prefs);
  const [button,status]=container.children;
  return {audio,urls,timers,doc,view,host,devices,panel,button,status,prefs,widget,getCaptures:()=>captures};
}

test('prueba solo la salida seleccionada con dos notas suaves y finaliza sin capturar ni retener audio',async()=>{
  const f=fixture();
  assert.equal(f.audio.length,0);
  await f.button.onclick();
  const a=f.audio[0];
  assert.deepEqual(a.sinks,['headset-1']); assert.equal(a.plays,1); assert.equal(a.volume,1);
  const wav=new DataView(await f.urls.get(a.src).arrayBuffer());
  const text=(at,length)=>String.fromCharCode(...new Uint8Array(wav.buffer,at,length));
  assert.equal(text(0,4),'RIFF');assert.equal(text(8,4),'WAVE');
  assert.equal(wav.getUint16(22,true),1);assert.equal(wav.getUint32(24,true),16000);
  const samples=Array.from({length:wav.getUint32(40,true)/2},(_,i)=>wav.getInt16(44+i*2,true));
  assert.ok(samples.length/16000<1);
  const peak=Math.max(...samples.map(Math.abs));
  assert.ok(peak>=3200 && peak<=3276);
  for (const from of [0,5440]) {
    assert.ok(samples.slice(from,from+40).every(n=>Math.abs(n)<130));
    assert.ok(samples.slice(from+3800,from+3840).every(n=>Math.abs(n)<130));
  }
  assert.ok(samples.slice(3840,5440).every(n=>n===0));
  const rising=(from,to)=>samples.slice(from,to).filter((n,i)=>n>0 && samples[from+i-1]<=0).length;
  assert.ok(rising(5440,9280)>rising(0,3840)+15);
  a.onended();
  assert.equal(f.urls.size,0); assert.equal(f.timers.size,0); assert.equal(a.src,undefined);
  assert.equal(f.button.textContent,'Probar altavoz'); assert.match(f.status.textContent,/terminada/);
  assert.equal(f.getCaptures(),0); f.widget.dispose();
});

test('un cambio de dispositivo o una salida denegada nunca reproducen por otra salida',async()=>{
  const route=Promise.withResolvers(), f=fixture({route:()=>route.promise});
  const pending=f.button.onclick();
  f.prefs.outputId='headset-2';
  route.resolve(); await pending;
  assert.equal(f.audio[0].plays,0); assert.equal(f.timers.size,0);
  await f.button.onclick();
  assert.deepEqual(f.audio[1].sinks,['headset-2']);
  f.devices.dispatchEvent(new Event('devicechange'));
  assert.equal(f.urls.size,0); assert.equal(f.audio[1].pauses,1);
  for (const options of [{route:()=>Promise.reject(Error('Sin permiso'))},{noSink:true}]) {
    const failed=fixture(options);
    await failed.button.onclick();
    assert.match(failed.status.textContent,/salida elegida/);
    assert.equal(failed.audio[0].plays,0); assert.equal(failed.urls.size,0); assert.equal(failed.timers.size,0);
    failed.widget.dispose();
  }
  f.widget.dispose();
});

test('cerrar Ajustes, navegar o cancelar silencia la prueba, incluso con play pendiente',async()=>{
  const play=Promise.withResolvers(), f=fixture({play:()=>play.promise});
  const cancelActions=[
    ()=>f.widget.cancel(),
    ()=>{f.panel.open=false;f.panel.dispatchEvent(new Event('toggle'));},
    ()=>f.view.dispatchEvent(new Event('hashchange')),
    ()=>f.host.dispatchEvent(new MessageEvent('message',{data:{type:'desktop:action',action:'home'}})),
    ()=>{f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));},
    ()=>f.view.dispatchEvent(new Event('pagehide')),
    ()=>f.widget.dispose()
  ];
  for (const cancel of cancelActions){
    f.doc.hidden=false;f.panel.open=true;
    const pending=f.button.onclick();
    await Promise.resolve();await Promise.resolve();
    const a=f.audio.at(-1); assert.ok(a.plays);
    const ended=a.onended;
    cancel(); ended();
    assert.equal(a.pauses,1);assert.equal(f.urls.size,0);assert.equal(f.timers.size,0);
    // The next run starts before the first play() promise settles.
    pending.catch(()=>{});
  }
  play.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.status.textContent,'');assert.equal(f.button.onclick,null);assert.equal(f.getCaptures(),0);
});

test('a volumen cero no se reproduce y al usar la salida del sistema se respeta el volumen elegido',async()=>{
  const f=fixture({noSink:true});
  f.prefs.outputId='';f.prefs.listenVolume=0;
  await f.button.onclick();assert.equal(f.audio.length,0);
  f.prefs.listenVolume=0.45;
  await f.button.onclick();assert.equal(f.audio[0].volume,0.45);assert.equal(f.audio[0].plays,1);
  const timeout=[...f.timers.values()][0];timeout();
  assert.equal(f.urls.size,0);assert.match(f.status.textContent,/no respondió/);
  f.widget.dispose();
});
