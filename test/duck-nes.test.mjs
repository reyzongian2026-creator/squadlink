import test from 'node:test';
import assert from 'node:assert/strict';
import {NES} from '../public/duck-nes-core.js';
import {readCartridge, zapperPoint} from '../public/duck-nes.js';
import {diagnosticCartridge} from './duck-nes-fixture.mjs';

test('acepta iNES y rechaza cabecera, tamaño o bancos declarados inválidos', () => {
  const valid = diagnosticCartridge();
  assert.equal(readCartridge(valid), valid);
  assert.throws(() => readCartridge(new Uint8Array(16)), /cabecera/);
  assert.throws(() => readCartridge(valid.subarray(0, 32)), /incompleto/);
  const missingTrainer = valid.slice(); missingTrainer[6] = 4;
  assert.throws(() => readCartridge(missingTrainer), /incompleto/);
  const large = valid.slice(); large[7] = 8; large[9] = 15; large[4] = 255;
  assert.throws(() => readCartridge(large), /incompleto/);
});

test('la puntería usa coordenadas nativas incluso con escalado y bordes', () => {
  const rect = {left: 10, top: 5, width: 512, height: 480};
  assert.deepEqual(zapperPoint({clientX: 266, clientY: 245}, rect), [128, 120]);
  assert.deepEqual(zapperPoint({clientX: 700, clientY: -20}, rect), [255, 0]);
});

test('el núcleo real reproduce vídeo y audio y el cartucho lee luz y gatillo del Zapper', () => {
  let frame, peak = -Infinity, minimum = Infinity, samples = 0;
  const nes = new NES({
    onFrame: pixels => { frame = pixels; },
    onAudioSample: left => { samples++; peak = Math.max(peak, left); minimum = Math.min(minimum, left); },
  });
  nes.loadROM(readCartridge(diagnosticCartridge()));
  nes.zapperMove(128, 120);
  for (let i = 0; i < 10; i++) nes.frame();
  assert.equal(frame.length, 256 * 240);
  assert.equal(frame[120 * 256 + 128], 0xffffff);
  assert.ok(samples > 7000 && peak - minimum > 0.01);
  assert.equal(nes.cpu.mem[0x10] & 0x18, 0, 'el cartucho detecta luz sin disparo');
  nes.zapperFireDown(); nes.frame();
  assert.equal(nes.cpu.mem[0x10] & 0x18, 0x10, 'el cartucho detecta un disparo');
  nes.zapperFireUp(); nes.frame();
  assert.equal(nes.cpu.mem[0x10] & 0x10, 0, 'el cartucho recibe la liberación del gatillo');
});
