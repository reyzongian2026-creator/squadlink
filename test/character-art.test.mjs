import assert from 'node:assert/strict';
import test from 'node:test';
import {voxelAvatar} from '../public/character-art.js';
import {avatarOptions} from '../public/character-model.js';

test('cada identidad tiene su propio rostro con las cuatro especies y accesorios', () => {
  for (const species of avatarOptions.species.keys()) {
    for (const headgear of avatarOptions.headgear.keys()) {
      for (const facialHair of avatarOptions.facialHair.keys()) {
        const portraits = avatarOptions.gender.map((_, gender) =>
          voxelAvatar({gender, species, headgear, facialHair, build:1}, 30));
        assert.equal(new Set(portraits).size, 3);
      }
    }
  }
});
