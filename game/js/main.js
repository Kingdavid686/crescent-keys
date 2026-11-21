// main.js — Crescent Keys: an original top-down open-world crime game.
// Vanilla JS + Canvas 2D. No libraries, no network, no external assets.

import { clamp, lerp, dist, angleTo, angleLerp, angleDiff, makeRng, circleRectCollide, pointInRect, Input, Sfx } from './util.js';
import { buildWorld, drawWorld, makeMinimapBase, isOnRoad, WORLD_W, WORLD_H, ROADS_X, ROADS_Y, ROAD_HALF, LAND } from './world.js';
import { MISSIONS } from './missions.js';

// ---------------- DOM ----------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const titleScreen = $('titleScreen'), pauseScreen = $('pauseScreen'), endScreen = $('endScreen');
const dialogueEl = $('dialogue'), bannerEl = $('banner');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

const input = new Input();
const sfx = new Sfx();
const world = buildWorld();
const minimapBase = makeMinimapBase(0.036);
const fxRng = makeRng(999);

// ---------------- Car types ----------------
const CAR_TYPES = {
  comet:     { name: 'Comet',        top: 305, accel: 300, health: 110, hl: 23, hw: 12, colours: ['#c94f38', '#3f6d8e', '#57a773', '#c8b45a', '#7d6ba8'] },
  sedan:     { name: 'Sedan',        top: 320, accel: 300, health: 120, hl: 24, hw: 12, colours: ['#8fa3b8', '#4a4f57', '#d9d9d9', '#5d7a8c', '#2f3e50'] },
  taxi:      { name: 'Taxi',         top: 315, accel: 310, health: 120, hl: 24, hw: 12, colours: ['#f0b429'] },
  hatch:     { name: 'Hatchback',    top: 295, accel: 320, health: 95,  hl: 21, hw: 12, colours: ['#e07a5f', '#81b29a', '#f2cc8f', '#6d8ea0'] },
  van:       { name: 'Cargo Van',    top: 265, accel: 230, health: 240, hl: 31, hw: 14, colours: ['#d9d9d9', '#9db38a', '#7d8fa3'] },
  police:    { name: 'APD Cruiser',  top: 445, accel: 400, health: 170, hl: 24, hw: 12, colours: ['#eef1f4'] },
  sparrow:   { name: 'Sparrow GT',   top: 480, accel: 450, health: 130, hl: 24, hw: 12, colours: ['#d7263d'], price: 800 },
  barracuda: { name: 'Barracuda S',  top: 550, accel: 520, health: 150, hl: 25, hw: 12, colours: ['#28418c'], price: 2000 },
  vanta:     { name: 'Vanta X',      top: 630, accel: 590, health: 170, hl: 25, hw: 12, colours: ['#191922'], price: 4500 },
};
const DEALER_TYPES = ['sparrow', 'barracuda', 'vanta'];
const TRAFFIC_TYPES = ['comet', 'sedan', 'taxi', 'hatch', 'van'];

// ---------------- Game state ----------------
const SAVE_KEY = 'crescentKeysSaveV1';
let G = null;

function freshState() {
  return {
    screen: 'title',
    time: 0,
    timeOfDay: 10.2,           // hours
    cash: 120,
    heat: 0,                   // 0..5 wanted heat
    lastSeenT: -99,
    lastCrimeT: -99,
    lastDamageT: -99,
    bustedMeter: 0,
    shake: 0,
    player: { x: world.pois.spawn.x, y: world.pois.spawn.y, angle: -Math.PI / 2, health: 100, car: null, walkPhase: 0 },
    cars: [],
    peds: [],
    particles: [],
    skids: [],
    police: [],
    heli: { active: false, x: 0, y: 0, angle: 0, lightX: 0, lightY: 0, rotor: 0 },
    missionIdx: 0,
    mission: null,             // runtime mission state
    storyDone: false,
    ownedTypes: ['comet'],
    dialogue: null,
    bannerT: 0,
    prompt: '',
    objective: 'Free roam — follow the gold marker to start a job',
    helpFlash: 0,
    vanRef: null,
    muted: false,
  };
}

function playerPos() {
  const p = G.player;
  return p.car ? { x: p.car.x, y: p.car.y } : { x: p.x, y: p.y };
}
function stars() { return G.heat <= 0.02 ? 0 : Math.ceil(G.heat); }

