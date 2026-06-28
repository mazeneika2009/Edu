import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const rawPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 100,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

const origQuery = rawPool.query.bind(rawPool);
rawPool.query = (text, params) => {
  if (params && params.length > 0) {
    let i = 0;
    text = text.replace(/\?/g, () => `$${++i}`);
    params = params.map(p => typeof p === 'boolean' ? (p ? 1 : 0) : p);
  }
  return origQuery(text, params).then(result => [result.rows.map(r => normalizeRow(r))]);
};

export const pool = rawPool;

const ROW_KEY_MAP = {
  titleen: 'titleEn', titlear: 'titleAr', titletr: 'titleTr',
  descriptionen: 'descriptionEn', descriptionar: 'descriptionAr', descriptiontr: 'descriptionTr',
  priceegp: 'priceEGP', pricetry: 'priceTRY',
  videourl: 'videoUrl', sortorder: 'sortOrder',
  gardenid: 'gardenId', seedid: 'seedId',
  createdat: 'createdAt', updatedat: 'updatedAt',
  passwordhash: 'passwordHash', isverified: 'isVerified',
  verificationcode: 'verificationCode',
  paidgardens: 'paidGardens',
  isread: 'isRead', isused: 'isUsed',
  isgrowthreport: 'isGrowthReport', iswelcome: 'isWelcome',
  studentname: 'studentName', studentemail: 'studentEmail',
  questionid: 'questionId', correctindex: 'correctIndex',
  optionsen: 'optionsEn', optionsar: 'optionsAr', optionstr: 'optionsTr',
};
function normalizeRow(r) {
  if (!r || typeof r !== 'object') return r;
  const n = { ...r };
  for (const [oldKey, newKey] of Object.entries(ROW_KEY_MAP)) {
    if (oldKey in n) {
      n[newKey] = n[oldKey];
      if (oldKey !== newKey) delete n[oldKey];
    }
  }
  return n;
}

let memoryDb = null;

function parseRow(row, jsonFields) {
  const r = { ...row };
  for (const f of jsonFields) {
    if (typeof r[f] === 'string') { try { r[f] = JSON.parse(r[f]); } catch { } }
  }
  return r;
}

function pluck(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return val; } }
  return val;
}

async function loadAll() {
  const db = {};
  const start = Date.now();

  const [
    [users],
    [emails],
    [gardens],
    [seedRows],
    [payments],
    [growth],
    [qRows],
    [replies],
    [otp],
    [qq],
    [qa],
  ] = await Promise.all([
    pool.query('SELECT * FROM users'),
    pool.query('SELECT * FROM emails'),
    pool.query('SELECT * FROM gardens'),
    pool.query('SELECT s.*, STRING_AGG(st.tag, \',\') AS tags FROM seeds s LEFT JOIN seed_tags st ON st.seedId = s.id GROUP BY s.id'),
    pool.query('SELECT * FROM payments'),
    pool.query('SELECT * FROM student_growth'),
    pool.query('SELECT * FROM queries'),
    pool.query('SELECT * FROM query_replies'),
    pool.query('SELECT * FROM otp_verifications'),
    pool.query('SELECT * FROM quiz_questions'),
    pool.query('SELECT * FROM quiz_answers'),
  ]);

  db.users = users.map(u => parseRow(normalizeRow(u), ['paidGardens']));
  db.emails = emails.map(e => parseRow(normalizeRow(e), ['isRead', 'isGrowthReport', 'isWelcome']));
  db.gardens = gardens.map(normalizeRow);
  db.seeds = seedRows.map(s => normalizeRow({ ...s, tags: s.tags ? s.tags.split(',') : [] }));
  db.payments = payments.map(normalizeRow);
  db.student_growth = growth.map(normalizeRow);

  const replyMap = new Map();
  for (const r of replies.map(normalizeRow)) {
    if (!replyMap.has(r.queryId)) replyMap.set(r.queryId, []);
    replyMap.get(r.queryId).push({ author: r.author, text: r.text, timestamp: r.timestamp });
  }
  db.queries = qRows.map(q => normalizeRow({
    ...q,
    replies: replyMap.get(q.id) || [],
  }));

  db.otp_verifications = otp.map(o => parseRow(normalizeRow(o), ['isUsed']));
  db.quiz_questions = qq.map(q => normalizeRow({
    ...q,
    optionsEn: pluck(q.optionsEn),
    optionsAr: pluck(q.optionsAr),
    optionsTr: pluck(q.optionsTr),
  }));
  db.quiz_answers = qa.map(normalizeRow);

  console.log(`[DB] Cache loaded in ${Date.now() - start}ms: ${db.users.length} users, ${db.gardens.length} gardens, ${db.seeds.length} seeds`);
  return db;
}

