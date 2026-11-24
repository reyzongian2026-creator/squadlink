import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {defaultAvatar} from '../../public/character-model.js';
import {mountLoadout} from '../../public/progression.js';

export async function avatarFlow(Window) {
  const win = new Window({url:'http://localhost',settings:{disableCSSFileLoading:true}});
  const globals = ['window','document','localStorage'];
  const previous = globals.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  try {
    for (const key of globals) Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?win:win[key]});
    document.body.innerHTML='<section id="loadout"></section><button id="profile">Apodo</button><dialog id="entry"></dialog>';
    let session, pauseSave, pauseFinish, resumeProfile, holdProfile=false, loseReply=false;
    const makeProfile = id=>({id,nick:id,xp:0,revision:1,avatar:{...defaultAvatar},best:{},characterCreated:false});
    const profiles = {Pepe:makeProfile('Pepe'),Ana:makeProfile('Ana')};
    const writes = [];
    const editor = mountLoadout({getSelf:()=>session,tell(){},async api(path,body) {
      const row=profiles[session.nick];
      if (path==='progress/profile') {
        if (holdProfile) await new Promise(resolve=>{resumeProfile=resolve;});
        return {profile:structuredClone(row),receipt:row.id};
      }
      if (path==='progress/ranking') return {players:[]};
      if (path==='progress/finish') {
        await new Promise(resolve=>{pauseFinish=resolve;});
        return {profile:structuredClone(row),receipt:row.id,earned:1};
      }
      assert.equal(path,'progress/avatar');
      if (body.expectedRevision!==undefined && body.expectedRevision!==row.revision)
        throw Object.assign(Error('Revisión distinta'),{status:409});
      row.revision++;
      row.characterCreated=true;
      for (const key of Object.keys(defaultAvatar)) row.avatar[key]=body[key];
      const response={profile:structuredClone(row),receipt:row.id};
      writes.push(row.id);
      if (pauseSave) await pauseSave;
      if (loseReply) { loseReply=false; throw TypeError('Conexión interrumpida'); }
      return response;
    }});
    const el=id=>document.getElementById(id);
    const option=label=>document.querySelector('#kit-options button[aria-label="'+label+'"]');
    const pressed=label=>option(label).getAttribute('aria-pressed')==='true';
    option('Azul').click();
    el('kit-save').click();
    await editor.refresh();  // Navigating back while the nickname dialog is still open.
    assert.ok(pressed('Azul'),'El invitado conserva el color antes de elegir apodo');
    session={id:'session1',nick:'Pepe'};
    await editor.refresh();
    assert.deepEqual(writes,['Pepe'],'La elección de invitado se guarda al crear el apodo');
    assert.equal(profiles.Pepe.avatar.hairColor,5);

    let releaseFirst;
    pauseSave=new Promise(resolve=>{releaseFirst=resolve;});
    option('Rojo').click();
    el('kit-save').click();
    option('Negro').click();
    releaseFirst(); pauseSave=null;
    await delay(0);
    assert.match(el('kit-status').textContent,/sin guardar/i);
    assert.ok(pressed('Negro'));
    assert.equal(el('kit-save').disabled,false);
    el('kit-save').click(); await delay(0);
    assert.equal(profiles.Pepe.avatar.hairColor,1);

    let releaseOld;
    pauseSave=new Promise(resolve=>{releaseOld=resolve;});
    option('Rubio').click();
    el('kit-save').click();
    const oldGame=editor.finish({runId:'a'});
    session={id:'session2',nick:'Ana'};
    pauseSave=null;
    await editor.refresh();
    assert.ok(pressed('Color original'),'Se presenta el aspecto de la nueva identidad');
    assert.equal(el('kit-save').disabled,false,'Un guardado anterior no bloquea al nuevo jugador');
    option('Blanco').click();
    el('kit-save').click(); await delay(0);
    assert.equal(profiles.Ana.avatar.hairColor,7);
    releaseOld(); pauseFinish(); await oldGame; await delay(0);
    assert.equal(el('kit-nick').textContent,'Ana','Una partida tardía no restaura al jugador previo');
    assert.equal(localStorage.getItem('squadlink.progress.receipt.v1'),'Ana');
    assert.ok(pressed('Blanco'));

    option('Azul').click();
    loseReply=true;
    el('kit-save').click(); await delay(0);
    assert.match(el('kit-status').textContent,/interrumpida/);
    const saved=profiles.Ana.revision;
    el('kit-save').click(); await delay(0);
    assert.equal(profiles.Ana.revision,saved,'El reintento confirma el guardado y no genera otra revisión');
    assert.equal(el('kit-save').disabled,true);
    assert.match(el('kit-status').textContent,/guardada/i);

    option('Rojo').click();
    profiles.Ana.avatar.hairColor=2;
    profiles.Ana.avatar.outfit=5;
    profiles.Ana.revision++;
    holdProfile=true;
    el('kit-save').click(); await delay(0);
    option('Violeta').click();
    holdProfile=false; resumeProfile(); await delay(0);
    assert.ok(pressed('Violeta'),'El color editado durante la recuperación sigue seleccionado');
    assert.ok(pressed('Ámbar'),'La chaqueta que cambió en otro dispositivo se conserva');
    assert.match(el('kit-status').textContent,/Revisa/i);
    el('kit-save').click(); await delay(0);
    assert.equal(profiles.Ana.avatar.hairColor,6);
    assert.equal(profiles.Ana.avatar.outfit,5);

    session=null;
    await editor.refresh();
    option('Rubio').click(); el('kit-save').click();
    el('entry').dispatchEvent(new win.Event('close'));
    session={id:'session3',nick:'Ana'};
    await editor.refresh();
    assert.ok(pressed('Violeta'),'Cancelar la creación no aplica el borrador a otra cuenta');
    assert.equal(profiles.Ana.avatar.hairColor,6);
  } finally {
    globals.forEach((key,index)=>{if(previous[index]) Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});
    await win.happyDOM.abort();
  }
}
