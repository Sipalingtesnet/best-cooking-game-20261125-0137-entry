// game/src/game.js
// Sizzle & Serve — an original street-kitchen rush game (canvas 2D, no assets,
// no network). Run a tiny kitchen: take orders from the board, grill patties,
// stack ingredients on the plate, serve before patience runs out.
// Controls: mouse click (bins, grill, plate, SERVE) + keys 1-6 bins,
// Space serve, Enter start/restart, R restart, P pause, M mute.
//
// ?shot=start|play|end&seed=N stages a deterministic scene for screenshots
// and sets window.__shotReady once it is painted.

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

const STATE = { TITLE: 'title', PLAY: 'play', END: 'end' };
let currentState = STATE.TITLE;

const SHIFT_LEN = 120; // seconds per shift
let timer = SHIFT_LEN;
let lives = 3;
let score = 0;
let combo = 1;
let best = 0;
try { best = Number.parseInt(window.localStorage.getItem('sizzle-serve-best') ?? '0', 10) || 0; } catch { best = 0; }
let paused = false;
let mute = false;
let lastTick = performance.now();
let shiftElapsed = 0;
let spawnTimer = 0;
let popups = [];   // {x, y, text, color, ttl}
let particles = []; // {x, y, vx, vy, ttl, color, r}
let passDish = null; // a completed dish waiting on the pass ("ready to serve")
let shotPainted = 0;

// --- audio: tiny WebAudio bleeps, synthesized, no files ---
let audioCtx = null;
function beep(freq, dur, type, vol) {
  if (mute) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch { /* audio unavailable: play silent */ }
}
const sfxAdd = () => beep(520, 0.07, 'triangle', 0.06);
const sfxGrill = () => beep(180, 0.15, 'sawtooth', 0.05);
const sfxServe = () => { beep(660, 0.09, 'sine', 0.08); setTimeout(() => beep(880, 0.12, 'sine', 0.08), 90); };
const sfxBad = () => beep(140, 0.2, 'square', 0.06);

// --- ingredients & recipes (all original) ---
const INGREDIENTS = [
  { name: 'Bun', color: '#e0a458' },
  { name: 'Patty', color: '#7a4a2b' },
  { name: 'Lettuce', color: '#7dc242' },
  { name: 'Tomato', color: '#e23b3b' },
  { name: 'Cheese', color: '#ffcf3f' },
  { name: 'Sauce', color: '#c94f1e' },
];
const RECIPES = [
  { name: 'Classic Burger', items: ['Bun', 'Patty', 'Lettuce', 'Tomato', 'Bun'] },
  { name: 'Cheese Melt', items: ['Bun', 'Patty', 'Cheese', 'Cheese', 'Bun'] },
  { name: 'Garden Fresh', items: ['Bun', 'Lettuce', 'Tomato', 'Lettuce', 'Sauce', 'Bun'] },
  { name: 'Double Stack', items: ['Bun', 'Patty', 'Cheese', 'Patty', 'Tomato', 'Bun'] },
  { name: 'Saucy Classic', items: ['Bun', 'Patty', 'Sauce', 'Lettuce', 'Bun'] },
  { name: 'Tomato Twist', items: ['Bun', 'Tomato', 'Cheese', 'Tomato', 'Sauce', 'Bun'] },
];

// Deterministic pick for staging (seeded, no Math.random in shots).
function seededPick(n) {
  let s = (seed * 2654435761) >>> 0;
  s = (s ^ (s >>> 13)) >>> 0;
  return s % n;
}

let plate = [];
let grill = { hasPatty: false, cookTime: 0, cooked: false, burnt: false };
let orders = [];

