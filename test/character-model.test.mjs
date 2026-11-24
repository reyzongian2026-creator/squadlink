import assert from 'node:assert/strict';
import test from 'node:test';
import {avatarOptions, defaultAvatar, evolutions, evolutionForLevel, normalizeAvatar, progressForXp} from '../public/character-model.js';

test('una fase se desbloquea en su umbral exacto y el aura azul comienza al nivel 30', () => {
  for (const [index, stage] of evolutions.entries()) {
    const threshold = (stage.level-1)*100;
    const active = progressForXp(threshold);
    assert.equal(active.level,stage.level);
    assert.equal(active.evolution,stage);
    if (index > 0) {
      const previous = progressForXp(threshold-1);
      assert.equal(previous.nextEvolution,stage);
      assert.equal(previous.evolution,evolutions[index-1]);
    }
  }
  assert.equal(evolutionForLevel(30).aura,'blue');
  assert.equal(progressForXp(0).level,1);
  assert.equal(progressForXp(20000).level,50);
});

test('los colores y la preferencia por cabello normalizan valores antiguos, nuevos e inválidos', () => {
  assert.deepEqual(avatarOptions.hairStyle,['Con cabello','Sin cabello']);
  assert.deepEqual(avatarOptions.hairColor,['Color original','Negro','Castaño','Rubio','Rojo','Azul','Violeta','Blanco']);
  for (const species of avatarOptions.species.keys()) for (const hairStyle of avatarOptions.hairStyle.keys()) {
    for (const hairColor of avatarOptions.hairColor.keys()) {
      assert.deepEqual(normalizeAvatar({species,hairStyle,hairColor}),{...defaultAvatar,species,hairStyle,hairColor});
    }
  }
  assert.deepEqual(normalizeAvatar({hairStyle:-1,hairColor:'5'}),defaultAvatar);
  assert.deepEqual(normalizeAvatar({species:1}),{...defaultAvatar,species:1});
});
