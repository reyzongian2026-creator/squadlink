import { randomUUID } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fileLimit = 20 * 1024 * 1024;
const roomLimit = 4 * fileLimit;
const totalLimit = 12 * fileLimit;
const maxTracks = 30;

function audioType(header) {
  const magic = header.toString('latin1');
  if (magic.startsWith('ID3') || (header[0] === 255 && (header[1] & 224) === 224))
    return header[0] === 255 && (header[1] & 246) === 240 ? 'audio/aac' : 'audio/mpeg';
  if (magic.startsWith('RIFF') && magic.slice(8,12) === 'WAVE') return 'audio/wav';
  if (magic.startsWith('fLaC')) return 'audio/flac';
  if (magic.startsWith('OggS')) return 'audio/ogg';
  if (magic.slice(4,8) === 'ftyp') return 'audio/mp4';
  if (header.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm';
  return null;
}
export function musicView(room) {
  const music = room.music;
  return {startedAt:music?.startedAt ?? null, serverNow:Date.now(),
    queue:music?.queue.map(({file,...track}) => track) ?? []};
}
export function roomMusic({reject,broadcast}) {
  let reserved = 0;
  function get(room) {
    return room.music ??= {queue:[],startedAt:null,timer:null,bytes:0,uploads:0};
  }
  function remove(file, state) {
    if (!file) return;
    reserved -= file.bytes;
    state.bytes -= file.bytes;
    unlink(file.path).catch(() => {});
  }
  function schedule(room) {
    const state = get(room);
    clearTimeout(state.timer);
    const current = state.queue[0];
    if (current?.duration) {
      const delay = Math.max(1, state.startedAt + current.duration * 1000 - Date.now());
      state.timer = setTimeout(() => advance(room,current.id), delay);
      state.timer.unref();
    }
  }
  function advance(room,id) {
    const state = get(room);
    if (!id || state.queue[0]?.id !== id) return;
    remove(state.queue.shift().file,state);
    state.startedAt = state.queue.length ? Date.now() : null;
    schedule(room);
    broadcast(room);
  }
  function append(room,track) {
    const state = get(room);
    state.queue.push(track);
    if (state.queue.length === 1) { state.startedAt = Date.now(); schedule(room); }
    broadcast(room);
  }
  function clear(room) {
    if (!room.music) return;
    clearTimeout(room.music.timer);
    for (const track of room.music.queue) remove(track.file,room.music);
    room.music.queue.length = 0;
  }
  function name(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 160)
      reject(400,'Pon un título de entre 1 y 160 caracteres.');
    return value.trim();
  }
  function duration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 43200) reject(400,'Duración de pista inválida.');
    return seconds;
  }
  function hasSpace(state) {
    if (state.queue.length + state.uploads >= maxTracks) reject(409,'La cola está llena.');
  }
  async function upload(req, room, session, query) {
    const state = get(room);
    hasSpace(state);
    const title = name(query.get('title'));
    const seconds = duration(query.get('duration'));
    if (Number(req.headers['content-length']) > fileLimit) reject(413,'Máximo 20 MiB por archivo.');
    if (state.bytes + fileLimit > roomLimit || reserved + fileLimit > totalLimit)
      reject(429,'Espera a que termine una pista antes de subir otra.');
    const id = randomUUID(), path = join(tmpdir(),'squadlink-music-'+id);
    state.uploads++; state.bytes += fileLimit; reserved += fileLimit;
    let handle, bytes = 0, kept = false;
    try {
      handle = await open(path,'wx+',0o600);
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > fileLimit) reject(413,'Máximo 20 MiB por archivo.');
        await handle.writeFile(chunk);
      }
      const header = Buffer.alloc(16);
      await handle.read(header,0,header.length,0);
      const type = bytes >= 12 && audioType(header);
      if (!type) reject(415,'Elige un archivo MP3, WAV, AAC, M4A, Ogg, WebM o FLAC.');
      if (session.room !== room || !room.members.has(session.id)) reject(409,'Ya saliste de esta sala.');
      append(room,{id,kind:'file',title,duration:seconds,addedBy:session.nick,file:{bytes,path,type}});
      kept = true;
    } finally {
      state.uploads--;
      state.bytes -= fileLimit - (kept ? bytes : 0);
      reserved -= fileLimit - (kept ? bytes : 0);
      await handle?.close();
      if (!kept && handle) await unlink(path).catch(()=>{});
    }
  }
  async function file(req,res,room,id) {
    const file = get(room).queue.find(track=>track.id===id)?.file;
    if (!file) reject(404,'La pista ya no está en esta sala.');
    let start = 0, end = file.bytes-1;
    const range = req.headers.range;
    const headers = {'Content-Type':file.type,'Cache-Control':'private, no-store','Accept-Ranges':'bytes'};
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        start = m[1] ? Number(m[1]) : Math.max(0,file.bytes-Number(m[2]));
        end = m[1] && m[2] ? Math.min(end,Number(m[2])) : end;
      }
      if (!m || !(m[1] || m[2]) || !Number.isSafeInteger(start) || start>end) {
        res.writeHead(416,{...headers,'Content-Range':'bytes */'+file.bytes});res.end();return;
      }
      headers['Content-Range'] = 'bytes '+start+'-'+end+'/'+file.bytes;
    }
    const handle = await open(file.path,'r').catch(()=>null);
    if (!handle) reject(404,'La pista ya terminó.');
    res.writeHead(range ? 206 : 200,{...headers,'Content-Length':end-start+1});
    if (req.method==='HEAD') { await handle.close(); res.end(); return; }
    const stream = handle.createReadStream({start,end});
    res.on('close',()=>stream.destroy());
    stream.on('error',()=>res.destroy());
    stream.pipe(res);
  }
  function command(action,room,session,data) {
    const state = get(room);
    if (action==='add') {
      hasSpace(state);
      if (!/^[A-Za-z0-9_-]{11}$/.test(data.videoId ?? '') || typeof data.videoId !== 'string') reject(400,'Enlace de YouTube inválido.');
      append(room,{id:randomUUID(),kind:'youtube',videoId:data.videoId,title:name(data.title),
        duration:data.duration ? duration(data.duration) : null,addedBy:session.nick});
    } else if (action==='duration') {
      if (state.queue[0]?.id===data.id && !state.queue[0].duration) {
        state.queue[0].duration=duration(data.duration); schedule(room); broadcast(room);
      }
    } else if (action==='next' || action==='ended') advance(room,data.id);
    else reject(404,'Acción de música desconocida.');
  }
  return {upload,file,command,clear};
}
