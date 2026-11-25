const TOKEN_KEY = 'citizen_pass_oneid_token';
const VERIFIER_KEY = 'citizen_pass_oneid_verifier';
const STATE_KEY = 'citizen_pass_oneid_state';

let cfg = {
  oneidUrl: 'https://oneid-ruddy.vercel.app',
  agoraUrl: 'https://assembly-lovat.vercel.app',
  helpdeskUrl: 'https://oneid-helpdesk.onrender.com',
  onebankUrl: 'https://one-bank.onrender.com',
  pigstyBackendUrl: 'https://pigsty-backend.onrender.com',
  clientId: 'citizen-pass',
};

let token = localStorage.getItem(TOKEN_KEY) || '';
let stateData = {
  me: null,
  totalCitizens: 0,
  directory: [],
  totalCouples: 0,
  couples: [],
};
let selectedCitizen = null;
let selectedCouple = null;
let onebankInfo = null;
let pigstyRecord = null;

// DOM - Tabs
const deskTabs = document.getElementById('deskTabs');
const deskCitizenView = document.getElementById('deskCitizenView');
const deskCoupleView = document.getElementById('deskCoupleView');

// DOM - Desk 1 (Citizen ID)
const oneidBtn = document.getElementById('oneidBtn');
const idCardStage = document.getElementById('idCardStage');
const dossierContent = document.getElementById('dossierContent');
const copyCitizenNoBtn = document.getElementById('copyCitizenNoBtn');
const openCustomModalBtn = document.getElementById('openCustomModalBtn');
const citizenCountEl = document.getElementById('citizenCount');
const directoryGrid = document.getElementById('directoryGrid');

const customModal = document.getElementById('customModal');
const closeCustomModalBtn = document.getElementById('closeCustomModalBtn');
const customForm = document.getElementById('customForm');

const adminBadgeModal = document.getElementById('adminBadgeModal');
const closeAdminBadgeModalBtn = document.getElementById('closeAdminBadgeModalBtn');
const adminBadgeForm = document.getElementById('adminBadgeForm');

const verifyForm = document.getElementById('verifyForm');
const verifyInput = document.getElementById('verifyInput');
const verifyResultBox = document.getElementById('verifyResultBox');

// DOM - Desk 2 (Couple Certificate)
const coupleCertStage = document.getElementById('coupleCertStage');
const downloadCouplePngBtn = document.getElementById('downloadCouplePngBtn');
const copyCoupleCertNoBtn = document.getElementById('copyCoupleCertNoBtn');
const coupleIssueForm = document.getElementById('coupleIssueForm');
const citizenNickList = document.getElementById('citizenNickList');
const coupleCountEl = document.getElementById('coupleCount');
const coupleDirectoryGrid = document.getElementById('coupleDirectoryGrid');
const verifyCoupleForm = document.getElementById('verifyCoupleForm');
const verifyCoupleInput = document.getElementById('verifyCoupleInput');
const verifyCoupleResultBox = document.getElementById('verifyCoupleResultBox');

const signCanvasA = document.getElementById('signCanvasA');
const signCanvasB = document.getElementById('signCanvasB');
let signPadA = null;
let signPadB = null;

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function switchDesk(deskName) {
  const isCouple = deskName === 'couple';
  deskCitizenView.hidden = isCouple;
  deskCoupleView.hidden = !isCouple;
  deskTabs.querySelectorAll('.desk-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.desk === (isCouple ? 'couple' : 'citizen'));
  });
}

deskTabs?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-desk]');
  if (!btn) return;
  switchDesk(btn.dataset.desk);
});

document.querySelectorAll('[data-quick-desk]').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchDesk(btn.dataset.quickDesk);
  });
});

document.querySelectorAll('[data-quick-scroll]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.quickScroll;
    if (targetId === 'verifyCoupleForm') switchDesk('couple');
    if (targetId === 'verifyForm') switchDesk('citizen');
    const el = document.getElementById(targetId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.querySelector('input')?.focus();
  });
});

async function startOneIdLogin() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = base64Url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  );
  const redirectUri = `${location.origin}${location.pathname}`;
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const query = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    state,
  });
  location.assign(`${cfg.oneidUrl}/login.html?${query}`);
}