function patienceFor() {
  // Patience shrinks as the shift goes on: 30s early, ~19s late.
  return Math.max(19, 30 - shiftElapsed * 0.09);
}
function spawnInterval() {
  return Math.max(6, 9 - shiftElapsed * 0.025);
}
function spawnOrder() {
  if (orders.length >= 3) return;
  const r = RECIPES[seededPick(RECIPES.length + orders.length) % RECIPES.length];
  orders.push({ name: r.name, ingredients: r.items.slice(), patience: patienceFor(), elapsed: 0 });
}
function startGame() {
  currentState = STATE.PLAY;
  timer = SHIFT_LEN; lives = 3; score = 0; combo = 1; paused = false;
  shiftElapsed = 0; spawnTimer = 0;
  plate = [];
  grill = { hasPatty: false, cookTime: 0, cooked: false, burnt: false };
  orders = [];
  popups = []; particles = []; passDish = null;
  spawnOrder();
  spawnOrder();
}
function endGame() {
  currentState = STATE.END;
  if (score > best) {
    best = score;
    try { window.localStorage.setItem('sizzle-serve-best', String(best)); } catch { /* no storage */ }
  }
}
function arrEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function matchedOrderIndex() {
  for (let i = 0; i < orders.length; i++) {
    if (plate.length > 0 && arrEqual(plate, orders[i].ingredients)) return i;
  }
  return -1;
}
function tryServe() {
  if (currentState !== STATE.PLAY || paused) return;
  const idx = matchedOrderIndex();
  if (idx >= 0) {
    const pts = 100 * combo;
    score += pts;
    popups.push({ x: WIDTH / 2, y: HEIGHT / 2 - 90, text: '+' + pts, color: '#7dff6a', ttl: 1.2 });
    if (combo > 1) popups.push({ x: WIDTH / 2, y: HEIGHT / 2 - 60, text: 'COMBO x' + combo, color: '#ffd94d', ttl: 1.2 });
    combo++;
    orders.splice(idx, 1);
    plate = [];
    passDish = null;
    sfxServe();
    spawnOrder();
  } else {
    combo = 1;
    popups.push({ x: WIDTH / 2, y: HEIGHT / 2 - 90, text: 'No match!', color: '#ff7a7a', ttl: 0.9 });
    sfxBad();
  }
}
function togglePause() { if (currentState === STATE.PLAY) paused = !paused; }
function toggleMute() { mute = !mute; }

window.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (currentState === STATE.TITLE) startGame();
    else if (currentState === STATE.END) startGame();
  }
  if (e.key === 'r' || e.key === 'R') {
    if (currentState === STATE.END || currentState === STATE.PLAY) startGame();
  }
  if (e.key === ' ') { e.preventDefault(); if (currentState === STATE.PLAY) tryServe(); }
  if (e.key === 'p' || e.key === 'P') togglePause();
  if (e.key === 'm' || e.key === 'M') toggleMute();
  const n = Number.parseInt(e.key, 10);
  if (n >= 1 && n <= 6 && currentState === STATE.PLAY && !paused) {
    const ing = INGREDIENTS[n - 1];
    if (ing.name !== 'Patty') { plate.push(ing.name); sfxAdd(); }
  }
});

const GRILL = { x: WIDTH / 2 - 60, y: HEIGHT - 150, w: 120, h: 80 };
const PLATE = { x: WIDTH / 2 - 100, y: HEIGHT / 2 - 60, w: 200, h: 120 };
const SERVE_BTN = { x: WIDTH / 2 + 130, y: HEIGHT / 2 - 30, w: 110, h: 56 };

function binRect(i) {
  const binW = 80, binH = 80;
  const startX = WIDTH - INGREDIENTS.length * (binW + 10) - 10;
  return { x: startX + i * (binW + 10), y: HEIGHT - binH - 10, w: binW, h: binH };
}

canvas.addEventListener('click', e => {
  if (currentState !== STATE.PLAY || paused) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const inside = r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
  if (inside(SERVE_BTN)) { tryServe(); return; }
  if (inside(GRILL)) {
    if (!grill.hasPatty) { grill.hasPatty = true; grill.cookTime = 0; grill.cooked = false; grill.burnt = false; sfxGrill(); }
    else if (grill.cooked && !grill.burnt) { plate.push('Patty'); grill.hasPatty = false; grill.cooked = false; sfxAdd(); }
    else if (grill.burnt) { grill.hasPatty = false; grill.burnt = false; grill.cooked = false; }
    return;
  }
  for (let i = 0; i < INGREDIENTS.length; i++) {
    if (inside(binRect(i))) {
      const ing = INGREDIENTS[i];
      if (ing.name !== 'Patty') { plate.push(ing.name); sfxAdd(); }
      return;
    }
  }
  if (inside(PLATE) && plate.length > 0) { plate.pop(); return; }
});

