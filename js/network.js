// LAN multiplayer – host-authoritative lobby over WebRTC DataChannels.
// Signaling is manual: the host makes an INVITE code, the friend replies with an
// ANSWER code (copy/paste, WhatsApp, AirDrop...). No servers needed.
//
// Topology: star. Every friend connects to the host; the host relays state
// between friends so everybody sees everybody.

const CODE_PREFIX = 'AC1.';
const ICE_CONFIG = {
  // A public STUN server is only a fallback; same-Wi-Fi play uses host candidates.
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function encodeCode(obj) {
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return CODE_PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCode(str, expectedKind) {
  if (!str) throw new Error('Code is empty.');
  // Messengers add spaces / line breaks / stray quotes – strip everything unsafe.
  let s = String(str).replace(/\s+/g, '').replace(/^["'“”]+|["'“”]+$/g, '');
  const at = s.indexOf(CODE_PREFIX);
  if (at === -1) throw new Error('That is not an Abyss Clover code (it should start with ' + CODE_PREFIX + ').');
  s = s.slice(at + CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  let obj;
  try {
    obj = JSON.parse(decodeURIComponent(escape(atob(s))));
  } catch (e) {
    throw new Error('Code looks damaged or cut off. Copy the whole thing again.');
  }
  if (!obj || !obj.s || !obj.p) throw new Error('Code is incomplete.');
  if (expectedKind && obj.k !== expectedKind) {
    throw new Error(expectedKind === 'o'
      ? 'That is an ANSWER code. Paste the host\'s INVITE code here.'
      : 'That is an INVITE code. Paste your friend\'s ANSWER code here.');
  }
  return obj;
}

// Wait until the browser has finished collecting network candidates.
// Non-trickle signaling needs them inside the code or the link never forms.
function waitForIce(pc, timeoutMs = 4000) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    let timer = null;
    const finish = () => {
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCand);
      clearTimeout(timer);
      resolve();
    };
    const onState = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const onCand = e => { if (!e.candidate) finish(); };
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCand);
    timer = setTimeout(finish, timeoutMs);
  });
}

class NetManager {
  constructor() {
    this.isHost = false;
    this.roomCode = '';
    this.localId = 'p_' + Math.random().toString(36).slice(2, 9);
    this.players = []; // {id, name, magic, isHealer, ready}
    this.pending = new Map(); // host: invite id -> { pc, dc }
    this.peers = new Map();   // host: player id -> { pc, dc }
    this.hostLink = null;     // client: { pc, dc }

    this.onPlayerUpdate = null;
    this.onStartGame = null;
    this.onRemoteState = null;   // (id, state)
    this.onRemoteAbility = null; // (id, slot, extra)
    this.onStatus = null;        // (text, kind: 'info'|'ok'|'error')
  }

  _status(text, kind = 'info') {
    if (this.onStatus) this.onStatus(text, kind);
  }
  _notifyPlayers() {
    if (this.onPlayerUpdate) this.onPlayerUpdate(this.players);
  }
  _me() {
    return this.players.find(p => p.id === this.localId);
  }
  _makePlayer(id, name = 'Player') {
    return { id, name, magic: null, isHealer: false, ready: false };
  }

  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // ========== HOST ==========
  host() {
    this.disconnect();
    this.isHost = true;
    this.roomCode = this.generateCode();
    this.players = [this._makePlayer(this.localId, 'Host')];
    this._notifyPlayers();
    return this.roomCode;
  }

  // Make an INVITE code for one friend. Call again for each extra friend.
  async createInvite() {
    if (!this.isHost) throw new Error('Only the host can make invite codes.');
    if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support WebRTC.');

    const pid = 'c_' + Math.random().toString(36).slice(2, 8);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const dc = pc.createDataChannel('game', { ordered: true });
    this._wireChannel(dc, pid);
    pc.onconnectionstatechange = () => this._onConnState(pc, pid);

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);

