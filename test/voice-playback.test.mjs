import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceRoom} from '../public/voice.js';

function setup(t) {
  const contexts=[], audios=[], notices=[];
  let state='running', wake;
  class Node {
    outputs=[];
    connect(other) { this.outputs.push(other); return other; }
    disconnect() { this.outputs=[]; }
  }
  class Stream {
    constructor(tracks) { this.tracks=tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks; }
  }
  const track=()=>({kind:'audio', stopped:false, stop() { this.stopped=true; }});
  class Context {
    sources=[]; gains=[]; limiters=[]; destinations=[];
    destination=new Node(); state=state; currentTime=0;
    constructor() { contexts.push(this); }
    createMediaStreamSource(s) { const source=Object.assign(new Node(),{stream:s}); this.sources.push(source); return source; }
    createGain() {
      const gain=Object.assign(new Node(),{gain:{value:0,setTargetAtTime(value){ this.value=value; }}});
      this.gains.push(gain); return gain;
    }
    createWaveShaper() { const limiter=new Node(); this.limiters.push(limiter); return limiter; }
    createMediaStreamDestination() {
      const dest=Object.assign(new Node(),{stream:new Stream([track()])}); this.destinations.push(dest); return dest;
    }
    async close() { this.state='closed'; }
    resume() { return new Promise(resolve => { wake=()=>{ this.state='running'; resolve(); }; }); }
  }
  const values={MediaStream:Stream,AudioContext:Context,RTCPeerConnection:class { close() {} },document:{
    createElement() { const audio={played:[],pause(){},async play(){this.played.push(this.srcObject);},
      async setSinkId(sink){this.sink=sink;}}; audios.push(audio); return audio; }
  }};
  for (const [name,value] of Object.entries(values)) {
    const prior=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{value,configurable:true});
    t.after(()=>prior?Object.defineProperty(globalThis,name,prior):Reflect.deleteProperty(globalThis,name));
  }
  const room=new VoiceRoom({selfId:'Z',onStatus:text=>notices.push(text)});
  t.after(()=>room.close());
  return {room,contexts,audios,notices,track,suspend:()=>{state='suspended';},wake:()=>wake()};
}

test('amplifica en el mismo elemento y limita los picos sin duplicar la pista ni la salida', async t=>{
  const {room,contexts,audios,track}=setup(t);
  await room.configureAudio({outputId:'auriculares',listenVolume:1});
  room.syncMembers(['Z','A','B']);
  const [a,b]=['A','B'].map(id=>room.peers.get(id));
  const input=track(); a.pc.ontrack({track:input}); b.pc.ontrack({track:track()});
  await Promise.resolve();
  const direct=a.audio.srcObject;
  assert.equal(contexts.length,0);
  room.setVolume('B',0.5);
  await room.configureAudio({listenVolume:2});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(contexts.length,1);
  const [ctx]=contexts;
  const [source]=ctx.sources, [gain]=ctx.gains, [limiter]=ctx.limiters, [out]=ctx.destinations;
  assert.deepEqual([source.outputs[0],gain.outputs[0],limiter.outputs[0]], [gain,limiter,out]);
  assert.equal(out.outputs.length,0);
  assert.equal(source.stream,direct);
  assert.equal(a.audio.srcObject,out.stream);
  assert.equal(a.audio.sink,'auriculares');
  assert.equal(a.audio.volume,1);
  assert.equal(b.audio.srcObject,b.remoteStream);
  assert.equal(b.audio.volume,1);
  const mutedDecoder = audios.find(audio => audio.muted);
  assert.deepEqual(mutedDecoder.played,[direct]);
  assert.equal(audios.filter(audio => !audio.muted).length,2);
  function transfer(input) {
    const sample=input*gain.gain.value;
    return limiter.curve[Math.round((sample+1)/2*(limiter.curve.length-1))];
  }
  assert.ok(Math.abs(transfer(0.125)-0.25)<1e-6);
  assert.ok(Math.abs(transfer(-0.125)+0.25)<1e-6);
  assert.ok(transfer(1)>0.85 && transfer(1)<0.961);
  assert.equal(transfer(-1),-transfer(1));
  assert.equal(transfer(0),0);
  a.pc.ontrack({track:input}); assert.equal(a.audio.srcObject,out.stream);
  room.setVolume('B',1);
  assert.equal(contexts.length,1);
  assert.equal(ctx.destinations.length,2);
  room.setVolume('A',0); assert.equal(a.audio.volume,0);
  assert.equal(a.audio.srcObject,direct);
  assert.ok(out.stream.getTracks()[0].stopped);
  assert.equal(mutedDecoder.srcObject,null);
  assert.equal(input.stopped,false);
  assert.equal(ctx.state,'running');
  await room.configureAudio({listenVolume:0.7});
  assert.equal(b.audio.srcObject,b.remoteStream);
  assert.equal(b.audio.volume,0.7);
  assert.equal(ctx.state,'closed');
  await assert.rejects(room.configureAudio({listenVolume:2.1}),/200/);
});

test('al salir mientras se desbloquea el audio no se inician pistas pendientes',async t=>{
  const {room,suspend,wake,contexts,track}=setup(t); suspend();
  await room.configureAudio({listenVolume:2}); room.syncMembers(['A']);
  const peer=room.peers.get('A'); peer.pc.ontrack({track:track()});
  assert.equal(peer.audio.srcObject,peer.remoteStream);
  const output=contexts[0].destinations[0].stream;
  room.syncMembers([]); wake(); await Promise.resolve(); await Promise.resolve();
  assert.equal(peer.audio.srcObject,null);
  assert.ok(!peer.audio.played.includes(output));
});
