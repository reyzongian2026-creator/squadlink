import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mouseScale, readMouseProfile} from '../public/practice-mouse.js';

test('el perfil de práctica conserva el DPI físico y recupera campos corruptos', t => {
  let value;
  t.mock.method(StorageStub.prototype,'getItem', () => value);
  const original = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:new StorageStub()});
  t.after(() => {
    if (original) Object.defineProperty(globalThis,'localStorage',original);
    else delete globalThis.localStorage;
  });
  for (value of [undefined,'{','null']) assert.equal(mouseScale(readMouseProfile()),1);
  value = JSON.stringify({dpi:800,targetDpi:1600,sensitivity:0.5});
  assert.equal(mouseScale(readMouseProfile()),1);
  value = JSON.stringify({dpi:-1,targetDpi:1600,sensitivity:'NaN'});
  assert.deepEqual(readMouseProfile(),{dpi:800,targetDpi:1600,sensitivity:1});
  assert.equal(mouseScale(readMouseProfile()),2);
});

class StorageStub { getItem() {} }

test('la política de DOOM permite ejecutar la configuración de sensibilidad empaquetada', () => {
  const page = readFileSync(new URL('../public/doom-player.html',import.meta.url),'utf8');
  const [,script] = page.match(/<script>([\s\S]*?)<\/script>/);
  const hash = createHash('sha256').update(script.replaceAll('\r\n','\n')).digest('base64');
  assert.ok(page.includes("'sha256-"+hash+"'"));
});
