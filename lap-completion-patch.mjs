import { createHash } from 'node:crypto';

// Keep the downloaded upstream module private and unchanged. Apply this small
// source transformation only to the exact browser revision we inspected.
export const originalPlantSha256 = '92ddc8a86edb796d579355277e11166fedc7fddfc2ef06c7dfdcffe64533b831';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function patchLapCompletion(source) {
  if (sha256(source) !== originalPlantSha256) {
    throw new Error('Unreviewed plant.js revision; original source was not changed.');
  }
  const edits = [
    ['arc_travel: 0, lap_origin: 0', 'arc_travel: 0, lap_progress: 0, lap_origin: 0'],
    ['  s.prev_arc = arc;\n', [
      '  // Completion progress repays backtracking; ghost/rank distance stays monotonic.',
      '  const prevLapProgress = s.lap_progress;',
      '  const offworld = Math.abs(lateral) > hw + P.offworld_margin_m;',
      '  s.lap_progress = offworld ? s.lap_origin : Math.max(s.lap_origin, prevLapProgress + dArc);',
      '  s.prev_arc = arc;',
      '',
    ].join('\n')],
    ['if (s.arc_travel - s.lap_origin >= total)', 'if (!offworld && s.lap_progress - s.lap_origin >= total)'],
    ['const dPos = s.arc_travel - prevTravel;', 'const dPos = s.lap_progress - prevLapProgress;'],
    ['(s.lap_origin + total - prevTravel) / dPos', '(s.lap_origin + total - prevLapProgress) / dPos'],
  ];
  let patched = source;
  for (const [before, after] of edits) {
    if (patched.split(before).length !== 2) throw new Error('Patch anchor is missing or ambiguous.');
    patched = patched.replace(before, after);
  }
  return patched;
}
