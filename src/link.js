/* Downlink: the cube publishes one JSON packet per second to a public MQTT relay.
   The ground station listens on two relays at once over secure WebSockets, so the
   link keeps working if one relay is slow or down; duplicate packets are dropped.
   Signed telecommands go up the same way, on their own topic. */

export const TOPIC = 'sarab1/cb-7f3a91/tm';
export const CMD_TOPIC = 'sarab1/cb-7f3a91/cmd';
export const BROKERS = [
  { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' }
];

/* onPacket(pkt, relay, retained): retained is true for the relay's stored copy of the
   cube's last packet, which can be hours old. onCommand is only for the test transmitter. */
export function createLink({ onPacket, onStatus, onCommand }) {
  const lib = window.mqtt;
  if (!lib || typeof lib.connect !== 'function') {
    onStatus({ state: 'unavailable', up: [] });
    return { publish() { return false; }, command() { return false; }, close() {} };
  }
  let closed = false;
  const seen = new Map();          // message key -> time, to drop the copy arriving via the second relay
  const fresh = key => {
    const now = Date.now();
    if (seen.has(key)) return false;
    seen.set(key, now);
    if (seen.size > 200) for (const [k, t] of seen) if (now - t > 30000) seen.delete(k);
    return true;
  };
  const conns = BROKERS.map(b => ({ b, client: null, up: false, timer: 0 }));
  const report = () => {
    const up = conns.filter(c => c.up).map(c => c.b.name);
    onStatus({ state: up.length ? 'connected' : 'offline', up });
  };

  function connect(c) {
    if (closed) return;
    let dead = false;
    const id = 'sarab-gs-' + Math.random().toString(16).slice(2, 10);
    try { c.client = lib.connect(c.b.url, { clientId: id, clean: true, connectTimeout: 10000, reconnectPeriod: 0, keepalive: 30 }); }
    catch (e) { c.timer = setTimeout(() => connect(c), 5000); return; }
    c.client.on('connect', () => { c.up = true; c.client.subscribe(onCommand ? [TOPIC, CMD_TOPIC] : TOPIC, { qos: 0 }); report(); });
    c.client.on('message', (topic, payload, packet) => {
      let msg;
      try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (topic === CMD_TOPIC) { if (onCommand && fresh(`cmd|${msg.cmd}|${msg.ts}|${msg.sig}`)) onCommand(msg); return; }
      if (topic !== TOPIC || !msg.gnss) return;
      if (fresh(`${msg.src}|${msg.seq}|${msg.utc}`)) onPacket(msg, c.b.name, !!(packet && packet.retain));
    });
    const drop = () => {
      if (closed || dead) return;
      dead = true; const was = c.up; c.up = false;
      try { c.client.end(true); } catch (e) { /* already closed */ }
      report();
      c.timer = setTimeout(() => connect(c), was ? 1500 : 5000);
    };
    c.client.on('error', drop);
    c.client.on('close', drop);
  }
  conns.forEach(connect);
  onStatus({ state: 'connecting', up: [] });

  const send = (topic, obj, retain) => {
    let sent = false;
    for (const c of conns) if (c.up) { c.client.publish(topic, JSON.stringify(obj), { qos: 0, retain }); sent = true; }
    return sent;
  };
  return {
    publish(pkt, retain = true) { return send(TOPIC, pkt, retain); },
    command(msg) { return send(CMD_TOPIC, msg, false); },   // the cube listens on one relay; sending on both reaches it either way
    close() { closed = true; for (const c of conns) { clearTimeout(c.timer); try { c.client && c.client.end(true); } catch (e) { /* ignore */ } } }
  };
}