// ---------------- Save / load ----------------
function saveGame() {
  if (!G) return;
  const p = playerPos();
  const data = {
    cash: G.cash, missionIdx: G.missionIdx, ownedTypes: G.ownedTypes,
    storyDone: G.storyDone, x: p.x, y: p.y, timeOfDay: G.timeOfDay,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

// ---------------- Entity factories ----------------
let carIdSeq = 1;
function makeCar(typeId, x, y, angle, opts = {}) {
  const t = CAR_TYPES[typeId];
  const colour = opts.colour || t.colours[Math.floor(fxRng() * t.colours.length)];
  const car = {
    id: carIdSeq++, typeId, type: t, x, y, angle,
    vx: 0, vy: 0, health: t.health, maxHealth: t.health,
    colour, driver: null, parked: !!opts.parked, display: !!opts.display,
    ownedType: opts.ownedType || null, route: null, cruise: 150 + fxRng() * 70,
    decideCd: 0, stuckT: 0, reverseT: 0, dead: false, smokeT: 0, sirenPhase: fxRng() * 6,
  };
  if (opts.route) car.route = opts.route;
  G.cars.push(car);
  return car;
}

function nearestRoadRoute(x, y) {
  // Build a traffic route from the closest road to a point.
  let bestX = ROADS_X[0], dxBest = Infinity;
  for (const rx of ROADS_X) { const d = Math.abs(x - rx); if (d < dxBest) { dxBest = d; bestX = rx; } }
  let bestY = ROADS_Y[0], dyBest = Infinity;
  for (const ry of ROADS_Y) { const d = Math.abs(y - ry); if (d < dyBest) { dyBest = d; bestY = ry; } }
  if (dxBest <= dyBest) return { axis: 'y', line: bestX, dir: fxRng() < 0.5 ? 1 : -1 };
  return { axis: 'x', line: bestY, dir: fxRng() < 0.5 ? 1 : -1 };
}

function laneCoord(route) {
  // The lane centre coordinate perpendicular to travel (right-hand traffic):
  // vertical road: lane x = line - dir*30; horizontal road: lane y = line + dir*30.
  if (route.axis === 'y') return route.line - route.dir * 30;
  return route.line + route.dir * 30;
}

function spawnTrafficCar() {
  const pp = playerPos();
  for (let tries = 0; tries < 12; tries++) {
    const ang = fxRng() * Math.PI * 2;
    const d = 720 + fxRng() * 320;
    const x = pp.x + Math.cos(ang) * d, y = pp.y + Math.sin(ang) * d;
    if (x < LAND.x + 80 || x > LAND.x + LAND.w - 80 || y < LAND.y + 80 || y > LAND.y + LAND.h - 80) continue;
    const route = nearestRoadRoute(x, y);
    const typeId = TRAFFIC_TYPES[Math.floor(fxRng() * TRAFFIC_TYPES.length)];
    let sx = x, sy = y;
    if (route.axis === 'y') sx = route.line + (route.dir === -1 ? 30 : -30);
    else sy = route.line + route.dir * 30;
    if (G.cars.some((c) => dist(c.x, c.y, sx, sy) < 70)) continue;
    const angle = route.axis === 'y' ? (route.dir === 1 ? Math.PI / 2 : -Math.PI / 2) : (route.dir === 1 ? 0 : Math.PI);
    const car = makeCar(typeId, sx, sy, angle, { route });
    car.driver = 'traffic';
    return car;
  }
  return null;
}

function spawnParkedCars() {
  const spots = [...world.parkSpots];
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(fxRng() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  const n = Math.min(30, spots.length);
  for (let i = 0; i < n; i++) {
    const s = spots[i];
    if (world.buildings.some((b) => pointInRect(s.x, s.y, b, 6))) continue;
    const typeId = TRAFFIC_TYPES[Math.floor(fxRng() * TRAFFIC_TYPES.length)];
    makeCar(typeId, s.x, s.y, s.angle + (fxRng() < 0.5 ? 0 : Math.PI), { parked: true });
  }
  // Dealer display cars
  world.pois.dealerPads.forEach((pad, i) => {
    makeCar(DEALER_TYPES[i], pad.x, pad.y, pad.angle, { parked: true, display: true });
  });
}

function spawnOwnedCars() {
  world.pois.safehouseParking.forEach((spot, i) => {
    const typeId = G.ownedTypes[i];
    if (!typeId) return;
    if (G.cars.some((c) => c.ownedType === typeId)) return;
    makeCar(typeId, spot.x, spot.y, spot.angle, { parked: true, ownedType: typeId });
  });
}

function spawnPed(x, y) {
  const ped = {
    x, y, angle: fxRng() * Math.PI * 2, speed: 0,
    state: 'walk', target: null, timer: fxRng() * 3, fleeT: 0,
    down: 0, colour: ['#d94f30', '#3f88c5', '#f2cc8f', '#57a773', '#bc4b8c', '#e8e8e8'][Math.floor(fxRng() * 6)],
    skin: ['#f2c79b', '#c68863', '#8d5524', '#ffdbac'][Math.floor(fxRng() * 4)],
    walkPhase: fxRng() * 6,
  };
  G.peds.push(ped);
  return ped;
}

function spawnAmbientPeds() {
  const pp = playerPos();
  for (let tries = 0; tries < 10; tries++) {
    const ang = fxRng() * Math.PI * 2, d = 480 + fxRng() * 380;
    const x = pp.x + Math.cos(ang) * d, y = pp.y + Math.sin(ang) * d;
    if (x < LAND.x + 30 || x > LAND.x + LAND.w - 30 || y < LAND.y + 30 || y > LAND.y + LAND.h - 30) continue;
    if (!isOnRoad(x, y, 30)) continue;
    if (world.buildings.some((b) => pointInRect(x, y, b, 4))) continue;
    spawnPed(x, y);
    return;
  }
}

function spawnPoliceCar() {
  const pp = playerPos();
  for (let tries = 0; tries < 12; tries++) {
    const ang = fxRng() * Math.PI * 2;
    const d = 780 + fxRng() * 200;
    const x = clamp(pp.x + Math.cos(ang) * d, LAND.x + 70, LAND.x + LAND.w - 70);
    const y = clamp(pp.y + Math.sin(ang) * d, LAND.y + 70, LAND.y + LAND.h - 70);
    const route = nearestRoadRoute(x, y);
    let sx = x, sy = y;
    if (route.axis === 'y') sx = route.line; else sy = route.line;
    if (G.cars.some((c) => dist(c.x, c.y, sx, sy) < 60)) continue;
    const car = makeCar('police', sx, sy, angleTo(sx, sy, pp.x, pp.y), {});
    car.driver = 'police';
    G.police.push(car);
    return car;
  }
  return null;
}

// ---------------- World population ----------------
function populateWorld(saved) {
  G.cars = []; G.peds = []; G.police = []; G.particles = []; G.skids = [];
  carIdSeq = 1;
  spawnParkedCars();
  spawnOwnedCars();
  for (let i = 0; i < 12; i++) spawnTrafficCar();
  for (let i = 0; i < 14; i++) spawnAmbientPeds();
  if (saved) {
    G.player.x = clamp(saved.x ?? world.pois.spawn.x, 40, WORLD_W - 40);
    G.player.y = clamp(saved.y ?? world.pois.spawn.y, 40, WORLD_H - 40);
    // If the saved spot is inside a building, fall back to the safehouse.
    if (world.buildings.some((b) => pointInRect(G.player.x, G.player.y, b, 12))) {
      G.player.x = world.pois.spawn.x; G.player.y = world.pois.spawn.y;
    }
  }
}

// ---------------- Physics & collision ----------------
const ISLAND_R = { x: 270, y: 270, w: 4580, h: 3300 };
const speedOf = (c) => Math.hypot(c.vx, c.vy);

function collideStatic(e, r) {
  let impact = 0;
  for (const b of world.buildings) {
    if (e.x < b.x - r - 4 || e.x > b.x + b.w + r + 4 || e.y < b.y - r - 4 || e.y > b.y + b.h + r + 4) continue;
    const hit = circleRectCollide(e.x, e.y, r, b);
    if (hit) {
      if (e.vx !== undefined) {
        const vn = e.vx * hit.nx + e.vy * hit.ny;
        if (vn < 0) { impact = Math.max(impact, -vn); e.vx -= vn * hit.nx * 1.45; e.vy -= vn * hit.ny * 1.45; }
      }
      e.x = hit.x; e.y = hit.y;
    }
  }
  for (const t of world.trees) {
    const d = dist(e.x, e.y, t.x, t.y);
    if (d < r + 7 && d > 0.01) {
      const nx = (e.x - t.x) / d, ny = (e.y - t.y) / d;
      e.x += nx * (r + 7 - d); e.y += ny * (r + 7 - d);
      if (e.vx !== undefined) {
        const vn = e.vx * nx + e.vy * ny;
        if (vn < 0) { impact = Math.max(impact, -vn * 0.7); e.vx -= vn * nx * 1.3; e.vy -= vn * ny * 1.3; }
      }
    }
  }
  if (e.x < ISLAND_R.x + r) { e.x = ISLAND_R.x + r; if (e.vx < 0) e.vx = 0; }
  if (e.x > ISLAND_R.x + ISLAND_R.w - r) { e.x = ISLAND_R.x + ISLAND_R.w - r; if (e.vx > 0) e.vx = 0; }
  if (e.y < ISLAND_R.y + r) { e.y = ISLAND_R.y + r; if (e.vy < 0) e.vy = 0; }
  if (e.y > ISLAND_R.y + ISLAND_R.h - r) { e.y = ISLAND_R.y + ISLAND_R.h - r; if (e.vy > 0) e.vy = 0; }
  return impact;
}

function collideCar(car) {
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  const off = car.type.hl * 0.55;
  let impact = 0;
  for (const s of [1, -1]) {
    const px = car.x + fx * off * s, py = car.y + fy * off * s;
    const proxy = { x: px, y: py, vx: car.vx, vy: car.vy };
    const im = collideStatic(proxy, car.type.hw + 5);
    car.x += proxy.x - px; car.y += proxy.y - py;
    car.vx = proxy.vx; car.vy = proxy.vy;
    impact = Math.max(impact, im);
  }
  return impact;
}

function pointBlocked(x, y, r) {
  if (x < ISLAND_R.x + r || x > ISLAND_R.x + ISLAND_R.w - r || y < ISLAND_R.y + r || y > ISLAND_R.y + ISLAND_R.h - r) return true;
  if (world.buildings.some((b) => circleRectCollide(x, y, r, b))) return true;
  return world.trees.some((t) => dist(x, y, t.x, t.y) < r + 7);
}

function stepCar(car, ctrl, dt) {
  const t = car.type;
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  let fSpeed = car.vx * fx + car.vy * fy;
  let latX = car.vx - fx * fSpeed, latY = car.vy - fy * fSpeed;

  if (!car.dead) {
    if (ctrl.throttle > 0) fSpeed += t.accel * ctrl.throttle * dt;
    else if (ctrl.throttle < 0) {
      if (fSpeed > 30) fSpeed -= 540 * dt;
      else fSpeed = Math.max(fSpeed - t.accel * 0.7 * dt, -135);
    }
    if (ctrl.brake) fSpeed -= fSpeed * 2.4 * dt;
  }
  fSpeed -= fSpeed * (ctrl.throttle ? 0.35 : 0.9) * dt;
  const topCap = t.top * (car.health < 30 ? 0.55 : 1);
  fSpeed = clamp(fSpeed, -140, topCap);

  const authority = clamp(Math.abs(fSpeed) / 55, 0, 1);
  const turnDir = fSpeed >= 0 ? 1 : -1;
  car.angle += ctrl.steer * 2.3 * authority * turnDir * dt * (ctrl.brake ? 1.4 : 1);

  const latDecay = Math.exp(-(ctrl.brake ? 1.7 : 9) * dt);
  latX *= latDecay; latY *= latDecay;

  const nfx = Math.cos(car.angle), nfy = Math.sin(car.angle);
  car.vx = nfx * fSpeed + latX;
  car.vy = nfy * fSpeed + latY;
  car.x += car.vx * dt;
  car.y += car.vy * dt;

  // Skid marks + tyre smoke when sliding hard
  if (ctrl.brake && Math.abs(fSpeed) > 175 && !car.dead) {
    const bx = car.x - nfx * car.type.hl * 0.7, by = car.y - nfy * car.type.hl * 0.7;
    const px = -nfy, py = nfx;
    for (const s of [1, -1]) {
      const wx = bx + px * car.type.hw * s, wy = by + py * car.type.hw * s;
      const key = s === 1 ? 'skidL' : 'skidR';
      if (car[key]) G.skids.push({ x1: car[key].x, y1: car[key].y, x2: wx, y2: wy, a: 0.45 });
      car[key] = { x: wx, y: wy };
    }
    if (G.skids.length > 700) G.skids.splice(0, G.skids.length - 700);
    if (fxRng() < 0.4) spawnParticles(bx, by, 1, '200,200,200', 30, 0.6, 6);
  } else { car.skidL = null; car.skidR = null; }

  const impact = collideCar(car);
  if (impact > 120) crashDamage(car, impact);
  return fSpeed;
}

function crashDamage(car, impact) {
  const dmg = (impact - 105) * 0.15;
  car.health -= dmg;
  spawnParticles(car.x, car.y, 5, '255,180,80', 110, 0.5, 5);
  const pp = playerPos();
  if (dist(car.x, car.y, pp.x, pp.y) < 720) sfx.crash(impact > 250);
  if (G.player.car === car) {
    G.shake = Math.min(15, (impact - 100) * 0.045);
    if (impact > 215) damagePlayer((impact - 200) * 0.055);
  }
  if (car.health <= 0 && !car.dead) {
    car.dead = true; car.health = 0;
    if (G.player.car === car) showBanner('WRECKED', 'Your ride is dead — find another');
  }
}

function carCarCollisions(dt) {
  const cars = G.cars;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const rr = (a.type.hl + b.type.hl) * 0.8;
      const d = dist(a.x, a.y, b.x, b.y);
      if (d >= rr || d === 0) continue;
      const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
      const overlap = rr - d;
      const aMove = a.parked ? 0.25 : 1, bMove = b.parked ? 0.25 : 1;
      const tot = aMove + bMove;
      a.x -= nx * overlap * (aMove / tot); a.y -= ny * overlap * (aMove / tot);
      b.x += nx * overlap * (bMove / tot); b.y += ny * overlap * (bMove / tot);
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing > 0) {
        const bounce = closing * 0.35;
        a.vx -= nx * bounce * (aMove / tot) * 2 * 0.5; a.vy -= ny * bounce * (aMove / tot);
        b.vx += nx * bounce * (bMove / tot); b.vy += ny * bounce * (bMove / tot);
        if (closing > 120) {
          crashDamage(a, closing);
          crashDamage(b, closing);
          if ((a.driver === 'player' || b.driver === 'player')) commitCrime(0.4);
        }
      }
      void dt;
    }
  }
}

