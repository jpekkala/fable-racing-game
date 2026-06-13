// Minimal browser stubs so game.js can run headless under Node for testing.
function makeCtx2D() {
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => makeCtx2D() };
}
const __canvas = makeCanvas();
const document = {
  getElementById: () => __canvas,
  createElement: () => makeCanvas(),
};
let __rafCb = null;
const window = {
  addEventListener: () => {},
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 800,
};
const requestAnimationFrame = (cb) => { __rafCb = cb; };
class Path2D {
  moveTo() {} lineTo() {} closePath() {}
}
'use strict';

// ---------------------------------------------------------------------------
// Slicks 'n Slides — a browser tribute to the 1993 top-down racing classic.
// Whole track on one screen, sliding physics, up to 2 humans + AI opponents.
// ---------------------------------------------------------------------------

const WORLD_W = 1600;
const WORLD_H = 1000;
const STEP = 4;                 // centerline sample spacing (px)
const PHYS_DT = 1 / 120;

const CAR_COLORS = ['#e23030', '#3b7dff', '#ffd23f', '#3fbf4e', '#c95bff', '#ff8c2e'];

// ---------------------------------------------------------------------------
// Tracks: closed loops of control points, smoothed with Catmull-Rom.
// ---------------------------------------------------------------------------
const TRACKS = [
  {
    name: 'GRAND OVAL',
    halfW: 56,
    points: [
      [220, 500], [300, 240], [600, 150], [1050, 150], [1350, 250],
      [1430, 500], [1350, 750], [1050, 860], [900, 770], [700, 870],
      [450, 850], [290, 740],
    ],
  },
  {
    name: 'SERPENT RUN',
    halfW: 50,
    points: [
      [250, 850], [800, 880], [1300, 830], [1430, 600], [1380, 300],
      [1050, 170], [800, 330], [550, 170], [280, 260], [180, 550],
    ],
  },
  {
    name: 'HAIRPIN HILLS',
    halfW: 46,
    points: [
      [250, 870], [700, 880], [1200, 860], [1420, 680], [1400, 420],
      [1150, 480], [950, 600], [700, 560], [560, 380], [800, 260],
      [1150, 300], [1100, 140], [700, 150], [400, 180], [200, 400],
      [180, 680],
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const wrap01 = (v) => ((v % 1) + 1) % 1;
const fmtTime = (t) => {
  if (t == null) return '--:--.-';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

// Seeded RNG for stable decoration placement per track.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

// ---------------------------------------------------------------------------
// Track building: smooth the control loop, resample at uniform arc length.
// ---------------------------------------------------------------------------
function buildTrack(def) {
  const pts = def.points;
  const raw = [];
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[(i - 1 + pts.length) % pts.length];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const p3 = pts[(i + 2) % pts.length];
    for (let j = 0; j < 32; j++) raw.push(catmullRom(p0, p1, p2, p3, j / 32));
  }
  // Resample uniformly every STEP px.
  const samples = [];
  let carry = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i], b = raw[(i + 1) % raw.length];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = carry;
    while (d < segLen) {
      const t = d / segLen;
      samples.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
      d += STEP;
    }
    carry = d - segLen;
  }
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const a = samples[i], b = samples[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    a.tx = (b.x - a.x) / len;
    a.ty = (b.y - a.y) / len;
  }
  return { def, samples, n, halfW: def.halfW, length: n * STEP };
}

function nearestSample(track, x, y, hint) {
  const { samples, n } = track;
  let bestI = 0, bestD = Infinity;
  if (hint != null) {
    // Local search around the last known index first.
    for (let o = -45; o <= 45; o++) {
      const i = (hint + o + n) % n;
      const s = samples[i];
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestD < (track.halfW * 2.5) ** 2) return { i: bestI, d: Math.sqrt(bestD) };
  }
  bestD = Infinity;
  for (let i = 0; i < n; i += 4) {
    const s = samples[i];
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bestD) { bestD = d; bestI = i; }
  }
  for (let o = -4; o <= 4; o++) {
    const i = (bestI + o + n) % n;
    const s = samples[i];
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return { i: bestI, d: Math.sqrt(bestD) };
}

// ---------------------------------------------------------------------------
// Track rendering (static layer: grass, road, kerbs, start line, trees)
// ---------------------------------------------------------------------------
function renderTrackCanvas(track, seed) {
  const cv = document.createElement('canvas');
  cv.width = WORLD_W;
  cv.height = WORLD_H;
  const g = cv.getContext('2d');
  const rng = makeRng(seed);

  // Grass with speckle texture.
  g.fillStyle = '#2e7d32';
  g.fillRect(0, 0, WORLD_W, WORLD_H);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
    g.fillRect(rng() * WORLD_W, rng() * WORLD_H, 3, 3);
  }

  const path = new Path2D();
  track.samples.forEach((s, i) => (i ? path.lineTo(s.x, s.y) : path.moveTo(s.x, s.y)));
  path.closePath();

  g.lineJoin = 'round';
  g.lineCap = 'round';

  // Kerb: white base with red dashes peeking out from under the road.
  g.strokeStyle = '#e8e8e8';
  g.lineWidth = track.halfW * 2 + 14;
  g.stroke(path);
  g.strokeStyle = '#d3302f';
  g.setLineDash([14, 14]);
  g.stroke(path);
  g.setLineDash([]);

  // Road surface.
  g.strokeStyle = '#4a4a4f';
  g.lineWidth = track.halfW * 2;
  g.stroke(path);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = track.halfW * 1.2;
  g.stroke(path);

  // Start/finish line: checkered band perpendicular to the track at sample 0.
  const s0 = track.samples[0];
  const px = -s0.ty, py = s0.tx;
  const sq = 8;
  for (let row = 0; row < 2; row++) {
    for (let k = -Math.floor(track.halfW / sq); k * sq < track.halfW; k++) {
      g.fillStyle = (k + row) % 2 ? '#111' : '#eee';
      const cx = s0.x + px * (k * sq + sq / 2) + s0.tx * (row * sq - sq);
      const cy = s0.y + py * (k * sq + sq / 2) + s0.ty * (row * sq - sq);
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.atan2(s0.ty, s0.tx));
      g.fillRect(-sq / 2, -sq / 2, sq, sq);
      g.restore();
    }
  }

  // Trees, kept clear of the road.
  let placed = 0, guard = 0;
  while (placed < 45 && guard++ < 2000) {
    const x = 40 + rng() * (WORLD_W - 80);
    const y = 40 + rng() * (WORLD_H - 80);
    if (nearestSample(track, x, y).d < track.halfW + 55) continue;
    const r = 10 + rng() * 12;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.arc(x + 4, y + 4, r, 0, 7); g.fill();
    g.fillStyle = '#1d5a22';
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = '#2f7a35';
    g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, 7); g.fill();
    placed++;
  }
  return cv;
}