// --- deterministic shot staging ---
function stageShot() {
  if (shot === 'start') {
    currentState = STATE.TITLE;
  } else if (shot === 'play') {
    startGame();
    // Stage a busy mid-game frame, deterministically.
    orders = [
      { name: 'Classic Burger', ingredients: RECIPES[0].items.slice(), patience: 28, elapsed: 9 },
      { name: 'Garden Fresh', ingredients: RECIPES[2].items.slice(), patience: 24, elapsed: 14 },
    ];
    plate = ['Bun', 'Patty']; // 2 of 4+ parts: dish mid-assembly
    timer = 87;
    shiftElapsed = 33;
    grill = { hasPatty: true, cookTime: 2600, cooked: false, burnt: false };
    passDish = { name: 'Cheese Melt', items: RECIPES[1].items.slice() };
    score = 350;
    combo = 3;
  } else if (shot === 'end') {
    startGame();
    score = 1250;
    endGame();
  }
}
stageShot();

// --- update ---
function update(dt) {
  // particles + popups always animate
  for (const p of particles) { p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.ttl -= dt / 1000; }
  particles = particles.filter(p => p.ttl > 0);
  for (const p of popups) { p.y -= 24 * dt / 1000; p.ttl -= dt / 1000; }
  popups = popups.filter(p => p.ttl > 0);
  if (grill.hasPatty && !grill.cooked) {
    if (Math.random() < dt / 90) {
      particles.push({ x: GRILL.x + 15 + Math.random() * 90, y: GRILL.y + 12, vx: (Math.random() - 0.5) * 12, vy: -22 - Math.random() * 18, ttl: 0.7, color: '#ffb347', r: 2 + Math.random() * 2 });
    }
  }
  if (paused) return;
  if (currentState !== STATE.PLAY) return;
  timer -= dt / 1000;
  shiftElapsed += dt / 1000;
  if (timer <= 0) { timer = 0; endGame(); return; }
  if (grill.hasPatty && !grill.cooked) {
    grill.cookTime += dt;
    if (grill.cookTime >= 4000) grill.cooked = true;
    if (grill.cookTime >= 7000) grill.burnt = true;
  }
  spawnTimer += dt / 1000;
  if (spawnTimer >= spawnInterval()) { spawnTimer = 0; spawnOrder(); }
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i];
    o.elapsed += dt / 1000;
    if (o.elapsed >= o.patience) {
      orders.splice(i, 1); // walk out: exactly one life, once
      lives--;
      combo = 1;
      popups.push({ x: WIDTH / 2, y: 140, text: 'Customer walked out!', color: '#ff7a7a', ttl: 1.2 });
      sfxBad();
      if (lives <= 0) { endGame(); return; }
    }
  }
}

