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
