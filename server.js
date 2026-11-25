/* =========================================================
   CITIZEN PASS — ATELIER J · ONEID 통합 행정복지센터 (디지털 주민센터)
   - 제1창구: 전자 주민등록증(홀로그램 민증) 발급 · 커스텀 · 생태계 통합 신원 조회
   - 제2창구: 공식 커플인증서(교제·혼인 등기) 발급 · 전자서명 · D-Day 계산 · 등기부 조회 · PNG 다운로드
   - 민증 자동 연동: 커플 등기된 시민은 주민등록증과 신원 기록부에 파트너 & D+N일 배지 자동 표시
   ========================================================= */
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3015);
const ONEID_URL = (process.env.ONEID_URL || 'https://oneid-ruddy.vercel.app').replace(/\/$/, '');
const AGORA_URL = (process.env.AGORA_URL || 'https://assembly-lovat.vercel.app').replace(/\/$/, '');
const HELPDESK_URL = (process.env.HELPDESK_URL || 'https://oneid-helpdesk.onrender.com').replace(/\/$/, '');
const ONEBANK_URL = (process.env.ONEBANK_URL || 'https://one-bank.onrender.com').replace(/\/$/, '');
const PIGSTY_BACKEND_URL = (process.env.PIGSTY_BACKEND_URL || 'https://pigsty-backend.onrender.com').replace(/\/$/, '');
const CLIENT_ID = process.env.ONEID_CLIENT_ID || 'citizen-pass';

let rawDbUrl = process.env.DATABASE_URL || '';
if (rawDbUrl.startsWith('postgresql+psycopg2://')) {
  rawDbUrl = rawDbUrl.replace('postgresql+psycopg2://', 'postgresql://');
} else if (rawDbUrl.startsWith('postgres://')) {
  rawDbUrl = rawDbUrl.replace('postgres://', 'postgresql://');
}

const pool = rawDbUrl
  ? new Pool({
      connectionString: rawDbUrl,
      ssl: { rejectUnauthorized: false },
    })
  : null;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function generateCitizenNo(userId) {
  const hash = crypto.createHash('sha256').update(String(userId)).digest('hex');
  const d1 = (parseInt(hash.slice(0, 4), 16) % 12) + 1;
  const d2 = (parseInt(hash.slice(4, 8), 16) % 28) + 1;
  const front = `26${String(d1).padStart(2, '0')}${String(d2).padStart(2, '0')}`;
  const backNum = (parseInt(hash.slice(8, 16), 16) % 899999) + 100000;
  const genderDigit = (parseInt(hash.slice(16, 18), 16) % 2) + 1;
  return `${front}-${genderDigit}${backNum}`;
}

function generateCoupleCertNo() {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CPL-2026-${rand}`;
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS citizen_cards (
      user_id TEXT PRIMARY KEY,
      citizen_no TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      nickname TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      custom_title TEXT NOT NULL DEFAULT '일반 시민',
      motto TEXT NOT NULL DEFAULT 'ATELIER J · ONEID 공식 등록 시민',
      domicile TEXT NOT NULL DEFAULT '아텔리에 제1특별시 중앙구',
      theme_color TEXT NOT NULL DEFAULT 'gold',
      avatar_emoji TEXT NOT NULL DEFAULT '🪪',
      honor_points INT NOT NULL DEFAULT 100,
      special_badge TEXT,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS couple_certificates (
      id SERIAL PRIMARY KEY,
      cert_no TEXT UNIQUE NOT NULL,
      partner_a_user_id TEXT,
      partner_a_name TEXT NOT NULL,
      partner_a_role TEXT NOT NULL DEFAULT '사랑하는 사람',
      partner_b_user_id TEXT,
      partner_b_name TEXT NOT NULL,
      partner_b_role TEXT NOT NULL DEFAULT '소중한 사람',
      couple_title TEXT NOT NULL DEFAULT '공식 등록 커플',
      start_date DATE NOT NULL DEFAULT CURRENT_DATE,
      vow TEXT NOT NULL DEFAULT '서로를 아끼고 존중하며 함께할 것을 아텔리에 주민센터 앞에 서약합니다.',
      theme TEXT NOT NULL DEFAULT 'rose',
      sign_a TEXT,
      sign_b TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_user_id TEXT,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

let dbInitialized = false;
let dbInitPromise = null;
async function ensureDb() {
  if (dbInitialized || !pool) return;
  if (!dbInitPromise) {
    dbInitPromise = initDb()
      .then(() => {
        dbInitialized = true;
      })
      .catch((err) => {
        dbInitPromise = null;
        console.error('DB init error:', err.message);
      });
  }
  await dbInitPromise;
}

app.use('/api', async (_req, _res, next) => {
  await ensureDb();
  next();
});

async function verifyOneIdUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  try {
    const res = await fetch(`${ONEID_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const u = await res.json();
    return {
      id: String(u.id),
      username: u.username,
      nickname: u.nickname || u.username,
      isAdmin: Boolean(u.is_admin),
      token,
    };
  } catch {
    return null;
  }
}