// --- draw ---
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  // kitchen backdrop: warm wall, floor, counter band
  ctx.fillStyle = '#3a2a1c'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#57402a'; ctx.fillRect(0, 0, WIDTH, 110);
  ctx.fillStyle = '#2c1e12'; ctx.fillRect(0, HEIGHT - 190, WIDTH, 190);
  ctx.fillStyle = '#6b4e33'; ctx.fillRect(0, HEIGHT - 190, WIDTH, 10);
  // top bar: timer, score, combo, lives, best
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif';
  ctx.fillText('Time: ' + Math.max(0, Math.ceil(timer)) + 's', 16, 36);
  ctx.fillText('Score: ' + score, 16, 66);
  ctx.fillStyle = combo > 1 ? '#ffd94d' : '#bbb';
  ctx.fillText('Combo x' + combo, 16, 96);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';
  ctx.fillText('Best: ' + best, WIDTH - 16, 36);
  ctx.fillText('Lives: ' + '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, 3 - lives)), WIDTH - 16, 66);
  ctx.textAlign = 'left';
  drawOrders();
  drawPass();
  drawBins();
  drawGrill();
  drawPlate();
  drawServeBtn();
  drawParticles();
  drawPopups();
  if (currentState === STATE.TITLE) drawTitle();
  if (currentState === STATE.END) drawGameOver();
  if (paused && currentState === STATE.PLAY) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('PAUSED — press P', WIDTH / 2, HEIGHT / 2);
    ctx.textAlign = 'left';
  }
  if (shot) {
    shotPainted++;
    if (shotPainted >= 2) window.__shotReady = true;
  }
}
function drawOrders() {
  const w = 250, h = 86;
  orders.forEach((o, i) => {
    const x = 16, y = 118 + i * (h + 10);
    const match = matchedOrderIndex() === i;
    ctx.fillStyle = match ? '#2f6b2f' : '#241a10';
    rr(x, y, w, h, 8); ctx.fill();
    ctx.lineWidth = match ? 3 : 1;
    ctx.strokeStyle = match ? '#7dff6a' : '#6b4e33';
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText((i + 1) + '. ' + o.name + (match ? '  ✓ MATCH' : ''), x + 10, y + 22);
    const pct = Math.max(0, 1 - o.elapsed / o.patience);
    ctx.fillStyle = '#4a3520'; ctx.fillRect(x + 10, y + 32, w - 20, 10);
    ctx.fillStyle = pct > 0.5 ? '#7dc242' : pct > 0.25 ? '#ffb347' : '#e23b3b';
    ctx.fillRect(x + 10, y + 32, (w - 20) * pct, 10);
    o.ingredients.forEach((ing, idx) => {
      const d = INGREDIENTS.find(v => v.name === ing);
      ctx.fillStyle = d ? d.color : '#888';
      ctx.fillRect(x + 10 + idx * 26, y + 52, 20, 20);
    });
  });
}
function drawPass() {
  if (!passDish) return;
  const x = WIDTH - 280, y = 118, w = 264, h = 86;
  ctx.fillStyle = '#1d3a24';
  rr(x, y, w, h, 8); ctx.fill();
  ctx.strokeStyle = '#7dff6a'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#bff5b0'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('READY TO SERVE: ' + passDish.name, x + 10, y + 24);
  passDish.items.forEach((ing, idx) => {
    const d = INGREDIENTS.find(v => v.name === ing);
    ctx.fillStyle = d ? d.color : '#888';
    ctx.fillRect(x + 10 + idx * 26, y + 40, 20, 20);
  });
  ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif';
  ctx.fillText('Plate it and press SERVE!', x + 10, y + 74);
}
function drawBins() {
  INGREDIENTS.forEach((ing, i) => {
    const r = binRect(i);
    ctx.fillStyle = '#241a10'; rr(r.x, r.y, r.w, r.h, 8); ctx.fill();
    ctx.strokeStyle = '#6b4e33'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = ing.color; ctx.fillRect(r.x + 10, r.y + 8, r.w - 20, r.h - 34);
    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText((i + 1) + '. ' + ing.name, r.x + r.w / 2, r.y + r.h - 6);
    ctx.textAlign = 'left';
  });
  ctx.fillStyle = '#cbb98f'; ctx.font = '13px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('Click a bin (or keys 1-6) to add it to the plate. Patty comes from the grill.', 16, HEIGHT - 18);
}
function drawGrill() {
  const r = GRILL;
  ctx.fillStyle = '#191919'; rr(r.x, r.y, r.w, r.h, 8); ctx.fill();
  ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#ddd'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('GRILL', r.x + r.w / 2, r.y + 16);
  ctx.textAlign = 'left';
  if (grill.hasPatty) {
    const prog = Math.min(1, grill.cookTime / 4000);
    ctx.fillStyle = grill.burnt ? '#222' : '#7a4a2b';
    ctx.fillRect(r.x + 22, r.y + 22 + (1 - prog) * 34, r.w - 44, 8 + prog * 26);
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h - 14, 9, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.stroke();
    if (grill.burnt) {
      ctx.fillStyle = '#ff7a7a'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('BURNT — click to toss', r.x + r.w / 2, r.y + r.h - 24);
      ctx.textAlign = 'left';
    } else if (grill.cooked) {
      ctx.fillStyle = '#ffb347'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('READY — click to plate it', r.x + r.w / 2, r.y + r.h - 24);
      ctx.textAlign = 'left';
    }
  } else {
    ctx.fillStyle = '#888'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('click to grill a patty', r.x + r.w / 2, r.y + r.h / 2 + 12);
    ctx.textAlign = 'left';
  }
}
function drawPlate() {
  const r = PLATE;
  ctx.fillStyle = '#e8e0d0'; rr(r.x, r.y, r.w, r.h, 10); ctx.fill();
  ctx.strokeStyle = '#9a8a70'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#5a4a30'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('PLATE  (click to remove last)', r.x + r.w / 2, r.y + 18);
  plate.forEach((ing, idx) => {
    const d = INGREDIENTS.find(v => v.name === ing);
    ctx.fillStyle = d ? d.color : '#888';
    ctx.fillRect(r.x + 20, r.y + r.h - (idx + 1) * 16 - 8, r.w - 40, 14);
  });
  if (plate.length === 0) {
    ctx.fillStyle = '#8a7a60'; ctx.font = '13px sans-serif';
    ctx.fillText('empty — build a dish here', r.x + r.w / 2, r.y + r.h / 2 + 8);
  }
  ctx.textAlign = 'left';
}
function drawServeBtn() {
  const r = SERVE_BTN;
  const match = matchedOrderIndex() >= 0;
  ctx.fillStyle = match ? '#2f8f2f' : '#555';
  rr(r.x, r.y, r.w, r.h, 10); ctx.fill();
  ctx.strokeStyle = match ? '#7dff6a' : '#888'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('SERVE', r.x + r.w / 2, r.y + 26);
  ctx.font = '12px sans-serif';
  ctx.fillText('or Space', r.x + r.w / 2, r.y + 44);
  ctx.textAlign = 'left';
}
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.ttl / 0.7);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawPopups() {
  ctx.textAlign = 'center';
  for (const p of popups) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.ttl));
    ctx.fillStyle = p.color; ctx.font = 'bold 26px sans-serif';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}
