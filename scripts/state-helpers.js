/**
 * Per-post state.json helpers. Each post directory has a state.json that
 * tracks where it is in the pipeline:
 *
 *   status: pending | generated | generated-partial | overlaid | overlaid-partial
 *           | posted | posted-partial
 *   slides: [
 *     { index, raw, final, generated, overlaid, lastError? }
 *   ]
 *   instagram: { childContainerIds, carouselId, mediaId, postedAt }
 *   tiktok:    { publishId, status, postedAt }
 *   facebook:  { postId, postedAt }
 *
 * Atomic writes (tmp file + rename) so a crash mid-write doesn't corrupt.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = 'state.json';

function statePath(postDir) {
  return path.join(postDir, STATE_FILE);
}

function readState(postDir) {
  const p = statePath(postDir);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (e) { console.warn(`state.json unreadable in ${postDir}: ${e.message}`); return null; }
}

function writeState(postDir, state) {
  const p = statePath(postDir);
  const tmp = `${p}.tmp`;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

function updateState(postDir, mutator) {
  const state = readState(postDir) || {};
  mutator(state);
  writeState(postDir, state);
  return state;
}

module.exports = { readState, writeState, updateState };
