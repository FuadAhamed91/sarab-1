/* Telecommand panel: signs a command with the team's key, sends it up to the cube and
   watches the telemetry for the cube's answer. In the test transmitter tab the same key
   field holds the key that tab accepts while it stands in for the cube. */
import { COMMANDS, REJECT, canSign, sign } from './command.js';
import { hms } from './panels.js';

const WAIT = 10000;

export function createTelecommand({ link, transmit }) {
  const $ = id => document.getElementById(id);
  const key = $('cmdKey'), status = $('cmdStatus'), btns = [...document.querySelectorAll('[data-cmd]')];
  let pending = null, result = null, ready = false, lastTs = 0;
  if (transmit) { $('cmdKeyLab').textContent = 'Key this test cube accepts'; $('cmdBtns').hidden = true; }

  const say = (text, tone = '') => { if (status.textContent !== text) status.textContent = text; status.dataset.tone = tone; };
  function render() {
    btns.forEach(b => { b.disabled = !ready || !key.value || !!pending || !canSign(); });
    if (transmit) return result ? say(result.text, result.tone) : say('This tab is standing in for the cube: it runs commands signed with the key above, exactly as the firmware does.');
    if (pending) return say(`Sent “${COMMANDS[pending.cmd].name}” at ${hms(pending.at)} UTC. Waiting for the cube to answer…`, 'wait');
    if (result) return say(result.text, result.tone);
    if (!canSign()) return say('Signing needs a secure page (https or localhost).', 'warn');
    if (!ready) return say('Unlocks while the cube is live. Commands only ever go to the real cube, never to the simulation.');
    say(key.value ? 'Ready. The cube answers within a couple of seconds.' : 'Enter the team’s command key to unlock the buttons.');
  }

  async function send(cmd) {
    if (pending || !ready || !key.value) return;
    const ts = Math.max(Math.floor(Date.now() / 1000), lastTs + 1);    // the cube only runs commands newer than its last one
    lastTs = ts; result = null;
    pending = { cmd, ts, at: Date.now(), timer: 0 };
    render();
    let sig;
    try { sig = await sign(key.value, cmd, ts); } catch (e) { pending = null; result = { text: 'This browser couldn’t sign the command.', tone: 'warn' }; return render(); }
    if (!link.command({ cmd, ts, sig })) { pending = null; result = { text: 'No relay connected, so nothing was sent.', tone: 'warn' }; return render(); }
    pending.timer = setTimeout(() => { pending = null; result = { text: `No answer from the cube within ${WAIT / 1000} s. It may have just gone offline.`, tone: 'warn' }; render(); }, WAIT);
  }
  btns.forEach(b => b.addEventListener('click', () => send(b.dataset.cmd)));
  key.addEventListener('input', () => { if (!pending) result = null; render(); });
  render();

  return {
    /* live: the cube is transmitting right now; ack: the answer in its latest packet */
    update(live, ack) {
      ready = live;
      if (pending && ack && ack.ts === pending.ts) {
        clearTimeout(pending.timer);
        const c = COMMANDS[pending.cmd];
        result = ack.ok ? { text: `The cube accepted “${c.name}” at ${hms(Date.now())} UTC. ${c.done}`, tone: 'good' }
          : { text: `The cube rejected “${c.name}”. ${REJECT[ack.why] || 'It failed the cube’s checks.'}`, tone: 'warn' };
        pending = null;
      }
      render();
    },
    /* test transmitter: say what this tab, standing in for the cube, did with a command */
    note(text, tone) { result = { text, tone }; render(); },
    key: () => key.value
  };
}
