import { engineInstance, PredictionResult, SignalType } from './engine.js';

// Global types & declarations
interface HistoryRecord {
  period: string;
  number: number;
}

interface RoundHistoryItem {
  period: string;
  mode: string;
  prediction: SignalType;
  predNum: [number, number];
  actual: SignalType;
  actualNum: number;
  win: boolean;
  jackpot: boolean;
  sideWin: boolean;
  confidence: number;
  isReversed?: boolean;
}

interface AppState {
  mode: '30s' | '1m';
  running: boolean;
  pollTimer: any;
  demo: boolean;
  demoTimer: any;
  recs: { '30s': HistoryRecord[]; '1m': HistoryRecord[] };
  lastSeen: { '30s': string | null; '1m': string | null };
  busy: boolean;
  lastPrediction: {
    period: string;
    signal: SignalType;
    prime: number;
    backup: number;
    confidence: number;
  } | null;
  history: RoundHistoryItem[];
  stats: { wins: number; losses: number; streak: number; best: number };
  lastAnalysis: PredictionResult | null;
  gameOpen: boolean;
  unlocked: boolean;
  keyData: any;
  hidePred: boolean;
}

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBrNaFnXfhl1PUENlDxt7IpZo855slqymU",
  authDomain: "abirhackadmin.firebaseapp.com",
  databaseURL: "https://abirhackadmin-default-rtdb.firebaseio.com",
  projectId: "abirhackadmin",
  storageBucket: "abirhackadmin.appspot.com",
  messagingSenderId: "73986520865",
  appId: "1:73986520865:web:0e115f5ca06c2a32d93060"
};
const DB_URL = FIREBASE_CONFIG.databaseURL;

const $ = (id: string): HTMLElement | null => document.getElementById(id);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Number(v) || 0));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const BS = (n: number): SignalType => (n >= 5 ? 'BIG' : 'SMALL');

const S: AppState = {
  mode: '1m',
  running: false,
  pollTimer: null,
  demo: false,
  demoTimer: null,
  recs: { '30s': [], '1m': [] },
  lastSeen: { '30s': null, '1m': null },
  busy: false,
  lastPrediction: null,
  history: [],
  stats: { wins: 0, losses: 0, streak: 0, best: 0 },
  lastAnalysis: null,
  gameOpen: false,
  unlocked: false,
  keyData: null,
  hidePred: false
};

const LS = {
  recs: 'arx_recs_',
  theme: 'arx_theme',
  key: 'arx_license_key'
};

function saveRecs(m: '30s' | '1m') {
  try {
    localStorage.setItem(LS.recs + m, JSON.stringify(S.recs[m].slice(0, 600)));
  } catch (e) {
    // Ignore storage quota
  }
}

function loadRecs() {
  try {
    for (const m of ['30s', '1m'] as const) {
      const r = JSON.parse(localStorage.getItem(LS.recs + m) || '[]');
      if (Array.isArray(r)) S.recs[m] = r.slice(0, 600);
    }
  } catch (e) {
    // Ignore
  }
}

export function toast(msg: string) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout((window as any).__tt);
  (window as any).__tt = setTimeout(() => t.classList.remove('show'), 2400);
}

export function switchTab(n: string) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const tab = $('tab-' + n);
  if (tab) tab.classList.add('active');
  document.querySelectorAll('.nitem').forEach(x => {
    x.classList.toggle('active', (x as HTMLElement).dataset.tab === n);
  });
  if (n === 'engine') renderEngineTab();
}

export function openDrawer() {
  $('drawer')?.classList.add('open');
  $('drawerMask')?.classList.add('open');
}

export function closeDrawer() {
  $('drawer')?.classList.remove('open');
  $('drawerMask')?.classList.remove('open');
}

export function closeWin() {
  $('winOverlay')?.classList.remove('show');
}

export function clearAppCache() {
  const th = localStorage.getItem(LS.theme);
  const key = localStorage.getItem(LS.key);
  localStorage.clear();
  if (th) localStorage.setItem(LS.theme, th);
  if (key) localStorage.setItem(LS.key, key);
  toast('Cache cleared! Reloading…');
  setTimeout(() => location.reload(), 1200);
}

export function resetAllStats() {
  S.stats = { wins: 0, losses: 0, streak: 0, best: 0 };
  S.history = [];
  S.lastPrediction = null;
  renderHistory();
  refreshStats();
  toast('Stats reset');
}

// PREMIUM LICENSING
function updateLockUI() {
  const btn = $('lockBtn');
  if (!btn) return;
  if (S.unlocked) {
    btn.classList.remove('locked');
    btn.classList.add('unlocked');
    const svg = btn.querySelector('svg');
    if (svg) svg.innerHTML = '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-1.9"/>';
    const tag = $('profileTag');
    if (tag) {
      tag.classList.add('premium');
      const tagTxt = $('profileTagText');
      if (tagTxt) tagTxt.textContent = 'PREMIUM USER';
    }
    const lsEl = $('licenseStatus');
    if (lsEl) {
      lsEl.textContent = 'ACTIVE ✓';
      lsEl.style.color = 'var(--win)';
    }
  } else {
    btn.classList.remove('unlocked');
    btn.classList.add('locked');
    const svg = btn.querySelector('svg');
    if (svg) svg.innerHTML = '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
    const tag = $('profileTag');
    if (tag) {
      tag.classList.remove('premium');
      const tagTxt = $('profileTagText');
      if (tagTxt) tagTxt.textContent = 'FREE USER';
    }
    const lsEl = $('licenseStatus');
    if (lsEl) {
      lsEl.textContent = 'LOCKED';
      lsEl.style.color = 'var(--muted)';
    }
  }

  if (S.lastAnalysis && S.lastPrediction) {
    applyResult(S.lastAnalysis, S.lastPrediction.period, S.mode);
  } else {
    setCoreDefault();
  }
  if ($('tab-engine')?.classList.contains('active')) renderEngineTab();
}

export function openLock() {
  if (S.unlocked) {
    toast('✓ Already unlocked');
    return;
  }
  $('lockOverlay')?.classList.add('show');
  setTimeout(() => ($('keyInput') as HTMLInputElement | null)?.focus(), 350);
}

