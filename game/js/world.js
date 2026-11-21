// world.js — generates the island city of Crescent Keys (San Aurelio) and draws it.
// Everything is procedural and deterministic: same city on every load.

import { makeRng, rand, clamp } from './util.js';

export const WORLD_W = 5120;
export const WORLD_H = 3840;
export const ROAD_HALF = 62;               // half the road width in px
export const ROADS_X = [760, 1400, 2040, 2680, 3320, 3960, 4600];
export const ROADS_Y = [760, 1400, 2040, 2680, 3320];
export const LAND = { x: 390, y: 390, w: 4340, h: 3060 };   // paved city ground
export const ISLAND = { x: 270, y: 270, w: 4580, h: 3300 }; // sand island edge

const BUILDING_COLOURS = [
  '#c96f4a', '#b8574d', '#d9a05b', '#8fa3b8', '#7d8fa3', '#c2b280',
  '#9db38a', '#a26769', '#5d7a8c', '#e0cfa8', '#b08968', '#6c8ea4',
];
const ROOF_COLOURS = ['#8a4b38', '#6e4a3a', '#7a6a58', '#54626e', '#77513f', '#5f7161'];

export function buildWorld() {
  const rng = makeRng(1337);
  const buildings = [];
  const trees = [];
  const lights = [];

  // --- City blocks between roads: fill with buildings, leaving sidewalks ---
  const xs = [LAND.x, ...ROADS_X.map((x) => x + ROAD_HALF + 24), LAND.x + LAND.w];
  const ys = [LAND.y, ...ROADS_Y.map((y) => y + ROAD_HALF + 24), LAND.y + LAND.h];
  const xEdges = [LAND.x];
  for (const rx of ROADS_X) { xEdges.push(rx - ROAD_HALF - 24, rx + ROAD_HALF + 24); }
  xEdges.push(LAND.x + LAND.w);
  const yEdges = [LAND.y];
  for (const ry of ROADS_Y) { yEdges.push(ry - ROAD_HALF - 24, ry + ROAD_HALF + 24); }
  yEdges.push(LAND.y + LAND.h);
  void xs; void ys;

  const reserved = [
    { x: 2060, y: 2700, w: 420, h: 300 },  // safehouse block
    { x: 3360, y: 1420, w: 560, h: 320 },  // dealership lot
    { x: 820, y: 3060, w: 560, h: 300 },   // docks warehouse yard
  ];
  const overlapsReserved = (r) => reserved.some((s) => r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y);

  for (let i = 0; i < xEdges.length - 1; i += 2) {
    for (let j = 0; j < yEdges.length - 1; j += 2) {
      const bx = xEdges[i], by = yEdges[j];
      const bw = xEdges[i + 1] - bx, bh = yEdges[j + 1] - by;
      if (bw < 200 || bh < 200) continue;
      // Subdivide the block into 1–4 buildings with alley gaps.
      const cols = bw > 420 ? 2 : 1;
      const rows = bh > 420 ? 2 : 1;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const gap = 26;
          const w = (bw - gap * (cols + 1)) / cols;
          const h = (bh - gap * (rows + 1)) / rows;
          const rect = {
            x: bx + gap + c * (w + gap) + rand(rng, -6, 6),
            y: by + gap + r * (h + gap) + rand(rng, -6, 6),
            w: w + rand(rng, -14, 10),
            h: h + rand(rng, -14, 10),
          };
          if (overlapsReserved(rect)) continue;
          const storeys = 2 + Math.floor(rng() * 7);
          buildings.push({
            ...rect,
            storeys,
            colour: BUILDING_COLOURS[Math.floor(rng() * BUILDING_COLOURS.length)],
            roof: ROOF_COLOURS[Math.floor(rng() * ROOF_COLOURS.length)],
            seed: Math.floor(rng() * 100000),
          });
        }
      }
    }
  }

  // Docks warehouse (one big low building in the reserved yard).
  buildings.push({ x: 900, y: 3120, w: 300, h: 150, storeys: 1, colour: '#7a6a58', roof: '#4c4238', seed: 42 });
  // Safehouse: a small villa on its reserved block.
  buildings.push({ x: 2260, y: 2740, w: 150, h: 110, storeys: 1, colour: '#e8dcc0', roof: '#a34a32', seed: 77 });

  // --- Palm trees: beaches, sidewalks, random green corners ---
  for (let i = 0; i < 260; i++) {
    const onBeach = rng() < 0.45;
    let x, y;
    if (onBeach) {
      const side = Math.floor(rng() * 4);
      if (side === 0) { x = rand(rng, ISLAND.x + 20, ISLAND.x + ISLAND.w - 20); y = rand(rng, ISLAND.y + 16, LAND.y - 14); }
      else if (side === 1) { x = rand(rng, ISLAND.x + 20, ISLAND.x + ISLAND.w - 20); y = rand(rng, LAND.y + LAND.h + 14, ISLAND.y + ISLAND.h - 16); }
      else if (side === 2) { x = rand(rng, ISLAND.x + 16, LAND.x - 14); y = rand(rng, ISLAND.y + 20, ISLAND.y + ISLAND.h - 20); }
      else { x = rand(rng, LAND.x + LAND.w + 14, ISLAND.x + ISLAND.w - 16); y = rand(rng, ISLAND.y + 20, ISLAND.y + ISLAND.h - 20); }
    } else {
      x = rand(rng, LAND.x + 20, LAND.x + LAND.w - 20);
      y = rand(rng, LAND.y + 20, LAND.y + LAND.h - 20);
      if (isOnRoad(x, y, 30)) continue;
      if (buildings.some((b) => x > b.x - 16 && x < b.x + b.w + 16 && y > b.y - 16 && y < b.y + b.h + 16)) continue;
    }
    trees.push({ x, y, s: rand(rng, 0.8, 1.3), seed: rng() * 10 });
  }

  // --- Streetlights along the roads ---
  for (const rx of ROADS_X) for (let y = LAND.y + 60; y < LAND.y + LAND.h; y += 230) lights.push({ x: rx - ROAD_HALF - 8, y }, { x: rx + ROAD_HALF + 8, y: y + 115 });
  for (const ry of ROADS_Y) for (let x = LAND.x + 60; x < LAND.x + LAND.w; x += 230) lights.push({ x, y: ry - ROAD_HALF - 8 }, { x: x + 115, y: ry + ROAD_HALF + 8 });

  // --- Parked-car spots: along block edges and in two parking lots ---
  const parkSpots = [];
  for (const rx of ROADS_X) {
    for (let y = LAND.y + 130; y < LAND.y + LAND.h - 60; y += 170) {
      if (ROADS_Y.some((ry) => Math.abs(y - ry) < 130)) continue;
      parkSpots.push({ x: rx - ROAD_HALF - 20, y, angle: Math.PI / 2 });
      parkSpots.push({ x: rx + ROAD_HALF + 20, y: y + 80, angle: Math.PI / 2 });
    }
  }

  const pois = {
    safehouse: { x: 2180, y: 2900, label: 'Safehouse' },
    safehouseParking: [
      { x: 2100, y: 2920, angle: 0 }, { x: 2190, y: 2920, angle: 0 }, { x: 2280, y: 2920, angle: 0 },
    ],
    dealer: { x: 3640, y: 1580, label: "Marv's Motors" },
    dealerPads: [
      { x: 3460, y: 1560, angle: 0 }, { x: 3600, y: 1560, angle: 0 }, { x: 3740, y: 1560, angle: 0 },
    ],
    kiosk: { x: 1560, y: 3470, label: 'Boardwalk Kiosk' },
    docks: { x: 1060, y: 3300, label: 'South Docks' },
    spawn: { x: 2180, y: 2980 },
  };

  return { buildings, trees, lights, parkSpots, pois };
}

