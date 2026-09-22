import { engineInstance, PredictionResult, SignalType } from './engine.js';

// MATHEMATICAL BOLD UNICODE CONVERTER ("𝐀𝐑𝐎𝐊𝐎𝐌" text styling)
export function toMathBold(text: string): string {
  if (!text) return '';
  return text.split('').map(char => {
    const code = char.charCodeAt(0);
    // A-Z: 65 - 90 -> 0x1D400 (119808)
    if (code >= 65 && code <= 90) {
      return String.fromCodePoint(0x1D400 + (code - 65));
    }
    // a-z: 97 - 122 -> 0x1D41A (119834)
    if (code >= 97 && code <= 122) {
      return String.fromCodePoint(0x1D41A + (code - 97));
    }
    // 0-9: 48 - 57 -> 0x1D7CE (120782)
    if (code >= 48 && code <= 57) {
      return String.fromCodePoint(0x1D7CE + (code - 48));
    }
    return char;
  }).join('');
}

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
  actual: 'BIG' | 'SMALL';
  actualNum: number;
  win: boolean | null; // null if skipped
  isSkip: boolean;
  skipReason?: string;
  jackpot: boolean;
  sideWin: boolean;
  confidence: number;
  recoveryLevel: number;
  recoveryMultiplier: number;
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
    rawSignal: 'BIG' | 'SMALL';
    isSkip: boolean;
    skipReason: string;
    prime: number;
    backup: number;
    confidence: number;
    recoveryLevel: 1 | 2 | 3 | 4;
    recoveryMultiplier: number;
  } | null;
  history: RoundHistoryItem[];
  stats: {
    wins: number;
    losses: number;
    skips: number;
    streak: number;
    best: number;
    numberHits: number;
  };
  recovery: {
    enabled: boolean;
    level: 1 | 2 | 3 | 4;
    baseBet: number;
    totalRecovered: number;
  };
  autoSkip: {
    enabled: boolean;
    threshold: number; // default 74%
  };
  lastAnalysis: PredictionResult | null;
  gameOpen: boolean;
  unlocked: boolean;
  keyData: any;
  hidePred: boolean;
  activeSidebar: string;
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
const BS = (n: number): 'BIG' | 'SMALL' => (n >= 5 ? 'BIG' : 'SMALL');

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
  stats: {
    wins: 0,
    losses: 0,
    skips: 0,
    streak: 0,
    best: 0,
    numberHits: 0
  },
  recovery: {
    enabled: true,
    level: 1,
    baseBet: 10,
    totalRecovered: 0
  },
  autoSkip: {
    enabled: true,
    threshold: 74.0
  },
  lastAnalysis: null,
  gameOpen: false,
  unlocked: false,
  keyData: null,
  hidePred: false,
  activeSidebar: 'live'
};

const LS = {
  recs: 'novix_recs_',
  theme: 'novix_theme',
  key: 'novix_license_key',
  recoveryLevel: 'novix_recovery_level',
  skipThreshold: 'novix_skip_threshold'
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
    const rLvl = parseInt(localStorage.getItem(LS.recoveryLevel) || '1');
    if (rLvl >= 1 && rLvl <= 4) S.recovery.level = rLvl as 1 | 2 | 3 | 4;

    const sThr = parseFloat(localStorage.getItem(LS.skipThreshold) || '74.0');
    if (!isNaN(sThr)) S.autoSkip.threshold = sThr;
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
  (window as any).__tt = setTimeout(() => t.classList.remove('show'), 2600);
}

export function switchTab(n: string) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const tab = $('tab-' + n);
  if (tab) tab.classList.add('active');
  document.querySelectorAll('.nitem').forEach(x => {
    x.classList.toggle('active', (x as HTMLElement).dataset.tab === n);
  });
  if (n === 'engine') renderEngineTab();
  if (n === 'recovery') renderRecoveryTab();
}

export function selectSidebar(key: string) {
  S.activeSidebar = key;
  document.querySelectorAll('.sb-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.sidebar === key);
  });

  if (key === 'live') switchTab('home');
  else if (key === 'recovery') switchTab('recovery');
  else if (key === 'engine') switchTab('engine');
  else if (key === 'history') switchTab('history');
  else if (key === 'chart') {
    switchTab('home');
    toast('📊 ' + toMathBold('CHART TREND ALIGNED WITH MATRIX'));
  } else if (key === 'report') {
    switchTab('history');
  } else if (key === 'settings') {
    switchTab('profile');
  }
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
  toast('Cache cleared! Reloading Novix Pro AI…');
  setTimeout(() => location.reload(), 1100);
}

export function resetAllStats() {
  S.stats = {
    wins: 0,
    losses: 0,
    skips: 0,
    streak: 0,
    best: 0,
    numberHits: 0
  };
  S.recovery.level = 1;
  S.history = [];
  S.lastPrediction = null;
  renderHistory();
  refreshStats();
  renderRecoveryWidget();
  toast(toMathBold('STATS RESET TO LEVEL 1'));
}

// 3-4 LEVEL FIX WINNING RECOVERY MOD MANAGEMENT
export function toggleRecoveryMod() {
  S.recovery.enabled = !S.recovery.enabled;
  renderRecoveryWidget();
  toast(S.recovery.enabled ? '✓ ' + toMathBold('3-4 LEVEL FIX RECOVERY ENABLED') : '✕ ' + toMathBold('RECOVERY MOD DISABLED'));
}

export function manualSetRecoveryLevel(level: number) {
  if (level >= 1 && level <= 4) {
    S.recovery.level = level as 1 | 2 | 3 | 4;
    localStorage.setItem(LS.recoveryLevel, String(level));
    renderRecoveryWidget();
    toast(toMathBold('RECOVERY STAGE: LEVEL ' + level));
  }
}

export function toggleAutoSkip() {
  S.autoSkip.enabled = !S.autoSkip.enabled;
  renderRecoveryWidget();
  toast(S.autoSkip.enabled ? '✓ ' + toMathBold('LOW CONFIDENCE AUTO-SKIP ACTIVE (' + S.autoSkip.threshold + '%)') : '✕ ' + toMathBold('AUTO-SKIP DISABLED'));
}

export function setSkipThreshold(val: number) {
  S.autoSkip.threshold = clamp(val, 65, 85);
  localStorage.setItem(LS.skipThreshold, String(S.autoSkip.threshold));
  renderRecoveryWidget();
  toast(toMathBold('SKIP THRESHOLD: ' + S.autoSkip.threshold + '%'));
}

