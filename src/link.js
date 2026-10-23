/* Downlink: the cube publishes one JSON packet per second to a public MQTT relay.
   The ground station listens on two relays at once over secure WebSockets, so the
   link keeps working if one relay is slow or down; duplicate packets are dropped. */

export const TOPIC = 'sarab1/cb-7f3a91/tm';
export const BROKERS = [
  { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' }
];

export function createLink({ onPacket, onStatus }) {
  const lib = window.mqtt;
  if (!lib || typeof lib.connect !== 'function') {
    onStatus({ state: 'unavailable', up: [] });
    return { publish() { return false; }, close() {} };
  }
  let closed = false;
  const seen = new Map();          // packet key -> time, to drop the copy arriving via the second relay
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
    c.client.on('connect', () => { c.up = true; c.client.subscribe(TOPIC, { qos: 0 }); report(); });
    c.client.on('message', (topic, payload) => {
      if (topic !== TOPIC) return;
      let pkt;
      try { pkt = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
      if (!pkt || typeof pkt !== 'object' || !pkt.gnss) return;
      const key = `${pkt.src}|${pkt.seq}|${pkt.utc}`, now = Date.now();
      if (seen.has(key)) return;
      seen.set(key, now);
      if (seen.size > 200) for (const [k, t] of seen) if (now - t > 30000) seen.delete(k);
      onPacket(pkt, c.b.name);
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

  return {
    publish(pkt, retain = true) {
      let sent = false;
      for (const c of conns) if (c.up) { c.client.publish(TOPIC, JSON.stringify(pkt), { qos: 0, retain }); sent = true; }
      return sent;
    },
    close() { closed = true; for (const c of conns) { clearTimeout(c.timer); try { c.client && c.client.end(true); } catch (e) { /* ignore */ } } }
  };
}
