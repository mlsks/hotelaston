/**
 * Convertit un document Markdown du dossier docs/ en page HTML autonome (styles compris), aux couleurs du bilan.
 * Sans dépendance : couvre ce que nos guides utilisent (titres, paragraphes, listes imbriquées, tableaux,
 * blocs de code, code, gras, italique, liens).
 *   node tools/md-to-html.mjs docs/guide-utilisateur.md            écrit docs/guide-utilisateur.html
 *   node tools/md-to-html.mjs docs/guide-utilisateur.md --check    échoue si le HTML n'est pas à jour
 * Le premier titre « # » devient l'en-tête de la page, le paragraphe qui le suit son sous-titre ;
 * les titres « ## » forment le sommaire.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Ancre d'un titre : minuscules sans accents, mots reliés par des tirets (comme GitHub, à la ponctuation près). */
export function slug(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (m, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => `<a href="${href}">${label}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, (m, pre, url) => `${pre}<a href="${url}">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[i])}</code>`);
}

const LIST = /^( *)([-*]|\d+\.) +/;
const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** Blocs d'une suite de lignes (appelé aussi sur le contenu de chaque élément de liste). */
function blocks(lines, ctx) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^ *```(\w*)/);
    if (fence) {
      const code = [];
      for (i++; i < lines.length && !/^ *```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,4}) +(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slug(text);
      if (level === 2) ctx.toc.push({ id, text });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (isTableRow(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && isTableRow(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(`<div class="table"><table>\n<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>\n<tbody>\n${
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('\n')}\n</tbody></table></div>`);
      continue;
    }

    const li = line.match(LIST);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const indent = li[1].length;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
        const inner = m[0].length;
        const body = [lines[i].slice(inner)];
        for (i++; i < lines.length; i++) {
          const l = lines[i];
          if (!l.trim()) {
            // Ligne vide : l'élément continue si la suivante est indentée sous lui
            const next = lines.slice(i + 1).find((x) => x.trim());
            if (next && next.search(/\S/) >= inner) { body.push(''); continue; }
            break;
          }
          if (l.search(/\S/) < inner) break;
          body.push(l.slice(inner));
        }
        items.push(body);
        // Lignes vides entre deux éléments de la même liste
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        const m2 = lines[j]?.match(LIST);
        if (j > i && m2 && m2[1].length === indent && /\d/.test(m2[2]) === ordered) i = j;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>\n${items.map((b) => {
        const parts = blocks(b, ctx);
        // Élément simple : pas de <p> autour du texte
        if (!b.includes('') && parts.length && parts[0].startsWith('<p>')) parts[0] = parts[0].slice(3, -4);
        return `<li>${parts.join('\n')}</li>`;
      }).join('\n')}\n</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^(#{1,4} |\s*```)/.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out;
}

export function convert(markdown, sourceName) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^# /.test(l));
  const title = lines[start].slice(2).trim();
  let i = start + 1;
  while (i < lines.length && !lines[i].trim()) i++;
  const sub = [];
  while (i < lines.length && lines[i].trim() && !/^#/.test(lines[i])) sub.push(lines[i++].trim());
  const ctx = { toc: [] };
  const body = blocks(lines.slice(i), ctx).join('\n');
  const [eyebrow, date] = sub.join(' ').split(' · ');
  return TEMPLATE
    .replaceAll('{{source}}', esc(sourceName))
    .replaceAll('{{title}}', esc(title))
    .replace('{{eyebrow}}', inline(date ? eyebrow : ''))
    .replace('{{date}}', inline(date || eyebrow || ''))
    .replace('{{toc}}', ctx.toc.map((t) => `<a href="#${t.id}">${inline(t.text)}</a>`).join('\n      '))
    .replace('{{body}}', () => body);
}

