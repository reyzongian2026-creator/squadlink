const {rm} = require('node:fs/promises');

// The renderer only receives status; release URLs and local paths stay in the main process.
function createUpdateController({find, download, verify, prepare, inRoom, quit, notify, cache}) {
  let state = {phase:'idle', version:'', percent:0, message:''};
  let release, local, running, transfer;
  let restored = false, persisted = false;
  const offline = 'No se pudo consultar la publicación.';
  const sessionOnly = 'La descarga está lista para instalar durante esta sesión.';
  function sameAsset(a,b) {
    return ['version','tag','sha256','size','name','platform','arch','url'].every(key => a[key] === b[key]);
  }
  function set(phase, message = '', percent = 0) {
    state = {phase, version:release?.version || '', percent, message};
    notify();
  }
  function run(phases, task) {
    if (running || !phases.includes(state.phase)) return running;
    running = Promise.resolve().then(task).finally(() => { running = undefined; });
    return running;
  }
  async function discard() {
    const old = local, wasPersisted = persisted;
    local = undefined;
    persisted = false;
    if (!old) return;
    if (wasPersisted) await cache.forget().catch(() => {});
    else await rm(old.directory, {recursive:true, force:true}).catch(() => {});
  }

  async function restore() {
    if (restored || !cache || local) return;
    restored = true;
    try {
      // The cache checks the installed version, platform, receipt and file hash.
      const saved = await cache.restore();
      if (saved) {
        release = saved.release;
        local = saved.local;
        persisted = true;
      }
    } catch { /* Keep checking the catalogue if the local store is unavailable. */ }
  }

  function check() {
    return run(['idle','current','available','ready','check-error'], async () => {
      set('checking');
      await restore();
      let next;
      try {
        next = await find({hasDownload:Boolean(local)});
      } catch {
        if (local) set('ready', offline + ' Puedes instalar la descarga verificada.', 100);
        else set(release ? 'available' : 'check-error',offline + ' Comprueba la conexión y vuelve a intentarlo.');
        return;
      }
      if (local && next && sameAsset(release,next)) {
        set('ready',cache && !persisted ? sessionOnly : '',100);
        return;
      }
      let message = '';
      if (local && next) {
        message = next.version === release.version ? 'El archivo publicado cambió. Descarga la copia actualizada.' :
          'La descarga era de ' + release.version + '. Ahora está disponible ' + next.version + '.';
      }
      await discard();
      release = next;
      set(next ? 'available' : 'current',message);
    });
  }

  function fetchUpdate() {
    if (running || state.phase !== 'available') return running;
    const controller = new AbortController();
    transfer = controller;
    return run(['available'], async () => {
      set('downloading');
      try {
        controller.signal.throwIfAborted();
        local = await download(release, ({received,total}) => {
          if (transfer !== controller || controller.signal.aborted) return;
          const percent = Math.min(99, Math.floor(received * 100 / total));
          if (Number.isFinite(percent) && percent !== state.percent) set('downloading', '', percent);
        }, controller.signal);
        controller.signal.throwIfAborted();
        if (cache) {
          try { persisted = await cache.save(release,local) === true; }
          catch { persisted = false; }
        }
        controller.signal.throwIfAborted();
        set('ready',cache && !persisted ? sessionOnly : '',100);
      } catch {
        await discard();
        set('available',controller.signal.aborted ? 'Descarga cancelada.' : 'Falló la descarga o la comprobación del archivo. Puedes volver a descargarlo.');
      } finally { transfer = undefined; }
    });
  }

  function cancelDownload() {
    if (!transfer) return;
    transfer.abort();
    return running;
  }
  function install() {
    return run(['ready'], async () => {
      const roomMessage = 'Sal de la sala cuando quieras reiniciar e instalar.';
      if (inRoom()) { set('ready', roomMessage); return; }
      set('installing');
      try {
        await verify(release, local.filePath);
      } catch {
        await discard();
        set('available','El archivo descargado cambió o ya no está disponible. Descárgalo de nuevo.');
        return;
      }
      let prepared;
      try {
        prepared = await prepare(release, local.filePath);
        if (inRoom()) {
          await prepared.cancel?.();
          set('ready', roomMessage);
          return;
        }
        await prepared.launch();
      } catch (error) {
        await prepared?.cancel?.().catch(() => {});
        set('ready',error.message || 'No se pudo iniciar la instalación. Vuelve a intentarlo.');
        return;
      }
      quit();
    });
  }
  return {snapshot:() => state, check, download:fetchUpdate, cancelDownload, install};
}
module.exports = {createUpdateController};