function drawTitle() {
  ctx.fillStyle = 'rgba(20,12,6,0.78)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#ffb347'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Sizzle & Serve', WIDTH / 2, HEIGHT / 2 - 70);
  ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif';
  ctx.fillText('A tiny street-kitchen rush', WIDTH / 2, HEIGHT / 2 - 28);
  ctx.font = '18px sans-serif';
  ctx.fillText('Click bins (or keys 1-6) to build dishes  •  Grill the patty, don\'t burn it', WIDTH / 2, HEIGHT / 2 + 8);
  ctx.fillText('Match the order board, then SERVE (or Space) before patience runs out', WIDTH / 2, HEIGHT / 2 + 36);
  ctx.fillStyle = '#ffd94d'; ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Press Enter to start  •  Best: ' + best, WIDTH / 2, HEIGHT / 2 + 82);
  ctx.textAlign = 'left';
}
function drawGameOver() {
  ctx.fillStyle = 'rgba(10,10,10,0.82)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#ff8a7a'; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Shift Over!', WIDTH / 2, HEIGHT / 2 - 50);
  ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif';
  ctx.fillText('Score: ' + score + '   •   Best: ' + best, WIDTH / 2, HEIGHT / 2 + 2);
  ctx.font = '20px sans-serif';
  ctx.fillText('Press R or Enter to play again', WIDTH / 2, HEIGHT / 2 + 44);
  ctx.textAlign = 'left';
}

function gameLoop(timestamp) {
  const dt = Math.min(100, timestamp - lastTick);
  lastTick = timestamp;
  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}
// Debug probe (read-only state for automated playtesting; not used by the game).
window.__sizzle = {
  get state() { return currentState; },
  get score() { return score; },
  get lives() { return lives; },
  get combo() { return combo; },
  get timer() { return timer; },
  get orders() { return orders.map(o => ({ name: o.name, ingredients: o.ingredients.slice(), patience: o.patience, elapsed: o.elapsed })); },
  get plate() { return plate.slice(); },
  get grill() { return { ...grill }; },
  get best() { return best; },
};
requestAnimationFrame(gameLoop);

// ---------------------------------------------------------------------------
// POLISH LAYER — revision 1: "rush hour" pressure and a served flash.
// The shift ramps on its own, but nothing on the screen said so. This layer
// makes the last half minute *read* as a rush: the clock cell goes red and
// pulses, a thin red frame breathes around the kitchen, and orders come a
// little quicker; and every good serve now leaves one bright green flash on
// the order board where the ticket used to be, so the eye follows the reward.
// Everything is wired by wrapping the existing functions, never by rewriting
// them, so the rules, the shot staging and the __sizzle probe stay as they are.
// ---------------------------------------------------------------------------

const RUSH_WINDOW = 30;        // seconds left when the rush is called
const RUSH_FLOOR = 4.5;        // fastest order pacing, never below this

let servedFlashSlot = -1;      // board slot a served ticket just vacated
let servedFlashTtl = 0;        // seconds of flash left
let servedFlashText = '';      // points the flash is bragging about

// A serve that matches is the only moment score goes up inside tryServe, so
// remember the slot first, compare the score after, and flash if it landed.
const baseTryServe = tryServe;
tryServe = function patchedServe() {
  const before = score;
  const slot = matchedOrderIndex();
  baseTryServe();
  if (slot >= 0 && score > before) {
    servedFlashSlot = slot;
    servedFlashText = '+' + (score - before);
    servedFlashTtl = 0.9;
  }
};

// During the rush the kitchen pushes tickets harder, but the early shift is
// left exactly as it was so a fresh board still breathes.
const baseSpawnInterval = spawnInterval;
spawnInterval = function patchedSpawnInterval() {
  const base = baseSpawnInterval();
  return Math.max(RUSH_FLOOR, timer <= RUSH_WINDOW ? base - 1.5 : base);
};

