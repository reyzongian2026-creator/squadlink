import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mountLoadout} from '../../public/progression.js';
import {defaultAvatar} from '../../public/character-model.js';

export async function appearanceDraft(Window) {
  const globals = ['window','document','localStorage'];
  const original = globals.map(key => Object.getOwnPropertyDescriptor(globalThis,key));
  const profiles = new Map();
  const writes = [];
  let win;
  async function openAs(id) {
    const stored = [];
    if (win) {
      for (let i=0; i<win.localStorage.length; i++) {
        const key=win.localStorage.key(i);
        stored.push([key,win.localStorage.getItem(key)]);
      }
      await win.happyDOM.abort();
    }
    win = new Window({url:'http://localhost',settings:{disableCSSFileLoading:true}});
    for (const key of globals) Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?win:win[key]});
    for (const [key,value] of stored) localStorage.setItem(key,value);
    document.body.innerHTML='<section id="loadout"></section><dialog id="entry"></dialog>';
    if (!profiles.has(id)) profiles.set(id,{id,nick:id,characterCreated:true,xp:0,revision:1,best:{},avatar:{...defaultAvatar}});
    const profile=profiles.get(id);
    const editor=mountLoadout({getSelf:()=>({id,nick:id}),tell(){},async api(path,body) {
      if (path==='progress/ranking') return {players:[]};
      if (path==='progress/avatar') {
        for (const k of Object.keys(defaultAvatar)) profile.avatar[k]=body[k];
        profile.revision++;
        writes.push(id);
      }
      return {profile:structuredClone(profile)};
    }});
    await editor.refresh();
  }
  const el=id=>document.getElementById(id);
  const option=name=>document.querySelector('#kit-options button[aria-label="'+name+'"]');
  const press=(name,key)=>option(name).dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  try {
    await openAs('Pepe');
    press('Al natural','End');
    assert.equal(document.activeElement,option('Visor'));
    assert.equal(option('Visor').getAttribute('aria-pressed'),'true');
    press('Visor','Home');
    assert.equal(el('kit-save').disabled,true,'Volver al aspecto original no deja cambios pendientes');
    option('Violeta').click();
    assert.match(option('Violeta').closest('fieldset').querySelector('legend').textContent,/Violeta/);
    await openAs('Otro');
    assert.equal(el('kit-draft').hidden,true,'Un borrador pertenece solo a su perfil');
    profiles.get('Pepe').avatar.skin=3;
    await openAs('Pepe');
    assert.equal(el('kit-draft').hidden,false);
    assert.equal(option('Color original').getAttribute('aria-pressed'),'true');
    el('kit-recover').click();
    assert.equal(option('Violeta').getAttribute('aria-pressed'),'true');
    assert.equal(option('Cobre').getAttribute('aria-pressed'),'true');
    assert.deepEqual(writes,[],'Recuperar un borrador no cambia la apariencia publicada');
    el('kit-save').click();
    await delay(0);
    assert.deepEqual(writes,['Pepe']);
    assert.equal(profiles.get('Pepe').avatar.hairColor,6);
    profiles.get('Pepe').avatar.hairColor=5;
    await openAs('Pepe');
    assert.equal(el('kit-draft').hidden,true,'Un guardado confirmado retira el borrador');
    option('Gorra').click();
    await openAs('Pepe');
    el('kit-drop').click();
    await openAs('Pepe');
    assert.equal(el('kit-draft').hidden,true);
    assert.equal(option('Al natural').getAttribute('aria-pressed'),'true');
  } finally {
    globals.forEach((key,index) => { if(original[index]) Object.defineProperty(globalThis,key,original[index]); else delete globalThis[key]; });
    if(win) await win.happyDOM.abort();
  }
}
