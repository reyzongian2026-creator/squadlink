import {normalizeAvatar} from '../public/character-model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPostgresStore } from '../postgres-store.mjs';
import { fixture } from './support/http.mjs';

const testDatabase = process.env.SQUADLINK_TEST_DATABASE_URL;
test('PostgreSQL real: concurrencia entre pools, rollback, ranking y perfil HTTP tras reiniciar', {
  skip: testDatabase ? false : 'Configura SQUADLINK_TEST_DATABASE_URL con una base de pruebas.',
  timeout: 40_000
}, async t => {
  const { Client } = await import('pg');
  const admin = new Client({connectionString:testDatabase});
  await admin.connect();
  const schema = 'squadlink_test_' + randomBytes(12).toString('hex');
  const stores = [];
  let schemaCreated = false;
  t.after(async () => {
    try {
      await Promise.all(stores.map(store=>store.close()));
      if (schemaCreated) await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    } finally { await admin.end(); }
  });
  await admin.query('CREATE SCHEMA ' + schema);
  schemaCreated = true;
  const url = new URL(testDatabase);
  url.searchParams.set('options', '-c search_path=' + schema);
  function pool() {
    const store = createPostgresStore(url.href);
    stores.push(store);
    return store;
  }
  const first = pool(), second = pool();
  const id = '1234567890ABCDEF';
  const initial = {id,nick:'Ada',xp:0,avatar:{skin:0,outfit:0,headgear:0},best:{reflex:350,sequence:2},revision:0,awards:[]};
  // The first writes race before the table or the profile exists.
  await Promise.all(Array.from({length:10}, (_, i)=>(i % 2 ? first : second).update(id, stored=>{
    const base = stored ?? initial;
    return {...base, xp:base.xp+1, revision:base.revision+1};
  })));
  await assert.rejects(first.update(id, row=>({...row,id:'wrong'})));
  const otherId = '0123456789ABCDEF';
  await second.update(otherId, ()=>({...initial,id:otherId,xp:50,best:{reflex:500,sequence:1}}));
  await first.close(); await second.close();
  const reopened = pool();
  assert.deepEqual((await reopened.ranking('xp')).map(p=>[p.id,p.xp]), [[otherId,50],[id,10]]);
  assert.deepEqual((await reopened.ranking('reflex')).map(p=>p.id), [id,otherId]);
  assert.deepEqual((await reopened.ranking('sequence')).map(p=>p.id), [id,otherId]);
  assert.deepEqual(await reopened.ranking('mario3world'), []);
  await reopened.update(id, row=>({...row,best:{...row.best,mario3world:3,flick:2400}}));
  await reopened.update(otherId, row=>({...row,best:{...row.best,mario3world:7,flick:3100}}));
  assert.deepEqual((await reopened.ranking('mario3world')).map(p=>p.id), [otherId,id]);
  assert.deepEqual((await reopened.ranking('flick')).map(p=>p.id), [id,otherId]);
  const deviceKey=randomBytes(32).toString('hex');
  async function reconnect() {
    const app = fixture(t,{progression:{env:{SQUADLINK_DATABASE_URL:url.href}}});
    const player = app.player();
    assert.equal((await player.hit('session',{nick:'Gian'})).status,200);
    assert.equal((await player.hit('social/connect',{deviceKey,contacts:[]})).status,200);
    return player;
  }
  const player = await reconnect();
  const avatar = {skin:1,outfit:2,headgear:3};
  const saved = await player.hit('progress/avatar', avatar);
  assert.equal(saved.status,200);
  assert.equal(saved.data.scope,'global');
  const restored = await (await reconnect()).hit('progress/profile',{});
  assert.equal(restored.status,200);
  assert.deepEqual(restored.data.profile.avatar, normalizeAvatar(avatar));
});
