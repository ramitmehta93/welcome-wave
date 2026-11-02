const $ = id => document.getElementById(id);
let deadline = 0;
function render(s) {
  const live = s.active;
  deadline = live ? Date.now() + s.remaining : 0;
  const count = s.count || s.souvenir?.count || 0;
  const target = s.target || s.souvenir?.target || 0;
  const card = $('overlayCard');
  card.classList.toggle('is-live', live);
  card.classList.toggle('is-complete', s.success || s.souvenir?.success);
  $('overlayEyebrow').textContent = live ? (s.success ? 'THE WAVE IS COMPLETE' : 'A RAID IS HERE') : (s.souvenir ? (s.souvenir.success ? 'SOUVENIR UNLOCKED' : 'A WELCOME WAS MADE') : 'A RAID IS HERE');
  $('overlayTitle').innerHTML = live ? (s.success ? 'You made<br><em>a friend.</em>' : 'Welcome,<br><em>friends.</em>') : (s.souvenir?.success ? 'A new<br><em>friend.</em>' : 'Welcome,<br><em>friends.</em>');
  $('overlayFrom').textContent = s.from ? `${s.from} brought ${s.viewers} ${s.viewers === 1 ? 'viewer' : 'viewers'}.` : 'The community is making you a souvenir.';
  $('overlayCount').textContent = `${count} / ${target}`;
  $('overlayFill').style.width = `${target ? Math.min(100, count / target * 100) : 0}%`;
  $('overlayTimer').textContent = live ? `${Math.ceil(s.remaining / 1000)}s` : '30s';
  $('overlayFooter').textContent = live ? (s.success ? 'The Welcome Wisp is yours.' : 'Every chatter adds one spark.') : (s.souvenir ? (s.souvenir.success ? 'Souvenir saved from this raid.' : 'Every welcome made the Wisp brighter.') : 'A shared welcome, made live.');
  $('overlayMascot').dataset.stage = s.mascotStage ?? (s.souvenir?.success ? 4 : count ? 1 : 0);
  $('overlay').classList.toggle('idle', !live && !s.souvenir);
}
const stream = new EventSource('/events');
for (const name of ['state', 'raid', 'welcome', 'end']) stream.addEventListener(name, e => render(JSON.parse(e.data)));
fetch('/api/state').then(r => r.json()).then(render);
setInterval(() => { if (deadline) $('overlayTimer').textContent = `${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`; }, 200);