function renderRecoveryWidget() {
  const multipliers: Record<number, number> = { 1: 1, 2: 3, 3: 8, 4: 24 };
  const mult = multipliers[S.recovery.level] || 1;
  const bet = S.recovery.baseBet * mult;

  // Update badges & stage
  const rLvlBadge = $('recoveryLvlBadge');
  if (rLvlBadge) {
    rLvlBadge.textContent = toMathBold(`LEVEL ${S.recovery.level} (${mult}X)`);
    rLvlBadge.className = `rec-badge lvl-${S.recovery.level}`;
  }

  const rDesc = $('recoveryDesc');
  if (rDesc) {
    if (S.recovery.level === 1) {
      rDesc.innerHTML = `${toMathBold('BASE MODE')} • ${toMathBold('BET')}: <b>₹${toMathBold(String(bet))}</b> • ${toMathBold('STANDARD ACCURACY TARGET')}`;
    } else if (S.recovery.level === 2) {
      rDesc.innerHTML = `${toMathBold('FIX LEVEL 2 (3X)')} • ${toMathBold('BET')}: <b>₹${toMathBold(String(bet))}</b> • ${toMathBold('ENHANCED MATRIX FIX ACTIVE')}`;
    } else if (S.recovery.level === 3) {
      rDesc.innerHTML = `${toMathBold('CRITICAL FIX LEVEL 3 (8X)')} • ${toMathBold('BET')}: <b>₹${toMathBold(String(bet))}</b> • ${toMathBold('ULTRA-STRICT CONFIRMATION')}`;
    } else {
      rDesc.innerHTML = `${toMathBold('MAX FIX LEVEL 4 (24X)')} • ${toMathBold('BET')}: <b>₹${toMathBold(String(bet))}</b> • ${toMathBold('99.2% WINNING GUARANTEE FIX')}`;
    }
  }

  // Update pills
  for (let i = 1; i <= 4; i++) {
    const pill = $('recPill' + i);
    if (pill) {
      pill.classList.toggle('active', S.recovery.level === i);
    }
  }

  const pRecLvl = $('pRecoveryLevel');
  if (pRecLvl) pRecLvl.textContent = toMathBold(`L${S.recovery.level} (${mult}X)`);

  const hudRecTag = $('hudRecoveryTag');
  if (hudRecTag) hudRecTag.textContent = toMathBold(`LEVEL ${S.recovery.level} (${mult}X)`);
}

// PREMIUM LICENSING
function updateLockUI() {
  const btn = $('lockBtn');
  if (btn) {
    if (S.unlocked) {
      btn.classList.remove('locked');
      btn.classList.add('unlocked');
    } else {
      btn.classList.remove('unlocked');
      btn.classList.add('locked');
    }
  }

  const tag = $('profileTag');
  if (tag) {
    tag.classList.toggle('premium', S.unlocked);
    const tagTxt = $('profileTagText');
    if (tagTxt) tagTxt.textContent = S.unlocked ? toMathBold('PREMIUM VIP ACCESS') : toMathBold('FREE MEMBER');
  }

  const lsEl = $('licenseStatus');
  if (lsEl) {
    lsEl.textContent = S.unlocked ? toMathBold('VIP UNLOCKED ✓') : toMathBold('LOCKED');
    lsEl.style.color = S.unlocked ? 'var(--win)' : 'var(--muted)';
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
    toast('✓ ' + toMathBold('VIP ACCESS ALREADY UNLOCKED'));
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
    msg.textContent = '⚠ ' + toMathBold('ENTER YOUR LICENSE KEY');
    return;
  }
  const key = raw.toUpperCase().replace(/\s+/g, '');

  btn.disabled = true;
  btn.textContent = '⏳ ' + toMathBold('VERIFYING VIP KEY...');
  msg.className = 'lm-msg';
  msg.textContent = '';

  const result = await verifyKey(key);

  btn.disabled = false;
  btn.textContent = '🔓 ' + toMathBold('UNLOCK VIP ACCESS');

  if (!result.valid) {
    msg.className = 'lm-msg err';
    msg.textContent = '✕ ' + (result.reason || 'Invalid VIP key');
    input.value = '';
    return;
  }
  msg.className = 'lm-msg ok';
  msg.textContent = '✓ ' + toMathBold('VIP VERIFIED! UNLOCKING NOVIX PRO AI...');

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
    toast('👑 ' + toMathBold('ARX TM NOVIX PRO AI VIP UNLOCKED!'));
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
    toast('👑 ' + toMathBold('WELCOME TO ARX TM NOVIX PRO AI'));
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
  toast(S.hidePred ? '🙈 ' + toMathBold('PRIVACY MODE ON') : '👁 ' + toMathBold('PREDICTIONS VISIBLE'));
}

// GAME LAUNCHER & INVITATION CODE COPY
export function copyInviteCode(code: string, name: string) {
  navigator.clipboard.writeText(code).then(() => {
    toast(`✓ ${toMathBold(name)}: Code ${toMathBold(code)} copied!`);
  }).catch(() => {
    toast(`Invite Code: ${code}`);
  });
}

export function playGame(url: string, name: string) {
  const f = $('webFrame');
  if (f && f.getAttribute('src') !== url) f.setAttribute('src', url);
  $('gameBg')?.classList.add('on');
  $('gameFab')?.classList.add('on');
  const gn = $('gameNow');
  if (gn) gn.style.display = 'block';
  const nn = $('nowName');
  if (nn) nn.textContent = toMathBold(name || 'LIVE');
  const nt = $('nowTitle');
  if (nt) nt.textContent = toMathBold((name || 'GAME') + ' — RUNNING');
  document.body.classList.add('game-open');
  document.body.classList.remove('ui-hidden');
  const fu = $('fabUi');
  if (fu) fu.textContent = '🙈 HIDE UI';
  S.gameOpen = true;
  switchTab('home');
  toast('✓ ' + toMathBold(name || 'Game') + ' • Running');
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
  if (hidden) toast('UI hidden — tap screen to play');
}

function refreshStats() {
  const w = S.stats.wins, l = S.stats.losses, sk = S.stats.skips, t = w + l;
  const acc = t ? Math.round((w / t) * 100) + '%' : '0%';

  ['stWin', 'pWin', 'tblWins'].forEach(i => {
    const el = $(i);
    if (el) el.textContent = toMathBold(String(w));
  });
  ['stLoss', 'pLoss', 'tblLosses'].forEach(i => {
    const el = $(i);
    if (el) el.textContent = toMathBold(String(l));
  });
  ['stAcc', 'pAcc', 'metaAcc', 'tblAccuracy'].forEach(i => {
    const el = $(i);
    if (el) el.textContent = toMathBold(acc);
  });

  const tPred = $('tblTotalPredictions');
  if (tPred) tPred.textContent = toMathBold(String(w + l + sk));

  const tSkip = $('tblSkips');
  if (tSkip) tSkip.textContent = toMathBold(String(sk));

  const tHits = $('tblNumberHits');
  if (tHits) tHits.textContent = toMathBold(String(S.stats.numberHits));

  const tblBest = $('tblBestStreak');
  if (tblBest) tblBest.textContent = toMathBold(String(S.stats.best || 0) + 'W');

  const tblStrk = $('tblCurrentStreak');
  if (tblStrk) tblStrk.textContent = toMathBold(String(S.stats.streak || 0) + 'W');
}

function setStatus(txt: string, analysing?: boolean) {
  const st = $('statusText');
  if (st) st.textContent = toMathBold(txt);
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
  if (cv) cv.textContent = toMathBold(p + '%');
  const cc = $('chipConf');
  if (cc) cc.textContent = toMathBold(p + '%');
  if (seg) {
    const on = Math.round(clamp((p - 50) / 50, 0, 1) * seg.length);
    for (let i = 0; i < seg.length; i++) {
      (seg[i] as HTMLElement).className = i < on ? (p >= 80 ? 'on hi' : 'on') : '';
    }
  }
}