// ---------------- Particles ----------------
function spawnParticles(x, y, n, colour, spread = 90, life = 0.7, size = 5) {
  for (let i = 0; i < n; i++) {
    const a = fxRng() * Math.PI * 2, s = fxRng() * spread;
    G.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20,
      life: life * (0.5 + fxRng() * 0.8), maxLife: life, size: size * (0.6 + fxRng() * 0.8), colour,
    });
  }
  if (G.particles.length > 500) G.particles.splice(0, G.particles.length - 500);
}
function updateParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life -= dt;
    if (p.life <= 0) { G.particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= (1 - 1.6 * dt); p.vy *= (1 - 1.6 * dt);
  }
  for (const s of G.skids) s.a -= dt * 0.015;
  while (G.skids.length && G.skids[0].a <= 0) G.skids.shift();
}

// ---------------- Crime & wanted ----------------
function commitCrime(points) {
  const pp = playerPos();
  const witnessed =
    G.police.some((p) => dist(p.x, p.y, pp.x, pp.y) < 440) ||
    G.peds.some((pd) => pd.down <= 0 && dist(pd.x, pd.y, pp.x, pp.y) < 215);
  if (witnessed) {
    G.heat = Math.min(5, G.heat + points);
    G.lastCrimeT = G.time;
    G.lastSeenT = G.time;
  }
}

function computeSeen() {
  const pp = playerPos();
  for (const p of G.police) if (dist(p.x, p.y, pp.x, pp.y) < 470) return true;
  if (G.heli.active && dist(G.heli.lightX, G.heli.lightY, pp.x, pp.y) < 135) return true;
  return false;
}

function updateWanted(dt) {
  if (computeSeen()) G.lastSeenT = G.time;
  if (G.heat > 0 && G.time - G.lastSeenT > 3.5) G.heat = Math.max(0, G.heat - 0.30 * dt);
  const s = stars();

  if (s === 0) {
    // Police give up and drive off as ordinary traffic.
    for (const pc of [...G.police]) {
      pc.driver = 'traffic';
      pc.route = nearestRoadRoute(pc.x, pc.y);
      G.police.splice(G.police.indexOf(pc), 1);
    }
    return;
  }
  const target = Math.min(2 + s, 7);
  G.policeSpawnT = (G.policeSpawnT || 0) - dt;
  if (G.police.length < target && G.policeSpawnT <= 0) {
    G.policeSpawnT = spawnPoliceCar() ? 1.1 : 0.45;
  }
  // Despawn distant units
  const pp = playerPos();
  for (let i = G.police.length - 1; i >= 0; i--) {
    if (dist(G.police[i].x, G.police[i].y, pp.x, pp.y) > 1500) {
      removeCar(G.police[i]);
      G.police.splice(i, 1);
    }
  }
}

function removeCar(car) {
  const i = G.cars.indexOf(car);
  if (i >= 0) G.cars.splice(i, 1);
  if (G.vanRef === car) G.vanRef = null;
}

function updateHeli(dt) {
  const h = G.heli;
  const want = stars() >= 4;
  if (want && !h.active) {
    const pp = playerPos();
    h.x = pp.x + 300; h.y = pp.y - 300; h.lightX = pp.x; h.lightY = pp.y;
  }
  h.active = want;
  if (!want) return;
  const pp = playerPos();
  h.angle += dt * 0.55;
  h.rotor += dt * 42;
  const tx = pp.x + Math.cos(h.angle) * 135, ty = pp.y + Math.sin(h.angle) * 135;
  const k = 1 - Math.exp(-1.7 * dt);
  h.x += (tx - h.x) * k; h.y += (ty - h.y) * k;
  const kl = 1 - Math.exp(-2.1 * dt);
  h.lightX += (pp.x - h.lightX) * kl;
  h.lightY += (pp.y - h.lightY) * kl;
}

function updateBusted(dt) {
  const p = G.player;
  if (stars() === 0) { G.bustedMeter = Math.max(0, G.bustedMeter - dt * 2); return; }
  let pinned = false;
  if (p.car) {
    if (speedOf(p.car) < 26 && G.police.some((pc) => dist(pc.x, pc.y, p.car.x, p.car.y) < 54)) pinned = true;
  } else if (G.police.some((pc) => dist(pc.x, pc.y, p.x, p.y) < 50)) pinned = true;
  if (pinned) G.bustedMeter += dt / (p.car ? 2.4 : 1.6);
  else G.bustedMeter = Math.max(0, G.bustedMeter - dt * 1.4);
  if (G.bustedMeter >= 1) endRun('busted');
}

function damagePlayer(amount) {
  const p = G.player;
  p.health -= amount;
  G.lastDamageT = G.time;
  if (p.health <= 0) { p.health = 0; endRun('wasted'); }
}

// ---------------- AI control ----------------
function trafficControl(car, dt) {
  let r = car.route;
  if (!r) { car.route = nearestRoadRoute(car.x, car.y); r = car.route; }
  car.decideCd -= dt;
  const crossings = r.axis === 'y' ? ROADS_Y : ROADS_X;
  const along = r.axis === 'y' ? car.y : car.x;
  if (car.decideCd <= 0) {
    for (const cLine of crossings) {
      if (Math.abs(along - cLine) < 30) {
        car.decideCd = 2.5;
        if (fxRng() < 0.42) {
          car.route = { axis: r.axis === 'y' ? 'x' : 'y', line: cLine, dir: fxRng() < 0.5 ? 1 : -1 };
          r = car.route;
        }
        break;
      }
    }
  }
  const lo = (r.axis === 'y' ? LAND.y : LAND.x) + 120;
  const hi = (r.axis === 'y' ? LAND.y + LAND.h : LAND.x + LAND.w) - 120;
  const alongNow = r.axis === 'y' ? car.y : car.x;
  if ((r.dir > 0 && alongNow > hi) || (r.dir < 0 && alongNow < lo)) r.dir *= -1;

  let wx, wy;
  if (r.axis === 'y') { wx = laneCoord(r); wy = car.y + r.dir * 300; }
  else { wx = car.x + r.dir * 300; wy = laneCoord(r); }
  const desired = angleTo(car.x, car.y, wx, wy);
  const diff = angleDiff(car.angle, desired);
  let steer = clamp(diff * 2.2, -1, 1);
  let throttle = 0.8, brake = false;

  const fx = car.x + Math.cos(car.angle) * 68, fy = car.y + Math.sin(car.angle) * 68;
  for (const o of G.cars) {
    if (o !== car && dist(o.x, o.y, fx, fy) < 42) {
      throttle = 0;
      if (dist(o.x, o.y, car.x, car.y) < 64) brake = true;
      break;
    }
  }
  if (!G.player.car && dist(G.player.x, G.player.y, fx, fy) < 38) throttle = 0;
  if (Math.abs(diff) > 0.9) throttle = Math.min(throttle, 0.35);
  void steer;
  return { throttle, steer, brake };
}

