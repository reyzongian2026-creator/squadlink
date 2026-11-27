import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/http.mjs';

async function guest(f, nick) {
  const p = f.player();
  assert.equal((await p.hit('session', {nick})).status, 200);
  return p;
}
test('el directorio muestra solo publicaciones y reserva el código de juego para miembros admitidos', async t => {
  const f = fixture(t);
  const visitor = f.player(), owner = await guest(f, 'Capi'), other = await guest(f, 'Aliada');
  const room = (await owner.hit('rooms',{name:'Premade', password:'voz-secreta',directory:{gameCode:'partida-secreta'}})).data.room;
  assert.equal(room.directory.published, false);
  assert.deepEqual((await visitor.hit('directory')).data.rooms, []);
  assert.equal((await other.hit('directory',{published:true})).status, 403);
  const directory = {published:true, description:'Una partida antes de cenar', level:'Platino', game:'Valorant'};
  assert.equal((await owner.hit('directory', directory)).status, 200);
  const list = (await visitor.hit('directory')).data;
  assert.equal(list.nextOffset, null);
  assert.deepEqual(list.rooms,[{code:room.code,name:'Premade',description:directory.description,level:'Platino',
    game:'Valorant',locked:true,count:1,capacity:5,createdAt:room.createdAt}]);
  assert.ok(!JSON.stringify(list).includes('secreta'));
  assert.equal((await other.hit('join',{code:room.code,password:'incorrecta'})).status,403);
  assert.equal((await visitor.hit('directory')).data.rooms[0].count, 1);
  assert.equal((await other.hit('join',{code:room.code,password:'voz-secreta'})).data.room.directory.gameCode,'partida-secreta');
  assert.equal((await other.hit('directory',{published:false})).status,403);
  assert.equal((await visitor.hit('directory')).data.rooms[0].count,2);
  assert.equal((await owner.hit('directory',{published:false})).status,200);
  assert.deepEqual((await visitor.hit('directory')).data.rooms,[]);
});

test('creación opt-in, validación atómica, orden de salas y traspaso de propiedad', async t => {
  const f = fixture(t);
  const owner = await guest(f,'Eli'), friend = await guest(f,'Gian'), second = await guest(f,'Majo'), visitor = f.player();
  assert.equal((await owner.hit('rooms',{name:'Fallida',directory:{published:'true'}})).status,400);
  assert.deepEqual((await visitor.hit('directory')).data.rooms,[]);
  const room = (await owner.hit('rooms',{name:'Primer grupo',directory:{published:true, description:'Original'}})).data.room;
  const newer = (await second.hit('rooms',{name:'Segundo grupo',directory:{published:true}})).data.room;
  assert.deepEqual((await visitor.hit('directory')).data.rooms.map(x=>x.code), [newer.code,room.code]);
  assert.equal((await owner.hit('directory',{published:false,description:'x'.repeat(161)})).status,400);
  assert.equal((await visitor.hit('directory?offset=1')).data.rooms[0].description,'Original');
  assert.equal((await visitor.hit('directory?offset=-1')).status,400);
  assert.equal((await friend.hit('join',{code:room.code})).status,200);
  assert.equal((await owner.hit('leave',{})).status,200);
  assert.equal((await owner.hit('directory',{gameCode:'otra'})).status,403);
  assert.equal((await friend.hit('directory',{gameCode:'para-equipo'})).data.room.directory.gameCode,'para-equipo');
  assert.equal((await friend.hit('leave',{})).status,200);
  assert.deepEqual((await visitor.hit('directory')).data.rooms.map(x=>x.code),[newer.code]);
});

test('actualizar conserva todas las páginas abiertas, incluso cuando cambia el orden o falla una página', async () => {
  const { loadDirectoryPages } = await import('../public/directory.js');
  const room = code => ({ code, name: 'Sala ' + code });
  let published = ['A', 'B', 'C', 'D', 'E'];
  let failSecond = false;
  const calls = [];
  async function api(path) {
    const offset = Number(new URL(path, 'http://localhost').searchParams.get('offset') || 0);
    calls.push(offset);
    if (failSecond && offset === 2) throw Error('Sin conexión');
    const rooms = published.slice(offset, offset + 2).map(room);
    return { rooms, nextOffset: offset + 2 < published.length ? offset + 2 : null };
  }
  let listing = await loadDirectoryPages(api, {rooms: [], pages: 0, nextOffset: null});
  listing = await loadDirectoryPages(api, listing, true);
  assert.deepEqual(calls.splice(0), [0, 2]);
  assert.deepEqual(listing, {rooms: ['A', 'B', 'C', 'D'].map(room), pages: 2, nextOffset: 4});
  published = ['F', 'A', 'C', 'D', 'E'];
  failSecond = true;
  await assert.rejects(loadDirectoryPages(api, listing), /Sin conexión/);
  assert.deepEqual(listing.rooms, ['A', 'B', 'C', 'D'].map(room));
  failSecond = false;
  listing = await loadDirectoryPages(api, listing);
  assert.deepEqual(listing.rooms, ['F', 'A', 'C', 'D'].map(room));
  const last = await loadDirectoryPages(api, listing, true);
  assert.deepEqual(last.rooms, ['F','A','C','D','E'].map(room));
  assert.equal(await loadDirectoryPages(api, last, true), last);
  published = ['C'];
  assert.deepEqual(await loadDirectoryPages(api, last), {rooms: [room('C')], pages: 1, nextOffset: null});
});

test('al salir el anfitrión, el siguiente jugador conectado conserva el código y los permisos', async t => {
  const f = fixture(t);
  const owner = await guest(f, 'Pepe');
  const offline = await guest(f, 'Alex');
  const active = await guest(f, 'Sol');
  const {code} = (await owner.hit('rooms', {name:'Grupo', directory:{published:true}})).data.room;
  await offline.hit('join', {code});
  await active.hit('join', {code});
  const events = await active.request('/api/events');
  try {
    assert.equal((await owner.hit('leave', {})).status, 200);
    const {room, self} = (await active.hit('session')).data;
    assert.equal(room.code, code);
    assert.equal(room.members.length, 2);
    assert.equal(room.ownerId, self.id);
    assert.equal((await offline.hit('directory', {description:'Cambio'})).status, 403);
    assert.equal((await active.hit('directory', {published:true, description:'Seguimos jugando'})).status, 200);
  } finally { events.destroy(); }
});
