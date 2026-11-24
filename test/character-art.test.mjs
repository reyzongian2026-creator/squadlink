import assert from 'node:assert/strict';
import test from 'node:test';
import {voxelAvatar, portraitAvatar} from '../public/character-art.js';
import {avatarOptions, defaultAvatar, evolutions} from '../public/character-model.js';

// Ignore the per-instance paint server IDs when comparing two appearances.
const appearance = markup => markup.replace(/sqa\d+-/g,'sqa-');
const images = markup => Array.from(markup.matchAll(/<image href="([^"]+)"/g), match=>match[1]);

test('las doce caras corresponden a modelos distintos y el busto usa solo sus texturas reducidas', () => {
  for (const species of avatarOptions.species.keys()) {
    for (const gender of avatarOptions.gender.keys()) {
      const choice = {species,gender};
      const path = suffix=>'/'+suffix+'-'+species+'-'+gender+'.webp';
      assert.deepEqual(images(voxelAvatar(choice)),['avatar','skin','coat'].map(path));
      assert.deepEqual(images(portraitAvatar(choice)),['face','face-skin','face-coat'].map(path));
    }
  }
});

test('cada opción personaliza la figura y todas las etapas tienen su aura', () => {
  for (const [field,values] of Object.entries(avatarOptions)) {
    const outputs = values.map((_,i)=>appearance(voxelAvatar({...defaultAvatar,[field]:i},30)));
    assert.equal(new Set(outputs).size,values.length,field);
  }
  const stages = evolutions.map(stage=>appearance(voxelAvatar(defaultAvatar,stage.level)));
  assert.equal(new Set(stages).size,stages.length);
  assert.equal(appearance(voxelAvatar({},31)),appearance(voxelAvatar({},30)));
});

test('las partidas antiguas y los índices inválidos conservan el personaje predeterminado', () => {
  for (const render of [voxelAvatar,portraitAvatar]) {
    assert.equal(appearance(render({},1)),appearance(render(defaultAvatar,1)));
    assert.equal(appearance(render({species:'<script>',skin:100,gender:-1},1)),appearance(render(defaultAvatar,1)));
  }
});

test('varios retratos en una lista no comparten referencias a filtros ni gradientes', () => {
  const figures = [voxelAvatar,portraitAvatar,portraitAvatar].map(render=>render({facialHair:1,headgear:3,build:2},50));
  const used = new Set();
  for (const svg of figures) {
    const own = new Set(Array.from(svg.matchAll(/ id="(sqa[^"]+)"/g),match=>match[1]));
    for (const id of own) { assert.ok(!used.has(id));used.add(id); }
    for (const [,target] of svg.matchAll(/url\(#(sqa[^)]+)\)/g)) assert.ok(own.has(target),target);
    assert.doesNotMatch(svg,/<(?:animate|script)|crispEdges/);
  }
});