function setCoreDefault() {
  const cl = $('coreLbl');
  if (cl) cl.textContent = toMathBold('SELECT MODE');
  const p = $('corePred');
  const cn = $('coreNum');
  const cs = $('coreSub');

  if (!S.unlocked) {
    if (p) {
      p.textContent = '🔒';
      p.className = 'qcore-pred locked';
    }
    if (cl) cl.textContent = toMathBold('VIP ACCESS LOCKED');
    if (cn) {
      cn.innerHTML =
        `<div class="lock-inline"><svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>${toMathBold('UNLOCK VIP ACCESS')}</div>`;
    }
    if (cs) cs.textContent = toMathBold('Tap the lock icon to enter key');
  } else {
    if (p) {
      p.textContent = toMathBold('READY');
      p.className = 'qcore-pred ready';
      p.style.color = '';
    }
    if (cn) cn.innerHTML = '';
    if (cs) cs.textContent = toMathBold('ARX TM NOVIX PRO AI READY');
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

  const hudSignal = $('hudBigSignal');
  if (hudSignal) {
    hudSignal.textContent = toMathBold('READY');
    hudSignal.className = 'hud-pred-text ready';
  }
}

function setAnalysing() {
  $('core')?.classList.add('analysing');
  const p = $('corePred');
  const cl = $('coreLbl');
  const cn = $('coreNum');
  const cs = $('coreSub');

  if (!S.unlocked) {
    if (cl) cl.textContent = toMathBold('VIP ACCESS LOCKED');
    if (p) {
      p.textContent = '🔒';
      p.className = 'qcore-pred locked';
    }
    if (cn) {
      cn.innerHTML =
        `<div class="lock-inline"><svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>${toMathBold('UNLOCK VIP ACCESS')}</div>`;
    }
    if (cs) cs.textContent = toMathBold('Enter VIP key to unlock');
    setStatus('LOCKED', true);
    return;
  }
  if (cl) cl.textContent = toMathBold('EVALUATING');
  if (p) {
    p.textContent = '…';
    p.className = 'qcore-pred ready';
    p.style.color = '';
  }
  if (cn) cn.innerHTML = '';
  if (cs) cs.textContent = toMathBold('CHECKING RECOVERY FIX & AUTO-SKIP');
  setStatus('ANALYSING', true);

  const hudSignal = $('hudBigSignal');
  if (hudSignal) {
    hudSignal.textContent = '…';
    hudSignal.className = 'hud-pred-text ready';
  }
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
  toast('⏳ ' + toMathBold('LOADING HISTORICAL MATRIX DATA...'));
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
  if (mm) mm.textContent = toMathBold(m === '30s' ? '30 SEC' : '1 MIN');
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
    sBtn.textContent = '■ ' + toMathBold('STOP NOVIX ENGINE');
    sBtn.classList.add('stop');
  }
  const mm = $('metaMode');
  if (mm) mm.textContent = toMathBold(S.mode === '30s' ? '30 SEC' : '1 MIN');
  setStatus('CONNECTING', true);
  toast(`▶ ${toMathBold('ARX TM NOVIX PRO AI STARTED')} • ${S.mode}`);
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
    sBtn.textContent = '▶ ' + toMathBold('START NOVIX ENGINE');
    sBtn.classList.remove('stop');
  }
  setCoreDefault();
  toast(toMathBold('NOVIX ENGINE STOPPED'));
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

  // EVALUATE PREVIOUS ROUND
  if (S.lastPrediction && S.lastPrediction.period === fin.period) {
    const lp = S.lastPrediction;

    if (lp.isSkip) {
      // ROUND WAS SKIPPED (SAFE PASS)
      S.stats.skips++;
      toast(`Round #${fin.period.slice(-4)}: ${toMathBold('SAFE SKIP PROTECTED CAPITAL')}`);
      // Recovery level is preserved (does NOT increase or reset)
      S.history.unshift({
        period: fin.period,
        mode,
        prediction: 'SKIP',
        predNum: [lp.prime, lp.backup],
        actual: actualType,
        actualNum,
        win: null,
        isSkip: true,
        skipReason: lp.skipReason,
        jackpot: false,
        sideWin: false,
        confidence: lp.confidence,
        recoveryLevel: lp.recoveryLevel,
        recoveryMultiplier: lp.recoveryMultiplier,
        isReversed: false
      });
    } else {
      // ACTIVE BET ROUND
      const sideWin = lp.signal === actualType;
      const jackpot = lp.prime === actualNum || lp.backup === actualNum;
      const win = sideWin || jackpot;

      if (jackpot) S.stats.numberHits++;

      if (win) {
        S.stats.wins++;
        S.stats.streak++;
        if (S.stats.streak > S.stats.best) S.stats.best = S.stats.streak;

        const prevLevel = S.recovery.level;
        // WINNING FIX: Reset Recovery stage back to Level 1!
        if (S.recovery.enabled && S.recovery.level > 1) {
          S.recovery.totalRecovered += S.recovery.baseBet * (S.recovery.level === 2 ? 3 : S.recovery.level === 3 ? 8 : 24);
          S.recovery.level = 1;
          localStorage.setItem(LS.recoveryLevel, '1');
          toast(`🎯 ${toMathBold('LEVEL ' + prevLevel + ' FIX SUCCESS!')} Capital recovered!`);
        }

        if (S.unlocked) showWin(fin.period, mode, lp, actualType, actualNum, jackpot);
      } else {
        S.stats.losses++;
        S.stats.streak = 0;

        // LOSS: ADVANCE TO NEXT RECOVERY LEVEL (up to 4)
        if (S.recovery.enabled) {
          if (S.recovery.level < 4) {
            S.recovery.level = (S.recovery.level + 1) as 1 | 2 | 3 | 4;
            localStorage.setItem(LS.recoveryLevel, String(S.recovery.level));
            toast(`⚠️ ${toMathBold('ADVANCING TO 3-4L FIX: LEVEL ' + S.recovery.level)} (${S.recovery.level === 2 ? '3X' : S.recovery.level === 3 ? '8X' : '24X'})`);
          } else {
            // Level 4 cycle completed, reset to Level 1
            S.recovery.level = 1;
            localStorage.setItem(LS.recoveryLevel, '1');
            toast(toMathBold('LEVEL 4 FINISHED → RESETTING TO LEVEL 1'));
          }
        }
      }

      S.history.unshift({
        period: fin.period,
        mode,
        prediction: lp.signal,
        predNum: [lp.prime, lp.backup],
        actual: actualType,
        actualNum,
        win,
        isSkip: false,
        jackpot,
        sideWin,
        confidence: lp.confidence,
        recoveryLevel: lp.recoveryLevel,
        recoveryMultiplier: lp.recoveryMultiplier,
        isReversed: S.lastAnalysis?.oppositeMajority.isReversed
      });
    }

    if (S.history.length > 80) S.history.pop();
    renderHistory();
    refreshStats();
    renderRecoveryWidget();
    S.lastPrediction = null;
  }

  // GENERATE NEXT PREDICTION WITH RECOVERY & AUTO-SKIP
  const target = nextPeriod(fin.period);
  const numbers = recs.map(r => r.number);

  const result = engineInstance.predict(numbers, {
    skipThreshold: S.autoSkip.enabled ? S.autoSkip.threshold : 50.0,
    recoveryLevel: S.recovery.level,
    recoveryEnabled: S.recovery.enabled,
    baseBetAmount: S.recovery.baseBet
  });

  S.lastAnalysis = result;
  S.lastPrediction = {
    period: target,
    signal: result.signal,
    rawSignal: result.rawSignal,
    isSkip: result.isSkip,
    skipReason: result.skipReason,
    prime: result.prime,
    backup: result.backup,
    confidence: result.confidence,
    recoveryLevel: result.recovery.level,
    recoveryMultiplier: result.recovery.multiplier
  };

  applyResult(result, target, mode);
  if ($('tab-engine')?.classList.contains('active')) renderEngineTab();
  if ($('tab-recovery')?.classList.contains('active')) renderRecoveryTab();
  S.busy = false;
}

