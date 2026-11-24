import { arcadeBoards, reportedGames, validRecord, improvesRecord } from './public/arcade-boards.js';
import { avatarOptions, defaultAvatar, normalizeAvatar, progressForXp, validAvatarOption } from './public/character-model.js';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const maximumRound = 12;
const runLifetime = 120_000;
const originalAvatarFields = ['skin','outfit','headgear'];
const characterFields = ['species','gender','build','facialHair'];
const gameNames = new Set(['reflex','sequence']);
const boards = ['xp',...Object.keys(arcadeBoards)];
const redisPrefix = '{squadlink}:v1:';
const commitScript = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if (current or '') ~= ARGV[2] then return 0 end
redis.call('HSET',KEYS[1],ARGV[1],ARGV[3])
for i = 2, #KEYS do
  local score = tonumber(ARGV[i + 2])
  if score then redis.call('ZADD', KEYS[i], score, ARGV[1]) end
end
return 1`;
const rankingScript = `
local ids = redis.call('ZRANGE', KEYS[1], 0, 29)
if #ids == 0 then return {} end
return redis.call('HMGET', KEYS[2], unpack(ids))`;

function initial(id,nick) {
  return {id,nick,xp:0,avatar:{...defaultAvatar},characterCreated:false,best:{reflex:null,sequence:0},revision:0,awards:[]};
}
function display(row) {
  const {id,nick,xp,avatar,best} = row;
  return {id,nick,xp,...progressForXp(xp),avatar:normalizeAvatar(avatar),characterCreated:row.characterCreated === true,best,revision:row.revision};
}

function redisStore(url,token) {
  if (new URL(url).protocol !== 'https:') throw Error('Redis REST requiere HTTPS.');
  async function command(args) {
    const response = await fetch(url, {method:'POST',redirect:'error',signal:AbortSignal.timeout(4500),
      headers:{authorization:'Bearer ' + token,'content-type':'application/json'},body:JSON.stringify(args)});
    if (!response.ok) throw Error('Redis REST no disponible.');
    const result = await response.json();
    if (result.error) throw Error('Redis rechazó la operación.');
    return result.result;
  }
  const profiles = redisPrefix + 'profiles';
  return {
    scope:'global',
    async update(id, transform) {
      for (let i=0; i<6; i++) {
        const raw = await command(['HGET',profiles,id]);
        const row = raw && JSON.parse(raw);
        const next = transform(row);
        if (row === next) return row;
        const scores = boards.map(game=>{
          const score = game === 'xp' ? next.xp : next.best[game];
          if (!(score > 0)) return '';
          return arcadeBoards[game]?.order === 'min' ? score : -score;
        });
        const committed = await command(['EVAL',commitScript,boards.length+1,profiles,...boards.map(b=>redisPrefix+b),
          id,raw || '',JSON.stringify(next),...scores]);
        if (committed === 1) return next;
      }
      throw Error('Cambios simultáneos en el perfil.');
    },
    async ranking(board) {
      const values = await command(['EVAL',rankingScript,2,redisPrefix+board,profiles]);
      return values.map(value=>JSON.parse(value));
    }
  };
}

function localStore(file,scope) {
  let rows;
  let queue = Promise.resolve();
  async function load() {
    if (rows) return;
    const empty = Object.create(null);
    if (!file) { rows = empty; return; }
    try { rows = JSON.parse(await readFile(file,'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; rows = empty; }
  }
  function exclusive(operation) {
    const pending = queue.then(async()=>{await load(); return operation();});
    queue = pending.catch(()=>{});
    return pending;
  }
  return {scope,
    update(id,transform) {
      return exclusive(async()=>{
        const row = rows[id];
        const next = transform(row);
        if (next === row) return next;
        if (!row && Object.keys(rows).length >= 10000) throw Error('Almacén de perfiles lleno.');
        if (file) {
          await mkdir(dirname(file),{recursive:true, mode:0o700});
          const tmp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
          try {
            await writeFile(tmp, JSON.stringify({...rows,[id]:next}),{mode:0o600, flag:'wx', flush:true});
            await rename(tmp,file);
          } finally { await rm(tmp,{force:true}); }
        }
        rows[id]=next;
        return next;
      });
    },
    ranking(board) {
      return exclusive(()=>{
        const value = row => board === 'xp' ? row.xp : row.best[board];
        const sign = arcadeBoards[board]?.order === 'min' ? 1 : -1;
        return Object.values(rows).filter(row=>value(row)>0)
          .sort((a,b)=>sign*(value(a)-value(b)) || a.id.localeCompare(b.id)).slice(0,30);
      });
    }
  };
}

export function createProgression({reject,throttle,now=Date.now,env=process.env,file,store}={}) {
  const redisUrl = env.UPSTASH_REDIS_REST_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
  if (Boolean(redisUrl) !== Boolean(redisToken)) throw Error('Configura ambas variables de Redis REST.');
  const secret = env.SQUADLINK_RECEIPT_SECRET;
  if (secret && Buffer.byteLength(secret) < 32) throw Error('SQUADLINK_RECEIPT_SECRET requiere 32 bytes o más.');
  const dataFile = file ?? env.SQUADLINK_PROGRESS_FILE;
  const ephemeral = env.RENDER === 'true' && !dataFile;
  const db = store ?? (redisUrl ? redisStore(redisUrl,redisToken) :
    localStore(ephemeral ? null : resolve(dataFile || 'data/progression.json'),ephemeral ? 'session':'local'));
  const active = new Map();
  function receipt(row,device) {
    if (!secret) return {};
    const body = Buffer.from(JSON.stringify({v:1,owner:device.fingerprint,row})).toString('base64url');
    const tag = createHmac('sha256',secret).update(body).digest('base64url');
    return {receipt:body+'.'+tag};
  }
  function restore(token,device) {
    if (token == null || !secret) return null;
    if (typeof token !== 'string' || token.length > 12000) reject(400,'El respaldo de progreso es inválido.');
    const [body,tag,...extra] = token.split('.');
    const expected = createHmac('sha256',secret).update(body).digest();
    const actual = Buffer.from(tag || '','base64url');
    if (extra.length || actual.length !== expected.length || !timingSafeEqual(expected,actual))
      reject(400,'La firma del respaldo de progreso es inválida.');
    let saved;
    try { saved = JSON.parse(Buffer.from(body,'base64url').toString()); }
    catch { reject(400,'El respaldo de progreso es inválido.'); }
    if (saved?.v !== 1 || saved.owner !== device.fingerprint || saved.row?.id !== device.id)
      reject(403,'Este respaldo pertenece a otro perfil.');
    return saved.row;
  }
  async function access(operation) {
    try { return await operation(); }
    catch { reject(503,'El almacén de progreso no está disponible. Intenta de nuevo.'); }
  }
  function runFor(id,runId) {
    const run = active.get(id);
    if (!run || run.id !== runId || now() > run.expires)
      reject(409,'La partida ya terminó o caducó. Inicia otra.');
    return run;
  }
  return {
    async handle(action,session,data) {
      const device = session.social;
      if (!device || device.session !== session) reject(409,'Conecta tu perfil de jugador.');
      if (db.scope === 'session' && !secret) reject(503,'El servidor todavía no tiene almacenamiento de progreso configurado.');
      const id = device.id;
      throttle('progress/'+id,120);
      const payload = row=>({profile:display(row),scope:db.scope,...receipt(row,device)});
      async function change(modify,restored) {
        return access(()=>db.update(id,stored=>{
          const base = restored && (!stored || restored.revision > stored.revision && restored.xp >= stored.xp)
            ? restored : stored || initial(id,session.nick);
          const next = modify(base);
          return next.nick !== session.nick ? {...next,nick:session.nick,revision:next.revision+1} : next;
        }));
      }
      if (action === 'profile') return payload(await change(row=>row,restore(data.receipt,device)));
      if (action === 'avatar') {
        // Older clients only send the original palette. Merge inside the transaction
        // so editing those colors on another device preserves the newer features.
        const fields = Object.keys(avatarOptions).filter(key => Object.hasOwn(data,key));
        if (!originalAvatarFields.every(key => fields.includes(key)) ||
            !fields.every(key => validAvatarOption(key,data[key])))
          reject(400,'El aspecto elegido es inválido.');
        const configured = characterFields.every(key => fields.includes(key));
        return payload(await change(row => {
          const previous = normalizeAvatar(row.avatar);
          if (fields.every(key => data[key] === previous[key]) && (!configured || row.characterCreated))
            return row;
          const avatar = {...previous};
          for (const key of fields) avatar[key] = data[key];
          return {...row,avatar,characterCreated:row.characterCreated === true || configured,revision:row.revision+1};
        }));
      }
      if (action === 'record') {
        const {game,value} = data;
        if (!reportedGames.includes(game) || !validRecord(game,value))
          reject(400,'La marca no corresponde al juego o está fuera de su rango.');
        // Taking the best inside the storage transaction handles retries, concurrent
        // tabs and submissions from an older game arriving after a better result.
        return payload(await change(row=>improvesRecord(game,value,row.best[game])
          ? {...row,best:{...row.best,[game]:value},revision:row.revision+1}
          : row));
      }
      if (action === 'ranking') {
        const board = data.game ?? 'xp';
        if (!boards.includes(board)) reject(400,'Ranking desconocido.');
        return {players:(await access(()=>db.ranking(board))).map(display),scope:db.scope};
      }
      if (action === 'start') {
        if (!gameNames.has(data.game)) reject(400,'Minijuego desconocido.');
        throttle('arcade-start/'+id,20);
        const time = now();
        if (active.get(id)?.pending) reject(409,'La ronda anterior aún se está guardando.');
        if (active.size >= 1000) {
          for (const [key,run] of active) if (run.expires < time && !run.pending) active.delete(key);
          if (!active.has(id) && active.size >= 1000) reject(429,'La sala arcade está llena.');
        }
        const run = {id:randomBytes(16).toString('hex'),game:data.game,expires:time+runLifetime,
          round:1,sequence:[randomInt(4)],cache:new Map(),done:false,started:time,pending:null};
        const delayMs = randomInt(1300,3100);
        run.ready = time + (run.game === 'reflex' ? delayMs : 950);
        active.set(id,run);
        return run.game === 'reflex' ? {runId:run.id,game:run.game,delayMs} :
          {runId:run.id,game:run.game,round:1,sequence:[...run.sequence]};
      }
      if (action !== 'finish') reject(404,'Recurso de progreso desconocido.');
      const run = runFor(id,data.runId);
      const round = run.game === 'reflex' ? 1 : data.round;
      if (!Number.isInteger(round) || round < 1 || round > maximumRound) reject(400,'Ronda inválida.');
      // Replaying a request must also work while its storage operation is finishing.
      if (run.cache.has(round)) return run.cache.get(round);
      if (run.pending || run.done || round !== run.round) reject(409,'La ronda no está activa.');
      if (run.game === 'sequence' && (!Array.isArray(data.answer) || data.answer.length !== round ||
          data.answer.some(x=>!Number.isInteger(x) || x<0 || x>3))) reject(400,'Respuesta de memoria inválida.');
      // Freeze the first valid submission so an ambiguous database acknowledgement
      // or a failed retry cannot change its clock result or answer.
      const submitted = run.submitted?.round === round ? run.submitted : {
        round, elapsed:now()-run.ready, answer:run.game === 'sequence' ? [...data.answer] : null
      };
      run.submitted = submitted;
      const elapsed = submitted.elapsed;
      const win = run.game === 'reflex' ? elapsed>=80 && elapsed<=3000 :
        elapsed>=0 && submitted.answer.every((x,i)=>x===run.sequence[i]);
      const earned = !win ? 0 : run.game === 'reflex' ? Math.max(2,Math.min(20,Math.round(4000/elapsed))) : 4 + round;
      const done = !win || run.game === 'reflex' || round === maximumRound;
      const score = run.game === 'reflex' ? (win ? elapsed : null) : (win ? round : round-1);
      const award = run.id+'.'+round;
      async function complete() {
        const row = await change(row=>{
          if (!earned || row.awards.includes(award)) return row;
          const best = {...row.best};
          if (run.game==='reflex') best.reflex=Math.min(best.reflex ?? Infinity,score);
          else best.sequence=Math.max(best.sequence,score);
          return {...row,xp:row.xp+earned,best,revision:row.revision+1,awards:[...row.awards.slice(-15),award]};
        });
        run.done = done;
        const result = {earned,done,score,...payload(row)};
        if (!done) {
          run.round++;
          run.sequence.push(randomInt(4));
          run.ready=now()+350+600*run.round;
          run.expires=now()+runLifetime;
          Object.assign(result,{runId:run.id,round:run.round,sequence:[...run.sequence]});
        }
        return result;
      }
      const processing = complete();
      run.pending=processing;
      run.cache.set(round,processing);
      try { return await processing; }
      catch (error) { run.cache.delete(round); throw error; }
      finally { run.pending=null; }
    }
  };
}