async function handleOneIdCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return;

  const state = params.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  history.replaceState(null, '', `${location.pathname}`);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  if (!state || state !== expectedState || !verifier) {
    alert('ONEID 인증 상태를 확인할 수 없습니다. 다시 로그인해 주세요.');
    return;
  }

  try {
    const res = await fetch(`${cfg.oneidUrl}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: cfg.clientId,
        redirect_uri: `${location.origin}${location.pathname}`,
        code,
        code_verifier: verifier,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      throw new Error(data.detail || '토큰 발급 실패');
    }
    token = data.access_token;
    localStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    alert(`ONEID 로그인 실패: ${err.message}`);
  }
}

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function fetchExternalDossier(citizen) {
  onebankInfo = null;
  pigstyRecord = null;
  if (!citizen) return;

  if (token && stateData.me && citizen.userId === stateData.me.userId) {
    try {
      const bankRes = await fetch(`${cfg.onebankUrl}/api/account/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(4000),
      });
      if (bankRes.ok) {
        const bData = await bankRes.json();
        onebankInfo = bData.account || null;
      }
    } catch {}
  }

  try {
    const pRes = await fetch(`${cfg.pigstyBackendUrl}/api/posts?include_censored=1`, {
      signal: AbortSignal.timeout(4000),
    });
    if (pRes.ok) {
      const posts = await pRes.json();
      if (Array.isArray(posts)) {
        const mine = posts.filter(
          (p) =>
            String(p.author || '').toLowerCase() === String(citizen.username || '').toLowerCase() ||
            String(p.author || '').toLowerCase() === String(citizen.nickname || '').toLowerCase()
        );
        const censoredCnt = mine.filter((p) => p.status === 'censored').length;
        pigstyRecord = {
          totalPosts: mine.length,
          censoredCount: censoredCnt,
        };
      }
    }
  } catch {}
}

function attach3DTilt(cardEl) {
  if (!cardEl) return;
  cardEl.addEventListener('mousemove', (e) => {
    const rect = cardEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const px = (x / rect.width) * 100;
    const py = (y / rect.height) * 100;
    const rotY = ((x - rect.width / 2) / rect.width) * 14;
    const rotX = -((y - rect.height / 2) / rect.height) * 14;
    cardEl.style.setProperty('--mx', `${px.toFixed(1)}%`);
    cardEl.style.setProperty('--my', `${py.toFixed(1)}%`);
    cardEl.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
  });
  cardEl.addEventListener('mouseleave', () => {
    cardEl.style.transform = 'rotateX(0deg) rotateY(0deg)';
  });
}

function renderIdCard(card) {
  if (!card) {
    copyCitizenNoBtn.hidden = true;
    openCustomModalBtn.hidden = true;
    idCardStage.innerHTML = `
      <div class="citizen-id-card theme-gold" id="activeHologramCard">
        <div class="id-card-top">
          <div class="id-gov-title">
            <span style="font-size:22px;">🏛️</span>
            <div>
              <strong>주민등록증 (미발급 견본)</strong>
              <span>REPUBLIC OF ATELIER J · ONEID CITIZEN PASS</span>
            </div>
          </div>
          <div class="id-chip"></div>
        </div>
        <div class="id-card-body">
          <div class="id-photo-box">
            <div class="id-photo-emoji">🪪</div>
            <span class="id-photo-tag">GUEST</span>
          </div>
          <div class="id-fields">
            <div class="id-name-row">
              <h3>ONEID 로그인 필요</h3>
            </div>
            <div class="id-rrn">260000-0000000</div>
            <p class="id-motto">우측 상단 [ONEID 로그인 · 민증 발급] 버튼을 누르면 즉시 나만의 공식 전자 주민등록증이 발급됩니다.</p>
          </div>
        </div>
        <div class="id-card-foot">
          <span class="id-seal">🏛️ ATELIER J · ONEID 통합 행정복지센터장</span>
          <span class="stamp-red">인</span>
        </div>
      </div>
    `;
    attach3DTilt(document.getElementById('activeHologramCard'));
    return;
  }

  const isMe = Boolean(stateData.me && stateData.me.userId === card.userId);
  copyCitizenNoBtn.hidden = false;
  openCustomModalBtn.hidden = !isMe;

  const eco = card.ecosystem || {};
  const coupleInfo = eco.couple || null;

  idCardStage.innerHTML = `
    <div class="citizen-id-card theme-${escapeHtml(card.themeColor || 'gold')}" id="activeHologramCard">
      <div class="id-card-top">
        <div class="id-gov-title">
          <span style="font-size:22px;">🏛️</span>
          <div>
            <strong>주민등록증 · CITIZEN PASS</strong>
            <span>REPUBLIC OF ATELIER J · ONEID NATIONAL REGISTRY</span>
          </div>
        </div>
        <div class="id-chip"></div>
      </div>

      <div class="id-card-body">
        <div class="id-photo-box">
          <div class="id-photo-emoji">${escapeHtml(card.avatarEmoji || '🪪')}</div>
          <span class="id-photo-tag">${card.isAdmin ? 'SOVEREIGN' : 'CITIZEN'}</span>
        </div>

        <div class="id-fields">
          <div class="id-name-row">
            <h3>${escapeHtml(card.nickname)}</h3>
            <span class="id-username">(@${escapeHtml(card.username)})</span>
            ${card.specialBadge ? `<span class="badge gold">${escapeHtml(card.specialBadge)}</span>` : ''}
            ${coupleInfo ? `<span class="badge rose">💍 ❤️ ${escapeHtml(coupleInfo.partnerName)} (D+${coupleInfo.daysTogether})</span>` : ''}
          </div>

          <div class="id-rrn">${escapeHtml(card.citizenNo)}</div>

          <div class="id-meta-grid">
            <div class="id-meta-item">
              <span>공식 직함</span>
              <strong>${escapeHtml(card.customTitle)}</strong>
            </div>
            <div class="id-meta-item">
              <span>소속 정당</span>
              <strong style="color:${escapeHtml(eco.partyColor || '#93c5fd')}">${escapeHtml(eco.partyName || '무소속')} (${escapeHtml(eco.partyRole || '시민')})</strong>
            </div>
            <div class="id-meta-item" style="grid-column: span 2;">
              <span>주소지</span>
              <strong>${escapeHtml(card.domicile)}</strong>
            </div>
          </div>

          <div class="id-motto">“${escapeHtml(card.motto)}”</div>
        </div>
      </div>

      <div class="id-card-foot">
        <span>발급일: ${formatDate(card.issuedAt)}</span>
        <span class="id-seal">
          ATELIER J · ONEID 통합 행정복지센터장
          <span class="stamp-red">인</span>
        </span>
      </div>
    </div>
  `;
  attach3DTilt(document.getElementById('activeHologramCard'));
}

