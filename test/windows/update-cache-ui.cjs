const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path'),os=require('node:os');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {createRequire}=require('node:module');
const desktopRequire=createRequire(require.resolve('../../electron/package.json'));
const {_electron}=desktopRequire('playwright-core');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function run() {
  const executablePath=path.resolve(process.argv[2]);
  const bundle=path.join(path.dirname(executablePath),'resources','app');
  const manifest=path.join(bundle,'package.json');
  const manifestBytes=await fs.readFile(manifest);
  const packaged=JSON.parse(manifestBytes);
  assert.equal(packaged.main,'main.cjs');
  const bootstrap='qa-update-cache.cjs';
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'squad-cache-ui-'));
  const profile=path.join(scratch,'Perfil de Pepe'), log=path.join(scratch,'red.jsonl');
  const version='9.9.9-preview.21';
  const name='Squadlink-Moderno-Setup-x64.exe';
  const tag='moderno-v'+version;
  const assetUrl='https://github.com/reyzongian2026-creator/squadlink/releases/download/'+tag+'/'+name;
  const payload=Buffer.from('Descarga de prueba para verificar la caché de Squadlink.');
  const digest=createHash('sha256').update(payload).digest('hex');
  const catalog=[{tag_name:tag,assets:[{name,state:'uploaded',size:payload.length,digest:'sha256:'+digest,browser_download_url:assetUrl}]}];
  const served={catalog:0,asset:0};
  const server=http.createServer((req,res)=>{
    if(req.url==='/asset'){served.asset++;res.setHeader('content-length',payload.length);res.end(payload);return;}
    if(req.url==='/catalog'){served.catalog++;res.setHeader('content-type','application/json');res.end(JSON.stringify(catalog));return;}
    res.writeHead(404).end();
  });
  let current;
  async function stop() {
    if(!current)return;
    const instance=current; current=undefined;
    const process=instance.process();
    await instance.close();
    assert.ok(process.exitCode!==null || process.signalCode!==null,'El proceso anterior aún no terminó.');
  }
  async function openSettings(online) {
    current=await _electron.launch({
      executablePath, args:['--user-data-dir='+profile],timeout:45000,
      env:{...process.env,SQUAD_TEST_UPDATE_NETWORK:JSON.stringify({online,origin,assetUrl,log})}
    });
    const native=await current.evaluate(({app,safeStorage})=>({
      packaged:app.isPackaged,
      profile:app.getPath('userData'),
      secure:safeStorage.isEncryptionAvailable() && safeStorage.decryptString(safeStorage.encryptString('Pepe'))==='Pepe'
    }));
    assert.deepEqual(native,{packaged:true,profile,secure:true});
    let home;
    for(let i=0;i<150 && !home;i++){
      home=current.context().pages().find(p=>p.url().startsWith('squad://home/'));
      if(!home)await wait(100);
    }
    assert.ok(home,'La ventana principal no apareció.');
    await home.getByRole('button',{name:'Ajustes',exact:true}).click();
    const panel=home.locator('section[aria-labelledby="updates-title"]');
    await panel.getByRole('heading',{name:'Actualizaciones'}).waitFor();
    return panel;
  }
  let origin;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    origin='http://127.0.0.1:'+server.address().port;
    await fs.mkdir(profile);
    // Model a returning player to open the lobby directly. The update cache is new.
    await fs.writeFile(path.join(profile,'desktop.json'),JSON.stringify({low:true,hasPlayer:true,server:origin}));
    await fs.writeFile(log,'');
    await fs.copyFile(path.join(__dirname,'update-cache-main.cjs'),path.join(bundle,bootstrap));
    await fs.writeFile(manifest,JSON.stringify({...packaged,main:bootstrap}));

    const first=await openSettings(true);
    await first.getByRole('button',{name:'Descargar actualización',exact:true}).click();
    await first.getByRole('button',{name:'Instalar y reiniciar',exact:true}).waitFor();
    assert.deepEqual(served,{catalog:1,asset:1});
    await stop();

    const offline=await openSettings(false);
    await offline.getByRole('button',{name:'Instalar y reiniciar',exact:true}).waitFor({timeout:12000});
    assert.match(await offline.getByRole('status').innerText(),/descarga verificada/i);
    assert.equal(await offline.evaluate(async()=> (await window.squad.state()).update.version),version);
    assert.equal(await offline.getByRole('button',{name:/Descargar actualización|Reintentar descarga/}).count(),0);
    await stop();

    const cache=path.join(profile,'update-cache');
    const files=(await fs.readdir(cache,{recursive:true})).filter(file=>path.basename(file)===name);
    assert.equal(files.length,1);
    const saved=path.join(cache,files[0]);
    assert.deepEqual(await fs.readFile(saved),payload);
    const flipped=Buffer.from(payload);
    flipped[0]^=1;
    await fs.writeFile(saved,flipped);

    const invalid=await openSettings(false);
    await invalid.getByRole('status').filter({hasText:'No se pudo consultar la publicación.'}).waitFor({timeout:12000});
    await invalid.getByRole('button',{name:'Buscar actualizaciones',exact:true}).waitFor({timeout:12000});
    assert.equal(await invalid.getByRole('button',{name:'Instalar y reiniciar',exact:true}).count(),0);
    await assert.rejects(fs.access(saved),{code:'ENOENT'});
    await stop();
    const requests=(await fs.readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(requests.filter(r=>r.endpoint==='/asset').length,1,'La aplicación intentó descargar otra vez.');
    assert.deepEqual(served,{catalog:1,asset:1});
    console.log('UI empaquetada y DPAPI: una descarga en Ajustes, disponible al reabrir sin red y rechazada tras alterar un byte con la app cerrada.');
  } finally {
    try { await stop(); }
    finally {
      await fs.writeFile(manifest,manifestBytes);
      await fs.rm(path.join(bundle,bootstrap),{force:true});
      if(server.listening)await new Promise(resolve=>server.close(resolve));
      await fs.rm(scratch,{recursive:true,force:true,maxRetries:4,retryDelay:180});
    }
  }
}

run().catch(error=>{console.error(error);process.exitCode=1;});
