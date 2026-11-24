import {normalizeAvatar} from '../public/character-model.js';
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
  assert.deepEqual(saved.profile.avatar,normalizeAvatar(avatar));
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

test('récords del arcade se ordenan por desafío y sobreviven a reinicios y reintentos', async t=>{
  const s=await setup(t), a=await s.a(), b=await s.b();
  for (const [game,first,better] of [
    ['flick',12000,11000],['precision',8,11],['ducks',6,9],['ducknes',500,900],
    ['ducknesround',2,3],['mario3',200,450],['mario3world',2,3],['doom',1,4],
    ['merge',128,256],['three',9000,8000],
  ]) {
    await s.api(b,'record',{game,value:first});
    await Promise.all([better,first,better].map(value=>s.api(a,'record',{game,value})));
    const {players}=await s.api(b,'ranking',{game});
    assert.deepEqual(players.map(row=>row.best[game]),[better,first]);
    assert.deepEqual(players.map(row=>row.nick),['Gian','Mia']);
  }
  const resumed=await s.a(s.fixtureWith());
  assert.equal((await s.api(resumed,'profile')).profile.best.mario3,450);
  for (const [game,value] of [['mario3world',9],['ducknesround',1],['merge',3],['reflex',90],['unknown',1]])
    assert.equal((await resumed.hit('progress/record',{game,value})).status,400);
});

test('la evolución conserva XP y récords anteriores y el nivel de clasificación llega hasta 50', async t => {
  const s = await setup(t), player = await s.a();
  const fresh = (await s.api(player,'profile')).profile;
  assert.equal(fresh.characterCreated,false);
  // Simulate the exact on-disk profile shape from the previous release.
  const oldAvatar = {skin:4, outfit:3, headgear:2};
  const saved = {id:fresh.id,nick:fresh.nick,xp:4899,best:{reflex:250,sequence:0},avatar:oldAvatar,revision:22,awards:[]};
  await writeFile(s.file, JSON.stringify({[fresh.id]:saved}));
  const restarted = await s.a(s.fixtureWith());
  const before = (await s.api(restarted,'profile')).profile;
  assert.equal(before.level,49);
  assert.equal(before.levelXp,99);
  assert.equal(before.evolution.aura,'violet');
  assert.deepEqual(before.avatar,normalizeAvatar(oldAvatar));
  assert.equal(before.characterCreated,false);
  const run = await s.api(restarted,'start',{game:'reflex'});
  s.advance(run.delayMs+300);
  const after = (await s.api(restarted,'finish',{runId:run.runId})).profile;
  assert.ok(after.xp>4900);
  assert.equal(after.level,50);
  assert.equal(after.nextLevelXp,0);
  assert.equal(after.nextEvolution,null);
  assert.equal(after.evolution.aura,'prism');
  const ranking = (await s.api(restarted,'ranking',{game:'xp'})).players;
  assert.equal(ranking[0].level,50);
  assert.equal(ranking[0].best.reflex,250);
});

test('el editor conserva combinaciones libres entre versiones y solo completa la creación con todos los rasgos', async t => {
  const s = await setup(t), player = await s.a();
  const original = {skin:0,outfit:0,headgear:0};
  const aspect = {...original,species:3,gender:0,build:1,facialHair:1};
  for (const key of ['species','gender','build','facialHair'])
    assert.equal((await player.hit('progress/avatar',{...aspect,[key]:99})).status,400);
  assert.equal((await s.api(player,'avatar',original)).profile.characterCreated,false);
  const configured = (await s.api(player,'avatar',aspect)).profile;
  assert.deepEqual(configured.avatar,aspect);
  assert.equal(configured.characterCreated,true);
  assert.equal((await s.api(player,'avatar',aspect)).profile.revision,configured.revision);
  const recolored = (await s.api(player,'avatar',{...original,skin:3})).profile;
  assert.deepEqual(recolored.avatar,{...aspect,skin:3});
  assert.equal(recolored.characterCreated,true);
  const restored = await s.a(s.fixtureWith());
  assert.deepEqual((await s.api(restored,'profile')).profile,recolored);
});

test('la sala publica solo el aspecto guardado y lo recupera tras reiniciar sin abrir el editor',async t=>{
  const s=await setup(t), a=await s.a(), guest=s.instance.player();
  await guest.hit('session',{nick:'Invitado'});
  const room=(await a.hit('rooms',{name:'Equipo'})).data.room;
  const before=(await guest.hit('join',{code:room.code})).data.room;
  assert.ok(before.members.every(m=>!('appearance' in m)));
  const {profile}=await s.api(a,'avatar',normalizeAvatar({species:3,gender:1,facialHair:2}));
  const expected={avatar:profile.avatar,level:profile.level};
  const [host,visitor]=(await guest.hit('session')).data.room.members;
  assert.deepEqual(host.appearance,expected);
  assert.equal('appearance' in visitor,false);
  await s.api(a,'record',{game:'ducks',value:6});
  const [leader]=(await s.api(a,'ranking',{game:'ducks'})).players;
  assert.deepEqual(leader.avatar,expected.avatar);
  assert.equal(leader.characterCreated,true);

  const resumed=await s.a(s.fixtureWith());
  await resumed.hit('rooms',{name:'Equipo otra vez'});
  let member;
  for (let i=0; i<50; i++) {
    [member]=(await resumed.hit('session')).data.room.members;
    if (member.appearance) break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.deepEqual(member.appearance,expected);
});
