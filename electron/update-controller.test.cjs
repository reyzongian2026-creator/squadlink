const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, mkdir, access, rm} = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createUpdateController} = require('./update-controller.cjs');

async function fixture(t, overrides={}) {
  const root = await mkdtemp(path.join(os.tmpdir(),'squad-updater-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory = path.join(root,'download');
  const release = {version:'0.5.0-preview.21'};
  const calls = [];
  let joined = false;
  const controller = createUpdateController({
    find:async()=>release,
    download:async(r,progress)=>{
      calls.push('download');
      assert.equal(r,release);
      await mkdir(directory);
      progress({received:20,total:100});
      return {directory,filePath:path.join(directory,'asset')};
    },
    verify:async()=>calls.push('verify'),
    prepare:async()=>({launch:async()=>calls.push('launch')}),
    inRoom:()=>joined, quit:()=>calls.push('quit'), notify:()=>{}, ...overrides
  });
  return {controller,calls,directory,join:()=>{joined=true;},leave:()=>{joined=false;}};
}
test('check, download once, defer restart in a call and reverify on install',async t=>{
  const f=await fixture(t), c=f.controller;
  await c.check();
  assert.equal(c.snapshot().phase,'available');
  await Promise.all([c.download(),c.download()]);
  assert.equal(c.snapshot().phase,'ready');
  f.join(); await c.install();
  assert.deepEqual(f.calls,['download']);
  f.leave(); await Promise.all([c.install(),c.install()]);
  assert.deepEqual(f.calls,['download','verify','launch','quit']);
});
test('discard modified file and allow downloading again without launching',async t=>{
  const f=await fixture(t,{verify:async()=>{throw Error('digest');}}), c=f.controller;
  await c.check(); await c.download(); await c.install();
  assert.equal(c.snapshot().phase,'available');
  await assert.rejects(access(f.directory));
  await c.download();
  assert.deepEqual(f.calls,['download','download']);
});
test('joining during staging cancels the prepared installer',async t=>{
  const staging=Promise.withResolvers(), entered=Promise.withResolvers();
  let cancelled=false;
  const f=await fixture(t,{prepare:async()=>{entered.resolve();await staging.promise;return {cancel:async()=>{cancelled=true;},launch:()=>assert.fail('launch')};}}), c=f.controller;
  await c.check(); await c.download();
  const result=c.install(); await entered.promise; f.join(); staging.resolve(); await result;
  assert.equal(cancelled,true);
  assert.equal(c.snapshot().phase,'ready');
});
test('network failures can be retried; same version never offers to install',async t=>{
  let attempts=0;
  const f=await fixture(t,{find:async()=>{if(!attempts++)throw Error('offline');return null;}});
  await f.controller.check(); assert.equal(f.controller.snapshot().phase,'check-error');
  await f.controller.check(); assert.equal(f.controller.snapshot().phase,'current');
  await f.controller.install(); assert.deepEqual(f.calls,[]);
});
