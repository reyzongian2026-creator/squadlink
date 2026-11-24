const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {findUpdate,downloadUpdate,verifyDownloaded} = require('./update-release.cjs');

const windows = 'Squadlink-Moderno-Setup-x64.exe';
const mac = 'Squadlink-Moderno-macOS-arm64.zip';
const body = Buffer.from('contenido de prueba');
const sha256 = createHash('sha256').update(body).digest('hex');
const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/fixture?signature=test';

function release(version,name=windows) {
  const tag = 'moderno-v'+version;
  return {draft:false,tag_name:tag,assets:[{name,state:'uploaded',size:body.length,digest:'sha256:'+sha256,
    browser_download_url:'https://github.com/reyzongian2026-creator/squadlink/releases/download/'+tag+'/'+name}]};
}

function lookup(releases,opts={}) {
  return findUpdate({currentVersion:'0.5.0-preview.9',platform:'win32',arch:'x64',
    fetchImpl:async()=>Response.json(releases),...opts});
}

async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'squadlink-updater-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}

test('compara preview numérica y estable, selecciona por SO y evita regresiones',async()=>{
  const catalog = [release('0.5.0-preview.11'),release('0.5.0-preview.23',mac),release('0.5.0-preview.10'),
    {...release('0.6.0'),draft:true},{...release('1.0.0'),tag_name:'otra-v1.0.0'}];
  assert.equal((await lookup(catalog)).version,'0.5.0-preview.11');
  assert.equal((await lookup(catalog,{platform:'darwin',arch:'arm64'})).version,'0.5.0-preview.23');
  assert.equal((await lookup([...catalog,release('0.5.0')])).version,'0.5.0');
  assert.equal(await lookup(catalog,{currentVersion:'0.5.0'}),null);
  assert.equal(await lookup(catalog,{currentVersion:'0.5.0-preview.11'}),null);
  await assert.rejects(lookup(catalog,{platform:'darwin',arch:'x64'}),/compatible/);
});

test('consulta la siguiente página y solo considera paquetes publicados del repositorio fijo',async()=>{
  const urls = [];
  const found = await lookup([],{fetchImpl:async(url,options)=>{
    urls.push(url);
    assert.equal(options.redirect,'error');
    return Response.json(urls.length===1?Array(100).fill(release('0.4.1')):[release('0.6.1')]);
  }});
  assert.equal(found.version,'0.6.1');
  assert.deepEqual(urls,[1,2].map(p=>'https://api.github.com/repos/reyzongian2026-creator/squadlink/releases?per_page=100&page='+p));
  for (const patch of [{digest:''},{size:1e12},{browser_download_url:'https://github.com/otro/archivo'}]) {
    const bad=release('0.6.1');
    Object.assign(bad.assets[0],patch);
    await assert.rejects(lookup([release('0.5.1'),bad]),/verificable/);
  }
});

test('descarga mediante redirección de GitHub y vuelve a verificar el archivo guardado',async t=>{
  const dir=await temporary(t);
  const update=await lookup([release('0.5.0-preview.10')]);
  const urls=[];
  const progress=[];
  const saved=await downloadUpdate(update,{tempDir:dir,onProgress:value=>progress.push(value),fetchImpl:async(url,opts)=>{
    urls.push(url);
    assert.equal(opts.redirect,'manual');
    return url===update.url?Response.redirect(cdn):new Response(body);
  }});
  assert.deepEqual(urls,[update.url,cdn]);
  assert.equal(path.dirname(saved.filePath),saved.directory);
  assert.equal(path.dirname(saved.directory),dir);
  assert.deepEqual(await fs.readdir(saved.directory),[windows]);
  assert.deepEqual(await fs.readFile(saved.filePath),body);
  assert.deepEqual(progress.at(-1),{received:body.length,total:body.length});
  assert.equal(await verifyDownloaded(update,saved.filePath),true);
  await fs.writeFile(saved.filePath,Buffer.alloc(body.length));
  await assert.rejects(verifyDownloaded(update,saved.filePath),/cambiado/);
  if (process.platform!=='win32') {
    await fs.rename(saved.filePath,path.join(saved.directory,'other'));
    await fs.symlink('other',saved.filePath);
    await assert.rejects(verifyDownloaded(update,saved.filePath),/tipo/);
  }
});

test('descarta descargas parciales, mayores, con distinto hash, o sin permisos',async t=>{
  const dir=await temporary(t);
  const update=await lookup([release('0.6.0')]);
  const replies=[
    ()=>new Response(body.subarray(1)),
    ()=>new Response(Buffer.alloc(body.length+1)),
    ()=>new Response(Buffer.alloc(body.length)),
    ()=>new Response(body,{headers:{'content-length':'5'}}),
    ()=>new Response(null,{status:403}),
    ()=>new Response(new ReadableStream({start(controller){controller.error(new Error('corte'));}}))
  ];
  for (const fetchImpl of replies) {
    await assert.rejects(downloadUpdate(update,{tempDir:dir,fetchImpl}));
    assert.deepEqual(await fs.readdir(dir),[]);
  }
});

test('bloquea redirecciones fuera del origen aprobado antes de conectarse y admite cancelación',async t=>{
  const dir=await temporary(t);
  const update=await lookup([release('0.6.0')]);
  for (const location of ['http://release-assets.githubusercontent.com/a','https://release-assets.githubusercontent.com.example.org/a',
    'https://objects.githubusercontent.com:9000/a','https://user@objects.githubusercontent.com/a']) {
    const urls=[];
    await assert.rejects(downloadUpdate(update,{tempDir:dir,fetchImpl:async url=>{
      urls.push(url);
      return Response.redirect(location);
    }}),/destino/);
    assert.deepEqual(urls,[update.url]);
  }
  const abort = new AbortController();
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) {controller.enqueue(body.subarray(0,1));}
  }));
  await assert.rejects(downloadUpdate(update,{tempDir:dir,fetchImpl,signal:abort.signal,onProgress:()=>abort.abort()}));
  assert.deepEqual(await fs.readdir(dir),[]);
});
