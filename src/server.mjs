import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const dataDir = path.join(ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

let broadcaster = null;
let tokens = null;
const tokenFile = path.join(dataDir, 'twitch-token.json');
try { tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8')); } catch {}
const clients = new Set();
let round = null;
let eventSubSocket = null;
let reconnecting = false;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function targetFor(viewers) { return clamp(Math.ceil(Math.max(1, viewers) / 4), 1, 8); }
function publicState() {
  if (!round) return { active: false, souvenir: state.souvenir || null };
  const elapsed = Math.max(0, Date.now() - round.startedAt);
  return {
    active: elapsed < 30_000,
    from: round.from,
    viewers: round.viewers,
    target: round.target,
    count: round.users.size,
    remaining: Math.max(0, 30_000 - elapsed),
    mascotStage: clamp(Math.floor(round.users.size / round.target * 4), 0, 4),
    success: round.users.size >= round.target,
    souvenir: state.souvenir || null,
  };
}
const state = { souvenir: null };
function publish(type = 'state') {
  const packet = `event: ${type}\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(packet);
}
function startRound(from, viewers) {
  if (round && Date.now() - round.startedAt < 30_000) {
    // Combine overlapping raids into one inclusive welcome window.
    round.viewers += viewers;
    round.from = `${round.from} + ${from}`;
    round.target = targetFor(round.viewers);
    publish('raid');
    return;
  }
  state.souvenir = null;
  round = { from, viewers, target: targetFor(viewers), startedAt: Date.now(), users: new Set() };
  publish('raid');
  setTimeout(() => {
    if (round && Date.now() - round.startedAt >= 30_000) {
      if (round.users.size > 0) state.souvenir = { from: round.from, viewers: round.viewers, count: round.users.size, target: round.target, success: round.users.size >= round.target, createdAt: Date.now() };
      publish('end');
    }
  }, 30_050);
}
function welcome(user) {
  if (!round || Date.now() - round.startedAt >= 30_000 || !user) return false;
  const key = String(user).toLowerCase();
  if (round.users.has(key)) return false;
  round.users.add(key);
  if (round.users.size >= round.target) {
    state.souvenir = { from: round.from, viewers: round.viewers, count: round.users.size, target: round.target, success: true, createdAt: Date.now() };
  }
  publish('welcome');
  return true;
}

function html(res, name) {
  const file = path.join(ROOT, 'public', name);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
}
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(value));
}
async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw || '{}'); }
  catch { throw new Error('Request body must be valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request body must be a JSON object.');
  return body;
}
async function requestTokenRefresh() {
  if (!tokens?.refresh_token || !process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return false;
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: process.env.TWITCH_CLIENT_ID, client_secret: process.env.TWITCH_CLIENT_SECRET });
  const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  if (!r.ok) return false;
  tokens = { ...tokens, ...await r.json() };
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
  return true;
}
async function helix(url, options = {}) {
  const headers = { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${tokens.access_token}`, ...(options.headers || {}) };
  let r = await fetch(url, { ...options, headers });
  if (r.status === 401 && await requestTokenRefresh()) {
    headers.Authorization = `Bearer ${tokens.access_token}`;
    r = await fetch(url, { ...options, headers });
  }
  if (!r.ok) throw new Error(`Twitch API ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
async function subscribe(sessionId) {
  for (const type of ['channel.raid', 'channel.chat.message']) {
    const condition = type === 'channel.raid'
      ? { to_broadcaster_user_id: broadcaster.id }
      : { broadcaster_user_id: broadcaster.id, user_id: broadcaster.id };
    const response = await helix('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, version: '1', condition, transport: { method: 'websocket', session_id: sessionId } }),
    });
    console.log(`EventSub ${type}:`, response.data?.[0]?.status || 'subscribed');
  }
}
function connectEventSub(url = 'wss://eventsub.wss.twitch.tv/ws', { isReconnect = false, previousSocket = null } = {}) {
  if (!tokens || !broadcaster || typeof WebSocket === 'undefined') return;
  const socket = new WebSocket(url);
  eventSubSocket = socket;
  if (isReconnect) reconnecting = true;
  socket.addEventListener('message', async ({ data }) => {
    try {
      const msg = JSON.parse(data);
      const type = msg.metadata?.message_type;
      if (type === 'session_welcome') {
        if (isReconnect) {
          // Twitch carries subscriptions over to the replacement WebSocket session.
          reconnecting = false;
          if (previousSocket && previousSocket.readyState < WebSocket.CLOSING) previousSocket.close();
        } else {
          await subscribe(msg.payload.session.id);
        }
      }
      else if (type === 'session_reconnect') {
        if (!reconnecting) connectEventSub(msg.payload.session.reconnect_url, { isReconnect: true, previousSocket: socket });
      }
      else if (type === 'notification') {
        const event = msg.payload.event;
        if (msg.metadata.subscription_type === 'channel.raid') startRound(event.from_broadcaster_user_name, Number(event.viewers) || 0);
        if (msg.metadata.subscription_type === 'channel.chat.message') {
          const message = event.message?.text?.trim().toLowerCase();
          if (message === '!welcome') {
            const chatter = event.chatter_user_login || event.chatter_user_name;
            const counted = welcome(chatter);
            const progress = round ? `${round.users.size}/${round.target}` : 'no active raid';
            console.log(`[EventSub] !welcome from ${chatter}: ${counted ? `counted (${progress})` : `not counted (${progress})`}`);
          }
        }
      }
    } catch (err) { console.error('EventSub message error:', err.message); }
  });
  socket.addEventListener('close', () => {
    if (socket !== eventSubSocket) return;
    if (reconnecting) reconnecting = false;
    if (tokens) setTimeout(() => connectEventSub(), 2500);
  });
  socket.addEventListener('error', e => console.error('EventSub socket error', e.message || ''));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && ['/style.css', '/control.js', '/overlay.js'].includes(url.pathname)) {
    const name = path.basename(url.pathname);
    const type = name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
    res.writeHead(200, { 'content-type': type });
    return res.end(fs.readFileSync(path.join(ROOT, 'public', name)));
  }
  if (req.method === 'GET' && url.pathname === '/') return html(res, 'control.html');
  if (req.method === 'GET' && url.pathname === '/overlay') return html(res, 'overlay.html');
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState());
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/auth/start') {
    if (!process.env.TWITCH_CLIENT_ID) return json(res, 400, { error: 'Add TWITCH_CLIENT_ID to .env first.' });
    const stateToken = crypto.randomBytes(18).toString('hex');
    server.oauthState = stateToken;
    const params = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, redirect_uri: `http://localhost:${PORT}/auth/callback`, response_type: 'code', scope: 'user:read:chat', state: stateToken });
    res.writeHead(302, { location: `https://id.twitch.tv/oauth2/authorize?${params}` }); return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    if (url.searchParams.get('state') !== server.oauthState) return json(res, 400, { error: 'OAuth state mismatch.' });
    const body = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, client_secret: process.env.TWITCH_CLIENT_SECRET, code: url.searchParams.get('code'), grant_type: 'authorization_code', redirect_uri: `http://localhost:${PORT}/auth/callback` });
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!tokenRes.ok) return json(res, 400, { error: await tokenRes.text() });
    tokens = await tokenRes.json(); fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
    const userRes = await fetch('https://api.twitch.tv/helix/users', { headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${tokens.access_token}` } });
    const me = await userRes.json(); broadcaster = me.data?.[0];
    if (!broadcaster) return json(res, 400, { error: 'Could not load Twitch account.' });
    connectEventSub();
    res.writeHead(302, { location: '/' }); return res.end();
  }
  if (req.method === 'POST' && url.pathname === '/api/raid') {
    let body;
    try { body = await readJsonBody(req); }
    catch (err) { return json(res, 400, { error: err.message }); }
    startRound(String(body.from || 'Friendly Fire'), clamp(Number(body.viewers) || 1, 1, 10_000));
    return json(res, 200, publicState());
  }
  if (req.method === 'POST' && url.pathname === '/api/welcome') {
    let body;
    try { body = await readJsonBody(req); }
    catch (err) { return json(res, 400, { error: err.message }); }
    return json(res, 200, { counted: welcome(String(body.user || '')) , state: publicState() });
  }
  if (req.method === 'POST' && url.pathname === '/api/reset') { round = null; state.souvenir = null; publish('state'); return json(res, 200, publicState()); }
  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Welcome Wave running at http://localhost:${PORT}`);
  if (tokens && process.env.TWITCH_CLIENT_ID && typeof WebSocket !== 'undefined') {
    // Recover the broadcaster profile from the saved token.
    fetch('https://api.twitch.tv/helix/users', { headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${tokens.access_token}` } })
      .then(r => r.json()).then(data => { broadcaster = data.data?.[0]; if (broadcaster) connectEventSub(); }).catch(err => console.error(err.message));
  }
});
