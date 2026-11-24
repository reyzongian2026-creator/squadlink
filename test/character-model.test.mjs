import assert from 'node:assert/strict';
import test from 'node:test';
import {evolutions, evolutionForLevel, progressForXp} from '../public/character-model.js';

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
