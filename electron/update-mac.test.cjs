const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const run = require('node:util').promisify(execFile);
const {prepareMacUpdate} = require('./update-mac.cjs');
const payload = 'Contents/Resources/app';
const modulePath = require.resolve('./update-mac.cjs');

async function area(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'squadlink-update-test-')));
  t.after(async () => {
    // Any real desktop launched by this test uses only this private profile.
    const lock=await fs.readlink(path.join(dir,'perfil','SingletonLock')).catch(()=>null);
    const pid=Number(lock?.match(/-(\d+)$/)?.[1]);
    if (pid>1) {
      try { process.kill(pid,'SIGTERM'); } catch {}
      await waitUntil(async () => {
        try { process.kill(pid,0); return false; } catch { return true; }
      },8).catch(()=>{});
    }
    await fs.rm(dir,{recursive:true,force:true});
  });
  return dir;
}

async function createTestApp(root, version, program, helper) {
  const bundle = path.join(root,'Squadlink Moderno.app');
  const resources = path.join(bundle,payload);
  await fs.mkdir(resources,{recursive:true});
  await fs.mkdir(path.join(bundle,'Contents/MacOS'),{recursive:true});
  const [short,number] = version.split('-preview.');
  await fs.writeFile(path.join(bundle,'Contents/Info.plist'),
    '<?xml version="1.0"?><plist version="1.0"><dict>' +
    Object.entries({CFBundleIdentifier:'com.squadlink.moderno.preview',CFBundlePackageType:'APPL',
      CFBundleExecutable:'Electron',CFBundleShortVersionString:short,CFBundleVersion:number || '100'}).map(([key,value]) =>
      '<key>'+key+'</key><string>'+value+'</string>').join('') + '</dict></plist>');
  await fs.writeFile(path.join(resources,'package.json'),JSON.stringify({name:'squadlink-desktop',version}));
  await fs.copyFile(helper,path.join(resources,'update-mac-helper'));
  await fs.copyFile(program,path.join(bundle,'Contents/MacOS/Electron'));
  return bundle;
}

const sign = bundle => run('/usr/bin/codesign',['--force','--deep','--sign','-',bundle]);
const pack = (bundle,zip) => run('/usr/bin/ditto',['-c','-k','--keepParent',bundle,zip]);
const readVersion = async app => JSON.parse(await fs.readFile(path.join(app,payload,'package.json'))).version;
async function waitUntil(check, seconds=25) {
  const deadline = Date.now()+seconds*1000;
  do {
    if (await check()) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  } while (Date.now()<deadline);
  throw Error('La actualización no alcanzó el estado esperado.');
}

async function handoff(options) {
  // The updater waits for exactly this short-lived parent to exit before it swaps bundles.
  const script = 'require(process.argv[1]).prepareMacUpdate(JSON.parse(process.argv[2])).then(p=>p.launch()).catch(e=>{console.error(e);process.exitCode=1})';
  await run(process.execPath,['-e',script,modulePath,JSON.stringify(options)]);
}

