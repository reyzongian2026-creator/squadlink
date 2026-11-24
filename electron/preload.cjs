const {contextBridge,ipcRenderer}=require('electron');
const subscribe=(channel,callback)=>{
  const wrapped=(_,data)=>callback(data);
  ipcRenderer.on(channel,wrapped);
  return ()=>ipcRenderer.removeListener(channel,wrapped);
};
if(location.hostname==='home'){
  contextBridge.exposeInMainWorld('squad',{
    state:()=>ipcRenderer.invoke('snapshot'), open:(key)=>ipcRenderer.invoke('open',key),
    action:key=>ipcRenderer.invoke('call',key), prefs:data=>ipcRenderer.invoke('prefs',data),
    updates:()=>ipcRenderer.invoke('updates'), download:()=>ipcRenderer.invoke('download'),
    listen:cb=>subscribe('snapshot',cb)
  });
} else if(location.hostname==='app'){
  const callbacks=new Set();
  ipcRenderer.on('desk-message',(_,data)=>{for(const cb of callbacks)cb({data});});
  contextBridge.exposeInMainWorld('squadBridge',{
    postMessage:data=>ipcRenderer.send('desk-state',data),
    addEventListener:(type,cb)=>{if(type==='message')callbacks.add(cb);},
    removeEventListener:(type,cb)=>{if(type==='message')callbacks.delete(cb);},
    loadPlayerPass:()=>ipcRenderer.invoke('player-pass:load'),
    savePlayerPass:value=>ipcRenderer.invoke('player-pass:save',value),
    exportPlayerPass:value=>ipcRenderer.invoke('player-pass:export',value),
    home:()=>ipcRenderer.send('home')
  });
}
