const {app,BaseWindow,WebContentsView,protocol,session,ipcMain,dialog,Menu,Tray,nativeImage,globalShortcut,systemPreferences,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {relay,parseServer}=require('./gateway.cjs');
const {detect}=require('./detection.cjs');
const {createPlayerVault,writePrivateFile,checkPass}=require('./player-vault.cjs');
const base='https://squadlink-lobby.onrender.com';
const {findUpdate,downloadUpdate,verifyDownloaded}=require('./update-release.cjs');
const {createUpdateController}=require('./update-controller.cjs');
const {createUpdateCache}=require('./update-cache.cjs');
const mac=process.platform==='darwin';
const titles={create:'Crear sala',join:'Unirme con código',lobby:'Mi sala',rooms:'Explorar salas',friends:'Amigos',player:'Mi jugador',arcade:'Arcade',guide:'Guía de sala',ranking:'Clasificación',settings:'Dispositivos de audio'};
const prefsFile=()=>path.join(app.getPath('userData'),'desktop.json');
function savePrefs(value){
 const file=prefsFile();
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});
 fs.renameSync(file+'.tmp',file);
}
const blank=()=>({joined:false,name:'',nickname:'',code:'',mic:false,canMic:false,members:[]});
let prefs={server:base,low:true,integratedLobby:!mac},state=blank(),home,view,hostSection='home',action,ready=false,visit=0,closing=false,microphone=false;
let hostView, tray, radioState='empty';
let detectTimer,scanning=false,generation=0,detected=null;
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
function activateDesktop(){
 if(closing||!home||home.isDestroyed())return;
 reveal(home);
}
app.on('second-instance',activateDesktop);
if(mac)app.on('activate',activateDesktop);
protocol.registerSchemesAsPrivileged([{scheme:'squad',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,allowServiceWorkers:false}}]);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const options={contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'preload.cjs'),partition:'persist:squadlink-modern'};
function reveal(w){if(w&&!w.isDestroyed()){if(w.isMinimized())w.restore();w.show();w.focus();}}
function inBackground(){return home && (home.isMinimized() || !home.isVisible());}
function createTray(){
 const image=nativeImage.createFromPath(path.join(__dirname,'client','icon-192.png'));
 const icon=new Tray(image.resize({width:mac?18:24,height:mac?18:24}));
 icon.setToolTip('Squadlink');
 icon.setContextMenu(Menu.buildFromTemplate([
  {label:'Abrir Squadlink',click:activateDesktop},
  {label:'Pasar a segundo plano',click:()=>home.hide()},
  {type:'separator'},
  {label:'Salir de Squadlink',click:()=>app.quit()}
 ]));
 if(!mac)icon.on('click',activateDesktop);
 return icon;
}
function snapshot(){return {...state,...prefs,canChooseLobby:mac,radioState,hostSection:action?'workspace':hostSection,version:app.getVersion(),update:updater.snapshot()};}
function hostContents(){return hostView?.webContents;}
function callLobbyState(){return {...state,radioState,low:prefs.low};}
function publish(){
 const wc=hostContents();
 if(inBackground())return;
 if(wc&&!wc.isDestroyed())wc.send('snapshot',snapshot());
 if(action?.key==='call-home')send({type:'desktop:lobby-state',state:callLobbyState()});
}
const radioAccelerator='Alt+Shift+R';
let lastRadioPress=-Infinity;
function toggleRadio(){
 if(!state.joined || !view || view.webContents.isDestroyed())return;
 const now=performance.now();
 if(now-lastRadioPress<180)return;
 lastRadioPress=now;
 send({type:'desktop:radio-toggle'});
}
function syncRadioShortcut(joined){
 if(joined){
  if(!globalShortcut.isRegistered(radioAccelerator))globalShortcut.register(radioAccelerator,toggleRadio);
 }else if(globalShortcut.isRegistered(radioAccelerator)){
  globalShortcut.unregister(radioAccelerator);
 }
}
function guard(contents){
  contents.on('before-input-event',(event,input)=>{
   if(state.joined && input.type==='keyDown' && input.alt && input.shift && !input.control && !input.meta && input.code==='KeyR'){
    event.preventDefault();
    if(!input.isAutoRepeat)toggleRadio();
   }
  });
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',e=>e.preventDefault());
  contents.on('will-attach-webview',e=>e.preventDefault());
}
function isHome(e){const wc=hostContents();return wc&&!wc.isDestroyed()&&e.sender===wc&&e.senderFrame===wc.mainFrame;}
function fromVoice(e){return view&&e.sender===view.webContents&&e.senderFrame===view.webContents.mainFrame;}
function hostPage(event){if(!isHome(event))throw Error('Acceso no disponible.');}
function send(data){if(view&&!view.webContents.isDestroyed())view.webContents.send('desk-message',data);}
function dispatch(key,code){
 const message={type:'desktop:action',action:key,code,visit,low:prefs.low};
 if(key==='call-home'){message.state=callLobbyState();message.visible=!inBackground();}
 send(message);
}
function canSuspendLobby(){return prefs.low && state.joined && !action && hostSection==='home';}
function showHost(section='home'){
 if(action){
  home.contentView.removeChildView(view);
  action=null;
  visit++;
  if(ready)dispatch('background');
 }
 hostSection=section;
 if(inBackground() && canSuspendLobby())releaseHost();
 else mountHost();
 publish();
 hostContents()?.focus();
}
function contentBounds(){
  if(!home||home.isDestroyed())return;
  const [width,height]=home.getContentSize();
  const bounds={x:0,y:0,width,height};
  hostView?.setBounds(bounds);
  if(action)view?.setBounds(bounds);
}
function presentWorkspace(minimized=inBackground()){
 if(!view || !action)return;
 const parent=home.contentView;
 if(minimized && prefs.low && state.joined){
  if(parent.children.includes(view))parent.removeChildView(view);
 }else{
  if(!parent.children.includes(view))parent.addChildView(view);
  contentBounds();
  if(!minimized)view.webContents.focus();
 }
}
function stopDetection(){generation++;clearInterval(detectTimer);detectTimer=null;detected=null;}
async function scan(){if(scanning||!detectTimer)return;scanning=true;const ticket=generation;
  try{const game=await detect(detected);if(ticket===generation&&game!==detected){detected=game;send({type:'squadlink:game',enabled:true,game});}}catch{}finally{scanning=false;}}
