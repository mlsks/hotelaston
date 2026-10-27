import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, splitTranslatable, mergeTranslation } from '../server/ssg/collections.js';

const room = {
  name: 'Chambre Confort',
  sizeM2: 19,
  facts: ['19 m²', '1 grand lit'],
  amenities: ['clim', 'wifi'],
  gallery: [{ src: 'a.jpeg', w: 1980, h: 1105, kind: 'Lit', alt: 'Grand lit' }],
  reviewTopic: 'chambres',
};

test('la séparation range les champs traduisibles à part et garde les autres', () => {
  const { base, translated } = splitTranslatable(room, COLLECTIONS.rooms.translatable);
  assert.deepEqual(base, { sizeM2: 19, amenities: ['clim', 'wifi'], gallery: [{ src: 'a.jpeg', w: 1980, h: 1105 }], reviewTopic: 'chambres' });
  assert.deepEqual(translated, { name: 'Chambre Confort', facts: ['19 m²', '1 grand lit'], gallery: [{ kind: 'Lit', alt: 'Grand lit' }] });
});

test('la fusion reconstitue l\'élément d\'origine', () => {
  const { base, translated } = splitTranslatable(room, COLLECTIONS.rooms.translatable);
  const merged = mergeTranslation(base, translated);
  assert.deepEqual(merged, room);
});

test('une traduction remplace les textes sans toucher aux champs communs', () => {
  const { base } = splitTranslatable(room, COLLECTIONS.rooms.translatable);
  const en = { name: 'Comfort Room', facts: ['19 m²', '1 double bed'], gallery: [{ kind: 'Bed', alt: 'Double bed' }] };
  const merged = mergeTranslation(base, en);
  assert.equal(merged.name, 'Comfort Room');
  assert.equal(merged.gallery[0].src, 'a.jpeg');
  assert.equal(merged.gallery[0].alt, 'Double bed');
  assert.deepEqual(merged.amenities, ['clim', 'wifi']);
});
