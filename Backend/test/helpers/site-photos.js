/**
 * Base de test : les gabarits attendent les photos de la médiathèque (templates-src/photos.json).
 * Une même image générée remplace chaque photo du CDN, sans accès au réseau.
 */
import sharp from 'sharp';
import { importSitePhotos } from '../../server/media/site-photos.js';

export async function seedSitePhotos(db) {
  const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#4a7a9c' } }).jpeg().toBuffer();
  const fetchImpl = async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  return importSitePhotos(db, { convert: false, fetchImpl });
}
