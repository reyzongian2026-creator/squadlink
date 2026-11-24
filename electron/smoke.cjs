const { _electron,chromium }=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'squadlink-e2e-'));
 fs.writeFileSync(path.join(profile,'desktop.json'),JSON.stringify({low:true,server:'http://127.0.0.1:4179'}));
 const executablePath=process.argv[2]||require('electron');
 const backend=spawn(process.execPath,['test/windows/voice-lobby.mjs'],{cwd:path.join(__dirname,'..'),stdio:'inherit'});
 let app,browser;
 try{
 let available=false;for(let i=0;i<100;i++){try{available=(await fetch('http://127.0.0.1:4179/api/directory')).ok;}catch{}if(available)break;await delay(100);}assert.ok(available);
 app=await _electron.launch({executablePath,args:['--user-data-dir='+profile],timeout:45000});
 app.context().setDefaultTimeout(15000);
 const home=await app.firstWindow({timeout:20000});console.log('Ventana principal',home.url());
 const diagnostics=page=>{page.on('pageerror',err=>console.log('RENDER',err.message));page.on('console',m=>{if(m.type()==='error')console.log('RENDER',m.text())});};
 diagnostics(home);app.context().on('page',diagnostics);
 const capture=path.resolve(__dirname,'../artifacts/capturas');fs.mkdirSync(capture,{recursive:true});
 await home.getByRole('button',{name:'Crear sala',exact:true}).waitFor();
 assert.equal((await home.evaluate(()=>window.squad.state())).server,'http://127.0.0.1:4179');
 await home.getByText('Todavía no hay salas públicas.').waitFor();
 await home.screenshot({path:path.join(capture,'Inicio-Moderno.png')});
 async function memory(label){const values=await app.evaluate(({app})=>app.getAppMetrics().map(m=>m.memory.workingSetSize));console.log('RAM '+label+' MiB: '+(values.reduce((a,b)=>a+b,0)/1024).toFixed(1));}
 await memory('inicio');console.log('Inicio React correcto');
 await home.getByRole('button',{name:'Ajustes',exact:true}).click();
 const mainId=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].id);
 async function checkWindow(featureVisible){
  const observed=await app.evaluate(({BaseWindow},id)=>{
   const windows=BaseWindow.getAllWindows();
   const main=windows.find(w=>w.id===id);
   return {ids:windows.map(w=>w.id),feature:main?.contentView.children.some(child=>child.webContents?.getURL().startsWith('squad://app/'))};
  },mainId);
  assert.deepEqual(observed,{ids:[mainId],feature:featureVisible});
 }
 await home.getByRole('heading',{name:'Ajustes',exact:true}).waitFor();
 await home.getByRole('button',{name:'Experiencia completa'}).click();
 assert.equal((await home.evaluate(()=>window.squad.state())).low,false);
 await home.getByRole('button',{name:'Bajo consumo'}).click();
 await checkWindow(false);
 await home.getByRole('button',{name:'Lobby de voz'}).click();
 const fixture=fs.readFileSync(path.join(__dirname,'../test/windows/audio-fixture.js'),'utf8');
 await app.context().addInitScript({content:"if(location.hostname==='app' && navigator.mediaDevices){"+fixture+"\n}"});
 await home.getByRole('button',{name:'Crear sala',exact:true}).click();
 let space;
 for(let i=0;i<120&&!space;i++){space=app.context().pages().find(p=>p.url().startsWith('squad://app/'));if(!space)await delay(100);}
 console.log("Motor de sala",space?.url());assert.ok(space,'El motor debe cargar dentro de la ventana principal.');
 await space.locator('#entry[open]').waitFor();await space.locator('#nickname').fill('Prueba Electron');await space.locator('#name').fill('Escuadra Lima');
 await space.screenshot({path:path.join(capture,'Crear-sala-Moderna.png')});await space.locator('#submit-entry').click();
 await space.locator('#room-name').waitFor({state:'visible'});
 await checkWindow(true);
 const code=await space.locator('#room-code').innerText();assert.match(code,/^[A-Z0-9]{6}$/);
 await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();
 await checkWindow(false);
 await home.getByRole('button',{name:/Escuadra Lima.*Tu sala/}).waitFor();
 await home.getByRole('button',{name:'Activar micrófono',exact:true}).click();
 await home.getByRole('button',{name:'Silenciar',exact:true}).waitFor();
 browser=await chromium.launch({channel:process.platform==='darwin'?'chrome':'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const peer=await browser.newPage();peer.setDefaultTimeout(15000);await peer.addInitScript({content:fixture});await peer.goto('http://127.0.0.1:4179');
 await peer.locator('#channel-list a[href="#directory"]').click();
 await peer.locator('#directory-list [data-room-code="'+code+'"]').click();await peer.locator('#nickname').fill('Amigo');await peer.locator('#code').fill(code);await peer.locator('#submit-entry').click();await peer.locator('#mic').click();
 const sample=p=>p.evaluate(async()=>{for(const pc of window.testPeers){for(const stat of (await pc.getStats()).values()){if(stat.type==='inbound-rtp'&&stat.kind==='audio')return stat.totalAudioEnergy||0;}}return 0;});
 async function audio(previous){let values;for(let i=0;i<100;i++){values=await Promise.all([sample(space),sample(peer)]);if(values.every((v,j)=>v>previous[j]))return values;await delay(250);}throw Error('Falta voz bidireccional '+JSON.stringify(values));}
 const first=await audio([0,0]);await memory('voz');
 await home.getByRole('button',{name:'Mi sala',exact:true}).click();
 const {musicSmoke}=await import('../test/support/music-browser.mjs');
 await musicSmoke(space,peer);
 await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();
 await home.getByRole('button',{name:'Arcade',exact:true}).click();await space.getByRole('button',{name:/Reflejos/}).waitFor();
 for(const id of ['flick','precision','merge','three','ducks','doom']){
  await space.locator('[data-game="'+id+'"]').click();
  await space.locator('#game-mount .practice-status').waitFor();
  if(id==='merge')await space.getByRole('button',{name:'Izquierda'}).click();
  else if(id==='three')await space.locator('.three-cell').first().click();
  else if(id==='doom'){
   assert.equal(await space.locator('.doom-player').count(),0);
   await space.getByRole('button',{name:'Cargar DOOM',exact:true}).click();
   const game=space.frameLocator('.doom-player');
   await game.getByRole('button',{name:'Jugar',exact:true}).click({timeout:120000});
   const canvas=game.getByLabel('Partida de Freedoom');
   await game.locator('#boot[hidden]').waitFor({state:'attached'});
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
   await canvas.click();
   // Exercise windowed aiming too, including systems that decline pointer capture.
   await canvas.evaluate(async el=>{
    if(document.pointerLockElement===el) {
     const unlocked=new Promise(resolve=>document.addEventListener('pointerlockchange',resolve,{once:true}));
     document.exitPointerLock();await unlocked;
    }
    const delivered=new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(Error('Sin giro de ratón en ventana')),1000);
     el.addEventListener('keydown',event=>{clearTimeout(timer);resolve(event.code);},{once:true});
    });
    el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,movementX:32}));
    if(await delivered!=='ArrowRight')throw Error('Giro de ratón incorrecto');
   });
   await space.keyboard.down('w');await delay(170);await space.keyboard.up('w');
   await space.keyboard.press('Space');
   await space.mouse.move(60,0,{steps:4});
   await space.mouse.down();await delay(110);await space.mouse.up();
   const cfg=await canvas.evaluate(()=>window.Module.FS.readFile('/squad.cfg',{encoding:'utf8'}));
   assert.match(cfg,/key_up 17/);assert.match(cfg,/key_use 57/);assert.match(cfg,/mouseb_fire 0/);
   const gameAudio=await canvas.evaluate(()=>window.Module.SDL2.audioContext?.state);
   assert.ok(['running','suspended'].includes(gameAudio),'El juego debe tener su propio contexto de audio');
   await checkWindow(true);
   const closedSound=await game.getByRole('button',{name:'Salir del juego'}).evaluate(button=>{
    const sdl=window.Module.SDL2;
    button.click();
    return sdl.audioContext.state==='closed' && !sdl.audio.scriptProcessorNode.onaudioprocess;
   });
   assert.ok(closedSound,'Salir debe desconectar el procesador y cerrar el audio de DOOM');
   await space.locator('.doom-player').waitFor({state:'detached'});
   continue;
  }else{
   await space.getByRole('button',{name:'Empezar',exact:true}).click();
   if(id==='ducks')await space.getByRole('button',{name:'Pato 1',exact:true}).press('Enter');
   else await space.getByRole('button',{name:'Blanco',exact:true}).click();
  }
  await space.getByRole('button',{name:'Cerrar minijuego'}).click();
 }
 for(const [label,section] of [['Amigos','friends'],['Mi personaje','player'],['Clasificación','ranking'],['Guía de sala','guide'],['Salas','rooms']]){
  await space.getByRole('button',{name:label,exact:true}).click();
  await space.waitForFunction(key=>document.body.dataset.workspace===key,section);
  await checkWindow(true);
  if(section==='friends'){
   await space.getByRole('heading',{name:'Tus amigos'}).waitFor();
   await space.screenshot({path:path.join(capture,'Amigos-Moderno.png')});
   assert.ok(await space.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
 }
 await space.getByRole('button',{name:'Ajustes',exact:true}).click();
 await home.getByRole('heading',{name:'Ajustes',exact:true}).waitFor();
 await checkWindow(false);
 await home.getByRole('button',{name:'Dispositivos de audio'}).click();await space.getByText('Ganancia automática del micrófono').waitFor();
 await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();
 await home.getByRole('button',{name:'Mi sala',exact:true}).click();await space.locator('#room-name').waitFor({state:'visible'});
 await space.screenshot({path:path.join(capture,'Sala-Moderna.png')});
 console.log('Voz bidireccional durante la navegación',first,await audio(first));
 await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();
 await home.getByRole('button',{name:'Salir de sala'}).click();await home.getByRole('button',{name:'Unirme con código'}).click();
 await space.locator('#code').fill(code);await space.locator('#submit-entry').click();await space.locator('#room-name').waitFor({state:'visible'});await checkWindow(true);
 console.log('Instalación, ajustes, sala, entrada por código y continuidad de voz verificados.');
 }finally{await browser?.close();await app?.close();backend.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
