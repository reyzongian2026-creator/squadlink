const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createUpdateCache} = require('./update-cache.cjs');

const bytes = Buffer.from('ejecutable de prueba');
const name = 'Squadlink-Moderno-Setup-x64.exe';
const version = '0.5.0-preview.21';
const tag = 'moderno-v'+version;
const release = {version,tag,platform:'win32',arch:'x64',name,size:bytes.length,
  sha256:createHash('sha256').update(bytes).digest('hex'),
  url:'https://github.com/reyzongian2026-creator/squadlink/releases/download/'+tag+'/'+name};

async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'squadlink-cache-test-'));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const root = path.join(base,'cache');
  const options = {currentVersion:'0.5.0-preview.20',platform:'win32',arch:'x64',
    seal:txt=>Buffer.from(txt),open:buffer=>buffer.toString()};
  const cache = values=>createUpdateCache(root,{...options,...values});
  await cache().restore();
  async function download(dir=root) {
    const directory=await fs.mkdtemp(path.join(dir,'squadlink-update-'));
    const filePath=path.join(directory,name);
    await fs.writeFile(filePath,bytes);
    return {directory,filePath};
  }
  return {base,root,cache,download};
}

test('restaura tras reiniciar, valida el SHA y limpia los parciales sin tocar archivos ajenos',async t=>{
  const {root,cache,download}=await setup(t);
  const local=await download();
  assert.equal(await cache().save(release,local),true);
  const partial=await fs.mkdtemp(path.join(root,'squadlink-update-'));
  await fs.writeFile(path.join(partial,'download.part'),'abc');
  await fs.writeFile(path.join(root,'otra-preferencia'),'guardar');
  assert.deepEqual(await cache().restore(),{release,local});
  await assert.rejects(fs.stat(partial),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(root,'otra-preferencia'),'utf8'),'guardar');
  await fs.writeFile(local.filePath,Buffer.alloc(bytes.length));
  assert.equal(await cache().restore(),null);
  assert.deepEqual(await fs.readdir(root),['otra-preferencia']);
});

test('rechaza el recibo modificado aunque apunte a otro archivo con igual tamaño y digest válido',async t=>{
  const {root,cache,download}=await setup(t);
  const local=await download();
  await cache().save(release,local);
  const file=path.join(root,'ready-v1.json');
  const receipt=JSON.parse(await fs.readFile(file,'utf8'));
  const changed=JSON.parse(receipt.data);
  changed.release.sha256=createHash('sha256').update(Buffer.alloc(bytes.length)).digest('hex');
  receipt.data=JSON.stringify(changed);
  await fs.writeFile(file,JSON.stringify(receipt));
  await fs.writeFile(local.filePath,Buffer.alloc(bytes.length));
  assert.equal(await cache().restore(),null);
  assert.deepEqual(await fs.readdir(root),[]);
});

test('descarta versiones ya instaladas, sistema incorrecto y claves inaccesibles',async t=>{
  const {root,cache,download}=await setup(t);
  for (const overrides of [{currentVersion:version},{platform:'darwin',arch:'arm64'},{open:()=>{throw Error('locked');}}]) {
    const local=await download();
    await cache().save(release,local);
    assert.equal(await cache(overrides).restore(),null);
    assert.deepEqual(await fs.readdir(root),[]);
  }
  const local=await download();
  assert.equal(await cache({seal:undefined}).save(release,local),false);
  assert.deepEqual(await fs.readFile(local.filePath),bytes);
  assert.equal(await cache({open:undefined}).restore(),null);
});

test('la sustitución del recibo es atómica si falla el guardado; forget conserva descargas no referenciadas',async t=>{
  const {cache,download}=await setup(t);
  const a=await download(), b=await download();
  await cache().save(release,a);
  await assert.rejects(cache({seal:()=>{throw Error('clave bloqueada');}}).save(release,b));
  await cache().forget();
  await assert.rejects(fs.stat(a.directory),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(b.filePath),bytes);
});

test('rechaza rutas externas y no sigue enlaces al restaurar o limpiar un instalador',async t=>{
  const {base,root,cache,download}=await setup(t);
  const external=await download(base);
  await assert.rejects(cache().save(release,external),/fuera/);
  const local=await download();
  await cache().save(release,local);
  await fs.rm(local.directory,{recursive:true});
  await fs.symlink(external.directory,local.directory,process.platform==='win32'?'junction':'dir');
  assert.equal(await cache().restore(),null);
  assert.deepEqual(await fs.readFile(external.filePath),bytes);
  await fs.rm(root,{recursive:true});
  await fs.symlink(external.directory,root,process.platform==='win32'?'junction':'dir');
  await assert.rejects(cache().restore(),/directorio privado/);
  assert.deepEqual(await fs.readFile(external.filePath),bytes);
});

test('serializa guardados y limpia un recibo parcial incluso si es un directorio',async t=>{
  const {root,cache,download}=await setup(t);
  const first=await download(),second=await download(), store=cache();
  await Promise.all([store.save(release,first),store.save(release,second)]);
  assert.deepEqual(await store.restore(),{release,local:second});
  await assert.rejects(fs.stat(first.filePath),{code:'ENOENT'});
  const receipt=path.join(root,'ready-v1.json');
  await fs.rm(receipt);
  await fs.mkdir(receipt);
  assert.equal(await cache().restore(),null);
  assert.deepEqual(await fs.readdir(root),[]);
});
