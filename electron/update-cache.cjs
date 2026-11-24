const {createHmac,randomBytes,timingSafeEqual} = require('node:crypto');
const {constants} = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const {writePrivateFile} = require('./player-vault.cjs');
const {isUpdateFor,verifyDownloaded} = require('./update-release.cjs');

const recordFile = 'ready-v1.json';
const keyPrefix = 'squadlink-update-cache-v1:';
const directoryName = /^squadlink-update-[A-Za-z0-9]{6}$/;
const temporaryRecord = /^\.squadlink-[0-9a-f-]{36}\.tmp$/;
const recordLimit = 32 * 1024;

async function readRecord(file) {
  const expected = await fs.lstat(file);
  if (!expected.isFile() || expected.nlink !== 1 || expected.size > recordLimit) throw Error('Recibo no válido.');
  const fd = await fs.open(file,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await fd.stat();
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino || opened.size !== expected.size)
      throw Error('El recibo cambió antes de leerlo.');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await fd.read(bytes,offset,bytes.length-offset,offset);
      if (!read.bytesRead) throw Error('Recibo incompleto.');
      offset += read.bytesRead;
    }
    return JSON.parse(bytes.toString('utf8'));
  } finally { await fd.close(); }
}

function createUpdateCache(root,{currentVersion,platform=process.platform,arch=process.arch,seal,open}) {
  if (!path.isAbsolute(root)) throw Error('Se necesita una ruta absoluta de caché.');
  root = path.resolve(root);
  const receipt = path.join(root,recordFile);
  const options = {currentVersion,platform,arch};
  let queue = Promise.resolve();
  let cachedName;

  function serialized(operation) {
    const next = queue.then(operation);
    queue = next.catch(()=>{});
    return next;
  }
  async function ensureRoot() {
    try { await fs.mkdir(root,{mode:0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(root);
    if (!stat.isDirectory()) throw Error('La carpeta de actualizaciones no es un directorio privado.');
    if (process.platform !== 'win32' && (stat.mode & 0o077)) await fs.chmod(root,0o700);
  }
  function paths(name,file) {
    if (typeof name !== 'string' || !directoryName.test(name)) throw Error('Directorio de descarga no válido.');
    const directory = path.join(root,name);
    return {directory,filePath:path.join(directory,file)};
  }
  async function validateFiles(local,release) {
    const dir = await fs.lstat(local.directory);
    if (!dir.isDirectory()) throw Error('La carpeta de descarga fue reemplazada.');
    const file = await fs.lstat(local.filePath);
    if (!file.isFile() || file.nlink !== 1 || file.size !== release.size) throw Error('El instalador cambió.');
  }
  async function decode() {
    if (typeof open !== 'function') throw Error('Almacén seguro no disponible.');
    const record = await readRecord(receipt);
    if (record?.format !== 1 || typeof record.key !== 'string' || typeof record.data !== 'string' ||
        typeof record.mac !== 'string' || !/^[a-f0-9]{64}$/.test(record.mac)) throw Error('Recibo no válido.');
    const raw = await open(Buffer.from(record.key,'base64'));
    if (typeof raw !== 'string' || !raw.startsWith(keyPrefix) || !/^[a-f0-9]{64}$/.test(raw.slice(keyPrefix.length)))
      throw Error('No se pudo autenticar el recibo.');
    const key = Buffer.from(raw.slice(keyPrefix.length),'hex');
    const mac = createHmac('sha256',key).update(record.data).digest();
    if (!timingSafeEqual(mac,Buffer.from(record.mac,'hex'))) throw Error('El recibo fue modificado.');
    const {release,name} = JSON.parse(record.data);
    if (!isUpdateFor(release,options)) throw Error('El instalador ya no corresponde a esta versión.');
    return {release,local:paths(name,release.name)};
  }
  async function prune(keep) {
    for (const name of await fs.readdir(root)) {
      if ((directoryName.test(name) && name !== keep) || temporaryRecord.test(name))
        await fs.rm(path.join(root,name),{recursive:true,force:true});
    }
  }

  function restore() {
    return serialized(async()=>{
      await ensureRoot();
      let result = null;
      cachedName = undefined;
      try {
        const decoded = await decode();
        await validateFiles(decoded.local,decoded.release);
        await verifyDownloaded(decoded.release,decoded.local.filePath);
        result = decoded;
        cachedName = path.basename(result.local.directory);
      } catch {
        await fs.rm(receipt,{recursive:true,force:true});
      }
      await prune(cachedName);
      return result;
    });
  }
  function save(release,local) {
    return serialized(async()=>{
      await ensureRoot();
      if (!isUpdateFor(release,options)) throw Error('El instalador ya no corresponde a este equipo.');
      const name = path.basename(local.directory);
      const expected = paths(name,release.name);
      if (local.directory !== expected.directory || local.filePath !== expected.filePath)
        throw Error('La descarga está fuera de la caché privada.');
      await validateFiles(expected,release);
      if (typeof seal !== 'function' || typeof open !== 'function') return false;
      // Only the main process supplies the release from GitHub and the verified
      // downloader result. Authenticate the receipt independently of the OS cipher.
      const key = randomBytes(32);
      const wrapped = await seal(keyPrefix+key.toString('hex'));
      if (!Buffer.isBuffer(wrapped) || !wrapped.length) return false;
      const data = JSON.stringify({release,name});
      const mac = createHmac('sha256',key).update(data).digest('hex');
      const envelope = JSON.stringify({format:1,key:wrapped.toString('base64'),data,mac});
      if (Buffer.byteLength(envelope) > recordLimit) throw Error('El recibo excede el tamaño permitido.');
      await writePrivateFile(receipt,envelope);
      const prior = cachedName;
      cachedName = name;
      if (prior && prior !== name) await fs.rm(path.join(root,prior),{recursive:true,force:true}).catch(()=>{});
      return true;
    });
  }
  function forget() {
    return serialized(async()=>{
      await ensureRoot();
      if (!cachedName) {
        try { cachedName=path.basename((await decode()).local.directory); } catch {}
      }
      await fs.rm(receipt,{recursive:true,force:true});
      if (cachedName) await fs.rm(path.join(root,cachedName),{recursive:true,force:true});
      cachedName = undefined;
    });
  }
  return {restore,save,forget};
}
module.exports = {createUpdateCache};
