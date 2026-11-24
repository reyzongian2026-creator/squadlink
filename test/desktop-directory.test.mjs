import test from 'node:test';
import assert from 'node:assert/strict';
import {watchLobbyDirectory} from '../electron/lobby-directory.mjs';

test('el lobby evita consultas repetidas al enfocar, espera oculto y permite reintentar',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const windowTarget=new EventTarget(), documentTarget=new EventTarget();
  const install=(key,value)=>{
    const original=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,value});
    t.after(()=>original?Object.defineProperty(globalThis,key,original):delete globalThis[key]);
  };
  install('window',windowTarget);
  install('document',documentTarget);
  let hits=0,fail=false,undelivered;
  const data=[{code:'PEPE01'}];
  install('fetch',async(_url,options)=>{
    hits++;
    if (hits===4) return new Promise(resolve=>{undelivered={resolve,signal:options.signal}});
    return {ok:!fail,json:async()=>({rooms:data})};
  });
  const snapshots=[];
  let failures=0;
  const watcher=watchLobbyDirectory(rooms=>snapshots.push(rooms),()=>failures++);
  t.after(()=>watcher.stop());
  const settled=()=>new Promise(resolve=>setImmediate(resolve));
  await settled();
  assert.deepEqual(snapshots,[data]);
  for(let i=0;i<20;i++){
    windowTarget.dispatchEvent(new Event('focus'));
    documentTarget.dispatchEvent(new Event('visibilitychange'));
  }
  assert.equal(hits,1);
  documentTarget.hidden=true;
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(60_000);
  assert.equal(hits,1);

  documentTarget.hidden=false;fail=true;
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  await settled();
  assert.equal(hits,2);assert.equal(failures,1);
  assert.equal(snapshots.length,1);
  fail=false;watcher.retry();watcher.retry();
  await settled();
  assert.equal(hits,3);assert.deepEqual(snapshots,[data,data]);

  t.mock.timers.tick(15_000);
  assert.equal(hits,4);
  watcher.stop();
  assert.ok(undelivered.signal.aborted);
  undelivered.resolve({ok:true,json:async()=>({rooms:[]})});
  await settled();
  t.mock.timers.tick(60_000);
  windowTarget.dispatchEvent(new Event('focus'));
  assert.equal(hits,4);assert.deepEqual(snapshots,[data,data]);
});
