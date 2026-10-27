/**
 * remotion-compositions.tsx — Hôtel Aston La Scala, Nice
 * ---------------------------------------------------------------------------
 * Boucles vidéo générées en amont et lues par le site en pur HTML via
 * <video autoplay loop muted playsinline> :
 *
 *   HeroRooftop          1920×1080 · 30 fps · 12 s  → media/hero-rooftop.{mp4,webm}
 *   HeroRooftopPortrait   720×1280 · 30 fps · 12 s  → media/hero-rooftop-portrait.{mp4,webm}
 *   MoonBarLive          1920×1080 · 30 fps ·  8 s  → media/moonbar-live.{mp4,webm}
 *
 * Le Hero du site lit désormais les prises de vue réelles, ralenties en boucle
 * aller-retour : media/video_hero_loop.mp4 (paysage) et
 * media/video_hero_mobile_loop.mp4 (portrait) ; HeroRooftop reste
 * disponible comme boucle de repli. MoonBarLive est toujours utilisée.
 *
 * Règles de fabrication
 *  - Tout est une fonction pure de useCurrentFrame() ; aucun Math.random(),
 *    seulement random(seed) de Remotion.
 *  - Chaque mouvement est périodique et sa période divise la durée de la
 *    boucle (wave(frame, loop, cycles) avec cycles entier) : la dernière frame
 *    s'enchaîne sur la première sans saut visible.
 *  - Scènes entièrement dessinées en SVG (aucune image d'archive) : rooftop et
 *    piscine au-dessus des toits du Vieux-Nice, colline du Château, baie des Anges.
 *  - MoonBarLive est cadencé sur une pulsation de 120 BPM (4 mesures = 8 s) :
 *    guirlandes, bokeh et onde dorée réagissent à une enveloppe de « kick »
 *    synthétique, comme le ferait un visualiseur audio, mais sans piste son
 *    (la vidéo est muette sur le site).
 *
 * Rendu : voir video/package.json (npm run render:all).
 */
import React, { useMemo } from "react";
import { AbsoluteFill, Composition, random, useCurrentFrame } from "remotion";

const TAU = Math.PI * 2;

export const HERO_LOOP = { fps: 30, durationInFrames: 360 } as const; // 12 s
export const MOON_BPM = 120;
export const MOON_LOOP = { fps: 30, durationInFrames: 240 } as const; // 8 s = 16 temps à 120 BPM

// ---------------------------------------------------------------------------
// Outils de boucle et de couleur
// ---------------------------------------------------------------------------

/** Sinus qui fait exactement `cycles` tours sur la boucle → raccord parfait. */
const wave = (frame: number, loop: number, cycles: number, phase = 0) =>
  Math.sin(TAU * ((cycles * frame) / loop + phase));

/** 0 → 1 → 0, même périodicité que wave(). */
const pulse = (frame: number, loop: number, cycles: number, phase = 0) =>
  0.5 + 0.5 * wave(frame, loop, cycles, phase);

