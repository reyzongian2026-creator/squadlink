import http from 'node:http';
import { roomMusic, musicView } from './room-music.mjs';
import { createSocial } from './social.mjs';
import { createProgression } from './progression.mjs';
import { createPostgresStore } from './postgres-store.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createHmac, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const publicDir = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff2': 'font/woff2'
};
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function reject(status, message) { throw new HttpError(status, message); }
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0].toLowerCase() !== 'application/json')
    reject(415, 'Usa formato JSON.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) reject(413, 'Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {}
  reject(400, 'Solicitud JSON inválida.');
}
async function staticFile(req, res, pathname) {
  if (!['GET','HEAD'].includes(req.method)) reject(405, 'Método no permitido.');
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { reject(400, 'Ruta inválida.'); }
  const path = resolve(publicDir, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!path.startsWith(publicDir + sep) || !mime[extname(path)] || decoded.includes('\0'))
    reject(404, 'Archivo no encontrado.');
  let file;
  try { file = await readFile(path); } catch { reject(404, 'Archivo no encontrado.'); }
  res.writeHead(200, { 'Content-Type': mime[extname(path)], 'Cache-Control': 'no-cache', 'Content-Length': file.length });
  res.end(req.method === 'HEAD' ? undefined : file);
}

const minute = 60_000;
const sessionLife = 30 * 24 * 60 * minute;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function textField(value, min, max, label) {
  if (typeof value !== 'string') reject(400, label);
  value = value.trim();
  if (value.length < min || value.length > max || /[\x00-\x1f\x7f]/.test(value)) reject(400, label);
  return value;
}
function passwordField(data) {
  const value = data.password === undefined ? '' : data.password;
  if (typeof value !== 'string' || value.length > 128) reject(400, 'La clave admite hasta 128 caracteres.');
  return value;
}
const directoryDefaults = Object.freeze({published:false, description:'', level:'', game:'', gameCode:''});

function directorySettings(data, previous = directoryDefaults) {
  if (data === undefined) return {...previous};
  if (!data || typeof data !== 'object' || Array.isArray(data)) reject(400, 'Configuración de publicación inválida.');
  if (data.published !== undefined && typeof data.published !== 'boolean') reject(400, 'Visibilidad inválida.');
  const updated = {...previous, published:data.published ?? previous.published};
  for (const [field, limit] of [['description',160], ['level',32], ['game',64], ['gameCode',64]]) {
    if (Object.hasOwn(data, field))
      updated[field] = textField(data[field], 0, limit, 'El campo ' + field + ' admite hasta ' + limit + ' caracteres.');
  }
  return updated;
}

function publicDirectory(rooms, query) {
  const rawOffset = query.get('offset') ?? '0';
  if (!/^\d{1,6}$/.test(rawOffset)) reject(400, 'Posición del directorio inválida.');
  const offset = Number(rawOffset);
  const visible = [...rooms.values()].filter(room => room.directory.published).reverse();
  const page = visible.slice(offset, offset + 100);
  return {
    rooms:page.map(({code,name,directory,key,members,createdAt}) => ({
      code,name,description:directory.description,level:directory.level,game:directory.game,
      locked:Boolean(key),count:members.size,capacity:5,createdAt
    })),
    nextOffset:offset + page.length < visible.length ? offset + page.length : null
  };
}

function roomView(room) {
  if (!room) return null;
  return {code:room.code, name:room.name, locked:Boolean(room.key), createdAt:room.createdAt, ownerId:room.ownerId,
    directory:room.directory, music:musicView(room),
    members:[...room.members.values()].map(({id,nick,muted,joinedAt,visitId,social}) =>
      ({id,nick,muted,joinedAt,visitId,game:social?.game || '',since:social?.since ?? null,
        ...(social?.appearance && {appearance:social.appearance})}))};
}
function matchesVisit(session, {room, visitId}) {
  return (room === undefined || room === session.room?.code) &&
    (visitId === undefined || (session.room && visitId === session.visitId));
}
function writeEvent(stream, name, value) {
  if (stream.writableLength > 256 * 1024) { stream.destroy(); return; }
  stream.write('event: ' + name + '\ndata: ' + JSON.stringify(value) + '\n\n');
}
function broadcastRoom(room) {
  const view = roomView(room);
  for (const member of room.members.values()) if (member.stream) writeEvent(member.stream, 'room', view);
}
function openStream(session, res) {
  const prior = session.stream;
  session.stream = res;
  if (prior) {
    writeEvent(prior, 'superseded', {reason:'another-window'});
    prior.end();
  }
  session.disconnected = null;
  res.writeHead(200, {'Content-Type':'text/event-stream', 'Cache-Control':'no-store, no-transform',
    'Connection':'keep-alive','X-Accel-Buffering':'no'});
  writeEvent(res, 'room', roomView(session.room));
  for (const item of session.pending) if (item.time >= Date.now() - minute) writeEvent(res, 'signal', item.data);
  session.pending = [];
  res.on('close', () => {
    if (session.stream === res) {
      session.stream = null;
      session.disconnected = Date.now();
    }
  });
}
function signalPayload(data) {
  const {description, candidate} = data;
  if ((description !== undefined) === (candidate !== undefined)) reject(400, 'Señal inválida.');
  if (description !== undefined) {
    if (!description || !['offer','answer'].includes(description.type) || typeof description.sdp !== 'string'
        || !description.sdp || description.sdp.length > 48_000) reject(400, 'Descripción de voz inválida.');
    return {description: {type: description.type, sdp: description.sdp}};
  }
  if (candidate === null) return {candidate};
  if (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096)
    reject(400, 'Candidato de voz inválido.');
  const clean = {candidate: candidate.candidate};
  for (const field of ['sdpMid', 'usernameFragment']) {
    if (candidate[field] == null) continue;
    if (typeof candidate[field] !== 'string' || candidate[field].length > 256) reject(400, 'Candidato de voz inválido.');
    clean[field] = candidate[field];
  }
  if (candidate.sdpMLineIndex != null) {
    if (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 65535)
      reject(400, 'Candidato de voz inválido.');
    clean.sdpMLineIndex = candidate.sdpMLineIndex;
  }
  return {candidate: clean};
}

