import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readMemberVolumes, saveMemberVolume} from '../public/member-volumes.js';

test('remembers independent listening levels, including mute, and restores the default', t => {
  const a = '00000000-0000-0000-0000-000000000001', b = '00000000-0000-0000-0000-000000000002';
  const storage = new Map();
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {localStorage: {
    getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v)
  }}});
  t.after(() => { if (old) Object.defineProperty(globalThis, 'window', old); else delete globalThis.window; });
  saveMemberVolume(a, 0);
  saveMemberVolume(b, 63);
  assert.deepEqual([...readMemberVolumes()], [[a, 0], [b, 63]]);
  saveMemberVolume(a, 100);
  saveMemberVolume(b, -1);
  assert.deepEqual([...readMemberVolumes()], [[b, 63]]);
  storage.set('squadlink.member-volumes.v1', 'unreadable');
  assert.equal(readMemberVolumes().size, 0);
});