const range = (seed: string, min: number, max: number) => min + random(seed) * (max - min);
const pick = <T,>(seed: string, list: readonly T[]): T => list[Math.floor(random(seed) * list.length) % list.length];

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: string, b: string, t: number) => {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

// ---------------------------------------------------------------------------
// Géographie commune : vue plein sud depuis le toit de l'hôtel
// (colline du Château et mont Boron à gauche, Vieux-Nice au centre,
// baie des Anges et cap d'Antibes à droite)
// ---------------------------------------------------------------------------

const W = 1920;
const H = 1080;

/** Profil de la colline du Château (gaussienne), en coordonnées de scène. */
const chateauY = (x: number, horizon: number) =>
  horizon + 170 - 215 * Math.exp(-(((x - 330) / 240) ** 2));
/** Mont Boron, plus loin et plus voilé, qui plonge dans la mer derrière le Château. */
const boronY = (x: number, horizon: number) =>
  horizon + 60 - 130 * Math.exp(-(((x + 60) / 330) ** 2));
const boronPath = (horizon: number) =>
  `M -60 ${horizon + 200} ${Array.from({ length: 29 }, (_, k) => {
    const x = -60 + k * 20;
    return `L ${x} ${boronY(x, horizon).toFixed(1)}`;
  }).join(" ")} L 500 ${horizon + 200} Z`;

/** Baie des Anges : le rivage s'éloigne vers l'horizon sur la droite de l'image. */
const SHORE_X0 = 1100;
const shoreY = (x: number, horizon: number, amp: number) =>
  horizon + amp * Math.max(0, (W + 20 - x) / (W + 20 - SHORE_X0)) ** 1.3;

type Building = {
  x: number;
  w: number;
  top: number;
  base: number;
  wall: string;
  roof: string;
  shutters: string;
  floors: number;
  cols: number;
  seed: string;
  /** Hauteur de mur ajoutée sous la base pour boucher les interstices entre rangées. */
  ext: number;
};

const WALLS = ["#d9a560", "#c8673f", "#e9c983", "#d99a86", "#efdcb8", "#e0b07a", "#cf8455", "#e6bf95"] as const;
const ROOFS = ["#b5562f", "#a94b2a", "#c0663c", "#9c4a2e"] as const;
const SHUTTERS = ["#5e7f5c", "#6f8f8a", "#4f6f63", "#8a9a7a", "#7b8f9c"] as const;

/**
 * Une rangée d'immeubles niçois (façades ocre, toits de tuiles, volets verts).
 * Avec `shore`, les immeubles à droite de SHORE_X0 suivent la courbe de la baie
 * et rapetissent en s'éloignant vers l'horizon.
 */
function buildRow(
  row: number,
  base: number,
  minH: number,
  maxH: number,
  minW: number,
  maxW: number,
  shore?: { horizon: number; amp: number; offset?: number; only?: boolean },
): Building[] {
  const out: Building[] = [];
  let x = shore?.only ? SHORE_X0 + 10 : -40;
  let i = 0;
  while (x < W + 40) {
    const s = `row${row}-${i}`;
    let w = Math.round(range(`${s}w`, minW, maxW));
    let h = Math.round(range(`${s}h`, minH, maxH));
    let b = base;
    let ext = 220;
    if (shore && x > SHORE_X0) {
      const sy = shoreY(x + w / 2, shore.horizon, shore.amp);
      b = Math.max(sy + 4, shore.horizon + 3) + (shore.offset ?? 0);
      const depth = Math.min(1, Math.max(0.08, (b - shore.horizon) / shore.amp));
      h = Math.max(3, Math.round(h * depth));
      w = Math.max(8, Math.round(w * (0.3 + 0.7 * depth)));
      ext = 3;
    }
    out.push({
      x,
      w,
      top: b - h,
      base: b,
      wall: pick(`${s}c`, WALLS),
      roof: pick(`${s}r`, ROOFS),
      shutters: pick(`${s}s`, SHUTTERS),
      floors: Math.max(2, Math.round(h / 24)),
      cols: Math.max(1, Math.floor(w / 19)),
      seed: s,
      ext,
    });
    x += w - Math.round(range(`${s}o`, 0, 5));
    i++;
  }
  return out;
}

type RowStyle = {
  haze: number; // 0 = net, 1 = fondu dans la brume
  hazeColor: string;
  night: boolean;
  windows: boolean;
};

/** Dessine une rangée ; la nuit, les fenêtres s'allument (quelques-unes vacillent). */
const Row: React.FC<{ buildings: Building[]; style: RowStyle; frame: number; loop: number }> = ({
  buildings,
  style,
  frame,
  loop,
}) => {
  const { haze, hazeColor, night, windows } = style;
  return (
    <g>
      {buildings.map((b) => {
        const wall = night ? mix("#141d30", hazeColor, haze) : mix(b.wall, hazeColor, haze);
        const roof = night ? mix("#0d1422", hazeColor, haze) : mix(b.roof, hazeColor, haze * 0.9);
        const pitch = Math.max(4, b.w * 0.11);
        const winW = Math.min(7, (b.w / b.cols) * 0.36);
        const winH = Math.min(12, ((b.base - b.top) / b.floors) * 0.5);
        const cells: React.ReactNode[] = [];
        if (windows) {
          for (let f = 0; f < b.floors; f++) {
            for (let c = 0; c < b.cols; c++) {
              const cx = b.x + ((c + 0.5) * b.w) / b.cols;
              const cy = b.top + 10 + ((f + 0.35) * (b.base - b.top - 10)) / b.floors;
              const k = `${b.seed}-${f}-${c}`;
              if (night) {
                const lit = random(`${k}lit`) < 0.38;
                if (!lit) continue;
                const flicker = random(`${k}fl`) < 0.12 ? 0.55 + 0.45 * pulse(frame, loop, 1 + Math.floor(random(`${k}fc`) * 3), random(`${k}fp`)) : 1;
                cells.push(
                  <rect
                    key={k}
                    x={cx - winW / 2}
                    y={cy - winH / 2}
                    width={winW}
                    height={winH}
                    fill={random(`${k}tone`) < 0.7 ? "#ffcf87" : "#ffe9c2"}
                    opacity={(0.85 - haze * 0.5) * flicker}
                  />,
                );
              } else {
                const open = random(`${k}open`) < 0.55;
                cells.push(
                  <g key={k} opacity={1 - haze * 0.85}>
                    <rect x={cx - winW / 2} y={cy - winH / 2} width={winW} height={winH} fill="#3d3532" opacity={0.75} />
                    {open ? (
                      <>
                        <rect x={cx - winW / 2 - winW * 0.55} y={cy - winH / 2} width={winW * 0.5} height={winH} fill={b.shutters} />
                        <rect x={cx + winW / 2 + winW * 0.05} y={cy - winH / 2} width={winW * 0.5} height={winH} fill={b.shutters} />
                      </>
                    ) : (
                      <rect x={cx - winW / 2} y={cy - winH / 2} width={winW} height={winH} fill={b.shutters} />
                    )}
                  </g>,
                );
              }
            }
          }
        }
        return (
          <g key={b.seed}>
            {/* Le mur descend bien sous la ligne de base : aucune mer ne transparaît entre deux rangées */}
            <rect x={b.x} y={b.top} width={b.w} height={b.base - b.top + b.ext} fill={wall} />
            {!night && (
              // Lumière rasante de fin d'après-midi venant de l'ouest (à droite)
              <rect x={b.x + b.w * 0.72} y={b.top} width={b.w * 0.28} height={b.base - b.top} fill="#fff3dc" opacity={0.14 * (1 - haze)} />
            )}
            <polygon
              points={`${b.x - 3},${b.top} ${b.x + b.w / 2},${b.top - pitch} ${b.x + b.w + 3},${b.top}`}
              fill={roof}
            />
            {cells}
          </g>
        );
      })}
    </g>
  );
};

/** Ville qui s'étage le long de la baie : fond de toits + trois rangées qui rapetissent vers l'horizon. */
const Bay: React.FC<{ horizon: number; amp: number; seed: number; night: boolean; hazeColor: string; frame: number; loop: number }> = ({
  horizon,
  amp,
  seed,
  night,
  hazeColor,
  frame,
  loop,
}) => {
  const rows = useMemo(
    () =>
      [8, 28, 56, 92, 136].map((offset, i) =>
        buildRow(seed + i, 0, 22 + i * 4, 48 + i * 6, 26 + i * 3, 56 + i * 5, { horizon, amp, offset, only: true }),
      ),
    [horizon, amp, seed],
  );
  const land: string[] = [];
  for (let x = SHORE_X0; x <= W + 20; x += 20) land.push(`${x},${(shoreY(x, horizon, amp) + 3).toFixed(1)}`);
  return (
    <g>
      <polygon points={`${SHORE_X0},${horizon + amp + 200} ${land.join(" ")} ${W + 20},${horizon + amp + 200}`} fill={night ? "#121a2e" : mix("#d9b48c", hazeColor, 0.45)} />
      {rows.map((r, i) => (
        <Row key={i} buildings={r} style={{ haze: 0.55 - i * 0.1, hazeColor, night, windows: night || i >= 3 }} frame={frame} loop={loop} />
      ))}
    </g>
  );
};

/** Clochers et dôme de tuiles vernissées de la cathédrale Sainte-Réparate. */
const Landmarks: React.FC<{ night: boolean; haze: string }> = ({ night, haze }) => {
  const stone = night ? "#121a2b" : mix("#e7c890", haze, 0.18);
  const shade = night ? "#0c1220" : mix("#c9a26a", haze, 0.18);
  const roof = night ? "#0c1220" : mix("#a94b2a", haze, 0.15);
  return (
    <g>
      {/* Tour Saint-François */}
      <rect x={705} y={548} width={34} height={120} fill={stone} />
      <rect x={729} y={548} width={10} height={120} fill={shade} opacity={0.5} />
      <polygon points="701,548 722,516 743,548" fill={roof} />
      {/* Dôme de Sainte-Réparate */}
      <rect x={968} y={590} width={84} height={70} fill={stone} />
      <rect x={978} y={566} width={64} height={28} fill={stone} />
      <path d="M 976 568 Q 1010 486 1044 568 Z" fill={night ? "#101a2a" : "url(#tiles)"} />
      <rect x={1004} y={500} width={12} height={16} fill={stone} />
      <path d="M 1002 502 Q 1010 486 1018 502 Z" fill={night ? "#101a2a" : "#4f8a6b"} />
      {/* Clocher */}
      <rect x={1078} y={540} width={28} height={130} fill={stone} />
      <rect x={1084} y={556} width={16} height={22} fill={night ? "#ffcf87" : "#3d3532"} opacity={night ? 0.55 : 0.7} />
      <path d="M 1074 542 Q 1092 500 1110 542 Z" fill={night ? "#101a2a" : "url(#tiles)"} />
    </g>
  );
};

/** Colline du Château : relief boisé, pins parasols, tour Bellanda. */
const ChateauHill: React.FC<{ horizon: number; night: boolean; frame: number; loop: number }> = ({
  horizon,
  night,
  frame,
  loop,
}) => {
  const pts: string[] = [];
  for (let x = -20; x <= 780; x += 10) pts.push(`${x},${chateauY(x, horizon).toFixed(1)}`);
  const base = horizon + 260;
  const trees = useMemo(() => {
    const t: { x: number; y: number; r: number; tone: number }[] = [];
    for (let i = 0; i < 150; i++) {
      const x = range(`tree${i}x`, -10, 760);
      const ridge = chateauY(x, horizon);
      const y = ridge + range(`tree${i}y`, 4, 120);
      t.push({ x, y, r: range(`tree${i}r`, 9, 21), tone: random(`tree${i}t`) });
    }
    return t.sort((a, b) => a.y - b.y);
  }, [horizon]);
  return (
    <g>
      <polygon points={`-20,${base} ${pts.join(" ")} 780,${base}`} fill={night ? "#0b1220" : "#5c7a52"} />
      {trees.map((t, i) => (
        <ellipse
          key={i}
          cx={t.x}
          cy={t.y}
          rx={t.r * 1.25}
          ry={t.r * 0.8}
          fill={night ? mix("#0a111d", "#13203a", t.tone) : mix("#3f5c3a", "#7f9a5a", t.tone)}
        />
      ))}
      {/* Tour Bellanda */}
      <rect x={672} y={chateauY(690, horizon) - 34} width={40} height={60} rx={4} fill={night ? "#121b2d" : "#ecd9b4"} />
      <rect x={672} y={chateauY(690, horizon) - 40} width={40} height={8} fill={night ? "#0e1626" : "#d7bf93"} />
      {night &&
        // Lampadaires des allées du Château
        Array.from({ length: 18 }, (_, i) => {
          const x = 120 + i * 32;
          const y = chateauY(x, horizon) + 30 + (i % 3) * 22;
          return <circle key={i} cx={x} cy={y} r={2.2} fill="#ffd79a" opacity={0.6 + 0.4 * pulse(frame, loop, 2, i / 7)} />;
        })}
    </g>
  );
};

/** Palmier (Phoenix) dont les palmes oscillent doucement, en boucle. */
const Palm: React.FC<{
  x: number;
  y: number;
  height: number;
  lean: number;
  fronds: number;
  frond: number;
  frame: number;
  loop: number;
  seed: string;
  color: string;
  rim: string;
  trunk: string;
}> = ({ x, y, height, lean, fronds, frond, frame, loop, seed, color, rim, trunk }) => {
  const cx = x + lean;
  const cy = y - height;
  const paths: React.ReactNode[] = [];
  for (let i = 0; i < fronds; i++) {
    const base = -Math.PI / 2 + ((i / (fronds - 1)) * 2 - 1) * 1.65;
    const sway = 0.045 * wave(frame, loop, 1, random(`${seed}${i}p`)) + 0.02 * wave(frame, loop, 3, random(`${seed}${i}q`));
    const a = base + sway;
    const L = frond * range(`${seed}${i}l`, 0.8, 1.1);
    const droop = L * 0.38 * Math.abs(Math.cos(a)) + L * 0.1;
    const p2 = { x: cx + Math.cos(a) * L, y: cy + Math.sin(a) * L * 0.75 + droop };
    const p1 = { x: cx + Math.cos(a) * L * 0.55, y: cy + Math.sin(a) * L * 0.55 - L * 0.12 };
    let d = `M ${cx} ${cy} Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`;
    for (let k = 2; k <= 22; k++) {
      const t = k / 23;
      const bx = (1 - t) ** 2 * cx + 2 * (1 - t) * t * p1.x + t * t * p2.x;
      const by = (1 - t) ** 2 * cy + 2 * (1 - t) * t * p1.y + t * t * p2.y;
      const tx = 2 * (1 - t) * (p1.x - cx) + 2 * t * (p2.x - p1.x);
      const ty = 2 * (1 - t) * (p1.y - cy) + 2 * t * (p2.y - p1.y);
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len;
      const ny = tx / len;
      const leaf = L * 0.3 * Math.sin(Math.PI * t) ** 0.6;
      for (const side of [-1, 1]) {
        const ex = bx + (nx * side * 0.8 + (tx / len) * 0.55) * leaf;
        const ey = by + (ny * side * 0.8 + (ty / len) * 0.55) * leaf + leaf * 0.45;
        d += ` M ${bx.toFixed(1)} ${by.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      }
    }
    paths.push(
      <g key={i}>
        <path d={d} stroke={color} strokeWidth={3.2} fill="none" strokeLinecap="round" />
        <path d={d} stroke={rim} strokeWidth={1} fill="none" opacity={0.45} transform="translate(1.5,-1.5)" />
      </g>,
    );
  }
  return (
    <g>
      <path
        d={`M ${x - 9} ${y} Q ${x + lean * 0.3 - 6} ${y - height * 0.55} ${cx - 5} ${cy} L ${cx + 5} ${cy} Q ${x + lean * 0.3 + 8} ${y - height * 0.55} ${x + 11} ${y} Z`}
        fill={trunk}
      />
      {Array.from({ length: Math.floor(height / 16) }, (_, k) => {
        const t = k / Math.floor(height / 16);
        const ty = y - height * t;
        const tx = x + lean * t * t + 1;
        return <line key={k} x1={tx - 8} y1={ty} x2={tx + 9} y2={ty - 3} stroke="#000" strokeWidth={1.4} opacity={0.18} />;
      })}
      {paths}
    </g>
  );
};

// ---------------------------------------------------------------------------
// HERO — Piscine du rooftop, fin d'après-midi
// ---------------------------------------------------------------------------

type HeroProps = { crop: "landscape" | "portrait" };

const HERO_HORIZON = 430;
const SUN = { x: 1380, y: 296 };

export const HeroRooftop: React.FC<HeroProps> = ({ crop }) => {
  const frame = useCurrentFrame();
  const loop = HERO_LOOP.durationInFrames;

  const rows = useMemo(
    () => ({
      far: buildRow(0, 606, 26, 62, 34, 70, { horizon: HERO_HORIZON, amp: 230 }),
      mid: buildRow(1, 700, 54, 112, 44, 96),
      near: buildRow(2, 820, 92, 170, 60, 130),
    }),
    [],
  );

  const shore = useMemo(() => {
    const pts: string[] = [];
    for (let x = SHORE_X0; x <= W + 20; x += 20) pts.push(`${x},${shoreY(x, HERO_HORIZON, 230).toFixed(1)}`);
    return pts.join(" ");
  }, []);

  const glints = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        x: SUN.x + range(`g${i}x`, -260, 260) * (0.4 + random(`g${i}s`)),
        y: range(`g${i}y`, HERO_HORIZON + 6, HERO_HORIZON + 120),
        w: range(`g${i}w`, 6, 22),
        cycles: 1 + Math.floor(random(`g${i}c`) * 6),
        phase: random(`g${i}p`),
      })),
    [],
  );

  const poolSparkles = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => ({
        x: range(`ps${i}x`, 980, 1420),
        y: range(`ps${i}y`, 896, 960),
        r: range(`ps${i}r`, 1.2, 3.4),
        cycles: 2 + Math.floor(random(`ps${i}c`) * 8),
        phase: random(`ps${i}p`),
      })),
    [],
  );

  // Respiration de caméra (Ken Burns bouclé) : base temporelle continue
  const scale = 1.055 + 0.018 * wave(frame, loop, 1);
  const camX = 14 * wave(frame, loop, 1, 0.25);
  const camY = 6 * wave(frame, loop, 1, 0.5);

  // Caustiques : deux nappes de bruit qui tournent en sens opposé
  const c1x = 46 * Math.cos((TAU * frame) / loop);
  const c1y = 18 * Math.sin((TAU * frame) / loop);
  const c2x = -38 * Math.cos((TAU * 2 * frame) / loop + 1);
  const c2y = 14 * Math.sin((TAU * 2 * frame) / loop + 1);

  const viewBox = crop === "portrait" ? `${SUN.x - 420} 0 608 ${H}` : `0 0 ${W} ${H}`;
  const pool = "260,1080 1660,1080 1470,896 450,896";

  return (
    <AbsoluteFill style={{ backgroundColor: "#f4dcb8" }}>
      <svg viewBox={viewBox} width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4f88bd" />
            <stop offset="0.45" stopColor="#9cc5df" />
            <stop offset="0.82" stopColor="#f2d7b2" />
            <stop offset="1" stopColor="#ffe3bd" />
          </linearGradient>
          <radialGradient id="sunGlow">
            <stop offset="0" stopColor="#fff6dc" stopOpacity="1" />
            <stop offset="0.12" stopColor="#ffe9b8" stopOpacity="0.85" />
            <stop offset="0.45" stopColor="#ffd59a" stopOpacity="0.25" />
            <stop offset="1" stopColor="#ffd59a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5c97bf" />
            <stop offset="1" stopColor="#2c6f9e" />
          </linearGradient>
          <linearGradient id="sunPath" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff2d1" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff2d1" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff2d1" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fdbe4" />
            <stop offset="0.18" stopColor="#47bfd2" />
            <stop offset="1" stopColor="#1690b0" />
          </linearGradient>
          <linearGradient id="deck" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#efe5d3" />
            <stop offset="1" stopColor="#dccbb0" />
          </linearGradient>
          <linearGradient id="warmGrade" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffb867" stopOpacity="0.16" />
            <stop offset="0.6" stopColor="#ffb867" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.75">
            <stop offset="0.6" stopColor="#1b2633" stopOpacity="0" />
            <stop offset="1" stopColor="#1b2633" stopOpacity="0.35" />
          </radialGradient>
          <pattern id="tiles" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="#3f8a63" />
            <rect width="5" height="5" fill="#e3b341" />
            <rect x="5" y="5" width="5" height="5" fill="#c4643f" />
          </pattern>
          <clipPath id="poolClip">
            <polygon points={pool} />
          </clipPath>
          <filter id="caustics" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="turbulence" baseFrequency="0.011 0.046" numOctaves="2" seed="11" />
            <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -7 0 0 0 1.75" />
            <feGaussianBlur stdDeviation="0.7" />
          </filter>
          <filter id="cloudBlur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
          <filter id="softBlur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>

        <g transform={`translate(${W / 2 + camX} ${H / 2 + camY}) scale(${scale}) translate(${-W / 2} ${-H / 2})`}>
          {/* Ciel, soleil, nuages */}
          <rect x={-60} y={-60} width={W + 120} height={HERO_HORIZON + 60} fill="url(#sky)" />
          <circle cx={SUN.x} cy={SUN.y} r={430} fill="url(#sunGlow)" opacity={0.9 + 0.06 * wave(frame, loop, 1)} />
          <circle cx={SUN.x} cy={SUN.y} r={44} fill="#fff8e6" />
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const y = 90 + i * 46 + range(`cl${i}y`, -20, 20);
            const x = range(`cl${i}x`, 0, W) + 36 * wave(frame, loop, 1, random(`cl${i}p`));
            return (
              <ellipse
                key={i}
                cx={x}
                cy={y}
                rx={range(`cl${i}w`, 160, 320)}
                ry={range(`cl${i}h`, 14, 30)}
                fill="#ffffff"
                opacity={0.45}
                filter="url(#cloudBlur)"
              />
            );
          })}
          {/* Rayons */}
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (-0.6 + i * 0.32) + 0.02 * wave(frame, loop, 1, i / 5);
            const len = 1500;
            const spread = 0.035;
            return (
              <polygon
                key={i}
                points={`${SUN.x},${SUN.y} ${SUN.x + Math.cos(Math.PI / 2 + a - spread) * len},${SUN.y + Math.sin(Math.PI / 2 + a - spread) * len} ${SUN.x + Math.cos(Math.PI / 2 + a + spread) * len},${SUN.y + Math.sin(Math.PI / 2 + a + spread) * len}`}
                fill="#fff3d6"
                opacity={0.05 + 0.035 * pulse(frame, loop, 1, i / 5)}
              />
            );
          })}

          {/* Mer : horizon, chemin de soleil, scintillements */}
          <rect x={-60} y={HERO_HORIZON} width={W + 120} height={260} fill="url(#sea)" />
          <polygon
            points={`${SUN.x - 30},${HERO_HORIZON} ${SUN.x + 30},${HERO_HORIZON} ${SUN.x + 260},${HERO_HORIZON + 160} ${SUN.x - 260},${HERO_HORIZON + 160}`}
            fill="url(#sunPath)"
            opacity={0.8}
          />
          {glints.map((g, i) => (
            <rect
              key={i}
              x={g.x}
              y={g.y}
              width={g.w}
              height={1.6}
              rx={0.8}
              fill="#fffaf0"
              opacity={pulse(frame, loop, g.cycles, g.phase) ** 4}
            />
          ))}
          {/* Cap d'Antibes au loin */}
          <path d={`M 1480 ${HERO_HORIZON + 1} Q 1700 ${HERO_HORIZON - 9} 1990 ${HERO_HORIZON - 4} L 1990 ${HERO_HORIZON + 2} Z`} fill="#a7bccb" />
          {/* Galets et promenade des Anglais le long de la baie */}
          <polyline points={shore} fill="none" stroke="#efe2c8" strokeWidth={7} opacity={0.9} />
          <polyline points={shore} fill="none" stroke="#ffffff" strokeWidth={2} opacity={0.7} transform="translate(0 4)" />

          {/* Mont Boron puis colline du Château */}
          <path d={boronPath(HERO_HORIZON)} fill="#93aebb" />
          <ChateauHill horizon={HERO_HORIZON} night={false} frame={frame} loop={loop} />

          {/* Vieux-Nice en trois plans */}
          <Row buildings={rows.far} style={{ haze: 0.55, hazeColor: "#ead9c2", night: false, windows: false }} frame={frame} loop={loop} />
          <Bay horizon={HERO_HORIZON} amp={230} seed={20} night={false} hazeColor="#ead9c2" frame={frame} loop={loop} />
          <Landmarks night={false} haze="#ead9c2" />
          <Row buildings={rows.mid} style={{ haze: 0.28, hazeColor: "#ead9c2", night: false, windows: true }} frame={frame} loop={loop} />
          <Row buildings={rows.near} style={{ haze: 0.06, hazeColor: "#ead9c2", night: false, windows: true }} frame={frame} loop={loop} />

          {/* Goélands en vol circulaire */}
          {[0, 1, 2].map((i) => {
            const a = (TAU * frame) / loop + i * 2.1;
            const gx = 760 + i * 220 + 420 * Math.cos(a);
            const gy = 170 + i * 30 + 50 * Math.sin(a);
            const s = 0.8 + 0.25 * Math.sin(a);
            const flap = 7 * wave(frame, loop, 20 + i * 4, i / 3);
            return (
              <path
                key={i}
                d={`M ${gx - 16 * s} ${gy} Q ${gx - 8 * s} ${gy - flap * s} ${gx} ${gy} Q ${gx + 8 * s} ${gy - flap * s} ${gx + 16 * s} ${gy}`}
                stroke="#3a4250"
                strokeWidth={2.2}
                fill="none"
                strokeLinecap="round"
              />
            );
          })}

          {/* Terrasse : balustres niçois */}
          <rect x={-60} y={778} width={W + 120} height={14} fill="#f6efe2" />
          <rect x={-60} y={790} width={W + 120} height={5} fill="#cdbb9c" opacity={0.6} />
          {Array.from({ length: 62 }, (_, i) => {
            const x = -40 + i * 33;
            return (
              <path
                key={i}
                d={`M ${x} 795 C ${x - 6} 812 ${x + 1} 820 ${x - 5} 836 C ${x - 9} 846 ${x - 2} 852 ${x} 858 L ${x + 16} 858 C ${x + 18} 852 ${x + 25} 846 ${x + 21} 836 C ${x + 15} 820 ${x + 22} 812 ${x + 16} 795 Z`}
                fill="#f1e8d8"
                stroke="#cdbb9c"
                strokeWidth={1}
              />
            );
          })}
          <rect x={-60} y={856} width={W + 120} height={10} fill="#e9dfcc" />

          {/* Sol de la terrasse et lignes de dallage en perspective */}
          <rect x={-60} y={866} width={W + 120} height={260} fill="url(#deck)" />
          {Array.from({ length: 23 }, (_, i) => {
            const bx = -400 + i * 120;
            return <line key={i} x1={960 + (bx - 960) * 0.35} y1={866} x2={bx} y2={1100} stroke="#c9b799" strokeWidth={1} opacity={0.5} />;
          })}
          {[884, 910, 945, 992, 1052].map((y) => (
            <line key={y} x1={-60} y1={y} x2={W + 60} y2={y} stroke="#c9b799" strokeWidth={1} opacity={0.45} />
          ))}

          {/* Piscine : eau, caustiques, reflets */}
          <polygon points="244,1080 1676,1080 1480,890 440,890" fill="#f8f3ea" />
          <polygon points={pool} fill="url(#water)" />
          <g clipPath="url(#poolClip)" style={{ mixBlendMode: "screen" }}>
            <rect x={300 + c1x} y={850 + c1y} width={1500} height={300} filter="url(#caustics)" opacity={0.32} />
            <rect x={240 + c2x} y={860 + c2y} width={1500} height={300} filter="url(#caustics)" opacity={0.22} transform="scale(1 1)" />
          </g>
          <g clipPath="url(#poolClip)">
            {/* reflet du ciel le long du bord lointain */}
            <rect x={400} y={896} width={1120} height={22} fill="#e7f7f8" opacity={0.35 + 0.1 * wave(frame, loop, 2)} />
            {Array.from({ length: 9 }, (_, i) => {
              const y = 930 + i * 16;
              const x = 520 + ((i * 137) % 600) + 40 * wave(frame, loop, 2, i / 9);
              return <rect key={i} x={x} y={y} width={120 + i * 14} height={1.8} rx={1} fill="#ffffff" opacity={0.2 + 0.18 * pulse(frame, loop, 3, i / 9)} />;
            })}
            {poolSparkles.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="#ffffff" opacity={pulse(frame, loop, p.cycles, p.phase) ** 6} />
            ))}
          </g>
          {/* Échelle chromée */}
          <path d="M 1300 912 Q 1302 872 1322 872 Q 1336 872 1338 886" stroke="#d6dde2" strokeWidth={5} fill="none" />
          <path d="M 1346 912 Q 1348 872 1368 872 Q 1382 872 1384 886" stroke="#d6dde2" strokeWidth={5} fill="none" />

          {/* Transats et parasol */}
          {[0, 1].map((i) => {
            const x = 1560 + i * 190;
            const y = 930 + i * 40;
            return (
              <g key={i}>
                <polygon points={`${x},${y} ${x + 170},${y + 18} ${x + 150},${y + 46} ${x - 22},${y + 26}`} fill="#ffffff" />
                <polygon points={`${x - 22},${y + 26} ${x - 40},${y - 22} ${x - 14},${y - 26} ${x},${y}`} fill="#f4f0e9" />
                <polygon points={`${x + 20},${y + 4} ${x + 150},${y + 20} ${x + 140},${y + 36} ${x + 8},${y + 22}`} fill="#1f4f7a" opacity={0.85} />
                <polygon points={`${x + 52},${y + 8} ${x + 70},${y + 10} ${x + 58},${y + 26} ${x + 40},${y + 24}`} fill="#ffffff" opacity={0.85} />
                <rect x={x - 18} y={y + 44} width={4} height={18} fill="#9f9480" />
                <rect x={x + 142} y={y + 44} width={4} height={18} fill="#9f9480" />
              </g>
            );
          })}
          <line x1={1735} y1={990} x2={1735} y2={640} stroke="#b6a586" strokeWidth={6} />
          <path
            d={`M 1520 ${708 + 2 * wave(frame, loop, 3)} Q 1735 560 1950 ${708 + 2 * wave(frame, loop, 3, 0.5)} ${Array.from({ length: 8 }, (_, k) => {
              const x0 = 1950 - k * 53.75;
              const x1 = x0 - 53.75;
              const sag = 14 + 3 * wave(frame, loop, 4, k / 8);
              return `Q ${(x0 + x1) / 2} ${708 + sag} ${x1} 708`;
            }).join(" ")} Z`}
            fill="#fbf8f2"
          />
          <path d="M 1520 708 Q 1735 600 1950 708 Z" fill="#e9e1d2" opacity={0.35} />

          {/* Petite table et deux verres de rosé */}
          <ellipse cx={180} cy={942} rx={70} ry={16} fill="#f6f2ea" />
          <rect x={176} y={950} width={8} height={70} fill="#b6a586" />
          <path d="M 160 912 L 166 934 L 172 912 Z" fill="#f2a7a0" opacity={0.9} />
          <line x1={166} y1={934} x2={166} y2={942} stroke="#e8e8e8" strokeWidth={1.5} />
          <path d="M 194 910 L 200 934 L 206 910 Z" fill="#f2a7a0" opacity={0.9} />
          <line x1={200} y1={934} x2={200} y2={942} stroke="#e8e8e8" strokeWidth={1.5} />

          {/* Palmiers en pots */}
          <Palm x={92} y={900} height={560} lean={60} fronds={11} frond={260} frame={frame} loop={loop} seed="pl" color="#2f5236" rim="#cfe0a0" trunk="#7a6248" />
          <rect x={40} y={884} width={110} height={110} rx={8} fill="#e3d6bf" />
          <Palm x={1868} y={880} height={470} lean={-50} fronds={10} frond={230} frame={frame} loop={loop} seed="pr" color="#2c4b33" rim="#e6dca0" trunk="#6f5940" />
          <rect x={1816} y={866} width={104} height={104} rx={8} fill="#e3d6bf" />

          {/* Feuillage flou au premier plan (profondeur) */}
          <g filter="url(#softBlur)" opacity={0.85}>
            <ellipse cx={-30 + 10 * wave(frame, loop, 1)} cy={40} rx={190} ry={70} fill="#24402c" />
            <ellipse cx={120 + 12 * wave(frame, loop, 1, 0.3)} cy={-10} rx={160} ry={50} fill="#2f5236" />
          </g>

          {/* Étalonnage chaud */}
          <rect x={-60} y={-60} width={W + 120} height={H + 120} fill="url(#warmGrade)" />
        </g>
        <rect x={-200} y={0} width={W + 400} height={H} fill="url(#vignette)" />
      </svg>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// MOON BAR — Soirée Live Music sur le toit-terrasse (120 BPM)
// ---------------------------------------------------------------------------

const MOON = { x: 1380, y: 236 };
const MOON_HORIZON = 520;

export const MoonBarLive: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: loop } = MOON_LOOP;
  const beatFrames = (fps * 60) / MOON_BPM; // 15 frames
  const beatIndex = Math.floor(frame / beatFrames) % 4;
  const sinceBeat = (frame % beatFrames) / fps;
  // Enveloppe de kick : attaque sèche puis décroissance exponentielle
  const kick = Math.exp(-sinceBeat * 9);
  // Contretemps (charleston) sur les croches
  const hat = Math.exp(-(((frame + beatFrames / 2) % beatFrames) / fps) * 16);
  // Basse lissée (glide) : moyenne glissante de l'enveloppe, toujours bouclée
  const sub = 0.55 + 0.25 * wave(frame, loop, 4) + 0.2 * kick;

  const rows = useMemo(
    () => ({
      far: buildRow(10, 600, 22, 58, 34, 70, { horizon: MOON_HORIZON, amp: 150 }),
      mid: buildRow(11, 680, 50, 104, 44, 96),
      near: buildRow(12, 770, 90, 160, 60, 130),
    }),
    [],
  );

  const stars = useMemo(
    () =>
      Array.from({ length: 170 }, (_, i) => ({
        x: range(`st${i}x`, 0, W),
        y: range(`st${i}y`, 0, 430) ** 1.08 / 1.3,
        r: range(`st${i}r`, 0.6, 1.9),
        cycles: 1 + Math.floor(random(`st${i}c`) * 4),
        phase: random(`st${i}p`),
      })),
    [],
  );

  const bokeh = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        x: range(`bk${i}x`, -40, W + 40),
        y: range(`bk${i}y`, 560, 1080),
        r: range(`bk${i}r`, 18, 70),
        hue: pick(`bk${i}h`, ["#ffcf87", "#f6a96b", "#e98ca0", "#f3d9a4", "#9fc3e8"] as const),
        orbit: range(`bk${i}o`, 10, 34),
        phase: random(`bk${i}p`),
        group: i % 4,
      })),
    [],
  );

  // « Collier de la Reine » : les lampadaires de la promenade des Anglais le long de la baie
  const promenade = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => {
        const t = i / 69;
        const x = SHORE_X0 + 40 + t * (W - SHORE_X0 - 30);
        return { x, y: shoreY(x, MOON_HORIZON, 150) - 1, size: 1.9 - 1.2 * t };
      }),
    [],
  );

  const strings = [
    { x0: -40, y0: 70, x1: W + 40, y1: 140, sag: 130, n: 30 },
    { x0: -40, y0: 210, x1: W + 40, y1: 120, sag: 110, n: 28 },
  ];

  const spot = 0.55 + 0.25 * kick + 0.1 * pulse(frame, loop, 2);
  const spotAngle = 6 * wave(frame, loop, 1);

  return (
    <AbsoluteFill style={{ backgroundColor: "#071225" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="nightSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#050d1d" />
            <stop offset="0.5" stopColor="#10264a" />
            <stop offset="0.85" stopColor="#3a3463" />
            <stop offset="1" stopColor="#8a5263" />
          </linearGradient>
          <radialGradient id="moonFace" cx="0.42" cy="0.4" r="0.65">
            <stop offset="0" stopColor="#fffdf2" />
            <stop offset="0.7" stopColor="#f4ebcc" />
            <stop offset="1" stopColor="#e3d5a8" />
          </radialGradient>
          <radialGradient id="moonHalo">
            <stop offset="0" stopColor="#fff4d4" stopOpacity="0.45" />
            <stop offset="0.35" stopColor="#c9d6f2" stopOpacity="0.12" />
            <stop offset="1" stopColor="#c9d6f2" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="nightSea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#14284a" />
            <stop offset="1" stopColor="#081428" />
          </linearGradient>
          <radialGradient id="bulb">
            <stop offset="0" stopColor="#fff6dc" stopOpacity="1" />
            <stop offset="0.25" stopColor="#ffcf87" stopOpacity="0.8" />
            <stop offset="1" stopColor="#ffb05a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="spotCone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe2a8" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ffe2a8" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="counter" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b2416" />
            <stop offset="1" stopColor="#140b06" />
          </linearGradient>
          <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fb3d9" stopOpacity="0.16" />
            <stop offset="1" stopColor="#8fb3d9" stopOpacity="0.04" />
          </linearGradient>
          <radialGradient id="nightVignette" cx="0.5" cy="0.45" r="0.78">
            <stop offset="0.55" stopColor="#02060f" stopOpacity="0" />
            <stop offset="1" stopColor="#02060f" stopOpacity="0.6" />
          </radialGradient>
          <filter id="bokehBlur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {/* Ciel nocturne, étoiles, lune */}
        <rect width={W} height={MOON_HORIZON + 10} fill="url(#nightSky)" />
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#f5f2ff" opacity={0.25 + 0.75 * pulse(frame, loop, s.cycles, s.phase) ** 2} />
        ))}
        <circle cx={MOON.x} cy={MOON.y} r={380} fill="url(#moonHalo)" opacity={0.9 + 0.08 * sub} />
        <circle cx={MOON.x} cy={MOON.y} r={84} fill="url(#moonFace)" />
        {[
          [-26, -18, 16],
          [22, 8, 12],
          [-8, 30, 9],
          [30, -30, 7],
          [-40, 18, 6],
        ].map(([dx, dy, r], i) => (
          <circle key={i} cx={MOON.x + dx} cy={MOON.y + dy} r={r} fill="#d8c99c" opacity={0.35} />
        ))}

        {/* Mer et chemin de lune */}
        <rect y={MOON_HORIZON} width={W} height={220} fill="url(#nightSea)" />
        {Array.from({ length: 60 }, (_, i) => {
          const y = MOON_HORIZON + 4 + i * 2.4;
          const spread = 18 + (y - MOON_HORIZON) * 1.6;
          const x = MOON.x + range(`mp${i}x`, -spread, spread);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={range(`mp${i}w`, 8, 30)}
              height={1.4}
              fill="#fff4d4"
              opacity={(0.25 + 0.75 * pulse(frame, loop, 1 + (i % 5), random(`mp${i}p`)) ** 3) * (1 - i / 75)}
            />
          );
        })}

        {/* Relief et ville de nuit */}
        <path d={boronPath(MOON_HORIZON)} fill="#0e1a30" />
        <ChateauHill horizon={MOON_HORIZON} night frame={frame} loop={loop} />
        <Row buildings={rows.far} style={{ haze: 0.45, hazeColor: "#2a2f55", night: true, windows: false }} frame={frame} loop={loop} />
        <Bay horizon={MOON_HORIZON} amp={150} seed={30} night hazeColor="#2a2f55" frame={frame} loop={loop} />
        {promenade.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={p.size * 3.2} fill="#ffcf87" opacity={0.22} filter="url(#glow)" />
            <circle cx={p.x} cy={p.y} r={p.size} fill="#ffe2a8" opacity={0.7 + 0.3 * pulse(frame, loop, 2, i / 16)} />
          </g>
        ))}
        <g transform="translate(0 -60)">
          <Landmarks night haze="#2a2f55" />
        </g>
        <Row buildings={rows.mid} style={{ haze: 0.2, hazeColor: "#2a2f55", night: true, windows: true }} frame={frame} loop={loop} />
        <Row buildings={rows.near} style={{ haze: 0.05, hazeColor: "#2a2f55", night: true, windows: true }} frame={frame} loop={loop} />

        {/* Balustrade de verre et main courante laiton */}
        <rect y={760} width={W} height={120} fill="url(#glass)" />
        <rect y={756} width={W} height={7} fill="#c9a25f" opacity={0.85} />
        <rect y={756} width={W} height={2} fill="#ffe4ad" opacity={0.6 + 0.3 * kick} />
        {Array.from({ length: 13 }, (_, i) => (
          <rect key={i} x={i * 160 - 4} y={760} width={6} height={120} fill="#0d1424" opacity={0.85} />
        ))}
        {/* Plancher de la terrasse */}
        <polygon points={`0,880 ${W},880 ${W},${H} 0,${H}`} fill="#120c0a" />
        {Array.from({ length: 16 }, (_, i) => (
          <line key={i} x1={960 + (i * 140 - 1100) * 0.4} y1={880} x2={i * 140 - 1100 + 960} y2={H} stroke="#2a1c14" strokeWidth={2} />
        ))}

        {/* Scène : faisceau, contrebasse, micro */}
        <g transform={`rotate(${spotAngle} 180 -120)`} style={{ mixBlendMode: "screen" }}>
          <polygon points="170,-120 200,-120 520,960 160,960" fill="url(#spotCone)" opacity={spot * 0.42} />
        </g>
        <ellipse cx={340} cy={960} rx={220} ry={30} fill="#ffe2a8" opacity={0.08 + 0.1 * kick} />
        {/* Contrebasse */}
        <g transform="translate(250 600)">
          <path
            d="M 60 70 C 20 70 18 120 40 150 C 10 170 0 230 30 270 C 50 300 110 300 130 270 C 160 230 150 170 120 150 C 142 120 140 70 100 70 Z"
            fill="#0a0d16"
          />
          <path
            d="M 60 70 C 20 70 18 120 40 150 C 10 170 0 230 30 270 C 50 300 110 300 130 270"
            fill="none"
            stroke="#f2c27b"
            strokeWidth={2}
            opacity={0.35 + 0.35 * kick}
          />
          <rect x={74} y={-120} width={12} height={200} fill="#0a0d16" />
          <path d="M 70 -120 Q 80 -150 92 -128 Q 98 -116 86 -112 Z" fill="#0a0d16" />
          <line x1={80} y1={300} x2={80} y2={330} stroke="#0a0d16" strokeWidth={4} />
          {[0, 1, 2, 3].map((s) => (
            <line key={s} x1={76 + s * 3} y1={-110} x2={70 + s * 7} y2={250} stroke="#d8c08a" strokeWidth={0.8} opacity={0.25 + 0.4 * (s === beatIndex ? kick : 0)} />
          ))}
        </g>
        {/* Micro sur pied */}
        <g>
          <line x1={470} y1={950} x2={470} y2={700} stroke="#0a0d16" strokeWidth={5} />
          <line x1={470} y1={700} x2={430} y2={672} stroke="#0a0d16" strokeWidth={4} />
          <ellipse cx={426} cy={668} rx={10} ry={14} fill="#0a0d16" transform="rotate(-35 426 668)" />
          <line x1={440} y1={950} x2={500} y2={950} stroke="#0a0d16" strokeWidth={5} />
          <line x1={470} y1={700} x2={470} y2={950} stroke="#f2c27b" strokeWidth={1} opacity={0.3 + 0.3 * kick} transform="translate(2 0)" />
        </g>

        {/* Comptoir du bar, verres à cocktail, bougie */}
        <polygon points={`1200,900 ${W},860 ${W},${H} 1180,${H}`} fill="url(#counter)" />
        <polygon points={`1200,900 ${W},860 ${W},868 1200,908`} fill="#c9a25f" opacity={0.9} />
        {[
          { x: 1420, c: "#f29b6b" },
          { x: 1560, c: "#e7718c" },
          { x: 1700, c: "#f5d27a" },
        ].map((g, i) => {
          const y = 892 - (g.x - 1200) * 0.055;
          return (
            <g key={i}>
              <path d={`M ${g.x - 28} ${y - 64} L ${g.x + 28} ${y - 64} L ${g.x} ${y - 30} Z`} fill={g.c} opacity={0.82} />
              <path d={`M ${g.x - 28} ${y - 64} L ${g.x + 28} ${y - 64} L ${g.x} ${y - 30} Z`} fill="none" stroke="#fff3da" strokeWidth={1.2} opacity={0.6} />
              <line x1={g.x} y1={y - 30} x2={g.x} y2={y - 4} stroke="#fff3da" strokeWidth={1.6} opacity={0.6} />
              <ellipse cx={g.x} cy={y - 3} rx={14} ry={3} fill="#fff3da" opacity={0.5} />
              <circle cx={g.x + 18} cy={y - 66} r={6} fill="#b5d36a" />
              <circle cx={g.x - 10} cy={y - 58} r={2} fill="#ffffff" opacity={0.3 + 0.7 * (beatIndex === i ? kick : 0.1)} />
            </g>
          );
        })}
        <g>
          <rect x={1830} y={800} width={22} height={56} rx={4} fill="#f3e6cf" />
          <ellipse cx={1841} cy={792 + 1.5 * wave(frame, loop, 8)} rx={5} ry={11 + 2 * wave(frame, loop, 6)} fill="#ffcf87" />
          <circle cx={1841} cy={792} r={36} fill="url(#bulb)" opacity={0.45 + 0.1 * wave(frame, loop, 8, 0.2)} />
        </g>

        {/* Bokeh flottant, pulsé sur le temps */}
        <g filter="url(#bokehBlur)" style={{ mixBlendMode: "screen" }}>
          {bokeh.map((b, i) => {
            const a = TAU * ((frame / loop) * (1 + (i % 2)) + b.phase);
            const onBeat = b.group === beatIndex ? kick : 0;
            return (
              <circle
                key={i}
                cx={b.x + b.orbit * Math.cos(a)}
                cy={b.y + b.orbit * 0.6 * Math.sin(a)}
                r={b.r * (1 + 0.12 * onBeat)}
                fill={b.hue}
                opacity={0.12 + 0.2 * onBeat + 0.05 * hat}
              />
            );
          })}
        </g>

        {/* Guirlandes guinguette : temps forts (1 & 3) / temps faibles (2 & 4) */}
        {strings.map((s, si) => {
          const sway = 6 * wave(frame, loop, 1, si * 0.4);
          const pts = Array.from({ length: s.n }, (_, k) => {
            const t = k / (s.n - 1);
            const x = s.x0 + (s.x1 - s.x0) * t;
            const y = s.y0 + (s.y1 - s.y0) * t + s.sag * 4 * t * (1 - t) + sway * Math.sin(Math.PI * t);
            return { x, y };
          });
          return (
            <g key={si}>
              <path d={`M ${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")}`} stroke="#0b0f18" strokeWidth={2} fill="none" />
              {pts.map((p, k) => {
                const strong = (k + si) % 2 === 0;
                const accent = strong ? (beatIndex % 2 === 0 ? kick : 0) : beatIndex % 2 === 1 ? kick : 0;
                const level = 0.62 + 0.38 * accent;
                return (
                  <g key={k}>
                    <circle cx={p.x} cy={p.y + 12} r={26 + 10 * accent} fill="url(#bulb)" opacity={0.55 * level} />
                    <circle cx={p.x} cy={p.y + 12} r={5} fill="#fff1cf" opacity={0.75 + 0.25 * level} />
                    <line x1={p.x} y1={p.y} x2={p.x} y2={p.y + 8} stroke="#0b0f18" strokeWidth={2} />
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Onde dorée « Live Music » : spectre synthétique bouclé */}
        <g opacity={0.6}>
          {Array.from({ length: 64 }, (_, i) => {
            const centre = Math.abs(i - 31.5) / 31.5;
            const low = (1 - centre) ** 1.6;
            const body =
              0.35 * low * sub +
              0.4 * low * kick +
              0.12 * pulse(frame, loop, 4 + (i % 5), i / 64) +
              0.1 * centre * hat;
            const h = 6 + 70 * body;
            const x = 640 + i * 10;
            return <rect key={i} x={x} y={1040 - h / 2} width={4} height={h} rx={2} fill="#e8c27a" />;
          })}
        </g>

        <rect width={W} height={H} fill="url(#nightVignette)" />
      </svg>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Root Remotion
// ---------------------------------------------------------------------------

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="HeroRooftop"
      component={HeroRooftop}
      width={1920}
      height={1080}
      fps={HERO_LOOP.fps}
      durationInFrames={HERO_LOOP.durationInFrames}
      defaultProps={{ crop: "landscape" } satisfies HeroProps}
    />
    <Composition
      id="HeroRooftopPortrait"
      component={HeroRooftop}
      width={720}
      height={1280}
      fps={HERO_LOOP.fps}
      durationInFrames={HERO_LOOP.durationInFrames}
      defaultProps={{ crop: "portrait" } satisfies HeroProps}
    />
    <Composition
      id="MoonBarLive"
      component={MoonBarLive}
      width={1920}
      height={1080}
      fps={MOON_LOOP.fps}
      durationInFrames={MOON_LOOP.durationInFrames}
    />
  </>
);