function policeControl(car, dt) {
  const pp = playerPos();
  const desired = angleTo(car.x, car.y, pp.x, pp.y);
  const diff = angleDiff(car.angle, desired);
  let steer = clamp(diff * 2.6, -1, 1);
  let throttle = 1;
  const d = dist(car.x, car.y, pp.x, pp.y);
  if (car.reverseT > 0) {
    car.reverseT -= dt;
    return { throttle: -1, steer: -steer, brake: false };
  }
  if (speedOf(car) < 12 && Math.abs(diff) > 0.45) {
    car.stuckT += dt;
    if (car.stuckT > 1.1) { car.reverseT = 0.55; car.stuckT = 0; }
  } else car.stuckT = Math.max(0, car.stuckT - dt * 2);
  if (Math.abs(diff) > 2.3 && d < 130) throttle = -1;
  // Crude building avoidance: if the road ahead is walled, bias the steering.
  const ax = car.x + Math.cos(car.angle) * 74, ay = car.y + Math.sin(car.angle) * 74;
  if (world.buildings.some((b) => pointInRect(ax, ay, b, 0))) steer += car.id % 2 === 0 ? 0.85 : -0.85;
  return { throttle, steer: clamp(steer, -1, 1), brake: false };
}

function playerCarControl() {
  return {
    throttle: (input.up ? 1 : 0) + (input.downKey ? -1 : 0),
    steer: (input.right ? 1 : 0) - (input.left ? 1 : 0),
    brake: input.down(' '),
  };
}

// ---------------- Pedestrians ----------------
function updatePed(ped, dt) {
  if (ped.down > 0) { ped.down -= dt; return; }
  let threat = null;
  for (const c of G.cars) {
    if ((c.driver === 'player' || c.driver === 'police') && speedOf(c) > 55 && dist(c.x, c.y, ped.x, ped.y) < 96) { threat = c; break; }
  }
  if (threat) { ped.state = 'flee'; ped.fleeT = 2.2; ped.tx = threat.x; ped.ty = threat.y; }

  let mvx = 0, mvy = 0, spd = 0;
  if (ped.state === 'flee') {
    ped.fleeT -= dt;
    const a = angleTo(ped.tx, ped.ty, ped.x, ped.y);
    mvx = Math.cos(a); mvy = Math.sin(a); spd = 218;
    if (ped.fleeT <= 0) { ped.state = 'walk'; ped.target = null; }
  } else {
    ped.timer -= dt;
    if (!ped.target || dist(ped.x, ped.y, ped.target.x, ped.target.y) < 14 || ped.timer <= 0) {
      ped.timer = 6;
      for (let i = 0; i < 8; i++) {
        const cx = ped.x + (fxRng() - 0.5) * 560, cy = ped.y + (fxRng() - 0.5) * 560;
        if (cx < LAND.x + 16 || cx > LAND.x + LAND.w - 16 || cy < LAND.y + 16 || cy > LAND.y + LAND.h - 16) continue;
        if (!isOnRoad(cx, cy, 36)) continue;
        if (world.buildings.some((b) => pointInRect(cx, cy, b, 6))) continue;
        ped.target = { x: cx, y: cy };
        break;
      }
    }
    if (ped.target) {
      const a = angleTo(ped.x, ped.y, ped.target.x, ped.target.y);
      mvx = Math.cos(a); mvy = Math.sin(a); spd = 76;
    }
  }
  if (spd > 0) {
    ped.angle = angleLerp(ped.angle, Math.atan2(mvy, mvx), 0.25);
    ped.x += mvx * spd * dt;
    ped.y += mvy * spd * dt;
    ped.walkPhase += dt * spd * 0.055;
    collideStatic(ped, 9);
  }
}