// ---------------------------------------------------------------------------
// Car
// ---------------------------------------------------------------------------
const CP_FRACS = [0.25, 0.5, 0.75, 0]; // last one is the start line

class Car {
  constructor(name, color, isHuman, controls) {
    this.name = name;
    this.color = color;
    this.isHuman = isHuman;
    this.controls = controls; // key map for humans, null for AI
    this.x = 0; this.y = 0; this.angle = 0;
    this.vx = 0; this.vy = 0;
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.trackIdx = 0;
    this.progress = 0;       // [0,1) along centerline
    this.nextCp = 0;
    this.lap = 0;
    this.lapStart = 0;
    this.lastLap = null;
    this.bestLap = null;
    this.finished = false;
    this.finishTime = null;
    this.onRoad = true;
    // AI personality
    this.skill = 0.86 + Math.random() * 0.13;
    this.aiOffset = (Math.random() - 0.5) * 0.5; // preferred line bias
  }

  placeOnGrid(track, slot) {
    const n = track.n;
    const row = Math.floor(slot / 2), col = slot % 2;
    const back = Math.round((46 + row * 42) / STEP);
    const s = track.samples[(n - back) % n];
    const lat = (col ? -1 : 1) * track.halfW * 0.45;
    this.x = s.x - s.ty * lat;
    this.y = s.y + s.tx * lat;
    this.angle = Math.atan2(s.ty, s.tx);
    this.vx = this.vy = 0;
    this.trackIdx = (n - back) % n;
  }

  readInput(keys) {
    const c = this.controls;
    this.throttle = keys[c.up] ? 1 : 0;
    this.brake = keys[c.down] ? 1 : 0;
    this.steer = (keys[c.right] ? 1 : 0) - (keys[c.left] ? 1 : 0);
  }

