import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchLapCompletion, sha256 } from './lap-completion-patch.mjs';

const fixtureRoot = new URL('./private-source/', import.meta.url);
const canonical = JSON.parse(fs.readFileSync(new URL('./baseline.json', import.meta.url)));
const source = {};
for (const [name, hash] of Object.entries(canonical.inputs)) {
  const bytes = fs.readFileSync(new URL(name, fixtureRoot));
  assert.equal(sha256(bytes), hash, `Original fixture changed: ${name}`);
  source[name] = bytes.toString('utf8');
}
const load = text => import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
const original = await load(source['plant.js']);
const fixed = await load(patchLapCompletion(source['plant.js']));
const { TrackModel } = await load(source['track_model.js']);
const params = JSON.parse(source['race-params.json']);
const model = new TrackModel(JSON.parse(source['oval-model.json']));
const P = original.taskParams(params, 'gump_v2_player');
const unchangedKeys = ['x', 'y', 'yaw', 'v', 'steer', 'wheel_u', 'drive', 'prev_x', 'prev_y',
  'prev_arc', 'arc_travel', 'crashes', 'ray_min', 'crashed', 'contact', 'lateral', 'in_hit'];
const initialState = plant => {
  const state = plant.newState(model.start.x, model.start.y, model.start.yaw);
  state.prev_arc = model.project(state.x, state.y)[0];
  return state;
};

function pursuit(state) {
  const [arc] = model.project(state.x, state.y);
  const [x, y] = model.pointAtArc(arc + 1.5);
  const bearing = Math.atan2(y - state.y, x - state.x) - state.yaw;
  const alpha = Math.atan2(Math.sin(bearing), Math.cos(bearing));
  const steer = Math.atan2(2 * P.L * Math.sin(alpha), 1.5) / P.steer_max_rad;
  return [Math.round(Math.max(-1, Math.min(1, steer)) * 1000) / 1000, 0.12];
}
function shuttle() {
  let direction = 1;
  return state => {
    if (state.x > -4) direction = -1;
    if (state.x < -9) direction = 1;
    return [0, 0.12 * direction];
  };
}
function compare(actions, ticks) {
  const before = initialState(original), after = initialState(fixed);
  const inputs = [], events = { original: [], fixed: [] };
  let minX = before.x, maxX = before.x, forwardCrossings = 0, previousArc = before.prev_arc;
  for (let tick = 1; tick <= ticks; tick++) {
    const action = actions(before, tick);
    inputs.push(...action.map(a => Math.round(a * 1000)));
    original.step(before, action, P, model, tick);
    fixed.step(after, action, P, model, tick);
    for (const key of unchangedKeys) assert.equal(after[key], before[key], `${key} at tick ${tick}`);
    if (previousArc > model.total * 0.8 && after.prev_arc < model.total * 0.2) forwardCrossings++;
    previousArc = after.prev_arc;
    minX = Math.min(minX, after.x); maxX = Math.max(maxX, after.x);
    for (const [name, state] of [['original', before], ['fixed', after]]) {
      if (state.lap) events[name].push({ tick, lap: state.laps, lapMs: state.lap_ms });
    }
  }
  return { before, after, inputs, events, forwardCrossings, excursion: maxX - minX };
}

test('repeated partial-track travel earns zero laps; all motion and legacy progress match', () => {
  const result = compare(shuttle(), canonical.cases[0].ticks);
  assert.equal(result.before.laps, 3);
  assert.equal(result.after.laps, 0);
  assert.equal(result.forwardCrossings, 0);
  assert.ok(result.excursion < 6.3);
  assert.equal(result.after.crashes, 0);
});

test('three genuine circuits preserve exact lap events, times, motion and ghost/rank distance', () => {
  const result = compare(pursuit, canonical.cases[1].ticks);
  assert.equal(result.after.laps, 3);
  assert.equal(result.forwardCrossings, 3);
  assert.deepEqual(result.events.fixed, canonical.cases[1].events.original);
  assert.deepEqual(result.events.fixed, result.events.original);
});

test('stationary vehicle earns no progress or laps', () => {
  const result = compare(() => [0, 0], 1000);
  assert.equal(result.after.laps, 0);
  assert.equal(result.after.lap_progress, 0);
});

test('three genuine circuits after backtracking earn three laps instead of five', () => {
  const action = shuttle();
  const result = compare((s, tick) => tick <= canonical.cases[0].ticks ? action(s) : pursuit(s), canonical.cases[3].ticks);
  assert.equal(result.before.laps, 5);
  assert.equal(result.after.laps, 3);
  assert.equal(result.forwardCrossings, 3);
});