const baseUpdate = update;
update = function patchedUpdate(dt) {
  baseUpdate(dt);
  if (servedFlashTtl > 0) servedFlashTtl = Math.max(0, servedFlashTtl - dt / 1000);
};

/** The red frame and the red clock: a slow pulse, not a strobe. */
function drawRushHour() {
  if (currentState !== STATE.PLAY || paused || timer > RUSH_WINDOW) return;
  const now = performance.now();
  const pulse = 0.5 + 0.5 * Math.sin(now / 190);   // 0..1
  // Warm the walls a touch, as if the room got hotter.
  ctx.fillStyle = 'rgba(198, 46, 24, ' + (0.05 + 0.05 * pulse).toFixed(3) + ')';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // A frame that breathes at the edge of the screen.
  ctx.strokeStyle = 'rgba(255, 92, 64, ' + (0.35 + 0.4 * pulse).toFixed(3) + ')';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, WIDTH - 6, HEIGHT - 6);
  // Repaint the clock cell in red so the last seconds are felt, not read.
  ctx.fillStyle = '#57402a';
  ctx.fillRect(8, 12, 268, 34);
  ctx.textAlign = 'left';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = pulse > 0.5 ? '#ff6a4d' : '#ffd0c4';
  ctx.fillText('Time: ' + Math.max(0, Math.ceil(timer)) + 's', 16, 40);
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = 'rgba(255, 138, 110, ' + (0.55 + 0.45 * pulse).toFixed(3) + ')';
  ctx.fillText('RUSH HOUR', 180, 38);
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = 'rgba(255, 190, 175, ' + (0.4 + 0.4 * pulse).toFixed(3) + ')';
  ctx.fillText('the pass is filling up', WIDTH / 2, 104);
  ctx.textAlign = 'left';
}

/** Green flash where the served ticket was, so the reward has a place. */
function drawServedFlash() {
  if (servedFlashTtl <= 0 || servedFlashSlot < 0) return;
  const w = 250, h = 86, x = 16, y = 118 + servedFlashSlot * (h + 10);
  const a = Math.min(1, servedFlashTtl / 0.9);
  ctx.save();
  ctx.globalAlpha = a * 0.55;
  ctx.fillStyle = '#6dff5a';
  rr(x, y, w, h, 8);
  ctx.fill();
  ctx.globalAlpha = Math.min(1, a * 1.6);
  ctx.textAlign = 'center';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = '#0d3d10';
  ctx.fillText('SERVED ' + servedFlashText, x + w / 2, y + h / 2 + 8);
  ctx.restore();
  ctx.textAlign = 'left';
}

// Paint the rush layer on top of the kitchen, every frame.
const baseDraw = draw;
draw = function patchedDraw() {
  baseDraw();
  drawServedFlash();
  drawRushHour();
};

// ---------------------------------------------------------------------------
// POLISH LAYER — revision 2: food that looks worth serving, and a title card.
// The plate used to be a stack of flat colour bars, which read as a chart, not
// as a burger. This pass draws each ingredient as a small shape of its own —
// sesame bun domes, a charred patty, ruffled lettuce, a tomato slice with
// pips, a cheese corner drooping over the edge, a zigzag of sauce — stacked
// bottom-up inside the plate so the assembly grows upward as you build it.
// Shapes are pure canvas paths, drawn from the same colours already in
// INGREDIENTS, so the bins on the counter stay recognisable as the food.
// ---------------------------------------------------------------------------

/** Plate geometry shared by the stacking and the layout maths. */
const PLATE_INNER = { left: PLATE.x + 22, right: PLATE.x + PLATE.w - 22, bottom: PLATE.y + PLATE.h - 14 };