  driveAI(track) {
    const speed = Math.hypot(this.vx, this.vy);
    const ahead1 = Math.round(clamp(speed * 0.42, 60, 190) / STEP);
    const ahead2 = Math.round(190 / STEP);
    const n = track.n;
    const t1 = track.samples[(this.trackIdx + ahead1) % n];
    const t2 = track.samples[(this.trackIdx + ahead2) % n];
    // Aim a little off-center for variety between drivers.
    const tx = t1.x - t1.ty * track.halfW * this.aiOffset;
    const ty = t1.y + t1.tx * track.halfW * this.aiOffset;
    const want = Math.atan2(ty - this.y, tx - this.x);
    const diff = wrapAngle(want - this.angle);
    this.steer = clamp(diff * 2.5, -1, 1);
    // Slow for corners: compare tangent now vs. further ahead.
    const here = track.samples[this.trackIdx];
    const bend = Math.abs(wrapAngle(Math.atan2(t2.ty, t2.tx) - Math.atan2(here.ty, here.tx)));
    const desired = (460 * this.skill) * (1.05 - 0.85 * Math.min(1, bend / 1.5));
    this.throttle = speed < desired ? 1 : 0;
    this.brake = speed > desired * 1.18 ? 1 : 0;
  }

  physics(dt, track) {
    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    const px = -fy, py = fx;
    let vf = this.vx * fx + this.vy * fy;
    let vl = this.vx * px + this.vy * py;

    const near = nearestSample(track, this.x, this.y, this.trackIdx);
    this.trackIdx = near.i;
    this.progress = near.i / track.n;
    this.onRoad = near.d < track.halfW + 6;

    const accel = this.onRoad ? 410 : 215;
    const dragK = this.onRoad ? 0.88 : 2.1;
    const grip = this.onRoad ? 8.2 : 3.2;

    if (this.throttle && !this.locked) vf += accel * dt;
    if (this.brake && !this.locked) {
      if (vf > 5) vf -= 640 * dt;
      else vf = Math.max(vf - 240 * dt, -140);
    }
    vf *= Math.exp(-dragK * dt);
    vl *= Math.exp(-grip * dt);

    const turnFactor = clamp(vf / 140, -1, 1) * (1 - 0.32 * Math.min(1, Math.abs(vf) / 470));
    this.angle += this.steer * 3.4 * turnFactor * dt;

    const nfx = Math.cos(this.angle), nfy = Math.sin(this.angle);
    this.vx = nfx * vf + -nfy * vl;
    this.vy = nfy * vf + nfx * vl;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.slip = vl;
    this.fwdSpeed = vf;

    // World bounds.
    if (this.x < 12) { this.x = 12; this.vx = Math.abs(this.vx) * 0.4; }
    if (this.x > WORLD_W - 12) { this.x = WORLD_W - 12; this.vx = -Math.abs(this.vx) * 0.4; }
    if (this.y < 12) { this.y = 12; this.vy = Math.abs(this.vy) * 0.4; }
    if (this.y > WORLD_H - 12) { this.y = WORLD_H - 12; this.vy = -Math.abs(this.vy) * 0.4; }
  }

  // Returns true when a lap was just completed.
  updateLaps(prevProgress, raceTime, totalLaps) {
    if (this.finished) return false;
    let d = this.progress - prevProgress;
    if (d < -0.5) d += 1;
    if (d > 0.5) d -= 1;
    if (d <= 0) return false; // only forward motion advances checkpoints
    const target = CP_FRACS[this.nextCp];
    const off = wrap01(target - prevProgress);
    if (off > d) return false;
    this.nextCp = (this.nextCp + 1) % CP_FRACS.length;
    if (target !== 0) return false;
    // Crossed the start line with all checkpoints collected: lap complete.
    const lapTime = raceTime - this.lapStart;
    this.lastLap = lapTime;
    if (this.bestLap == null || lapTime < this.bestLap) this.bestLap = lapTime;
    this.lap++;
    this.lapStart = raceTime;
    if (this.lap >= totalLaps) {
      this.finished = true;
      this.finishTime = raceTime;
    }
    return true;
  }

  positionKey() {
    if (this.finished) return 1e9 - this.finishTime;
    const toNext = wrap01(CP_FRACS[this.nextCp] - this.progress);
    return this.lap * 100 + this.nextCp * 10 - toNext * 10;
  }
}

