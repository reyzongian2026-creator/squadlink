const {spawn} = require('node:child_process');
const {win32:path} = require('node:path');

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

// Return after Windows starts the verified installer. The caller can then quit
// normally; Inno waits for this process before replacing the live executable.
async function installWindowsUpdate(installerPath, options) {
  const {file,args}=updateCommand(installerPath,options);
  const child=spawn(file,args,{cwd:path.dirname(file),detached:true,windowsHide:true,stdio:'ignore',shell:false});
  await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('spawn',resolve);
  });
  child.unref();
}

module.exports={installWindowsUpdate,updateCommand};
