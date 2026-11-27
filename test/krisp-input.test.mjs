import assert from 'node:assert/strict';
import test from 'node:test';
import { isKrispMicrophone, prepareVoiceCapture } from '../public/voice-capture.js';
import { microphoneConstraints } from '../public/audio-settings.js';

test('la entrada virtual usa el filtro de Krisp sin cambiar las preferencias del micrófono físico', async t => {
  const settings={inputId:'virtual',noiseSuppression:true,autoGainControl:true,micGainDb:6};
  for(const label of ['Micrófono (Krisp Audio)','Default - Krisp Microphone']){
    assert.equal(isKrispMicrophone(label),true);
    assert.equal(microphoneConstraints(settings,label).autoGainControl,false);
  }
  assert.equal(microphoneConstraints(settings,'Wave DX').noiseSuppression,true);
  assert.equal(isKrispMicrophone(''),false);
  const applied=[];
  const track={label:'Krisp Microphone',getConstraints:()=>({echoCancellation:true}),
    applyConstraints:async c=>{applied.push(c);}};
  const gain={},noise={};
  const before=[globalThis.AudioContext,globalThis.AudioWorkletNode];
  t.after(()=>{[globalThis.AudioContext,globalThis.AudioWorkletNode]=before;});
  const node={connect(){return this;},disconnect(){}};
  globalThis.AudioContext=class {
    audioWorklet={addModule:async()=>{}};
    async resume(){} async close(){}
    createMediaStreamSource(){return node;}
    createMediaStreamDestination(){return {stream:{getTracks:()=>[]}};}
  };
  globalThis.AudioWorkletNode=class {
    constructor(ctx,name,options){assert.equal(options.parameterData.reduceNoise,0);}
    connect(){return node;} disconnect(){}
    parameters=new Map([['reduceNoise',noise],['micGainDb',gain]]);
  };
  const capture=prepareVoiceCapture({getAudioTracks:()=>[track]},settings);
  assert.equal(await capture.ready,true);
  capture.setNoise(true);
  capture.setMicGainDb(12);
  assert.equal(noise.value,0);
  assert.equal(gain.value,12);
  assert.deepEqual(applied,[{echoCancellation:true,noiseSuppression:false,autoGainControl:false}]);
  capture.close();
});