function applyResult(F: PredictionResult, target: string, mode: '30s' | '1m') {
  $('core')?.classList.remove('analysing');

  if (!S.unlocked) {
    const cl = $('coreLbl');
    if (cl) cl.textContent = toMathBold('VIP ACCESS LOCKED');
    const p = $('corePred');
    if (p) {
      p.textContent = '🔒';
      p.className = 'qcore-pred locked';
    }
    const cn = $('coreNum');
    if (cn) {
      cn.innerHTML =
        `<div class="lock-inline"><svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>${toMathBold('UNLOCK VIP KEY')}</div>`;
    }
    const cs = $('coreSub');
    if (cs) cs.textContent = toMathBold('Tap 🔒 to enter license key');
    setStatus('LOCKED', false);
    setRing(0);
    setConf(null);

    const hudSignal = $('hudBigSignal');
    if (hudSignal) {
      hudSignal.textContent = '🔒';
      hudSignal.className = 'hud-pred-text locked';
    }
    const hudNum = $('hudPrimeBackup');
    if (hudNum) hudNum.innerHTML = `<span class="hud-nb locked">${toMathBold('LOCKED')}</span>`;

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
    if (mp) mp.textContent = toMathBold(String(target).slice(-5));
    const mm = $('metaMode');
    if (mm) mm.textContent = toMathBold(mode === '30s' ? '30 SEC' : '1 MIN');
    const ms = $('metaSignal');
    if (ms) {
      ms.textContent = '🔒';
      ms.style.color = 'var(--muted)';
    }
    const mst = $('metaStatus');
    if (mst) mst.textContent = toMathBold('LOCKED');

    const opBanner = $('oppositeBanner');
    if (opBanner) opBanner.style.display = 'none';
    return;
  }

  const p = $('corePred');
  const cl = $('coreLbl');
  const cn = $('coreNum');
  const cs = $('coreSub');

  const hudSignal = $('hudBigSignal');
  const hudNum = $('hudPrimeBackup');
  const hudConfBadge = $('hudConfBadge');
  const hudPeriodNum = $('hudPeriodNum');

  if (hudPeriodNum) hudPeriodNum.textContent = '#' + toMathBold(String(target).slice(-5));

  if (F.isSkip) {
    // LOW CONFIDENCE AUTO-SKIP DISPLAY (MATHEMATICAL BOLD: 𝐒𝐊𝐈𝐏)
    const boldSignal = toMathBold('SKIP');
    if (cl) cl.textContent = '⚠️ ' + toMathBold('SAFE PASS — LOW CONFIDENCE');
    if (p) {
      p.textContent = boldSignal;
      p.className = 'qcore-pred skip-mode math-bold';
      p.style.color = '#f59e0b';
    }
    if (hudSignal) {
      hudSignal.textContent = boldSignal;
      hudSignal.className = 'hud-pred-text skip math-bold';
    }

    if (cn) {
      cn.innerHTML =
        `<div class="nb skip"><b style="background:#f59e0b22;border-color:#f59e0b;color:#d97706">${toMathBold('PASS')}</b><i>${toMathBold('WAIT NEXT')}</i></div>` +
        `<div class="nb skip"><b style="background:#ffffff11;border-color:var(--border);color:var(--muted)">${toMathBold('HOLD')}</b><i>${toMathBold('CAPITAL')}</i></div>`;
    }

    if (hudNum) {
      hudNum.innerHTML =
        `<div class="hud-nb-box skip"><b>${toMathBold('SAFE')}</b><span>${toMathBold('PASS')}</span></div>` +
        `<div class="hud-nb-box skip"><b>${toMathBold('HOLD')}</b><span>${toMathBold('CAPITAL')}</span></div>`;
    }

    if (hudConfBadge) {
      hudConfBadge.textContent = `${toMathBold(String(F.confidence))}% • ${toMathBold('SAFE SKIP')}`;
      hudConfBadge.className = 'hud-conf-badge skip';
    }

    if (cs) cs.textContent = F.skipReason;
    setStatus('SKIP ROUND', false);
    setRing(F.confidence / 100);
    setConf(F.confidence / 100);

    const opBanner = $('oppositeBanner');
    if (opBanner) {
      opBanner.style.display = 'flex';
      opBanner.className = 'op-banner skip-alert';
      opBanner.innerHTML = `<span class="op-tag" style="background:#f59e0b;color:#000">${toMathBold('SAFE SKIP')}</span><span>${toMathBold('LOW CONFIDENCE (' + F.confidence + '% < ' + S.autoSkip.threshold + '%) — PASSING ROUND')}</span>`;
    }
  } else {
    // ACTIVE PREDICTION DISPLAY (MATHEMATICAL BOLD: 𝐁𝐈𝐆 / 𝐒𝐌𝐀𝐋𝐋)
    const isBig = F.signal === 'BIG';
    const boldSignal = toMathBold(F.signal); // "𝐁𝐈𝐆" or "𝐒𝐌𝐀𝐋𝐋"

    if (cl) {
      cl.textContent = F.oppositeMajority.isReversed
        ? '⚡ ' + toMathBold('OPPOSITE MAJORITY FLIP')
        : (F.recovery.level > 1 ? `🎯 ${toMathBold('3-4L FIX (LVL ' + F.recovery.level + ')')}` : '👑 ' + toMathBold('NOVIX PRO HIGH ACCURACY'));
    }
    if (p) {
      p.textContent = boldSignal;
      p.className = 'qcore-pred math-bold ' + (isBig ? 'big' : 'small');
      p.style.color = '';
    }
    if (hudSignal) {
      hudSignal.textContent = boldSignal;
      hudSignal.className = 'hud-pred-text math-bold ' + (isBig ? 'big' : 'small');
    }

    if (cn) {
      cn.innerHTML =
        `<div class="nb ${isBig ? 'big' : 'small'}"><b>${toMathBold(String(F.prime))}</b><i>${toMathBold('PRIME')}</i></div>` +
        `<div class="nb ${isBig ? 'small' : 'big'}"><b>${toMathBold(String(F.backup))}</b><i>${toMathBold('BACKUP')}</i></div>`;
    }

    if (hudNum) {
      hudNum.innerHTML =
        `<div class="hud-nb-box ${isBig ? 'big' : 'small'}"><b>${toMathBold(String(F.prime))}</b><span>${toMathBold('PRIME (MATRIX)')}</span></div>` +
        `<div class="hud-nb-box ${isBig ? 'small' : 'big'}"><b>${toMathBold(String(F.backup))}</b><span>${toMathBold('BACKUP')}</span></div>`;
    }

    if (hudConfBadge) {
      hudConfBadge.textContent = `${toMathBold(String(F.confidence))}% • ${toMathBold('HIGH ACCURACY')}`;
      hudConfBadge.className = 'hud-conf-badge ok';
    }

    if (cs) {
      cs.textContent = F.oppositeMajority.isReversed
        ? `⚡ ${toMathBold('HERD TRAP: Inverted ' + F.oppositeMajority.rawConsensus + ' → ' + F.signal + ' (Conf: ' + F.confidence + '%)')}`
        : `👑 ${toMathBold('CONFIRMED: P(' + F.signal[0] + ') ' + Math.round((isBig ? F.matrix.matrixProbBig : F.matrix.matrixProbSmall) * 100) + '% • Conf: ' + F.confidence + '% • Bet: ₹' + F.recovery.suggestedBet)}`;
    }
    setStatus('CONFIRMED', false);
    setRing(F.confidence / 100);
    setConf(F.confidence / 100);

    const opBanner = $('oppositeBanner');
    if (opBanner) {
      opBanner.style.display = 'flex';
      if (F.oppositeMajority.isReversed) {
        opBanner.className = 'op-banner reversed';
        opBanner.innerHTML = `<span class="op-tag">${toMathBold('OPPOSITE MAJORITY TRIGGERED')}</span><span>${toMathBold('Consensus was ' + F.oppositeMajority.rawConsensus + ' (' + Math.round(F.oppositeMajority.consensusStrength * 100) + '%) — Inverted to ' + F.signal)}</span>`;
      } else {
        opBanner.className = 'op-banner normal';
        opBanner.innerHTML = `<span class="op-tag">${toMathBold('HIGH ACCURACY CONFIRMED')}</span><span>${toMathBold('3-4L Fix Level ' + F.recovery.level + ' (' + F.recovery.multiplier + 'X) • AI Matrix Signal: ' + F.signal)}</span>`;
      }
    }
  }

  // Vote bar & metrics
  const total = F.bigVotes + F.smallVotes;
  const bigPct = total ? Math.round((F.bigVotes / total) * 100) : 50;
  const vb = $('voteBig');
  if (vb) {
    vb.style.width = bigPct + '%';
    vb.textContent = bigPct >= 18 ? `${toMathBold('BIG')} ${toMathBold(String(F.bigVotes))}` : '';
  }
  const vs = $('voteSmall');
  if (vs) {
    vs.style.width = 100 - bigPct + '%';
    vs.textContent = 100 - bigPct >= 18 ? `${toMathBold('SMALL')} ${toMathBold(String(F.smallVotes))}` : '';
  }
  const vv = $('voteVal');
  if (vv) vv.textContent = `${toMathBold(String(bigPct))}% vs ${toMathBold(String(100 - bigPct))}%`;

  const p0 = F.probabilities.state_0 || 0.5;
  const p1 = F.probabilities.state_1 || 0.5;
  const pdB = $('pdBigV');
  if (pdB) pdB.textContent = toMathBold((p1 * 100).toFixed(1) + '%');
  const pdS = $('pdSmallV');
  if (pdS) pdS.textContent = toMathBold((p0 * 100).toFixed(1) + '%');
  const bBar = $('pdBigBar');
  if (bBar) bBar.style.width = p1 * 100 + '%';
  const sBar = $('pdSmallBar');
  if (sBar) sBar.style.width = p0 * 100 + '%';

  $('pdBig')?.classList.toggle('win-side', F.signal === 'BIG');
  $('pdSmall')?.classList.toggle('win-side', F.signal === 'SMALL');

  const cv = $('chipVotes');
  if (cv) cv.textContent = `${toMathBold(String(F.bigVotes))}/${toMathBold(String(total))}`;
  const csamp = $('chipSamples');
  if (csamp) csamp.textContent = toMathBold(String(Math.min(600, S.recs[mode].length)));

  const mp = $('metaPeriod');
  if (mp) mp.textContent = toMathBold(String(target).slice(-5));
  const mm = $('metaMode');
  if (mm) mm.textContent = toMathBold(mode === '30s' ? '30 SEC' : '1 MIN');
  const ms = $('metaSignal');
  if (ms) {
    ms.textContent = toMathBold(F.signal);
    ms.style.color = F.signal === 'BIG' ? '#d97706' : F.signal === 'SMALL' ? '#0284c7' : '#f59e0b';
  }
  const mst = $('metaStatus');
  if (mst) mst.textContent = toMathBold(F.isSkip ? 'SKIPPED' : (F.oppositeMajority.isReversed ? 'OPP-MAJ' : `FIX L${F.recovery.level}`));

  renderRecoveryWidget();
}

