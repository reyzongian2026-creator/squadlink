// Copied only into the disposable CI installation and temporarily selected as
// its entry point. Every product module, including safeStorage, runs unmodified.
const {app,session}=require('electron');
const fs=require('node:fs');
const fixture=JSON.parse(process.env.SQUAD_TEST_UPDATE_NETWORK);
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const address=String(input);
  const catalog='https://api.github.com/repos/reyzongian2026-creator/squadlink/releases?';
  const endpoint=address.startsWith(catalog)?'/catalog':address===fixture.assetUrl?'/asset':null;
  if (endpoint) fs.appendFileSync(fixture.log,JSON.stringify({endpoint,online:fixture.online})+'\n');
  if (!endpoint || !fixture.online) throw new TypeError('El perfil de prueba está sin conexión.');
  return nativeFetch(fixture.origin+endpoint,options);
};
app.whenReady().then(()=>{
  for (const target of [session.defaultSession,session.fromPartition('persist:squadlink-modern')]) {
    target.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,done)=>done({cancel:true}));
  }
});
require('./main.cjs');
