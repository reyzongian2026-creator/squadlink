import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from './support/http.mjs';
import { createProgression } from '../progression.mjs';

const keyA = 'a'.repeat(64);
const keyB = 'b'.repeat(64);
async function setup(t) {
  const folder = await mkdtemp(join(tmpdir(),'squadlink-score-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const file = join(folder,'scores.json');
  let current = 1_000_000;
  const env = {SQUADLINK_RECEIPT_SECRET:'test'.repeat(12)};
  const fixtureWith = (opts={})=>fixture(t,{clock:()=>current,progression:{file,env,...opts}});
  const instance = fixtureWith();
  async function guest(f,key,nick) {
    const player = f.player();
    await player.hit('session',{nick});
    const login = await player.hit('social/connect',{deviceKey:key,contacts:[]});
    assert.equal(login.status,200);
    return player;
  }
  const api = async (player,action,body={})=>{
    const response = await player.hit('progress/'+action,body);
    assert.equal(response.status,200,JSON.stringify(response));
    return response.data;
  };
  return {file,env,fixtureWith,instance,api,guest,advance:ms=>{current+=ms;},
    async a(f=instance){return guest(f,keyA,'Gian');},async b(f=instance){return guest(f,keyB,'Mia');}};
}

test('identidad, avatar persistente, cambios concurrentes y restauración tras reinicio',async t=>{
  const s=await setup(t), a=await s.a(), b=await s.b();
  assert.equal((await s.instance.player().hit('progress/profile',{})).status,401);
  const anonymous=s.instance.player();
  await anonymous.hit('session',{nick:'Visitante'});
  assert.equal((await anonymous.hit('progress/profile',{})).status,409);
  assert.equal((await a.hit('progress/avatar',{skin:8,outfit:0,headgear:1})).status,400);
  const avatar={skin:4,outfit:2,headgear:3};
  const [saved]=await Promise.all([s.api(a,'avatar',avatar),s.api(b,'avatar',{skin:1,outfit:1,headgear:1})]);
  assert.deepEqual(saved.profile.avatar,avatar);
  const resumed=await s.a(s.fixtureWith());
  const fresh=await s.api(resumed,'profile');
  assert.deepEqual(fresh.profile,saved.profile);
  assert.equal(fresh.scope,'local');
  assert.equal(Object.keys(JSON.parse(await readFile(s.file))).length,2);
});

test('Reflejos usa el reloj del servidor, deduplica la misma partida y clasifica a dos jugadores',async t=>{
  const s=await setup(t), a=await s.a(), b=await s.b();
  const initial=await s.api(a,'start',{game:'reflex'});
  const early=await s.api(a,'finish',{runId:initial.runId,score:1,xp:5000});
  assert.equal(early.earned,0);
  const run=await s.api(a,'start',{game:'reflex'});
  assert.equal((await b.hit('progress/finish',{runId:run.runId})).status,409);
  s.advance(run.delayMs+260);
  const [one,two] = await Promise.all([s.api(a,'finish',{runId:run.runId}),s.api(a,'finish',{runId:run.runId})]);
  assert.deepEqual(one,two);
  assert.equal(one.score,260);
  assert.equal(one.profile.xp,one.earned);
  assert.equal(one.profile.best.reflex,260);
  const second=await s.api(b,'start',{game:'reflex'});
  s.advance(second.delayMs+205);
  await s.api(b,'finish',{runId:second.runId});
  const leaders=await s.api(a,'ranking',{game:'reflex'});
  assert.deepEqual(leaders.players.map(x=>x.best.reflex),[205,260]);
  assert.ok(leaders.players.every(x=>!('awards' in x) && !('receipt' in x)));
  assert.deepEqual((await s.api(a,'ranking',{game:'sequence'})).players,[]);
  s.advance(125000);
  assert.equal((await a.hit('progress/finish',{runId:run.runId})).status,409);
});

test('Memoria valida secuencia y ritmo, contabiliza cada ronda una sola vez y termina al fallar',async t=>{
  const s=await setup(t), a=await s.a();
  const first=await s.api(a,'start',{game:'sequence'});
  const early=await s.api(a,'finish',{runId:first.runId,round:1,answer:first.sequence});
  assert.equal(early.done,true);assert.equal(early.earned,0);
  const run=await s.api(a,'start',{game:'sequence'});
  s.advance(1000);
  const next=await s.api(a,'finish',{runId:run.runId,round:1,answer:run.sequence});
  assert.equal(next.round,2);assert.equal(next.score,1);assert.equal(next.earned,5);
  assert.equal((await s.api(a,'finish',{runId:run.runId,round:1,answer:run.sequence})).profile.xp,5);
  s.advance(1900);
  const answers=[...next.sequence];
  answers[0]=(answers[0]+1)%4;
  const failed=await s.api(a,'finish',{runId:run.runId,round:2,answer:answers});
  assert.equal(failed.done,true);assert.equal(failed.score,1);assert.equal(failed.earned,0);
  assert.equal((await s.api(a,'ranking',{game:'sequence'})).players[0].best.sequence,1);
});

test('recibos firmados recuperan el perfil en otro almacén y rechazan firma o identidad distinta',async t=>{
  const s=await setup(t), a=await s.a();
  const avatar={skin:5,outfit:0,headgear:1};
  const saved=await s.api(a,'avatar',avatar);
  const env={...s.env,RENDER:'true'};
  const fresh=s.fixtureWith({file:undefined,env});
  const same=await s.a(fresh), other=await s.b(fresh);
  const restored=await s.api(same,'profile',{receipt:saved.receipt});
  assert.deepEqual(restored.profile,saved.profile);
  assert.equal(restored.scope,'session');
  assert.equal((await other.hit('progress/profile',{receipt:saved.receipt})).status,403);
  const tampered='x'+saved.receipt;
  assert.equal((await same.hit('progress/profile',{receipt:tampered})).status,400);
  await s.api(same,'avatar',{skin:1,outfit:5,headgear:0});
  assert.equal((await s.api(same,'profile',{receipt:saved.receipt})).profile.avatar.skin,1);
});

test('falla la escritura: reintento conserva el tiempo y puede acreditar una sola vez',async()=>{
  let current=10_000, broken=true, row=null;
  const store={scope:'global',async update(id,transform){
    row=transform(row);
    if (broken) throw Error('acuse perdido');
    return row;
  }};
  const session={nick:'Gian'};session.social={session,id:'0123456789ABCDEF',fingerprint:keyA};
  const service=createProgression({store,now:()=>current,env:{},throttle(){},
    reject(status,message){throw Object.assign(Error(message),{status});}});
  const run=await service.handle('start',session,{game:'reflex'});
  current+=run.delayMs+200;
  await assert.rejects(service.handle('finish',session,{runId:run.runId}),{status:503});
  const xp=row.xp;
  current+=6000;broken=false;
  const retry=await service.handle('finish',session,{runId:run.runId});
  assert.equal(retry.score,200);assert.equal(retry.profile.xp,xp);assert.equal(retry.earned,xp);
});

test('un archivo ilegible no se sobreescribe con un ranking vacío',async t=>{
  const s=await setup(t), a=await s.a();
  await writeFile(s.file,'{incompleto');
  assert.equal((await a.hit('progress/profile',{})).status,503);
  assert.equal(await readFile(s.file,'utf8'),'{incompleto');
});
