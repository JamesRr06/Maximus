/* Test headless du relais : node test-relay.js
 * Démarre le serveur sur un port de test et vérifie host / join / relai /
 * déconnexion / erreurs. Code de sortie 0 si tout passe, 1 sinon. */
'use strict';
const { WebSocket, WebSocketServer } = require('ws');

const PORT = 8123;
process.env.PORT = String(PORT);
const { wss } = require('./relay.js');

let failures = 0;
function check(name, cond){
  console.log((cond ? '  OK   ' : '  ÉCHEC ') + name);
  if (!cond) failures++;
}
const URL = `ws://127.0.0.1:${PORT}`;
const conn = () => new WebSocket(URL);
const once = (ws) => new Promise(res => ws.once('message', d => res(JSON.parse(d.toString()))));
const open = (ws) => new Promise(res => ws.once('open', res));
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

(async () => {
  // 1. host crée un salon
  const host = conn(); await open(host);
  host.send(JSON.stringify({ t: 'host' }));
  const hosted = await once(host);
  check('host : salon créé avec un code', hosted.t === 'hosted' && /^MAX-[A-Z0-9]{4}$/.test(hosted.code));

  // 2. join avec un mauvais code -> no-room
  const bad = conn(); await open(bad);
  bad.send(JSON.stringify({ t: 'join', code: 'MAX-ZZZZ' }));
  const badRes = await once(bad);
  check('join code inconnu -> no-room', badRes.t === 'error' && badRes.reason === 'no-room');
  bad.close();

  // 3. guest rejoint le vrai salon
  const guest = conn(); await open(guest);
  const hostPeerJoined = once(host);
  guest.send(JSON.stringify({ t: 'join', code: hosted.code }));
  const joinRes = await once(guest);
  check('join : le client entre dans le salon', joinRes.t === 'joined');
  check('join : l’hôte est notifié (peer-joined)', (await hostPeerJoined).t === 'peer-joined');

  // 4. relai host -> guest
  const gRecv = once(guest);
  host.send(JSON.stringify({ t: 'msg', hello: 'du host' }));
  const g = await gRecv;
  check('relai host -> guest (message intact)', g.t === 'msg' && g.hello === 'du host');

  // 5. relai guest -> host
  const hRecv = once(host);
  guest.send(JSON.stringify({ t: 'state', hp: 42 }));
  const h = await hRecv;
  check('relai guest -> host (message intact)', h.t === 'state' && h.hp === 42);

  // 6. un 3e joueur ne peut pas rejoindre un salon plein
  const third = conn(); await open(third);
  third.send(JSON.stringify({ t: 'join', code: hosted.code }));
  const full = await once(third);
  check('salon plein -> room-full', full.t === 'error' && full.reason === 'room-full');
  third.close();

  // 7. déconnexion du guest -> l'hôte reçoit peer-left
  const hostLeft = once(host);
  guest.close();
  const left = await hostLeft;
  check('déconnexion -> le pair reçoit peer-left', left.t === 'peer-left');

  host.close();
  await sleep(100);
  wss.close();
  console.log(failures ? `\n${failures} test(s) en échec.` : '\nTous les tests du relais passent.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
