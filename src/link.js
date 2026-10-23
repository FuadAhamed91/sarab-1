/* Downlink: the cube publishes one JSON packet per second to a public MQTT relay;
   the ground station subscribes over a secure WebSocket. Two relays, so one outage
   does not take the dashboard down. */

export const TOPIC = 'sarab1/cb-7f3a91/tm';
export const BROKERS = [
  { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' }
];

export function createLink({ onPacket, onStatus }) {
  const mqttLib = window.mqtt;
  if (!mqttLib || typeof mqttLib.connect !== 'function') {
    onStatus({ state: 'unavailable', broker: null });
    return { publish() { return false; }, close() {} };
  }
  let i = 0, client = null, closed = false, timer = 0, connected = false;
  const id = 'sarab-gs-' + Math.random().toString(16).slice(2, 10);

  function next(delay) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(connect, delay);
  }
  function connect() {
    if (closed) return;
    const b = BROKERS[i % BROKERS.length];
    onStatus({ state: 'connecting', broker: b.name });
    try {
      client = mqttLib.connect(b.url, { clientId: id, clean: true, connectTimeout: 8000, reconnectPeriod: 0, keepalive: 30 });
    } catch (e) { i++; next(3000); return; }
    client.on('connect', () => {
      connected = true;
      client.subscribe(TOPIC, { qos: 0 });
      onStatus({ state: 'connected', broker: b.name });
    });
    client.on('message', (topic, payload) => {
      if (topic !== TOPIC) return;
      let pkt;
      try { pkt = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
      if (pkt && typeof pkt === 'object' && pkt.gnss) onPacket(pkt);
    });
    let dead = false;
    const drop = () => {
      if (closed || dead) return;
      dead = true;
      const was = connected; connected = false;
      try { client.end(true); } catch (e) { /* already closed */ }
      onStatus({ state: 'offline', broker: b.name });
      if (!was) i++;            // could not reach this relay: try the other one
      next(was ? 1500 : 4000);
    };
    client.on('error', drop);
    client.on('close', drop);
  }
  connect();
  return {
    publish(pkt, retain = true) {
      if (!client || !connected) return false;
      client.publish(TOPIC, JSON.stringify(pkt), { qos: 0, retain });
      return true;
    },
    close() { closed = true; clearTimeout(timer); try { client && client.end(true); } catch (e) { /* ignore */ } }
  };
}