function emptyDb() {
  return {
    users: [], emails: [], gardens: [], seeds: [], payments: [],
    student_growth: [], queries: [], otp_verifications: [],
    quiz_questions: [], quiz_answers: [], notebooks: {},
  };
}

export async function initializeDB() {
  console.log('[DB] Loading all data from PostgreSQL...');
  try {
    const fromDb = await loadAll();
    if (!loadFromCache()) {
      memoryDb = fromDb;
    } else {
      for (const key of ['users', 'emails', 'gardens', 'seeds', 'payments',
        'student_growth', 'queries', 'otp_verifications',
        'quiz_questions', 'quiz_answers']) {
        if (fromDb[key]) memoryDb[key] = fromDb[key];
      }
    }
    console.log('[DB] Loaded', memoryDb.users.length, 'users,', memoryDb.gardens.length, 'gardens,',
      memoryDb.seeds.length, 'seeds,', memoryDb.quiz_questions.length, 'questions,',
      memoryDb.payments.length, 'payments');
  } catch (err) {
    console.error('[DB] Failed to load from PostgreSQL, using empty store:', err);
    memoryDb = emptyDb();
  }
}

const DB_DEFAULTS = emptyDb();

export function readDB() {
  if (!memoryDb) memoryDb = emptyDb();
  for (const k of Object.keys(DB_DEFAULTS)) {
    if (!(k in memoryDb)) memoryDb[k] = DB_DEFAULTS[k];
  }
  return memoryDb;
}

const DB_CACHE_PATH = path.join(__dirname, '..', 'data', 'db.json');

export function writeDB(_db) {
  if (!_db) return;
  try {
    const dir = path.dirname(DB_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_CACHE_PATH, JSON.stringify(_db, null, 2), 'utf8');
    memoryDb = _db;
  } catch (err) {
    console.error('[DB] Failed to write cache:', err);
  }
}

export function loadFromCache() {
  try {
    if (fs.existsSync(DB_CACHE_PATH)) {
      const raw = fs.readFileSync(DB_CACHE_PATH, 'utf8');
      const cached = JSON.parse(raw);
      if (cached && typeof cached === 'object') {
        memoryDb = cached;
        console.log('[DB] Restored from JSON cache');
        return true;
      }
    }
  } catch (err) {
    console.warn('[DB] Cache load failed:', err);
  }
  return false;
}

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function getUserById(id) {
  const rows = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function createUser(user) {
  await pool.query(
    `INSERT INTO users (id, email, phone, passwordHash, isVerified, verificationCode, createdAt, current_session_id, country, paidGardens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       email=EXCLUDED.email, phone=EXCLUDED.phone, passwordHash=EXCLUDED.passwordHash,
       isVerified=EXCLUDED.isVerified, verificationCode=EXCLUDED.verificationCode,
       current_session_id=EXCLUDED.current_session_id,
       country=EXCLUDED.country,
       paidGardens=EXCLUDED.paidGardens`,
    [user.id, user.email, user.phone, user.passwordHash, user.isVerified ? 1 : 0,
     user.verificationCode || '', user.createdAt, user.current_session_id ?? null,
     user.country || '', JSON.stringify(user.paidGardens || [])]
  );
}

export async function updateUserSession(userId, sessionId) {
  await pool.query('UPDATE users SET current_session_id = $1 WHERE id = $2', [sessionId, userId]);
}

export async function setPaymentStatus(paymentId, status) {
  await pool.query('UPDATE payments SET status = $1 WHERE id = $2', [status, paymentId]);
}
