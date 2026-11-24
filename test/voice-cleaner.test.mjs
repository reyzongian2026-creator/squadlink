import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {prepareVoiceCapture} from '../public/voice-capture.js';

const source = readFileSync(new URL('../public/voice-cleaner-worklet.js', import.meta.url), 'utf8');

for (const rate of [44100, 48000]) {
  test('conserva voz suave, atenúa el fondo entre frases y limita picos a '+rate+' Hz', () => {
    let Processor;
    vm.runInNewContext(source, {AudioWorkletProcessor: class {}, sampleRate: rate,
      registerProcessor: (_, C) => { Processor = C; }});
    const processor = new Processor();
    const input = new Float32Array(128), output = new Float32Array(128);
    let seed = 104729, cursor = 0;
    const random = () => ((seed = (Math.imul(1664525,seed) + 1013904223) >>> 0) / 2147483648 - 1);
    function measure(sample, reduce = true, micGainDb = 0) {
      let energy = 0, before = 0, peak = 0;
      for (let block=0; block<240; block++) {
        for (let i=0;i<input.length;i++) input[i] = sample(cursor++ / rate);
        processor.process([[input]], [[output]], {reduceNoise:[Number(reduce)], micGainDb:[micGainDb]});
        for (let i=0;i<input.length;i++) {
          peak = Math.max(peak, Math.abs(output[i]));
          if (block > 160) { energy += output[i] ** 2; before += input[i] ** 2; }
        }
      }
      return {ratio: Math.sqrt(energy/before),peak};
    }
    const voice = t => .023*Math.sin(2*Math.PI*220*t)+.012*Math.sin(2*Math.PI*440*t);
    assert.ok(measure(voice).ratio > .86);
    assert.ok(measure(()=>.023*random()).ratio < .12);
    const neutral = measure(voice).ratio;
    for (const gain of [6, 12]) {
      const boosted = measure(voice, true, gain);
      assert.ok(Math.abs(20 * Math.log10(boosted.ratio / neutral) - gain) < .25);
    }
    assert.ok(measure(t=>.99*Math.sin(2*Math.PI*540*t), true, 18).peak <= .751);
    assert.ok(measure(()=>.023*random(), true, 18).ratio < .15);
    assert.ok(measure(t=>.99*Math.sin(2*Math.PI*540*t)).peak <= .751);
    assert.ok(measure(()=>.023*random(),false).ratio > .85);
  });
}

test('cerrar durante el arranque del dispositivo de audio libera el contexto y resuelve la captura', async t => {
  const original = [globalThis.AudioContext, globalThis.AudioWorkletNode];
  t.after(()=>{[globalThis.AudioContext, globalThis.AudioWorkletNode]=original;});
  let closed=0;
  globalThis.AudioWorkletNode = class {};
  globalThis.AudioContext = class {
    audioWorklet={addModule:()=>new Promise(()=>{})};
    resume(){return new Promise(()=>{});}
    async close(){closed++;}
  };
  const input = {};
  const capture=prepareVoiceCapture(input,{noiseSuppression:true});
  capture.close();
  assert.equal(await capture.ready,false);
  assert.equal(capture.stream,input);
  assert.equal(closed,1);
});
