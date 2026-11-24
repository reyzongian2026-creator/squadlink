const {spawn} = require('node:child_process');
const {win32:path} = require('node:path');
const fs = require('node:fs/promises');
const {setTimeout:delay} = require('node:timers/promises');

function updateCommand(installerPath, {executablePath=process.execPath, parentPid=process.pid, userDataPath}={}) {
  const validPath = value => typeof value==='string' && path.isAbsolute(value) && !/["\x00-\x1f]/.test(value);
  if (!validPath(installerPath) || path.extname(installerPath).toLowerCase()!=='.exe') {
    throw Error('No se encontró el instalador de Windows verificado.');
  }
  if (!validPath(executablePath) || path.basename(executablePath).toLowerCase()!=='squadlink.exe') {
    throw Error('Abre la aplicación instalada para actualizar este equipo.');
  }
  if (!Number.isSafeInteger(parentPid) || parentPid<=0 || parentPid>0x7fffffff) {
    throw Error('No se pudo identificar el proceso que debe cerrarse.');
  }
  if (userDataPath!==undefined && !validPath(userDataPath)) throw Error('No se pudo conservar la ruta del perfil del jugador.');
  const args=['/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS',
    '/SQUADUPDATEPID='+parentPid, '/DIR='+path.dirname(executablePath)];
  if (userDataPath) args.push('/SQUADPROFILE='+userDataPath);
  return {file:installerPath,args};
}

// Keep Squadlink open until Inno has finished its startup checks and is ready to
// replace files. An installer that fails early leaves the live app available.
async function waitForReady(marker, signal) {
  const deadline=Date.now()+60_000;
  while (Date.now()<deadline) {
    try {
      if (await fs.readFile(marker,'utf8')==='1') return;
    } catch (error) {
      if (error.code!=='ENOENT') throw error;
    }
    await delay(100,undefined,{signal});
  }
  throw Error('El instalador no confirmó que esté listo. Puedes volver a intentarlo.');
}

async function installWindowsUpdate(installerPath, options) {
  const {file,args}=updateCommand(installerPath,options);
  const cwd=path.dirname(file);
  const session=await fs.mkdtemp(path.join(cwd,'squad-update-'));
  const controller=new AbortController();
  let child;
  try {
    args.push('/SQUADSESSION='+path.basename(session));
    child=spawn(file,args,{cwd,detached:true,windowsHide:true,stdio:'ignore',shell:false});
    const exited=new Promise((_,reject)=>{
      child.once('error',reject);
      child.once('exit',()=>reject(Error('El instalador terminó antes de confirmar la actualización. Puedes reintentar.')));
    });
    await Promise.race([waitForReady(path.join(session,'ready'),controller.signal),exited]);
  } finally {
    controller.abort();
    child?.unref();
    await fs.rm(session,{recursive:true,force:true}).catch(()=>{});
  }
}

module.exports={installWindowsUpdate,updateCommand};
