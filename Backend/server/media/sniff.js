/**
 * Reconnaît le type réel d'un fichier à ses premiers octets (jamais à son extension).
 * Le SVG est refusé : il peut contenir du script.
 */
const ascii = (buf, start, end) => buf.subarray(start, end).toString('latin1');

export function sniff(head) {
  if (head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE') return { kind: 'audio', mime: 'audio/wav', ext: 'wav' };
  if (ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (/^(avif|avis)$/.test(brand)) return { kind: 'image', mime: 'image/avif', ext: 'avif' };
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return { kind: 'image', mime: 'image/heic', ext: 'heic' };
    if (/^M4A/.test(brand)) return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' };
    if (/^qt/.test(brand)) return { kind: 'video', mime: 'video/quicktime', ext: 'mov' };
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { kind: 'video', mime: 'video/webm', ext: 'webm' };
  if (ascii(head, 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' };
  if (ascii(head, 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(head, 0, 4) === 'fLaC') return { kind: 'audio', mime: 'audio/flac', ext: 'flac' };
  return null;
}
