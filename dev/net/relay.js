/* MAXIMUS — relais WebSocket pour le mode en ligne.
 *
 * Rôle : mettre en relation DEUX joueurs via un « code de salon », puis relayer
 * les messages de l'un vers l'autre. Le relais ne connaît RIEN du jeu : il ne
 * fait que router. Toute la logique (simulation host-autoritaire, snapshots,
 * intent) vit dans le jeu — voir dev/PISTE-ONLINE.md.
 *
 * Lancement :   node relay.js            (port 8080 par défaut)
 *               PORT=9000 node relay.js
 * Dépendance :  npm install ws           (voir package.json)
 *
 * Protocole (messages JSON) :
 *   client -> relais
 *     {t:'host'}                 crée un salon         -> {t:'hosted', code}
 *     {t:'join', code}           rejoint un salon      -> {t:'joined'} au client
 *                                                          {t:'peer-joined'} à l'hôte
 *     {t:'msg', ...}             (ou tout autre t)     relayé tel quel au pair
 *   relais -> client
 *     {t:'hosted', code}         salon créé
 *     {t:'joined'}               entré dans le salon (côté client)
 *     {t:'peer-joined'}          l'adversaire est arrivé (côté hôte)
 *     {t:'peer-left'}            l'adversaire a quitté / s'est déconnecté
 *     {t:'error', reason}        'bad-json' | 'no-room' | 'room-full' | 'not-in-room'
 */
'use strict';
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I,O,0,1 ambigus
const CODE_LEN = 4;
const HEARTBEAT_MS = 30000;

const rooms = new Map(); // code -> { host, guest }

function makeCode(){
  let code;
  do {
    let s = '';
    for (let i = 0; i < CODE_LEN; i++)
      s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    code = 'MAX-' + s;
  } while (rooms.has(code));
  return code;
}

function send(ws, obj){
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function peerOf(ws){
  const room = rooms.get(ws.roomCode);
  if (!room) return null;
  return ws === room.host ? room.guest : room.host;
}

function leaveRoom(ws){
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const peer = peerOf(ws);
  if (peer) { send(peer, { t: 'peer-left' }); peer.roomCode = null; }
  rooms.delete(code);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => console.log(`[relais MAXIMUS] à l'écoute sur le port ${PORT}`));

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); }
    catch (e) { return send(ws, { t: 'error', reason: 'bad-json' }); }

    switch (m.t) {
      case 'host': {
        leaveRoom(ws);
        const code = makeCode();
        rooms.set(code, { host: ws, guest: null });
        ws.roomCode = code;
        send(ws, { t: 'hosted', code });
        break;
      }
      case 'join': {
        const code = (m.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return send(ws, { t: 'error', reason: 'no-room' });
        if (room.guest) return send(ws, { t: 'error', reason: 'room-full' });
        room.guest = ws;
        ws.roomCode = code;
        send(ws, { t: 'joined' });
        send(room.host, { t: 'peer-joined' });
        break;
      }
      case 'leave': {
        leaveRoom(ws);
        break;
      }
      default: {
        // tout le reste est relayé au pair sans être inspecté
        const peer = peerOf(ws);
        if (!peer) return send(ws, { t: 'error', reason: 'not-in-room' });
        if (peer.readyState === peer.OPEN) peer.send(data.toString());
      }
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => {});
});

// ping périodique : ferme les connexions mortes (déclenche peer-left proprement)
const beat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(beat));

module.exports = { wss };
