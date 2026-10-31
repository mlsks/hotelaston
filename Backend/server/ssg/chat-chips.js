/**
 * Pastilles du chat ajoutées après l'import (31/10/2026) : Restaurant, Bars, Séminaire, Animaux.
 * Textes communs « global.chat-pastille-* », placés après la pastille Piscine ; français et
 * traductions livrés dans seeds/chat-pastilles.json. Chaque pastille pose la question d'une
 * réponse du chat existante (data-ask du gabarit : restaurant, moonbar, devis, animaux).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSeededTexts } from './legal-texts.js';

const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seeds', 'chat-pastilles.json');
const LABELS = {
  'global.chat-pastille-restaurant': 'Chat : pastille Restaurant',
  'global.chat-pastille-bars': 'Chat : pastille Bars',
  'global.chat-pastille-seminaire': 'Chat : pastille Séminaire (devis)',
  'global.chat-pastille-animaux': 'Chat : pastille Animaux',
};

export function ensureChatChips(db, { seed = readSeed() } = {}) {
  if (!db.prepare("SELECT 1 FROM cms_entries WHERE key = 'global.095-button'").get()) return 0; // site pas encore importé
  return ensureSeededTexts(db, { seed, section: null, labels: LABELS, near: 'global.095-button', type: 'text' });
}

function readSeed() {
  return fs.existsSync(SEED) ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : {};
}
