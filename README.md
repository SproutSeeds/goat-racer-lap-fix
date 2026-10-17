# GOAT Racer: prevent backtracking from earning browser laps

I reproduced a lap-counting bug in the public browser race: driving back and
forth within a 6.25 m straight earns three laps on the 77.70 m Oval without
completing a circuit. This handoff contains my proposed browser fix and the
regression tests for it.

The fix keeps the existing distance used by ghosts and rankings, and adds a
separate completion-progress value that subtracts backtracking. Completed laps
stay credited. An off-world respawn clears partial progress and cannot award a
lap on the respawn step.

**Verified locally:** 12 Node regression tests pass. Four local Chrome replay
cases also passed on October 16, 2026. Genuine forward laps keep their exact
events and times. The live application and authoritative server have not been
updated by this work.

## Give this task to an agent in the GOAT Racer application

Read this handoff and the application's own repository instructions. Reproduce
the included lap-counting case, integrate the completion-progress correction
into the browser and corresponding server replay code, and run the acceptance
cases below. Preserve vehicle dynamics and the existing ghost/rank inputs.
Follow the application's contribution and release process, and report the
changed files, tests and any remaining integration limits.

## Run the standalone checks

Clone this repository or download its ZIP, then run from the extracted folder:

```sh
node verify.mjs
```

Tested with Node 24.10.0; use Node 22 or newer. There are no npm dependencies.
The first run fetches four small public inputs directly from goatracer.ai,
checks their SHA-256 hashes, runs the tests, and writes `fixed/plant.js`.
Original inputs are retained unchanged in `private-source/`. Subsequent runs
reuse these local inputs after checking their hashes.

Expected: **12 tests passed, 0 failed**, followed by the fixed module's SHA-256.
The command writes only inside this handoff checkout. It does not submit scores
or modify an application checkout. The source inputs and generated module are
excluded from Git by the included `.gitignore`.

If the published source has changed, the command stops for review. Locate the
current implementation and port the small correction intentionally; keep the
old hashes as the record of what these tests actually cover.

## Integrate into the application

1. Locate the browser `static/js/race/plant.js` and its current callers. The
   reviewed source hash is in `patch-build.json`. `lap-completion-patch.mjs`
   contains the full source transformation and refuses any different input.
2. Run the checks above and inspect the change with
   `git diff --no-index private-source/plant.js fixed/plant.js`. A diff exits
   with status 1 when it finds the intended changes.
3. Add `lap_progress` to new race state. Update it with signed, unwrapped arc
   movement, floored at the last completed lap. Use it for completion and lap
   time interpolation. Keep the existing monotonic `arc_travel` unchanged.
4. On the existing off-world condition, discard partial completion progress
   and suppress the lap event for that step. Retain the current timer, vehicle
   correction and crash behavior. Verify all reset/state-construction paths.
5. Inspect the authoritative server replay implementation. The public browser
   code references a Python counterpart; verify its actual location and lap
   contract in this checkout. Apply equivalent bookkeeping if it shares the
   defect, then compare browser/server lap events on identical recorded inputs.
6. Run the application's own checks, then exercise a complete browser race,
   restart, ghost playback and server replay/score validation in its normal
   development environment. Leave production rollout to its release process.

The generated file is useful for comparison against the pinned revision. Use
the reviewed change in the current application so newer upstream work stays
intact.

## Acceptance cases

| Replay | Original laps | Fixed laps |
| --- | ---: | ---: |
| Back and forth on one short straight | 3 | 0 |
| Three genuine forward circuits | 3 | 3 |
| Stationary for 1,000 ticks | 0 | 0 |
| Backtracking, then three genuine circuits | 5 | 3 |

The genuine-lap event times are 71,200, 71,000 and 70,933 ms. Each paired replay
checks 17 legacy state fields, including motion, collision bookkeeping and
`arc_travel`. The exported-replay check preserves every trajectory column and
collision flag.

Boundary tests cover finish-line oscillation, reversing across the start before
the first lap, a reverse circuit followed by a forward circuit, restart, and
off-world respawn before and after a completed lap. Another test rejects changed
upstream source. Controlled projected-arc boundary tests isolate bookkeeping;
the four driving cases use the actual published Oval model.

## Files and scope

- `lap-completion-patch.mjs`: proposed correction for the pinned browser source.
- `lap-completion.test.mjs`: the 12 regression tests.
- `verify.mjs`: input retrieval, hash checks, test runner and local output.
- `baseline.json`: original counterexample and diagnostic measurements. Its
  `diagnostic` fields describe the earlier signed-distance experiment; the tests
  exercise the separate completion-progress implementation in this handoff.
- `patch-build.json`: original and patched source hashes.
- `browser-results.json`: the dated four-case Chrome replay result.

This handoff publishes the authored correction and tests. It retrieves the original
website modules from their existing public URLs when run. Authoritative server
parity, full hosted-race UI integration, broader shortcut/projection rules and
maintainer acceptance remain to be checked. These tests concern browser lap
accounting; AI training and physical-car behavior were not evaluated.

GOAT Racer's application, vehicle model and track data belong to their respective
authors. My contribution here is the reproduction, proposed correction and
regression coverage.

Cody Mitchell