function calcDaysTogether(startDateStr) {
  if (!startDateStr) return 1;
  const start = new Date(startDateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diff);
}

function formatCoupleRow(row) {
  if (!row) return null;
  const startStr =
    row.start_date instanceof Date
      ? row.start_date.toISOString().slice(0, 10)
      : String(row.start_date || '').slice(0, 10);
  return {
    id: row.id,
    certNo: row.cert_no,
    partnerAUserId: row.partner_a_user_id,
    partnerAName: row.partner_a_name,
    partnerARole: row.partner_a_role,
    partnerBUserId: row.partner_b_user_id,
    partnerBName: row.partner_b_name,
    partnerBRole: row.partner_b_role,
    coupleTitle: row.couple_title,
    startDate: startStr,
    daysTogether: calcDaysTogether(startStr),
    vow: row.vow,
    theme: row.theme || 'rose',
    signA: row.sign_a || null,
    signB: row.sign_b || null,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    issuedAt: row.issued_at,
  };
}

async function findActiveCoupleForCitizen(userId, nickname) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM couple_certificates
       WHERE status = 'active'
         AND (
           partner_a_user_id = $1
           OR partner_b_user_id = $1
           OR LOWER(partner_a_name) = LOWER($2)
           OR LOWER(partner_b_name) = LOWER($2)
         )
       ORDER BY issued_at DESC
       LIMIT 1`,
      [String(userId || ''), String(nickname || '')]
    );
    return rows[0] ? formatCoupleRow(rows[0]) : null;
  } catch {
    return null;
  }
}

async function getEcosystemProfile(userId, username, nickname, isAdmin) {
  let partyName = '무소속';
  let partyColor = '#64748b';
  let partyRole = '일반 시민';
  let billsProposed = 0;
  let votesCast = 0;
  let speechesMade = 0;

  if (pool) {
    try {
      const { rows: memRows } = await pool.query(
        `SELECT p.name, p.color, p.leader_id
         FROM asm_members m
         LEFT JOIN asm_parties p ON p.id = m.party_id
         WHERE m.user_id = $1`,
        [userId]
      );
      if (memRows[0]?.name) {
        partyName = memRows[0].name;
        partyColor = memRows[0].color || '#3b82f6';
        partyRole = memRows[0].leader_id === userId ? '당대표 · 원내의원' : '소속 의원';
      }
      const { rows: bRows } = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM asm_bills WHERE proposer_id = $1',
        [userId]
      );
      billsProposed = bRows[0]?.cnt || 0;

      const { rows: vRows } = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM asm_votes WHERE user_id = $1',
        [userId]
      );
      votesCast = vRows[0]?.cnt || 0;

      const { rows: sRows } = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM asm_speeches WHERE user_id = $1',
        [userId]
      );
      speechesMade = sRows[0]?.cnt || 0;
    } catch {}
  }

  const couple = await findActiveCoupleForCitizen(userId, nickname);

  const activityScore =
    100 +
    (isAdmin ? 900 : 0) +
    (partyName !== '무소속' ? 80 : 0) +
    (couple ? 50 : 0) +
    billsProposed * 120 +
    votesCast * 30 +
    speechesMade * 25;

  let citizenTier = 'BRONZE · 일반 시민';
  if (isAdmin) citizenTier = 'SOVEREIGN · 국가원수 / 총괄관리자';
  else if (activityScore >= 500) citizenTier = 'DIAMOND · 명예 입법의원';
  else if (activityScore >= 280) citizenTier = 'GOLD · 정식 의회의원';
  else if (activityScore >= 150) citizenTier = 'SILVER · 활동 시민';

  return {
    partyName,
    partyColor,
    partyRole,
    billsProposed,
    votesCast,
    speechesMade,
    activityScore,
    citizenTier,
    couple: couple
      ? {
          certNo: couple.certNo,
          partnerName:
            couple.partnerAUserId === userId ||
            couple.partnerAName.toLowerCase() === String(nickname || '').toLowerCase()
              ? couple.partnerBName
              : couple.partnerAName,
          coupleTitle: couple.coupleTitle,
          daysTogether: couple.daysTogether,
          startDate: couple.startDate,
        }
      : null,
  };
}

async function ensureCitizenCard(user) {
  if (!pool) return null;
  const citizenNo = generateCitizenNo(user.id);
  const defaultTitle = user.isAdmin ? '총괄관리자 · 의장' : '정식 등록 시민';
  const defaultBadge = user.isAdmin ? '👑 국가원수 · 총괄관리자' : null;
  const { rows } = await pool.query(
    `INSERT INTO citizen_cards (user_id, citizen_no, username, nickname, is_admin, custom_title, special_badge)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE
       SET username = EXCLUDED.username,
           nickname = EXCLUDED.nickname,
           is_admin = EXCLUDED.is_admin,
           special_badge = COALESCE(citizen_cards.special_badge, EXCLUDED.special_badge),
           updated_at = NOW()
     RETURNING *`,
    [user.id, citizenNo, user.username, user.nickname, user.isAdmin, defaultTitle, defaultBadge]
  );
  return rows[0];
}

async function formatCardWithStats(card) {
  const eco = await getEcosystemProfile(card.user_id, card.username, card.nickname, card.is_admin);
  return {
    userId: card.user_id,
    citizenNo: card.citizen_no,
    username: card.username,
    nickname: card.nickname,
    isAdmin: card.is_admin,
    customTitle: card.custom_title,
    motto: card.motto,
    domicile: card.domicile,
    themeColor: card.theme_color,
    avatarEmoji: card.avatar_emoji,
    specialBadge: card.special_badge,
    issuedAt: card.issued_at,
    updatedAt: card.updated_at,
    ecosystem: eco,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'citizen-pass-center',
    dbConnected: Boolean(pool),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    oneidUrl: ONEID_URL,
    agoraUrl: AGORA_URL,
    helpdeskUrl: HELPDESK_URL,
    onebankUrl: ONEBANK_URL,
    pigstyBackendUrl: PIGSTY_BACKEND_URL,
    clientId: CLIENT_ID,
  });
});

// 전체 시민 명부 + 내 주민등록증 + 공식 커플 등기부 조회
app.get('/api/overview', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  const user = await verifyOneIdUser(req);

  try {
    let myCard = null;
    if (user) {
      const rawMy = await ensureCitizenCard(user);
      myCard = await formatCardWithStats(rawMy);
    }

    const { rows: allCards } = await pool.query(
      'SELECT * FROM citizen_cards ORDER BY is_admin DESC, issued_at ASC LIMIT 60'
    );
    const directory = await Promise.all(allCards.map((c) => formatCardWithStats(c)));

    const { rows: coupleRows } = await pool.query(
      `SELECT * FROM couple_certificates WHERE status = 'active' ORDER BY issued_at DESC LIMIT 60`
    );
    const couples = coupleRows.map(formatCoupleRow);

    res.json({
      me: myCard,
      totalCitizens: allCards.length,
      directory,
      totalCouples: couples.length,
      couples,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 주민등록번호 또는 닉네임으로 신분증 진위 확인
app.get('/api/verify', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '조회할 주민등록번호 또는 닉네임을 입력해 주세요.' });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM citizen_cards
       WHERE citizen_no ILIKE $1 OR nickname ILIKE $1 OR username ILIKE $1
       ORDER BY is_admin DESC, issued_at ASC
       LIMIT 1`,
      [`%${q}%`]
    );
    if (!rows[0]) {
      return res.status(404).json({ valid: false, error: '일치하는 주민등록증을 찾을 수 없습니다.' });
    }
    const card = await formatCardWithStats(rows[0]);
    res.json({
      valid: true,
      verifiedAt: new Date().toISOString(),
      issuer: 'ATELIER J · ONEID 통합 행정복지센터장',
      card,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 내 신분증 커스터마이징
app.put('/api/me/card', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user) return res.status(401).json({ error: 'ONEID 로그인이 필요합니다.' });

  await ensureCitizenCard(user);

  const customTitle = String(req.body?.customTitle || '').trim().slice(0, 28) || '일반 시민';
  const motto = String(req.body?.motto || '').trim().slice(0, 80) || 'ATELIER J · ONEID 공식 등록 시민';
  const domicile = String(req.body?.domicile || '').trim().slice(0, 40) || '아텔리에 제1특별시 중앙구';
  const allowedThemes = ['gold', 'cyber', 'emerald', 'crimson', 'obsidian'];
  const themeColor = allowedThemes.includes(req.body?.themeColor) ? req.body.themeColor : 'gold';
  const avatarEmoji = String(req.body?.avatarEmoji || '🪪').trim().slice(0, 4) || '🪪';

  try {
    const { rows } = await pool.query(
      `UPDATE citizen_cards
       SET custom_title = $1,
           motto = $2,
           domicile = $3,
           theme_color = $4,
           avatar_emoji = $5,
           updated_at = NOW()
       WHERE user_id = $6
       RETURNING *`,
      [customTitle, motto, domicile, themeColor, avatarEmoji, user.id]
    );
    const updated = await formatCardWithStats(rows[0]);
    res.json({ ok: true, card: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =========================================================
// 제2창구: 공식 커플인증서 (교제·혼인 등기소) API
// =========================================================

// 커플인증서 발급 (로그인 시민 또는 자유 발급 모두 지원)
app.post('/api/couples', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  const user = await verifyOneIdUser(req);

  const partnerAName = String(req.body?.partnerAName || '').trim().slice(0, 24);
  const partnerBName = String(req.body?.partnerBName || '').trim().slice(0, 24);
  if (!partnerAName || !partnerBName) {
    return res.status(400).json({ error: '두 사람의 이름(또는 닉네임)을 모두 입력해 주세요.' });
  }

  const partnerARole = String(req.body?.partnerARole || '사랑하는 사람').trim().slice(0, 24) || '사랑하는 사람';
  const partnerBRole = String(req.body?.partnerBRole || '소중한 사람').trim().slice(0, 24) || '소중한 사람';
  const coupleTitle = String(req.body?.coupleTitle || '공식 등록 커플').trim().slice(0, 32) || '공식 등록 커플';
  const rawDate = String(req.body?.startDate || '').trim();
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
  const vow =
    String(req.body?.vow || '').trim().slice(0, 160) ||
    '서로를 아끼고 존중하며 함께할 것을 아텔리에 통합 주민센터 앞에 서약합니다.';
  const allowedThemes = ['rose', 'gold', 'holo', 'aurora'];
  const theme = allowedThemes.includes(req.body?.theme) ? req.body.theme : 'rose';
  const signA = typeof req.body?.signA === 'string' && req.body.signA.startsWith('data:image/') ? req.body.signA : null;
  const signB = typeof req.body?.signB === 'string' && req.body.signB.startsWith('data:image/') ? req.body.signB : null;

  try {
    // 시민 명부에 등록된 닉네임이면 user_id 자동 매칭
    const { rows: matchA } = await pool.query(
      'SELECT user_id FROM citizen_cards WHERE LOWER(nickname) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1',
      [partnerAName]
    );
    const { rows: matchB } = await pool.query(
      'SELECT user_id FROM citizen_cards WHERE LOWER(nickname) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1',
      [partnerBName]
    );

    const partnerAUserId = matchA[0]?.user_id || (user && user.nickname === partnerAName ? user.id : null);
    const partnerBUserId = matchB[0]?.user_id || null;
    const certNo = generateCoupleCertNo();

    const { rows } = await pool.query(
      `INSERT INTO couple_certificates
         (cert_no, partner_a_user_id, partner_a_name, partner_a_role,
          partner_b_user_id, partner_b_name, partner_b_role,
          couple_title, start_date, vow, theme, sign_a, sign_b, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        certNo,
        partnerAUserId,
        partnerAName,
        partnerARole,
        partnerBUserId,
        partnerBName,
        partnerBRole,
        coupleTitle,
        startDate,
        vow,
        theme,
        signA,
        signB,
        user?.id || null,
      ]
    );

    res.status(201).json({
      ok: true,
      couple: formatCoupleRow(rows[0]),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 커플 등록번호 또는 이름으로 진위 확인 조회
app.get('/api/couples/verify', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '조회할 커플 등록번호(CPL-...) 또는 이름을 입력해 주세요.' });

  try {
    const { rows } = await pool.query(
      `SELECT * FROM couple_certificates
       WHERE status = 'active'
         AND (cert_no ILIKE $1 OR partner_a_name ILIKE $1 OR partner_b_name ILIKE $1 OR couple_title ILIKE $1)
       ORDER BY issued_at DESC
       LIMIT 1`,
      [`%${q}%`]
    );
    if (!rows[0]) {
      return res.status(404).json({ valid: false, error: '일치하는 커플인증서를 찾을 수 없습니다.' });
    }
    res.json({
      valid: true,
      issuer: 'ATELIER J · ONEID 통합 행정복지센터장',
      couple: formatCoupleRow(rows[0]),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 커플 해지(결별 신고) 또는 총괄관리자 직권 말소
app.delete('/api/couples/:id', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user) return res.status(401).json({ error: '결별(해지) 신고를 하려면 ONEID 로그인이 필요합니다.' });

  const id = Number(req.params.id);
  try {
    const { rows } = await pool.query('SELECT * FROM couple_certificates WHERE id = $1', [id]);
    const cert = rows[0];
    if (!cert) return res.status(404).json({ error: '커플인증서를 찾을 수 없습니다.' });

    const isOwner =
      user.isAdmin ||
      cert.created_by_user_id === user.id ||
      cert.partner_a_user_id === user.id ||
      cert.partner_b_user_id === user.id ||
      cert.partner_a_name.toLowerCase() === user.nickname.toLowerCase() ||
      cert.partner_b_name.toLowerCase() === user.nickname.toLowerCase();

    if (!isOwner) {
      return res.status(403).json({ error: '본인이 속한 커플인증서이거나 총괄관리자만 해지할 수 있습니다.' });
    }

    await pool.query('DELETE FROM couple_certificates WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 총괄관리자 전용: 훈장 수여 & 민증 말소
app.post('/api/admin/citizens/:userId/badge', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: '총괄관리자만 특별 훈장·직책을 수여할 수 있습니다.' });
  }
  const targetUserId = String(req.params.userId);
  const specialBadge = String(req.body?.specialBadge || '').trim().slice(0, 36) || null;

  try {
    await pool.query(
      'UPDATE citizen_cards SET special_badge = $1, updated_at = NOW() WHERE user_id = $2',
      [specialBadge, targetUserId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/citizens/:userId', async (req, res) => {
  const user = await verifyOneIdUser(req);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: '총괄관리자만 주민등록증을 직권 말소할 수 있습니다.' });
  }
  const targetUserId = String(req.params.userId);
  try {
    await pool.query('DELETE FROM citizen_cards WHERE user_id = $1', [targetUserId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🏛️ CITIZEN PASS Center listening on http://localhost:${PORT}`);
  });
}

export default app;