// ---------------------------------------------------------------------------
// Audio: lazy WebAudio, engine drones for human cars + UI beeps.
// ---------------------------------------------------------------------------
const audio = {
  ctx: null,
  engines: [],
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  beep(freq, dur = 0.12, vol = 0.12, type = 'square') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur);
  },
  startEngines(count) {
    this.stopEngines();
    if (!this.ctx) return;
    for (let i = 0; i < count; i++) {
      const o = this.ctx.createOscillator();
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = 55;
      f.type = 'lowpass';
      f.frequency.value = 700;
      g.gain.value = 0.025;
      o.connect(f).connect(g).connect(this.ctx.destination);
      o.start();
      this.engines.push({ o, g });
    }
  },
  setEngine(i, speed, throttle) {
    const e = this.engines[i];
    if (e) e.o.frequency.value = 50 + (speed / 470) * 130 + throttle * 18;
  },
  stopEngines() {
    for (const e of this.engines) { try { e.o.stop(); } catch {} }
    this.engines = [];
  },
};

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const keys = {};

const P1_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const P2_KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
const AI_NAMES = ['KEKE', 'MIKA', 'JJ', 'LEO', 'HEIKKI', 'VALTTERI'];

const game = {
  state: 'MENU',          // MENU | COUNTDOWN | RACE | FINISHED
  menuRow: 0,
  players: 1,
  aiCount: 3,
  trackIdx: 0,
  lapsIdx: 1,
  lapsOptions: [3, 5, 10],
  track: null,
  trackCanvas: null,
  skidCanvas: null,
  cars: [],
  particles: [],
  raceTime: 0,
  countdown: 0,
  finishedAt: 0,
  accumulator: 0,
  lastFrame: 0,
};

function startRace() {
  game.track = buildTrack(TRACKS[game.trackIdx]);
  game.trackCanvas = renderTrackCanvas(game.track, 1234 + game.trackIdx * 777);
  game.skidCanvas = document.createElement('canvas');
  game.skidCanvas.width = WORLD_W;
  game.skidCanvas.height = WORLD_H;
  game.skidCtx = game.skidCanvas.getContext('2d');

  game.cars = [];
  const total = Math.min(6, game.players + game.aiCount);
  const aiTotal = total - game.players;
  for (let i = 0; i < aiTotal; i++) {
    game.cars.push(new Car(AI_NAMES[i], CAR_COLORS[2 + i], false, null));
  }
  if (game.players >= 2) game.cars.push(new Car('PLAYER 2', CAR_COLORS[1], true, P2_KEYS));
  game.cars.push(new Car('PLAYER 1', CAR_COLORS[0], true, P1_KEYS));
  game.cars.forEach((c, i) => {
    c.placeOnGrid(game.track, i);
    c.locked = true;
  });

  game.particles = [];
  game.accumulator = 0;
  game.raceTime = 0;
  game.countdown = 3.6;
  game.state = 'COUNTDOWN';
  game.lastBeep = 4;
  audio.ensure();
  audio.startEngines(game.cars.filter((c) => c.isHuman).length);
}

function totalLaps() { return game.lapsOptions[game.lapsIdx]; }

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
const menuRows = [
  {
    label: 'PLAYERS',
    value: () => String(game.players),
    change: (d) => { game.players = clamp(game.players + d, 1, 2); },
  },
  {
    label: 'AI OPPONENTS',
    value: () => String(game.aiCount),
    change: (d) => { game.aiCount = clamp(game.aiCount + d, 0, 4); },
  },
  {
    label: 'TRACK',
    value: () => TRACKS[game.trackIdx].name,
    change: (d) => { game.trackIdx = (game.trackIdx + d + TRACKS.length) % TRACKS.length; },
  },
  {
    label: 'LAPS',
    value: () => String(totalLaps()),
    change: (d) => { game.lapsIdx = clamp(game.lapsIdx + d, 0, game.lapsOptions.length - 1); },
  },
];

