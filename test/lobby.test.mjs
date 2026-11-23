import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/http.mjs';

function ok(response) {
  assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response));
  return response.data;
}

function rejected(response) {
  assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(response));
  assert.equal(typeof response.data.error, 'string');
}

async function guest(f, nick) {
  const actor = f.player();
  const response = await actor.hit('session', { nick });
  const { self } = ok(response);
  assert.equal(self.nick, nick);
  return { ...actor, self };
}

test('el apodo pertenece a una sesión persistente y al mismo cliente', async t => {
  const f = fixture(t);
  const player = f.player();
  assert.equal((await player.hit('session')).status, 401);
  rejected(await player.hit('session', { nick: '' }));
  const login = await player.hit('session', { nick: 'Gian' });
  const { self } = ok(login);
  assert.match(login.headers['set-cookie'][0], /HttpOnly/i);
  assert.match(login.headers['set-cookie'][0], /SameSite=/i);
  assert.deepEqual(ok(await player.hit('session')).self, self);
  assert.equal((await f.player().hit('session')).status, 401);
  rejected(await player.hit('rooms', { name: 'Lobby' }, { origin: 'https://otro.example' }));
});

test('sala abierta, código compartido, mute y salida con eliminación de sala vacía', async t => {
  const f = fixture(t);
  const host = await guest(f, 'Gian');
  const friend = await guest(f, 'Diego');
  const { room } = ok(await host.hit('rooms', { name: 'Ranked' }));
  assert.match(room.code, /^[A-Z0-9]{6}$/);
  assert.equal(room.locked, false);
  assert.equal(room.members.length, 1);
  const joined = ok(await friend.hit('join', { code: room.code.toLowerCase() })).room;
  assert.equal(joined.members.length, 2);
  assert.equal(ok(await friend.hit('join', { code: room.code })).room.members.length, 2);
  ok(await friend.hit('member', { muted: true }));
  assert.equal(ok(await host.hit('session')).room.members.find(m => m.id === friend.self.id).muted, true);
  ok(await friend.hit('leave', {}));
  assert.equal(ok(await host.hit('session')).room.members.length, 1);
  assert.equal(ok(await friend.hit('session')).room, null);
  ok(await host.hit('leave', {}));
  rejected(await friend.hit('join', { code: room.code }));
});

test('clave opcional, errores de acceso y aislamiento entre salas', async t => {
  const f = fixture(t);
  const host = await guest(f, 'Gian');
  const guestA = await guest(f, 'Ana');
  const other = await guest(f, 'Luis');
  const key = 'prueba-582';
  const { room } = ok(await host.hit('rooms', { name: 'Privada', password: key }));
  assert.equal(room.locked, true);
  assert.ok(!JSON.stringify(room).includes(key));
  rejected(await guestA.hit('join', { code: room.code }));
  rejected(await guestA.hit('join', { code: room.code, password: 'incorrecta' }));
  assert.equal(ok(await guestA.hit('session')).room, null);
  assert.equal(ok(await host.hit('session')).room.members.length, 1);
  ok(await guestA.hit('join', { code: room.code, password: key }));
  ok(await other.hit('rooms', { name: 'Otra' }));
  rejected(await other.hit('signal', { to: host.self.id, description: { type: 'offer', sdp: 'v=0' } }));
  rejected(await host.hit('member', { muted: 'sí' }));
});

test('cuando hay un único sitio libre, solo una incorporación simultánea lo ocupa', async t => {
  const f = fixture(t);
  const host = await guest(f, 'Gian');
  const { room } = ok(await host.hit('rooms', { name: 'Duelo', password: 'privada-123' }));
  const friends = await Promise.all(['Ada', 'Beto', 'Caro', 'Dani', 'Eva'].map(nick => guest(f, nick)));
  const join = player => player.hit('join', { code: room.code, password: 'privada-123' });
  for (const player of friends.slice(0, 3)) ok(await join(player));
  const statuses = (await Promise.all(friends.slice(3).map(join))).map(r => r.status);
  assert.equal(statuses.filter(s => s >= 200 && s < 300).length, 1);
  assert.ok(statuses.includes(409));
  assert.equal(ok(await host.hit('session')).room.members.length, 5);
});