export function createServer(options = {}) {
  const clock = options.clock ?? Date.now;
  const social = createSocial({reject, throttle, enter, roomView, broadcastRoom, now:clock});
  const progressionEnv = options.progression?.env ?? process.env;
  const database = !options.progression?.store && progressionEnv.SQUADLINK_DATABASE_URL
    ? createPostgresStore(progressionEnv.SQUADLINK_DATABASE_URL) : null;
  const progression = createProgression({reject, throttle, now:clock, store:database, ...options.progression});
  const music = roomMusic({reject,broadcast:broadcastRoom});
  const sessions = new Map();
  const rooms = new Map();
  const limits = new Map();
  const publicOrigin = options.publicOrigin || process.env.PUBLIC_ORIGIN;
  const origin = publicOrigin ? new URL(publicOrigin).origin : null;
  const iceServers = options.iceServers ?? JSON.parse(process.env.ICE_SERVERS_JSON || '[]');
  if (!Array.isArray(iceServers)) throw Error('ICE_SERVERS_JSON debe ser un arreglo.');
  const turnUrls = (process.env.TURN_URLS || '').split(',').map(v => v.trim()).filter(Boolean);
  const turnSecret = process.env.TURN_SECRET;
  if (Boolean(turnUrls.length) !== Boolean(turnSecret)) throw Error('Configura TURN_URLS y TURN_SECRET juntos.');
  let activeHashes = 0;
  async function hash(password, salt) {
    if (activeHashes >= 4) reject(429, 'Servidor ocupado. Intenta en unos segundos.');
    activeHashes++;
    try { return await deriveKey(password, salt, 32); }
    finally { activeHashes--; }
  }
  function throttle(key, max) {
    const now = Date.now();
    let limit = limits.get(key);
    if (!limit || limit.end <= now) {
      if (!limit && limits.size >= 20000) reject(429, 'Demasiadas solicitudes.');
      limit = {end: now + minute, count: 0};
      limits.set(key, limit);
    }
    if (++limit.count > max) reject(429, 'Espera un minuto e inténtalo nuevamente.');
  }
  function leave(session) {
    // An outstanding password check must not re-enter a session after it leaves.
    session.exitVersion++;
    const room = session.room;
    if (!room) return;
    social.exiting(session, room);
    room.members.delete(session.id);
    if (room.ownerId === session.id) {
      const remaining = [...room.members.values()];
      const successor = remaining.find(member => member.stream && !member.stream.destroyed) ?? remaining[0];
      room.ownerId = successor?.id ?? null;
    }
    session.room = null;
    session.visitId = null;
    session.pending = [];
    session.stream?.end();
    session.stream = null;
    for (const member of room.members.values()) member.pending = member.pending.filter(e => e.data.from !== session.id);
    if (!room.members.size) { music.clear(room); rooms.delete(room.code); }
    else broadcastRoom(room);
  }
  function rememberAppearance(device, profile) {
    if (!device || !profile || device.id !== profile.id || profile.revision <= (device.appearanceRevision ?? -1)) return;
    device.appearanceRevision = profile.revision;
    const next = profile.characterCreated ? {avatar:profile.avatar, level:profile.level} : null;
    if (JSON.stringify(next) === JSON.stringify(device.appearance ?? null)) return;
    device.appearance = next;
    if (device.session?.room) broadcastRoom(device.session.room);
  }
  function loadRoomAppearance(session) {
    const device = session.social;
    if (!device || device.appearanceLoaded || device.appearanceRevision != null || device.loadingAppearance) return;
    device.loadingAppearance = true;
    void progression.storedAppearance(device.id).then(profile => {
      device.appearanceLoaded = true;
      rememberAppearance(device, profile);
    }).catch(() => {
      // The initials remain available if the progress store is offline.
    }).finally(() => { device.loadingAppearance = false; });
  }
  function enter(session, room) {
    if (session.room === room) return;
    if (session.room) reject(409, 'Sal de tu sala actual para entrar a otra.');
    if (room.members.size >= 5) reject(409, 'La sala está llena.');
    social.entering(session);
    session.room = room;
    session.joinedAt = clock();
    session.visitId = randomUUID();
    session.muted = true;
    session.disconnected = Date.now();
    room.members.set(session.id, session);
    loadRoomAppearance(session);
    broadcastRoom(room);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    try {
      const url = new URL(req.url, 'http://local.invalid');
      const path = url.pathname;
      if (path === '/music-youtube.html') {
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self' squad://app");
        res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
      }
      if (path === '/doom-player.html') res.setHeader('X-Frame-Options','SAMEORIGIN');
      if (!path.startsWith('/api/')) return await staticFile(req, res, path);
      const expected = origin ?? ('http://' + req.headers.host);
      if ((req.headers.origin && req.headers.origin !== expected) || req.headers['sec-fetch-site'] === 'cross-site')
        reject(403, 'Origen no permitido.');
      const key = req.headers.cookie?.match(/(?:^|;\s*)squad_session=([\w-]{43})(?=;|$)/)?.[1];
      const session = sessions.get(key);
      const exitVersion = session?.exitVersion;
      const route = req.method + ' ' + path;
      const ip = req.socket.remoteAddress || '';
      const data = req.method === 'POST' && path !== '/api/music/upload' ? await jsonBody(req) : null;
      if (route === 'GET /api/directory') return send(res, 200, publicDirectory(rooms, url.searchParams));
      if (route === 'POST /api/session') {
        const nick = textField(data.nick, 1, 24, 'El apodo debe tener entre 1 y 24 caracteres.');
        if (session) {
          session.nick = nick;
          session.used = Date.now();
          if (session.room) broadcastRoom(session.room);
          return send(res, 200, {self:{id:session.id,nick}, room:roomView(session.room)});
        }
        throttle('guest/' + ip, 60);
        if (sessions.size >= 10000) reject(429, 'Servidor ocupado.');
        const token = randomBytes(32).toString('base64url');
        const guest = {id:randomUUID(), nick, room:null, exitVersion:0, stream:null, pending:[], used:Date.now()};
        sessions.set(token, guest);
        res.setHeader('Set-Cookie', 'squad_session=' + token + '; HttpOnly; Path=/; SameSite=Strict; Max-Age='
          + sessionLife / 1000 + (expected.startsWith('https:') ? '; Secure' : ''));
        return send(res, 200, {self:{id:guest.id,nick}, room:null});
      }
      if (!session) reject(401, 'Elige tu apodo para continuar.');
      session.used = Date.now();
      if (route === 'GET /api/session') return send(res, 200, {self:{id:session.id,nick:session.nick}, room:roomView(session.room)});
      if (req.method === 'POST' && path.startsWith('/api/social/')) {
        const previous = session.social;
        const result = social.handle(path.slice('/api/social/'.length), session, data);
        if (session.room && session.social && previous !== session.social) {
          if (session.social.appearance) broadcastRoom(session.room);
          loadRoomAppearance(session);
        }
        return send(res, 200, result);
      }
      if (req.method === 'POST' && path.startsWith('/api/progress/')) {
        const device = session.social;
        const result = await progression.handle(path.slice('/api/progress/'.length), session, data);
        rememberAppearance(device, result.profile);
        return send(res, 200, result);
      }
      if (route === 'POST /api/directory') {
        const room = session.room;
        if (!room || room.ownerId !== session.id) reject(403, 'Solo el anfitrión puede editar la publicación.');
        if (!matchesVisit(session, data)) reject(409, 'La estancia en la sala ha cambiado.');
        throttle('directory-edit/' + session.id, 40);
        const directory = directorySettings(data, room.directory);
        room.directory = directory;
        broadcastRoom(room);
        return send(res, 200, {room:roomView(room)});
      }
      if (route === 'POST /api/rooms') {
        if (session.room) return send(res, 200, {room:roomView(session.room)});
        throttle('create/' + ip, 40);
        const name = textField(data.name, 1, 48, 'El nombre de sala debe tener entre 1 y 48 caracteres.');
        const password = passwordField(data);
        const directory = directorySettings(data.directory);
        const salt = password ? randomBytes(16) : null;
        const key = password ? await hash(password, salt) : null;
        if (session.exitVersion !== exitVersion) reject(409, 'Se canceló la creación de la sala.');
        if (session.room) return send(res, 200, {room:roomView(session.room)});
        let code;
        do { code = Array.from({length:6}, () => alphabet[randomInt(alphabet.length)]).join(''); }
        while (rooms.has(code));
        const room = {code,name,salt,key,directory,ownerId:session.id,createdAt:clock(),members:new Map()};
        rooms.set(code, room);
        enter(session, room);
        return send(res, 201, {room:roomView(room)});
      }
      if (route === 'POST /api/join') {
        const code = textField(data.code, 6, 6, 'El código debe tener seis caracteres.').toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) reject(400, 'Código de sala inválido.');
        const password = passwordField(data);
        if (session.room?.code === code) return send(res, 200, {room:roomView(session.room)});
        if (session.room) reject(409, 'Sal de tu sala actual antes de unirte.');
        throttle('join/' + ip, 90);
        throttle('join/' + session.id, 24);
        const room = rooms.get(code);
        if (!room) reject(404, 'No encontramos esa sala.');
        if (room.key && (!password || !timingSafeEqual(room.key, await hash(password, room.salt))))
          reject(403, 'Necesitas la clave correcta para entrar.');
        if (session.exitVersion !== exitVersion) reject(409, 'Se canceló la entrada a la sala.');
        if (rooms.get(code) !== room) reject(404, 'La sala ya terminó.');
        enter(session, room);
        return send(res, 200, {room:roomView(room)});
      }
      if (route === 'POST /api/leave') {
        if (matchesVisit(session, data)) leave(session);
        return send(res, 200, {ok:true});
      }
      const room = session.room;
      if (!room) reject(403, 'Entra a una sala primero.');
      if (path.startsWith('/api/music/')) {
        const code = data?.room ?? url.searchParams.get('room');
        if (room.code !== code) reject(403,'La pista pertenece a otra sala.');
        if (route === 'GET /api/music/file' || route === 'HEAD /api/music/file')
          return await music.file(req,res,room,url.searchParams.get('id'));
        if (req.method !== 'POST') reject(405,'Método no permitido.');
        throttle('music/'+session.id,80);
        if (route === 'POST /api/music/upload') await music.upload(req,room,session,url.searchParams);
        else music.command(path.slice('/api/music/'.length),room,session,data);
        return send(res,200,{music:musicView(room)});
      }
      if (route === 'GET /api/events') return openStream(session, res);
      if (route === 'GET /api/ice') {
        const servers = [...iceServers];
        if (turnSecret) {
          const username = (Math.floor(Date.now()/1000) + 3600) + ':' + session.id;
          servers.push({urls:turnUrls, username, credential:createHmac('sha1', turnSecret).update(username).digest('base64')});
        }
        return send(res, 200, {iceServers:servers});
      }
      if (route === 'POST /api/member') {
        if (!matchesVisit(session, data)) reject(409, 'La estancia en la sala ha cambiado.');
        if (typeof data.muted !== 'boolean') reject(400, 'Estado de micrófono inválido.');
        if (session.muted !== data.muted) {
          session.muted = data.muted;
          broadcastRoom(room);
        }
        return send(res, 200, {ok:true});
      }
      if (route === 'POST /api/signal') {
        throttle('signal/' + session.id, 1000);
        const peer = room.members.get(data.to);
        if (!peer || peer === session) reject(403, 'Destinatario fuera de la sala.');
        const signal = {from:session.id, ...signalPayload(data)};
        if (peer.stream) writeEvent(peer.stream, 'signal', signal);
        else {
          if (peer.pending.length >= 128) reject(429, 'El jugador aún no está conectado.');
          peer.pending.push({time:Date.now(),data:signal});
        }
        return send(res, 200, {ok:true});
      }
      reject(404, 'Recurso no encontrado.');
    } catch (error) {
      if (res.headersSent) return res.end();
      send(res, error.status || 500, {error: error.status ? error.message : 'Error interno.'});
    }
  });
  const timer = setInterval(() => {
    const now = Date.now();
    social.sweep();
    for (const [key, limit] of limits) if (limit.end <= now) limits.delete(key);
    for (const [token, session] of sessions) {
      if (session.stream) {
        session.stream.write(': keepalive\n\n');
        session.used = now;
      } else if (session.room && now - session.disconnected > minute) leave(session);
      else if (!session.room && now - session.used > sessionLife) sessions.delete(token);
    }
  }, 15000);
  timer.unref();
  server.on('close', () => {
    clearInterval(timer);
    for (const room of rooms.values()) music.clear(room);
    database?.close().catch(() => console.error('No se pudo cerrar el almacén de progreso.'));
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(Number(process.env.PORT ?? 4179), host, () => {
    console.log('Squadlink http://' + host + ':' + server.address().port);
  });
}