export function closeLock() {
  $('lockOverlay')?.classList.remove('show');
}

export async function doUnlock() {
  const input = $('keyInput') as HTMLInputElement | null;
  const msg = $('lmMsg');
  const btn = $('lmBtn') as HTMLButtonElement | null;
  if (!input || !msg || !btn) return;

  const raw = (input.value || '').trim();
  if (!raw) {
    msg.className = 'lm-msg err';
    msg.textContent = '⚠ Enter your license key';
    return;
  }
  const key = raw.toUpperCase().replace(/\s+/g, '');

  btn.disabled = true;
  btn.textContent = '⏳ VERIFYING...';
  msg.className = 'lm-msg';
  msg.textContent = '';

  const result = await verifyKey(key);

  btn.disabled = false;
  btn.textContent = '🔓 UNLOCK PREMIUM';

  if (!result.valid) {
    msg.className = 'lm-msg err';
    msg.textContent = '✕ ' + (result.reason || 'Invalid key');
    input.value = '';
    return;
  }
  msg.className = 'lm-msg ok';
  msg.textContent = '✓ Success! Unlocking...';

  S.unlocked = true;
  S.keyData = result.data;
  try {
    localStorage.setItem(LS.key, key);
  } catch (e) {
    // Ignore
  }
  updateLockUI();
  setTimeout(() => {
    closeLock();
    toast('🔓 Premium Unlocked! AI Brain & Matrix Active');
  }, 700);
}

async function verifyKey(key: string): Promise<{ valid: boolean; reason?: string; data?: any }> {
  if (!DB_URL) return { valid: false, reason: 'Firebase not configured' };
  try {
    const r = await fetch(`${DB_URL}/keys/${encodeURIComponent(key)}.json`, { cache: 'no-store' });
    if (!r.ok) return { valid: false, reason: `Network error (${r.status})` };
    const data = await r.json();
    if (!data) return { valid: false, reason: 'Key not found' };
    if (data.active === false) return { valid: false, reason: 'Key is deactivated' };
    if (data.expires && Date.now() > Number(data.expires)) return { valid: false, reason: 'Key expired' };
    return { valid: true, data };
  } catch (e) {
    return { valid: false, reason: 'Network error' };
  }
}

async function autoVerifyOnBoot() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LS.key);
  } catch (e) {
    // Ignore
  }
  if (!saved) {
    setTimeout(() => openLock(), 900);
    return;
  }
  const res = await verifyKey(saved);
  if (res.valid) {
    S.unlocked = true;
    S.keyData = res.data;
    updateLockUI();
    toast('✓ Welcome back, Premium Member');
  } else {
    try {
      localStorage.removeItem(LS.key);
    } catch (e) {
      // Ignore
    }
    setTimeout(() => openLock(), 600);
  }
}

