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
};
let selectedCitizen = null;
let onebankInfo = null;
let pigstyRecord = null;

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

  // 1) ONE BANK 계좌 조회 (본인 로그인 토큰이 있을 때, 4초 타임아웃)
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

  // 2) PIGSTY 게시글/검열 기록 조회 (4초 타임아웃)
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
          <span class="id-seal">🏛️ ATELIER J · ONEID 디지털 주민등록청장</span>
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
          ATELIER J · ONEID 디지털 주민등록청장
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
        <strong>AGORA 의회 소속 · 입법 활동 · PIGSTY 준법/검열 기록 · ONE BANK 금융 등급</strong>을 통합 조회할 수 있습니다.
      </div>
    `;
    return;
  }

  const eco = card.ecosystem || {};
  const censoredCnt = pigstyRecord ? pigstyRecord.censoredCount : 0;
  const totalPosts = pigstyRecord ? pigstyRecord.totalPosts : 0;
  const criminalStatus =
    censoredCnt === 0
      ? `<span class="badge clean">🟢 범죄·검열 격리 기록 없음 (모범 시민)</span>`
      : `<span class="badge warn">⚠️ PIGSTY 검열봇 격리 전과 ${censoredCnt}건 (다크웹 이송 대상)</span>`;

  const bankText = onebankInfo
    ? `${Number(onebankInfo.balance || 0).toLocaleString()} 원 (${escapeHtml(onebankInfo.accountNo || '')})`
    : stateData.me && stateData.me.userId === card.userId
    ? 'ONE BANK 계좌 연동 가능'
    : '금융실명제 비공개 (본인만 열람)';

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
        <span class="label">📜 의회 입법 · 표결 기여도</span>
        <span class="val">발의 ${eco.billsProposed || 0}건 · 표결 ${eco.votesCast || 0}회 · 발언 ${eco.speechesMade || 0}회</span>
      </div>
      <div class="stat-box">
        <span class="label">🐷 PIGSTY 커뮤니티 활동 · 전과</span>
        <span class="val">작성글 ${totalPosts}건 (검열 격리 ${censoredCnt}건)</span>
      </div>
      <div class="stat-box">
        <span class="label">🏦 ONE BANK 등록 자산</span>
        <span class="val">${bankText}</span>
      </div>
    </div>

    <div class="stat-box" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <span class="label">🎖️ 국가 통합 시민 신용·활동 점수</span>
        <span class="val" style="color:#fcd34d;">${Number(eco.activityScore || 100).toLocaleString()} PTS</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a href="https://assembly-lovat.vercel.app" target="_blank" rel="noopener" class="btn small">🏛️ 의회 활동하러 가기</a>
        <a href="https://pigsty.onrender.com" target="_blank" rel="noopener" class="btn small">🐷 피그스티</a>
      </div>
    </div>
  `;
}

function renderDirectory(list) {
  citizenCountEl.textContent = String(list.length);
  if (!list.length) {
    directoryGrid.innerHTML = '<div class="empty-box">아직 발급된 주민등록증이 없습니다. 첫 번째 시민이 되어보세요!</div>';
    return;
  }

  const isAdmin = Boolean(stateData.me?.isAdmin);
  directoryGrid.innerHTML = list
    .map((c) => {
      const eco = c.ecosystem || {};
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

          ${
            c.specialBadge
              ? `<div><span class="badge gold">${escapeHtml(c.specialBadge)}</span></div>`
              : ''
          }

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

async function loadOverview() {
  try {
    stateData = await api('/api/overview');
    if (stateData.me) {
      oneidBtn.textContent = `${stateData.me.nickname} · 내 민증 보기`;
      selectedCitizen = stateData.me;
    } else {
      oneidBtn.textContent = 'ONEID 로그인 · 민증 발급';
      selectedCitizen = stateData.directory?.[0] || null;
    }
    const activeTarget = stateData.me || selectedCitizen;
    renderIdCard(activeTarget);
    renderDossier(activeTarget);
    renderDirectory(stateData.directory || []);
    fetchExternalDossier(activeTarget).then(() => {
      renderDossier(activeTarget);
    });
  } catch (err) {
    console.error(err);
  }
}

oneidBtn.addEventListener('click', async () => {
  if (stateData.me) {
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

(async function init() {
  try {
    const c = await fetch('/api/config');
    if (c.ok) cfg = await c.json();
  } catch {}
  await handleOneIdCallback();
  await loadOverview();
})();
