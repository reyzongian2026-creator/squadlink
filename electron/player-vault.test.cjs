const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp,rm,readFile,stat} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {createPlayerVault} = require('./player-vault.cjs');

test('persistencia nativa, actualizaciones concurrentes y protección de la identidad anterior',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'squadlink-mac-pase-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const file=join(folder,'pase.enc');
  let available=true;
  // Stand-in for the platform keychain; this test checks the vault protocol and storage, not macOS itself.
  const cipher={isEncryptionAvailable:()=>available,
    encryptString:text=>Buffer.from(text,'utf8').reverse(),decryptString:data=>Buffer.from(data).reverse().toString('utf8')};
  const make=()=>createPlayerVault(()=>file,cipher);
  const pass=(n,key='a')=>JSON.stringify({format:'squadlink-player-v1',deviceKey:key.repeat(64),nick:n,contacts:[],receipt:''});
  const vault=make();assert.equal(await vault.load(),null);
  await Promise.all([vault.save(pass('Pepe')),vault.save(pass('Segundo')),vault.save(pass('Tercero'))]);
  assert.equal(await make().load(),pass('Tercero'));
  assert.equal((await stat(file)).mode&0o777,0o600);
  assert.notEqual(await readFile(file,'utf8'),pass('Tercero'));
  await assert.rejects(vault.save(pass('Otra','b')),/otro jugador/);
  available=false;
  await assert.rejects(vault.save(pass('Cuarto')),/almacén seguro/);
  assert.equal(await vault.load(),pass('Tercero'));
});
