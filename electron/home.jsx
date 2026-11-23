import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
const api=window.squad;
const shapes={
  sound:<><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/></>,
  group:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3c3 1 3 3 3 5"/></>,
  game:<><path d="M7 8h10c3 0 4 4 5 9 .4 3-2 4-4 2l-3-3H9l-3 3c-2 2-5 1-4-2 1-5 2-9 5-9Z"/><path d="M6 12h4m-2-2v4m8-3h.1m2 2h.1"/></>,
  trophy:<><path d="M7 4h10v6a5 5 0 0 1-10 0Zm0 2H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4m-5 3v5m-4 0h8"/></>,
  person:<><circle cx="12" cy="8" r="3"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/></>,
  sliders:<><path d="M4 6h8m4 0h4M4 12h3m4 0h9M4 18h10m4 0h2"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></>,
  headset:<><path d="M4 14V11a8 8 0 0 1 16 0v3m-2 4c0 3-3 3-5 3"/><rect x="3" y="11" width="4" height="7" rx="2"/><rect x="17" y="11" width="4" height="7" rx="2"/></>,
  mic:<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v4m-4 0h8"/></>,
  grid:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  plus:<path d="M12 5v14M5 12h14"/>,code:<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20"/>,arrow:<path d="m9 5 7 7-7 7"/>,exit:<path d="M10 3H5v18h5m-1-9h12m-5-5 5 5-5 5"/>
};
function Icon({id}){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{shapes[id]}</svg>}
const shortcuts=[['friends','Amigos','group'],['player','Mi jugador','person'],['arcade','Minijuegos','game'],['ranking','Clasificación','trophy']];
const params=new URLSearchParams(location.search);
function App(){
 const [state,update]=useState(null),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[address,setAddress]=useState(''),[checking,setChecking]=useState(false);
 const [rooms,setRooms]=useState([]),[directoryStatus,setDirectoryStatus]=useState('Buscando salas…');
 const prefs=params.get('page')==='preferences';
 useEffect(()=>{const off=api.listen(update);api.state().then(update).catch(e=>setError(e.message));return off},[]);
 const server=state?.server;
 useEffect(()=>{if(!server)return;setAddress(server);if(prefs)return;let alive=true;const controller=new AbortController();
  setRooms([]);setDirectoryStatus('Buscando salas…');
  fetch('/api/directory',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{if(alive){const list=(data.rooms||[]).slice(0,3);setRooms(list);setDirectoryStatus(list.length?'':'Todavía no hay salas públicas.')}}).catch(()=>{if(alive)setDirectoryStatus('Directorio sin conexión.');});
  return()=>{alive=false;controller.abort()};},[server,prefs,state?.joined]);
 async function run(work){setError('');try{return await work()}catch(e){setError(e.message.replace(/^Error invoking remote method.*?Error: /,''));}}
 function open(key,code){run(()=>api.open(code?{key,code}:key))}
 function tile([key,title,icon]){return <button className={'tile tile-'+key} key={key} onClick={()=>open(key)}><span className="glyph"><Icon id={icon}/></span><b>{title}</b><span className="chevron" aria-hidden="true">›</span></button>}
 if(!state)return <main><p role="status">{error||'Abriendo Squadlink…'}</p></main>;
 return <><header className="brand"><div><img src="/icon-192.png" alt=""/><b>Squadlink</b></div>{!prefs&&<button className="identity" onClick={()=>open('player')}><span>{(state.nickname||'J').slice(0,1).toUpperCase()}</span>{state.nickname||'Mi jugador'}</button>}</header>
 {prefs?<main className="config"><h1>Ajustes</h1>
 <section><h2>Rendimiento</h2><div className="choices">{[[true,'Bajo consumo'],[false,'Experiencia completa']].map(([value,label])=><button key={label} aria-pressed={state.low===value} onClick={()=>run(()=>api.prefs({low:value}))}>{label}</button>)}</div><p>En bajo consumo, los efectos se reducen y el motor de sala se libera cuando sales como invitado.</p></section>
 <section><h2>Servidor del grupo</h2><form onSubmit={e=>{e.preventDefault();run(async()=>{await api.prefs({server:address});setFeedback('Servidor guardado.')})}}><input aria-label="Servidor" type="url" required value={address} onChange={e=>setAddress(e.target.value)}/><button>Guardar</button></form></section>
 <section><h2>Actualizaciones</h2><p>Versión instalada · {state.version}</p><button disabled={checking} onClick={()=>run(async()=>{setChecking(true);try{setFeedback(await api.updates())}finally{setChecking(false)}})}>{checking?'Buscando…':'Buscar actualizaciones'}</button>{state.updateUrl&&<button onClick={()=>run(()=>api.download())}>Descargar actualización</button>}</section>
 {feedback&&<p role="status">{feedback}</p>}</main>:<main>
 <div className="intro"><h1>Lobby</h1><button className="quiet" onClick={()=>open('preferences')}><Icon id="sliders"/> Ajustes</button></div>
 <section className="hero"><div className="scene"></div><div className="hero-copy"><span className="signal"><Icon id="sound"/> VOZ EN GRUPO</span><h2>{state.joined?state.name:'Tu sala de voz'}</h2><p>{state.joined?state.members.length+' en la sala · Código '+state.code:'Crea una sala o entra con el código de tu grupo.'}</p>
 <div className="actions">{state.joined?<><button className="primary" onClick={()=>open('lobby')}><Icon id="headset"/> Mi sala</button><button disabled={!state.canMic} onClick={()=>run(()=>api.action('mic'))}><Icon id="mic"/>{state.mic?'Silenciar':'Activar micrófono'}</button><button className="exit" aria-label="Salir de sala" onClick={()=>run(()=>api.action('leave'))}><Icon id="exit"/></button></>:<><button className="primary" onClick={()=>open('create')}><Icon id="plus"/>Crear sala</button><button onClick={()=>open('join')}><Icon id="code"/>Unirme con código</button></>}</div></div></section>
 <div className="columns"><section className="block"><div className="section-head"><h2>Salas públicas</h2><button onClick={()=>open('rooms')}>Explorar salas <span>→</span></button></div>
 {rooms.length?<ul>{rooms.map(r=><li key={r.code}><button disabled={state.joined} onClick={()=>open('join',r.code)}><span className="room-symbol"><Icon id="sound"/></span><span><b>{r.name}</b><small>{[r.game,r.level].filter(Boolean).join(' · ')||'Sala de voz'}</small></span><em>{r.count}/{r.capacity}</em></button></li>)}</ul>:<div className="empty"><Icon id="headset"/><p>{directoryStatus}</p></div>}</section>
 <section className="block"><div className="section-head"><h2>Tu espacio</h2></div><div className="tiles">{shortcuts.map(tile)}</div></section></div>
 <footer><button onClick={()=>open('settings')}><Icon id="mic"/>Dispositivos de audio</button><button onClick={()=>open('preferences')}><i/>{state.low?'Bajo consumo':'Experiencia completa'}</button></footer></main>}
 {error&&<aside className="error" role="alert">{error}</aside>}</>
}
createRoot(document.getElementById('root')).render(<App/>);
