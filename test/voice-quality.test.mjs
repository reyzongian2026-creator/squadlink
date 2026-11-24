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
test('un corte de 200 ms baja la cobertura y no altera la altura medida del tono',()=>{
  const input=samples('tone',quality.reference(900));
  input.fill(0,rate*0.3,rate*0.5);
  const result=quality.summarize(input.subarray(0,rate),rate,900);
  assert.equal(result.coveragePct,80);
  assert.equal(result.longestGapMs,200);
  assert.ok(Math.abs(result.crossingHz-900)<2);
  assert.throws(()=>quality.verify('tone',result,900),/Huecos/);
});
test('la medición verifica +6 y +12 dB en el tono suave y detecta una ganancia que no se aplica',()=>{
  const input=samples('soft',quality.reference(500));
  const baseline=quality.summarize(input,rate,500);
  assert.ok(Math.abs(baseline.rmsDbfs+26.42)<0.05);
  for (const db of [6,12]) {
    const output=Float32Array.from(input,value=>value*10**(db/20));
    assert.ok(Math.abs(quality.verifyGain(baseline,quality.summarize(output,rate,500),db)-db)<=0.01);
  }
  assert.throws(()=>quality.verifyGain(baseline,baseline,6),/Ganancia recibida/);
  assert.equal(quality.verifyGain(baseline,baseline,0),0);
});
test('duplicar el volumen local equivale a +6,02 dB y se detecta si también aumenta el RTP',()=>{
  const input=samples('soft',quality.reference(900));
  const before=quality.summarize(input,rate,900);
  const after=quality.summarize(Float32Array.from(input,sample=>2*sample),rate,900);
  assert.ok(Math.abs(quality.verifyGain(before,after,20*Math.log10(2),900)-6.02)<=0.01);
  assert.throws(()=>quality.verifyGain(before,after,0,900),/Ganancia recibida/);
});
