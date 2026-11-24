const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createRequire}=require('node:module');
const {installWindowsUpdate}=require('../../electron/update-windows.cjs');
const desktopRequire=createRequire(require.resolve('../../electron/package.json'));
const {_electron}=desktopRequire('playwright-core');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function run() {
  const [installer,executablePath,profile]=process.argv.slice(2);
  const appPackage=path.join(path.dirname(executablePath),'resources','app','package.json');
  const previous=JSON.parse(await fs.readFile(appPackage,'utf8'));
  previous.version='0.0.1';
  await fs.writeFile(appPackage,JSON.stringify(previous));
  await fs.mkdir(profile,{recursive:true});
  await fs.writeFile(path.join(profile,'desktop.json'),JSON.stringify({low:true,server:'http://127.0.0.1:4179'}));
  await fs.writeFile(path.join(profile,'jugador-prueba.txt'),'Pepe');
  const old=await _electron.launch({executablePath,args:['--user-data-dir='+profile],timeout:45000});
  try {
    assert.equal(await old.evaluate(({app})=>app.getVersion()),'0.0.1');
    await installWindowsUpdate(installer,{executablePath,parentPid:old.process().pid,userDataPath:profile});
    await delay(2200);
    assert.equal(old.process().exitCode,null,'El instalador cerró la aplicación por su cuenta.');
    assert.equal(JSON.parse(await fs.readFile(appPackage,'utf8')).version,'0.0.1');
  } finally { await old.close(); }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