function menuKey(code) {
  if (code === 'ArrowUp') { game.menuRow = (game.menuRow + menuRows.length - 1) % menuRows.length; audio.beep(330, 0.05); }
  else if (code === 'ArrowDown') { game.menuRow = (game.menuRow + 1) % menuRows.length; audio.beep(330, 0.05); }
  else if (code === 'ArrowLeft') { menuRows[game.menuRow].change(-1); audio.beep(440, 0.05); }
  else if (code === 'ArrowRight') { menuRows[game.menuRow].change(1); audio.beep(440, 0.05); }
  else if (code === 'Enter' || code === 'Space') startRace();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function physicsStep(dt) {
  const track = game.track;
  const racing = game.state === 'RACE';
  if (racing) game.raceTime += dt;

  for (const car of game.cars) {
    if (car.isHuman) car.readInput(keys);
    else if (!car.locked) car.driveAI(track);
    if (car.locked) { car.throttle = 0; car.brake = 0; }
    const prevProgress = car.progress;
    car.physics(dt, track);
    if (racing && car.updateLaps(prevProgress, game.raceTime, totalLaps())) {
      if (car.isHuman) audio.beep(car.finished ? 1320 : 880, 0.15, 0.1);
    }

    // Skid marks from heavy sliding or hard braking on tarmac.
    const speed = Math.hypot(car.vx, car.vy);
    const sliding = Math.abs(car.slip) > 85 || (car.brake && car.fwdSpeed > 240);
    if (car.onRoad && sliding && speed > 60) {
      const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
      const g = game.skidCtx;
      g.fillStyle = 'rgba(20,20,20,0.28)';
      for (const side of [-1, 1]) {
        g.fillRect(car.x - fx * 7 - fy * 5 * side - 1.5, car.y - fy * 7 + fx * 5 * side - 1.5, 3, 3);
      }
    }
    // Dust on grass.
    if (!car.onRoad && speed > 60 && game.particles.length < 350) {
      game.particles.push({
        x: car.x - Math.cos(car.angle) * 8,
        y: car.y - Math.sin(car.angle) * 8,
        vx: (Math.random() - 0.5) * 40 - car.vx * 0.1,
        vy: (Math.random() - 0.5) * 40 - car.vy * 0.1,
        life: 0.6,
      });
    }
  }

  // Car-car collisions: equal-mass circles with a bit of bounce.
  const R = 11;
  for (let i = 0; i < game.cars.length; i++) {
    for (let j = i + 1; j < game.cars.length; j++) {
      const a = game.cars[i], b = game.cars[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d === 0 || d >= R * 2) continue;
      const nx = dx / d, ny = dy / d;
      const push = (R * 2 - d) / 2;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        const imp = -rel * 0.75;
        a.vx -= nx * imp; a.vy -= ny * imp;
        b.vx += nx * imp; b.vy += ny * imp;
      }
    }
  }

  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) game.particles.splice(i, 1);
  }

  // Engine audio for human cars.
  let ei = 0;
  for (const car of game.cars) {
    if (!car.isHuman) continue;
    audio.setEngine(ei++, Math.hypot(car.vx, car.vy), car.throttle);
  }
}