test('macOS cancela, comprueba versiones, conserva cartuchos y revierte un arranque fallido',
  {skip:process.platform !== 'darwin'}, async t => {
    const dir = await area(t), helper = path.join(dir,'install-helper');
    await run('/usr/bin/clang',['-Wall','-Wextra','-Werror','-Os',path.join(__dirname,'update-mac-helper.c'),'-o',helper]);
    const fixture = path.join(dir,'driver.c'), good = path.join(dir,'driver'), bad = path.join(dir,'broken');
    await fs.writeFile(fixture,'#include <unistd.h>\nint main(void) {write(3,"READY\\n",6); sleep(1); return 0;}\n');
    await run('/usr/bin/clang',[fixture,'-o',good]);
    await fs.writeFile(fixture,'int main(void) {return 77;}\n');
    await run('/usr/bin/clang',[fixture,'-o',bad]);
    const installed = await createTestApp(path.join(dir,'installed'),'0.5.0-preview.19',good,helper);
    const carts = path.join(installed,payload,'cartridges');
    const rom = Buffer.alloc(16400); rom.set([78,69,83,26,1]);
    await fs.mkdir(carts); await fs.writeFile(path.join(carts,'mario3.nes'),rom);
    await sign(installed);
    const oldInode = (await fs.stat(installed)).ino;
    const expectedVersion = '0.5.0';
    const candidate = await createTestApp(path.join(dir,'new'),expectedVersion,bad,helper);
    await sign(candidate);
    const zipPath = path.join(dir,'release.zip');
    await pack(candidate,zipPath);
    const options = {zipPath,expectedVersion,appPath:installed,userDataPath:path.join(dir,'perfil')};
    await assert.rejects(prepareMacUpdate({...options,expectedVersion:'0.5.0-preview.20'}),/firma|versión/);
    const previous = await prepareMacUpdate(options);
    await previous.cancel();
    await assert.rejects(previous.launch(),/canceló/);
    assert.equal((await fs.stat(installed)).ino,oldInode);
    await handoff(options);
    const clean = async () => !(await fs.readdir(path.dirname(installed))).some(file=>file.startsWith('.squadlink-update-'));
    await waitUntil(clean);
    assert.equal((await fs.stat(installed)).ino,oldInode,'vuelve el bundle original al fallar el arranque');
    assert.deepEqual(await fs.readFile(path.join(carts,'mario3.nes')),rom);
    await fs.copyFile(good,path.join(candidate,'Contents/MacOS/Electron'));
    await sign(candidate); await fs.rm(zipPath); await pack(candidate,zipPath);
    await handoff(options);
    await waitUntil(clean);
    assert.equal(await readVersion(installed),expectedVersion);
    assert.deepEqual(await fs.readFile(path.join(carts,'mario3.nes')),rom);
    await run('/usr/bin/codesign',['--verify','--deep','--strict',installed]);
  });

test('el ZIP compilado arranca en su ruta original con el perfil y el cartucho anteriores',
  {skip:process.platform !== 'darwin' || !process.env.SQUADLINK_MAC_UPDATE_ZIP,timeout:180000}, async t => {
    const dir = await area(t), zipPath = path.resolve(process.env.SQUADLINK_MAC_UPDATE_ZIP);
    await run('/usr/bin/ditto',['-x','-k',zipPath,dir]);
    const originalName=path.join(dir,'Squadlink Moderno.app'), appPath=path.join(dir,'Mi Squadlink.app');
    await fs.rename(originalName,appPath);
    const expectedVersion=await readVersion(appPath), before='0.0.1-preview.1';
    const plist = path.join(appPath,'Contents/Info.plist'), json = path.join(appPath,payload,'package.json');
    await run('/usr/bin/plutil',['-replace','CFBundleShortVersionString','-string','0.0.1',plist]);
    await run('/usr/bin/plutil',['-replace','CFBundleVersion','-string','1',plist]);
    const meta=JSON.parse(await fs.readFile(json));meta.version=before;await fs.writeFile(json,JSON.stringify(meta));
    const {diagnosticCartridge} = await import('../test/duck-nes-fixture.mjs');
    const cart=path.join(appPath,payload,'cartridges','mario3.nes'), rom=Buffer.from(diagnosticCartridge());
    await fs.mkdir(path.dirname(cart));await fs.writeFile(cart,rom);await sign(appPath);
    const userDataPath=path.join(dir,'perfil');
    await fs.mkdir(userDataPath);
    const marker=path.join(userDataPath,'squad-test');await fs.writeFile(marker,'perfil anterior');
    await handoff({zipPath,expectedVersion,appPath,userDataPath});
    await waitUntil(async()=> !(await fs.readdir(dir)).some(file=>file.startsWith('.squadlink-update-')),120);
    assert.equal(await readVersion(appPath),expectedVersion,'el nuevo renderizador confirmó su arranque');
    assert.ok(await fs.readlink(path.join(userDataPath,'SingletonLock')));
    assert.equal(await fs.readFile(marker,'utf8'),'perfil anterior');
    assert.deepEqual(await fs.readFile(cart),rom);
    await run('/usr/bin/codesign',['--verify','--deep','--strict',appPath]);
  });
