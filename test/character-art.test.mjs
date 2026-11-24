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

test('la calvicie usa la cabeza, piel y ropa restauradas y omite el tinte guardado', () => {
  for (const render of [voxelAvatar,portraitAvatar]) {
    const prefix = render === portraitAvatar ? 'face-' : '';
    for (const species of [0,1]) for (const gender of [0,1,2]) {
      const view = hairColor=>render({species,gender,hairStyle:1,hairColor});
      const suffix = '-'+species+'-'+gender+'.webp';
      assert.deepEqual(images(view(5)),['bald','bald-skin','bald-coat'].map(name=>'/'+prefix+name+suffix));
      assert.equal(appearance(view(5)),appearance(view(0)));
    }
  }
});

test('la gorra recoge el pelo por encima de la visera sin perder la trenza ni su color', () => {
  for (const render of [voxelAvatar,portraitAvatar]) {
    const prefix = render === portraitAvatar ? 'face-' : '';
    for (const species of [0,1]) for (const gender of [0,1,2]) {
      const look = {species,gender,headgear:2,hairColor:7};
      const suffix = '-'+species+'-'+gender+'.webp';
      const expected = name=>'/'+prefix+name+suffix;
      const withHair = render(look);
      assert.deepEqual(images(withHair),['bald','bald-skin','bald-coat','hair'].map(expected));
      assert.match(withHair,/<g clip-path="url\(#sqa\d+-underBrim\)"><image [^>]+filter="url\(#sqa\d+-hairColor\)"/);
      const shaved = render({...look,hairStyle:1});
      assert.doesNotMatch(shaved,/underBrim|hairColor/);
      const original = render({...look,headgear:0});
      assert.equal(images(original).at(-1),expected('hair'));
      assert.doesNotMatch(original,/underBrim|bald-/);
    }
  }
});

test('la preferencia de pelo de un perfil no añade cabello al alienígena o al robot', () => {
  for (const render of [voxelAvatar,portraitAvatar]) {
    for (const species of [2,3]) for (const gender of [0,1,2]) for (const headgear of [0,1,2,3]) {
      const look = {species,gender,headgear};
      assert.equal(appearance(render({...look,hairStyle:1,hairColor:6})),appearance(render(look)));
      assert.equal(appearance(render({...look,hairColor:6})),appearance(render(look)));
    }
  }
});

test('los accesorios de cuerpo completo usan el mismo encuadre facial que las miniaturas', () => {
  for (const species of [0,1,2,3]) for (const gender of [0,1,2]) for (const headgear of [1,2,3]) {
    const look = {species,gender,headgear,facialHair:2,hairColor:5};
    const body = appearance(voxelAvatar(look));
    const face = appearance(portraitAvatar(look));
    const bodyGear = body.match(/<g transform="translate\([\d. ]+\) scale\([\d.]+\) translate\(-64 -50\)">(.+)<\/g><\/svg>$/);
    const faceGear = face.match(/<g transform="">(.+)<\/g><\/svg>$/);
    assert.ok(bodyGear && faceGear,'debe existir el grupo de accesorios en las dos vistas');
    assert.equal(bodyGear[1],faceGear[1]);
  }
});
