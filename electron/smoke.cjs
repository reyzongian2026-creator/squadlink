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
 async function windowState(){
  return app.evaluate(({BaseWindow,webContents,app})=>{
   const windows=BaseWindow.getAllWindows();
   const front=windows[0]?.contentView.children.at(-1)?.webContents;
   const views=webContents.getAllWebContents().filter(w=>w.getURL().startsWith('squad://'))
    .map(w=>({id:w.id,host:new URL(w.getURL()).hostname,pid:w.getOSProcessId()}));
   return {ids:windows.map(w=>w.id),front:front?.id,views,
    renderers:app.getAppMetrics().filter(m=>m.type==='Tab').map(m=>({pid:m.pid,name:m.name||m.type,workingSetKiB:m.memory.workingSetSize}))};
  });
 }
 async function surface(host){
  for(let i=0;i<160;i++){
   const native=await windowState();
   if(native.views.some(v=>v.id===native.front && v.host===host)){
    const page=app.context().pages().find(p=>!p.isClosed()&&p.url().startsWith('squad://'+host+'/'));
    if(page)return page;
   }
   await delay(100);
  }
  throw Error('No apareció la vista '+host+': '+JSON.stringify(await windowState()));
 }
 // Native navigation may tear down the caller before the pointer event is acknowledged.
 // Accept only that specific error, and require the requested destination to become visible.
 async function navigate(page,button,host){
  try{await page.getByRole('button',{name:button,exact:true}).click();}
  catch(error){
   if(!/Target (?:page, context or browser has been closed|closed)|Session closed|Page closed/i.test(error.message))throw error;
   if(!page.isClosed())await page.waitForEvent('close',{timeout:1500});
  }
  return surface(host);
 }
 const fixture=fs.readFileSync(path.join(__dirname,'../test/windows/audio-fixture.js'),'utf8');
 const audioSetup="if(location.hostname==='app' && navigator.mediaDevices && !window.testPeers){"+fixtureSetup(500)+fixture+"\n}";
 await app.context().addInitScript({content:audioSetup});
 const onboarding=await surface('app');
 await onboarding.evaluate(audioSetup);
 await onboarding.getByRole('heading',{name:'Crea tu personaje',exact:true}).waitFor();
 assert.deepEqual((await windowState()).views.map(v=>v.host),['app'],'Crear el personaje no debe cargar un lobby oculto');
 // Check the local protocol and decoder in the installed app, with a clean profile.
 for (const [label,species] of [['Robot',3],['Humano',0]]) {
  await onboarding.getByRole('button',{name:label,exact:true}).click();
  const imagePath='/avatar-'+species+'-2.webp';
  await onboarding.locator('#kit-voxel image[href="'+imagePath+'"]').first().waitFor({state:'attached'});
  await onboarding.evaluate(async species=>{
   const suffix='-'+species+'-2.webp';
   const decode=async name=>{
    const art=new Image();
    art.src='/'+name+suffix;
    await art.decode();
    return [art.naturalWidth,art.naturalHeight].join('x');
   };
   for(const [model,skin,coat] of [['avatar','skin','coat'],['face','face-skin','face-coat']]){
    const [size,skinSize,coatSize]=await Promise.all([model,skin,coat].map(decode));
    if(size!==skinSize || size!==coatSize)throw Error('Las máscaras no coinciden con '+model+suffix);
   }
  },species);
 }
 console.log('Personajes y miniaturas 3D decodificados con sus máscaras en el escritorio instalado');

 // The full body and close-up use different bitmap layers. Check the images actually selected by the UI.
 const clickOption=name=>onboarding.getByRole('button',{name,exact:true}).click();
 const editor=onboarding.locator('#kit-voxel');
 const closeup=onboarding.getByRole('button',{name:'Acercar rostro',exact:true});
 async function checkAppearance(layer,hiddenLayers,underBrim=false){
  for(const prefix of ['', 'face-']){
   if(prefix)await closeup.click();
   const expected='/'+prefix+layer+'-0-2.webp';
   await editor.locator('image[href="'+expected+'"]').first().waitFor({state:'attached'});
   await editor.evaluate(async (root,{hidden,hair,underBrim})=>{
    const paths=new Set(Array.from(root.querySelectorAll('image'),image=>image.getAttribute('href')));
    if(paths.has(hidden))throw Error('Se superponen dos bases en la vista previa.');
    if(underBrim && !root.querySelector('g[clip-path] image[href="'+hair+'"]'))throw Error('El cabello debe quedar debajo de la visera.');
    await Promise.all(Array.from(paths,async path=>{
     const image=new Image();
     image.src=path;
     await image.decode();
     if(!image.naturalWidth || !image.naturalHeight)throw Error('Recurso vacío: '+path);
    }));
   },{hidden:'/'+hiddenLayers[prefix ? 1 : 0]+'-0-2.webp',hair:'/'+prefix+'hair-0-2.webp',underBrim});
  }
  await closeup.click();
 }
 await clickOption('Azul');
 await checkAppearance('hair',['bald','face-bald']);
 await clickOption('Gorra');
 await checkAppearance('bald',['avatar','face'],true);
 await clickOption('Al natural');
 await clickOption('Sin cabello');
 await checkAppearance('bald',['hair','face-hair']);
 console.log('Color de cabello, gorra y cabeza sin cabello comprobados en el editor y el retrato instalados.');

 const accessory=onboarding.getByRole('group',{name:'Accesorio',exact:true});
 const natural=accessory.getByRole('button',{name:'Al natural',exact:true});
 await natural.focus();
 await natural.press('End');
 const visor=accessory.getByRole('button',{name:'Visor',exact:true,pressed:true});
 await visor.waitFor();
 assert.ok(await visor.evaluate(button=>document.activeElement===button));
 await visor.press('Home');
 await accessory.getByRole('button',{name:'Al natural',exact:true,pressed:true}).waitFor();
 assert.ok(await natural.evaluate(button=>document.activeElement===button));
 console.log('Inicio y Fin cambian el accesorio seleccionado y el foco dentro del grupo.');

 await onboarding.getByRole('button',{name:'Elegir apodo y guardar',exact:true}).click();
 await onboarding.getByLabel('Tu apodo').fill('Prueba Electron');
 await onboarding.locator('#submit-entry').click();
 await onboarding.getByText('Apariencia guardada.',{exact:true}).waitFor();
 async function savedCharacter(page){
  return page.evaluate(async()=>{
   const result=await fetch('/api/progress/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   if(!result.ok)throw Error('No se pudo consultar el personaje guardado: '+result.status);
   const {profile}=await result.json();
   return {id:profile.id,created:profile.characterCreated,look:profile.avatar};
  });
 }
 const originalCharacter=await savedCharacter(onboarding);
 assert.ok(originalCharacter.created && originalCharacter.id);
 assert.equal(originalCharacter.look.hairStyle,1);
 assert.equal(originalCharacter.look.hairColor,5);
 assert.equal(originalCharacter.look.headgear,0);
 await clickOption('Visor');
 await onboarding.getByRole('button',{name:'Visor',exact:true,pressed:true}).waitFor();
 let home=await navigate(onboarding,'Lobby de voz','home');console.log('Ventana principal',home.url());
 const diagnostics=page=>{page.on('pageerror',err=>console.log('RENDER',err.message));page.on('console',m=>{if(m.type()==='error')console.log('RENDER',m.text())});};
 diagnostics(home);app.context().on('page',diagnostics);
 const capture=path.resolve(__dirname,'../artifacts/capturas');fs.mkdirSync(capture,{recursive:true});
 await home.getByRole('button',{name:'Crear sala',exact:true}).waitFor();
 const initial=await home.evaluate(()=>window.squad.state());
 assert.equal(initial.server,'http://127.0.0.1:4179');
 let integrated=process.platform!=='darwin';
 assert.equal(initial.integratedLobby,integrated,'Debe migrar las preferencias anteriores según la plataforma');
 await home.getByText('Todavía no hay salas públicas.').waitFor();
 await home.screenshot({path:path.join(capture,'Inicio-Moderno.png')});
 async function memory(label,modeLabel){
  // Electron reports working-set KiB per process. Keep timing and sample size
  // identical to the .22 benchmark, including all native helper processes.
  const samples=[];
  for(let i=0;i<5;i++){
   const values=await app.evaluate(({app})=>app.getAppMetrics().map(m=>m.memory.workingSetSize));
   samples.push(values.reduce((a,b)=>a+b,0)/1024);
   if(i<4)await delay(180);
  }
  const sorted=[...samples].sort((a,b)=>a-b);
  const summary=' MiB: '+samples[0].toFixed(1)+'; mínima '+sorted[0].toFixed(1)+'; mediana '+sorted[2].toFixed(1);
  console.log('RAM '+label+summary);
  if(modeLabel)console.log('Perfil de memoria '+modeLabel+summary);
 }
 // Measure CPU time of Squadlink's own processes only, excluding the simulated peer.
 async function cpuSample(label){
  const read=()=>app.evaluate(({app})=>app.getAppMetrics().map(m=>[m.pid,m.cpu.cumulativeCPUUsage]));
  const start=new Map(await read());
  const time=performance.now();
  await delay(4000);
  const finish=await read();
  if(finish.length!==start.size || finish.some(([pid,seconds])=>!start.has(pid) || !Number.isFinite(seconds)))return;
  const seconds=finish.reduce((sum,[pid,value])=>sum+value-start.get(pid),0);
  console.log('CPU '+label+': '+(100000*seconds/(performance.now()-time)).toFixed(1)+' % de un núcleo');
 }
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
  const observed=await windowState(), expected=featureVisible?'app':'home';
  assert.deepEqual(observed.ids,[mainId]);
  assert.equal(observed.views.find(v=>v.id===observed.front)?.host,expected,JSON.stringify(observed));
 }
 async function onlyCallRenderer(call,lobby){
  assert.ok(lobby?.pid>0 && lobby.id!==call.id && lobby.pid!==call.pid,'El lobby anterior debe ser un proceso distinto');
  let observed;
  for(let i=0;i<60;i++){
   observed=await windowState();
   const only=observed.views[0];
   if(observed.ids.length===1 && observed.ids[0]===mainId && observed.views.length===1 &&
      only.id===call.id && only.pid===call.pid && only.host==='app' &&
      observed.renderers.some(m=>m.pid===call.pid) && !observed.renderers.some(m=>m.pid===lobby.pid)){
    // Chromium can keep renderer processes with no top-level Squadlink page.
    // Record frame ownership separately from the actual released lobby process.
    const frames=await app.evaluate(({webContents})=>webContents.getAllWebContents().flatMap(w=>
     w.mainFrame.framesInSubtree.map(f=>({contents:w.id,url:f.url.split('?')[0],pid:f.osProcessId}))));
    console.log('Renderer de llamada y liberación del lobby',JSON.stringify({llamada:call.pid,lobbyLiberado:lobby.pid,renderers:observed.renderers,frames}));
    return;
   }
   await delay(100);
  }
  throw Error('Debe sobrevivir la llamada y finalizar el renderer anterior del lobby: '+JSON.stringify({call,lobby,observed}));
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
 const audioSettings=await navigate(home,'Dispositivos de audio','app');
 const {localAudioBrowser}=await import('../test/support/local-audio-browser.mjs');
 await localAudioBrowser(audioSettings);
 home=await navigate(audioSettings,'Lobby de voz','home');
 const externalLobby=(await windowState()).views.find(v=>v.host==='home');
 let space=await navigate(home,'Crear sala','app');
 console.log('Motor de sala',space.url());
 await space.locator('#entry[open]').waitFor();assert.ok(await space.locator('#nickname').isHidden());await space.locator('#name').fill('Escuadra Lima');
 await space.screenshot({path:path.join(capture,'Crear-sala-Moderna.png')});await space.locator('#submit-entry').click();
 await space.locator('#room-name').waitFor({state:'visible'});
 await checkWindow(true);
 await space.getByText('Detalles de sala',{exact:true}).click();
 await space.waitForFunction(()=>/^[A-Z0-9]{6}$/.test(document.querySelector('#room-code')?.textContent));
 async function openCallHome(from=space){
  const same=await navigate(from,'Lobby de voz',integrated?'app':'home');
  if(!integrated){
   assert.notEqual(same,space,'El lobby predeterminado de Mac debe liberar su proceso al minimizar');
   await same.getByRole('button',{name:'Mi sala',exact:true}).waitFor();
   return same;
  }
  assert.equal(same,space,'El lobby en llamada debe compartir su motor de voz');
  await same.waitForFunction(()=>document.body.dataset.workspace==='call-home',null,{polling:100});
  await same.locator('#call-home-panel').getByRole('button',{name:'Mi sala',exact:true}).waitFor();
  return same;
 }
 async function openCurrentRoom(){
  const roomPage=await navigate(home,'Mi sala','app');
  assert.equal(roomPage,space,'La llamada debe conservar su vista al navegar');
  await space.locator('#room-name').waitFor({state:'visible'});
  await checkWindow(true);
 }
 const code=await space.locator('#room-code').innerText();assert.match(code,/^[A-Z0-9]{6}$/);
 home=await openCallHome();
 await checkWindow(integrated);
 await home.getByRole('button',{name:/Escuadra Lima.*Tu sala/}).waitFor();
 await home.getByRole('button',{name:'Activar micrófono',exact:true}).click();
 await home.getByRole('button',{name:'Silenciar',exact:true}).waitFor();
 browser=await chromium.launch({channel:process.platform==='darwin'?'chrome':'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const peer=await browser.newPage();peer.setDefaultTimeout(15000);await peer.addInitScript({content:fixtureSetup(900)+fixture});await peer.goto('http://127.0.0.1:4179');
 await peer.locator('#channel-list a[href="#directory"]').click();
 await peer.locator('#directory-list [data-room-code="'+code+'"]').click();await peer.locator('#nickname').fill('Amigo');await peer.locator('#code').fill(code);await peer.locator('#submit-entry').click();await peer.locator('#mic').click();
 const sample=p=>p.evaluate(async()=>{for(const pc of window.testPeers){for(const stat of (await pc.getStats()).values()){if(stat.type==='inbound-rtp'&&stat.kind==='audio')return stat.totalAudioEnergy||0;}}return 0;});
 async function audio(previous){let values;for(let i=0;i<100;i++){values=await Promise.all([sample(space),sample(peer)]);if(values.every((v,j)=>v>previous[j]))return values;await delay(250);}throw Error('Falta voz bidireccional '+JSON.stringify(values));}
 const first=await audio([0,0]);await checkWindow(integrated);await memory('voz',integrated?null:'lobby macOS predeterminado');
 const beforeRoom=await windowState();
 const callView=beforeRoom.views.find(v=>v.host==='app');
 assert.ok(callView?.pid>0);
 if(integrated)await onlyCallRenderer(callView,externalLobby);
 const lobbyBeforeRoom=beforeRoom.views.find(v=>v.host==='home')||externalLobby;
 await openCurrentRoom();
 await memory('voz con sala visible');
 await onlyCallRenderer(callView,lobbyBeforeRoom);
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
 // While minimized the native surface is detached, but its session, media and
 // IPC must remain alive. At restore it must fill the content area and own focus.
 async function checkCallSurface(attached){
  let reading;
  for(let i=0;i<50;i++){
   reading=await app.evaluate(({BaseWindow,webContents},{windowId,callId})=>{
    const win=BaseWindow.fromId(windowId), wc=webContents.fromId(callId);
    const children=win.contentView.children;
    const view=children.find(v=>v.webContents?.id===callId);
    return {minimized:win.isMinimized(),children:children.map(v=>v.webContents?.id),
     pid:wc?.getOSProcessId(),size:win.getContentSize(),bounds:view?.getBounds(),focused:wc?.isFocused()};
   },{windowId:mainId,callId:callView.id});
   assert.equal(reading.pid,callView.pid,'Debe sobrevivir el proceso de la llamada');
   if(!attached && reading.minimized && reading.children.length===0)return;
   if(attached && !reading.minimized && reading.children.at(-1)===callView.id && reading.focused &&
     reading.bounds?.x===0 && reading.bounds.y===0 && reading.bounds.width===reading.size[0] && reading.bounds.height===reading.size[1])return;
   await delay(100);
  }
  throw Error('Estado incorrecto de la vista de llamada '+(attached?'restaurada':'minimizada')+': '+JSON.stringify(reading));
 }
 async function backgroundShortcut(label){
   const registered=await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Alt+Shift+R'));
   if(registered){
    const windows=process.platform==='win32';
    const sendGlobal=windows ? ()=>runFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',
     "(New-Object -ComObject WScript.Shell).SendKeys('%+r')"],{timeout:8000})
     : ()=>app.evaluate(()=>{
       if(!globalThis.qaGlobalRadio)throw Error('Falta el callback del atajo registrado.');
       globalThis.qaGlobalRadio();
      });
    await assertRadioShortcut(space,peer,sendGlobal,(windows?'teclas del sistema Windows, ':'callback global registrado en macOS, ')+label);
   }else console.log('El sistema reservó Alt+Shift+R; se comprobarán las teclas con foco.');
 }
 await musicSmoke(space,peer,async()=>{
  const connection=await space.evaluateHandle(()=>window.testPeers.find(pc=>pc.connectionState==='connected'));
  try{
   await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].minimize());
   await waitMinimized(true);
   await requireProgress(await radioAndVoice(),'Radio y voz con la ventana minimizada');
   await memory('voz y radio con sala minimizada');
   await onlyCallRenderer(callView,externalLobby);
   await checkCallSurface(false);
   await backgroundShortcut('sala minimizada');
   // A pending navigation can race a real minimize event. Fire the same
   // sidebar action without sending clicks to a hidden system window.
   await space.getByRole('button',{name:'Amigos',exact:true}).evaluate(button=>button.click());
   await space.waitForFunction(()=>document.body.dataset.workspace==='friends',null,{polling:100,timeout:5000});
   await checkCallSurface(false);
  }finally{
   await app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.restore();win.show();win.focus();});
   await waitMinimized(false);
  }
  try{
   await checkCallSurface(true);
   assert.ok(await space.evaluate(pc=>pc && window.testPeers.includes(pc) && pc.connectionState==='connected' &&
    pc.getSenders().some(s=>s.track?.kind==='audio' && s.track.readyState==='live'),connection),
    'Restaurar debe conservar la conexión WebRTC y el micrófono');
   await space.getByRole('heading',{name:'Tus amigos'}).waitFor();
   await requireProgress(await radioAndVoice(),'Radio y voz al restaurar la ventana');
  }finally{await connection.dispose();}
  await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].close());
  try {
   assert.equal(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0]?.isVisible()),false);
   await requireProgress(await radioAndVoice(),'Cerrar la ventana mantiene la voz y la radio');
   await cpuSample('voz y radio en segundo plano');
   await memory('voz y radio en segundo plano');
  } finally {
   await app.evaluate(({app})=>app.emit('second-instance'));
  }
  await checkCallSurface(true);
  home=await openCallHome();
  await home.getByRole('button',{name:'Mi sala',exact:true}).waitFor();
  await requireProgress(await radioAndVoice(),'Radio y voz en el lobby');
  const inlineLobby=space.locator('#call-home-panel');
  async function minimizeCallLobby(label){
   const previousHome=home;
   const previousRenderer=integrated?externalLobby:(await windowState()).views.find(v=>v.host==='home');
   if(integrated)await inlineLobby.waitFor({state:'visible'});
   await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].minimize());
   try{
    await waitMinimized(true);
    await requireProgress(await radioAndVoice(),'Radio y voz con el lobby minimizado');
    await memory(label,integrated?null:'lobby macOS predeterminado minimizado');
    await onlyCallRenderer(callView,previousRenderer);
    await checkCallSurface(false);
    await inlineLobby.waitFor({state:'detached',timeout:5000});
    await backgroundShortcut('lobby minimizado');
   }finally{
    await app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.restore();win.show();win.focus();});
    await waitMinimized(false);
   }
   home=await surface(integrated?'app':'home');
   if(integrated){
    assert.equal(home,space,'Restaurar el lobby integrado debe conservar el motor de voz');
    await checkCallSurface(true);
    await home.waitForFunction(()=>document.body.dataset.workspace==='call-home',null,{polling:100});
    await inlineLobby.getByRole('button',{name:'Mi sala',exact:true}).waitFor();
   }else{
    assert.notEqual(home,previousHome,'Restaurar debe recrear el lobby externo');
    await checkWindow(false);
   }
   await home.getByRole('button',{name:'Mi sala',exact:true}).waitFor();
   await requireProgress(await radioAndVoice(),'Radio y voz al restaurar el lobby');
  }
  await minimizeCallLobby('voz y radio con lobby minimizado');
  if(!integrated){
   home=await navigate(home,'Ajustes','home');
   const preference=home.getByRole('checkbox',{name:/Usar menos memoria con el lobby visible/});
   assert.equal(await preference.isChecked(),false);
   // This controlled checkbox reflects the snapshot sent after main has saved
   // the preference. Wait for both the visible control and the native setting.
   await preference.click();
   await home.waitForFunction(async()=>document.querySelector('.lobby-memory-choice input')?.checked &&
    (await window.squad.state()).integratedLobby,null,{polling:100,timeout:5000});
   assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'desktop.json'),'utf8')).integratedLobby,true);
   integrated=true;
   home=await openCallHome(home);
   await minimizeCallLobby('voz y radio con lobby integrado opcional minimizado');
  }
  await assertRadioShortcut(space,peer,()=>home.keyboard.press('Alt+Shift+KeyR'),'teclado Chromium en el lobby de escritorio');
  const lobbyRadio=()=>home.getByRole('button',{name:/^(Silenciar mi radio|Reanudar mi radio)$/});
  let stop=true;
  await assertRadioShortcut(space,peer,async()=>{
   assert.equal(await lobbyRadio().textContent(),stop?'Silenciar mi radio':'Reanudar mi radio');
   await lobbyRadio().click();
   stop=!stop;
  },'botón de radio del lobby');
  await navigate(home,'Arcade','app');
  await space.locator('[data-game="reflex"]').waitFor();
  await assertRadioShortcut(space,peer,()=>focusedRadioShortcut('app'),'teclas en Arcade');
  home=await openCallHome();
  await openCurrentRoom();
  await space.locator('#room-music [data-listen][aria-pressed="true"]').waitFor();
 });
 home=await openCallHome();
 await navigate(home,'Arcade','app');await space.locator('[data-game="reflex"]').waitFor();
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
  if(section==='player'){
   await space.getByRole('button',{name:'Sin cabello',exact:true,pressed:true}).waitFor();
   const recoveredVisor=space.getByRole('button',{name:'Visor',exact:true,pressed:true});
   const recoverDraft=space.getByRole('button',{name:'Recuperar borrador',exact:true});
   await recoverDraft.or(recoveredVisor).first().waitFor();
   if(await recoverDraft.isVisible())await recoverDraft.click();
   await recoveredVisor.waitFor();
   assert.deepEqual((await savedCharacter(space)).look,originalCharacter.look,'El borrador no debe sobrescribir el perfil guardado.');
   await space.getByRole('button',{name:'Al natural',exact:true}).click();
   await space.getByRole('button',{name:'Con cabello',exact:true}).click();
   await space.getByRole('button',{name:'Azul',exact:true,pressed:true}).waitFor();
   await space.getByRole('button',{name:'Guardar apariencia',exact:true}).click();
   await space.getByText('Apariencia guardada.',{exact:true}).waitFor();
   const updated=await savedCharacter(space);
   assert.equal(updated.id,originalCharacter.id);
   assert.deepEqual(updated.look,{...originalCharacter.look,hairStyle:0});
   console.log('El editor recuperó el borrador tras salir al lobby y guardó su cambio de cabello en el mismo perfil durante la llamada.');
  }
  if(section==='friends'){
   await space.getByRole('heading',{name:'Tus amigos'}).waitFor();
   await space.screenshot({path:path.join(capture,'Amigos-Moderno.png')});
   assert.ok(await space.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
 }
 home=await navigate(space,'Ajustes','home');
 await home.getByRole('heading',{name:'Ajustes',exact:true}).waitFor();
 await checkWindow(false);
 await navigate(home,'Dispositivos de audio','app');await space.getByText('Ganancia automática del micrófono').waitFor();
 await testManualGain(space,peer);
 await testListenBoost(space,peer);
 home=await openCallHome();
 await openCurrentRoom();await space.locator('#room-name').waitFor({state:'visible'});
 await space.screenshot({path:path.join(capture,'Sala-Moderna.png')});
 console.log('Voz bidireccional durante la navegación',first,await audio(first));
 home=await openCallHome();
 home=await navigate(home,'Salir de sala','home');
 await home.getByRole('button',{name:'Crear sala',exact:true}).waitFor();
 space=await navigate(home,'Unirme con código','app');
 await space.locator('#code').fill(code);await space.locator('#submit-entry').click();await space.locator('#room-name').waitFor({state:'visible'});await checkWindow(true);
 console.log('Instalación, ajustes, sala, entrada por código y continuidad de voz verificados.');
 }finally{await browser?.close();await app?.close();backend.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