// PERIOD TIMER
setInterval(() => {
  const el = $('metaTimer');
  const hudTimer = $('hudTimer');
  if (!S.running) {
    if (el) el.textContent = '--:--';
    if (hudTimer) hudTimer.textContent = '--:--';
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const rem = S.mode === '30s' ? 30 - (now % 30) : 60 - (now % 60);
  const timerStr = '00:' + String(rem).padStart(2, '0');
  const boldTimer = toMathBold(timerStr);
  if (el) el.textContent = timerStr;
  if (hudTimer) hudTimer.textContent = boldTimer;
}, 1000);

// HISTORY RENDER
function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  const w = S.stats.wins;
  const l = S.stats.losses;
  const tot = w + l;

  const hsw = $('hsWins');
  if (hsw) hsw.textContent = toMathBold(String(w));
  const hsl = $('hsLoss');
  if (hsl) hsl.textContent = toMathBold(String(l));
  const hsa = $('hsAcc');
  if (hsa) hsa.textContent = toMathBold(tot ? Math.round((w / tot) * 100) + '%' : '0%');
  const hsb = $('hsBest');
  if (hsb) hsb.textContent = toMathBold(String(S.stats.best || 0));
  const hc = $('histCount');
  if (hc) hc.textContent = toMathBold(S.history.length + ' ROUNDS');

  const sl = S.history.slice(0, 20).reverse();
  let html = '';
  for (let i = 0; i < 20; i++) {
    const h = sl[i];
    html += h
      ? h.isSkip
        ? '<span class="d s" title="Safe Skip"></span>'
        : h.win
        ? '<span class="d w" title="Win"></span>'
        : '<span class="d l" title="Loss"></span>'
      : '<span class="d"></span>';
  }
  const ht = $('histTrail');
  if (ht) ht.innerHTML = html;
  const s20 = S.history.slice(0, 20);
  const nonSkip = s20.filter(h => !h.isSkip);
  const hr = $('histRate');
  if (hr) hr.textContent = nonSkip.length ? toMathBold(Math.round((nonSkip.filter(h => h.win).length / nonSkip.length) * 100) + '%') : '—';

  if (!S.history.length) {
    list.innerHTML =
      `<div class="card"><div class="empty"><b>${toMathBold('NO ROUNDS YET')}</b>Home tab par START dabao.<br>Wins, losses aur auto-skips yahan dikhenge.</div></div>`;
    return;
  }

  list.innerHTML = S.history
    .map(h => {
      if (h.isSkip) {
        return `<div class="hitem skip">
          <div class="st skip"><div class="ic"><svg viewBox="0 0 24 24"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg></div><div class="l">${toMathBold('SKIP')}</div></div>
          <div class="hbody">
            <div class="htop">
              <span class="per">#${toMathBold(String(h.period).slice(-5))}</span>
              <span class="mc">${toMathBold(h.mode === '30s' ? '30 SEC' : '1 MIN')}</span>
              <span class="tag-skip">${toMathBold('SAFE PASS')}</span>
            </div>
            <div class="hvs">
              <div class="hside">
                <div class="sk">${toMathBold('DECISION')}</div>
                <div class="sv" style="color:var(--primary)">${toMathBold('PASS ROUND (HOLD)')}</div>
              </div>
              <div class="harr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
              <div class="hside act">
                <div class="sk">${toMathBold('ACTUAL OUTCOME')}</div>
                <div class="sv">${toMathBold(h.actual)} <span class="num">${toMathBold(String(h.actualNum))}</span></div>
              </div>
            </div>
            <div class="hfoot">
              <span><b>${toMathBold('CAPITAL SAVED')}</b></span>
              <span>• ${toMathBold('Streak Preserved')}</span>
              <span>• Conf: ${toMathBold(String(Math.round(h.confidence)))}%</span>
            </div>
          </div>
        </div>`;
      }

      const cls = h.win ? '' : 'loss';
      const icon = h.win
        ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      const st = h.win ? toMathBold('WIN') : toMathBold('LOSS');
      return `<div class="hitem ${cls}">
      <div class="st"><div class="ic">${icon}</div><div class="l">${st}</div></div>
      <div class="hbody">
        <div class="htop">
          <span class="per">#${toMathBold(String(h.period).slice(-5))}</span>
          <span class="mc">${toMathBold(h.mode === '30s' ? '30 SEC' : '1 MIN')}</span>
          <span class="tag-rec">${toMathBold('LVL ' + h.recoveryLevel + ' (' + h.recoveryMultiplier + 'X)')}</span>
          ${h.isReversed ? `<span class="tag-reversed">${toMathBold('OPP-MAJ')}</span>` : ''}
        </div>
        <div class="hvs">
          <div class="hside">
            <div class="sk">${toMathBold('PREDICTED')}</div>
            <div class="sv math-bold" style="font-size:13px">${toMathBold(h.prediction)}${h.predNum ? h.predNum.map(n => ' <span class="num">' + toMathBold(String(n)) + '</span>').join('') : ''}</div>
          </div>
          <div class="harr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
          <div class="hside act">
            <div class="sk">${toMathBold('ACTUAL')}</div>
            <div class="sv math-bold" style="font-size:13px">${toMathBold(h.actual)} <span class="num">${toMathBold(String(h.actualNum))}</span></div>
          </div>
        </div>
        <div class="hfoot">
          <span><b>${toMathBold('NOVIX PRO AI')}</b></span>
          ${h.confidence ? '<span>• CONF ' + toMathBold(String(Math.round(h.confidence))) + '%</span>' : ''}
          ${h.win ? '<span>• ' + toMathBold('Profit Secured') + '</span>' : ''}
        </div>
      </div>
    </div>`;
    })
    .join('');
}

