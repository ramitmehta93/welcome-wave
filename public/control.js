const $ = id => document.getElementById(id);
const form = $('chatForm');
let current = { active: false };
let deadline = 0;
let previewAfterSouvenir = false;
const goalFor = viewers => Math.max(1, Math.min(8, Math.ceil(Math.max(1, Number(viewers) || 1) / 4)));
async function post(url, body = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}
function render(s) {
  current = s;
  if (s.active) previewAfterSouvenir = false;
  deadline = s.active ? Date.now() + s.remaining : 0;
  const active = s.active;
  $('roundTitle').textContent = active ? `Raid from ${s.from}` : (s.souvenir ? `${s.souvenir.success ? 'Welcome completed' : 'The wave has passed'}` : 'Ready when they are');
  $('statusPill').textContent = active ? '● WAVE LIVE' : (s.souvenir ? (s.souvenir.success ? 'SOUVENIR UNLOCKED' : 'WAVE ENDED') : 'STANDING BY');
  $('statusPill').className = `status-pill ${active ? 'live' : ''}`;
  const showSouvenirResult = !active && s.souvenir && !previewAfterSouvenir;
  const previewTarget = goalFor($('raidSize').value);
  const target = active ? s.target : showSouvenirResult ? s.souvenir.target : previewTarget;
  const count = active ? (s.count || 0) : showSouvenirResult ? s.souvenir.count : 0;
  $('progressText').textContent = `${count} / ${target}`;
  $('fill').style.width = `${target ? Math.min(100, count / target * 100) : 0}%`;
  $('timer').innerHTML = `${active ? Math.ceil(s.remaining / 1000) : s.souvenir ? 0 : 30}<span>s</span>`;
  $('mascot').dataset.stage = s.mascotStage ?? (s.souvenir?.success ? 4 : count ? 1 : 0);
  $('buildTitle').textContent = active ? (s.success ? 'The Welcome Wisp is yours!' : `${target - count} more ${target - count === 1 ? 'spark' : 'sparks'} to go`) : (s.souvenir ? (s.souvenir.success ? 'Souvenir unlocked: Welcome Wisp' : 'A little Wisp still came to visit') : 'Your raid mascot is waiting');
  $('buildSub').textContent = active ? 'One spark per chatter. Everyone builds it together.' : 'Each unique !welcome adds a new spark.';
  if (active) $('chatHint').textContent = `${s.from} brought ${s.viewers} ${s.viewers === 1 ? 'viewer' : 'viewers'} · ${count} unique ${count === 1 ? 'chatter' : 'chatters'} joined the wave.`;
  else if (s.souvenir) $('chatHint').textContent = s.souvenir.success ? 'The finished Welcome Wisp is now the raid souvenir.' : 'The community made a partial welcome; the Wisp still appears.';
}
function renderGoalPreview() {
  if (current.active) return;
  if (current.souvenir) previewAfterSouvenir = true;
  const viewers = Math.max(1, Number($('raidSize').value) || 1);
  const target = goalFor(viewers);
  $('raidGoal').textContent = `Raid of ${viewers} → ${target} ${target === 1 ? 'welcome' : 'welcomes'} needed`;
  $('progressText').textContent = `0 / ${target}`;
  $('fill').style.width = '0%';
  if (!current.souvenir) $('timer').innerHTML = '30<span>s</span>';
}
const stream = new EventSource('/events');
for (const name of ['state', 'raid', 'welcome', 'end']) stream.addEventListener(name, e => render(JSON.parse(e.data)));
$('raidBtn').onclick = async () => post('/api/raid', { from: 'PixelPals', viewers: Number($('raidSize').value) || 1 });
$('raidSize').addEventListener('input', () => {
  if (current.souvenir) previewAfterSouvenir = true;
  renderGoalPreview();
});
$('connectBtn').onclick = () => location.href = '/auth/start';
$('resetBtn').onclick = async () => render(await post('/api/reset'));
form.onsubmit = async e => {
  e.preventDefault();
  const name = $('userName').value.trim();
  if ($('chatMessage').value.trim().toLowerCase() !== '!welcome') { $('chatHint').textContent = 'Send exactly !welcome to add a spark.'; return; }
  if (!name) { $('chatHint').textContent = 'Add a chatter name first.'; return; }
  const result = await post('/api/welcome', { user: name });
  render(result.state);
  $('chatHint').textContent = result.counted ? `${name} added one spark to the wave.` : 'No spark added: the wave is over, or this chatter already welcomed them.';
  $('userName').value = '';
};
fetch('/api/state').then(r => r.json()).then(render);
renderGoalPreview();
setInterval(() => { if (current.active && deadline) $('timer').innerHTML = `${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}<span>s</span>`; }, 200);
