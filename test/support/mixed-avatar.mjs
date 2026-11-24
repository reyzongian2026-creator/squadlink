import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {defaultAvatar} from '../../public/character-model.js';
import {mountLoadout} from '../../public/progression.js';

export async function mixedAvatar(Window) {
  const win = new Window({url:'http://localhost',settings:{disableCSSFileLoading:true}});
  const globals = ['window','document','localStorage'];
  const previous = globals.map(key => Object.getOwnPropertyDescriptor(globalThis,key));
  try {
    for (const key of globals) Object.defineProperty(globalThis,key,{configurable:true,value:key === 'window' ? win : win[key]});
    document.body.innerHTML = '<div id="loadout"></div><dialog id="entry"></dialog>';
    const profile = {id:'PEPE',nick:'Pepe',xp:0,best:{},characterCreated:true,revision:40,avatar:{...defaultAvatar}};
    let upgraded = false, competingSave = false;
    const posts = [];
    function view() {
      const projected = structuredClone(profile);
      if (!upgraded) { delete projected.avatar.hairStyle; delete projected.avatar.hairColor; }
      return {profile:projected};
    }
    const editor = mountLoadout({getSelf:()=>({nick:'Pepe'}),tell() {},async api(path,body) {
      if (path === 'progress/profile') return view();
      if (path === 'progress/ranking') return {players:[]};
      assert.equal(path,'progress/avatar');
      posts.push(body);
      if (competingSave) {
        competingSave = false;
        profile.revision++;
        profile.avatar.outfit=4;
        profile.avatar.hairStyle=1;
        profile.avatar.hairColor=6;
      }
      if (upgraded && body.expectedRevision !== undefined && body.expectedRevision !== profile.revision)
        throw Object.assign(Error('Revisión distinta'),{status:409});
      for (const key of Object.keys(defaultAvatar)) {
        if (upgraded || !['hairColor','hairStyle'].includes(key)) profile.avatar[key]=body[key];
      }
      profile.revision++;
      return view();
    }});
    const pending = () => JSON.parse(localStorage.getItem('squadlink.character.pending.PEPE'));
    const status = () => document.getElementById('kit-status').textContent;
    async function saveColor(label) {
      document.querySelector('#kit-options [aria-label="'+label+'"]').click();
      document.getElementById('kit-save').click();
      await delay(0);
    }
    await editor.refresh();
    await saveColor('Azul');
    assert.equal(posts.length,1);
    assert.equal(pending().avatar.hairColor,5);
    assert.deepEqual(pending().fields,['hairColor']);
    await editor.refresh();
    assert.equal(posts.length,1);
    assert.match(status(),/Pendiente de sincronizar/);
    upgraded=true;
    await editor.refresh();
    assert.equal(posts.length,2);
    assert.equal(posts[1].expectedRevision,41);
    assert.equal(profile.avatar.hairColor,5);
    assert.equal(pending(),null);

    upgraded=false;
    await saveColor('Rubio');
    upgraded=true;
    competingSave=true;
    await editor.refresh();
    assert.equal(posts.length,4);
    assert.equal(profile.avatar.hairColor,6);
    assert.equal(profile.avatar.outfit,4);
    assert.equal(pending().avatar.hairColor,3);
    assert.match(status(),/Revisa la apariencia/);
    assert.equal(document.getElementById('kit-save').disabled,false);
    profile.avatar.skin=5;
    profile.revision++;
    await editor.refresh();
    document.getElementById('kit-save').click();
    await delay(0);
    assert.equal(profile.avatar.hairColor,6);
    assert.match(status(),/Revisa la apariencia/);
    document.getElementById('kit-save').click();
    await delay(0);
    assert.equal(profile.avatar.skin,5);
    assert.equal(profile.avatar.hairColor,3);
    assert.equal(profile.avatar.hairStyle,1);
    assert.equal(posts[5].expectedRevision,profile.revision-1);
    assert.equal(profile.avatar.outfit,4);
    assert.equal(pending(),null);
  } finally {
    globals.forEach((key,index) => {
      if (previous[index]) Object.defineProperty(globalThis,key,previous[index]);
      else delete globalThis[key];
    });
    await win.happyDOM.abort();
  }
}