// ---------------- Player & cars update ----------------
function stepPlayerOnFoot(dt) {
  const p = G.player;
  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let my = (input.downKey ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(mx, my);
  if (len > 0) {
    mx /= len; my /= len;
    const spd = input.down('shift') ? 248 : 170;
    p.x += mx * spd * dt;
    p.y += my * spd * dt;
    p.angle = Math.atan2(my, mx);
    p.walkPhase += dt * spd * 0.06;
    collideStatic(p, 10);
    // Cars push the player gently; fast cars hurt.
    for (const c of G.cars) {
      const d = dist(p.x, p.y, c.x, c.y);
      const rr = c.type.hl * 0.78 + 10;
      if (d < rr && d > 0.01) {
        const nx = (p.x - c.x) / d, ny = (p.y - c.y) / d;
        p.x = c.x + nx * rr; p.y = c.y + ny * rr;
        const cs = speedOf(c);
        if (cs > 170 && c.driver !== 'player') {
          damagePlayer(9 + cs * 0.03);
          p.x += c.vx * 0.06; p.y += c.vy * 0.06;
          sfx.crash(false);
        }
      }
    }
  }
}

function tryEnterExit() {
  const p = G.player;
  if (p.car) {
    const c = p.car;
    const sx = Math.cos(c.angle + Math.PI / 2), sy = Math.sin(c.angle + Math.PI / 2);
    let ex = c.x + sx * 32, ey = c.y + sy * 32;
    if (pointBlocked(ex, ey, 10)) { ex = c.x - sx * 32; ey = c.y - sy * 32; }
    p.x = ex; p.y = ey; p.angle = c.angle;
    c.driver = c.wasTraffic ? 'traffic' : null;
    if (c.wasTraffic && !c.route) c.route = nearestRoadRoute(c.x, c.y);
    p.car = null;
    sfx.door();
    return;
  }
  // Find the nearest enterable car
  let best = null, bestD = 58;
  for (const c of G.cars) {
    const d = dist(p.x, p.y, c.x, c.y);
    if (d < bestD) { best = c; bestD = d; }
  }
  if (!best) return;
  if (best.dead) { showBanner('WRECKED', 'That car is going nowhere'); return; }
  const wasOwned = !!best.ownedType;
  best.wasTraffic = best.driver === 'traffic';
  best.driver = 'player';
  best.parked = false;
  p.car = best;
  sfx.door();
  if (!wasOwned) commitCrime(1);
}

function updateCars(dt) {
  for (const car of [...G.cars]) {
    if (car.driver === 'player') stepCar(car, playerCarControl(), dt);
    else if (car.driver === 'traffic') stepCar(car, trafficControl(car, dt), dt);
    else if (car.driver === 'police') stepCar(car, policeControl(car, dt), dt);
    else {
      // Parked / driverless: friction to a stop.
      car.vx *= (1 - 3 * dt); car.vy *= (1 - 3 * dt);
      car.x += car.vx * dt; car.y += car.vy * dt;
      if (speedOf(car) > 4) collideCar(car);
    }
    // Smoke from damaged engines
    if (car.health < 38 && !car.dead) {
      car.smokeT -= dt;
      if (car.smokeT <= 0) { car.smokeT = 0.12; spawnParticles(car.x, car.y - 4, 1, '90,90,90', 16, 1.1, 8); }
    } else if (car.dead) {
      car.smokeT -= dt;
      if (car.smokeT <= 0) { car.smokeT = 0.2; spawnParticles(car.x, car.y - 4, 1, '60,60,60', 12, 1.3, 9); }
    }
    // Running over pedestrians
    if (speedOf(car) > 45) {
      for (const ped of G.peds) {
        if (ped.down > 0) continue;
        if (dist(car.x, car.y, ped.x, ped.y) < car.type.hl * 0.8 + 8) {
          ped.down = 5;
          spawnParticles(ped.x, ped.y, 4, '200,60,50', 60, 0.5, 4);
          if (car.driver === 'player') { commitCrime(1); G.shake = Math.min(8, G.shake + 3); sfx.crash(false); }
        }
      }
    }
  }
  carCarCollisions(dt);
}

// ---------------- Ambient population ----------------
function updateAmbient(dt) {
  G.ambientT = (G.ambientT || 0) - dt;
  if (G.ambientT > 0) return;
  G.ambientT = 0.8;
  const pp = playerPos();
  const trafficCount = G.cars.filter((c) => c.driver === 'traffic').length;
  if (trafficCount < 13) spawnTrafficCar();
  if (G.peds.length < 16) spawnAmbientPeds();
  for (let i = G.cars.length - 1; i >= 0; i--) {
    const c = G.cars[i];
    if ((c.driver === 'traffic' || (!c.driver && !c.parked && !c.ownedType)) && dist(c.x, c.y, pp.x, pp.y) > 1550) removeCar(c);
  }
  for (let i = G.peds.length - 1; i >= 0; i--) {
    if (dist(G.peds[i].x, G.peds[i].y, pp.x, pp.y) > 1250) G.peds.splice(i, 1);
  }
}

// ---------------- Missions ----------------
function currentMissionDef() { return MISSIONS[G.missionIdx] || null; }
function currentStage() {
  const m = currentMissionDef();
  if (!m || !G.mission) return null;
  return m.stages[G.mission.stageIdx] || null;
}

function refreshObjective() {
  if (!G.mission) {
    G.objective = G.storyDone
      ? 'Free roam — Crescent Keys is yours'
      : 'Free roam — visit the gold marker for work';
    return;
  }
  const st = currentStage();
  if (!st) return;
  let label = st.label;
  if (st.type === 'collect') label = label.replace(/\(\d+\/\d+\)/, `(${G.mission.got.size}/${st.points.length})`);
  if (st.type === 'race') label = `${st.label} (${G.mission.raceIdx}/${st.points.length})`;
  if (st.type === 'rob' && G.mission.holdT > 0.1) label = `${st.label} — hold on… ${Math.max(0, Math.ceil(st.holdTime - G.mission.holdT))}s`;
  G.objective = label;
}

function missionTarget() {
  if (G.mission) {
    const st = currentStage();
    if (!st) return null;
    if (st.type === 'collect') {
      let best = null, bd = Infinity;
      const pp = playerPos();
      st.points.forEach((pt, i) => {
        if (G.mission.got.has(i)) return;
        const d = dist(pp.x, pp.y, pt.x, pt.y);
        if (d < bd) { bd = d; best = pt; }
      });
      return best;
    }
    if (st.type === 'race') return st.points[G.mission.raceIdx] || null;
    if (st.type === 'shake') return null;
    return { x: st.x, y: st.y };
  }
  const m = currentMissionDef();
  return m ? { x: m.giverPos.x, y: m.giverPos.y } : null;
}

function initStage() {
  const st = currentStage();
  const ms = G.mission;
  ms.timer = st && st.time ? st.time : 0;
  ms.holdT = 0;
  ms.got = new Set();
  ms.raceIdx = 0;
  if (st && st.type === 'pickupvan') {
    if (G.vanRef) removeCar(G.vanRef);
    G.vanRef = makeCar('van', st.x, st.y, Math.PI, { parked: true, colour: '#e8c832' });
  }
  if (st && st.type === 'deliver' && st.wanted) G.heat = Math.max(G.heat, st.wanted);
  refreshObjective();
}

function stageDone() {
  const m = currentMissionDef();
  G.mission.stageIdx++;
  sfx.blip();
  if (G.mission.stageIdx >= m.stages.length) missionComplete();
  else { initStage(); showBanner('OBJECTIVE UPDATED', currentStage().label); }
}

function missionComplete() {
  const m = currentMissionDef();
  G.cash += m.pay;
  sfx.success();
  showBanner('MISSION COMPLETE', `${m.title} — +$${m.pay}`);
  G.mission = null;
  G.missionIdx++;
  if (G.missionIdx >= MISSIONS.length) { G.storyDone = true; G.storyBannerT = 5; }
  G.dialogue = { lines: [{ name: m.giver, text: m.outro }], idx: 0, onDone: () => { G.screen = 'play'; } };
  G.screen = 'dialogue';
  showDialogue();
  saveGame();
  refreshObjective();
}

function missionFail(reason) {
  if (!G.mission) return;
  sfx.fail();
  showBanner('MISSION FAILED', reason);
  if (G.vanRef && G.vanRef.driver !== 'player') removeCar(G.vanRef);
  G.mission = null;
  refreshObjective();
}

function updateMission(dt) {
  if (!G.mission) return;
  const st = currentStage();
  if (!st) return;
  const ms = G.mission;
  const pp = playerPos();
  if (st.time) {
    ms.timer -= dt;
    if (ms.timer <= 0) { missionFail('Out of time'); return; }
  }
  switch (st.type) {
    case 'goto':
    case 'timedgoto':
      if (dist(pp.x, pp.y, st.x, st.y) < 62) stageDone();
      break;
    case 'collect': {
      let changed = false;
      st.points.forEach((pt, i) => {
        if (!ms.got.has(i) && dist(pp.x, pp.y, pt.x, pt.y) < 56) {
          ms.got.add(i);
          sfx.pickup();
          spawnParticles(pt.x, pt.y, 8, '255,215,94', 70, 0.6, 5);
          changed = true;
        }
      });
      if (changed) refreshObjective();
      if (ms.got.size >= st.points.length) stageDone();
      break;
    }
    case 'race': {
      const pt = st.points[ms.raceIdx];
      if (pt && dist(pp.x, pp.y, pt.x, pt.y) < 76) {
        ms.raceIdx++;
        sfx.pickup();
        refreshObjective();
        if (ms.raceIdx >= st.points.length) stageDone();
      }
      break;
    }
    case 'rob': {
      if (dist(pp.x, pp.y, st.x, st.y) < 72) {
        ms.holdT += dt;
        if (fxRng() < dt * 2.2) spawnParticles(st.x, st.y - 12, 1, '255,215,94', 42, 0.5, 4);
        if (ms.holdT >= st.holdTime) {
          G.heat = Math.max(G.heat, st.wanted || 2);
          G.lastSeenT = G.time;
          sfx.cash();
          stageDone();
          return;
        }
      } else ms.holdT = Math.max(0, ms.holdT - dt * 1.5);
      refreshObjective();
      break;
    }
    case 'shake':
      if (G.heat <= 0.02) stageDone();
      break;
    case 'pickupvan':
      if (G.vanRef && G.vanRef.dead) { missionFail('The cargo van was destroyed'); return; }
      if (G.vanRef && G.player.car === G.vanRef) stageDone();
      break;
    case 'deliver':
      if (G.vanRef && G.vanRef.dead) { missionFail('The cargo van was destroyed'); return; }
      if (G.vanRef && G.player.car === G.vanRef && dist(pp.x, pp.y, st.x, st.y) < 86) {
        if (G.vanRef.health / G.vanRef.maxHealth >= st.minHealth) stageDone();
        else missionFail('The van arrived in too many pieces');
      }
      break;
  }
}

// ---------------- Dialogue & banners ----------------
function showDialogue() {
  const d = G.dialogue;
  if (!d) { dialogueEl.classList.add('hidden'); return; }
  const line = d.lines[d.idx];
  $('dlgName').textContent = line.name;
  $('dlgText').textContent = line.text;
  dialogueEl.classList.remove('hidden');
}
function advanceDialogue() {
  const d = G.dialogue;
  if (!d) return;
  sfx.blip();
  d.idx++;
  if (d.idx >= d.lines.length) {
    G.dialogue = null;
    dialogueEl.classList.add('hidden');
    if (d.onDone) d.onDone();
  } else showDialogue();
}

let bannerTimeout = null;
function showBanner(title, sub) {
  bannerEl.innerHTML = '';
  const t = document.createElement('div');
  t.textContent = title;
  bannerEl.appendChild(t);
  if (sub) {
    const s = document.createElement('div');
    s.style.cssText = 'font-size:19px;letter-spacing:1px;color:#e8eef5;font-weight:700;';
    s.textContent = sub;
    bannerEl.appendChild(s);
  }
  bannerEl.classList.remove('hidden');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => bannerEl.classList.add('hidden'), 2900);
}

// ---------------- Interactions ----------------
function computePrompt() {
  const p = G.player;
  G.prompt = '';
  G.interact = null;
  if (p.car) { G.prompt = 'E — exit car'; return; }
  const m = currentMissionDef();
  if (!G.mission && m && dist(p.x, p.y, m.giverPos.x, m.giverPos.y) < 66) {
    G.prompt = `F — talk to ${m.giver}`;
    G.interact = 'mission';
    return;
  }
  world.pois.dealerPads.forEach((pad, i) => {
    if (dist(p.x, p.y, pad.x, pad.y) < 80) {
      const typeId = DEALER_TYPES[i];
      const t = CAR_TYPES[typeId];
      if (G.ownedTypes.includes(typeId)) G.prompt = `${t.name} — yours is at the safehouse`;
      else { G.prompt = `F — buy the ${t.name} ($${t.price})`; G.interact = 'buy'; G.buyType = typeId; }
    }
  });
  if (G.interact || G.prompt) return;
  const sh = world.pois.safehouse;
  if (dist(p.x, p.y, sh.x, sh.y) < 90) {
    G.prompt = 'F — safehouse: save, heal, clear heat';
    G.interact = 'safehouse';
    return;
  }
  let best = null, bestD = 58;
  for (const c of G.cars) {
    const d = dist(p.x, p.y, c.x, c.y);
    if (d < bestD) { best = c; bestD = d; }
  }
  if (best) G.prompt = best.dead ? 'That car is wrecked' : 'E — enter car';
}

