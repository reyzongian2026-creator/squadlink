import {avatarOptions, validAvatarOption} from './character-model.js';

const prefix = 'squadlink.character.draft.v1.';
const fields = Object.keys(avatarOptions);
const storageKey = (owner, field) => prefix + encodeURIComponent(owner) + '.' + field;

// Each field has its own key so two windows editing different features can both recover them.
export function createCharacterDraft() {
  let cachedOwner, changes;
  function read(owner) {
    if (!owner) return {};
    if (owner === cachedOwner) return changes;
    cachedOwner = owner;
    changes = {};
    try {
      for (const field of fields) {
        const text = localStorage.getItem(storageKey(owner, field));
        const value = Number(text);
        if (text !== null && String(value) === text && validAvatarOption(field, value)) changes[field] = value;
      }
    } catch {}
    return changes;
  }
  function remember(owner, field, value, baseline) {
    if (!owner || !validAvatarOption(field, value)) return;
    const current = read(owner);
    try {
      if (value === baseline) {
        localStorage.removeItem(storageKey(owner, field));
        delete current[field];
      } else {
        localStorage.setItem(storageKey(owner, field), String(value));
        current[field] = value;
      }
    } catch {}
  }
  function acknowledge(owner, saved) {
    if (!owner) return;
    const current = read(owner);
    try {
      for (const field of fields) {
        if (!Object.hasOwn(saved, field)) continue;
        const key = storageKey(owner, field);
        if (localStorage.getItem(key) === String(saved[field])) {
          localStorage.removeItem(key);
          delete current[field];
        }
      }
    } catch {}
  }
  return {
    read, remember, acknowledge,
    invalidate(owner, key) {
      if (owner && (key === null || key?.startsWith(prefix + encodeURIComponent(owner) + '.'))) {
        cachedOwner = undefined;
        return true;
      }
      return false;
    }
  };
}
