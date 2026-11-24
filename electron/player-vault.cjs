const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function checkPass(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 65536) throw Error('Pase de jugador inválido.');
  const pass = JSON.parse(raw);
  if (pass?.format !== 'squadlink-player-v1' || typeof pass.deviceKey !== 'string'
    || !/^[a-f0-9]{64}$/.test(pass.deviceKey)) throw Error('Pase de jugador inválido.');
  return pass;
}
async function writePrivateFile(file, data) {
  const temp = path.join(path.dirname(file),'.squadlink-' + randomUUID() + '.tmp');
  try {
    await fs.promises.writeFile(temp,data,{flag:'wx',mode:0o600,flush:true});
    await fs.promises.rename(temp,file);
  } finally { await fs.promises.rm(temp,{force:true}); }
}
function createPlayerVault(filename,cipher) {
  let pending = Promise.resolve();
  async function read() {
    let data;
    try { data = await fs.promises.readFile(filename()); }
    catch (err) { if (err.code==='ENOENT') return null; throw err; }
    return cipher.decryptString(data);
  }
  function save(raw) {
    const next = pending.then(async () => {
      const pass = checkPass(raw);
      if (!cipher.isEncryptionAvailable()) throw Error('No se pudo abrir el almacén seguro del equipo.');
      const previous = await read();
      if (previous === raw) return;
      if (previous && checkPass(previous).deviceKey !== pass.deviceKey) throw Error('El respaldo contiene otro jugador.');
      await writePrivateFile(filename(),cipher.encryptString(raw));
    });
    pending = next.catch(()=>{});
    return next;
  }
  return {load:()=>pending.then(read),save};
}
module.exports = {createPlayerVault,writePrivateFile,checkPass};