function renderDossier(card) {
  if (!card) {
    dossierContent.innerHTML = `
      <div class="empty-box">
        ONEID로 로그인하거나 아래 시민 명부에서 시민 카드를 클릭하면<br>
        <strong>AGORA 의회 소속 · 커플/교제 등기 현황 · PIGSTY 준법/검열 기록 · ONE BANK 금융 등급</strong>을 통합 조회할 수 있습니다.
      </div>
    `;
    return;
  }

  const eco = card.ecosystem || {};
  const coupleInfo = eco.couple || null;
  const censoredCnt = pigstyRecord ? pigstyRecord.censoredCount : 0;
  const totalPosts = pigstyRecord ? pigstyRecord.totalPosts : 0;
  const criminalStatus =
    censoredCnt === 0
      ? `<span class="badge clean">🟢 범죄·검열 격리 기록 없음 (모범 시민)</span>`
      : `<span class="badge warn">⚠️ PIGSTY 검열봇 격리 전과 ${censoredCnt}건 (다크웹 이송 대상)</span>`;

  const coupleBoxVal = coupleInfo
    ? `❤️ ${escapeHtml(coupleInfo.partnerName)} · D+${coupleInfo.daysTogether}일 (${escapeHtml(coupleInfo.certNo)})`
    : '미등기 (제2창구에서 커플인증서 발급 가능)';

  dossierContent.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <div>
        <span class="badge gold">${escapeHtml(eco.citizenTier || 'SILVER · 활동 시민')}</span>
        <strong style="margin-left:6px;font-size:15px;">${escapeHtml(card.nickname)} 님의 국가 신원 기록</strong>
      </div>
      ${criminalStatus}
    </div>

    <div class="dossier-grid">
      <div class="stat-box">
        <span class="label">🏛️ AGORA 소속 정당 · 직위</span>
        <span class="val" style="color:${escapeHtml(eco.partyColor || '#f8fafc')}">${escapeHtml(eco.partyName || '무소속')} · ${escapeHtml(eco.partyRole || '시민')}</span>
      </div>
      <div class="stat-box">
        <span class="label">💍 공식 커플 · 교제 등기</span>
        <span class="val" style="color:${coupleInfo ? '#fda4af' : '#94a3b8'};font-size:14px;">${coupleBoxVal}</span>
      </div>
      <div class="stat-box">
        <span class="label">📜 의회 입법 · 표결 기여도</span>
        <span class="val">발의 ${eco.billsProposed || 0}건 · 표결 ${eco.votesCast || 0}회 · 발언 ${eco.speechesMade || 0}회</span>
      </div>
      <div class="stat-box">
        <span class="label">🐷 PIGSTY 커뮤니티 활동 · 전과</span>
        <span class="val">작성글 ${totalPosts}건 (검열 격리 ${censoredCnt}건)</span>
      </div>
    </div>

    <div class="stat-box" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <span class="label">🎖️ 국가 통합 시민 신용·활동 점수</span>
        <span class="val" style="color:#fcd34d;">${Number(eco.activityScore || 100).toLocaleString()} PTS</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn small rose-gold" id="goToCoupleDeskBtn">💍 커플인증서 창구 이동</button>
        <a href="https://assembly-lovat.vercel.app" target="_blank" rel="noopener" class="btn small">🏛️ 의회</a>
      </div>
    </div>
  `;

  document.getElementById('goToCoupleDeskBtn')?.addEventListener('click', () => {
    switchDesk('couple');
  });
}

function renderDirectory(list) {
  citizenCountEl.textContent = String(list.length);
  if (citizenNickList) {
    citizenNickList.innerHTML = list
      .map((c) => `<option value="${escapeHtml(c.nickname)}">${escapeHtml(c.username)}</option>`)
      .join('');
  }

  if (!list.length) {
    directoryGrid.innerHTML = '<div class="empty-box">아직 발급된 주민등록증이 없습니다. 첫 번째 시민이 되어보세요!</div>';
    return;
  }

  const isAdmin = Boolean(stateData.me?.isAdmin);
  directoryGrid.innerHTML = list
    .map((c) => {
      const eco = c.ecosystem || {};
      const coupleInfo = eco.couple || null;
      return `
        <div class="mini-id-card" data-view-citizen="${escapeHtml(c.userId)}" style="cursor:pointer;">
          <div class="mini-top">
            <div class="mini-identity">
              <div class="mini-avatar">${escapeHtml(c.avatarEmoji || '🪪')}</div>
              <div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <strong>${escapeHtml(c.nickname)}</strong>
                  <span style="font-size:11.5px;color:#94a3b8;">@${escapeHtml(c.username)}</span>
                </div>
                <div class="mini-rrn">${escapeHtml(c.citizenNo)}</div>
              </div>
            </div>
            <span class="badge" style="border-color:${escapeHtml(eco.partyColor || '#3b82f6')};color:${escapeHtml(eco.partyColor || '#93c5fd')}">
              ${escapeHtml(eco.partyName || '무소속')}
            </span>
          </div>

          <div style="font-size:12px;color:#cbd5e1;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <span>직함: <strong>${escapeHtml(c.customTitle)}</strong></span>
            <span>신용도: <strong style="color:#fcd34d;">${eco.activityScore || 100} PTS</strong></span>
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${c.specialBadge ? `<span class="badge gold">${escapeHtml(c.specialBadge)}</span>` : ''}
            ${coupleInfo ? `<span class="badge rose">💍 ❤️ ${escapeHtml(coupleInfo.partnerName)} (D+${coupleInfo.daysTogether})</span>` : ''}
          </div>

          ${
            isAdmin
              ? `
                <div style="display:flex;gap:6px;margin-top:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
                  <button type="button" class="btn small gold" data-grant-badge="${escapeHtml(c.userId)}" data-citizen-name="${escapeHtml(c.nickname)}" data-current-badge="${escapeHtml(c.specialBadge || '')}">👑 훈장·직책 수여</button>
                  <button type="button" class="btn small danger" data-revoke-citizen="${escapeHtml(c.userId)}" data-citizen-name="${escapeHtml(c.nickname)}">🗑️ 민증 말소</button>
                </div>
              `
              : ''
          }
        </div>
      `;
    })
    .join('');

  directoryGrid.querySelectorAll('[data-view-citizen]').forEach((cardEl) => {
    cardEl.addEventListener('click', async (e) => {
      if (e.target.closest('button')) return;
      const uid = cardEl.dataset.viewCitizen;
      const target = (stateData.directory || []).find((x) => x.userId === uid);
      if (!target) return;
      selectedCitizen = target;
      renderIdCard(selectedCitizen);
      renderDossier(selectedCitizen);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      fetchExternalDossier(selectedCitizen).then(() => {
        if (selectedCitizen && selectedCitizen.userId === target.userId) {
          renderDossier(selectedCitizen);
        }
      });
    });
  });

  directoryGrid.querySelectorAll('[data-grant-badge]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('adminTargetUserId').value = btn.dataset.grantBadge;
      document.getElementById('adminTargetName').value = btn.dataset.citizenName;
      document.getElementById('adminSpecialBadgeInput').value = btn.dataset.currentBadge || '';
      adminBadgeModal.hidden = false;
    });
  });

  directoryGrid.querySelectorAll('[data-revoke-citizen]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.citizenName;
      if (!confirm(`[${name}] 시민의 주민등록증을 직권 말소하시겠습니까?`)) return;
      try {
        await api(`/api/admin/citizens/${encodeURIComponent(btn.dataset.revokeCitizen)}`, {
          method: 'DELETE',
        });
        await loadOverview();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// =========================================================
// DESK 2: COUPLE CERTIFICATE RENDERING & SIGNATURE PADS
// =========================================================

function createSignaturePad(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let hasDrawn = false;

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    hasDrawn = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end() {
    drawing = false;
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', end);

  return {
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
    },
    toDataUrl() {
      return hasDrawn ? canvas.toDataURL('image/png') : null;
    },
  };
}

function getSampleCouple() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: 0,
    certNo: 'CPL-2026-SAMPLE',
    partnerAName: stateData.me ? stateData.me.nickname : '신청인 (견본)',
    partnerARole: '사랑하는 사람',
    partnerBName: '파트너 (견본)',
    partnerBRole: '소중한 사람',
    coupleTitle: '아텔리에 공식 커플 인증서 (견본)',
    startDate: today,
    daysTogether: 1,
    vow: '서로를 아끼고 존중하며 언제나 함께할 것을 아텔리에 통합 주민센터 앞에 공식 서약합니다.',
    theme: 'rose',
    signA: null,
    signB: null,
    issuedAt: new Date().toISOString(),
  };
}

function renderCoupleCertificate(couple) {
  const c = couple || getSampleCouple();
  selectedCouple = c;

  coupleCertStage.innerHTML = `
    <div class="couple-cert-card theme-${escapeHtml(c.theme || 'rose')}" id="activeCoupleCertCard">
      <div class="cert-top">
        <div class="id-gov-title">
          <span style="font-size:22px;">💍</span>
          <div>
            <strong>COUPLE CERTIFICATE · 커플등기필증</strong>
            <span>ATELIER J · ONEID CIVIL REGISTRY OFFICE</span>
          </div>
        </div>
        <span class="cert-no-pill">${escapeHtml(c.certNo)}</span>
      </div>

      <div class="cert-title-block">
        <span class="sub-title">OFFICIAL VOW &amp; PARTNERSHIP</span>
        <h3>${escapeHtml(c.coupleTitle)}</h3>
      </div>

      <div class="cert-partners-box">
        <div class="partner-col">
          <span class="role">${escapeHtml(c.partnerARole)}</span>
          <strong class="name">${escapeHtml(c.partnerAName)}</strong>
        </div>
        <div class="heart-center">
          <span class="ring-icon">💖</span>
          <span class="dday-chip">함께한 지 D+${Number(c.daysTogether || 1).toLocaleString()}일</span>
          <span style="font-size:10px;color:#cbd5e1;">Since ${escapeHtml(c.startDate)}</span>
        </div>
        <div class="partner-col">
          <span class="role">${escapeHtml(c.partnerBRole)}</span>
          <strong class="name">${escapeHtml(c.partnerBName)}</strong>
        </div>
      </div>

      <div class="cert-vow-box">
        “${escapeHtml(c.vow)}”
      </div>

      <div class="cert-signatures-row">
        <div class="cert-sign-slot">
          <span>신청인: <strong>${escapeHtml(c.partnerAName)}</strong></span>
          ${
            c.signA
              ? `<img src="${c.signA}" alt="신청인 서명" />`
              : `<span class="cert-sign-fallback">${escapeHtml(c.partnerAName)} (인)</span>`
          }
        </div>
        <div class="cert-sign-slot">
          <span>파트너: <strong>${escapeHtml(c.partnerBName)}</strong></span>
          ${
            c.signB
              ? `<img src="${c.signB}" alt="파트너 서명" />`
              : `<span class="cert-sign-fallback">${escapeHtml(c.partnerBName)} (인)</span>`
          }
        </div>
      </div>

      <div class="id-card-foot">
        <span>등기일: ${formatDate(c.issuedAt)}</span>
        <span class="id-seal">
          ATELIER J · 통합 행정복지센터장
          <span class="stamp-red">인</span>
        </span>
      </div>
    </div>
  `;
  attach3DTilt(document.getElementById('activeCoupleCertCard'));
}

function renderCoupleDirectory(couples) {
  coupleCountEl.textContent = String(couples.length);
  if (!couples.length) {
    coupleDirectoryGrid.innerHTML =
      '<div class="empty-box">아직 등기된 커플인증서가 없습니다. 우측 신청서에서 첫 번째 공식 커플인증서를 발급해 보세요!</div>';
    return;
  }

  const myId = stateData.me?.userId || null;
  const myNick = (stateData.me?.nickname || '').toLowerCase();
  const isAdmin = Boolean(stateData.me?.isAdmin);

  coupleDirectoryGrid.innerHTML = couples
    .map((c) => {
      const canRevoke =
        isAdmin ||
        (myId && (c.createdByUserId === myId || c.partnerAUserId === myId || c.partnerBUserId === myId)) ||
        (myNick && (c.partnerAName.toLowerCase() === myNick || c.partnerBName.toLowerCase() === myNick));

      return `
        <div class="mini-id-card" data-view-couple="${c.id}" style="cursor:pointer;border-color:rgba(244,63,94,0.35);">
          <div class="mini-top">
            <div class="mini-identity">
              <div class="mini-avatar">💍</div>
              <div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <strong>${escapeHtml(c.partnerAName)} ❤️ ${escapeHtml(c.partnerBName)}</strong>
                </div>
                <div class="mini-rrn" style="color:#fda4af;">${escapeHtml(c.certNo)}</div>
              </div>
            </div>
            <span class="badge rose">D+${Number(c.daysTogether || 1).toLocaleString()}일</span>
          </div>

          <div style="font-size:12.5px;color:#f1f5f9;font-weight:700;">
            ${escapeHtml(c.coupleTitle)}
          </div>
          <div style="font-size:11.5px;color:#94a3b8;">
            시작일: ${escapeHtml(c.startDate)} · 등기일: ${formatDate(c.issuedAt)}
          </div>

          ${
            canRevoke
              ? `
                <div style="display:flex;justify-content:flex-end;margin-top:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
                  <button type="button" class="btn small danger" data-revoke-couple="${c.id}" data-couple-names="${escapeHtml(c.partnerAName)} ♥ ${escapeHtml(c.partnerBName)}">💔 결별 · 등기 말소</button>
                </div>
              `
              : ''
          }
        </div>
      `;
    })
    .join('');

  coupleDirectoryGrid.querySelectorAll('[data-view-couple]').forEach((cardEl) => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const cid = Number(cardEl.dataset.viewCouple);
      const found = (stateData.couples || []).find((x) => x.id === cid);
      if (!found) return;
      renderCoupleCertificate(found);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  coupleDirectoryGrid.querySelectorAll('[data-revoke-couple]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const names = btn.dataset.coupleNames;
      if (!confirm(`[${names}] 커플 등기를 말소(결별 신고)하시겠습니까?`)) return;
      try {
        await api(`/api/couples/${encodeURIComponent(btn.dataset.revokeCouple)}`, {
          method: 'DELETE',
        });
        await loadOverview();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// High-resolution Canvas PNG Exporter for Couple Certificate
async function exportCoupleCertificatePng(c) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  // Background gradient by theme
  const grad = ctx.createLinearGradient(0, 0, 1080, 720);
  if (c.theme === 'gold') {
    grad.addColorStop(0, '#2d2109');
    grad.addColorStop(0.5, '#101526');
    grad.addColorStop(1, '#362508');
  } else if (c.theme === 'holo') {
    grad.addColorStop(0, '#0b263b');
    grad.addColorStop(0.5, '#161433');
    grad.addColorStop(1, '#2b1338');
  } else if (c.theme === 'aurora') {
    grad.addColorStop(0, '#072924');
    grad.addColorStop(0.5, '#111830');
    grad.addColorStop(1, '#1f1137');
  } else {
    grad.addColorStop(0, '#321020');
    grad.addColorStop(0.5, '#121629');
    grad.addColorStop(1, '#391226');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 720);

  // Outer & Inner Borders
  ctx.strokeStyle = c.theme === 'gold' ? '#fbbf24' : '#fb7185';
  ctx.lineWidth = 4;
  ctx.strokeRect(24, 24, 1032, 672);

  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(42, 42, 996, 636);
  ctx.setLineDash([]);

  // Header
  ctx.fillStyle = '#fda4af';
  ctx.font = 'bold 22px Pretendard, sans-serif';
  ctx.fillText('💍 COUPLE CERTIFICATE · 공식 커플등기필증', 72, 96);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px Pretendard, sans-serif';
  ctx.fillText('ATELIER J · ONEID CIVIL REGISTRY OFFICE', 72, 122);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fecdd3';
  ctx.font = 'bold 20px Consolas, monospace';
  ctx.fillText(c.certNo || 'CPL-2026', 1008, 104);

  // Title
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fda4af';
  ctx.font = 'bold 15px Pretendard, sans-serif';
  ctx.fillText('OFFICIAL VOW & PARTNERSHIP CERTIFICATE', 540, 185);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px Pretendard, sans-serif';
  ctx.fillText(c.coupleTitle || '공식 등록 커플', 540, 235);

  // Partners Box
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(72, 270, 936, 155);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.strokeRect(72, 270, 936, 155);

  ctx.fillStyle = '#fda4af';
  ctx.font = '18px Pretendard, sans-serif';
  ctx.fillText(c.partnerARole || '사랑하는 사람', 250, 322);
  ctx.fillText(c.partnerBRole || '소중한 사람', 830, 322);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Pretendard, sans-serif';
  ctx.fillText(c.partnerAName || '', 250, 375);
  ctx.fillText(c.partnerBName || '', 830, 375);

  ctx.fillStyle = '#fef08a';
  ctx.font = 'bold 26px Pretendard, sans-serif';
  ctx.fillText(`💖 함께한 지 D+${Number(c.daysTogether || 1).toLocaleString()}일`, 540, 345);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '16px Pretendard, sans-serif';
  ctx.fillText(`Since ${c.startDate || ''}`, 540, 382);

  // Vow
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'italic 21px Pretendard, sans-serif';
  const vowText = `“${c.vow || ''}”`;
  ctx.fillText(vowText.slice(0, 52), 540, 480);
  if (vowText.length > 52) {
    ctx.fillText(vowText.slice(52, 104), 540, 512);
  }

  // Signatures
  ctx.textAlign = 'left';
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '18px Pretendard, sans-serif';
  ctx.fillText(`신청인: ${c.partnerAName}   (서명/인)`, 110, 585);
  ctx.fillText(`파트너: ${c.partnerBName}   (서명/인)`, 600, 585);

  // Footer & Official Stamp
  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px Pretendard, sans-serif';
  ctx.fillText(`등기일: ${formatDate(c.issuedAt)}`, 72, 650);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fcd34d';
  ctx.font = 'bold 20px Pretendard, sans-serif';
  ctx.fillText('ATELIER J · 통합 행정복지센터장 [인]', 1008, 650);

  const link = document.createElement('a');
  link.download = `${c.certNo || 'couple-certificate'}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function loadOverview() {
  try {
    stateData = await api('/api/overview');
    if (stateData.me) {
      oneidBtn.textContent = `${stateData.me.nickname} · 내 민증 보기`;
      selectedCitizen = stateData.me;
      const partnerAInput = document.getElementById('partnerANameInput');
      if (partnerAInput && !partnerAInput.value) {
        partnerAInput.value = stateData.me.nickname;
      }
    } else {
      oneidBtn.textContent = 'ONEID 로그인 · 민증 발급';
      selectedCitizen = null;
    }
    const activeTarget = stateData.me || selectedCitizen;
    renderIdCard(activeTarget);
    renderDossier(activeTarget);
    renderDirectory(stateData.directory || []);

    const firstCouple =
      (stateData.me &&
        (stateData.couples || []).find(
          (cp) =>
            cp.partnerAUserId === stateData.me.userId ||
            cp.partnerBUserId === stateData.me.userId ||
            cp.partnerAName.toLowerCase() === stateData.me.nickname.toLowerCase() ||
            cp.partnerBName.toLowerCase() === stateData.me.nickname.toLowerCase()
        )) ||
      stateData.couples?.[0] ||
      null;
    renderCoupleCertificate(firstCouple);
    renderCoupleDirectory(stateData.couples || []);

    if (activeTarget) {
      fetchExternalDossier(activeTarget).then(() => {
        renderDossier(activeTarget);
      });
    }
  } catch (err) {
    console.error(err);
  }
}

oneidBtn.addEventListener('click', async () => {
  if (stateData.me) {
    switchDesk('citizen');
    selectedCitizen = stateData.me;
    renderIdCard(selectedCitizen);
    renderDossier(selectedCitizen);
    fetchExternalDossier(selectedCitizen).then(() => renderDossier(selectedCitizen));
    return;
  }
  startOneIdLogin();
});

copyCitizenNoBtn.addEventListener('click', async () => {
  const c = selectedCitizen || stateData.me;
  if (!c) return;
  try {
    await navigator.clipboard.writeText(c.citizenNo);
    copyCitizenNoBtn.textContent = '✅ 복사됨!';
    setTimeout(() => {
      copyCitizenNoBtn.textContent = '📋 민증번호 복사';
    }, 1500);
  } catch {}
});

openCustomModalBtn.addEventListener('click', () => {
  const me = stateData.me;
  if (!me) return startOneIdLogin();
  document.getElementById('themeColorSelect').value = me.themeColor || 'gold';
  document.getElementById('avatarEmojiSelect').value = me.avatarEmoji || '🪪';
  document.getElementById('customTitleInput').value = me.customTitle || '';
  document.getElementById('domicileInput').value = me.domicile || '';
  document.getElementById('mottoInput').value = me.motto || '';
  customModal.hidden = false;
});

closeCustomModalBtn.addEventListener('click', () => {
  customModal.hidden = true;
});

customForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/me/card', {
      method: 'PUT',
      body: {
        themeColor: document.getElementById('themeColorSelect').value,
        avatarEmoji: document.getElementById('avatarEmojiSelect').value,
        customTitle: document.getElementById('customTitleInput').value.trim(),
        domicile: document.getElementById('domicileInput').value.trim(),
        motto: document.getElementById('mottoInput').value.trim(),
      },
    });
    customModal.hidden = true;
    await loadOverview();
  } catch (err) {
    alert(err.message);
  }
});