function doInteract() {
  if (G.interact === 'mission') {
    const m = currentMissionDef();
    G.dialogue = {
      lines: m.intro.map((t) => ({ name: m.giver, text: t })),
      idx: 0,
      onDone: () => { G.mission = { stageIdx: 0 }; initStage(); G.screen = 'play'; },
    };
    G.screen = 'dialogue';
    showDialogue();
  } else if (G.interact === 'buy') {
    const t = CAR_TYPES[G.buyType];
    if (G.cash >= t.price) {
      G.cash -= t.price;
      G.ownedTypes.push(G.buyType);
      spawnOwnedCars();
      sfx.cash();
      showBanner('PURCHASED', `${t.name} is waiting at your safehouse`);
      saveGame();
    } else {
      sfx.fail();
      showBanner('NOT ENOUGH CASH', `${t.name} costs $${t.price}`);
    }
  } else if (G.interact === 'safehouse') {
    G.heat = 0;
    G.player.health = 100;
    sfx.success();
    showBanner('SAFEHOUSE', 'Saved — healed up and the heat is gone');
    saveGame();
  }
}

// ---------------- Busted / wasted ----------------
function endRun(kind) {
  if (G.screen !== 'play') return;
  if (G.mission) {
    if (G.vanRef && G.vanRef.driver !== 'player') removeCar(G.vanRef);
    G.mission = null;
  }
  const penalty = Math.floor(G.cash * (kind === 'busted' ? 0.10 : 0.05));
  G.cash -= penalty;
  sfx.setSiren(false, 0);
  sfx.fail();
  $('endTitle').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  $('endText').textContent = kind === 'busted'
    ? `The APD finally cornered you. Bail and paperwork cost you $${penalty}. You wake up at the safehouse.`
    : `You wake up at the safehouse, stitched and sore. The clinic bill came to $${penalty}.`;
  endScreen.classList.remove('hidden');
  G.screen = 'end';
  refreshObjective();
}

function respawn() {
  const p = G.player;
  if (p.car) { p.car.driver = null; p.car = null; }
  for (const pc of [...G.police]) removeCar(pc);
  G.police = [];
  G.heli.active = false;
  G.heat = 0;
  G.bustedMeter = 0;
  p.health = 100;
  p.x = world.pois.spawn.x;
  p.y = world.pois.spawn.y;
  endScreen.classList.add('hidden');
  G.screen = 'play';
  saveGame();
}

// ---------------- Update ----------------
function update(dt) {
  G.time += dt;
  G.timeOfDay = (G.timeOfDay + dt / 60) % 24;
  G.shake = Math.max(0, G.shake - dt * 26);
  if (G.storyBannerT > 0) {
    G.storyBannerT -= dt;
    if (G.storyBannerT <= 0) showBanner('STORY COMPLETE', 'Crescent Keys is yours — the island keeps turning');
  }
  if (!G.player.car) stepPlayerOnFoot(dt);
  updateCars(dt);
  for (const ped of G.peds) updatePed(ped, dt);
  updateHeli(dt);
  updateWanted(dt);
  updateBusted(dt);
  if (G.screen === 'play') updateMission(dt);
  updateAmbient(dt);
  updateParticles(dt);
  if (G.time - G.lastDamageT > 8 && G.player.health > 0) {
    G.player.health = Math.min(100, G.player.health + 2.4 * dt);
  }
  computePrompt();
  if (input.hit('e')) tryEnterExit();
  if (input.hit('f') && G.interact) doInteract();
  if (input.hit('m')) {
    G.muted = !G.muted;
    sfx.muted = G.muted;
    showBanner(G.muted ? 'SOUND OFF' : 'SOUND ON', '');
  }
  if (input.hit('p', 'escape', 'h')) openPause();
  const pp = playerPos();
  let sirenNear = false;
  for (const pc of G.police) if (dist(pc.x, pc.y, pp.x, pp.y) < 520) { sirenNear = true; break; }
  sfx.setSiren(sirenNear && stars() > 0, 0.032);
  refreshObjective();
}

// ---------------- Rendering ----------------
let CAM = { x: 0, y: 0, w: 1280, h: 720 };
function getCam() {
  const pp = playerPos();
  const w = canvas.width, h = canvas.height;
  const sx = (Math.random() - 0.5) * G.shake, sy = (Math.random() - 0.5) * G.shake;
  return {
    x: clamp(pp.x - w / 2 + sx, 0, Math.max(0, WORLD_W - w)),
    y: clamp(pp.y - h / 2 + sy, 0, Math.max(0, WORLD_H - h)),
    w, h,
  };
}

function nightFactor() {
  const day = clamp(Math.sin(((G.timeOfDay - 6) / 12) * Math.PI), 0, 1);
  return clamp(1 - day * 1.7, 0, 1);
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawMarkerPin(x, y, label) {
  const sx = x - CAM.x, sy = y - CAM.y;
  if (sx < -60 || sy < -60 || sx > CAM.w + 60 || sy > CAM.h + 60) return;
  const pulse = 1 + Math.sin(G.time * 4) * 0.13;
  ctx.strokeStyle = '#ffd75e';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(sx, sy, 26 * pulse, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,215,94,0.16)';
  ctx.beginPath(); ctx.arc(sx, sy, 26 * pulse, 0, Math.PI * 2); ctx.fill();
  const bob = Math.sin(G.time * 3) * 5;
  ctx.fillStyle = '#ffd75e';
  ctx.font = '900 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, sx, sy - 40 + bob);
}

function drawMarkers() {
  const st = currentStage();
  if (G.mission && st) {
    if (st.type === 'collect') {
      st.points.forEach((pt, i) => {
        if (G.mission.got.has(i)) return;
        const sx = pt.x - CAM.x, sy = pt.y - CAM.y;
        ctx.fillStyle = '#2e7d32';
        ctx.fillRect(sx - 11, sy - 9, 22, 18);
        ctx.fillStyle = '#ffd75e';
        ctx.font = '900 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('$', sx, sy + 5);
      });
    }
    if (st.type === 'race') {
      st.points.forEach((pt, i) => {
        const cur = i === G.mission.raceIdx;
        const sx = pt.x - CAM.x, sy = pt.y - CAM.y;
        ctx.strokeStyle = cur ? '#ffd75e' : 'rgba(255,215,94,0.3)';
        ctx.lineWidth = cur ? 4 : 2;
        ctx.beginPath(); ctx.arc(sx, sy, cur ? 34 : 24, 0, Math.PI * 2); ctx.stroke();
        if (cur) {
          ctx.fillStyle = 'rgba(255,215,94,0.25)';
          ctx.fillRect(sx - 3, sy - 130, 6, 130);
        }
      });
    }
    if (st.type === 'rob') {
      const sx = st.x - CAM.x, sy = st.y - CAM.y;
      ctx.strokeStyle = 'rgba(255,215,94,0.8)';
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx, sy, 72, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      if (G.mission.holdT > 0) {
        ctx.strokeStyle = '#57e389';
        ctx.beginPath(); ctx.arc(sx, sy, 60, -Math.PI / 2, -Math.PI / 2 + (G.mission.holdT / st.holdTime) * Math.PI * 2); ctx.stroke();
      }
    }
  }
  const t = missionTarget();
  if (t) drawMarkerPin(t.x, t.y, G.mission ? '▼' : '!');
  // POI signs
  const sh = world.pois.safehouse;
  ctx.fillStyle = '#57e389';
  ctx.font = '900 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⌂ SAFEHOUSE', sh.x - CAM.x, (sh.y - CAM.y) - 58);
  ctx.fillStyle = '#ffd75e';
  ctx.fillText("$ MARV'S MOTORS", world.pois.dealer.x - CAM.x, (world.pois.dealer.y - CAM.y) - 92);
}