function disposeVoice(){
 stopDetection();ready=false;
 if(view){const old=view;view=null;if(action&&!home.isDestroyed())home.contentView.removeChildView(old);old.webContents.close();}
 action=null;
}
function mountHost(){
 if(hostView)return;
 hostView=new WebContentsView({webPreferences:options});
 const wc=hostView.webContents;
 guard(wc);
 home.contentView.addChildView(hostView);
 contentBounds();
 wc.loadURL('squad://home/');
}
function releaseHost(){
 if(!hostView)return;
 const old=hostView;
 hostView=null;
 home.contentView.removeChildView(old);
 old.webContents.close();
}
function createHome(){
 const frame={title:'Squadlink',width:1080,height:700,minWidth:700,minHeight:520,backgroundColor:'#0d1217',icon:path.join(__dirname,'Squadlink.ico'),autoHideMenuBar:true};
 const w=new BaseWindow(frame);
 function suspend(){
  if(closing || !home)return;
  // Keep the call and any unsaved settings alive while the lobby is off screen.
  if(action){
   if(action.key==='call-home')send({type:'desktop:lobby-visibility',visible:false});
   presentWorkspace(true);
  }else if(canSuspendLobby())releaseHost();
 }
 function resume(){
  if(closing || !home || inBackground())return;
  if(action){
   presentWorkspace(false);
   if(action.key==='call-home')send({type:'desktop:lobby-visibility',visible:true});
  }else{mountHost();hostContents()?.focus();}
  publish();
 }
 w.on('minimize',suspend);
 w.on('hide',suspend);
 w.on('restore',resume);
 w.on('show',resume);
 w.on('resize',contentBounds);
 w.on('session-end',()=>{closing=true;});
 w.on('close',event=>{
  if(!closing && tray){event.preventDefault();w.hide();return;}
  closing=true;
  disposeVoice();
  releaseHost();
 });
 return w;
}
function ensureView(){
 if(view)return;
 view=new WebContentsView({webPreferences:options});const wc=view.webContents;guard(wc);
 wc.on('render-process-gone',()=>{if(view?.webContents!==wc)return;disposeVoice();state=blank();syncRadioShortcut(false);showHost();
 dialog.showMessageBox(home,{type:'warning',message:'El motor de la sala se cerró. Puedes volver a abrirla desde el lobby.'});});
 wc.on('before-input-event',(e,input)=>{if(input.type==='keyDown'&&(mac?input.meta:input.control)&&input.shift&&input.code==='KeyM'&&!input.isAutoRepeat&&state.canMic){e.preventDefault();dispatch('mic');}});
 wc.loadURL('squad://app/?server='+encodeURIComponent(prefs.server));
}
function open(key,code){
 if(updater.snapshot().phase==='installing'&&!state.joined)return;
 if(key==='home' && state.joined && prefs.low && prefs.integratedLobby)key='call-home';
 else if(key==='home' || key==='preferences'){showHost(key);return;}
 else if(!Object.hasOwn(titles,key))throw Error('Opción desconocida.');
 if(state.joined&&['create','join'].includes(key))key='lobby';
 if(key==='lobby'&&!state.joined)key='rooms';
 ensureView();
 visit++;
 action={key,code};
 if(prefs.low&&state.joined)releaseHost();
 presentWorkspace();
 publish();
 if(ready)dispatch(key,code);
}
function gameStatus(){send({type:'squadlink:game',enabled:Boolean(detectTimer),game:detected});}
ipcMain.on('home',e=>{if(fromVoice(e))open('home');});
ipcMain.on('radio-shortcut',e=>{if(isHome(e)||fromVoice(e))toggleRadio();});
ipcMain.on('desk-state',async(e,m)=>{
 if(!fromVoice(e)||!m||typeof m!=='object')return;
 if(m.type==='desktop:radio-state'){
  if(['playing','muted','empty'].includes(m.state)){radioState=m.state;publish();}
 }else if(m.type==='desktop:navigate'){
  if(['home','lobby','rooms','friends','player','arcade','ranking','guide','preferences','settings'].includes(m.page))open(m.page);
 }else if(m.type==='desktop:lobby-control'){
  if(action?.key!=='call-home' || !state.joined)return;
  if(m.action==='radio')toggleRadio();
  else if(m.action==='mic' && state.canMic)dispatch('mic');
  else if(m.action==='leave' && state.canLeave)dispatch('leave');
 }else if(m.type==='desktop:state'){
  if(m.identified===true&&!prefs.hasPlayer){
   const next={...prefs,hasPlayer:true};
   try{savePrefs(next);prefs=next;}catch{} // A read-only profile can still join this session.
  }
  const before=state.joined;state={joined:m.joined===true,name:String(m.name||'').slice(0,80),nickname:String(m.nickname||'').slice(0,40),code:String(m.code||'').slice(0,6),mic:m.mic===true,canMic:m.canMic===true,canLeave:m.canLeave!==false,members:Array.isArray(m.members)?m.members.slice(0,5):[]};publish();
  if(!ready){
   ready=true;
   if(mac)require('./update-mac.cjs').confirmMacUpdateReady();
   if(action)dispatch(action.key,action.code);else dispatch('background');
  }
  if(state.joined!==before)syncRadioShortcut(state.joined);
  if(state.joined&&!before)open('lobby');
  if(before&&!state.joined)showHost();
 }else if(m.type==='desktop:release'&&m.visit===visit&&!state.joined&&!action&&prefs.low)disposeVoice();
 else if(m.type==='squadlink:game:status'&&!mac)gameStatus();
 else if(m.type==='squadlink:game:set'){
  if(mac)return;
  if(!m.enabled){stopDetection();gameStatus();return;}
  if(detectTimer)return;
  const ticket=generation;
  const {response}=await dialog.showMessageBox(home,{type:'question',buttons:['Cancelar','Compartir'],defaultId:0,cancelId:0,message:'¿Compartir el juego detectado con tu grupo?'});
  if(response===1&&generation===ticket&&fromVoice(e)){detectTimer=setInterval(scan,30000);gameStatus();scan();}
 }
});
const playerVault=createPlayerVault(()=>path.join(app.getPath('userData'),'player-pass.enc'),safeStorage);
function playerPage(event){
 if(!fromVoice(event)||!event.senderFrame.url.startsWith('squad://app/'))throw Error('Acceso no disponible.');
}
ipcMain.handle('player-pass:load',event=>{playerPage(event);return playerVault.load();});
ipcMain.handle('player-pass:save',(event,raw)=>{playerPage(event);return playerVault.save(raw);});
ipcMain.handle('player-pass:export',async(event,raw)=>{
 playerPage(event);checkPass(raw);
 const result=await dialog.showSaveDialog(home,{title:'Guardar mi pase privado',defaultPath:'Mi-jugador.squadlink',
 filters:[{name:'Pase de jugador Squadlink',extensions:['squadlink']}]});
 if(result.canceled||!result.filePath)return false;
 await writePrivateFile(result.filePath,raw);
 return true;
});
ipcMain.handle('snapshot',e=>{hostPage(e);if(mac)require('./update-mac.cjs').confirmMacUpdateReady();return snapshot();});
ipcMain.handle('open',(e,value)=>{hostPage(e);open(typeof value==='string'?value:value?.key,/^[A-Z0-9]{6}$/.test(value?.code)?value.code:undefined);});
ipcMain.handle('call',(e,key)=>{
 hostPage(e);
 if(!state.joined)return;
 if(key==='radio')toggleRadio();
 else if(['mic','leave'].includes(key))dispatch(key);
});
ipcMain.handle('prefs',(e,data)=>{
 hostPage(e);let next={...prefs};
 if(typeof data?.low==='boolean')next.low=data.low;
 if(mac && typeof data?.integratedLobby==='boolean')next.integratedLobby=data.integratedLobby;
 if(typeof data?.server==='string'){next.server=parseServer(data.server);if(next.server!==prefs.server&&state.joined)throw Error('Sal de la llamada antes de cambiar de servidor.');}
 savePrefs(next);
 if(next.server!==prefs.server){disposeVoice();state=blank();microphone=false;}
 prefs=next;if(ready&&action)dispatch(action.key,action.code);publish();
});
const updateRoot=()=>path.join(app.getPath('userData'),'update-cache');
let pendingUpdateCache;
function getUpdateCache(){
 if(!pendingUpdateCache){
  const cipher=safeStorage.isEncryptionAvailable() ? {
   seal:text=>safeStorage.encryptString(text), open:bytes=>safeStorage.decryptString(bytes)
  } : {};
  pendingUpdateCache=createUpdateCache(updateRoot(),{
   currentVersion:app.getVersion(), platform:process.platform, arch:process.arch, ...cipher
  });
 }
 return pendingUpdateCache;
}
const updater=createUpdateController({
 cache:{
  restore:()=>getUpdateCache().restore(),
  save:(release,local)=>getUpdateCache().save(release,local),
  forget:()=>getUpdateCache().forget()
 },
 find:({hasDownload}={})=>findUpdate({currentVersion:app.getVersion(),signal:hasDownload ? AbortSignal.timeout(5000) : undefined}),
 download:async(release,onProgress,signal)=>{
  const root=updateRoot();
  await fs.promises.mkdir(root,{recursive:true,mode:0o700});
  if(!(await fs.promises.lstat(root)).isDirectory())throw Error('La carpeta de actualizaciones no está disponible.');
  return downloadUpdate(release,{tempDir:root,onProgress,signal});
 },
 verify:verifyDownloaded,
 prepare:async(release,filePath)=>{
  if(!app.isPackaged)throw Error('La instalación interna está disponible en la aplicación de escritorio instalada.');
  if(mac){
   const {prepareMacUpdate}=require('./update-mac.cjs');
   return prepareMacUpdate({zipPath:filePath,expectedVersion:release.version,appPath:path.resolve(process.execPath,'../../..'),userDataPath:app.getPath('userData')});
  }
  if(process.platform==='win32'){
   const {installWindowsUpdate}=require('./update-windows.cjs');
   return {launch:()=>installWindowsUpdate(filePath,{executablePath:process.execPath,parentPid:process.pid,userDataPath:app.getPath('userData')})};
  }
  throw Error('Este sistema aún no admite la actualización interna.');
 },
 inRoom:()=>state.joined,
 quit:()=>app.quit(),
 notify:publish
});
for(const [channel,method] of [['updates','check'],['download','download'],['cancel-download','cancelDownload'],['install-update','install']]){
 ipcMain.handle(channel,e=>{hostPage(e);return updater[method]();});
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const csp="default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;connect-src 'self';media-src 'self' blob: https:;object-src 'none';frame-src 'self';base-uri 'none';form-action 'self'";
async function start(){
 try{const saved=JSON.parse(fs.readFileSync(prefsFile(),'utf8'));prefs={server:parseServer(saved.server),low:saved.low!==false,integratedLobby:!mac || saved.integratedLobby===true,hasPlayer:saved.hasPlayer===true};}catch{}
 // Electron 45 uses the default session when reading Blob uploads in the custom protocol.
 // Warm it before creating a view so Chromium can discard its spare renderer at startup.
 void session.defaultSession;
 const ses=session.fromPartition(options.partition);
 ses.protocol.handle('squad',async req=>{
  const {hostname,pathname}=new URL(req.url);if(!['home','app'].includes(hostname))return new Response(null,{status:404});
  if(pathname.startsWith('/api/')){
   if(hostname==='home'&&(pathname!=='/api/directory'||req.method!=='GET'))return new Response(null,{status:403});
   return relay(req,prefs.server,ses.cookies);
  }
  if(req.method!=='GET'||!/^\/(?:[a-zA-Z0-9_.-]+)?$/.test(pathname))return new Response(null,{status:404});
  let name=pathname.slice(1),dir=path.join(__dirname,'client');
  if(hostname==='home'){
   name=name||'home.html';
   if(['home.html','home.css','home.js','channels.css'].includes(name))dir=__dirname;
   else if(!['hero-art.webp','icon-192.png'].includes(name))return new Response(null,{status:404});
  }else name=name||'index.html';
  if (hostname==='app' && ['mario3.nes','duck-nes.nes'].includes(name)) {
   try {
    const bytes=await fs.promises.readFile(path.join(__dirname,'cartridges',name));
    return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
   } catch {return new Response(null,{status:404});}
  }
  const type=mime[path.extname(name)];if(!type)return new Response(null,{status:404});
  try{return new Response(await fs.promises.readFile(path.join(dir,name)),{headers:{'Content-Type':type,'Content-Security-Policy':name==='doom-player.html' ? "frame-ancestors 'self'; object-src 'none'" : csp,'X-Content-Type-Options':'nosniff'}});}catch{return new Response(null,{status:404});}
 });
 const trusted=wc=>wc&&view?.webContents===wc&&wc.getURL().startsWith('squad://app/');
 ses.setPermissionCheckHandler((wc,p)=>trusted(wc)&&((p==='media'&&microphone)||p==='speaker-selection'||(['pointerLock','fullscreen'].includes(p)&&action?.key==='arcade')));
 ses.setPermissionRequestHandler(async(wc,p,done,details)=>{
  if(!trusted(wc))return done(false);
  if(['pointerLock','fullscreen'].includes(p))return done(action?.key==='arcade');
  if(['speaker-selection','clipboard-sanitized-write'].includes(p))return done(true);
  if(p!=='media'||!details.mediaTypes?.includes('audio')||details.mediaTypes.includes('video'))return done(false);
  if(!microphone){const answer=await dialog.showMessageBox(home,{type:'question',message:'¿Permitir que Squadlink use tu micrófono?',buttons:['Cancelar','Permitir'],cancelId:0,defaultId:0});microphone=answer.response===1&&trusted(wc);}
  if(microphone&&mac)microphone=await systemPreferences.askForMediaAccess('microphone');
  done(microphone&&trusted(wc));
 });
 if(mac)Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'windowMenu'}]));
 else Menu.setApplicationMenu(null);
 // A new player starts in the character editor. Create the lobby only on its first visit.
 // A returning player's hidden workspace restores presence when the session opens.
 const returning=prefs.hasPlayer||(await ses.cookies.get({url:prefs.server,name:'squad_session'})).length>0;
 home=createHome();
 tray=createTray();
 if(returning){
  mountHost();
  ensureView();
 }else open('player');
 reveal(home);
}
if(locked)app.whenReady().then(start);
app.on('before-quit',()=>{closing=true;});
app.on('will-quit',()=>{tray?.destroy();if(app.isReady())syncRadioShortcut(false);});
app.on('window-all-closed',()=>app.quit());
