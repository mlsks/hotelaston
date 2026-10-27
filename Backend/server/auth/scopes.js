/**
 * Périmètres : un éditeur peut être limité à une partie du site.
 * Sans périmètre, un éditeur voit et modifie tout le contenu.
 *
 * « live-music » : la page Live Music (textes, SEO), le programme des concerts (collection gigs),
 * les bandeaux du périmètre (dont « Soirées Live Music ») placés sur la page Live Music,
 * et les médias du dossier /live-music. Sa publication ne met en ligne que ce périmètre.
 */
export const SCOPES = {
  'live-music': {
    label: 'Live Music',
    pages: ['live-music'],
    collections: ['gigs'],
    mediaFolder: '/live-music',
  },
};

export const isScoped = (user) => Boolean(user?.scopes?.length);

/** Règles cumulées des périmètres d'un utilisateur. */
export function rulesOf(user) {
  const scopes = (user?.scopes || []).filter((s) => SCOPES[s]);
  return {
    scopes,
    label: scopes.map((s) => SCOPES[s].label).join(', '),
    pages: new Set(scopes.flatMap((s) => SCOPES[s].pages)),
    collections: new Set(scopes.flatMap((s) => SCOPES[s].collections)),
    mediaFolders: scopes.map((s) => SCOPES[s].mediaFolder),
  };
}

export const folderInScope = (rules, folder) => rules.mediaFolders.some((f) => folder === f || String(folder).startsWith(`${f}/`));