const TEMPLATE = `<!doctype html>
<!-- Généré par tools/md-to-html.mjs depuis {{source}} : modifier le Markdown, puis relancer la commande. -->
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{{title}} · Aston La Scala</title>
<style>
  :root {
    color-scheme: light;
    --bg: #fbf8f2; --paper: #ffffff; --ink: #1b2330; --ink-2: #47515f; --ink-3: #6b7482;
    --line: rgba(20, 56, 92, 0.14); --navy: #14385c; --navy-deep: #0b1f34; --brass: #a8834b; --gold: #c9a45e; --soft: #efe8db;
    --serif: "Cormorant Garamond", "Cormorant", Georgia, "Times New Roman", serif;
    --sans: "Jost", "Avenir Next", "Segoe UI", system-ui, -apple-system, sans-serif;
    --mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --bg: #0d1724; --paper: #142233; --ink: #e9edf2; --ink-2: #b9c3cf; --ink-3: #8d99a8;
      --line: rgba(201, 164, 94, 0.18); --navy: #8fb4d9; --navy-deep: #e9edf2; --soft: #1c2c40;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --bg: #0d1724; --paper: #142233; --ink: #e9edf2; --ink-2: #b9c3cf; --ink-3: #8d99a8;
    --line: rgba(201, 164, 94, 0.18); --navy: #8fb4d9; --navy-deep: #e9edf2; --soft: #1c2c40;
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
  .wrap { width: min(900px, 100%); margin: 0 auto; padding: 0 16px; }
  a { color: var(--navy); }
  code { font: 0.86em var(--mono); background: var(--soft); padding: 0.1em 0.35em; border-radius: 4px; overflow-wrap: anywhere; }
  h1, h2, h3, h4 { font-family: var(--serif); color: var(--navy-deep); line-height: 1.15; }
  h2 { font-size: clamp(1.7rem, 1.4rem + 1.2vw, 2.2rem); margin: 2.6rem 0 0.8rem; padding-top: 1.4rem; border-top: 1px solid var(--line); scroll-margin-top: 12px; }
  h3 { font-size: 1.4rem; margin: 1.8rem 0 0.5rem; scroll-margin-top: 12px; }
  h4 { font-size: 1.15rem; margin: 1.4rem 0 0.4rem; }
  p { margin: 0 0 0.8rem; }
  ul, ol { margin: 0 0 1rem; padding-left: 1.4em; }
  li { margin: 0.3rem 0; }
  li::marker { color: var(--brass); }
  li > ul, li > ol, li > pre { margin-top: 0.4rem; }
  strong { color: var(--navy-deep); }

  .hero { background: #0b1f34; color: #e9edf2; padding: 44px 0 36px; border-bottom: 3px solid var(--gold); }
  .eyebrow { margin: 0 0 6px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.24em; text-transform: uppercase; color: var(--gold); }
  .hero h1 { margin: 0; color: #fff; font-size: clamp(2.2rem, 1.7rem + 2.4vw, 3.4rem); }
  .hero .date { margin: 6px 0 0; color: #b9c3cf; }
  .toc { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
  .toc a { color: #e9edf2; text-decoration: none; font-size: 0.85rem; padding: 5px 11px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 999px; }
  .toc a:hover { border-color: var(--gold); color: var(--gold); }
  .theme { float: right; background: none; border: 1px solid rgba(255, 255, 255, 0.25); color: #e9edf2; border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 0.85rem; cursor: pointer; }

  main.wrap { padding-top: 28px; }
  .table { overflow-x: auto; margin: 0.4rem 0 1.2rem; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); }
  table { border-collapse: collapse; width: 100%; font-size: 0.94rem; }
  th, td { text-align: left; vertical-align: top; padding: 9px 12px; border-top: 1px solid var(--line); }
  thead th { border-top: 0; background: var(--soft); font-weight: 600; }
  pre { margin: 0.4rem 0 1rem; padding: 12px 14px; background: #0b1f34; color: #e9edf2; border-radius: 10px; overflow-x: auto; font: 0.88rem/1.5 var(--mono); }
  pre code { background: none; padding: 0; font-size: inherit; color: inherit; }
  footer { margin-top: 40px; padding: 22px 0 40px; border-top: 1px solid var(--line); color: var(--ink-3); font-size: 0.9rem; }

  @media (max-width: 560px) {
    .hero { padding: 30px 0 26px; }
    .theme { float: none; margin-bottom: 14px; }
  }
  @media print {
    body { background: #fff; color: #000; }
    .hero { background: #fff; color: #000; border-bottom: 2px solid #000; padding: 0 0 16px; }
    .hero h1 { color: #000; }
    .toc, .theme { display: none; }
    pre { background: #f3f3f3; color: #000; }
    h2, h3 { break-after: avoid; }
    .table, pre { break-inside: avoid; }
  }
</style>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <button class="theme" type="button" id="theme" aria-label="Changer de thème">Thème</button>
    <p class="eyebrow">{{eyebrow}}</p>
    <h1>{{title}}</h1>
    <p class="date">{{date}}</p>
    <nav class="toc" aria-label="Sommaire">
      {{toc}}
    </nav>
  </div>
</header>

<main class="wrap">
{{body}}
</main>

<footer class="wrap">Version HTML générée depuis <a href="{{source}}">{{source}}</a>.</footer>

<script>
  (() => {
    const root = document.documentElement;
    const key = 'aston.guide.theme';
    try { const t = localStorage.getItem(key); if (t) root.dataset.theme = t; } catch {}
    document.getElementById('theme').addEventListener('click', () => {
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem(key, root.dataset.theme); } catch {}
    });
  })();
</script>
</body>
</html>
`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('--'));
  if (!input) {
    console.log('Usage : node tools/md-to-html.mjs <fichier.md> [--check]');
    process.exit(1);
  }
  const output = input.replace(/\.md$/, '.html');
  const html = convert(fs.readFileSync(input, 'utf8'), path.basename(input));
  if (args.includes('--check')) {
    const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
    if (current !== html) {
      console.error(`${output} n'est pas à jour : lancer node tools/md-to-html.mjs ${input}`);
      process.exit(1);
    }
    console.log(`${output} est à jour.`);
  } else {
    fs.writeFileSync(output, html);
    console.log(`${output} écrit.`);
  }
}