async function* events(response) {
  response.setEncoding('utf8');
  let buffer = '';
  for await (const chunk of response) {
    buffer += chunk.replaceAll('\r', '');
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0,end);
      buffer = buffer.slice(end + 2);
      const name = /^event: *(.+)$/m.exec(frame)?.[1];
      const data = /^data: *(.+)$/m.exec(frame)?.[1];
      if (name && data) yield { name, data: JSON.parse(data) };
    }
  }
}

test('SSE entrega instantánea y señal al destinatario con identidad de servidor', { timeout: 5000 }, async t => {
  const f = fixture(t);
  const first = await guest(f, 'Gian');
  const second = await guest(f, 'Majo');
  const { room } = ok(await first.hit('rooms', { name: 'Dúo' }));
  ok(await second.hit('join', { code: room.code }));
  const description = { type: 'offer', sdp: 'v=0\r\n' };
  ok(await first.hit('signal', { to: second.self.id, description }));
  const stream = await second.request('/api/events');
  assert.match(stream.headers['content-type'], /text\/event-stream/);
  const frames = events(stream);
  const snapshot = (await frames.next()).value;
  assert.equal(snapshot.name, 'room');
  assert.equal(snapshot.data.members.length, 2);
  const signal = (await frames.next()).value;
  assert.equal(signal.name, 'signal');
  assert.equal(signal.data.from, first.self.id);
  assert.deepEqual(signal.data.description, description);
  assert.ok(Array.isArray(ok(await second.hit('ice')).iceServers));
});

test('el lobby y todos sus recursos iniciales, iconos y manifiesto se sirven sin cargar el arcade', async t => {
  const f = fixture(t);
  const guest = f.player();
  const checked = new Set();
  async function asset(path) {
    const res = await guest.request(path);
    assert.equal(res.statusCode, 200, path);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    checked.add(path);
    return Buffer.concat(chunks);
  }
  const html = (await asset('/')).toString();
  assert.ok(!html.includes('<video'));
  const links = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(m => m[1]);
  for (const path of new Set(links)) {
    const body = await asset(path);
    if (path.endsWith('.css')) {
      for (const image of body.toString().matchAll(/url\(['"]?(\/[^)'"]+)/g)) await asset(image[1]);
    }
    if (path.endsWith('.webmanifest')) {
      const manifest = JSON.parse(body);
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.start_url, '/');
      for (const icon of manifest.icons) {
        const png = await asset(icon.src);
        assert.equal(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), icon.sizes);
      }
    }
  }
  assert.ok(checked.has('/app.js') && checked.has('/install.js') && checked.has('/manifest.webmanifest'));
  assert.ok(!checked.has('/arcade.js'));
});

test('diez salas mantienen cincuenta suscripciones y entregan señales en paralelo', {timeout:10000}, async t => {
  const f = fixture(t);
  const rooms = await Promise.all(Array.from({length:10}, async (_, index) => {
    const members = await Promise.all(Array.from({length:5}, (_, n) => guest(f, 'Jugador ' + index + '-' + n)));
    const {room} = ok(await members[0].hit('rooms', {name:'Lobby ' + index}));
    await Promise.all(members.slice(1).map(async member => ok(await member.hit('join', {code:room.code}))));
    const streams = await Promise.all(members.map(async member => {
      const frames = events(await member.request('/api/events'));
      const snapshot = (await frames.next()).value;
      assert.equal(snapshot.data.code, room.code);
      assert.equal(snapshot.data.members.length, 5);
      return frames;
    }));
    return {members, streams, code:room.code};
  }));
  assert.equal(new Set(rooms.map(room => room.code)).size, 10);
  await Promise.all(rooms.map(async ({members, streams}) => {
    await Promise.all(members.map(async (sender, i) => {
      const j = (i+1) % members.length;
      ok(await sender.hit('signal', {to:members[j].self.id, description:{type:'offer',sdp:'v=0\r\n'}}));
      const message = (await streams[j].next()).value;
      assert.equal(message.name, 'signal');
      assert.equal(message.data.from, sender.self.id);
    }));
  }));
});