test('exported replay retains every legacy trajectory column and only corrects lap accounting', () => {
  const result = compare(shuttle(), canonical.cases[0].ticks);
  const a = original.run(result.inputs, P, model);
  const b = fixed.run(result.inputs, P, model);
  assert.deepEqual(b.states, a.states);
  assert.deepEqual(b.flags.crash, a.flags.crash);
  assert.deepEqual(b.flags.contact, a.flags.contact);
  assert.deepEqual(b.crashes, a.crashes);
  assert.equal(a.laps.length, 3);
  assert.equal(b.laps.length, 0);
});

// Controlled projected-arc inputs isolate boundary accounting from driving.
// These are synthetic contract tests, separate from the real Oval replays above.
function projectedTrack() {
  let arc = 0, lateral = 0;
  const track = {
    total: 100, halfw: [1], start: { x: 0, y: 0, yaw: 0 },
    project: () => [arc, lateral, 0], rayMinNear: () => 10,
    crossed: () => false, pointAtArc: () => [0, 0, 1, 0],
  };
  let state = fixed.newState(), tick = 0;
  return {
    get state() { return state; },
    step(nextArc, nextLateral = 0) {
      arc = nextArc; lateral = nextLateral;
      fixed.step(state, [0, 0], P, track, ++tick);
      return state;
    },
    reset() { state = fixed.newState(); arc = lateral = tick = 0; },
  };
}

test('finish-line oscillation cannot earn extra laps; a following full circuit can', () => {
  const harness = projectedTrack();
  for (const arc of [25, 50, 75, 99, 1]) harness.step(arc);
  assert.equal(harness.state.laps, 1);
  const lapTime = harness.state.lap_ms;
  for (let repeat = 0; repeat < 200; repeat++) {
    harness.step(99); harness.step(1);
  }
  assert.equal(harness.state.laps, 1);
  assert.equal(harness.state.lap, 0);
  assert.equal(harness.state.lap_ms, lapTime);
  assert.ok(harness.state.arc_travel > 400);
  for (const arc of [25, 50, 75, 99, 1]) harness.step(arc);
  assert.equal(harness.state.laps, 2);
});

test('reversing across the start before the first lap cannot manufacture a lap', () => {
  const harness = projectedTrack();
  for (let repeat = 0; repeat < 200; repeat++) {
    harness.step(99); harness.step(1);
  }
  assert.equal(harness.state.laps, 0);
  assert.ok(harness.state.lap_progress <= 2);
});

test('a reverse circuit does not create unbounded debt for the next genuine forward circuit', () => {
  const harness = projectedTrack();
  for (const arc of [75, 50, 25, 0]) harness.step(arc);
  assert.equal(harness.state.laps, 0);
  assert.equal(harness.state.lap_progress, 0);
  for (const arc of [25, 50, 75, 0]) harness.step(arc);
  assert.equal(harness.state.laps, 1);
});

test('race restart clears completed and partial lap state', () => {
  const harness = projectedTrack();
  for (const arc of [25, 50, 75, 0, 25, 50]) harness.step(arc);
  assert.equal(harness.state.laps, 1);
  harness.reset();
  assert.equal(harness.state.laps, 0);
  assert.equal(harness.state.lap_progress, 0);
  assert.equal(harness.state.lap_origin, 0);
  for (const arc of [25, 50, 75]) harness.step(arc);
  assert.equal(harness.state.laps, 0);
  harness.step(0);
  assert.equal(harness.state.laps, 1);
});

test('off-world respawn invalidates partial progress and awards no lap on that step', () => {
  const harness = projectedTrack();
  for (const arc of [25, 50, 75, 99]) harness.step(arc);
  harness.step(1, 10);
  assert.equal(harness.state.crashed, 1);
  assert.equal(harness.state.laps, 0);
  assert.equal(harness.state.lap, 0);
  assert.equal(harness.state.lap_progress, 0);
  for (const arc of [26, 51, 76, 1]) harness.step(arc);
  assert.equal(harness.state.laps, 1);
});

test('an off-world respawn preserves completed laps and restarts only partial progress', () => {
  const harness = projectedTrack();
  for (const arc of [25, 50, 75, 0, 25, 50, 75, 99]) harness.step(arc);
  harness.step(1, 10);
  assert.equal(harness.state.laps, 1);
  assert.equal(harness.state.lap_origin, 100);
  assert.equal(harness.state.lap_progress, 100);
  for (const arc of [26, 51, 76, 1]) harness.step(arc);
  assert.equal(harness.state.laps, 2);
});

test('patch construction refuses unreviewed source instead of making a partial edit', () => {
  assert.throws(() => patchLapCompletion(source['plant.js'] + '\n'), /Unreviewed/);
});