// PRIVACY HIDE
export function toggleHidePred() {
  S.hidePred = !S.hidePred;
  $('stage')?.classList.toggle('hide-all', S.hidePred);
  $('hideBtn')?.classList.toggle('hidden', S.hidePred);
  const hideIcon = $('hideIcon');
  if (hideIcon) {
    hideIcon.innerHTML = S.hidePred
      ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
      : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
  toast(S.hidePred ? '🙈 Privacy mode ON' : '👁 Predictions visible');
}

// GAME LAUNCHER
export function playGame(url: string, name: string) {
  const f = $('webFrame');
  if (f && f.getAttribute('src') !== url) f.setAttribute('src', url);
  $('gameBg')?.classList.add('on');
  $('gameFab')?.classList.add('on');
  const gn = $('gameNow');
  if (gn) gn.style.display = 'block';
  const nn = $('nowName');
  if (nn) nn.textContent = name || 'LIVE';
  const nt = $('nowTitle');
  if (nt) nt.textContent = (name || 'GAME') + ' — RUNNING';
  document.body.classList.add('game-open');
  document.body.classList.remove('ui-hidden');
  const fu = $('fabUi');
  if (fu) fu.textContent = '🙈 HIDE UI';
  S.gameOpen = true;
  switchTab('home');
  toast('✓ ' + (name || 'Game') + ' • Background full screen');
}

export function closeGame() {
  $('gameBg')?.classList.remove('on');
  $('gameFab')?.classList.remove('on');
  const gn = $('gameNow');
  if (gn) gn.style.display = 'none';
  document.body.classList.remove('game-open', 'ui-hidden');
  const fu = $('fabUi');
  if (fu) fu.textContent = '🙈 HIDE UI';
  S.gameOpen = false;
  setTimeout(() => {
    $('webFrame')?.setAttribute('src', 'about:blank');
  }, 250);
  toast('Game closed');
}

export function toggleGameUI() {
  const hidden = document.body.classList.toggle('ui-hidden');
  const fu = $('fabUi');
  if (fu) fu.textContent = hidden ? '👁 SHOW UI' : '🙈 HIDE UI';
  if (hidden) toast('UI hidden — tap anywhere to interact with game');
}

function refreshStats() {
  const w = S.stats.wins, l = S.stats.losses, t = w + l;
  const acc = t ? Math.round((w / t) * 100) + '%' : '0%';
  ['stWin', 'pWin'].forEach(i => {
    const el = $(i);
    if (el) el.textContent = String(w);
  });
  ['stLoss', 'pLoss'].forEach(i => {
    const el = $(i);
    if (el) el.textContent = String(l);
  });
  ['stAcc', 'pAcc', 'metaAcc'].forEach(i => {
    const el = $(i);
    if (el) el.textContent = acc;
  });
  const sb = $('stBest');
  if (sb) sb.textContent = String(S.stats.best || 0);
  const ss = $('stStreak');
  if (ss) ss.textContent = String(S.stats.streak || 0);
}

function setStatus(txt: string, analysing?: boolean) {
  const st = $('statusText');
  if (st) st.textContent = txt;
  $('statusBar')?.classList.toggle('analysing', !!analysing);
}

function setRing(p: number) {
  $('coreRing')?.style.setProperty('--pct', Math.round(clamp(p, 0, 1) * 100) + '%');
}

function setConf(c: number | null) {
  const seg = $('confSeg')?.children;
  if (c == null) {
    const cv = $('confVal');
    if (cv) cv.textContent = '—';
    const cc = $('chipConf');
    if (cc) cc.textContent = '—';
    if (seg) for (const i of Array.from(seg)) (i as HTMLElement).className = '';
    return;
  }
  const p = Math.round(c * 100);
  const cv = $('confVal');
  if (cv) cv.textContent = p + '%';
  const cc = $('chipConf');
  if (cc) cc.textContent = p + '%';
  if (seg) {
    const on = Math.round(clamp((p - 50) / 50, 0, 1) * seg.length);
    for (let i = 0; i < seg.length; i++) {
      (seg[i] as HTMLElement).className = i < on ? (p >= 80 ? 'on hi' : 'on') : '';
    }
  }
}

function setCoreDefault() {
  const cl = $('coreLbl');
  if (cl) cl.textContent = 'SELECT MODE';
  const p = $('corePred');
  const cn = $('coreNum');
  const cs = $('coreSub');

  if (!S.unlocked) {
    if (p) {
      p.textContent = '🔒';
      p.className = 'qcore-pred locked';
    }
    if (cl) cl.textContent = 'PREMIUM LOCKED';
    if (cn) {
      cn.innerHTML =
        '<div class="lock-inline"><svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>UNLOCK TO VIEW</div>';
    }
    if (cs) cs.textContent = 'Tap the lock icon to enter key';
  } else {
    if (p) {
      p.textContent = 'READY';
      p.className = 'qcore-pred ready';
      p.style.color = '';
    }
    if (cn) cn.innerHTML = '';
    if (cs) cs.textContent = 'AI BRAIN & MATRIX READY';
  }

  $('core')?.classList.remove('analysing');
  setStatus('READY');
  setRing(0);
  setConf(null);
  ['chipVotes', 'chipSamples', 'metaPeriod', 'metaSignal', 'metaStatus'].forEach(i => {
    const el = $(i);
    if (el) el.textContent = '—';
  });
  ['pdBigV', 'pdSmallV'].forEach(i => {
    const el = $(i);
    if (el) el.textContent = S.unlocked ? '—' : '🔒';
  });
  const bBar = $('pdBigBar');
  if (bBar) bBar.style.width = '0%';
  const sBar = $('pdSmallBar');
  if (sBar) sBar.style.width = '0%';
  const vb = $('voteBig');
  if (vb) vb.style.width = '50%';
  const vs = $('voteSmall');
  if (vs) vs.style.width = '50%';
  const vv = $('voteVal');
  if (vv) vv.textContent = S.unlocked ? '—' : '🔒';

  const opBanner = $('oppositeBanner');
  if (opBanner) opBanner.style.display = 'none';
}

function setAnalysing() {
  $('core')?.classList.add('analysing');
  const p = $('corePred');
  const cl = $('coreLbl');
  const cn = $('coreNum');
  const cs = $('coreSub');

  if (!S.unlocked) {
    if (cl) cl.textContent = 'PREMIUM LOCKED';
    if (p) {
      p.textContent = '🔒';
      p.className = 'qcore-pred locked';
    }
    if (cn) {
      cn.innerHTML =
        '<div class="lock-inline"><svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>UNLOCK TO VIEW</div>';
    }
    if (cs) cs.textContent = 'Enter license key to unlock';
    setStatus('LOCKED', true);
    return;
  }
  if (cl) cl.textContent = 'PROCESSING MATRIX';
  if (p) {
    p.textContent = '…';
    p.className = 'qcore-pred ready';
    p.style.color = '';
  }
  if (cn) cn.innerHTML = '';
  if (cs) cs.textContent = 'AI BRAIN & MATRIX COMPUTING';
  setStatus('ANALYSING', true);
}

// DATA RETRIEVAL
const PROXIES = [
  (u: string) => u,
  (u: string) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u: string) => 'https://corsproxy.io/?' + encodeURIComponent(u),
  (u: string) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u)
];