function update(dt) {
  if (game.state === 'COUNTDOWN') {
    game.countdown -= dt;
    const sec = Math.ceil(game.countdown);
    if (sec < game.lastBeep && sec > 0) { audio.beep(440, 0.18, 0.14); game.lastBeep = sec; }
    if (game.countdown <= 0) {
      game.state = 'RACE';
      game.cars.forEach((c) => (c.locked = false));
      audio.beep(880, 0.4, 0.16);
    }
    physicsStep(dt);
  } else if (game.state === 'RACE') {
    physicsStep(dt);
    if (game.cars.filter((c) => c.isHuman).every((c) => c.finished)) {
      game.state = 'FINISHED';
      game.finishedAt = game.raceTime;
    }
  } else if (game.state === 'FINISHED') {
    physicsStep(dt); // let the AI keep circulating behind the results
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawCar(g, car) {
  g.save();
  g.translate(car.x, car.y);
  g.rotate(car.angle);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-10, -4, 22, 12); // shadow, offset by the rect being drawn low
  g.fillStyle = car.color;
  g.fillRect(-11, -6, 22, 12);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(-11, -6, 22, 2.5);   // tyre line top
  g.fillRect(-11, 3.5, 22, 2.5);  // tyre line bottom
  g.fillStyle = 'rgba(20,30,40,0.9)';
  g.fillRect(0, -4.5, 6, 9);      // windshield
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(-9, -4, 4, 8);       // rear highlight
  g.restore();
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const cw = window.innerWidth, ch = window.innerHeight;
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, cw, ch);

  if (game.state === 'MENU') { renderMenu(cw, ch); return; }

  const scale = Math.min(cw / WORLD_W, ch / WORLD_H);
  const ox = (cw - WORLD_W * scale) / 2;
  const oy = (ch - WORLD_H * scale) / 2;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.drawImage(game.trackCanvas, 0, 0);
  ctx.drawImage(game.skidCanvas, 0, 0);

  for (const p of game.particles) {
    ctx.fillStyle = `rgba(150,120,70,${(p.life / 0.6) * 0.5})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, 7);
    ctx.fill();
  }
  for (const car of game.cars) drawCar(ctx, car);
  ctx.restore();

  renderHud(cw, ch);
  if (game.state === 'COUNTDOWN') {
    const sec = Math.ceil(game.countdown);
    drawText(sec > 0 ? String(sec) : 'GO!', cw / 2, ch / 2, 90, '#ffd23f', 'center');
  } else if (game.state === 'RACE' && game.raceTime < 1.2) {
    drawText('GO!', cw / 2, ch / 2, 90, '#3fbf4e', 'center');
  }
  if (game.state === 'FINISHED') renderResults(cw, ch);
}

function drawText(text, x, y, size, color, align = 'left', alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${size}px "Courier New", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(text, x + size * 0.06, y + size * 0.06);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function standings() {
  return [...game.cars].sort((a, b) => b.positionKey() - a.positionKey());
}

function renderHud(cw, ch) {
  // Human player panels, top-left.
  let y = 22;
  for (const car of game.cars.filter((c) => c.isHuman)) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(10, y - 14, 330, 48);
    ctx.fillStyle = car.color;
    ctx.fillRect(16, y - 8, 14, 14);
    const lapShown = Math.min(car.lap + 1, totalLaps());
    drawText(`${car.name}  LAP ${car.finished ? totalLaps() : lapShown}/${totalLaps()}`, 40, y, 15, '#fff');
    drawText(`LAST ${fmtTime(car.lastLap)}  BEST ${fmtTime(car.bestLap)}`, 40, y + 20, 13, '#aaa');
    y += 58;
  }
  // Live standings, top-right.
  const order = standings();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(cw - 190, 8, 182, 18 + order.length * 19);
  drawText('POSITIONS', cw - 180, 20, 13, '#ffd23f');
  order.forEach((car, i) => {
    drawText(`${i + 1}. ${car.name}${car.finished ? ' *' : ''}`, cw - 180, 40 + i * 19, 13, car.color);
  });
  drawText(`TIME ${fmtTime(game.raceTime)}`, 14, ch - 18, 14, '#ddd');
  drawText('ESC = MENU', cw - 14, ch - 18, 13, '#888', 'right');
}

function renderResults(cw, ch) {
  const order = standings();
  const w = 560, h = 120 + order.length * 30;
  const x = (cw - w) / 2, y = (ch - h) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  drawText('RACE RESULTS', cw / 2, y + 34, 26, '#ffd23f', 'center');
  order.forEach((car, i) => {
    const ry = y + 80 + i * 30;
    const res = car.finished ? fmtTime(car.finishTime) : 'DNF';
    drawText(`${i + 1}.`, x + 30, ry, 17, '#fff');
    drawText(car.name, x + 70, ry, 17, car.color);
    drawText(res, x + 300, ry, 17, '#fff');
    drawText(`best ${fmtTime(car.bestLap)}`, x + 420, ry, 13, '#999');
  });
  drawText('ENTER = MENU', cw / 2, y + h - 22, 14, '#aaa', 'center');
}

function renderMenu(cw, ch) {
  // Animated cars sliding around behind the title.
  const t = performance.now() / 1000;
  for (let i = 0; i < 4; i++) {
    const a = t * (0.4 + i * 0.07) + (i * Math.PI) / 2;
    const car = {
      x: cw / 2 + Math.cos(a) * Math.min(cw, ch) * 0.38,
      y: ch / 2 + Math.sin(a) * Math.min(cw, ch) * 0.30,
      angle: a + Math.PI / 2 + Math.sin(t * 3 + i) * 0.3,
      color: CAR_COLORS[i],
    };
    drawCar(ctx, car);
  }

  drawText("SLICKS 'N SLIDES", cw / 2, ch * 0.2, Math.min(64, cw / 14), '#ffd23f', 'center');
  drawText('A BROWSER TRIBUTE', cw / 2, ch * 0.2 + 50, 16, '#888', 'center');

  const baseY = ch * 0.42;
  menuRows.forEach((row, i) => {
    const sel = i === game.menuRow;
    const y = baseY + i * 46;
    if (sel) {
      ctx.fillStyle = 'rgba(255,210,63,0.12)';
      ctx.fillRect(cw / 2 - 260, y - 18, 520, 36);
      drawText('>', cw / 2 - 240, y, 20, '#ffd23f');
    }
    drawText(row.label, cw / 2 - 200, y, 20, sel ? '#fff' : '#999');
    drawText(`< ${row.value()} >`, cw / 2 + 60, y, 20, sel ? '#ffd23f' : '#777');
  });

  drawText('ENTER = RACE', cw / 2, baseY + menuRows.length * 46 + 40, 22, '#3fbf4e', 'center');
  drawText('P1: ARROW KEYS      P2: W A S D', cw / 2, ch - 60, 15, '#aaa', 'center');
  drawText('STAY ON THE TARMAC — GRASS IS SLOW AND SLIPPERY', cw / 2, ch - 34, 13, '#666', 'center');
}

// ---------------------------------------------------------------------------
// Input + main loop
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
  audio.ensure();
  if (e.repeat) return;
  keys[e.code] = true;

  if (game.state === 'MENU') {
    menuKey(e.code);
  } else if (e.code === 'Escape') {
    audio.stopEngines();
    game.state = 'MENU';
  } else if (game.state === 'FINISHED' && e.code === 'Enter') {
    audio.stopEngines();
    game.state = 'MENU';
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function frame(now) {
  const dt = Math.min(0.1, (now - game.lastFrame) / 1000 || 0);
  game.lastFrame = now;
  if (game.state !== 'MENU') {
    game.accumulator += dt;
    while (game.accumulator >= PHYS_DT) {
      update(PHYS_DT);
      game.accumulator -= PHYS_DT;
    }
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Headless smoke test: build every track, then simulate a full 3-lap race
// with the "human" car driven by the AI controller.
let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg);
  if (!cond) failures++;
};

// 1. Every track builds sanely.
for (const def of TRACKS) {
  const tr = buildTrack(def);
  const bad = tr.samples.some((s) => !isFinite(s.x) || !isFinite(s.y) || !isFinite(s.tx));
  check(tr.n > 200 && !bad, `${def.name}: ${tr.n} samples, length ${Math.round(tr.length)}px, all finite`);
  const inBounds = tr.samples.every((s) => s.x > 0 && s.x < WORLD_W && s.y > 0 && s.y < WORLD_H);
  check(inBounds, `${def.name}: centerline inside world bounds`);
}

// 2. Simulate a race on each track.
for (let ti = 0; ti < TRACKS.length; ti++) {
  game.trackIdx = ti;
  game.players = 1;
  game.aiCount = 4;
  game.lapsIdx = 0; // 3 laps
  startRace();
  const human = game.cars.find((c) => c.isHuman);
  human.readInput = function () { this.driveAI(game.track); };

  check(game.cars.length === 5, `${TRACKS[ti].name}: 5 cars on grid`);
  const gridOk = game.cars.every((c) => nearestSample(game.track, c.x, c.y).d < game.track.halfW + 5);
  check(gridOk, `${TRACKS[ti].name}: all grid slots on tarmac`);

  let t = 0;
  const stepMs = 16.667;
  while (game.state !== 'FINISHED' && t < 360000) {
    __rafCb(t);
    t += stepMs;
  }
  const nan = game.cars.some((c) => !isFinite(c.x) || !isFinite(c.y) || !isFinite(c.angle));
  check(!nan, `${TRACKS[ti].name}: no NaN car state after ${Math.round(t / 1000)}s`);
  check(game.state === 'FINISHED', `${TRACKS[ti].name}: race finished (state=${game.state})`);
  check(human.finished && human.lap === 3,
    `${TRACKS[ti].name}: player finished 3 laps in ${fmtTime(human.finishTime)} (best lap ${fmtTime(human.bestLap)})`);
  check(human.bestLap > 5 && human.bestLap < 60,
    `${TRACKS[ti].name}: best lap plausible (${fmtTime(human.bestLap)})`);
  const order = standings();
  check(order.length === 5 && order.every((c, i) => i === 0 || order[i - 1].positionKey() >= c.positionKey()),
    `${TRACKS[ti].name}: standings ordered — winner ${order[0].name} ${fmtTime(order[0].finishTime)}`);

  // Reset to menu for the next iteration, as Escape would.
  game.state = 'MENU';
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL TESTS PASSED');
process.exit(failures ? 1 : 0);
