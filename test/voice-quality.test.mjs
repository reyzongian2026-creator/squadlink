import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import quality from './support/voice-quality.cjs';

const rate = 48000;
const processorScript = readFileSync(new URL('../public/voice-cleaner-worklet.js',import.meta.url),'utf8');
function cleaner() {
  let Processor;
  vm.runInNewContext(processorScript,{sampleRate:rate,AudioWorkletProcessor:class {},
    registerProcessor(name, ctor) { assert.equal(name,'squadlink-voice-cleaner'); Processor=ctor; }});
  return new Processor();
}
function samples(mode, generate) {
  const data = new Float32Array(2*rate);
  for (let i=0; i<data.length; i+=960) data.set(generate(mode),i);
  return data;
}
for (const hz of [500,900]) {
  test('La medición distingue vocal sintética, tono, fondo y saturación a '+hz+' Hz',()=>{
    const filter=cleaner(), generate=quality.reference(hz);
    let bypass;
    for (const mode of ['tone','silence','noiseBypass','noise','voice','mixed','overload']) {
      const input=samples(mode,generate), output=new Float32Array(input.length);
      for (let i=0;i<input.length;i+=128) {
        filter.process([[input.subarray(i,i+128)]],[[output.subarray(i,i+128)]],
          {reduceNoise:[mode==='noiseBypass'?0:1]});
      }
      const result=quality.summarize(output.subarray(rate),rate,hz);
      if (mode==='noiseBypass') {
        bypass=result;
        assert.ok(Math.abs(quality.summarize(input,rate,hz).rmsDbfs+38)<0.15);
      }
      quality.verify(mode,result,hz,bypass);
      if (mode==='noise') assert.throws(()=>quality.verify(mode,bypass,hz,bypass),/atenuación/);
      if (mode==='tone') {
        const wrong=quality.summarize(output.subarray(rate),rate,hz===500?900:500);
        assert.throws(()=>quality.verify(mode,wrong,hz),/referencia/);
      }
    }
    const clipped=quality.summarize(new Float32Array(rate).fill(1),rate,hz);
    assert.throws(()=>quality.verify('tone',clipped,hz),/Saturación/);
  });
}
