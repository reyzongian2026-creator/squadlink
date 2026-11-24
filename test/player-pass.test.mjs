import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {getPlayerPass,readPass,importPass,finishImport} from '../public/player-pass.js';
import {fixture} from './support/http.mjs';

const key = '1'.repeat(64);
const contact = {id:'AB'.repeat(8),nick:'Amiga',token:'9'.repeat(64)};
function storage() {
  const entries = new Map();
  return {getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k)};
}
function example(overrides={}) {
  return {format:'squadlink-player-v1',deviceKey:key,nick:'Pepe',contacts:[contact],receipt:'',...overrides};
}
test('el pase importa en almacenamiento limpio y nunca reemplaza un jugador existente',()=>{
  const st=storage(), raw=JSON.stringify(example());
  assert.equal(importPass(raw,st),'Pepe');
  assert.deepEqual(getPlayerPass(st),example());
  assert.throws(()=>importPass(JSON.stringify(example({deviceKey:'2'.repeat(64)})),st),/Ya tienes/);
  assert.deepEqual(getPlayerPass(st),example());
  for(const malformed of ['[]','x',JSON.stringify(example({contacts:[{id:'copia',nick:'',token:''}]})),JSON.stringify(example({receipt:'falsa'}))]) {
    const empty=storage();assert.throws(()=>importPass(malformed,empty));assert.equal(empty.getItem('squadlink.device.v1'),null);
  }
});
test('una importación interrumpida reanuda de forma íntegra al abrir la app',()=>{
  const st=storage(), set=st.setItem;
  st.setItem=(k,v)=>{if(k==='squadlink.nick')throw Error('Sin espacio');set(k,v);};
  assert.throws(()=>importPass(JSON.stringify(example()),st),/Sin espacio/);
  st.setItem=set;
  finishImport(st);
  assert.deepEqual(getPlayerPass(st),example());
  assert.equal(st.getItem('squadlink.pass-import.v1'),null);
});
test('un apodo nuevo conserva la sala, el anfitrión, el XP y el récord; un equipo limpio usa el pase',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'squadlink-pase-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  let now=1_000_000;
  const options={clock:()=>now,progression:{file:join(folder,'scores.json'),env:{SQUADLINK_RECEIPT_SECRET:'local'.repeat(12)}}};
  const client=fixture(t,options).player();
  const post=async(c,path,body)=>{const r=await c.hit(path,body);assert.ok(r.status===200 || r.status===201,path+': '+r.status);return r.data;};
  const first=await post(client,'session',{nick:'Pepe'});
  const social=await post(client,'social/connect',{deviceKey:key,contacts:[]});
  const {room}=await post(client,'rooms',{name:'Sala de prueba'});
  const run=await post(client,'progress/start',{game:'reflex'});
  now+=run.delayMs+240;
  await post(client,'progress/finish',{runId:run.runId});
  const before=(await post(client,'progress/profile',{})).profile;
  assert.ok(before.xp>0);
  const changed=await post(client,'session',{nick:'Nuevo apodo'});
  assert.equal(changed.self.id,first.self.id);
  assert.equal(changed.room.code,room.code);
  assert.equal(changed.room.ownerId,first.self.id);
  assert.equal(changed.room.members.length,1);
  const renamed=await post(client,'progress/profile',{});
  assert.equal(renamed.profile.nick,'Nuevo apodo');
  assert.equal(renamed.profile.xp,before.xp);
  const fresh=storage();
  importPass(JSON.stringify(example({nick:changed.self.nick,contacts:[],receipt:renamed.receipt})),fresh);
  const saved=readPass(JSON.stringify(getPlayerPass(fresh)));
  const restored=fixture(t,options).player();
  await post(restored,'session',{nick:saved.nick});
  assert.equal((await post(restored,'social/connect',{deviceKey:saved.deviceKey,contacts:saved.contacts})).id,social.id);
  const recovered=(await post(restored,'progress/profile',{receipt:saved.receipt})).profile;
  assert.equal(recovered.id,before.id);
  assert.equal(recovered.xp,before.xp);
  assert.deepEqual(recovered.best,before.best);
});
