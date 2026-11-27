import assert from 'node:assert/strict';
import test from 'node:test';
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
