/* Signed telecommands. The dashboard signs "cmd|ts" with HMAC-SHA256 using the team's
   command key. The cube (firmware/sarab1/sarab1.ino) runs a command only if the signature
   matches, the time stamp is within 2 minutes of its own clock and newer than the last
   command it ran, then reports the outcome in the "ack" field of its telemetry. */

export const COMMANDS = {
  replay_spoof: { name: 'Spoofing replay test', done: 'It is replaying a recorded spoofed signal for 20 s to prove detection works.' },
  recal: { name: 'Recalibrate baseline', done: 'It is relearning the clean baseline; detection restarts in about a minute.' }
};
export const REJECT = {
  signature: 'Wrong command key: the signature didn’t match, so the cube ignored it.',
  stale: 'It was too old or already used, so the cube ignored it. Check this computer’s clock.',
  clock: 'The cube’s clock isn’t set yet (no internet time), so it can’t check freshness.',
  unknown: 'The cube doesn’t know that command.'
};
export const MAX_AGE_S = 120;

const enc = new TextEncoder();
export const canSign = () => !!(window.crypto && crypto.subtle);

export async function sign(key, cmd, ts) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${cmd}|${ts}`)));
  return Array.from(mac, b => b.toString(16).padStart(2, '0')).join('');
}

/* The firmware's checks, for the test transmitter standing in for the cube. Returns the reason to reject, or null. */
export async function check(key, msg, lastTs, nowS = Math.floor(Date.now() / 1000)) {
  const cmd = String(msg.cmd || ''), ts = Math.trunc(+msg.ts) || 0;
  if (!COMMANDS[cmd]) return 'unknown';
  if (Math.abs(nowS - ts) >= MAX_AGE_S || ts <= lastTs) return 'stale';
  if (!key || String(msg.sig || '').toLowerCase() !== await sign(key, cmd, ts)) return 'signature';
  return null;
}

/* "ok:recal:1761210000" or "rejected:recal:1761210000:signature" */
export const ackText = (cmd, ts, why) => why ? `rejected:${cmd}:${ts}:${why}` : `ok:${cmd}:${ts}`;
export function parseAck(s) {
  if (typeof s !== 'string') return null;
  const [res, cmd, ts, why] = s.split(':');
  if (res !== 'ok' && res !== 'rejected') return null;
  return { raw: s, ok: res === 'ok', cmd: cmd || '?', ts: ts && isFinite(+ts) ? +ts : null, why: why || null };
}