closeAdminBadgeModalBtn.addEventListener('click', () => {
  adminBadgeModal.hidden = true;
});

adminBadgeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = document.getElementById('adminTargetUserId').value;
  const specialBadge = document.getElementById('adminSpecialBadgeInput').value.trim();
  try {
    await api(`/api/admin/citizens/${encodeURIComponent(uid)}/badge`, {
      method: 'POST',
      body: { specialBadge },
    });
    adminBadgeModal.hidden = true;
    await loadOverview();
  } catch (err) {
    alert(err.message);
  }
});

verifyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = verifyInput.value.trim();
  if (!q) return;
  verifyResultBox.hidden = false;
  verifyResultBox.innerHTML = '주민등록청 원부 대조 중...';
  try {
    const res = await api(`/api/verify?q=${encodeURIComponent(q)}`);
    const c = res.card;
    const eco = c.ecosystem || {};
    verifyResultBox.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <span class="badge clean">✅ 정식 등록 주민등록증 진위 확인 완료</span>
          <strong style="margin-left:8px;font-size:16px;">${escapeHtml(c.nickname)} (@${escapeHtml(c.username)})</strong>
          <span style="margin-left:8px;font-family:monospace;color:#fcd34d;">${escapeHtml(c.citizenNo)}</span>
        </div>
        <span style="font-size:12px;color:#94a3b8;">발급기관: ${escapeHtml(res.issuer)}</span>
      </div>
      <div style="margin-top:8px;font-size:13px;color:#cbd5e1;">
        직함: <strong>${escapeHtml(c.customTitle)}</strong> · 소속 정당: <strong>${escapeHtml(eco.partyName || '무소속')}</strong> · 등급: <strong>${escapeHtml(eco.citizenTier || '일반 시민')}</strong> · 주소지: ${escapeHtml(c.domicile)}
      </div>
    `;
    selectedCitizen = c;
    renderIdCard(c);
    renderDossier(c);
    fetchExternalDossier(c).then(() => renderDossier(c));
  } catch (err) {
    verifyResultBox.innerHTML = `<span style="color:#fca5a5;">❌ 조회 실패: ${escapeHtml(err.message)}</span>`;
  }
});

// Desk 2 Event Listeners
coupleIssueForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/api/couples', {
      method: 'POST',
      body: {
        partnerAName: document.getElementById('partnerANameInput').value.trim(),
        partnerARole: document.getElementById('partnerARoleInput').value.trim(),
        partnerBName: document.getElementById('partnerBNameInput').value.trim(),
        partnerBRole: document.getElementById('partnerBRoleInput').value.trim(),
        coupleTitle: document.getElementById('coupleTitleInput').value.trim(),
        startDate: document.getElementById('coupleStartDateInput').value,
        theme: document.getElementById('coupleThemeSelect').value,
        vow: document.getElementById('coupleVowInput').value.trim(),
        signA: signPadA ? signPadA.toDataUrl() : null,
        signB: signPadB ? signPadB.toDataUrl() : null,
      },
    });
    signPadA?.clear();
    signPadB?.clear();
    await loadOverview();
    if (res.couple) {
      renderCoupleCertificate(res.couple);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    alert(err.message);
  }
});

downloadCouplePngBtn?.addEventListener('click', () => {
  exportCoupleCertificatePng(selectedCouple || getSampleCouple());
});

copyCoupleCertNoBtn?.addEventListener('click', async () => {
  const c = selectedCouple || getSampleCouple();
  try {
    await navigator.clipboard.writeText(c.certNo);
    copyCoupleCertNoBtn.textContent = '✅ 등기번호 복사됨!';
    setTimeout(() => {
      copyCoupleCertNoBtn.textContent = '📋 등기번호 복사';
    }, 1500);
  } catch {}
});

verifyCoupleForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = verifyCoupleInput.value.trim();
  if (!q) return;
  verifyCoupleResultBox.hidden = false;
  verifyCoupleResultBox.innerHTML = '커플 등기부 원부 대조 중...';
  try {
    const res = await api(`/api/couples/verify?q=${encodeURIComponent(q)}`);
    const c = res.couple;
    verifyCoupleResultBox.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <span class="badge rose">💍 공식 등록 커플인증서 진위 확인 완료</span>
          <strong style="margin-left:8px;font-size:16px;">${escapeHtml(c.partnerAName)} ❤️ ${escapeHtml(c.partnerBName)}</strong>
          <span style="margin-left:8px;font-family:monospace;color:#fda4af;">${escapeHtml(c.certNo)}</span>
        </div>
        <span style="font-size:12px;color:#94a3b8;">함께한 지 D+${c.daysTogether}일 (시작일: ${escapeHtml(c.startDate)})</span>
      </div>
      <div style="margin-top:8px;font-size:13px;color:#cbd5e1;">
        칭호: <strong>${escapeHtml(c.coupleTitle)}</strong> · 서약: “${escapeHtml(c.vow)}”
      </div>
    `;
    renderCoupleCertificate(c);
  } catch (err) {
    verifyCoupleResultBox.innerHTML = `<span style="color:#fca5a5;">❌ 조회 실패: ${escapeHtml(err.message)}</span>`;
  }
});

(async function init() {
  const dateInput = document.getElementById('coupleStartDateInput');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
  signPadA = createSignaturePad(signCanvasA);
  signPadB = createSignaturePad(signCanvasB);
  document.getElementById('clearSignABtn')?.addEventListener('click', () => signPadA?.clear());
  document.getElementById('clearSignBBtn')?.addEventListener('click', () => signPadB?.clear());

  if (new URLSearchParams(location.search).get('desk') === 'couple') {
    switchDesk('couple');
  }

  try {
    const c = await fetch('/api/config');
    if (c.ok) cfg = await c.json();
  } catch {}
  await handleOneIdCallback();
  await loadOverview();
})();
