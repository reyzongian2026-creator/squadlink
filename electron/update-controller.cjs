const {rm} = require('node:fs/promises');

// The renderer only receives status; release URLs and local paths stay in the main process.
function createUpdateController({find, download, verify, prepare, inRoom, quit, notify}) {
  let state = {phase:'idle', version:'', percent:0, message:''};
  let release, local, running;
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
    const old = local;
    local = undefined;
    if (old) await rm(old.directory, {recursive:true, force:true}).catch(() => {});
  }
  function check() {
    return run(['idle','current','available','check-error'], async () => {
      set('checking');
      try {
        release = await find();
        set(release ? 'available' : 'current');
      } catch {
        set(release ? 'available' : 'check-error','No se pudo consultar la publicación. Comprueba la conexión y vuelve a intentarlo.');
      }
    });
  }
  function fetchUpdate() {
    return run(['available'], async () => {
      set('downloading');
      try {
        local = await download(release, ({received,total}) => {
          const percent = Math.min(99, Math.floor(received * 100 / total));
          if (Number.isFinite(percent) && percent !== state.percent) set('downloading', '', percent);
        });
        set('ready');
      } catch {
        set('available','Falló la descarga o la comprobación del archivo. Puedes volver a descargarlo.');
      }
    });
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
  return {snapshot:() => state, check, download:fetchUpdate, install};
}
module.exports = {createUpdateController};