async function fetchJSON(u: string, timeout = 7000): Promise<any> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(u, { cache: 'no-store', signal: c.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

function normList(list: any[]): HistoryRecord[] {
  return list
    .map(it => {
      const n = parseInt(it?.number ?? it?.openCode ?? it?.winNumber ?? it?.result ?? '-1');
      const p = String(it?.issueNumber ?? it?.issue ?? it?.periodNumber ?? it?.issue_number ?? '');
      return n >= 0 && n <= 9 && p ? { period: p, number: n } : null;
    })
    .filter((x): x is HistoryRecord => x !== null);
}

async function fetchHistory(mode: '30s' | '1m', pageSize: number, pageNo: number): Promise<HistoryRecord[]> {
  const g = mode === '30s' ? '30S' : '1M';
  const urls = [
    `https://draw.ar-lottery01.com/WinGo/WinGo_${g}/GetHistoryIssuePage.json?pageSize=${pageSize || 20}&pageNo=${pageNo || 1}&ts=${Date.now()}`,
    `https://api.bdg88zf.com/api/webapi/GetEmerdList?gameType=1&language=0&pageNo=${pageNo || 1}&pageSize=${pageSize || 20}&typeId=${mode === '30s' ? 1 : 2}&random=${Math.random()}`
  ];

  for (const u of urls) {
    for (const px of PROXIES) {
      try {
        const d = await fetchJSON(px(u));
        const list = d?.data?.list ?? d?.data?.gameslist ?? d?.list ?? [];
        if (list.length) return normList(list);
      } catch (e) {
        // Try next proxy
      }
    }
  }
  return [];
}

function mergeRecs(mode: '30s' | '1m', incoming: HistoryRecord[]) {
  const m = new Map<string, HistoryRecord>();
  S.recs[mode].forEach(r => m.set(r.period, r));
  incoming.forEach(r => m.set(r.period, r));
  const arr = [...m.values()].sort((a, b) => b.period.localeCompare(a.period, undefined, { numeric: true }));
  S.recs[mode] = arr.slice(0, 600);
  saveRecs(mode);
}

async function bootstrapHistory(mode: '30s' | '1m') {
  if (S.recs[mode].length >= 80) return;
  toast('⏳ Loading historical matrix data…');
  for (let p = 1; p <= 3; p++) {
    const l = await fetchHistory(mode, 100, p);
    if (!l.length) break;
    mergeRecs(mode, l);
    if (l.length < 100) break;
  }
}

export function nextPeriod(p: string): string {
  try {
    const s = String(p);
    const m = s.match(/^(\D*)(\d+)$/);
    if (!m) return p;
    return m[1] + (BigInt(m[2]) + 1n).toString().padStart(m[2].length, '0');
  } catch (e) {
    return p;
  }
}

// ENGINE EXECUTION
export function selectMode(m: '30s' | '1m') {
  if (S.running) {
    toast('Stop engine first to change timer');
    return;
  }
  S.mode = m;
  $('btn30')?.classList.toggle('on', m === '30s');
  $('btn1m')?.classList.toggle('on', m === '1m');
  const mm = $('metaMode');
  if (mm) mm.textContent = m === '30s' ? '30 SEC' : '1 MIN';
}

export function toggleEngine() {
  if (S.running) stopEngine();
  else startEngine();
}

async function startEngine() {
  S.running = true;
  S.demo = false;
  clearInterval(S.demoTimer);
  S.lastSeen[S.mode] = null;
  const sBtn = $('startBtn');
  if (sBtn) {
    sBtn.textContent = '■ STOP ENGINE';
    sBtn.classList.add('stop');
  }
  const mm = $('metaMode');
  if (mm) mm.textContent = S.mode === '30s' ? '30 SEC' : '1 MIN';
  setStatus('CONNECTING', true);
  toast(`▶ AI Brain & Matrix Engine started • ${S.mode}`);
  await bootstrapHistory(S.mode);
  poll();
  S.pollTimer = setInterval(poll, S.mode === '30s' ? 4000 : 7000);
}

function stopEngine() {
  S.running = false;
  clearInterval(S.pollTimer);
  clearInterval(S.demoTimer);
  S.demo = false;
  S.busy = false;
  const sBtn = $('startBtn');
  if (sBtn) {
    sBtn.textContent = '▶ START QUANTUM ENGINE';
    sBtn.classList.remove('stop');
  }
  setCoreDefault();
  toast('Engine stopped');
}

async function poll() {
  if (!S.running || S.demo) return;
  const mode = S.mode;
  const l = await fetchHistory(mode, 20, 1);
  if (!l.length) {
    setStatus('RECONNECTING', true);
    return;
  }
  mergeRecs(mode, l);
  const latest = S.recs[mode][0].period;
  if (latest !== S.lastSeen[mode]) {
    S.lastSeen[mode] = latest;
    await runCycle(mode);
  }
}

async function runCycle(mode: '30s' | '1m') {
  if (S.busy) return;
  S.busy = true;
  setAnalysing();
  await sleep(550);

  const recs = S.recs[mode];
  if (!recs.length) {
    S.busy = false;
    return;
  }
  const fin = recs[0];
  const actualNum = fin.number;
  const actualType = BS(actualNum);

  if (S.lastPrediction && S.lastPrediction.period === fin.period) {
    const lp = S.lastPrediction;
    const sideWin = lp.signal === actualType;
    const jackpot = lp.prime === actualNum || lp.backup === actualNum;
    const win = sideWin || jackpot;

    if (win) {
      S.stats.wins++;
      S.stats.streak++;
      if (S.stats.streak > S.stats.best) S.stats.best = S.stats.streak;
      if (S.unlocked) showWin(fin.period, mode, lp, actualType, actualNum, jackpot);
    } else {
      S.stats.losses++;
      S.stats.streak = 0;
    }

    S.history.unshift({
      period: fin.period,
      mode,
      prediction: lp.signal,
      predNum: [lp.prime, lp.backup],
      actual: actualType,
      actualNum,
      win,
      jackpot,
      sideWin,
      confidence: lp.confidence,
      isReversed: S.lastAnalysis?.oppositeMajority.isReversed
    });
    if (S.history.length > 80) S.history.pop();
    renderHistory();
    refreshStats();
    S.lastPrediction = null;
  }

  const target = nextPeriod(fin.period);
  const numbers = recs.map(r => r.number);
  const result = engineInstance.predict(numbers);
  S.lastAnalysis = result;
  S.lastPrediction = {
    period: target,
    signal: result.signal,
    prime: result.prime,
    backup: result.backup,
    confidence: result.confidence
  };

  applyResult(result, target, mode);
  if ($('tab-engine')?.classList.contains('active')) renderEngineTab();
  S.busy = false;
}

function applyResult(F: PredictionResult, target: string, mode: '30s' | '1m') {
  $('core')?.classList.remove('analysing');

  if (!S.unlocked) {
    const cl = $('coreLbl');
    if (cl) cl.textContent = 'PREMIUM LOCKED';
    const p = $('corePred');
    if (p) {
      p.textContent = '🔒';
      p.className = 'qcore-pred locked';
    }
    const cn = $('coreNum');
    if (cn) {
      cn.innerHTML =
        '<div class="lock-inline"><svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>UNLOCK TO VIEW</div>';
    }
    const cs = $('coreSub');
    if (cs) cs.textContent = 'Tap 🔒 to enter license key';
    setStatus('LOCKED', false);
    setRing(0);
    setConf(null);

    const cv = $('chipVotes');
    if (cv) cv.textContent = '🔒';
    const csamples = $('chipSamples');
    if (csamples) csamples.textContent = String(Math.min(600, S.recs[mode].length));
    const vv = $('voteVal');
    if (vv) vv.textContent = '🔒';
    const vb = $('voteBig');
    if (vb) {
      vb.style.width = '50%';
      vb.textContent = '🔒';
    }
    const vs = $('voteSmall');
    if (vs) {
      vs.style.width = '50%';
      vs.textContent = '🔒';
    }
    const p1 = $('pdBigV');
    if (p1) p1.textContent = '🔒';
    const p0 = $('pdSmallV');
    if (p0) p0.textContent = '🔒';
    const bBar = $('pdBigBar');
    if (bBar) bBar.style.width = '0%';
    const sBar = $('pdSmallBar');
    if (sBar) sBar.style.width = '0%';
    const mp = $('metaPeriod');
    if (mp) mp.textContent = String(target).slice(-5);
    const mm = $('metaMode');
    if (mm) mm.textContent = mode === '30s' ? '30 SEC' : '1 MIN';
    const ms = $('metaSignal');
    if (ms) {
      ms.textContent = '🔒';
      ms.style.color = 'var(--muted)';
    }
    const mst = $('metaStatus');
    if (mst) mst.textContent = 'LOCKED';

    const opBanner = $('oppositeBanner');
    if (opBanner) opBanner.style.display = 'none';
    return;
  }

  const isBig = F.signal === 'BIG';
  const cl = $('coreLbl');
  if (cl) cl.textContent = F.oppositeMajority.isReversed ? '⚡ OPPOSITE MAJORITY' : '🧠 AI BRAIN & MATRIX SIGNAL';

  const p = $('corePred');
  if (p) {
    p.textContent = F.signal;
    p.className = 'qcore-pred ' + (isBig ? 'big' : 'small');
    p.style.color = '';
  }

  const cn = $('coreNum');
  if (cn) {
    cn.innerHTML =
      `<div class="nb ${isBig ? 'big' : 'small'}"><b>${F.prime}</b><i>PRIME (MATRIX)</i></div>` +
      `<div class="nb ${isBig ? 'small' : 'big'}"><b>${F.backup}</b><i>BACKUP</i></div>`;
  }

  const total = F.bigVotes + F.smallVotes;
  const cs = $('coreSub');
  if (cs) {
    cs.textContent = F.oppositeMajority.isReversed
      ? `HERD TRAP: Flipped ${F.oppositeMajority.rawConsensus} → ${F.signal}`
      : `AI BRAIN: Sys1 ${Math.round(F.brain.system1Score * 100)}% • Matrix P(${F.signal[0]}) ${Math.round((isBig ? F.matrix.matrixProbBig : F.matrix.matrixProbSmall) * 100)}%`;
  }

  setStatus('READY', false);
  setRing(F.confidence / 100);
  setConf(F.confidence / 100);

  // Opposite Majority Banner on Stage
  const opBanner = $('oppositeBanner');
  if (opBanner) {
    opBanner.style.display = 'flex';
    if (F.oppositeMajority.isReversed) {
      opBanner.className = 'op-banner reversed';
      opBanner.innerHTML = `<span class="op-tag">OPPOSITE MAJORITY TRIGGERED</span><span>Consensus was ${F.oppositeMajority.rawConsensus} (${Math.round(F.oppositeMajority.consensusStrength * 100)}%) — Trap Risk: ${Math.round(F.oppositeMajority.trapRiskScore * 100)}%</span>`;
    } else {
      opBanner.className = 'op-banner normal';
      opBanner.innerHTML = `<span class="op-tag">CONSENSUS ALIGNED</span><span>Matrix & Brain agree with ${F.signal} trend</span>`;
    }
  }

  const bigPct = total ? Math.round((F.bigVotes / total) * 100) : 50;
  const vb = $('voteBig');
  if (vb) {
    vb.style.width = bigPct + '%';
    vb.textContent = bigPct >= 18 ? `BIG ${F.bigVotes}` : '';
  }
  const vs = $('voteSmall');
  if (vs) {
    vs.style.width = 100 - bigPct + '%';
    vs.textContent = 100 - bigPct >= 18 ? `SMALL ${F.smallVotes}` : '';
  }
  const vv = $('voteVal');
  if (vv) vv.textContent = `${bigPct}% vs ${100 - bigPct}%`;

  const p0 = F.probabilities.state_0 || 0.5;
  const p1 = F.probabilities.state_1 || 0.5;
  const pdB = $('pdBigV');
  if (pdB) pdB.textContent = (p1 * 100).toFixed(1) + '%';
  const pdS = $('pdSmallV');
  if (pdS) pdS.textContent = (p0 * 100).toFixed(1) + '%';
  const bBar = $('pdBigBar');
  if (bBar) bBar.style.width = p1 * 100 + '%';
  const sBar = $('pdSmallBar');
  if (sBar) sBar.style.width = p0 * 100 + '%';

  $('pdBig')?.classList.toggle('win-side', isBig);
  $('pdSmall')?.classList.toggle('win-side', !isBig);

  const cv = $('chipVotes');
  if (cv) cv.textContent = `${F.bigVotes}/${total}`;
  const csamp = $('chipSamples');
  if (csamp) csamp.textContent = String(Math.min(600, S.recs[mode].length));

  const mp = $('metaPeriod');
  if (mp) mp.textContent = String(target).slice(-5);
  const mm = $('metaMode');
  if (mm) mm.textContent = mode === '30s' ? '30 SEC' : '1 MIN';
  const ms = $('metaSignal');
  if (ms) {
    ms.textContent = F.signal;
    ms.style.color = isBig ? '#f5b40a' : '#38c8ff';
  }
  const mst = $('metaStatus');
  if (mst) mst.textContent = F.oppositeMajority.isReversed ? 'OPP-MAJ' : 'OPTIMAL';
}

// PERIOD TIMER
setInterval(() => {
  const el = $('metaTimer');
  if (!el) return;
  if (!S.running) {
    el.textContent = '--:--';
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const rem = S.mode === '30s' ? 30 - (now % 30) : 60 - (now % 60);
  el.textContent = '00:' + String(rem).padStart(2, '0');
}, 1000);

// HISTORY RENDER
function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  const w = S.history.filter(h => h.win === true).length;
  const l = S.history.filter(h => h.win === false).length;
  const tot = w + l;

  const hsw = $('hsWins');
  if (hsw) hsw.textContent = String(w);
  const hsl = $('hsLoss');
  if (hsl) hsl.textContent = String(l);
  const hsa = $('hsAcc');
  if (hsa) hsa.textContent = tot ? Math.round((w / tot) * 100) + '%' : '0%';
  const hsb = $('hsBest');
  if (hsb) hsb.textContent = String(S.stats.best || 0);
  const hc = $('histCount');
  if (hc) hc.textContent = S.history.length + ' ROUND' + (S.history.length === 1 ? '' : 'S');

  const sl = S.history.slice(0, 20).reverse();
  let html = '';
  for (let i = 0; i < 20; i++) {
    const h = sl[i];
    html += h ? (h.win ? '<span class="d w"></span>' : '<span class="d l"></span>') : '<span class="d"></span>';
  }
  const ht = $('histTrail');
  if (ht) ht.innerHTML = html;
  const s20 = S.history.slice(0, 20);
  const hr = $('histRate');
  if (hr) hr.textContent = s20.length ? Math.round((s20.filter(h => h.win).length / s20.length) * 100) + '%' : '—';

  if (!S.history.length) {
    list.innerHTML =
      '<div class="card"><div class="empty"><b>NO ROUNDS YET</b>Home tab par START dabao.<br>Wins aur losses yahan dikhenge.</div></div>';
    return;
  }

  list.innerHTML = S.history
    .map(h => {
      const cls = h.win ? '' : 'loss';
      const icon = h.win
        ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      const st = h.win ? 'WIN' : 'LOSS';
      return `<div class="hitem ${cls}">
      <div class="st"><div class="ic">${icon}</div><div class="l">${st}</div></div>
      <div class="hbody">
        <div class="htop">
          <span class="per">#${String(h.period).slice(-5)}</span>
          <span class="mc">${h.mode === '30s' ? '30 SEC' : '1 MIN'}</span>
          ${h.isReversed ? '<span class="tag-reversed">OPP-MAJ</span>' : ''}
        </div>
        <div class="hvs">
          <div class="hside">
            <div class="sk">PREDICTED</div>
            <div class="sv">${h.prediction}${h.predNum ? h.predNum.map(n => ' <span class="num">' + n + '</span>').join('') : ''}</div>
          </div>
          <div class="harr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
          <div class="hside act">
            <div class="sk">ACTUAL</div>
            <div class="sv">${h.actual} <span class="num">${h.actualNum}</span></div>
          </div>
        </div>
        <div class="hfoot">
          <span><b>BRAIN-MATRIX V7</b></span>
          ${h.confidence ? '<span>• CONF ' + Math.round(h.confidence) + '%</span>' : ''}
        </div>
      </div>
    </div>`;
    })
    .join('');
}

// WIN POPUP
function showWin(period: string, mode: '30s' | '1m', lp: any, actual: SignalType, actualNum: number, jackpot: boolean) {
  const wp = $('wnPeriod');
  if (wp) wp.textContent = String(period).slice(-5);
  const wm = $('wnMode');
  if (wm) wm.textContent = mode === '30s' ? 'WIN GO 30s' : 'WIN GO 1M';
  const wpred = $('wnPred');
  if (wpred) wpred.textContent = lp.signal;
  const wact = $('wnActual');
  if (wact) wact.textContent = actual;
  const wactn = $('wnActualNum');
  if (wactn) wactn.textContent = String(actualNum);
  const wstrk = $('wnStreak');
  if (wstrk) wstrk.textContent = '+' + S.stats.streak + ' WIN STREAK';
  const wamt = $('wnAmount');
  if (wamt) wamt.textContent = jackpot ? 'JACKPOT NUM HIT!' : 'YOU WIN!';
  const wr = $('wnRibbon');
  if (wr) wr.textContent = jackpot ? 'MATRIX JACKPOT' : 'VICTORY';
  const wpn = $('wnPredNum');
  if (wpn) {
    wpn.innerHTML = [lp.prime, lp.backup]
      .map(n => (jackpot && n === actualNum ? '<b style="color:var(--win)">' + n + ' ✓</b>' : n))
      .join(' & ');
  }

  const cf = $('confetti');
  if (cf) {
    cf.innerHTML = '';
    const cols = ['#f5b40a', '#14e0c8', '#22d37f', '#38c8ff', '#ff4d6d', '#8b6cff', '#fff'];
    for (let i = 0; i < 50; i++) {
      const c = document.createElement('div');
      c.className = 'cfp';
      c.style.left = Math.random() * 100 + '%';
      c.style.background = cols[i % cols.length];
      c.style.animationDelay = Math.random() * 0.6 + 's';
      c.style.animationDuration = 1.4 + Math.random() * 1.2 + 's';
      if (Math.random() > 0.5) c.style.borderRadius = '50%';
      cf.appendChild(c);
    }
  }
  $('winOverlay')?.classList.add('show');
}

// ENGINE BREAKDOWN TAB
const ALGO_LABELS: Record<string, string> = {
  matrix_markov_2x2: '1. MARKOV 2x2 TRANSITION MATRIX',
  matrix_context_4x2: '2. 4x2 CONTEXT STATE PROBABILITY',
  digit_matrix_projection: '3. 10x10 DIGIT TRANSITION PROJECTION',
  brain_system1_heuristic: '4. AI BRAIN: SYSTEM 1 (INTUITION)',
  brain_system2_logic: '5. AI BRAIN: SYSTEM 2 (CALCULATION)',
  gamblers_fallacy_tracker: '6. GAMBLER’S FALLACY REVERSAL FILTER',
  hot_hand_momentum: '7. HOT-HAND MOMENTUM VECTOR',
  cognitive_fatigue_oscillator: '8. COGNITIVE FATIGUE OSCILLATOR',
  exponential_moving_decay: '9. EWMA EXPONENTIAL DECAY',
  fibonacci_temporal_wave: '10. FIBONACCI TEMPORAL WAVE',
  bayesian_conjugate_update: '11. BAYESIAN CONJUGATE PRIOR',
  shannon_entropy_weight: '12. SHANNON ENTROPY EQUILIBRIUM',
  knn_triplet_correlator: '13. k-NN TRIPLET PATTERN CORRELATOR',
  poisson_rate_estimator: '14. POISSON DISCRETE ARRIVAL',
  quantum_phase_tensor: '15. QUANTUM PHASE TENSOR'
};

function renderEngineTab() {
  const F = S.lastAnalysis;
  const v = $('engineView');
  if (!v) return;

  if (!S.unlocked) {
    v.innerHTML =
      '<div class="card"><div class="empty"><b>🔒 PREMIUM LOCKED</b>Unlock with a license key<br>to view the AI Brain, Opposite Majority, and Matrix breakdown.</div></div>';
    return;
  }
  if (!F) {
    v.innerHTML =
      '<div class="card"><div class="empty"><b>NO ANALYSIS YET</b>Home tab se engine start karo.<br>AI Human Brain aur Matrix ka pura live analysis yahan aayega.</div></div>';
    return;
  }

  const isBig = F.signal === 'BIG';
  const m = F.matrix;
  const b = F.brain;
  const om = F.oppositeMajority;

  let h = '';

  // 1. Fusion Verdict Card
  h += `<div class="card">
    <div class="card-t">FUSION VERDICT<span class="tag">BRAIN-MATRIX V7</span></div>
    <div class="meta-row" style="margin-top:0">
      <div class="meta"><div class="k">SIGNAL</div><div class="v" style="color:${isBig ? '#f5b40a' : '#38c8ff'}">${F.signal}</div></div>
      <div class="meta"><div class="k">CONFIDENCE</div><div class="v" style="color:var(--primary)">${F.confidence}%</div></div>
      <div class="meta"><div class="k">P(BIG)</div><div class="v">${((F.probabilities.state_1 || 0.5) * 100).toFixed(1)}%</div></div>
      <div class="meta"><div class="k">P(SMALL)</div><div class="v">${((F.probabilities.state_0 || 0.5) * 100).toFixed(1)}%</div></div>
      <div class="meta"><div class="k">PRIME</div><div class="v" style="color:var(--primary)">${F.prime}</div></div>
      <div class="meta"><div class="k">BACKUP</div><div class="v">${F.backup}</div></div>
    </div>
  </div>`;

  // 2. AI HUMAN BRAIN Cognitive Heuristics Card
  h += `<div class="card" style="border-color:var(--primary-border)">
    <div class="card-t">🧠 AI HUMAN BRAIN HEURISTICS<span class="tag">NEURO-PROBABILITY</span></div>
    <div class="brain-grid">
      <div class="bg-item">
        <div class="bg-lbl">SYSTEM 1 (INTUITION)</div>
        <div class="bg-val">${Math.round(b.system1Score * 100)}%</div>
        <div class="bg-bar"><i style="width:${Math.round(b.system1Score * 100)}%"></i></div>
      </div>
      <div class="bg-item">
        <div class="bg-lbl">SYSTEM 2 (LOGIC)</div>
        <div class="bg-val">${Math.round(b.system2Score * 100)}%</div>
        <div class="bg-bar"><i style="width:${Math.round(b.system2Score * 100)}%"></i></div>
      </div>
      <div class="bg-item">
        <div class="bg-lbl">GAMBLER’S FALLACY BIAS</div>
        <div class="bg-val">${(b.gamblersFallacyBias > 0 ? '+' : '') + Math.round(b.gamblersFallacyBias * 100)}%</div>
        <div class="bg-bar"><i style="width:${Math.abs(Math.round(b.gamblersFallacyBias * 100))}%"></i></div>
      </div>
      <div class="bg-item">
        <div class="bg-lbl">HOT-HAND MOMENTUM</div>
        <div class="bg-val">${Math.round(b.hotHandMomentum * 100)}%</div>
        <div class="bg-bar"><i style="width:${Math.round(b.hotHandMomentum * 100)}%"></i></div>
      </div>
      <div class="bg-item full">
        <div class="bg-lbl">COGNITIVE FATIGUE / CHURN</div>
        <div class="bg-val">${Math.round(b.cognitiveFatigue * 100)}%</div>
        <div class="bg-bar"><i style="width:${Math.round(b.cognitiveFatigue * 100)}%"></i></div>
      </div>
    </div>
  </div>`;

  // 3. OPPOSITE MAJORITY Logic Card
  h += `<div class="card" style="border-color:${om.isReversed ? 'var(--loss)' : 'var(--border)'}">
    <div class="card-t">⚡ OPPOSITE MAJORITY LOGIC<span class="tag">${om.isReversed ? 'TRIGGERED' : 'MONITORING'}</span></div>
    <div class="om-card">
      <div class="om-row">
        <div class="om-box">
          <div class="k">RAW CONSENSUS</div>
          <div class="v">${om.rawConsensus} (${om.herdSize}/15)</div>
        </div>
        <div class="om-box">
          <div class="k">HERD STRENGTH</div>
          <div class="v">${Math.round(om.consensusStrength * 100)}%</div>
        </div>
        <div class="om-box">
          <div class="k">TRAP RISK SCORE</div>
          <div class="v" style="color:${om.trapRiskScore > 0.65 ? 'var(--loss)' : 'var(--win)'}">${Math.round(om.trapRiskScore * 100)}%</div>
        </div>
      </div>
      <div class="om-alert ${om.isReversed ? 'danger' : 'safe'}">
        <b>${om.isReversed ? '⚠️ CONTRARIAN INVERSION APPLIED' : '✓ HERD ALIGNMENT SAFE'}</b>
        <span>${om.reason}</span>
      </div>
    </div>
  </div>`;

  // 4. MATRIX PROBABILITY: 2x2 Markov Transition & Context Matrix
  const m2 = m.transitionMatrix2x2;
  h += `<div class="card">
    <div class="card-t">📊 MARKOV TRANSITION PROBABILITY MATRIX<span class="tag">2x2 & 4x2</span></div>
    <div class="matrix-grid">
      <div class="matrix-cell"><div class="m-k">P(BIG → BIG)</div><div class="m-v">${(m2.fromBig.toBig * 100).toFixed(1)}%</div></div>
      <div class="matrix-cell"><div class="m-k">P(BIG → SMALL)</div><div class="m-v">${(m2.fromBig.toSmall * 100).toFixed(1)}%</div></div>
      <div class="matrix-cell"><div class="m-k">P(SMALL → BIG)</div><div class="m-v">${(m2.fromSmall.toBig * 100).toFixed(1)}%</div></div>
      <div class="matrix-cell"><div class="m-k">P(SMALL → SMALL)</div><div class="m-v">${(m2.fromSmall.toSmall * 100).toFixed(1)}%</div></div>
    </div>
    <div class="matrix-footer">
      <span>Matrix P(Big): <b>${(m.matrixProbBig * 100).toFixed(1)}%</b></span>
      <span>Matrix P(Small): <b>${(m.matrixProbSmall * 100).toFixed(1)}%</b></span>
      <span>Entropy: <b>${m.entropy.toFixed(3)}</b></span>
    </div>
  </div>`;

  // 5. 10x10 DIGIT PROBABILITY TENSOR (0-9)
  h += `<div class="card">
    <div class="card-t">🎯 DIGIT PROBABILITY DISTRIBUTION (0-9)<span class="tag">MATRIX RANK</span></div>
    <div class="digit-bars">
      ${m.digitProbabilities
        .map((prob, idx) => {
          const isPrime = idx === F.prime;
          const isBackup = idx === F.backup;
          const isB = idx >= 5;
          const pct = Math.round(prob * 100);
          return `<div class="digit-col ${isPrime ? 'prime' : ''} ${isBackup ? 'backup' : ''}">
          <div class="d-bar-track"><div class="d-bar-fill ${isB ? 'big' : 'small'}" style="height:${Math.max(8, pct * 3)}px"></div></div>
          <div class="d-num ${isB ? 'big' : 'small'}">${idx}</div>
          <div class="d-pct">${pct}%</div>
        </div>`;
        })
        .join('')}
    </div>
  </div>`;

  // 6. 15 Modern Algorithm Votes
  const bd = F.algorithmBreakdown || {};
  const keys = Object.keys(bd);
  h += `<div class="card">
    <div class="card-t">15 PREDICTIVE ALGORITHMS — LIVE VOTES<span class="tag">${F.bigVotes}B / ${F.smallVotes}S</span></div>
    <div class="algo-grid">
      ${keys
        .map((k, idx) => {
          const p = bd[k];
          const vote = p[1] >= p[0] ? 'B' : 'S';
          return `<div class="algo-item">
          <div class="idx">${idx + 1}</div>
          <div class="nm">${ALGO_LABELS[k] || k}</div>
          <div class="vote ${vote}">${vote === 'B' ? 'BIG' : 'SMALL'}</div>
          <div class="prob">${(p[1] * 100).toFixed(0)}/${(p[0] * 100).toFixed(0)}</div>
        </div>`;
        })
        .join('')}
    </div>
  </div>`;

  v.innerHTML = h;
}

// DEMO MODE
export function runDemo() {
  if (S.running) stopEngine();
  S.demo = true;
  S.running = true;
  switchTab('home');
  const sBtn = $('startBtn');
  if (sBtn) {
    sBtn.textContent = '■ STOP DEMO';
    sBtn.classList.add('stop');
  }
  const mode = S.mode;
  const base = BigInt('2026090510' + (mode === '30s' ? '01' : '00') + '0001');
  const arr: HistoryRecord[] = [];
  let v = 6;
  for (let i = 0; i < 120; i++) {
    v = (v + Math.floor(Math.random() * 7) + 1) % 10;
    arr.unshift({ period: (base + BigInt(i)).toString(), number: v });
  }
  S.recs[mode] = arr;
  toast('DEMO MODE: Testing AI Brain & Matrix Engine');
  runCycle(mode);
  S.demoTimer = setInterval(() => {
    if (!S.demo) return;
    const last = S.recs[mode][0];
    S.recs[mode].unshift({
      period: nextPeriod(last.period),
      number: Math.floor(Math.random() * 10)
    });
    runCycle(mode);
  }, mode === '30s' ? 8000 : 11000);
}

// THEME SYSTEM
const THEMES = [
  { id: '', n: 'GOLD NOIR', sw: 'linear-gradient(135deg,#f5b40a,#0c1020)' },
  { id: 'mint', n: 'MINT', sw: 'linear-gradient(135deg,#22e5a4,#0c1020)' },
  { id: 'violet', n: 'VIOLET', sw: 'linear-gradient(135deg,#8b6cff,#0c1020)' },
  { id: 'crimson', n: 'CRIMSON', sw: 'linear-gradient(135deg,#ff4d6d,#0c1020)' },
  { id: 'ice', n: 'ICE', sw: 'linear-gradient(135deg,#38c8ff,#0c1020)' },
  { id: 'ember', n: 'EMBER', sw: 'linear-gradient(135deg,#ff7a1a,#0c1020)' },
  { id: 'pearl', n: 'PEARL', sw: 'linear-gradient(135deg,#4f46e5,#e6e9ff)' },
  { id: 'rose', n: 'ROSE', sw: 'linear-gradient(135deg,#e11d74,#ffe4f0)' }
];

function renderThemes() {
  const cur = localStorage.getItem(LS.theme) || '';
  const tg = $('themeGrid');
  if (!tg) return;
  tg.innerHTML = THEMES.map(
    t => `<div class="sw ${t.id === cur ? 'sel' : ''}" style="background:${t.sw}" onclick="window.__ARX.setTheme('${t.id}')">
    <div class="ck"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
    <div class="nm">${t.n}</div>
  </div>`
  ).join('');
}

export function setTheme(id: string) {
  if (id) document.documentElement.setAttribute('data-theme', id);
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem(LS.theme, id);
  renderThemes();
  toast('✓ Theme applied');
}

// BOOT INITIALIZATION
loadRecs();
const savedTheme = localStorage.getItem(LS.theme);
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
renderThemes();
renderHistory();
refreshStats();
updateLockUI();
const mm = $('metaMode');
if (mm) mm.textContent = '1 MIN';

autoVerifyOnBoot();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.running && !S.demo && !S.busy) {
    poll();
  }
});

// Bind globally to window for UI onclick attributes
(window as any).__ARX = {
  S,
  runCycle,
  nextPeriod,
  engineInstance,
  verifyKey,
  openDrawer,
  closeDrawer,
  switchTab,
  openLock,
  closeLock,
  doUnlock,
  toggleHidePred,
  playGame,
  closeGame,
  toggleGameUI,
  selectMode,
  toggleEngine,
  resetAllStats,
  clearAppCache,
  closeWin,
  runDemo,
  setTheme
};

// Also attach individual methods to window directly for HTML onclick handlers
Object.assign(window, (window as any).__ARX);
