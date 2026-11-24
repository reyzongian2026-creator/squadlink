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

const published = {version:'0.5.0-preview.22', tag:'moderno-v0.5.0-preview.22', sha256:'a'.repeat(64),size:50};

test('reopens a verified download offline, preserves it in a call and does not download again',async t=>{
  const local={filePath:'/cached/asset',directory:'/cached'};
  let finds=0, restores=0;
  const cache={
    async restore(){restores++;return {release:published,local};},
    async save(){assert.fail('no new download');},
    async forget(){assert.fail('keep verified asset');}
  };
  const f=await fixture(t,{cache,find:async({hasDownload})=>{
    assert.equal(hasDownload,true);
    if(!finds++)throw Error('offline');
    return {...published};
  }});
  const c=f.controller;
  await c.check();
  assert.equal(c.snapshot().phase,'ready');
  assert.match(c.snapshot().message,/descarga verificada/);
  f.join(); await c.install();
  assert.equal(c.snapshot().phase,'ready');
  await c.check();
  assert.equal(c.snapshot().phase,'ready');
  assert.equal(c.snapshot().message,'');
  assert.deepEqual(f.calls,[]);
  f.leave(); await c.install();
  assert.deepEqual(f.calls,['verify','launch','quit']);
  assert.equal(restores,1);
});

for (const [scenario,fresh,phase] of [
  ['newer version',{...published,version:'0.5.0-preview.23'},'available'],
  ['replaced file in the same tag',{...published,sha256:'b'.repeat(64)},'available'],
  ['release no longer offered',null,'current'],
]) {
  test(scenario + ' revokes the prior copy before it can be installed',async t=>{
    const found=Promise.withResolvers(), consult=Promise.withResolvers();
    let checks=0,forgotten=0;
    const f=await fixture(t,{
      cache:{restore:async()=>({release:published,local:{filePath:'/cached/asset',directory:'/cached'}}),
        forget:async()=>{forgotten++;}},
      find:async()=>{if(!checks++)return published; consult.resolve();return found.promise;},
    });
    const c=f.controller;
    await c.check();
    assert.equal(c.snapshot().phase,'ready');
    const recheck=c.check();
    await consult.promise;
    const earlyInstall=c.install();
    found.resolve(fresh);
    await Promise.all([recheck,earlyInstall]);
    assert.equal(c.snapshot().phase,phase);
    assert.equal(c.snapshot().version,fresh?.version || '');
    if (scenario === 'newer version') assert.match(c.snapshot().message,/Ahora está disponible 0.5.0-preview.23/);
    if (scenario.includes('same tag')) assert.match(c.snapshot().message,/publicado cambió/);
    assert.equal(forgotten,1);
    await c.install();
    assert.deepEqual(f.calls,[]);
  });
}

test('save is reused on a later start, and an unavailable store still permits a session install',async t=>{
  let saved=null, writes=0, offline=false, checks=0;
  const cache={
    restore:async()=>saved, save:async(release,local)=>{saved={release,local};writes++;return true;},
    forget:async()=>{saved=null;}
  };
  const find=async()=>{checks++;if(offline)throw Error('network');return published;};
  const a=await fixture(t,{cache,find,download:async()=>({filePath:'/cached/asset',directory:'/cached'})});
  await a.controller.check();await a.controller.download();
  assert.equal(writes,1);
  offline=true;
  const b=await fixture(t,{cache,find});
  await b.controller.check();
  assert.equal(b.controller.snapshot().phase,'ready');
  assert.equal(checks,2);
  assert.deepEqual(b.calls,[]);

  const c=await fixture(t,{cache:{restore:async()=>{throw Error('unavailable');}, save:async()=>false}});
  await c.controller.check(); await c.controller.download();
  assert.match(c.controller.snapshot().message,/esta sesión/);
  await c.controller.install();
  assert.deepEqual(c.calls,['download','verify','launch','quit']);
});

test('cancel stops the active transfer, ignores late progress and allows one new download',async t=>{
  const started=Promise.withResolvers();
  let requests=0,signalFromFirst,lateProgress,saves=0;
  const f=await fixture(t,{
    cache:{restore:async()=>null,save:async()=>{saves++;return true;}},
    download:async(r,progress,signal)=>{
      if (++requests===1) {
        signalFromFirst=signal;
        lateProgress=progress;
        started.resolve();
        return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
      }
      return {directory:'/cached',filePath:'/cached/asset'};
    },
  });
  const c=f.controller;
  await c.check();
  const downloading=c.download();
  await started.promise;
  assert.equal(c.snapshot().phase,'downloading');
  await Promise.all([downloading,c.cancelDownload(),c.cancelDownload()]);
  assert.ok(signalFromFirst.aborted);
  lateProgress({received:50,total:100});
  assert.equal(c.snapshot().phase,'available');
  assert.match(c.snapshot().message,/cancelada/i);
  assert.equal(saves,0);
  await Promise.all([c.download(),c.download()]);
  assert.equal(requests,2);assert.equal(saves,1);
  assert.equal(c.snapshot().phase,'ready');
});

test('cancelling during persistence revokes a fully downloaded file',async t=>{
  const saving=Promise.withResolvers(),commit=Promise.withResolvers();
  let forgotten=0;
  const f=await fixture(t,{
    cache:{restore:async()=>null,save:async()=>{saving.resolve();await commit.promise;return true;}, forget:async()=>{forgotten++;}},
  });
  await f.controller.check();
  const download=f.controller.download();await saving.promise;
  const cancel=f.controller.cancelDownload();commit.resolve();
  await Promise.all([cancel,download]);
  assert.equal(forgotten,1);
  assert.equal(f.controller.snapshot().phase,'available');
  await f.controller.install();
  assert.deepEqual(f.calls,['download']);
});