function drawCar(c) {
  const sx = c.x - CAM.x, sy = c.y - CAM.y;
  if (sx < -90 || sy < -90 || sx > CAM.w + 90 || sy > CAM.h + 90) return;
  const hl = c.type.hl, hw = c.type.hw;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(c.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  rr(-hl + 3, -hw + 4, hl * 2, hw * 2, 6); ctx.fill();
  ctx.fillStyle = c.dead ? '#2b2b30' : c.colour;
  rr(-hl, -hw, hl * 2, hw * 2, 6); ctx.fill();
  if (c.typeId === 'police') {
    ctx.fillStyle = '#22252a';
    ctx.fillRect(-hl, -hw, 9, hw * 2);
    ctx.fillRect(hl - 9, -hw, 9, hw * 2);
    const flash = Math.sin(G.time * 11 + c.sirenPhase) > 0;
    ctx.fillStyle = flash ? '#ff3b30' : '#7a0d08';
    ctx.fillRect(-3, -hw + 1, 6, hw - 1);
    ctx.fillStyle = flash ? '#0d2a7a' : '#304ffe';
    ctx.fillRect(-3, 0, 6, hw - 1);
  }
  if (c.typeId === 'taxi') {
    ctx.fillStyle = '#fff8dc';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.fillStyle = '#222';
    ctx.font = '700 8px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('T', 0, 3);
  }
  ctx.fillStyle = 'rgba(18,24,32,0.92)';
  if (c.typeId === 'van') {
    rr(hl * 0.18, -hw + 3, hl * 0.62, hw * 2 - 6, 3); ctx.fill();
    ctx.fillStyle = 'rgba(140,200,235,0.5)';
    ctx.fillRect(hl * 0.62, -hw + 3, 4, hw * 2 - 6);
  } else {
    rr(-hl * 0.3, -hw + 3, hl * 0.82, hw * 2 - 6, 4); ctx.fill();
    ctx.fillStyle = 'rgba(140,200,235,0.55)';
    ctx.fillRect(hl * 0.3, -hw + 3, 5, hw * 2 - 6);
    ctx.fillRect(-hl * 0.34, -hw + 3, 4, hw * 2 - 6);
  }
  ctx.fillStyle = '#121418';
  ctx.fillRect(-hl + 4, -hw - 2, 11, 4);
  ctx.fillRect(-hl + 4, hw - 2, 11, 4);
  ctx.fillRect(hl - 15, -hw - 2, 11, 4);
  ctx.fillRect(hl - 15, hw - 2, 11, 4);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(hl - 2, -hw + 2, 3, 5);
  ctx.fillRect(hl - 2, hw - 7, 3, 5);
  ctx.fillStyle = '#c0272d';
  ctx.fillRect(-hl - 1, -hw + 2, 3, 5);
  ctx.fillRect(-hl - 1, hw - 7, 3, 5);
  if (c.health < 55 && !c.dead) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(-hl * 0.6, -hw, hl * 0.55, 7);
  }
  ctx.restore();
}

