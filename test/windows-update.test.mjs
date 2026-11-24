import assert from 'node:assert/strict';
import test from 'node:test';
import updater from '../electron/update-windows.cjs';

const setup='C:\\Descargas del grupo\\actualización.exe', exe='D:\\Mis programas\\Squadlink.exe';
test('Windows recibe rutas completas como argumentos separados y espera solo su PID',()=>{
  const profile='D:\\Mi perfil & juegos';
  const {file,args}=updater.updateCommand(setup,{executablePath:exe,parentPid:712,userDataPath:profile});
  assert.equal(file,setup);
  assert.ok(args.includes('/DIR=D:\\Mis programas'));
  assert.ok(args.includes('/SQUADPROFILE='+profile));
  assert.ok(args.includes('/SQUADUPDATEPID=712'));
  assert.ok(args.includes('/NOCLOSEAPPLICATIONS') && args.includes('/NORESTART') && args.includes('/VERYSILENT'));
});

test('Windows rechaza instaladores, ejecutables, procesos y perfiles no válidos',()=>{
  const options={executablePath:exe,parentPid:712};
  for (const file of ['.\\test.exe','C:\\test.cmd','C:\\bad".exe']) assert.throws(()=>updater.updateCommand(file,options));
  for (const override of [{executablePath:'C:\\otro.exe'}, {parentPid:0},{parentPid:1.5},{parentPid:2**32},{userDataPath:'relativa'}]) {
    assert.throws(()=>updater.updateCommand(setup,{...options,...override}));
  }
  assert.ok(!updater.updateCommand(setup,options).args.some(a=>a.startsWith('/SQUADPROFILE')));
});
