import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fixture } from './support/http.mjs';

function ok(result) {
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result));
  return result.data;
}
const key = () => randomBytes(32).toString('hex');
async function device(f, nick, deviceKey = key(), contacts = []) {
  const player = f.player();
  const {self} = ok(await player.hit('session', {nick}));
  const call = (action, data = {}) => player.hit('social/' + action, data);
  const {id} = ok(await call('connect', {deviceKey, contacts}));
  return {...player, id, deviceKey, nick, self, call};
}
async function pair(a, b) {
  ok(await a.call('request', {id:b.id}));
  const accepted = ok(await b.call('answer', {id:a.id, accept:true}));
  return {a:ok(await a.call('pulse')).grants, b:accepted.grants};
}

test('el código de amigo permite enviar solicitudes sin exponer la actividad anterior a la aceptación', async t => {
  const f = fixture(t);
  const a = await device(f, 'Gian'), b = await device(f, 'Majo'), c = await device(f, 'Eli');
  ok(await b.call('game', {game:'VALORANT'}));
  assert.match(a.id, /^[A-F0-9]{16}$/);
  assert.deepEqual(ok(await a.call('request', {id:b.id})).outgoing, [{id:b.id,nick:b.nick}]);
  const pending = ok(await b.call('pulse'));
  assert.deepEqual(pending.incoming, [{id:a.id,nick:a.nick}]);
  assert.equal(pending.friends.length, 0);
  assert.equal((await c.call('answer', {id:a.id,accept:true})).status, 404);
  ok(await b.call('answer', {id:a.id,accept:false}));
  assert.equal(ok(await a.call('pulse')).outgoing.length, 0);
  const grants = await pair(a, b);
  assert.equal(grants.a[0].token, grants.b[0].token);
  assert.equal(ok(await a.call('pulse')).friends[0].game, 'VALORANT');
  assert.ok(!JSON.stringify(pending).includes(a.deviceKey));
});

test('dos pruebas recíprocas restauran amistad tras reiniciar; una ficha inventada no revela presencia ni sala', async t => {
  const first = fixture(t);
  const a = await device(first,'Ada'), b = await device(first,'Sol');
  const grants = await pair(a,b);
  const fresh = fixture(t);
  const restoredA = await device(fresh,a.nick,a.deviceKey,grants.a);
  assert.equal(restoredA.id, a.id);
  assert.equal(ok(await restoredA.call('pulse')).friends[0].online, false);
  const restoredB = await device(fresh,b.nick,b.deviceKey,grants.b);
  assert.equal(ok(await restoredA.call('pulse')).friends[0].online, true);
  const guessed = await device(fresh,'Intruso',key(),[{id:b.id,nick:'Sol',token:grants.a[0].token}]);
  const hidden = ok(await guessed.call('pulse')).friends[0];
  assert.equal(hidden.online, false);
  assert.equal(hidden.room, null);
  assert.equal((await guessed.call('knock', {id:restoredB.id})).status, 403);
  assert.equal((await restoredA.call('connect',{deviceKey:key(),contacts:[]})).status,409);
});

test('duración de juego, presencia expirada y regreso con el mismo dispositivo', async t => {
  let time = 1700000000000;
  const f = fixture(t,{clock:() => time});
  const a = await device(f,'Uno'), b = await device(f,'Dos');
  await pair(a,b);
  const start = ok(await b.call('game',{game:'Rocket League'})).since;
  time += 20_000;
  assert.equal(ok(await b.call('game',{game:'Rocket League'})).since, start);
  const visible = ok(await a.call('pulse')).friends[0];
  assert.equal(visible.game, 'Rocket League');
  assert.equal(visible.onlineSince, start);
  time += 45_001;
  const offline = ok(await a.call('pulse')).friends[0];
  assert.deepEqual([offline.online,offline.game,offline.since,offline.room], [false,'',null,null]);
  ok(await b.call('pulse'));
  const back = ok(await a.call('pulse')).friends[0];
  assert.deepEqual([back.online,back.game,back.onlineSince], [true,'',time]);
});

test('el anfitrión admite a un amigo en sala privada sin divulgar código y transfiere la propiedad al salir', async t => {
  const f = fixture(t);
  const a = await device(f,'Host'), b = await device(f,'Amiga'), c = await device(f,'Tercero');
  await pair(a,b);
  const room = ok(await a.hit('rooms',{name:'Ranked',password:'privada'})).room;
  assert.equal(room.ownerId, a.self.id);
  assert.ok(room.members[0].joinedAt >= room.createdAt);
  const visible = ok(await b.call('pulse')).friends[0].room;
  assert.deepEqual(Object.keys(visible).sort(), ['createdAt','name','ownerId']);
  assert.equal(visible.ownerId, a.id);
  assert.equal((await c.call('knock',{id:a.id})).status,403);
  ok(await b.call('knock',{id:a.id}));
  assert.equal(ok(await a.call('pulse')).knocks[0].id,b.id);
  assert.equal((await c.call('admit',{id:b.id,accept:true})).status,403);
  assert.equal((await b.call('enter')).status,403);
  ok(await a.call('admit',{id:b.id,accept:false}));
  assert.match(ok(await b.call('pulse')).notice,/rechazada/);
  ok(await b.call('knock',{id:a.id}));
  ok(await a.call('admit',{id:b.id,accept:true}));
  assert.equal(ok(await b.call('pulse')).approvedRoom.name,'Ranked');
  const joined = ok(await b.call('enter')).room;
  assert.equal(joined.code,room.code);
  assert.equal(joined.members.length,2);
  assert.equal((await b.call('enter')).status,403);
  ok(await a.hit('leave',{}));
  assert.equal(ok(await b.hit('session')).room.ownerId,b.self.id);
});

test('autorizaciones caducan y dejan de valer cuando el anfitrión crea otra sala', async t => {
  let time = 100000;
  const f = fixture(t,{clock:() => time});
  const a = await device(f,'A'), b = await device(f,'B');
  await pair(a,b);
  ok(await a.hit('rooms',{name:'Dúo'}));
  ok(await b.call('knock',{id:a.id}));
  ok(await a.call('admit',{id:b.id,accept:true}));
  for (let i = 0; i < 4; i++) {
    time += 31_000;
    ok(await a.call('pulse')); ok(await b.call('pulse'));
  }
  assert.equal((await b.call('enter')).status,403);
  ok(await b.call('knock',{id:a.id}));
  ok(await a.call('admit',{id:b.id,accept:true}));
  ok(await a.hit('leave',{})); ok(await a.hit('rooms',{name:'Nueva'}));
  assert.equal((await b.call('enter')).status,403);
});