function drawPed(ped) {
  const sx = ped.x - CAM.x, sy = ped.y - CAM.y;
  if (sx < -30 || sy < -30 || sx > CAM.w + 30 || sy > CAM.h + 30) return;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(sx + 2, sy + 3, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(sx, sy);
  if (ped.down > 0) {
    ctx.rotate(Math.PI / 2);
    ctx.globalAlpha = 0.75;
  }
  const lp = Math.sin(ped.walkPhase) * 3.4;
  ctx.fillStyle = '#2c3440';
  ctx.fillRect(-2 + lp * 0.4, 3, 3.4, 6);
  ctx.fillRect(-2 - lp * 0.4, 3, 3.4, 6);
  ctx.fillStyle = ped.colour;
  ctx.beginPath(); ctx.arc(0, 0, 6.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath(); ctx.arc(Math.cos(ped.angle) * 2.4, Math.sin(ped.angle) * 2.4 - 1, 3.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawPlayerFigure() {
  const p = G.player;
  if (p.car) return;
  const sx = p.x - CAM.x, sy = p.y - CAM.y;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sx, sy, 15 + Math.sin(G.time * 3) * 1.6, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(sx + 2, sy + 4, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  const lp = Math.sin(p.walkPhase) * 3.6;
  ctx.fillStyle = '#1d2733';
  ctx.fillRect(sx - 2 + lp * 0.4, sy + 3, 3.6, 6.4);
  ctx.fillRect(sx - 2 - lp * 0.4, sy + 3, 3.6, 6.4);
  ctx.fillStyle = '#2456a6';
  ctx.beginPath(); ctx.arc(sx, sy, 7.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2c79b';
  ctx.beginPath(); ctx.arc(sx + Math.cos(p.angle) * 2.6, sy + Math.sin(p.angle) * 2.6 - 1, 4.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#14100a';
  ctx.beginPath(); ctx.arc(sx + Math.cos(p.angle) * 2.6, sy + Math.sin(p.angle) * 2.6 - 3.4, 4.4, Math.PI, Math.PI * 2); ctx.fill();
}

function drawHeli() {
  const h = G.heli;
  if (!h.active) return;
  const lx = h.lightX - CAM.x, ly = h.lightY - CAM.y;
  // Searchlight beam + pool
  const hx = h.x - CAM.x, hy = h.y - CAM.y;
  ctx.strokeStyle = 'rgba(255,246,200,0.13)';
  ctx.lineWidth = 30;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(lx, ly); ctx.stroke();
  const g = ctx.createRadialGradient(lx, ly, 6, lx, ly, 96);
  g.addColorStop(0, 'rgba(255,246,200,0.4)');
  g.addColorStop(1, 'rgba(255,246,200,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(lx, ly, 96, 0, Math.PI * 2); ctx.fill();
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(hx + 52, hy + 60, 26, 10, 0.4, 0, Math.PI * 2); ctx.fill();
  // Body
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(Math.sin(h.angle) * 0.2);
  ctx.fillStyle = '#20242c';
  ctx.beginPath(); ctx.ellipse(0, 0, 30, 12.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-58, -3, 34, 6);
  ctx.fillStyle = '#3d5a76';
  ctx.beginPath(); ctx.ellipse(9, 0, 13, 8.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(220,230,240,0.85)';
  ctx.lineWidth = 3;
  const ra = h.rotor;
  ctx.beginPath();
  ctx.moveTo(Math.cos(ra) * 40, Math.sin(ra) * 9);
  ctx.lineTo(-Math.cos(ra) * 40, -Math.sin(ra) * 9);
  ctx.stroke();
  ctx.fillStyle = Math.sin(G.time * 9) > 0 ? '#ff3b30' : '#5a0d08';
  ctx.beginPath(); ctx.arc(-56, 0, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawHeadlightGlows(night) {
  for (const c of G.cars) {
    if (c.dead) continue;
    const sx = c.x - CAM.x, sy = c.y - CAM.y;
    if (sx < -140 || sy < -140 || sx > CAM.w + 140 || sy > CAM.h + 140) continue;
    const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
    const gx = sx + fx * (c.type.hl + 88), gy = sy + fy * (c.type.hl + 88);
    const g = ctx.createRadialGradient(gx, gy, 4, gx, gy, 105);
    g.addColorStop(0, `rgba(255,240,190,${0.17 * night})`);
    g.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(gx, gy, 105, 0, Math.PI * 2); ctx.fill();
  }
}

function drawMinimap() {
  const s = 0.036;
  const x = 16, y = 16;
  const mw = minimapBase.width, mh = minimapBase.height;
  ctx.fillStyle = 'rgba(8,12,18,0.8)';
  rr(x - 4, y - 4, mw + 8, mh + 8, 8); ctx.fill();
  ctx.drawImage(minimapBase, x, y);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, mw, mh);
  const blip = (wx, wy, colour, r) => {
    ctx.fillStyle = colour;
    ctx.beginPath(); ctx.arc(x + wx * s, y + wy * s, r, 0, Math.PI * 2); ctx.fill();
  };
  blip(world.pois.safehouse.x, world.pois.safehouse.y, '#57e389', 3.4);
  blip(world.pois.dealer.x, world.pois.dealer.y, '#ffd75e', 3.4);
  const t = missionTarget();
  if (t && Math.sin(G.time * 5) > -0.4) blip(t.x, t.y, '#ffd75e', 4.4);
  if (Math.sin(G.time * 8) > 0) for (const pc of G.police) blip(pc.x, pc.y, '#ff3b30', 3);
  const pp = playerPos();
  const pa = G.player.car ? G.player.car.angle : G.player.angle;
  ctx.save();
  ctx.translate(x + pp.x * s, y + pp.y * s);
  ctx.rotate(pa);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(7, 0); ctx.lineTo(-5, -4.4); ctx.lineTo(-5, 4.4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawHUD() {
  if (!G || G.screen === 'title') return;
  const w = canvas.width, h = canvas.height;
  // Cash + stars, top right
  ctx.textAlign = 'right';
  ctx.font = '800 25px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 5;
  ctx.fillText(`$${G.cash.toLocaleString('en-US')}`, w - 20, 38);
  const s = stars();
  ctx.font = '25px system-ui, sans-serif';
  for (let i = 0; i < 5; i++) {
    const filled = i < s;
    const partial = !filled && i === s && G.heat > s;
    ctx.fillStyle = filled ? '#ffd75e' : partial ? `rgba(255,215,94,${0.4 + 0.4 * Math.sin(G.time * 7)})` : 'rgba(255,255,255,0.22)';
    ctx.fillText('★', w - 20 - (4 - i) * 27, 70);
  }
  ctx.shadowBlur = 0;
  // Mission timer, top centre
  if (G.mission && currentStage() && currentStage().time) {
    const t = Math.max(0, G.mission.timer);
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60).toString().padStart(2, '0');
    ctx.textAlign = 'center';
    ctx.font = '800 30px system-ui, monospace';
    ctx.fillStyle = t < 15 ? (Math.sin(G.time * 9) > 0 ? '#ff5040' : '#ffffff') : '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 5;
    ctx.fillText(`${mm}:${ss}`, w / 2, 42);
    ctx.shadowBlur = 0;
  }
  // Health bars, bottom left
  const bx = 18, bw = 190;
  const bar = (yy, frac, colour, label) => {
    ctx.fillStyle = 'rgba(8,12,18,0.72)';
    rr(bx - 3, yy - 3, bw + 6, 17, 5); ctx.fill();
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(bx, yy, bw, 11);
    ctx.fillStyle = colour;
    ctx.fillRect(bx, yy, bw * clamp(frac, 0, 1), 11);
    ctx.fillStyle = '#dfe7ee';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, bx + 2, yy + 9.5);
  };
  bar(h - 52, G.player.health / 100, G.player.health > 30 ? '#57e389' : '#ff5040', 'HEALTH');
  if (G.player.car) {
    const c = G.player.car;
    bar(h - 30, c.health / c.maxHealth, '#6db3f2', c.type.name.toUpperCase());
  }
  // Speed, bottom right
  if (G.player.car) {
    ctx.textAlign = 'right';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4;
    ctx.fillText(`${Math.round(speedOf(G.player.car) * 0.32)} km/h`, w - 20, h - 22);
    ctx.shadowBlur = 0;
  }
  // Objective, bottom centre
  ctx.font = '600 16px system-ui, sans-serif';
  const ow = Math.min(w - 420, ctx.measureText(G.objective).width + 34);
  ctx.fillStyle = 'rgba(8,12,18,0.72)';
  rr(w / 2 - ow / 2, h - 56, ow, 30, 7); ctx.fill();
  ctx.fillStyle = '#ffd75e';
  ctx.textAlign = 'left';
  ctx.font = '800 11px system-ui, sans-serif';
  ctx.fillText('OBJECTIVE', w / 2 - ow / 2 + 12, h - 44);
  ctx.fillStyle = '#eef3f8';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText(G.objective, w / 2 - ow / 2 + 12 + ctx.measureText('OBJECTIVE  ').width, h - 37);
  // Prompt, under the objective
  if (G.prompt) {
    ctx.textAlign = 'center';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillStyle = '#ffd75e';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
    ctx.fillText(G.prompt, w / 2, h - 66);
    ctx.shadowBlur = 0;
  }
  // Busted meter
  if (G.bustedMeter > 0.03) {
    const bw2 = 280;
    ctx.fillStyle = 'rgba(8,12,18,0.75)';
    rr(w / 2 - bw2 / 2 - 4, h * 0.3 - 4, bw2 + 8, 30, 7); ctx.fill();
    ctx.fillStyle = '#5a1210';
    ctx.fillRect(w / 2 - bw2 / 2, h * 0.3, bw2, 13);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(w / 2 - bw2 / 2, h * 0.3, bw2 * clamp(G.bustedMeter, 0, 1), 13);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BUSTED?', w / 2, h * 0.3 + 24);
  }
  // Off-screen target arrow
  const t = missionTarget();
  if (t) {
    const sx = t.x - CAM.x, sy = t.y - CAM.y;
    if (sx < 10 || sy < 10 || sx > CAM.w - 10 || sy > CAM.h - 10) {
      const cx = CAM.w / 2, cy = CAM.h / 2;
      const a = Math.atan2(sy - cy, sx - cx);
      const ex = clamp(cx + Math.cos(a) * (CAM.w / 2 - 56), 36, CAM.w - 36);
      const ey = clamp(cy + Math.sin(a) * (CAM.h / 2 - 56), 36, CAM.h - 36);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(a);
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath();
      ctx.moveTo(15, 0); ctx.lineTo(-9, -9); ctx.lineTo(-9, 9);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      const pp = playerPos();
      ctx.fillStyle = '#ffd75e';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(dist(pp.x, pp.y, t.x, t.y) / 10)}m`, ex, ey + 24);
    }
  }
  // Low-health vignette
  if (G.player.health < 32 && G.screen === 'play') {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.36, w / 2, h / 2, h * 0.75);
    g.addColorStop(0, 'rgba(160,0,0,0)');
    g.addColorStop(1, `rgba(160,0,0,${0.32 + 0.12 * Math.sin(G.time * 6)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function render() {
  CAM = getCam();
  const night = nightFactor();
  drawWorld(ctx, world, CAM, night, G.time);
  // Skid marks
  ctx.strokeStyle = '#1c1e22';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (const s of G.skids) {
    ctx.globalAlpha = s.a;
    ctx.beginPath();
    ctx.moveTo(s.x1 - CAM.x, s.y1 - CAM.y);
    ctx.lineTo(s.x2 - CAM.x, s.y2 - CAM.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawMarkers();
  for (const ped of G.peds) drawPed(ped);
  for (const c of G.cars) drawCar(c);
  drawPlayerFigure();
  drawHeli();
  for (const p of G.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1) * 0.8;
    ctx.fillStyle = `rgba(${p.colour},1)`;
    ctx.beginPath(); ctx.arc(p.x - CAM.x, p.y - CAM.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (night > 0.02) {
    ctx.fillStyle = `rgba(9,13,44,${0.38 * night})`;
    ctx.fillRect(0, 0, CAM.w, CAM.h);
    ctx.globalCompositeOperation = 'lighter';
    drawHeadlightGlows(night);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (G.screen !== 'title') {
    drawMinimap();
    drawHUD();
  }
}

// ---------------- Screens & wiring ----------------
function openPause() {
  if (G.screen !== 'play') return;
  G.screen = 'pause';
  pauseScreen.classList.remove('hidden');
  sfx.setSiren(false, 0);
}
function closePause() {
  G.screen = 'play';
  pauseScreen.classList.add('hidden');
}
function showTitle() {
  G.screen = 'title';
  titleScreen.classList.remove('hidden');
  $('btnContinue').classList.toggle('hidden', !loadSave());
  sfx.setSiren(false, 0);
}
function startGame(saved) {
  G = freshState();
  if (saved) {
    G.cash = saved.cash ?? 120;
    G.missionIdx = Math.min(saved.missionIdx ?? 0, MISSIONS.length);
    G.ownedTypes = saved.ownedTypes ?? ['comet'];
    G.storyDone = !!saved.storyDone;
    G.timeOfDay = saved.timeOfDay ?? 10.2;
  }
  populateWorld(saved);
  G.screen = 'play';
  titleScreen.classList.add('hidden');
  refreshObjective();
  showBanner('CRESCENT KEYS', saved ? 'Welcome back to San Aurelio' : 'Visit the gold marker to start working');
}

$('btnNew').addEventListener('click', () => { sfx.ensure(); clearSave(); startGame(null); });
$('btnContinue').addEventListener('click', () => { sfx.ensure(); startGame(loadSave()); });
$('btnResume').addEventListener('click', () => { sfx.ensure(); closePause(); });
$('btnSaveQuit').addEventListener('click', () => { sfx.ensure(); saveGame(); closePause(); showTitle(); });
$('btnRespawn').addEventListener('click', () => { sfx.ensure(); respawn(); });
window.addEventListener('pointerdown', () => sfx.ensure());
window.addEventListener('keydown', () => sfx.ensure());

// ---------------- Boot & main loop ----------------
G = freshState();
populateWorld(null);
showTitle();

let lastT = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, lastT ? (ts - lastT) / 1000 : 0.016);
  lastT = ts;
  if (G.screen === 'play') update(dt);
  else if (G.screen === 'dialogue' && input.hit('enter')) advanceDialogue();
  else if (G.screen === 'pause' && input.hit('p', 'escape')) closePause();
  render();
  input.endFrame();
}
requestAnimationFrame(frame);
