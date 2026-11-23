import { createHash, randomBytes } from 'node:crypto';

const onlineWindow = 45_000;
const invitationLife = 7 * 24 * 3600_000;
const entryWindow = 120_000;
const deviceLife = 30 * 24 * 3600_000;
const maxContacts = 64;
const deviceKeyPattern = /^[a-f0-9]{64}$/;
const friendIdPattern = /^[A-F0-9]{16}$/;
const digest = value => createHash('sha256').update(value).digest('hex');

export function createSocial({ reject, throttle, enter, roomView, broadcastRoom, now = Date.now }) {
  const devices = new Map();

  function online(device) {
    return Boolean(device?.session && now() - device.seen < onlineWindow);
  }
  function activeRoom(device) {
    const room = device?.session?.room;
    return room && room.ownerId === device.session.id ? room : null;
  }
  function friends(a, b) {
    const claim = a.contacts.get(b.id);
    return Boolean(claim && claim.proof === b.contacts.get(a.id)?.proof);
  }
  function cancelKnock(visitor) {
    const request = visitor.knock;
    if (!request) return;
    devices.get(request.host)?.visitors.delete(visitor.id);
    visitor.knock = null;
  }
  function liveKnock(visitor) {
    const request = visitor?.knock;
    if (!request) return null;
    const host = devices.get(request.host);
    if (!online(host) || !online(visitor) || activeRoom(host) !== request.room
        || visitor.session.room || now() >= request.expires || !friends(visitor, host)) {
      cancelKnock(visitor);
      return null;
    }
    return request;
  }
  function dropInvite(sender, target) {
    sender?.outgoing.delete(target?.id);
    target?.incoming.delete(sender?.id);
  }
  function invitationList(owner, incoming) {
    const items = [];
    const entries = incoming ? owner.incoming : owner.outgoing;
    for (const [id, expires] of entries) {
      const peer = devices.get(id);
      if (!peer || expires <= now()) {
        entries.delete(id);
        if (peer) dropInvite(incoming ? peer : owner, incoming ? owner : peer);
      } else {
        items.push({id, nick: peer.nick});
      }
    }
    return items;
  }
  function snapshot(device) {
    const list = [];
    for (const [id, claim] of device.contacts) {
      const peer = devices.get(id);
      const visible = Boolean(online(peer) && friends(device, peer));
      const room = visible ? activeRoom(peer) : null;
      list.push({id, nick: visible ? peer.nick : claim.nick, online: visible,
        onlineSince: visible ? peer.onlineSince : null, game: visible ? peer.game : '',
        since: visible ? peer.since : null,
        room: room ? {name:room.name, ownerId:id, createdAt:room.createdAt} : null});
    }
    const knocks = [];
    for (const id of device.visitors) {
      const peer = devices.get(id);
      const request = liveKnock(peer);
      if (!request) device.visitors.delete(id);
      else if (!request.approved) knocks.push({id, nick:peer.nick});
    }
    const request = liveKnock(device);
    const host = request && devices.get(request.host);
    return {id:device.id, game:device.game, since:device.since, onlineSince:device.onlineSince,
      friends:list, incoming:invitationList(device, true), outgoing:invitationList(device, false),
      knocks, sentKnocks:request && !request.approved ? [{id:host.id,nick:host.nick}] : [],
      grants:[...device.grants.values()],
      approvedRoom:request?.approved ? {name:request.room.name, ownerId:host.id} : null,
      notice:device.notice};
  }
  function touch(device, session) {
    if (!online(device)) {
      device.onlineSince = now();
      device.game = '';
      device.since = null;
    }
    device.seen = now();
    device.nick = session.nick;
  }
  function connect(session, data) {
    if (!deviceKeyPattern.test(typeof data.deviceKey === 'string' ? data.deviceKey : '')
        || !Array.isArray(data.contacts) || data.contacts.length > maxContacts)
      reject(400, 'Identidad o contactos inválidos.');
    const fingerprint = digest('Squadlink/device/v1/' + data.deviceKey);
    const id = fingerprint.slice(0, 16).toUpperCase();
    if (session.social && session.social.id !== id) reject(409, 'La sesión pertenece a otro dispositivo.');
    const claims = data.contacts.map(c => {
      if (!c || typeof c.id !== 'string' || !friendIdPattern.test(c.id) || c.id === id
          || typeof c.nick !== 'string' || !c.nick.trim() || c.nick.length > 24
          || typeof c.token !== 'string' || !deviceKeyPattern.test(c.token))
        reject(400, 'Contacto guardado inválido.');
      return {id:c.id, nick:c.nick, proof:digest(c.token)};
    });
    let device = devices.get(id);
    if (!device) {
      if (devices.size >= 10000) reject(429, 'Servidor ocupado.');
      device = {id, fingerprint, nick:session.nick, game:'', since:null, onlineSince:now(), seen:-Infinity,
        contacts:new Map(), grants:new Map(), incoming:new Map(), outgoing:new Map(), visitors:new Set(),
        knock:null, session:null, notice:null};
    }
    if (device.fingerprint !== fingerprint) reject(409, 'El identificador de amigo ya está asignado.');
    if (new Set([...device.contacts.keys(), ...claims.map(c => c.id)]).size > maxContacts)
      reject(409, 'Llegaste al límite de amigos.');
    for (const c of claims) {
      const existing = device.contacts.get(c.id);
      if (!existing) device.contacts.set(c.id, {nick:c.nick,proof:c.proof});
      if (existing?.proof === c.proof) device.grants.delete(c.id);
    }
    devices.set(id, device);
    if (device.session && device.session !== session) {
      device.session.social = null;
      if (device.session.room) broadcastRoom(device.session.room);
    }
    touch(device, session);
    session.social = device;
    device.session = session;
    return snapshot(device);
  }
  function byId(value) {
    if (typeof value !== 'string' || !friendIdPattern.test(value.trim().toUpperCase()))
      reject(400, 'El código de amigo tiene 16 caracteres hexadecimales.');
    const peer = devices.get(value.trim().toUpperCase());
    if (!peer) reject(404, 'No encontramos ese código. Pídele que abra la app una vez.');
    return peer;
  }
  function answerFlag(value) {
    if (typeof value !== 'boolean') reject(400, 'Respuesta inválida.');
    return value;
  }
  function handle(action, session, data) {
    throttle('social/' + session.id, 150);
    if (action === 'connect') return connect(session, data);
    const self = session.social;
    if (!self || self.session !== session) reject(409, 'Conecta tu perfil de jugador.');
    touch(self, session);
    if (action === 'pulse') return snapshot(self);
    if (action === 'game') {
      if (typeof data.game !== 'string' || data.game.length > 64 || /[\x00-\x1f\x7f]/.test(data.game))
        reject(400, 'Nombre de juego inválido.');
      const game = data.game.trim();
      if (game !== self.game) {
        self.game = game;
        self.since = game ? now() : null;
        if (session.room) broadcastRoom(session.room);
      }
      return snapshot(self);
    }
    if (action === 'enter') {
      const request = liveKnock(self);
      if (!request?.approved) reject(403, 'Necesitas una invitación vigente del anfitrión.');
      enter(session, request.room);
      cancelKnock(self);
      self.notice = null;
      return {room:roomView(session.room)};
    }
    if (!['request','answer','knock','admit'].includes(action)) reject(404, 'Recurso no encontrado.');
    const peer = byId(data.id);
    if (self === peer) reject(400, 'Elige a otro jugador.');
    if (action === 'request') {
      throttle('friend-invite/' + self.id, 30);
      invitationList(self, false);
      invitationList(peer, true);
      if (friends(self, peer)) return snapshot(self);
      if (self.incoming.has(peer.id)) reject(409, 'Tienes una solicitud de ese jugador. Puedes aceptarla.');
      if (!self.outgoing.has(peer.id)) {
        if (self.outgoing.size >= maxContacts || peer.incoming.size >= maxContacts)
          reject(429, 'Hay demasiadas solicitudes pendientes.');
        const expires = now() + invitationLife;
        self.outgoing.set(peer.id, expires);
        peer.incoming.set(self.id, expires);
      }
    } else if (action === 'answer') {
      const accept = answerFlag(data.accept);
      invitationList(self, true);
      if (!self.incoming.has(peer.id)) {
        if (accept && friends(self, peer)) return snapshot(self);
        reject(404, 'La solicitud ya no está disponible.');
      }
      if (accept) {
        if ((!self.contacts.has(peer.id) && self.contacts.size >= maxContacts) ||
            (!peer.contacts.has(self.id) && peer.contacts.size >= maxContacts))
          reject(409, 'Se alcanzó el límite de amigos.');
        const token = randomBytes(32).toString('hex');
        const proof = digest(token);
        for (const [a,b] of [[self,peer],[peer,self]]) {
          a.contacts.set(b.id, {nick:b.nick,proof});
          a.grants.set(b.id, {id:b.id, nick:b.nick, token});
        }
      }
      dropInvite(peer, self);
    } else if (action === 'knock') {
      if (!friends(self, peer)) reject(403, 'Solo puedes pedir entrada a un amigo.');
      if (session.room) reject(409, 'Sal de tu sala antes de pedir entrada.');
      const room = activeRoom(peer);
      if (!online(peer) || !room) reject(409, 'Tu amigo no tiene una sala disponible.');
      if (room.members.size >= 5) reject(409, 'La sala está llena.');
      if (liveKnock(self)?.room === room) return snapshot(self);
      throttle('room-invite/' + self.id, 15);
      cancelKnock(self);
      self.notice = null;
      self.knock = {host:peer.id, room, approved:false, expires:now() + entryWindow};
      peer.visitors.add(self.id);
    } else {
      const accept = answerFlag(data.accept);
      const request = liveKnock(peer);
      if (!request || request.host !== self.id || request.room !== activeRoom(self))
        reject(403, 'No tienes una solicitud de entrada de ese jugador.');
      if (accept) {
        if (request.room.members.size >= 5) reject(409, 'La sala está llena.');
        request.approved = true;
        request.expires = now() + entryWindow;
      } else {
        peer.notice = 'Tu solicitud de entrada fue rechazada.';
        cancelKnock(peer);
      }
    }
    return snapshot(self);
  }
  function sweep() {
    for (const [id, device] of devices) {
      if (now() - device.seen > deviceLife) {
        cancelKnock(device);
        if (device.session) device.session.social = null;
        devices.delete(id);
      } else if (device.game && !online(device)) {
        device.game = '';
        device.since = null;
        if (device.session?.room) broadcastRoom(device.session.room);
      }
    }
  }
  function entering(session) {
    if (session.social) cancelKnock(session.social);
  }
  function exiting(session, room) {
    if (session.id !== room.ownerId || !session.social) return;
    for (const id of session.social.visitors) {
      const visitor = devices.get(id);
      if (visitor?.knock?.room === room) cancelKnock(visitor);
    }
  }
  return {handle, sweep, entering, exiting};
}