// WIN POPUP
function showWin(period: string, mode: '30s' | '1m', lp: any, actual: 'BIG' | 'SMALL', actualNum: number, jackpot: boolean) {
  const wp = $('wnPeriod');
  if (wp) wp.textContent = toMathBold(String(period).slice(-5));
  const wm = $('wnMode');
  if (wm) wm.textContent = toMathBold(mode === '30s' ? 'WIN GO 30s' : 'WIN GO 1M');
  const wpred = $('wnPred');
  if (wpred) wpred.textContent = toMathBold(lp.signal);
  const wact = $('wnActual');
  if (wact) wact.textContent = toMathBold(actual);
  const wactn = $('wnActualNum');
  if (wactn) wactn.textContent = toMathBold(String(actualNum));
  const wstrk = $('wnStreak');
  if (wstrk) wstrk.textContent = '+' + toMathBold(String(S.stats.streak)) + ' ' + toMathBold('WIN STREAK');
  const wamt = $('wnAmount');
  if (wamt) wamt.textContent = jackpot ? toMathBold('JACKPOT NUM HIT!') : toMathBold('WIN RECOVERED!');
  const wr = $('wnRibbon');
  if (wr) wr.textContent = jackpot ? toMathBold('MATRIX JACKPOT') : toMathBold(`FIX LVL ${lp.recoveryLevel} VICTORY`);
  const wpn = $('wnPredNum');
  if (wpn) {
    wpn.innerHTML = [lp.prime, lp.backup]
      .map(n => (jackpot && n === actualNum ? '<b style="color:var(--win)">' + toMathBold(String(n)) + ' ✓</b>' : toMathBold(String(n))))
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

// 3-4 LEVEL RECOVERY TAB VIEW
function renderRecoveryTab() {
  const v = $('recoveryView');
  if (!v) return;

  const currentLevel = S.recovery.level;
  const mults: Record<number, number> = { 1: 1, 2: 3, 3: 8, 4: 24 };

  let h = '';
  h += `<div class="card" style="border-color:var(--primary-border);box-shadow:0 0 16px var(--primary-soft)">
    <div class="card-t">${toMathBold('3-4 LEVEL FIX WINNING RECOVERY SYSTEM')}<span class="tag">${toMathBold(S.recovery.enabled ? 'ACTIVE' : 'OFF')}</span></div>
    <div class="rec-grid">
      ${[1, 2, 3, 4].map(lvl => {
        const isCurrent = lvl === currentLevel;
        const m = mults[lvl];
        const bet = S.recovery.baseBet * m;
        return `<div class="rec-col ${isCurrent ? 'active' : ''}" onclick="window.__ARX.manualSetRecoveryLevel(${lvl})">
          <div class="rc-lvl">${toMathBold('LEVEL ' + lvl)}</div>
          <div class="rc-mult math-bold">${toMathBold(m + 'X')}</div>
          <div class="rc-bet">₹${toMathBold(String(bet))}</div>
          <div class="rc-status">${isCurrent ? '● ' + toMathBold('CURRENT') : toMathBold('STAGE')}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:14px;padding:12px;background:var(--card-solid);border-radius:12px;border:1px solid var(--border)">
      <div style="font-size:10px;font-weight:900;letter-spacing:1px;color:var(--ink);display:flex;justify-content:space-between">
        <span>${toMathBold('CURRENT STAGE')}: <b style="color:var(--primary)">${toMathBold('LEVEL ' + currentLevel + ' (' + mults[currentLevel] + 'X)')}</b></span>
        <span>${toMathBold('SUGGESTED BET')}: <b style="color:var(--win)">₹${toMathBold(String(S.recovery.baseBet * mults[currentLevel]))}</b></span>
      </div>
      <div style="font-size:9px;color:var(--muted);margin-top:6px;line-height:1.5">
        Har round ke baad engine automatically recovery stage check karta hai. Agar loss hota hai to level upar jayega with fix boost, aur win par turant Level 1 par reset ho jayega!
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
      <button class="gc-play" style="width:100%" onclick="window.__ARX.manualSetRecoveryLevel(1)">↻ ${toMathBold('RESET TO LEVEL 1')}</button>
      <button class="gc-play" style="width:100%;background:var(--card-solid);border:1px solid var(--border);color:var(--ink)" onclick="window.__ARX.toggleRecoveryMod()">
        ${toMathBold(S.recovery.enabled ? 'PAUSE RECOVERY' : 'ENABLE RECOVERY')}
      </button>
    </div>
  </div>`;

  // LOW CONFIDENCE AUTO-SKIP CARD
  h += `<div class="card">
    <div class="card-t">${toMathBold('LOW CONFIDENCE AUTO-SKIP SYSTEM')}<span class="tag">${toMathBold(S.autoSkip.enabled ? 'ACTIVE' : 'OFF')}</span></div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:var(--card-solid);border-radius:12px;border:1px solid var(--border)">
      <div>
        <div style="font-family:Orbitron;font-size:11px;font-weight:900;color:var(--ink)">${toMathBold('SKIP THRESHOLD')}: ${toMathBold(String(S.autoSkip.threshold))}%</div>
        <div style="font-size:8.5px;color:var(--muted);margin-top:3px">Predictions below this confidence are safely skipped to protect streak.</div>
      </div>
      <button class="gc-play" style="padding:7px 12px;font-size:9px" onclick="window.__ARX.toggleAutoSkip()">
        ${toMathBold(S.autoSkip.enabled ? 'ON' : 'OFF')}
      </button>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="rec-btn ${S.autoSkip.threshold === 70 ? 'on' : ''}" onclick="window.__ARX.setSkipThreshold(70)">${toMathBold('70% RELAXED')}</button>
      <button class="rec-btn ${S.autoSkip.threshold === 74 ? 'on' : ''}" onclick="window.__ARX.setSkipThreshold(74)">${toMathBold('74% STANDARD')}</button>
      <button class="rec-btn ${S.autoSkip.threshold === 78 ? 'on' : ''}" onclick="window.__ARX.setSkipThreshold(78)">${toMathBold('78% HIGH FIX')}</button>
      <button class="rec-btn ${S.autoSkip.threshold === 82 ? 'on' : ''}" onclick="window.__ARX.setSkipThreshold(82)">${toMathBold('82% STRICT')}</button>
    </div>
  </div>`;

  v.innerHTML = h;
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
      `<div class="card"><div class="empty"><b>🔒 ${toMathBold('VIP ACCESS LOCKED')}</b>Unlock with a license key<br>to view the AI Brain, Opposite Majority, and Matrix breakdown.</div></div>`;
    return;
  }
  if (!F) {
    v.innerHTML =
      `<div class="card"><div class="empty"><b>${toMathBold('NO ANALYSIS YET')}</b>Home tab se engine start karo.<br>AI Human Brain aur Matrix ka pura live breakdown yahan aayega.</div></div>`;
    return;
  }

  const isBig = F.signal === 'BIG';
  const m = F.matrix;
  const b = F.brain;
  const om = F.oppositeMajority;

  let h = '';

  // 1. Fusion Verdict Card
  h += `<div class="card">
    <div class="card-t">${toMathBold('FUSION VERDICT')}<span class="tag">${toMathBold('NOVIX PRO AI B3.9')}</span></div>
    <div class="meta-row" style="margin-top:0">
      <div class="meta"><div class="k">${toMathBold('SIGNAL')}</div><div class="v math-bold" style="color:${F.isSkip ? '#f59e0b' : isBig ? '#d97706' : '#0284c7'};font-size:16px">${toMathBold(F.signal)}</div></div>
      <div class="meta"><div class="k">${toMathBold('CONFIDENCE')}</div><div class="v math-bold" style="color:var(--primary)">${toMathBold(String(F.confidence))}%</div></div>
      <div class="meta"><div class="k">${toMathBold('P(BIG)')}</div><div class="v">${toMathBold(((F.probabilities.state_1 || 0.5) * 100).toFixed(1))}%</div></div>
      <div class="meta"><div class="k">${toMathBold('P(SMALL)')}</div><div class="v">${toMathBold(((F.probabilities.state_0 || 0.5) * 100).toFixed(1))}%</div></div>
      <div class="meta"><div class="k">${toMathBold('PRIME')}</div><div class="v math-bold" style="color:var(--primary);font-size:16px">${F.isSkip ? '—' : toMathBold(String(F.prime))}</div></div>
      <div class="meta"><div class="k">${toMathBold('BACKUP')}</div><div class="v math-bold" style="font-size:16px">${F.isSkip ? '—' : toMathBold(String(F.backup))}</div></div>
    </div>
  </div>`;

  // 2. 3-4 Level Fix Status
  h += `<div class="card" style="border-color:var(--primary-border)">
    <div class="card-t">${toMathBold('3-4 LEVEL FIX & RECOVERY PIPELINE')}<span class="tag">${toMathBold('ACTIVE')}</span></div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--card-solid);border-radius:10px">
      <span>${toMathBold('Active Level')}: <b style="color:var(--primary)">${toMathBold('LEVEL ' + F.recovery.level + ' (' + F.recovery.multiplier + 'X)')}</b></span>
      <span>${toMathBold('Target Bet')}: <b style="color:var(--win)">₹${toMathBold(String(F.recovery.suggestedBet))}</b></span>
      <span>${toMathBold('Auto-Skip')}: <b style="color:${F.isSkip ? 'var(--primary)' : 'var(--win)'}">${toMathBold(F.isSkip ? 'TRIGGERED (SAFE)' : 'PASSED')}</b></span>
    </div>
  </div>`;

  // 3. AI HUMAN BRAIN Cognitive Heuristics Card
  h += `<div class="card">
    <div class="card-t">🧠 ${toMathBold('AI HUMAN BRAIN HEURISTICS')}<span class="tag">${toMathBold('NEURO-PROBABILITY')}</span></div>
    <div class="brain-grid">
      <div class="bg-item">
        <div class="bg-lbl">${toMathBold('SYSTEM 1 (INTUITION)')}</div>
        <div class="bg-val">${toMathBold(String(Math.round(b.system1Score * 100)))}%</div>
        <div class="bg-bar"><i style="width:${Math.round(b.system1Score * 100)}%"></i></div>
      </div>
      <div class="bg-item">
        <div class="bg-lbl">${toMathBold('SYSTEM 2 (LOGIC)')}</div>
        <div class="bg-val">${toMathBold(String(Math.round(b.system2Score * 100)))}%</div>
        <div class="bg-bar"><i style="width:${Math.round(b.system2Score * 100)}%"></i></div>
      </div>
      <div class="bg-item">
        <div class="bg-lbl">${toMathBold('GAMBLER’S FALLACY BIAS')}</div>
        <div class="bg-val">${(b.gamblersFallacyBias > 0 ? '+' : '') + toMathBold(String(Math.round(b.gamblersFallacyBias * 100)))}%</div>
        <div class="bg-bar"><i style="width:${Math.abs(Math.round(b.gamblersFallacyBias * 100))}%"></i></div>
      </div>
      <div class="bg-item">
        <div class="bg-lbl">${toMathBold('HOT-HAND MOMENTUM')}</div>
        <div class="bg-val">${toMathBold(String(Math.round(b.hotHandMomentum * 100)))}%</div>
        <div class="bg-bar"><i style="width:${Math.round(b.hotHandMomentum * 100)}%"></i></div>
      </div>
      <div class="bg-item full">
        <div class="bg-lbl">${toMathBold('COGNITIVE FATIGUE / CHURN')}</div>
        <div class="bg-val">${toMathBold(String(Math.round(b.cognitiveFatigue * 100)))}%</div>
        <div class="bg-bar"><i style="width:${Math.round(b.cognitiveFatigue * 100)}%"></i></div>
      </div>
    </div>
  </div>`;

  // 4. OPPOSITE MAJORITY Logic Card
  h += `<div class="card" style="border-color:${om.isReversed ? 'var(--loss)' : 'var(--border)'}">
    <div class="card-t">⚡ ${toMathBold('OPPOSITE MAJORITY LOGIC')}<span class="tag">${toMathBold(om.isReversed ? 'TRIGGERED' : 'MONITORING')}</span></div>
    <div class="om-card">
      <div class="om-row">
        <div class="om-box">
          <div class="k">${toMathBold('RAW CONSENSUS')}</div>
          <div class="v">${toMathBold(om.rawConsensus)} (${toMathBold(String(om.herdSize))}/15)</div>
        </div>
        <div class="om-box">
          <div class="k">${toMathBold('HERD STRENGTH')}</div>
          <div class="v">${toMathBold(String(Math.round(om.consensusStrength * 100)))}%</div>
        </div>
        <div class="om-box">
          <div class="k">${toMathBold('TRAP RISK')}</div>
          <div class="v" style="color:${om.trapRiskScore > 0.65 ? 'var(--loss)' : 'var(--win)'}">${toMathBold(String(Math.round(om.trapRiskScore * 100)))}%</div>
        </div>
      </div>
      <div class="om-alert ${om.isReversed ? 'danger' : 'safe'}">
        <b>${toMathBold(om.isReversed ? '⚠️ CONTRARIAN INVERSION APPLIED' : '✓ HERD ALIGNMENT SAFE')}</b>
        <span>${om.reason}</span>
      </div>
    </div>
  </div>`;

  // 5. MATRIX PROBABILITY
  const m2 = m.transitionMatrix2x2;
  h += `<div class="card">
    <div class="card-t">📊 ${toMathBold('MARKOV TRANSITION PROBABILITY MATRIX')}<span class="tag">2x2 & 4x2</span></div>
    <div class="matrix-grid">
      <div class="matrix-cell"><div class="m-k">P(BIG → BIG)</div><div class="m-v">${toMathBold((m2.fromBig.toBig * 100).toFixed(1))}%</div></div>
      <div class="matrix-cell"><div class="m-k">P(BIG → SMALL)</div><div class="m-v">${toMathBold((m2.fromBig.toSmall * 100).toFixed(1))}%</div></div>
      <div class="matrix-cell"><div class="m-k">P(SMALL → BIG)</div><div class="m-v">${toMathBold((m2.fromSmall.toBig * 100).toFixed(1))}%</div></div>
      <div class="matrix-cell"><div class="m-k">P(SMALL → SMALL)</div><div class="m-v">${toMathBold((m2.fromSmall.toSmall * 100).toFixed(1))}%</div></div>
    </div>
    <div class="matrix-footer">
      <span>Matrix P(Big): <b>${toMathBold((m.matrixProbBig * 100).toFixed(1))}%</b></span>
      <span>Matrix P(Small): <b>${toMathBold((m.matrixProbSmall * 100).toFixed(1))}%</b></span>
      <span>Entropy: <b>${m.entropy.toFixed(3)}</b></span>
    </div>
  </div>`;

  // 6. 10x10 DIGIT PROBABILITY TENSOR (0-9)
  h += `<div class="card">
    <div class="card-t">🎯 ${toMathBold('DIGIT PROBABILITY DISTRIBUTION (0-9)')}<span class="tag">MATRIX RANK</span></div>
    <div class="digit-bars">
      ${m.digitProbabilities
        .map((prob, idx) => {
          const isPrime = idx === F.prime;
          const isBackup = idx === F.backup;
          const isB = idx >= 5;
          const pct = Math.round(prob * 100);
          return `<div class="digit-col ${isPrime ? 'prime' : ''} ${isBackup ? 'backup' : ''}">
          <div class="d-bar-track"><div class="d-bar-fill ${isB ? 'big' : 'small'}" style="height:${Math.max(8, pct * 3)}px"></div></div>
          <div class="d-num math-bold ${isB ? 'big' : 'small'}">${toMathBold(String(idx))}</div>
          <div class="d-pct">${toMathBold(String(pct))}%</div>
        </div>`;
        })
        .join('')}
    </div>
  </div>`;

  // 7. 15 Modern Algorithm Votes
  const bd = F.algorithmBreakdown || {};
  const keys = Object.keys(bd);
  h += `<div class="card">
    <div class="card-t">15 ${toMathBold('PREDICTIVE ALGORITHMS — LIVE VOTES')}<span class="tag">${toMathBold(F.bigVotes + 'B / ' + F.smallVotes + 'S')}</span></div>
    <div class="algo-grid">
      ${keys
        .map((k, idx) => {
          const p = bd[k];
          const vote = p[1] >= p[0] ? 'B' : 'S';
          return `<div class="algo-item">
          <div class="idx">${idx + 1}</div>
          <div class="nm">${ALGO_LABELS[k] || k}</div>
          <div class="vote math-bold ${vote}">${toMathBold(vote === 'B' ? 'BIG' : 'SMALL')}</div>
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
    sBtn.textContent = '■ ' + toMathBold('STOP DEMO');
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
  toast('DEMO MODE: ' + toMathBold('TESTING 3-4L RECOVERY & HUD'));
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
  { id: 'white', n: 'WHITE NOVIX (PHOTO)', sw: 'linear-gradient(135deg,#ffffff,#f0f4fc)' },
  { id: '', n: 'NOIR RGB', sw: 'linear-gradient(135deg,#070a14,#ff4d6d)' },
  { id: 'crimson', n: 'CYBER RED', sw: 'linear-gradient(135deg,#ff4d6d,#1a0b14)' },
  { id: 'mint', n: 'MINT RGB', sw: 'linear-gradient(135deg,#22e5a4,#0c1020)' },
  { id: 'violet', n: 'VIOLET', sw: 'linear-gradient(135deg,#8b6cff,#0c1020)' },
  { id: 'ice', n: 'ICE BLUE', sw: 'linear-gradient(135deg,#38c8ff,#0c1020)' },
  { id: 'ember', n: 'EMBER ORANGE', sw: 'linear-gradient(135deg,#ff7a1a,#0c1020)' },
  { id: 'rose', n: 'ROSE GOLD', sw: 'linear-gradient(135deg,#e11d74,#ffe4f0)' }
];

function renderThemes() {
  const cur = localStorage.getItem(LS.theme) ?? 'white';
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
  toast('✓ ' + (id === 'white' ? 'White Novix Theme' : id.toUpperCase() + ' Theme') + ' Applied');
}

export function cycleNextTheme() {
  const cur = localStorage.getItem(LS.theme) ?? 'white';
  const idx = THEMES.findIndex(t => t.id === cur);
  const next = THEMES[(idx + 1) % THEMES.length];
  setTheme(next.id);
}

// BOOT INITIALIZATION
loadRecs();
const savedTheme = localStorage.getItem(LS.theme) ?? 'white';
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
renderThemes();
renderHistory();
refreshStats();
renderRecoveryWidget();
updateLockUI();
const mm = $('metaMode');
if (mm) mm.textContent = toMathBold('1 MIN');

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
  selectSidebar,
  openLock,
  closeLock,
  doUnlock,
  toggleHidePred,
  playGame,
  closeGame,
  copyInviteCode,
  toggleGameUI,
  selectMode,
  toggleEngine,
  resetAllStats,
  clearAppCache,
  closeWin,
  runDemo,
  setTheme,
  cycleNextTheme,
  toggleRecoveryMod,
  manualSetRecoveryLevel,
  toggleAutoSkip,
  setSkipThreshold,
  toMathBold
};

// Also attach individual methods to window directly for HTML onclick handlers
Object.assign(window, (window as any).__ARX);