export function isOnRoad(x, y, pad = 0) {
  if (x < LAND.x - 40 || x > LAND.x + LAND.w + 40 || y < LAND.y - 40 || y > LAND.y + LAND.h + 40) return false;
  for (const rx of ROADS_X) if (Math.abs(x - rx) <= ROAD_HALF + pad) return true;
  for (const ry of ROADS_Y) if (Math.abs(y - ry) <= ROAD_HALF + pad) return true;
  return false;
}

export function isOnIsland(x, y) {
  return x >= ISLAND.x && x <= ISLAND.x + ISLAND.w && y >= ISLAND.y && y <= ISLAND.y + ISLAND.h;
}

// ---------------- Drawing ----------------
export function drawWorld(ctx, world, cam, night, time) {
  const vw = cam.w, vh = cam.h;
  const x0 = cam.x, y0 = cam.y;

  // Water
  ctx.fillStyle = '#14425e';
  ctx.fillRect(0, 0, vw, vh);
  ctx.strokeStyle = 'rgba(120,200,235,0.13)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 26; i++) {
    const wy = ((i * 173 + Math.sin(time * 0.7 + i) * 8 - y0) % (vh + 80) + vh + 80) % (vh + 80) - 40;
    const wx = ((i * 389 - x0) % (vw + 160) + vw + 160) % (vw + 160) - 80;
    ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo(wx + 30, wy - 7, wx + 60, wy);
  }
  ctx.stroke();

  // Sand island
  ctx.fillStyle = '#d9bd85';
  ctx.fillRect(ISLAND.x - x0, ISLAND.y - y0, ISLAND.w, ISLAND.h);

  // City ground
  ctx.fillStyle = '#77806e';
  ctx.fillRect(LAND.x - x0, LAND.y - y0, LAND.w, LAND.h);

  // Parking / dealer / dock yards (asphalt pads)
  ctx.fillStyle = '#4c4f55';
  ctx.fillRect(3360 - x0, 1420 - y0, 560, 320);   // dealer lot
  ctx.fillRect(820 - x0, 3060 - y0, 560, 300);    // docks yard
  ctx.fillRect(2060 - x0, 2700 - y0, 420, 300);   // safehouse plot
  ctx.fillStyle = '#8b9096';
  ctx.fillRect(2060 - x0, 2860 - y0, 420, 70);    // safehouse drive

  // Sidewalks (slightly wider light strips under the roads)
  ctx.fillStyle = '#9aa0a3';
  for (const rx of ROADS_X) ctx.fillRect(rx - ROAD_HALF - 14 - x0, LAND.y - y0, (ROAD_HALF + 14) * 2, LAND.h);
  for (const ry of ROADS_Y) ctx.fillRect(LAND.x - x0, ry - ROAD_HALF - 14 - y0, LAND.w, (ROAD_HALF + 14) * 2);

  // Asphalt
  ctx.fillStyle = '#3a3d42';
  for (const rx of ROADS_X) ctx.fillRect(rx - ROAD_HALF - x0, LAND.y - y0, ROAD_HALF * 2, LAND.h);
  for (const ry of ROADS_Y) ctx.fillRect(LAND.x - x0, ry - ROAD_HALF - y0, LAND.w, ROAD_HALF * 2);

  // Centre dashes
  ctx.fillStyle = '#c8b45a';
  for (const rx of ROADS_X) for (let y = LAND.y + 10; y < LAND.y + LAND.h; y += 56) ctx.fillRect(rx - 3 - x0, y - y0, 6, 30);
  for (const ry of ROADS_Y) for (let x = LAND.x + 10; x < LAND.x + LAND.w; x += 56) ctx.fillRect(x - x0, ry - 3 - y0, 30, 6);

  // Crosswalks at intersections
  ctx.fillStyle = 'rgba(230,230,230,0.5)';
  for (const rx of ROADS_X) for (const ry of ROADS_Y) {
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(rx - ROAD_HALF - 12 - x0, ry + i * 22 - 6 - y0, 10, 12);
      ctx.fillRect(rx + ROAD_HALF + 2 - x0, ry + i * 22 - 6 - y0, 10, 12);
      ctx.fillRect(rx + i * 22 - 6 - x0, ry - ROAD_HALF - 12 - y0, 12, 10);
      ctx.fillRect(rx + i * 22 - 6 - x0, ry + ROAD_HALF + 2 - y0, 12, 10);
    }
  }

  // Buildings (culled) — shadow first, then body, then roof inset
  for (const b of world.buildings) {
    if (b.x + b.w < x0 - 60 || b.y + b.h < y0 - 60 || b.x > x0 + vw + 60 || b.y > y0 + vh + 60) continue;
    const sh = 4 + b.storeys * 3;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(b.x + sh - x0, b.y + sh - y0, b.w, b.h);
    ctx.fillStyle = b.colour;
    ctx.fillRect(b.x - x0, b.y - y0, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 7 - x0, b.y + 7 - y0, b.w - 14, b.h - 14);
    // Windows — lit at night
    if (night > 0.25) {
      const cols = Math.floor(b.w / 26), rows = Math.floor(b.h / 26);
      ctx.fillStyle = `rgba(255,214,120,${0.75 * night})`;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const h1 = Math.sin(b.seed * 0.37 + c * 12.9898 + r * 78.233) * 43758.5453;
          if (h1 - Math.floor(h1) > 0.45) {
            ctx.fillRect(b.x + 12 + c * 26 - x0, b.y + 12 + r * 26 - y0, 9, 12);
          }
        }
      }
    }
  }

  // Docks crates
  ctx.fillStyle = '#a34a32';
  for (let i = 0; i < 6; i++) ctx.fillRect(880 + i * 44 - x0, 3300 - y0, 36, 36);
  ctx.fillStyle = '#3f6d8e';
  for (let i = 0; i < 4; i++) ctx.fillRect(900 + i * 52 - x0, 3220 - y0, 40, 30);

  // Boardwalk kiosk
  ctx.fillStyle = '#c2432b';
  ctx.fillRect(world.pois.kiosk.x - 26 - x0, world.pois.kiosk.y - 18 - y0, 52, 36);
  ctx.fillStyle = '#ffd75e';
  ctx.fillRect(world.pois.kiosk.x - 30 - x0, world.pois.kiosk.y - 24 - y0, 60, 10);

  // Palm trees (culled)
  for (const t of world.trees) {
    if (t.x < x0 - 50 || t.y < y0 - 50 || t.x > x0 + vw + 50 || t.y > y0 + vh + 50) continue;
    const sx = t.x - x0, sy = t.y - y0;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(sx + 6, sy + 8, 14 * t.s, 6 * t.s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a6b42';
    ctx.lineWidth = 4 * t.s;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + 3, sy - 8, sx + 6, sy - 13 * t.s); ctx.stroke();
    ctx.strokeStyle = '#3e8e4f';
    ctx.lineWidth = 3 * t.s;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t.seed;
      ctx.beginPath();
      ctx.moveTo(sx + 6, sy - 13 * t.s);
      ctx.quadraticCurveTo(sx + 6 + Math.cos(a) * 12 * t.s, sy - 13 * t.s + Math.sin(a) * 5 * t.s - 3,
        sx + 6 + Math.cos(a) * 19 * t.s, sy - 13 * t.s + Math.sin(a) * 9 * t.s + 3);
      ctx.stroke();
    }
  }

  // Streetlight glow at night
  if (night > 0.2) {
    for (const l of world.lights) {
      if (l.x < x0 - 70 || l.y < y0 - 70 || l.x > x0 + vw + 70 || l.y > y0 + vh + 70) continue;
      const g = ctx.createRadialGradient(l.x - x0, l.y - y0, 2, l.x - x0, l.y - y0, 52);
      g.addColorStop(0, `rgba(255,205,110,${0.34 * night})`);
      g.addColorStop(1, 'rgba(255,205,110,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(l.x - x0, l.y - y0, 52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe1a0';
      ctx.fillRect(l.x - 2 - x0, l.y - 2 - y0, 4, 4);
    }
  }
}

// Draws the static minimap base (water / land / roads) into an offscreen canvas once.
export function makeMinimapBase(scale) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(WORLD_W * scale);
  c.height = Math.ceil(WORLD_H * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#14425e';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#c9ae76';
  g.fillRect(ISLAND.x * scale, ISLAND.y * scale, ISLAND.w * scale, ISLAND.h * scale);
  g.fillStyle = '#6d7563';
  g.fillRect(LAND.x * scale, LAND.y * scale, LAND.w * scale, LAND.h * scale);
  g.fillStyle = '#33363b';
  for (const rx of ROADS_X) g.fillRect((rx - ROAD_HALF) * scale, LAND.y * scale, ROAD_HALF * 2 * scale, LAND.h * scale);
  for (const ry of ROADS_Y) g.fillRect(LAND.x * scale, (ry - ROAD_HALF) * scale, LAND.w * scale, ROAD_HALF * 2 * scale);
  return c;
}

export function clampToWorld(e, r) {
  e.x = clamp(e.x, r, WORLD_W - r);
  e.y = clamp(e.y, r, WORLD_H - r);
}
