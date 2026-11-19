/* =========================================================
   CITIZEN PASS — ONEID 디지털 주민등록청 & 시민 신분증 조회 시스템
   - ONEID 로그인 시 공식 전자 주민등록증(홀로그램 ID 카드) 자동 발급
   - AGORA(가상 의회) 소속 정당 · 법안 발의 · 표결 기록 실시간 연동
   - PIGSTY 검열 격리 내역(전과/주의 기록) 및 ONE BANK 계좌 연동 표시
   - 시민 고유 주민등록번호(26XXXX-XXXXXXX) 자동 생성 & 진위 확인 조회소
   - 총괄관리자 전용: 특별 훈장/직책 수여 및 시민 신분 기록 관리
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
app.use(express.json());
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
    } catch {
      // ignore if assembly tables not ready
    }
  }

  const activityScore =
    100 +
    (isAdmin ? 900 : 0) +
    (partyName !== '무소속' ? 80 : 0) +
    billsProposed * 120 +
    votesCast * 30 +
    speechesMade * 25;

  let citizenTier = 'BRONZE · 일반 시민';
  if (isAdmin) citizenTier = 'SOVEREIGN · 국가원수 / 총괄관리자';
  else if (activityScore >= 500) citizenTier = 'DIAMOND · 명예 입법의원';
  else if (activityScore >= 280) citizenTier = 'GOLD · 정식 의회의원';
  else if (activityScore >= 160) citizenTier = 'SILVER · 활동 시민';

  return {
    partyName,
    partyColor,
    partyRole,
    billsProposed,
    votesCast,
    speechesMade,
    activityScore,
    citizenTier,
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
    service: 'citizen-pass',
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

// 전체 시민 명부 + 내 주민등록증 조회
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

    res.json({
      me: myCard,
      totalCitizens: allCards.length,
      directory,
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
      issuer: 'ATELIER J · ONEID 디지털 주민등록청장',
      card,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 내 신분증 커스터마이징 (직함, 가훈/한줄소개, 주소지, 카드 홀로그램 테마, 아이콘)
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

// 총괄관리자 전용: 특정 시민에게 공식 훈장/특별 직책 부여 또는 신분증 말소
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
    console.log(`🪪 CITIZEN PASS listening on http://localhost:${PORT}`);
  });
}

export default app;
