const {createHash} = require('node:crypto');
const {constants, createWriteStream} = require('node:fs');
const {lstat, mkdtemp, open, rename, rm} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {Readable, Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');

const repository = 'reyzongian2026-creator/squadlink';
const prefix = 'moderno-v';
const assetLimit = 512 * 1024 * 1024;
const catalogLimit = 8 * 1024 * 1024;
const assetHosts = new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
const redirects = new Set([301,302,303,307,308]);

function assetName(platform, arch) {
  if (platform === 'win32' && arch === 'x64') return 'Squadlink-Moderno-Setup-x64.exe';
  if (platform === 'darwin' && arch === 'arm64') return 'Squadlink-Moderno-macOS-arm64.zip';
  throw Error('No hay un instalador compatible con este sistema y arquitectura.');
}

function versionParts(version) {
  if (typeof version !== 'string' || version.length > 80) return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(0|[1-9]\d*))?$/.exec(version);
  if (!match) return null;
  const numbers = match.slice(1).map(n => n === undefined ? Infinity : Number(n));
  if (match.slice(1).some((n,i) => n !== undefined && !Number.isSafeInteger(numbers[i]))) return null;
  return numbers;
}

function newer(candidate, current) {
  for (let i=0; i<current.length; i++) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i];
  }
  return false;
}

function verifyMetadata(update) {
  if (!update || !versionParts(update.version) || update.tag !== prefix+update.version ||
      update.name !== assetName(update.platform,update.arch) ||
      !Number.isSafeInteger(update.size) || update.size < 1 || update.size > assetLimit ||
      typeof update.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(update.sha256) ||
      update.url !== 'https://github.com/'+repository+'/releases/download/'+update.tag+'/'+update.name) {
    throw Error('La publicación carece de un instalador verificable para este equipo.');
  }
}

async function readCatalog(response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw Error('No se pudo consultar la lista de versiones en GitHub.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > catalogLimit) throw Error('La respuesta de GitHub supera el límite permitido.');
    chunks.push(chunk);
  }
  const releases = JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
  if (!Array.isArray(releases)) throw Error('La lista de versiones de GitHub no es válida.');
  return releases;
}

async function findUpdate({currentVersion, platform=process.platform, arch=process.arch, fetchImpl=fetch, signal}={}) {
  const current = versionParts(currentVersion);
  if (!current) throw Error('La versión instalada no se puede comparar.');
  const name = assetName(platform,arch);
  const timeout = AbortSignal.timeout(45000);
  const requestSignal = signal ? AbortSignal.any([signal,timeout]) : timeout;
  let best = null;
  let highest = current;
  for (let page=1; page<=20; page++) {
    const response = await fetchImpl('https://api.github.com/repos/'+repository+'/releases?per_page=100&page='+page,{
      signal:requestSignal, redirect:'error',
      headers:{Accept:'application/vnd.github+json','User-Agent':'Squadlink-Desktop','X-GitHub-Api-Version':'2022-11-28'}
    });
    const releases = await readCatalog(response);
    for (const release of releases) {
      if (release?.draft || typeof release?.tag_name !== 'string' || !release.tag_name.startsWith(prefix)) continue;
      const version = release.tag_name.slice(prefix.length);
      const parts = versionParts(version);
      if (!parts || !newer(parts,highest)) continue;
      const asset = release.assets?.find(a => a.name === name && a.state === 'uploaded');
      if (!asset) continue;
      best = {version,tag:release.tag_name,platform,arch,name,size:asset.size,
        sha256:typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7) : '',
        url:asset.browser_download_url};
      highest = parts;
    }
    if (releases.length < 100) {
      if (best) verifyMetadata(best);
      return best;
    }
  }
  throw Error('La lista de versiones de GitHub supera el límite permitido.');
}