    this.pending.set(pid, { pc, dc });
    this._status('Invite code ready – send it to ONE friend, then paste their answer.', 'info');
    return encodeCode({ k: 'o', p: pid, s: pc.localDescription.sdp });
  }

  // Host pastes the friend's ANSWER code.
  async acceptAnswer(answerStr) {
    const data = decodeCode(answerStr, 'a');
    const entry = this.pending.get(data.p);
    if (!entry) {
      throw new Error('This answer does not match any open invite. Make a new invite code and try again.');
    }
    await entry.pc.setRemoteDescription({ type: 'answer', sdp: data.s });
    this.pending.delete(data.p);
    this.peers.set(data.p, entry);
    this._status('Answer accepted – connecting…', 'info');
    return data.p;
  }

  // ========== CLIENT ==========
  // Friend pastes the host's INVITE code and gets an ANSWER code back.
  async joinWithInvite(inviteStr) {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support WebRTC.');
    const data = decodeCode(inviteStr, 'o');
    this.disconnect();
    this.isHost = false;
    this.roomCode = 'JOIN';
    // The host chose our player id inside the invite – using it keeps both sides in agreement.
    this.localId = data.p;

    const pc = new RTCPeerConnection(ICE_CONFIG);
    pc.ondatachannel = ev => {
      this.hostLink = { pc, dc: ev.channel };
      this._wireChannel(ev.channel, 'host');
    };
    pc.onconnectionstatechange = () => this._onConnState(pc, 'host');

    await pc.setRemoteDescription({ type: 'offer', sdp: data.s });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);

    this.hostLink = { pc, dc: null };
    this.players = [this._makePlayer(this.localId)];
    this._notifyPlayers();
    this._status('Answer code ready – send it back to the host and keep this screen open.', 'info');
    return encodeCode({ k: 'a', p: data.p, s: pc.localDescription.sdp });
  }

  // Local-only lobby (no network) used by the old room-code button / solo.
  join(code) {
    this.disconnect();
    this.isHost = false;
    this.roomCode = (code || 'LOCAL').toUpperCase();
    this.players = [this._makePlayer(this.localId)];
    this._notifyPlayers();
    return true;
  }

  beginJoinLobby() {
    this.disconnect();
    this.isHost = false;
    this.players = [this._makePlayer(this.localId)];
    this._notifyPlayers();
  }

  disconnect() {
    const closeEntry = e => { try { e.dc && e.dc.close(); e.pc && e.pc.close(); } catch (_) {} };
    this.pending.forEach(closeEntry);
    this.peers.forEach(closeEntry);
    if (this.hostLink) closeEntry(this.hostLink);
    this.pending.clear();
    this.peers.clear();
    this.hostLink = null;
  }

  // ========== CHANNELS ==========
  _wireChannel(dc, peerId) {
    dc.onopen = () => {
      if (this.isHost) {
        const entry = this.peers.get(peerId) || this.pending.get(peerId);
        if (entry) entry.dc = dc;
        if (!this.players.some(p => p.id === peerId)) this.players.push(this._makePlayer(peerId));
        this._send(dc, { type: 'welcome', id: peerId });
        this._syncLobby();
        this._notifyPlayers();
        this._status('A friend connected! (' + (this.players.length) + ' in squad)', 'ok');
      } else {
        this._status('Connected to host!', 'ok');
        const me = this._me();
        this._send(dc, { type: 'hello', name: me ? me.name : 'Player' });
      }
    };
    dc.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (this.isHost) this._hostHandle(msg, peerId);
      else this._clientHandle(msg);
    };
    dc.onclose = () => this._onPeerGone(peerId);
  }

  _onConnState(pc, peerId) {
    if (pc.connectionState === 'failed') {
      this._status('Connection failed. Both devices must be on the same Wi-Fi (not guest/isolated). Make a fresh code and retry.', 'error');
      this._onPeerGone(peerId);
    } else if (pc.connectionState === 'disconnected') {
      this._status('A connection dropped…', 'error');
    }
  }

  _onPeerGone(peerId) {
    if (this.isHost) {
      if (!this.peers.has(peerId) && !this.players.some(p => p.id === peerId)) return;
      const entry = this.peers.get(peerId);
      this.peers.delete(peerId);
      this.pending.delete(peerId);
      const before = this.players.length;
      this.players = this.players.filter(p => p.id !== peerId);
      if (this.players.length !== before) {
        this._syncLobby();
        this._notifyPlayers();
        this._status('A friend left the squad.', 'error');
      }
      try { entry && entry.pc.close(); } catch (_) {}
    } else {
      this._status('Disconnected from host.', 'error');
    }
  }

  _send(dc, obj) {
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj));
  }

  // Host -> everyone (optionally skipping one id). Client -> host only.
  broadcast(obj, exceptId = null) {
    if (this.isHost) {
      this.peers.forEach((entry, id) => {
        if (id !== exceptId) this._send(entry.dc, obj);
      });
    } else if (this.hostLink) {
      this._send(this.hostLink.dc, obj);
    }
  }

  _publicPlayers() {
    return this.players.map(p => ({
      id: p.id, name: p.name, magic: p.magic, isHealer: p.isHealer, ready: p.ready
    }));
  }

  _syncLobby() {
    if (!this.isHost) return;
    this.broadcast({ type: 'players', players: this._publicPlayers() });
  }

  // ---- messages that arrive at the HOST (peerId comes from the channel, not the message) ----
  _hostHandle(msg, peerId) {
    const p = this.players.find(pl => pl.id === peerId);
    switch (msg.type) {
      case 'hello':
        if (p && msg.name) p.name = String(msg.name).slice(0, 12);
        this._syncLobby();
        this._notifyPlayers();
        break;
      case 'ready':
        if (p) {
          p.name = String(msg.name || p.name).slice(0, 12);
          p.magic = msg.magic;
          p.isHealer = !!msg.isHealer;
          p.ready = true;
        }
        this._syncLobby();
        this._notifyPlayers();
        break;
      case 'state':
        this.broadcast({ type: 'state', id: peerId, state: msg.state }, peerId);
        if (this.onRemoteState) this.onRemoteState(peerId, msg.state);
        break;
      case 'ability':
        this.broadcast({ type: 'ability', id: peerId, slot: msg.slot, extra: msg.extra }, peerId);
        if (this.onRemoteAbility) this.onRemoteAbility(peerId, msg.slot, msg.extra);
        break;
    }
  }

  // ---- messages that arrive at a CLIENT (all come from the host) ----
  _clientHandle(msg) {
    switch (msg.type) {
      case 'welcome':
        this.localId = msg.id;
        break;
      case 'players': {
        this.players = msg.players;
        this._notifyPlayers();
        break;
      }
      case 'start':
        if (this.onStartGame) this.onStartGame(msg.players);
        break;
      case 'state':
        if (this.onRemoteState) this.onRemoteState(msg.id, msg.state);
        break;
      case 'ability':
        if (this.onRemoteAbility) this.onRemoteAbility(msg.id, msg.slot, msg.extra);
        break;
    }
  }

  // ========== LOBBY API (used by main.js) ==========
  setLocalInfo(name, magicId, isHealer) {
    const me = this._me();
    if (me) {
      me.name = name;
      me.magic = magicId;
      me.isHealer = isHealer;
    }
    if (this.isHost) this._syncLobby();
    else this.broadcast({ type: 'ready', name, magic: magicId, isHealer });
    this._notifyPlayers();
  }

  setReady(ready) {
    const me = this._me();
    if (me) me.ready = ready;
    if (this.isHost) this._syncLobby();
    this._notifyPlayers();
  }

  allReady() {
    return this.players.length > 0 && this.players.every(p => p.ready && p.magic);
  }

  startGame(playersData) {
    this.broadcast({ type: 'start', players: playersData });
  }

  sendState(state) {
    this.broadcast({ type: 'state', id: this.localId, state });
  }

  sendAbility(slot, extra) {
    this.broadcast({ type: 'ability', id: this.localId, slot, extra });
  }

  addDummyPlayer(name, magicId) {
    if (!this.isHost) return;
    this.players.push({
      id: 'ai_' + Math.random().toString(36).slice(2, 6),
      name, magic: magicId, isHealer: false, ready: true
    });
    this._syncLobby();
    this._notifyPlayers();
  }
}

const Net = new NetManager();
