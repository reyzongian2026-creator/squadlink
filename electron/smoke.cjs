const { _electron,chromium }=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFile}=require('node:child_process');
const runFile=require('node:util').promisify(execFile);
const {fixtureSetup,testVoiceQuality,testManualGain,testListenBoost}=require('../test/support/voice-quality.cjs');
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
 assert.equal(await app.evaluate(({app})=>app.getVersion()),require('./package.json').version,'La app instalada debe anunciar la versión de la compilación');
 app.context().setDefaultTimeout(15000);
 // Record the callback actually accepted by Electron. macOS CI does not grant
 // Accessibility for cross-app keyboard injection; no permission prompt is needed.
 if(process.platform==='darwin')await app.evaluate(({globalShortcut})=>{
  const register=globalShortcut.register.bind(globalShortcut);
  globalShortcut.register=(combination,callback)=>{
   const accepted=register(combination,callback);
   if(accepted && combination==='Alt+Shift+R')globalThis.qaGlobalRadio=callback;
   return accepted;
  };
 });
 async function surface(host) {
  for(let i=0;i<200;i++){
   const page=app.context().pages().find(p=>!p.isClosed()&&p.url().startsWith('squad://'+host+'/'));
   if(page)return page;
   await delay(100);
  }
  throw Error('No apareció la vista '+host);
 }
 const fixture=fs.readFileSync(path.join(__dirname,'../test/windows/audio-fixture.js'),'utf8');
 const audioSetup="if(location.hostname==='app' && navigator.mediaDevices && !window.testPeers){"+fixtureSetup(500)+fixture+"\n}";
 await app.context().addInitScript({content:audioSetup});
 const onboarding=await surface('app');
 await onboarding.evaluate(audioSetup);
 await onboarding.getByRole('heading',{name:'Crea tu personaje',exact:true}).waitFor();
 await onboarding.getByRole('button',{name:'Elegir apodo y guardar',exact:true}).click();
 await onboarding.getByLabel('Tu apodo').fill('Prueba Electron');
 await onboarding.locator('#submit-entry').click();
 await onboarding.getByText('Apariencia guardada.',{exact:true}).waitFor();
 await onboarding.getByRole('button',{name:'Lobby de voz',exact:true}).click();
 let home=await surface('home');console.log('Ventana principal',home.url());
 const diagnostics=page=>{page.on('pageerror',err=>console.log('RENDER',err.message));page.on('console',m=>{if(m.type()==='error')console.log('RENDER',m.text())});};
 diagnostics(home);app.context().on('page',diagnostics);
 const capture=path.resolve(__dirname,'../artifacts/capturas');fs.mkdirSync(capture,{recursive:true});
 await home.getByRole('button',{name:'Crear sala',exact:true}).waitFor();
 assert.equal((await home.evaluate(()=>window.squad.state())).server,'http://127.0.0.1:4179');
 await home.getByText('Todavía no hay salas públicas.').waitFor();
 await home.screenshot({path:path.join(capture,'Inicio-Moderno.png')});
 async function memory(label){const values=await app.evaluate(({app})=>app.getAppMetrics().map(m=>m.memory.workingSetSize));console.log('RAM '+label+' MiB: '+(values.reduce((a,b)=>a+b,0)/1024).toFixed(1));}
 await memory('inicio');console.log('Inicio React correcto');
 // Only GitHub requests are intercepted, in the isolated packaged app's main process.
 const asset=process.platform==='darwin'?'Squadlink-Moderno-macOS-arm64.zip':'Squadlink-Moderno-Setup-x64.exe';
 const qaBytes='contenido de prueba';
 await app.evaluate((_,{asset,qaBytes,digest})=>{
  const original=globalThis.fetch;
  let pendingFirstDownload=true;
  const tag='moderno-v9.9.9-preview.1';
  const url='https://github.com/reyzongian2026-creator/squadlink/releases/download/'+tag+'/'+asset;
  globalThis.fetch=(input,options)=>{
   if(String(input).startsWith('https://api.github.com/repos/reyzongian2026-creator/squadlink/releases?')){
    return Promise.resolve(Response.json([{tag_name:tag,assets:[{name:asset,state:'uploaded',size:Buffer.byteLength(qaBytes),digest:'sha256:'+digest,browser_download_url:url}]}]));
   }
   if(input===url){
    if(pendingFirstDownload){
     pendingFirstDownload=false;
     globalThis.qaUpdateTransferStarted=true;
     return new Promise((_,reject)=>{
      const stop=()=>reject(options.signal.reason);
      if(options.signal.aborted)stop();else options.signal.addEventListener('abort',stop,{once:true});
     });
    }
    return Promise.resolve(new Response(qaBytes));
   }
   return original(input,options);
  };
 },{asset,qaBytes,digest:require('node:crypto').createHash('sha256').update(qaBytes).digest('hex')});
 await home.getByRole('button',{name:'Ajustes',exact:true}).click();
 const mainId=await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].id);
 async function checkWindow(featureVisible){
  const observed=await app.evaluate(({BaseWindow},id)=>{
   const windows=BaseWindow.getAllWindows();
   const main=windows.find(w=>w.id===id);
   return {ids:windows.map(w=>w.id),feature:main?.contentView.children.some(child=>child.webContents?.getURL().startsWith('squad://app/'))};
  },mainId);
  assert.deepEqual(observed,{ids:[mainId],feature:featureVisible});
 }
 await home.getByRole('heading',{name:'Ajustes',exact:true}).waitFor();
 await home.getByRole('button',{name:'Descargar actualización'}).click();
 for(let i=0;i<100 && !await app.evaluate(()=>globalThis.qaUpdateTransferStarted);i++)await delay(50);
 assert.ok(await app.evaluate(()=>globalThis.qaUpdateTransferStarted));
 await home.getByRole('button',{name:'Cancelar descarga'}).click();
 await home.getByText('Descarga cancelada.',{exact:false}).waitFor();
 await home.getByRole('button',{name:/Descargar actualización|Reintentar descarga/}).click();
 await home.getByRole('button',{name:'Instalar y reiniciar'}).waitFor();
 const updateCache=path.join(profile,'update-cache');
 const staged=fs.readdirSync(updateCache).find(dir=>dir.startsWith('squadlink-update-'));
 fs.writeFileSync(path.join(updateCache,staged,asset),'archivo alterado');
 await home.getByRole('button',{name:'Instalar y reiniciar'}).click();
 await home.getByRole('button',{name:'Reintentar descarga'}).click();
 await home.getByRole('button',{name:'Instalar y reiniciar'}).waitFor();
 console.log('Ajustes descarga, verifica, rechaza archivos alterados y permite reintentar dentro de la app.');
 await home.getByRole('button',{name:'Experiencia completa'}).click();
 assert.equal((await home.evaluate(()=>window.squad.state())).low,false);
 await home.getByRole('button',{name:'Bajo consumo'}).click();
 await checkWindow(false);
 await home.getByRole('button',{name:'Lobby de voz'}).click();
 await home.getByRole('button',{name:'Crear sala',exact:true}).click();
 let space;
 for(let i=0;i<120&&!space;i++){space=app.context().pages().find(p=>p.url().startsWith('squad://app/'));if(!space)await delay(100);}
 console.log("Motor de sala",space?.url());assert.ok(space,'El motor debe cargar dentro de la ventana principal.');
 await space.locator('#entry[open]').waitFor();assert.ok(await space.locator('#nickname').isHidden());await space.locator('#name').fill('Escuadra Lima');
 await space.screenshot({path:path.join(capture,'Crear-sala-Moderna.png')});await space.locator('#submit-entry').click();
 await space.locator('#room-name').waitFor({state:'visible'});
 await checkWindow(true);
 await space.getByText('Detalles de sala',{exact:true}).click();
 await space.waitForFunction(()=>/^[A-Z0-9]{6}$/.test(document.querySelector('#room-code')?.textContent));
 async function openCurrentRoom(){
  // On macOS the click can release the low-memory home renderer before Playwright returns.
  try { await home.getByRole('button',{name:'Mi sala',exact:true}).click(); }
  catch(error){ if(process.platform!=='darwin'||!home.isClosed())throw error; }
  await space.locator('#room-name').waitFor({state:'visible'});
  await checkWindow(true);
 }
 const code=await space.locator('#room-code').innerText();assert.match(code,/^[A-Z0-9]{6}$/);
 await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();home=await surface('home');
 await checkWindow(false);
 await home.getByRole('button',{name:/Escuadra Lima.*Tu sala/}).waitFor();
 await home.getByRole('button',{name:'Activar micrófono',exact:true}).click();
 await home.getByRole('button',{name:'Silenciar',exact:true}).waitFor();
 browser=await chromium.launch({channel:process.platform==='darwin'?'chrome':'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const peer=await browser.newPage();peer.setDefaultTimeout(15000);await peer.addInitScript({content:fixtureSetup(900)+fixture});await peer.goto('http://127.0.0.1:4179');
 await peer.locator('#channel-list a[href="#directory"]').click();
 await peer.locator('#directory-list [data-room-code="'+code+'"]').click();await peer.locator('#nickname').fill('Amigo');await peer.locator('#code').fill(code);await peer.locator('#submit-entry').click();await peer.locator('#mic').click();
 const sample=p=>p.evaluate(async()=>{for(const pc of window.testPeers){for(const stat of (await pc.getStats()).values()){if(stat.type==='inbound-rtp'&&stat.kind==='audio')return stat.totalAudioEnergy||0;}}return 0;});
 async function audio(previous){let values;for(let i=0;i<100;i++){values=await Promise.all([sample(space),sample(peer)]);if(values.every((v,j)=>v>previous[j]))return values;await delay(250);}throw Error('Falta voz bidireccional '+JSON.stringify(values));}
 const first=await audio([0,0]);await memory('voz');
 await openCurrentRoom();
 await testVoiceQuality(space,peer);
 const {musicSmoke,assertRadioShortcut}=await import('../test/support/music-browser.mjs');
 async function radioAndVoice() {
  return Promise.all([space,peer].map(async page=>{
   const media=await page.evaluate(()=>{
    const audio=document.querySelector('#room-music audio');
    return {time:audio?.currentTime,source:audio?.currentSrc,playing:!!audio && !audio.paused,
     room:document.querySelector('#room-code').textContent, count:document.querySelector('#count').textContent};
   });
   return {...media,energy:await sample(page)};
  }));
 }
 async function requireProgress(initial,label) {
  let latest;
  for(let i=0;i<32;i++) {
   latest=await radioAndVoice();
   for(const [j,m] of latest.entries()){
    assert.equal(m.room,code,label);assert.match(m.count,/2\s*\/\s*5/,label);
    assert.ok(m.playing && m.source===initial[j].source,label+' perdió la radio de la sala');
   }
   if(latest.every((m,j)=>m.time>initial[j].time+0.45 && m.energy>initial[j].energy)){
    console.log(label,JSON.stringify(latest.map((m,j)=>({radioSeconds:m.time-initial[j].time,voiceEnergy:m.energy-initial[j].energy}))));
    return;
   }
   await delay(200);
  }
  throw Error(label+' no avanzó: '+JSON.stringify({initial,latest}));
 }
 async function waitMinimized(expected) {
  for(let i=0;i<35;i++) {
   if(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isMinimized())===expected)return;
   await delay(200);
  }
  throw Error('La ventana no alcanzó el estado minimizado='+expected);
 }
 // CDP keyboard events target the renderer, bypassing Electron's native
 // before-input-event. Dispatch physical-key equivalents through WebContents.
 async function focusedRadioShortcut(hostname){
  const input=await app.evaluate(async ({webContents},host)=>{
   const wc=webContents.getAllWebContents().find(contents=>contents.getURL().startsWith('squad://'+host+'/'));
   if(!wc)throw Error('No está montada la superficie '+host);
   wc.focus();
   const observed=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{wc.off('before-input-event',record);reject(Error('Electron no recibió el atajo en '+host));},3000);
    function record(_event,key){
     if(key.type!=='keyDown')return;
     clearTimeout(timer);wc.off('before-input-event',record);
     resolve({code:key.code,alt:key.alt,shift:key.shift});
    }
    wc.on('before-input-event',record);
   });
   const key={keyCode:'R',modifiers:['alt','shift']};
   wc.sendInputEvent({...key,type:'keyDown'});
   wc.sendInputEvent({...key,type:'keyUp'});
   return observed;
  },hostname);
  assert.deepEqual(input,{code:'KeyR',alt:true,shift:true},hostname+' recibió un acorde incorrecto');
 }
 await musicSmoke(space,peer,async()=>{
  try{
   await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].minimize());
   await waitMinimized(true);
   await requireProgress(await radioAndVoice(),'Radio y voz con la ventana minimizada');
   const registered=await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Alt+Shift+R'));
   if(registered){
    const windows=process.platform==='win32';
    const sendGlobal=windows ? ()=>runFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',
     "(New-Object -ComObject WScript.Shell).SendKeys('%+r')"],{timeout:8000})
     : ()=>app.evaluate(()=>{
       if(!globalThis.qaGlobalRadio)throw Error('Falta el callback del atajo registrado.');
       globalThis.qaGlobalRadio();
      });
    await assertRadioShortcut(space,peer,sendGlobal,windows?'teclas del sistema Windows, ventana minimizada':
      'callback global registrado en macOS, ventana minimizada');
   }else console.log('El sistema reservó Alt+Shift+R; se comprobarán las teclas con foco.');
  }finally{
   await app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.restore();win.show();win.focus();});
   await waitMinimized(false);
  }
  await requireProgress(await radioAndVoice(),'Radio y voz al restaurar la ventana');
  await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();home=await surface('home');
  await home.getByRole('button',{name:'Mi sala',exact:true}).waitFor();
  await requireProgress(await radioAndVoice(),'Radio y voz en el lobby');
  await assertRadioShortcut(space,peer,()=>home.keyboard.press('Alt+Shift+KeyR'),'teclado Chromium en el lobby de escritorio');
  const lobbyRadio=()=>home.getByRole('button',{name:/^(Silenciar mi radio|Reanudar mi radio)$/});
  let stop=true;
  await assertRadioShortcut(space,peer,async()=>{
   assert.equal(await lobbyRadio().textContent(),stop?'Silenciar mi radio':'Reanudar mi radio');
   await lobbyRadio().click();
   stop=!stop;
  },'botón de radio del lobby');
  await home.getByRole('button',{name:'Arcade',exact:true}).click();
  await space.locator('[data-game="reflex"]').waitFor();
  await assertRadioShortcut(space,peer,()=>focusedRadioShortcut('app'),'teclas en Arcade');
  await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();home=await surface('home');
  await openCurrentRoom();
  await space.locator('#room-music [data-listen][aria-pressed="true"]').waitFor();
 });
 await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();home=await surface('home');
 await home.getByRole('button',{name:'Arcade',exact:true}).click();await space.locator('[data-game="reflex"]').waitFor();
 const {duckNesBrowser}=await import('../test/duck-nes-browser.mjs');
 // Packaged Electron serves squad: from disk. Exercise that same handler on the
 // temporary CI installation with generated diagnostic cartridges only.
 const installDiagnostics = async bytes => {
  const dir=path.join(await app.evaluate(({app})=>app.getAppPath()),'cartridges');
  const relative=path.relative(fs.realpathSync(process.env.RUNNER_TEMP),fs.realpathSync(path.dirname(dir)));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await fs.promises.mkdir(dir);
  for(const name of ['mario3.nes','duck-nes.nes']) await fs.promises.writeFile(path.join(dir,name),bytes,{flag:'wx'});
  return ()=>fs.promises.rm(dir,{recursive:true});
 };
 await duckNesBrowser(space,process.env.GITHUB_ACTIONS && process.env.RUNNER_TEMP ? installDiagnostics : undefined);
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
   await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].focus());
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
 await space.getByRole('button',{name:'Ajustes',exact:true}).click();home=await surface('home');
 await home.getByRole('heading',{name:'Ajustes',exact:true}).waitFor();
 await checkWindow(false);
 await home.getByRole('button',{name:'Dispositivos de audio'}).click();await space.getByText('Ganancia automática del micrófono').waitFor();
 await testManualGain(space,peer);
 await testListenBoost(space,peer);
 await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();home=await surface('home');
 await openCurrentRoom();await space.locator('#room-name').waitFor({state:'visible'});
 await space.screenshot({path:path.join(capture,'Sala-Moderna.png')});
 console.log('Voz bidireccional durante la navegación',first,await audio(first));
 await space.getByRole('button',{name:'Lobby de voz',exact:true}).click();home=await surface('home');
 await home.getByRole('button',{name:'Salir de sala'}).click();await home.getByRole('button',{name:'Unirme con código'}).click();
 space=await surface('app');await space.locator('#code').fill(code);await space.locator('#submit-entry').click();await space.locator('#room-name').waitFor({state:'visible'});await checkWindow(true);
 console.log('Instalación, ajustes, sala, entrada por código y continuidad de voz verificados.');
 }finally{await browser?.close();await app?.close();backend.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