function bunShape(cx, cy, w, dark) {
  // A dome with a flat base and a few sesame seeds on top.
  ctx.fillStyle = dark ? '#b8823c' : '#e8b06a';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy + 6);
  ctx.quadraticCurveTo(cx - w / 2, cy - 12, cx, cy - 12);
  ctx.quadraticCurveTo(cx + w / 2, cy - 12, cx + w / 2, cy + 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 74, 26, 0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (!dark) {
    ctx.fillStyle = '#fff3d0';
    for (let s = -2; s <= 2; s++) {
      ctx.beginPath();
      ctx.ellipse(cx + s * (w / 7), cy - 5 - Math.abs(s) * 0.6, 2.2, 1.4, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function pattyShape(cx, cy, w, burnt) {
  ctx.fillStyle = burnt ? '#2a1c14' : '#7a4a2b';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2, w / 2, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Grill marks: three pale-brown bars across the meat.
  ctx.strokeStyle = burnt ? '#4a3628' : 'rgba(196, 138, 84, 0.85)';
  ctx.lineWidth = 1.6;
  for (let g = -1; g <= 1; g++) {
    ctx.beginPath();
    ctx.moveTo(cx + g * (w / 4), cy - 1);
    ctx.lineTo(cx + g * (w / 4) + 7, cy + 5);
    ctx.stroke();
  }
}

function lettuceShape(cx, cy, w) {
  // A row of overlapping frills.
  ctx.fillStyle = '#7dc242';
  const frills = 5;
  for (let i = 0; i < frills; i++) {
    const fx = cx - w / 2 + (i + 0.5) * (w / frills);
    ctx.beginPath();
    ctx.arc(fx, cy, w / (frills * 1.6), Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = '#96d85a';
  for (let i = 0; i < frills; i++) {
    const fx = cx - w / 2 + (i + 0.6) * (w / frills);
    ctx.beginPath();
    ctx.arc(fx, cy - 1.5, w / (frills * 2.4), Math.PI, 0);
    ctx.fill();
  }
}

function tomatoShape(cx, cy, w) {
  ctx.fillStyle = '#e23b3b';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.42, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff7b6b';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 1, w * 0.32, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd7b0';
  for (let p = -1; p <= 1; p++) {
    ctx.beginPath();
    ctx.arc(cx + p * (w * 0.12), cy, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function cheeseShape(cx, cy, w) {
  // A square slice with one corner melting over the edge of the stack.
  ctx.fillStyle = '#ffcf3f';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - 4);
  ctx.lineTo(cx + w / 2, cy - 4);
  ctx.lineTo(cx + w / 2, cy + 3);
  ctx.quadraticCurveTo(cx + w * 0.18, cy + 11, cx - w * 0.1, cy + 3);
  ctx.lineTo(cx - w / 2, cy + 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 150, 20, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function sauceShape(cx, cy, w) {
  // A squeeze bottle zigzag, the way sauce lands on a real bun.
  ctx.strokeStyle = '#c94f1e';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const x = cx - w / 2 + (i / steps) * w;
    const y = cy + (i % 2 === 0 ? -3 : 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** One ingredient as a shape, `cy` being the middle of its own layer. */
function drawIngredientShape(name, cx, cy, w) {
  switch (name) {
    case 'Bun': bunShape(cx, cy, w, false); break;
    case 'Patty': pattyShape(cx, cy, w, false); break;
    case 'Lettuce': lettuceShape(cx, cy, w); break;
    case 'Tomato': tomatoShape(cx, cy, w); break;
    case 'Cheese': cheeseShape(cx, cy, w); break;
    case 'Sauce': sauceShape(cx, cy, w); break;
    default: {
      const d = INGREDIENTS.find(v => v.name === name);
      ctx.fillStyle = d ? d.color : '#888';
      ctx.fillRect(cx - w / 2, cy - 6, w, 12);
    }
  }
}

/** Bun lid drawn last, on top of whatever the dish ended with. */
function bunLidShape(cx, cy, w) {
  bunShape(cx, cy, w, false);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.14, cy - 4, w * 0.16, 3, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

// The plate is now a composed dish: a ceramic well, a rim shadow, and the
// ingredients stacked from the bottom edge upward, oldest layer lowest.
const baseDrawPlate = drawPlate;
drawPlate = function patchedDrawPlate() {
  const r = PLATE;
  // Ceramic well with a little depth.
  const grd = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 12, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.72);
  grd.addColorStop(0, '#f6f1e6');
  grd.addColorStop(1, '#d9cfba');
  ctx.fillStyle = grd;
  rr(r.x, r.y, r.w, r.h, 14); ctx.fill();
  ctx.strokeStyle = '#9a8a70'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
  rr(r.x + 5, r.y + 5, r.w - 10, r.h - 10, 11); ctx.stroke();
  ctx.fillStyle = '#5a4a30'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('PLATE  (click to remove last)', r.x + r.w / 2, r.y + 18);

  const cx = r.x + r.w / 2;
  const layerH = 15;
  const baseY = PLATE_INNER.bottom;
  const width = PLATE_INNER.right - PLATE_INNER.left - 8;
  plate.forEach((ing, idx) => {
    drawIngredientShape(ing, cx, baseY - idx * layerH - 6, width);
  });
  // A lid goes on top of the last bun of a finished-looking stack, so a full
  // plate reads as a burger rather than an open-faced pile.
  if (plate.length > 0 && plate[plate.length - 1] === 'Bun' && plate.length >= 3) {
    bunLidShape(cx, baseY - (plate.length - 1) * layerH - 12, width - 10);
  }
  if (plate.length === 0) {
    ctx.fillStyle = '#8a7a60'; ctx.font = '13px sans-serif';
    ctx.fillText('empty — build a dish here', cx, r.y + r.h / 2 + 8);
  }
  ctx.textAlign = 'left';
};

// The title used to be 78% dim, so the bins and the SERVE button ghosted
// through the copy. A dark card under the text keeps every line readable
// while the kitchen stays visible around it.
const baseDrawTitle = drawTitle;
drawTitle = function patchedDrawTitle() {
  ctx.fillStyle = 'rgba(14, 9, 5, 0.86)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const cw = 720, ch = 300;
  const cx = WIDTH / 2 - cw / 2, cy = HEIGHT / 2 - 170;
  ctx.fillStyle = 'rgba(36, 24, 14, 0.97)';
  rr(cx, cy, cw, ch, 18); ctx.fill();
  ctx.strokeStyle = '#8a6236'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 179, 71, 0.35)'; ctx.lineWidth = 1;
  rr(cx + 8, cy + 8, cw - 16, ch - 16, 13); ctx.stroke();
  baseDrawTitle();
};

// ---------------------------------------------------------------------------
// POLISH LAYER — revision 3: the title card, done properly.
// Revision 2 laid a card down and then called the old title painter, which
// repaints a full-screen dim *over* the card and flattened it back into the
// background (a pixel probe showed the card at 23,14,8 against 20,11,6 just
// outside it: invisible). So the title is now painted in one pass: dim the
// kitchen, lay a warm card with a lit border and a soft glow, then set the
// copy on top of it. The kitchen still shows faintly at the edges, which is
// what tells a first-time player there is a game under the card.
// ---------------------------------------------------------------------------

drawTitle = function patchedDrawTitleFinal() {
  // 1. Dim the kitchen right down so nothing ghosts through the copy.
  ctx.fillStyle = 'rgba(12, 8, 4, 0.90)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 2. A warm card with a lit inner border and a soft glow under the title.
  const cw = 760, ch = 320;
  const cx = WIDTH / 2 - cw / 2, cy = HEIGHT / 2 - 176;
  const glow = ctx.createRadialGradient(WIDTH / 2, cy + 70, 20, WIDTH / 2, cy + 70, 320);
  glow.addColorStop(0, 'rgba(255, 179, 71, 0.20)');
  glow.addColorStop(1, 'rgba(255, 179, 71, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 60, cy - 40, cw + 120, ch + 120);
  ctx.fillStyle = 'rgba(46, 30, 17, 0.98)';
  rr(cx, cy, cw, ch, 18); ctx.fill();
  ctx.strokeStyle = '#c08a4a'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 200, 120, 0.30)'; ctx.lineWidth = 1;
  rr(cx + 8, cy + 8, cw - 16, ch - 16, 13); ctx.stroke();

  // 3. The copy, centred inside the card.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb347'; ctx.font = 'bold 62px sans-serif';
  ctx.fillText('Sizzle & Serve', WIDTH / 2, cy + 82);
  ctx.fillStyle = '#f3e3c8'; ctx.font = '23px sans-serif';
  ctx.fillText('A tiny street-kitchen rush', WIDTH / 2, cy + 122);
  ctx.fillStyle = '#cfbb9c'; ctx.font = '17px sans-serif';
  ctx.fillText('Click bins (or keys 1-6) to build dishes  •  Grill the patty, don\'t burn it', WIDTH / 2, cy + 166);
  ctx.fillText('Match the order board, then SERVE (or Space) before patience runs out', WIDTH / 2, cy + 194);
  ctx.fillStyle = '#ffd94d'; ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Press Enter to start', WIDTH / 2, cy + 248);
  ctx.fillStyle = '#bda98a'; ctx.font = '16px sans-serif';
  ctx.fillText('Best: ' + best + '   •   P pause   •   M mute   •   R restart', WIDTH / 2, cy + 282);
  ctx.textAlign = 'left';
};