async function requestAsset(update, fetchImpl, signal) {
  let url = new URL(update.url);
  for (let hop=0; hop<=5; hop++) {
    const response = await fetchImpl(url.href,{redirect:'manual',signal,
      headers:{Accept:'application/octet-stream','Accept-Encoding':'identity','User-Agent':'Squadlink-Desktop'}});
    if (!redirects.has(response.status)) {
      if (response.status === 200 && response.body) return response;
      await response.body?.cancel();
      throw Error('No se pudo descargar el instalador desde GitHub.');
    }
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) throw Error('GitHub devolvió una redirección incompleta.');
    const next = new URL(location,url);
    if (next.protocol !== 'https:' || next.username || next.password || next.port || !assetHosts.has(next.hostname)) {
      throw Error('El destino de descarga no pertenece al servicio de archivos de GitHub.');
    }
    url = next;
  }
  throw Error('GitHub superó el límite de redirecciones.');
}

async function downloadUpdate(update,{tempDir=os.tmpdir(),onProgress,fetchImpl=fetch,signal}={}) {
  verifyMetadata(update);
  const directory = await mkdtemp(path.join(tempDir,'squadlink-update-'));
  const partial = path.join(directory,'download.part');
  const filePath = path.join(directory,update.name);
  const controller = new AbortController();
  const signals = [controller.signal,AbortSignal.timeout(10*60*1000)];
  if (signal) signals.push(signal);
  const requestSignal = AbortSignal.any(signals);
  const idle = setTimeout(()=>controller.abort(Error('La descarga dejó de recibir datos.')),45000);
  idle.unref();
  try {
    requestSignal.throwIfAborted();
    const response = await requestAsset(update,fetchImpl,requestSignal);
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== update.size) {
      await response.body.cancel();
      throw Error('El tamaño anunciado no coincide con el de la publicación.');
    }
    const hash = createHash('sha256');
    let received = 0;
    let lastProgress = 0;
    const meter = new Transform({transform(chunk,_encoding,done) {
      received += chunk.length;
      idle.refresh();
      if (received > update.size) return done(Error('El instalador supera el tamaño publicado.'));
      hash.update(chunk);
      const now = Date.now();
      if (onProgress && now-lastProgress >= 250 && received < update.size) {
        lastProgress = now;
        try { onProgress({received,total:update.size}); } catch (err) { return done(err); }
      }
      done(null,chunk);
    }});
    await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(partial,{flags:'wx',mode:0o600}),
      {signal:requestSignal});
    if (received !== update.size || hash.digest('hex') !== update.sha256) {
      throw Error('El instalador descargado no coincide con su tamaño o su SHA-256 publicado.');
    }
    await rename(partial,filePath);
    onProgress?.({received,total:update.size});
    return {filePath,directory};
  } catch (error) {
    await rm(directory,{recursive:true,force:true});
    throw error;
  } finally {
    clearTimeout(idle);
  }
}

async function verifyDownloaded(update,filePath) {
  verifyMetadata(update);
  if (path.basename(filePath) !== update.name) throw Error('El nombre del instalador no coincide.');
  const expected = await lstat(filePath);
  if (!expected.isFile() || expected.size !== update.size) throw Error('El instalador guardado no tiene el tamaño o tipo esperado.');
  const file = await open(filePath,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino || stat.size !== update.size)
      throw Error('El archivo guardado cambió antes de comprobarlo.');
    const hash = createHash('sha256');
    let bytes = 0;
    // Read a bounded range even if the file grows during verification.
    for await (const chunk of file.createReadStream({autoClose:false,end:update.size-1})) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    const after = await lstat(filePath);
    if (!after.isFile() || after.dev !== stat.dev || after.ino !== stat.ino || after.size !== update.size ||
        after.mtimeMs !== stat.mtimeMs || bytes !== update.size || hash.digest('hex') !== update.sha256)
      throw Error('El instalador guardado ha cambiado. Vuelve a descargarlo.');
    return true;
  } finally {
    await file.close();
  }
}

module.exports = {findUpdate,downloadUpdate,verifyDownloaded};
