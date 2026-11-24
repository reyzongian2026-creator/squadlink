import assert from 'node:assert/strict';
import test from 'node:test';
import {bindVoiceDiagnostics,describeConnection} from '../public/connection.js';

const report = (...entries) => new Map(entries.map(s=>[s.id,s]));
const audio = (extra={}) => ({id:'in',type:'inbound-rtp',kind:'audio',ssrc:700,
  timestamp:1000,packetsReceived:300,packetsLost:40,jitter:0.007,...extra});
const path = (overrides={}) => [
  {id:'x',type:'transport',selectedCandidatePairId:'p'},
  {id:'p',type:'candidate-pair',localCandidateId:'l',remoteCandidateId:'r',currentRoundTripTime:0.025,...overrides},
  {id:'l',candidateType:'host'},{id:'r',candidateType:'relay'}
];

test('mide la pérdida de la muestra del mismo SSRC y presenta RTT y último jitter por separado',()=>{
  const before=report(audio());
  const after=report(...path(),audio({timestamp:2200,packetsReceived:349,packetsLost:41,jitter:0.008}));
  assert.match(describeConnection(before,after),/Por retransmisor · 25 ms de ida y vuelta · Último jitter 8 ms · Pérdida en la muestra 2 % \(1 de 50\)/);
});

test('mantiene la pérdida cero comprobada, la ausencia de tráfico y las métricas desconocidas diferenciadas',()=>{
  const first=report(audio());
  const sample = patch => describeConnection(first,report(audio({timestamp:2200,...patch})));
  assert.match(sample({packetsReceived:305,jitter:0}),/Último jitter 0 ms · Pérdida en la muestra 0 % \(0 de 5\)/);
  assert.match(sample({}),/Sin paquetes nuevos en la muestra/);
  for (const patch of [{ssrc:701},{packetsReceived:280},{packetsLost:39},{packetsLost:undefined},
                      {id:'replacement'},{timestamp:1000},{packetsLost:-1},{ssrc:undefined}]) {
    assert.match(sample(patch),/Pérdida en la muestra sin medición/);
    assert.doesNotMatch(sample(patch), /0 %/);
  }
  assert.match(sample({packetsLost:42}),/100 % \(2 de 2\)/);
  assert.match(sample({jitter:0,packetsReceived:undefined}),/Jitter sin medición/);
  assert.match(describeConnection(null,report(...path({currentRoundTripTime:-1}))),/Ida y vuelta sin medición/);
  assert.match(describeConnection(first,null),/Una sola lectura.*Pérdida en la muestra sin medición/);
  assert.match(describeConnection(null,null),/Medición no disponible/);
});

test('mantiene cada flujo de audio separado y descarta vídeo y estadísticas del otro extremo',()=>{
  const second={id:'in2',ssrc:710,kind:undefined,mediaType:'audio'};
  const video={id:'video',kind:'video'};
  const send={id:'out',type:'remote-inbound-rtp'};
  const before=report(audio(),audio(second),audio(video),audio(send));
  const after=report(audio({timestamp:2200,packetsReceived:309,packetsLost:41}),
    audio({...second,timestamp:2200,packetsReceived:320}),audio(video),audio(send));
  const line=describeConnection(before,after);
  assert.match(line,/Audio 1.*10 % \(1 de 10\).*Audio 2.*0 % \(0 de 20\)/);
  assert.doesNotMatch(line,/Audio 3/);
  const stats=report({id:'codec',type:'codec',mimeType:'audio/opus'},
    audio({kind:undefined,codecId:'codec',jitter:0.00002}));
  assert.match(describeConnection(null,stats),/Último jitter <0,1 ms/);
});

test('solo mide al pulsar y no muestra lecturas de una conexión reemplazada',async t=>{
  const button={disabled:false};
  const output={textContent:'',rows:[],busy:undefined,
    replaceChildren(){this.rows=[];this.textContent='';},append(row){this.rows.push(row.textContent);},
    setAttribute(_key,val){this.busy=val;},removeAttribute(){this.busy=undefined;}};
  globalThis.document={getElementById:id=>id==='measure-voice'?button:output,createElement:()=>({})};
  t.after(()=>delete globalThis.document);
  const peers=new Map();
  const room={peers};
  const reads=[];
  const active={id:'A',pc:{async getStats(){reads.push('A');return report(audio({timestamp:reads.length*1000,
    packetsReceived:300+reads.length}));}}};
  const replaced={id:'B',pc:{async getStats(){reads.push('B');return report(audio());}}};
  peers.set(active.id,active);peers.set(replaced.id,replaced);
  bindVoiceDiagnostics(()=>room,()=>[{id:'A',nick:'Pepe'},{id:'B',nick:'Sol'}]);
  assert.deepEqual(reads,[]);
  const result=button.onclick();
  assert.equal(button.disabled,true);
  assert.equal(output.busy,'true');
  await button.onclick();
  peers.set('B',{id:'B',pc:{getStats(){throw Error('No se debe medir al sustituto');}}});
  await result;
  assert.deepEqual(reads,['A','B','A']);
  assert.equal(output.rows.length,1);
  assert.match(output.rows[0],/^Pepe · .*Pérdida en la muestra 0 %/);
  assert.equal(button.disabled,false);
  assert.equal(output.busy,undefined);
});
