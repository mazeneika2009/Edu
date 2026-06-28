import dotenv from 'dotenv';
import express from 'express';
import compression from 'compression';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { pool, readDB, writeDB, initializeDB } from './server/db.js';
import nodemailer from 'nodemailer';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dns from 'dns';

async function smtpConnectOpts() {
  const rawHost = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  if (!rawHost) return { host: rawHost, port };
  const addrs = await dns.resolve4(rawHost);
  const ipv4 = addrs && addrs.length > 0 ? addrs[0] : rawHost;
  console.log(`[SMTP] Resolved ${rawHost} -> ${ipv4}`);
  return { host: ipv4, hostname: rawHost, port };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

export async function sendOTPEmail(to, otp, subject, bodyText) {
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'Knowledge Garden <no-reply@example.com>';

  console.log(`[SMTP] Attempting to send OTP email to: ${to}`);

  if (!process.env.SMTP_HOST || !user || !pass) {
    console.warn('[SMTP] Missing SMTP credentials in environment variables. Falling back to Mock Box.');
    return { success: false, reason: 'credentials_missing', message: 'SMTP environment variables (HOST, USER, PASS) are not defined in your .env file.' };
  }

  try {
    const { host, hostname } = await smtpConnectOpts();
    const transporter = nodemailer.createTransport({
      host,
      hostname,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000
    });

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: bodyText,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 20px; background-color: #0c101d; color: #f3f4f6; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <div style="text-align: center; margin-bottom: 30px; border-bottom: 1px solid rgba(168, 85, 247, 0.15); padding-bottom: 20px;">
            <h1 style="color: #c084fc; margin: 0; font-size: 28px; font-weight: 900; letter-spacing: -0.025em;">Knowledge Garden</h1>
            <p style="font-size: 11px; color: #a78bfa; text-transform: uppercase; letter-spacing: 0.15em; margin: 5px 0 0 0;">Secure Identity Systems & CDN Node</p>
          </div>
          <div style="padding: 10px 0;">
            <p style="font-size: 15px; line-height: 1.6; color: #e5e7eb;">Dear Gardener,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #9ca3af;">A high-security verification check has been requested for your student node account. Enter your single-session authorization code below inside your classroom browser to secure the gateway:</p>
            <div style="text-align: center; margin: 35px 0;">
              <p style="font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.12em; color: #a78bfa; margin-bottom: 10px;">Verification Code (OTP)</p>
              <div style="display: inline-block; background-color: rgba(168, 85, 247, 0.1); border: 2px dashed #a855f7; padding: 15px 40px; font-size: 32px; font-weight: 900; letter-spacing: 0.25em; color: #e9d5ff; border-radius: 14px; font-family: 'Courier New', Courier, monospace; text-shadow: 0 0 10px rgba(168, 85, 247, 0.3);">
                ${otp}
              </div>
            </div>
            <p style="font-size: 13px; color: #9ca3af; line-height: 1.6; font-style: italic; background-color: rgba(255,255,255,0.02); padding: 15px; border-radius: 10px; border-left: 3px solid #a855f7;">
              ${bodyText.replace(/\n/g, '<br />')}
            </p>
          </div>
          <p style="font-size: 10px; text-align: center; color: #6b7280; margin-top: 35px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 15px;">
            This is an automated system transmission from the Knowledge Garden Academic Registry. Please do not reply directly to this workspace carrier.
          </p>
        </div>
      `,
    });

    console.log(`[SMTP] Email sent successfully: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[SMTP ERROR] Failed to send email via nodemailer:', error);
    return { success: false, reason: 'nodemailer_error', message: `SMTP Transport Error: ${error.message}` };
  }
}

async function sendEmail(to, subject, textHtml, textPlain) {
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'Knowledge Garden <no-reply@example.com>';
  if (!process.env.SMTP_HOST || !user || !pass) {
    console.warn('[SMTP] Missing credentials, skipping real email. Payment notification saved to mock inbox.');
    return { success: false, reason: 'credentials_missing' };
  }
  try {
    const { host, hostname } = await smtpConnectOpts();
    const t = nodemailer.createTransport({
      host, hostname, port, secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000
    });
    const info = await t.sendMail({
      from, to, subject,
      text: textPlain || textHtml.replace(/<[^>]+>/g, ''),
      html: textHtml
    });
    console.log(`[SMTP] Payment email sent: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[SMTP ERROR] Failed to send payment email via real SMTP:', error.message);
    console.log('[SMTP] Payment notification is still available in the mock inbox.');
    return { success: false, reason: 'nodemailer_error', message: error.message };
  }
}

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

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3001', 10);

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(compression({
    level: 4,
    threshold: 512,
    memLevel: 8,
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  let RateLimit;
  try {
    const rl = await import('express-rate-limit');
    RateLimit = rl.default;
    app.use(RateLimit({
      windowMs: 60 * 1000,
      max: 200,
      standardHeaders: false,
      legacyHeaders: false,
      message: { error: 'Too many requests, slow down' },
    }));
  } catch {}

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      if (ms > 200) console.log(`[SLOW] ${req.method} ${req.originalUrl} ${ms}ms`);
    });
    next();
  });

  app.use((req, res, next) => {
    res.setTimeout(30000, () => {
      res.status(503).json({ error: 'Request timed out' });
    });
    next();
  });

  const genId = () => Math.random().toString(36).substring(2, 11);

  const mysqlNow = () => new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  const logAdminAction = (action, details) => {
    if (process.env.VERCEL) {
      console.log(`[AUDIT] ${action}`, details);
      return;
    }
    const logDir = path.join(process.cwd(), 'logs');
    const logFile = path.join(logDir, 'admin_audit.log');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const entry = `[${new Date().toISOString()}] ACTION: ${action} | DETAILS: ${JSON.stringify(details)}\n`;
    fs.appendFile(logFile, entry, (err) => {
      if (err) console.error('[AUDIT LOG] Failed to persist admin action:', err);
    });
  };

  const isVercel = !!process.env.VERCEL;

  let upload;
  if (isVercel) {
    const memoryStorage = multer.memoryStorage();
    upload = multer({
      storage: memoryStorage,
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error('Only image files are allowed'));
        }
      },
    });
  } else {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
      },
    });
    upload = multer({
      storage,
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error('Only image files are allowed'));
        }
      },
    });
    app.use('/uploads', express.static(uploadsDir));
  }

  app.post('/api/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error('[Upload] Multer error:', err.message);
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      if (isVercel) {
        const b64 = req.file.buffer.toString('base64');
        const mime = req.file.mimetype || 'application/octet-stream';
        const url = `data:${mime};base64,${b64}`;
        console.log('[Upload] Memory file:', req.file.originalname, `(${(req.file.buffer.length / 1024).toFixed(1)}KB)`);
        res.json({ success: true, url });
      } else {
        const url = `/uploads/${req.file.filename}`;
        console.log('[Upload] Saved file:', req.file.filename, '->', url);
        res.json({ success: true, url });
      }
    });
  });

  try {
    await pool.query('ALTER TABLE gardens ALTER COLUMN image TYPE TEXT');
    console.log('[DB] Migrated gardens.image column to TEXT');
  } catch {}

  try {
    await pool.query('ALTER TABLE seeds ALTER COLUMN videoUrl TYPE TEXT');
    console.log('[DB] Migrated seeds.videoUrl column to TEXT');
  } catch {}

  try {
    await pool.query(`ALTER TABLE seeds ADD COLUMN section VARCHAR(100) NOT NULL DEFAULT ''`);
    console.log('[DB] Added section column to seeds');
  } catch {}

  try {
    await pool.query(`ALTER TABLE seeds ADD COLUMN sortOrder INT NOT NULL DEFAULT 0`);
    console.log('[DB] Added sortOrder column to seeds');
  } catch {}

  try {
    await initializeDB();
  } catch (err) {
    console.error('[DB] Failed to preload data:', err);
    console.warn('[DB] Running without PostgreSQL — using empty in-memory store');
  }

  try {
    const [existing] = await pool.query('SELECT COUNT(*) AS cnt FROM gardens');
    if (!existing || existing.length === 0 || Number(existing[0].cnt) === 0) {
      console.log('[Seed] No gardens found, auto-seeding...');
      const gardenSeed = [
        { id: 'g_b5n8d2c1f', titleEn: 'Programming HTML with Real Videos', titleAr: 'برمجة HTML فيديوهات واقعية', titleTr: 'Gerçek Videolarla HTML Programlama', descriptionEn: 'Learn HTML programming from scratch with hands-on video tutorials.', descriptionAr: 'تعلم برمجة HTML من الصفر فيديوهات تعليمية عملية.', descriptionTr: 'Sıfırdan HTML programlamayı uygulamalı video eğitimleriyle öğrenin.', category: 'Programming', priceEGP: 600, priceTRY: 180, rating: '4.7', image: '' },
        { id: 'g_h4r7t9w1q', titleEn: 'Marketing with Real Videos', titleAr: 'التسويق فيديوهات واقعية', titleTr: 'Gerçek Videolarla Pazarlama', descriptionEn: 'Master digital marketing strategies through real-world video case studies.', descriptionAr: 'إتقان استراتيجيات التسويق الرقمي من خلال دراسات حالة فيديو واقعية.', descriptionTr: 'Gerçek dünya video vaka çalışmalarıyla dijital pazarlama stratejilerinde ustalaşın.', category: 'Marketing', priceEGP: 550, priceTRY: 165, rating: '4.6', image: '' },
        { id: 'g_k7m3x9p2r', titleEn: 'English with Real Videos', titleAr: 'الإنجليزية فيديوهات واقعية', titleTr: 'Gerçek Videolarla İngilizce', descriptionEn: 'A practical English course using real-world video content.', descriptionAr: 'دورة إنجليزية عملية باستخدام محتوى فيديو واقعي.', descriptionTr: 'Gerçek dünya video içeriği kullanan pratik bir İngilizce kursu.', category: 'Languages', priceEGP: 500, priceTRY: 150, rating: '4.5', image: '' },
      ];
      const testUserSeed = [
        { id: 'u_test_' + genId(), email: 'test@kg.edu', phone: '000', name: 'Test Student', passwordHash: 'test123', isVerified: 1, verificationCode: '', country: 'Egypt', paidGardens: JSON.stringify(['g_b5n8d2c1f', 'g_h4r7t9w1q', 'g_k7m3x9p2r']) },
        { id: 'u_admin_' + genId(), email: 'admin@kg.edu', phone: 'admin', name: 'Admin', passwordHash: 'admin123', isVerified: 1, verificationCode: '', country: 'Egypt', paidGardens: JSON.stringify([]) },
      ];
      for (const g of gardenSeed) {
        await pool.query('INSERT INTO gardens (id, titleEn, titleAr, titleTr, descriptionEn, descriptionAr, descriptionTr, category, priceEGP, priceTRY, rating, image) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING',
          [g.id, g.titleEn, g.titleAr, g.titleTr, g.descriptionEn, g.descriptionAr, g.descriptionTr, g.category, g.priceEGP, g.priceTRY, g.rating, g.image]);
      }
      for (const u of testUserSeed) {
        await pool.query('INSERT INTO users (id, email, phone, name, passwordHash, isVerified, verificationCode, country, paidGardens) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING',
          [u.id, u.email, u.phone, u.name, u.passwordHash, u.isVerified, u.verificationCode, u.country, u.paidGardens]);
      }
      console.log('[Seed] Auto-seed complete: 3 gardens, 2 test users');
      await initializeDB();
    } else {
      console.log('[Seed] Gardens already exist, skipping seed.');
    }
  } catch (seedErr) {
    console.warn('[Seed] Auto-seed skipped:', seedErr.message);
  }

  // --- API ROUTES ---

  // Register
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, phone, password, name, country } = req.body;
      if (!email || !phone || !password) {
        return res.status(400).json({ error: 'All fields are required.' });
      }

      const [existingUsers] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      if (existingUsers && existingUsers.length > 0) {
        return res.status(400).json({ error: 'User already exists with this email address.' });
      }

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const userId = 'u_' + genId();
      const createdAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

      try {
        await pool.query(
          'INSERT INTO users (id, email, phone, name, passwordHash, isVerified, verificationCode, createdAt, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [userId, email, phone, name || '', password, false, otpCode, createdAt, country || '']
        );
      } catch (sqlErr) {
        console.warn('[PG] Insert failed, falling back to JSON db only:', sqlErr);
      }

      try {
        const db = readDB();
        db.users.push({
          id: userId,
          email,
          phone,
          name: name || '',
          passwordHash: password,
          isVerified: false,
          verificationCode: otpCode,
          current_session_id: '',
          country: country || '',
          paidGardens: [],
          createdAt: createdAt
        });
        writeDB(db);
      } catch (dbErr) {
        console.error('[AUTH] Failed to write user to JSON db:', dbErr);
      }

      console.log(`[AUTH] Registered user ${email} with OTP: ${otpCode}`);

      try {
        const db = readDB();
        const welcomeEmailId = 'em-welcome-' + genId();
        db.emails.push({
          id: welcomeEmailId,
          userId: userId,
          toEmail: email,
          subject: 'Welcome to the Knowledge Garden!',
          bodyEn: `Welcome gardener! Your node is now initialized.\n\nYour 6-digit verification code (OTP) is: ${otpCode}\n\nUse this code to verify your account and access your gardens.`,
          bodyAr: `مرحباً بك يا مزارع المعرفة! تم تفعيل حسابك بنجاح.\n\nرمز التحقق الخاص بك (OTP) هو: ${otpCode}\n\nاستخدم هذا الرمز للتحقق من حسابك والوصول إلى حدائقك.`,
          bodyTr: `Hoş geldin bahçıvan! Düğümünüz başarıyla başlatıldı.\n\n6 haneli doğrulama kodunuz (OTP): ${otpCode}\n\nBu kodu hesabınızı doğrulamak ve bahçelerinize erişmek için kullanın.`,
          otpCode: otpCode,
          isRead: false,
          timestamp: new Date().toISOString(),
          isGrowthReport: false,
          isWelcome: true
        });
        writeDB(db);
      } catch (dbErr) {
        console.error('[AUTH DB ERR] Failed to create welcome email:', dbErr);
      }

      sendOTPEmail(email, otpCode, "Verify Your Knowledge Garden Account", `Welcome to the Knowledge Garden educational workspace!\n\nTo complete registration and verify your student node credentials, please copy and apply your 6-digit synchronization passcode (OTP):\n\n: ${otpCode}\n\nEnjoy your learning and growth journey!`)
        .then(r => console.log('[AUTH] SMTP result:', r.success ? 'sent' : r.reason))
        .catch(e => console.error('[AUTH] SMTP error:', e));

      return res.json({
        success: true,
        userId,
        email,
        otpCode,
        message: 'Registration successful! Please verify your account to continue.'
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error occurred.' });
    }
  });

  // Forgot Password
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required.' });

      const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      if (!users || users.length === 0) {
        return res.status(404).json({ error: 'No gardener found with this email.' });
      }

      const user = users[0];
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

      await pool.query('UPDATE users SET verificationCode = ?, isVerified = ? WHERE id = ?', [
        otpCode, false, user.id
      ]);

      try {
        const db = readDB();
        db.emails.push({
          id: 'em-reset-' + genId(),
          userId: user.id,
          toEmail: email,
          subject: 'Reset Your Knowledge Garden Password',
          bodyEn: `A security reset has been requested.\n\nYour 6-digit reset code (OTP) is: ${otpCode}\n\nEnter this code to verify your identity and reset your password.`,
          bodyAr: `تم طلب إعادة تعيين الأمان.\n\nرمز إعادة التعيين المكون من 6 أرقام (OTP) هو: ${otpCode}\n\nأدخل هذا الرمز للتحقق من هويتك وإعادة تعيين كلمة المرور الخاصة بك.`,
          bodyTr: `Bir güvenlik sıfırlaması istendi.\n\n6 haneli sıfırlama kodunuz (OTP): ${otpCode}\n\nKimliğinizi doğrulamak ve şifrenizi sıfırlamak için bu kodu girin.`,
          otpCode: otpCode,
          isRead: false,
          timestamp: new Date().toISOString(),
          isGrowthReport: false,
          isWelcome: false
        });
        writeDB(db);
      } catch (dbErr) {
        console.error('[AUTH DB ERR] Failed to create reset email:', dbErr);
      }

      sendOTPEmail(email, otpCode, "Reset Your Knowledge Garden Password", `A security reset synchronization key has been requested.\n\nYour 6-digit reset code (OTP) is:\n\n: ${otpCode}\n\nPlease enter this code to verify your identity.`)
        .then(r => console.log('[AUTH] Reset SMTP:', r.success ? 'sent' : r.reason))
        .catch(e => console.error('[AUTH] Reset SMTP error:', e));

      return res.json({
        success: true,
        userId: user.id,
        otpCode,
        message: 'Reset key dispatched to your email.'
      });
    } catch (err) {
      return res.status(500).json({ error: 'Reset system node failure.' });
    }
  });

  // Resend Verification Code
  app.post('/api/auth/resend-code', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'User ID is required.' });

      const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
      if (!users || users.length === 0) {
        return res.status(404).json({ error: 'Gardener node not found.' });
      }

      const user = users[0];
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      await pool.query('UPDATE users SET verificationCode = ? WHERE id = ?', [code, userId]);

      try {
        const db = readDB();
        db.emails.push({
          id: 'em-resend-' + genId(),
          userId: userId,
          toEmail: user.email,
          subject: 'Re-issued Synchronization Code',
          bodyEn: `Your new 6-digit synchronization passcode (OTP) is: ${code}`,
          bodyAr: `رمز التحقق الجديد المكون من 6 أرقام (OTP) هو: ${code}`,
          bodyTr: `Yeni 6 haneli senkronizasyon kodunuz (OTP): ${code}`,
          otpCode: code,
          isRead: false,
          timestamp: new Date().toISOString(),
          isGrowthReport: false,
          isWelcome: false
        });
        writeDB(db);
      } catch (dbErr) {
        console.error('[AUTH DB ERR] Failed to create resend email:', dbErr);
      }

      sendOTPEmail(user.email, code, "Re-issued Synchronization Code", `Your new 6-digit synchronization passcode (OTP) is:\n\n: ${code}`)
        .then(r => console.log('[AUTH] Resend SMTP:', r.success ? 'sent' : r.reason))
        .catch(e => console.error('[AUTH] Resend SMTP error:', e));

      return res.json({ success: true, message: 'New code dispatched.', otpCode: code });
    } catch (err) {
      return res.status(500).json({ error: 'Resend system failure.' });
    }
  });

  // Verify Identity
  app.post('/api/auth/verify', async (req, res) => {
    try {
      const { userId, code } = req.body;
      if (!userId || !code) {
        return res.status(400).json({ error: 'User ID and verification code are required.' });
      }

      const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
      if (!users || users.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const user = users[0];
      
      const storedCode = String(user.verificationCode || '').trim();
      const providedCode = String(code || '').trim();

      if (storedCode !== providedCode) {
        return res.status(400).json({ error: 'Invalid synchronization code. Please try again.' });
      }

      await pool.query('UPDATE users SET isVerified = ?, verificationCode = ? WHERE id = ?', [
        true, '', userId
      ]);

      const newSessionId = 'session_' + genId();
      await pool.query('UPDATE users SET current_session_id = ? WHERE id = ?', [newSessionId, userId]);

      return res.json({
        success: true,
        sessionId: newSessionId,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          isVerified: true,
          paidGardens: user.paidGardens || [],
          createdAt: user.createdAt
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Verification failed.' });
    }
  });

  // Log In
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and Password are required.' });
      }
      
      const db = readDB();

      const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      if (!users || users.length === 0) {
        const found = db.users.find(u => u.phone === email && u.passwordHash === password);
        if (!found) {
          return res.status(401).json({ error: 'Invalid email or password.' });
        }
        users.push(found);
      }

      const user = users[0];
      if (user.passwordHash !== password) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const newSessionId = 'session_' + genId();

      await pool.query('UPDATE users SET current_session_id = ? WHERE id = ?', [newSessionId, user.id]);

      let dbUser = db.users.find(u => u.id === user.id);
      if (!dbUser) {
        db.users.push({
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name || '',
          passwordHash: user.passwordHash,
          isVerified: user.isVerified,
          verificationCode: user.verificationCode || '',
          current_session_id: newSessionId,
          paidGardens: typeof user.paidGardens === 'string' ? JSON.parse(user.paidGardens) : (user.paidGardens || []),
          createdAt: typeof user.createdAt === 'string' ? user.createdAt : new Date().toISOString()
        });
      } else {
        dbUser.current_session_id = newSessionId;
      }
      writeDB(db);

      if (!user.isVerified) {
        let code = user.verificationCode;
        if (!code || code === '') {
           code = Math.floor(100000 + Math.random() * 900000).toString();
           await pool.query('UPDATE users SET verificationCode = ? WHERE id = ?', [code, user.id]);
        }

        try {
          const dbe = readDB();
          dbe.emails.push({
            id: 'em-verify-' + genId(),
            userId: user.id,
            toEmail: user.email,
            subject: 'Synchronization Code: Knowledge Garden Access',
            bodyEn: `To access your gardener node, apply your 6-digit synchronization passcode (OTP): ${code}`,
            bodyAr: `للوصول إلى عقدة البستاني الخاصة بك، استخدم رمز التحقق المكون من 6 أرقام (OTP): ${code}`,
            bodyTr: `Bahçıvan düğümünüze erişmek için 6 haneli senkronizasyon kodunuzu (OTP) kullanın: ${code}`,
            otpCode: code,
            isRead: false,
            timestamp: new Date().toISOString(),
            isGrowthReport: false,
            isWelcome: false
          });
          writeDB(dbe);
        } catch (dbErr) {
          console.error('[AUTH DB ERR] Failed to create verify email:', dbErr);
        }

        sendOTPEmail(user.email, code, "Synchronization Code: Knowledge Garden Access", `To access your gardener node, please apply your 6-digit synchronization passcode (OTP):\n\n: ${code}`)
          .then(r => console.log('[AUTH] Login-verify SMTP:', r.success ? 'sent' : r.reason))
          .catch(e => console.error('[AUTH] Login-verify SMTP error:', e));

        return res.json({
          success: false,
          requiresVerification: true,
          userId: user.id,
          otpCode: code,
          message: 'Account not verified. Verification code has been sent.'
        });
      }

      const [sqlPending] = await pool.query('SELECT gardenId FROM payments WHERE userId = ? AND status = "pending"', [user.id]);
      const sqlPendingIds = sqlPending.map(r => r.gardenId);
      const jsonPendingIds = db.payments.filter(p => p.userId === user.id && p.status === 'pending').map(p => p.gardenId);
      
      const pendingGardens = Array.from(new Set([...sqlPendingIds, ...jsonPendingIds]));

      return res.json({
        success: true,
        sessionId: newSessionId,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name || '',
          isVerified: true,
          paidGardens: typeof user.paidGardens === 'string' ? JSON.parse(user.paidGardens) : (user.paidGardens || []),
          pendingGardens,
          createdAt: user.createdAt
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server login error.' });
    }
  });

  // Validate Session
  app.post('/api/auth/session', async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(401).json({ error: 'No active session.' });
      }

      const db = readDB();

      const [users] = await pool.query('SELECT * FROM users WHERE current_session_id = ?', [sessionId]);
      let user = users && users.length > 0 ? users[0] : null;

      if (!user) {
        user = db.users.find(u => u.current_session_id === sessionId);
      }

      if (!user) {
        return res.status(401).json({ error: 'Session expired.' });
      }

      const [sqlPending] = await pool.query('SELECT gardenId FROM payments WHERE userId = ? AND status = "pending"', [user.id]);
      const sqlPendingIds = sqlPending.map(r => r.gardenId);
      const jsonPendingIds = db.payments.filter(p => p.userId === user.id && p.status === 'pending').map(p => p.gardenId);

      const pendingGardens = Array.from(new Set([...sqlPendingIds, ...jsonPendingIds]));

      return res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name || '',
          isVerified: user.isVerified,
          paidGardens: typeof user.paidGardens === 'string' ? JSON.parse(user.paidGardens) : (user.paidGardens || []),
          pendingGardens,
          createdAt: user.createdAt
        }
      });
    } catch (err) {
      return res.status(500).json({ error: 'Session validation error.' });
    }
  });

  app.post('/api/auth/delete-account', async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(401).json({ error: 'No active session.' });

      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) return res.status(404).json({ error: 'User not found.' });

      const userId = user.id;

      try {
        await pool.query('DELETE FROM users WHERE id = ?', [userId]);
        await pool.query('DELETE FROM emails WHERE userId = ?', [userId]);
        await pool.query('DELETE FROM payments WHERE userId = ?', [userId]);
      } catch (sqlErr) {
        console.warn('[DELETE] MySQL cleanup failed:', sqlErr);
      }

      db.users = db.users.filter(u => u.id !== userId);
      db.emails = db.emails.filter(e => e.userId !== userId);
      db.payments = db.payments.filter(p => p.userId !== userId);
      db.notes = (db.notes || []).filter(n => n.userId !== userId);
      writeDB(db);

      console.log(`[AUTH] Deleted account ${user.email} (${userId})`);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete account.' });
    }
  });

  // Public stats for landing page
  app.get('/api/stats', (req, res) => {
    const db = readDB();
    const countries = new Set((db.users || []).map(u => u.country).filter(Boolean));
    return res.json({
      totalUsers: db.users.length,
      totalGardens: db.gardens.length,
      totalSeeds: (db.seeds || []).length,
      totalCountries: countries.size || 1,
    });
  });

  // List Gardens
  app.get('/api/gardens', async (req, res) => {
    const db = readDB();
    const map = new Map();
    db.gardens.forEach(g => map.set(g.id, g));
    try {
      const [rows] = await pool.query('SELECT * FROM gardens');
      rows.forEach(r => {
        if (!map.has(r.id)) map.set(r.id, normalizeRow(r));
      });
    } catch {}
    return res.json([...map.values()].map(normalizeRow));
  });

  // List Seeds in a Garden
  app.get('/api/gardens/:id/seeds', async (req, res) => {
    const { id } = req.params;
    const db = readDB();
    const map = new Map();
    db.seeds.filter(s => s.gardenId === id).forEach(s => map.set(s.id, normalizeRow(s)));
    try {
      const [rows] = await pool.query(
        'SELECT s.*, STRING_AGG(st.tag, \',\') AS tags FROM seeds s LEFT JOIN seed_tags st ON st.seedId = s.id WHERE s.gardenId = ? GROUP BY s.id ORDER BY s.sortOrder, s.id',
        [id]
      );
      rows.forEach(r => {
        r = normalizeRow(r);
        if (!map.has(r.id)) {
          if (r.tags) r.tags = r.tags.split(',');
          else r.tags = [];
          map.set(r.id, r);
        }
      });
    } catch {}
    return res.json([...map.values()]);
  });

  // Get all seeds
  app.get('/api/seeds', async (req, res) => {
    const db = readDB();
    const map = new Map();
    (db.seeds || []).forEach(s => map.set(s.id, normalizeRow(s)));
    try {
      const [rows] = await pool.query(
        'SELECT s.*, STRING_AGG(st.tag, \',\') AS tags FROM seeds s LEFT JOIN seed_tags st ON st.seedId = s.id GROUP BY s.id ORDER BY s.sortOrder, s.id'
      );
      rows.forEach(r => {
        r = normalizeRow(r);
        if (!map.has(r.id)) {
          if (r.tags) r.tags = r.tags.split(',');
          else r.tags = [];
          map.set(r.id, r);
        }
      });
    } catch {}
    return res.json([...map.values()]);
  });

  // DRM Route
  app.get('/api/seeds/:id/stream', async (req, res) => {
    try {
      const { id } = req.params;
      const token = req.query.token;

      if (!token) {
        return res.status(401).json({ error: 'Authentication token is required for streaming.' });
      }

      const db = readDB();
      const user = db.users.find(u => u.current_session_id === token);

      if (!user) {
        return res.status(403).json({ error: 'Invalid session or logged in elsewhere.' });
      }

      const seed = db.seeds.find(s => s.id === id);
      if (!seed) {
        return res.status(404).json({ error: 'Seed not found.' });
      }

      if (!user.paidGardens?.includes(seed.gardenId)) {
        return res.status(402).json({ error: 'Paid access is required to cultivate this seed.' });
      }

      const streamToken = 'bunny_secure_jwt_' + genId() + '_exp_3600';
      const separator = seed.videoUrl.includes('?') ? '&' : '?';
      return res.json({
        success: true,
        videoCode: seed.videoUrl,
        streamToken,
        resolvedUrl: seed.videoUrl.startsWith('http') ? `${seed.videoUrl}${separator}token=${streamToken}` : seed.videoUrl
      });
    } catch (err) {
      return res.status(500).json({ error: 'Streaming token generation failed.' });
    }
  });

  // Progress Saving
  app.post('/api/student_growth/save', async (req, res) => {
    try {
      const { sessionId, seedId, watchedSeconds } = req.body;
      if (!sessionId || !seedId) {
        return res.status(400).json({ error: 'Missing sync parameters.' });
      }

      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) {
        return res.status(403).json({ error: 'Invalid session/growth lock exception.' });
      }

      await pool.query(
        'INSERT INTO student_growth (userId, seedId, watchedSeconds, lastUpdated) VALUES (?, ?, ?, NOW()) ON CONFLICT (userId, seedId) DO UPDATE SET watchedSeconds = EXCLUDED.watchedSeconds, lastUpdated = NOW()',
        [user.id, seedId, watchedSeconds, watchedSeconds]
      );

      const existingIdx = db.student_growth.findIndex(g => g.userId === user.id && g.seedId === seedId);
      if (existingIdx !== -1) {
        db.student_growth[existingIdx].watchedSeconds = watchedSeconds;
      } else {
        db.student_growth.push({ userId: user.id, seedId, watchedSeconds });
      }
      writeDB(db);

      return res.json({ success: true, message: 'Growth state metrics synchronized successfully.' });
    } catch (err) {
      return res.status(500).json({ error: 'Growth sync failed.' });
    }
  });

  // Fetch student growth metrics
  app.post('/api/student_growth/get', async (req, res) => {
    const { sessionId, seedId } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.current_session_id === sessionId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const progress = db.student_growth.find(g => g.userId === user.id && g.seedId === seedId);
    return res.json({ watchedSeconds: progress ? progress.watchedSeconds : 0 });
  });

  // Notebook routes
  app.get('/api/notebook', async (req, res) => {
    try {
      const { seedId, email } = req.query;
      if (!seedId || !email) return res.status(400).json({ error: 'seedId and email required.' });
      const db = readDB();
      const key = `${seedId}:${email}`;
      const notes = db.notebooks?.[key] || [];
      return res.json({ success: true, notes });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load notes.' });
    }
  });

  app.post('/api/notebook', async (req, res) => {
    try {
      const { seedId, email, note } = req.body;
      if (!seedId || !email || !note) return res.status(400).json({ error: 'All parameters required.' });
      const db = readDB();
      if (!db.notebooks) db.notebooks = {};
      const key = `${seedId}:${email}`;
      if (!db.notebooks[key]) db.notebooks[key] = [];
      db.notebooks[key].push(note);
      writeDB(db);
      return res.json({ success: true, notes: db.notebooks[key] });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save note.' });
    }
  });

  app.post('/api/notebook/delete', async (req, res) => {
    try {
      const { seedId, email, index } = req.body;
      if (index === undefined || !seedId || !email) return res.status(400).json({ error: 'All parameters required.' });
      const db = readDB();
      const key = `${seedId}:${email}`;
      if (db.notebooks?.[key]) {
        db.notebooks[key].splice(index, 1);
        writeDB(db);
      }
      return res.json({ success: true, notes: db.notebooks?.[key] || [] });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete note.' });
    }
  });

  // Fetch Seeds Query Threads
  app.get('/api/queries', async (req, res) => {
    const { seedId, sessionId } = req.query;
    if (!seedId) {
      return res.status(400).json({ error: 'seedId is required.' });
    }
    const db = readDB();
    const filtered = db.queries.filter(q => q.seedId === seedId);
    return res.json({ success: true, queries: filtered });
  });

  // Post Query
  app.post('/api/queries', async (req, res) => {
    const { sessionId, seedId, text } = req.body;
    if (!sessionId || !seedId || !text) {
      return res.status(400).json({ error: 'All parameters required.' });
    }

    const db = readDB();
    const user = db.users.find(u => u.current_session_id === sessionId);
    if (!user) return res.status(403).json({ error: 'Invalid session.' });

    const queryId = 'q_' + genId();
    const studentName = user.email.split('@')[0];

    const newQuery = {
      id: queryId,
      seedId,
      studentName,
      studentEmail: user.email,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user.email)}`,
      question: text,
      text,
      createdTime: mysqlNow(),
      replies: []
    };

    db.queries.push(newQuery);
    writeDB(db);
    pool.query(
      'INSERT INTO queries (id, seedId, studentName, studentEmail, avatar, question, createdTime) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [newQuery.id, newQuery.seedId, newQuery.studentName, newQuery.studentEmail, newQuery.avatar, newQuery.question, newQuery.createdTime]
    ).catch(err => console.warn('[PG] Query insert failed:', err));

    return res.json({ success: true, query: newQuery });
  });

  // Contact form submission
  app.post('/api/contact', async (req, res) => {
    try {
      const { name, email, subject, message } = req.body;
      if (!name || !email || !message) {
        return res.status(400).json({ error: 'Name, email, and message are required.' });
      }

      const id = 'c_' + genId();
      const db = readDB();
      if (!db.contacts) db.contacts = [];

      const entry = { id, name, email, subject: subject || '', message, status: 'unread', createdAt: mysqlNow() };
      db.contacts.push(entry);
      writeDB(db);

      pool.query(
        'INSERT INTO contacts (id, name, email, subject, message, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [entry.id, entry.name, entry.email, entry.subject, entry.message, entry.status, entry.createdAt]
      ).catch(err => console.warn('[PostgreSQL] Contact insert failed:', err));

      // Notify admin via email
      const adminHtml = `
        <div style="font-family:monospace;background:#090D16;padding:24px;border-radius:12px;max-width:600px;margin:0 auto">
          <div style="border-bottom:2px solid #a855f7;padding-bottom:12px;margin-bottom:16px">
            <h2 style="color:#22D3EE;margin:0;font-size:18px">📬 New Contact Message</h2>
          </div>
          <table style="width:100%;font-size:13px;color:#ccc">
            <tr><td style="padding:6px 0;color:#888">Name</td><td style="padding:6px 0;color:#fff">${name}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0;color:#22D3EE">${email}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Subject</td><td style="padding:6px 0;color:#fff">${subject || '(none)'}</td></tr>
          </table>
          <div style="margin-top:16px;padding:16px;background:#0c101d;border:1px solid #a855f733;border-radius:8px;color:#ddd;font-size:13px;white-space:pre-wrap">${message}</div>
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid #a855f733;font-size:10px;color:#666;text-align:center">Knowledge Garden - Contact System</div>
        </div>`;

      const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
      if (adminEmail) {
        sendEmail(adminEmail, `[Contact] ${subject || 'New Message'} from ${name}`, adminHtml).catch(e =>
          console.warn('[Contact] Failed to send admin notification:', e.message)
        );
      }

      return res.json({ success: true, contact: entry });
    } catch (err) {
      console.error('[Contact] Error:', err);
      return res.status(500).json({ error: 'Failed to submit contact message.' });
    }
  });

  function parseDurationToSeconds(duration) {
    if (!duration) return 0;
    const parts = duration.split(':').map(Number);
    if (parts.some(isNaN)) return 1800;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] || 0;
  }

  // Get User Mock Emails
  app.get('/api/emails', async (req, res) => {
    try {
      const sessionId = req.query.sessionId;
      if (!sessionId) {
        return res.status(401).json({ error: 'Session ID is required.' });
      }
      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) {
        return res.status(403).json({ error: 'Invalid session.' });
      }
      const userEmails = db.emails.filter(e => e.userId === user.id);
      return res.json(userEmails);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch mock emails.' });
    }
  });

  // Mark Mock Email as Read
  app.post('/api/emails/read', async (req, res) => {
    try {
      const { sessionId, emailId } = req.body;
      if (!sessionId || !emailId) {
        return res.status(400).json({ error: 'Missing parameters.' });
      }
      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) return res.status(403).json({ error: 'Invalid session.' });

      const email = db.emails.find(e => e.id === emailId && e.userId === user.id);
      if (email) {
        email.isRead = true;
        pool.query('UPDATE emails SET isRead = ? WHERE id = ?', [true, emailId])
          .catch(err => console.warn('[PG] Email read update failed:', err));
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update email.' });
    }
  });

  // User Send Message to System
  app.post('/api/emails/send', async (req, res) => {
    try {
      const { sessionId, subject, body } = req.body;
      if (!sessionId || !subject || !body) {
        return res.status(400).json({ error: 'Missing parameters.' });
      }

      const [users] = await pool.query('SELECT * FROM users WHERE current_session_id = ?', [sessionId]);
      const user = users && users.length > 0 ? users[0] : null;

      if (!user) return res.status(403).json({ error: 'Invalid session.' });

      const db = readDB();
      const emailId = 'em-sent-' + genId();
      db.emails.push({
        id: emailId,
        userId: user.id,
        toEmail: 'academic-registry@knowledge-garden.io',
        subject: subject,
        bodyEn: body,
        bodyAr: body,
        bodyTr: body,
        isRead: true,
        timestamp: new Date().toISOString(),
        isSentByUser: true
      });
      pool.query(
        'INSERT INTO emails (id, userId, toEmail, subject, bodyEn, bodyAr, bodyTr, otpCode, isRead, timestamp, isGrowthReport, isWelcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [emailId, user.id, 'academic-registry@knowledge-garden.io', subject, body, body, body, null, true, mysqlNow(), false, false]
      ).catch(err => console.warn('[PG] Email insert failed:', err));
      
      return res.json({ success: true, message: 'Message transmitted to Registry node.' });
    } catch (err) {
      return res.status(500).json({ error: 'Message transmission failure.' });
    }
  });

  // Delete Mock Email
  app.post('/api/emails/delete', async (req, res) => {
    try {
      const { sessionId, emailId } = req.body;
      if (!sessionId || !emailId) return res.status(400).json({ error: 'Params missing.' });

      const [users] = await pool.query('SELECT * FROM users WHERE current_session_id = ?', [sessionId]);
      const user = users && users.length > 0 ? users[0] : null;
      if (!user) return res.status(403).json({ error: 'Unauthorized.' });

      const db = readDB();
      const initialCount = db.emails.length;
      db.emails = db.emails.filter(e => !(e.id === emailId && e.userId === user.id));
      
      if (db.emails.length !== initialCount) {
        pool.query('DELETE FROM emails WHERE id = ?', [emailId])
          .catch(err => console.warn('[PG] Email delete failed:', err));
      }

      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'De-rooting email failed.' });
    }
  });

  // Garden progress
  app.post('/api/student_growth/garden-progress', async (req, res) => {
    try {
      const { sessionId, gardenId } = req.body;
      if (!sessionId || !gardenId) {
        return res.status(400).json({ error: 'Missing parameters.' });
      }
      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) return res.status(403).json({ error: 'Invalid session.' });

      const seeds = db.seeds.filter(s => s.gardenId === gardenId);
      if (seeds.length === 0) {
        return res.json({
          completionPercent: 0,
          completedSeedsCount: 0,
          totalSeedsCount: 0,
          isGardenCompleted: false,
          isReportIssued: false,
          isOtpPending: false
        });
      }

      let completedCount = 0;
      const seedProgressDetails = [];

      for (const seed of seeds) {
        const progress = db.student_growth.find(g => g.userId === user.id && g.seedId === seed.id);
        const watched = progress ? progress.watchedSeconds : 0;
        const totalSec = parseDurationToSeconds(seed.duration);

        let isCompleted = totalSec > 0 ? (watched >= totalSec * 0.92) : (watched > 0);
        
        const seedQuizzes = (db.quiz_questions || []).filter(q => q.seedId === seed.id);
        if (seedQuizzes.length > 0) {
          const correctQuizAnswers = (db.quiz_answers || []).filter(a => a.userId === user.id && a.seedId === seed.id && a.isCorrect);
          const answeredAll = seedQuizzes.every(q => correctQuizAnswers.some(a => a.questionId === q.id));
          if (!answeredAll) {
            isCompleted = false;
          }
        }

        if (isCompleted) {
          completedCount++;
        }

        seedProgressDetails.push({
          seedId: seed.id,
          titleEn: seed.titleEn,
          titleAr: seed.titleAr,
          titleTr: seed.titleTr,
          watchedSeconds: watched,
          durationSeconds: totalSec,
          isCompleted
        });
      }

      const completionPercent = Math.round((completedCount / seeds.length) * 100);
      const isGardenCompleted = completionPercent === 100;

      const isReportIssued = db.emails.some(e => e.userId === user.id && e.isGrowthReport && e.gardenId === gardenId);
      const isOtpPending = db.otp_verifications.some(o => o.userId === user.id && o.gardenId === gardenId && !o.isUsed);

      return res.json({
        completionPercent,
        completedSeedsCount: completedCount,
        totalSeedsCount: seeds.length,
        isGardenCompleted,
        isReportIssued,
        isOtpPending,
        seedProgressDetails
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to calculate garden progress.' });
    }
  });

  // Request OTP for Growth Report
  app.post('/api/reports/request-otp', async (req, res) => {
    try {
      const { sessionId, gardenId } = req.body;
      if (!sessionId || !gardenId) {
        return res.status(400).json({ error: 'Missing parameters.' });
      }
      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) return res.status(403).json({ error: 'Invalid session.' });

      const garden = db.gardens.find(g => g.id === gardenId);
      if (!garden) return res.status(404).json({ error: 'Garden not found.' });

      const seeds = db.seeds.filter(s => s.gardenId === gardenId);
      let completedCount = 0;
      for (const seed of seeds) {
        const progress = db.student_growth.find(g => g.userId === user.id && g.seedId === seed.id);
        const watched = progress ? progress.watchedSeconds : 0;
        const totalSec = parseDurationToSeconds(seed.duration);
        if (totalSec > 0 ? (watched >= totalSec * 0.92) : (watched > 0)) {
          completedCount++;
        }
      }

      if (seeds.length === 0 || completedCount < seeds.length) {
        return res.status(400).json({ error: 'All garden seeds must be fully cultivate-bloomed to 100% progress.' });
      }

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

      db.otp_verifications = db.otp_verifications.filter(o => !(o.userId === user.id && o.gardenId === gardenId));

      const otpId = 'otp_' + genId();
      const otpTimestamp = mysqlNow();
      db.otp_verifications.push({
        id: otpId,
        userId: user.id,
        gardenId,
        otpCode,
        isUsed: false,
        timestamp: new Date().toISOString()
      });
      pool.query(
        'DELETE FROM otp_verifications WHERE userId = ? AND gardenId = ?',
        [user.id, gardenId]
      ).then(() => {
        pool.query(
          'INSERT INTO otp_verifications (id, userId, gardenId, otpCode, isUsed, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [otpId, user.id, gardenId, otpCode, false, otpTimestamp]
        ).catch(err => console.warn('[PG] OTP insert failed:', err));
      }).catch(err => console.warn('[PG] OTP delete failed:', err));

      const emailId = 'em-otp-' + genId();
      const subject = `Verification OTP: Unlock "${garden.titleEn}" Core Growth Report`;

      const bodyEn = `Dear Gardener,\n\nCongratulations on completing your active training for the "${garden.titleEn}"!\n\nTo lock in your verified student records and transmit your official "Growth Report & Certificate" via email secure pipelines, your custom 6-digit synchronization OTP code has been generated:\n\n: ${otpCode}\n\nPlease copy this synchronization key and enter it inside the secure verification panel in your classroom.\n\nWarmest regards,\nAcademic Registry, Knowledge Garden Base`;

      const bodyAr = `عزيزي البستاني التقني،\n\nتهانينا الحارة على إتمام تدريبك العملي ورعايتك لبذور حديقة: "${garden.titleAr}"!\n\nلتأكيد درجاتك الأكاديمية ونقل "تقرير النمو وشهادة التخرج الرقمية" الخاصة بك عبر بريدك الإلكتروني، قمنا بتوليد الرمز السري وحيد الاستعمال (OTP) الخاص بك الآتي:\n\n: ${otpCode}\n\nيرجى نسخ هذا الرمز السري السداسي وإدخاله في بوابة التحقق داخل فصل الحديقة.\n\nتقبلوا فائق الاحترام،\nالسجل الأكاديمي، قاعدة حديقة المعرفة`;

      const bodyTr = `Sevgili Bilim ve Teknoloji Bahçıvanı,\n\n"${garden.titleTr}" bahçesindeki tüm tohumları başarıyla büyüttüğünüz ve mezuniyet koşullarını sağladığınız için tebrik ederiz!\n\nGelişim Raporunuzu ve resmi Başarı Sertifikanızı dijital kütüğümüze tescil etmek için tek kullanımlık 6 haneli doğrulama (OTP) kodunuz oluşturulmuştur:\n\n: ${otpCode}\n\nLütfen bu güvenlik kodunu kopyalayıp sınıfta yer alan doğrulama paneline giriniz.\n\nEn iyi dileklerimizle,\nBilgi Bahçesi Akademik Sicil Birimi`;

      db.emails.push({
        id: emailId,
        userId: user.id,
        toEmail: user.email,
        subject,
        bodyEn,
        bodyAr,
        bodyTr,
        otpCode,
        isRead: false,
        timestamp: new Date().toISOString(),
        isGrowthReport: false,
        gardenId
      });

      pool.query(
        'INSERT INTO emails (id, userId, toEmail, subject, bodyEn, bodyAr, bodyTr, otpCode, isRead, timestamp, isGrowthReport, isWelcome, gardenId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [emailId, user.id, user.email, subject, bodyEn, bodyAr, bodyTr, otpCode, false, mysqlNow(), false, false, gardenId]
      ).catch(err => console.warn('[PG] OTP email insert failed:', err));

      let smtpSent = false;
      let smtpMethodUsed = 'None (Mock Inbox Only)';
      try {
        const mailRes = await sendOTPEmail(user.email, otpCode, subject, bodyEn);
        if (mailRes.success) {
          smtpSent = true;
          smtpMethodUsed = `NodeMailer (Direct SMTP dispatch successful with message ID: ${mailRes.messageId})`;
        } else {
          smtpMethodUsed = `Mock Inbox Fallback (SMTP credentials unconfigured: ${mailRes.reason})`;
        }
      } catch (mailErr) {
        console.error('[REPORT SMTP ERR] safe SMTP trigger failed:', mailErr);
        smtpMethodUsed = `Mock Inbox Fallback (Exception: ${mailErr.message || mailErr})`;
      }

      return res.json({
        success: true,
        message: 'Security verification code has been dispatched.'
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate verification OTP code.' });
    }
  });

  // Verify OTP and generate Growth Report
  app.post('/api/reports/verify-otp', async (req, res) => {
    try {
      const { sessionId, gardenId, otpCode, lang = 'en' } = req.body;
      if (!sessionId || !gardenId || !otpCode) {
        return res.status(400).json({ error: 'Missing parameters.' });
      }
      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) return res.status(403).json({ error: 'Invalid session.' });

      const garden = db.gardens.find(g => g.id === gardenId);
      if (!garden) return res.status(404).json({ error: 'Garden not found.' });

      const verification = db.otp_verifications.find(o =>
        o.userId === user.id &&
        o.gardenId === gardenId &&
        o.otpCode === otpCode &&
        !o.isUsed
      );

      if (!verification) {
        return res.status(400).json({ error: 'Invalid verification OTP code. Please trace it in your Inbox.' });
      }

      verification.isUsed = true;

      const seeds = db.seeds.filter(s => s.gardenId === gardenId);
      let totalDurationSeconds = 0;
      seeds.forEach(s => {
        totalDurationSeconds += parseDurationToSeconds(s.duration);
      });

      const studyMinutes = Math.floor(totalDurationSeconds / 60);
      const studyHours = (studyMinutes / 60).toFixed(1);

      const skillsAcquiredEn = 'Curriculum Skills & Distributed System Management';
      const skillsAcquiredAr = 'تحصيل المهارات البرمجية والتحكم في بنى الخدمات الموزعة';
      const skillsAcquiredTr = 'Müfredat Becerileri ve Dağıtık Sistem Yönetimi';

      const aiAdviceEn = 'We recommend continuous learning to ensure professional growth.';
      const aiAdviceAr = 'نوصي بمتابعة التعلم المستمر لضمان التطور.';
      const aiAdviceTr = 'Gelişimi sağlamak için sürekli öğrenmeye devam etmenizi öneriyoruz.';

      const certificateId = 'CERT_' + genId().toUpperCase();
      const verifiedDate = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      const reportId = 'report_' + genId();

      const userName = user.name || user.email.split('@')[0];

      const emailSubject = `Official Growth Report & Graduate Certificate: ${garden.titleEn} Completed!`;

      const bodyEn = `Dear Graduate,\n\nWe are extremely proud to officially issue your "Digital Growth Report & Certificate of Cultivation" for completing the course "${garden.titleEn}"! Your verification records are digitally signed.\n\n=======================================================\n                   DIGITAL GROWTH REPORT\n=======================================================\n- Completed Garden: ${garden.titleEn}\n- Category: ${garden.category}\n- Total Seeds Cultivated: ${seeds.length} of ${seeds.length}\n- Total Learning Time: ${studyHours} Hours [${studyMinutes} Minutes]\n- Acquired Capabilities:\n  ${skillsAcquiredEn}\n\nAI KNOWLEDGE AI ASSESSMENT REPORT:\n${aiAdviceEn}\n\n=======================================================\n                CERTIFICATE OF CULTIVATION\n=======================================================\nThis certifies that Student Alumnus:\n  :  ${userName} \nhas fully cultivated and bloomed all knowledge seeds in the\n  "${garden.titleEn}"\n\n- Certification Record Key: ${certificateId}\n- Verification Timestamp: ${new Date().toISOString()}\n- Academic Authenticator Status: SECURE SYSTEM VERIFIED\n\nWe celebrate your academic persistence under the Knowledge Garden Base guidelines! Thank you for growing with us.\n\nWith high regard,\nAcademic Dean, Knowledge Garden Base`;

      const bodyAr = `عزيزي المتخرج المعتمد ومزارع المعرفة،\n\nنحن فخورون للغاية بأن نصدر لك رسمياً "تقرير النمو الرقمي وشهادة التخرج المعتمدة" لإتمامك حديقة: "${garden.titleAr}"! مستنداتك الرقمية مسجلة وموقعة إلكترونياً.\n\n=======================================================\n                   تقرير النمو الرقمي العصبوني\n=======================================================\n- اسم الحديقة: ${garden.titleAr}\n- التخصص المعرفي: ${garden.category}\n- بذور المعرفة المزروعة: ${seeds.length} من أصل ${seeds.length}\n- الوقت الإجمالي للدراسة: ${studyHours} ساعة (أي ${studyMinutes} دقيقة)\n- القدرات والمهارات المكتسبة:\n  ${skillsAcquiredAr}\n\nAI تقييم الذكاء الاصطناعي للنمو:\n${aiAdviceAr}\n\n=======================================================\n                شهادة رعاية وتنمية البذور المعرفية\n=======================================================\nتشهد أكاديمية حديقة المعرفة بأن الباحث المجد:\n  :  ${userName} \nقد أتم زراعة ورعاية وتفتيح كامل بذور حديقة المعرفة البرمجية:\n  "${garden.titleAr}"\n\n- مفتاح الشهادة الموثقة: ${certificateId}\n- تاريخ التوثيق المعتمد: ${verifiedDate}\n- الحالة: نظام أمان موثق (SECURE VERIFIED)\n\nنحن نحتفل بمثابرتك الأكاديمية والعملية الاستثنائية! استمر في التطور والنمو.\n\nتقبلوا فائق الاحترام،\nعميد التسجيل، قاعدة حديقة المعرفة`;

      const bodyTr = `Sevgili Mezunumuz,\n\n"${garden.titleTr}" bahçesindeki üstün başarınızın bir nişanesi olarak "Dijital Gelişim Raporu & Başarı Sertifikanızı" resmi olarak düzenlemiş bulunmaktayız! Mezuniyet kaydınız sistem kütüğümüze dijital olarak işlenmiştir.\n\n=======================================================\n                   DIJITAL GELİŞİM RAPORU\n=======================================================\n- Gelişim Bahçesi: ${garden.titleTr}\n- Branş: ${garden.category}\n- Tamamlanan Tohum Sayısı: ${seeds.length} / ${seeds.length}\n- Toplam Çalışma Süresi: ${studyHours} Saat (${studyMinutes} Dakika)\n- Kazanılan Nitelikler:\n  ${skillsAcquiredTr}\n\nAI YAPAY ZEKA GELİŞİM TAVSİYESİ:\n${aiAdviceTr}\n\n=======================================================\n                BİLGİ GELİŞİM VE BAŞARI SERTİFİKASI\n=======================================================\nİşbu dijital başarı sertifikası,\n  :  ${userName} \nadresli öğrencimizin,\n  "${garden.titleTr}"\nbahçesinde yer alan tüm bilgi ünitelerini başarıyla yetiştirdiğini tescil eder.\n\n- Sertifika Kimlik Kodu: ${certificateId}\n- Doğrulama Zamanı: ${new Date().toISOString()}\n- Durum: GÜVENLİ SİSTEM ONAYLI\n\nBilgi Bahçemizin dijital toprağında göstermiş olduğunuz azim ve başarıdan ötürü gurur duyuyoruz! Gelişmeye devam edin.\n\nAkademik Kurul, Bilgi Bahçesi Ekibi`;

      db.emails.push({
        id: reportId,
        userId: user.id,
        toEmail: user.email,
        subject: emailSubject,
        bodyEn,
        bodyAr,
        bodyTr,
        isRead: false,
        timestamp: new Date().toISOString(),
        isGrowthReport: true,
        gardenId
      });

      pool.query('UPDATE otp_verifications SET isUsed = ? WHERE id = ?', [true, verification.id])
        .catch(err => console.warn('[PG] OTP update failed:', err));
      pool.query(
        'INSERT INTO emails (id, userId, toEmail, subject, bodyEn, bodyAr, bodyTr, isRead, timestamp, isGrowthReport, isWelcome, gardenId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [reportId, user.id, user.email, emailSubject, bodyEn, bodyAr, bodyTr, false, mysqlNow(), true, false, gardenId]
      ).catch(err => console.warn('[PG] Report email insert failed:', err));

      const reportPayload = {
        id: reportId,
        gardenId,
        gardenTitle: lang === 'ar' ? garden.titleAr : lang === 'tr' ? garden.titleTr : garden.titleEn,
        toEmail: user.email,
        userName,
        completedAt: verifiedDate,
        totalHours: studyHours,
        totalMinutes: studyMinutes,
        skillsAcquired: lang === 'ar' ? skillsAcquiredAr : lang === 'tr' ? skillsAcquiredTr : skillsAcquiredEn,
        aiAdvice: lang === 'ar' ? aiAdviceAr : lang === 'tr' ? aiAdviceTr : aiAdviceEn,
        certificateId,
        body: lang === 'ar' ? bodyAr : lang === 'tr' ? bodyTr : bodyEn
      };

      return res.json({
        success: true,
        message: 'Your custom summary Growth Report has been compiled and emailed.',
        report: reportPayload
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to verify verification code.' });
    }
  });

  // Payment Checkout
  app.post('/api/payments/checkout', async (req, res) => {
    try {
      const { sessionId, gardenId, country, paymentMethod, paymentScreenshot } = req.body;
      if (!sessionId || !gardenId || !country || !paymentMethod) {
        return res.status(400).json({ error: 'Invalid payload.' });
      }

      const db = readDB();

      let user;
      try {
        const [sqlUsers] = await pool.query('SELECT * FROM users WHERE current_session_id = ?', [sessionId]);
        user = sqlUsers && sqlUsers.length > 0 ? sqlUsers[0] : null;
      } catch (sqlErr) {
        console.warn('[PAYMENT] MySQL session lookup failed, falling back to JSON db');
      }
      if (!user) {
        user = db.users.find(u => u.current_session_id === sessionId);
      }
      if (!user) return res.status(403).json({ error: 'Session expired.' });

      let garden = db.gardens.find(g => g.id === gardenId);
      if (!garden) {
        try {
          const [sqlGardens] = await pool.query('SELECT * FROM gardens WHERE id = ?', [gardenId]);
          garden = sqlGardens && sqlGardens.length > 0 ? sqlGardens[0] : null;
        } catch (sqlErr) {
          console.warn('[PAYMENT] MySQL garden lookup failed');
        }
      }
      if (!garden) return res.status(404).json({ error: 'Garden not found.' });

      const currency = country === 'eg' ? 'EGP' : 'TRY';
      const amount = country === 'eg' ? garden.priceEGP : garden.priceTRY;
      const gateway = 'instapay';

      const transactionId = 'TXN_' + country.toUpperCase() + '_' + genId().toUpperCase();

      const now = mysqlNow();
      try {
        await pool.query(
          'INSERT INTO payments (id, userId, userEmail, gardenId, currency, amount, gateway, paymentMethod, screenshot, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [transactionId, user.id, user.email, gardenId, currency, amount, gateway, paymentMethod, paymentScreenshot || null, 'pending', now]
        );
      } catch (sqlErr) {
        console.warn('SQL Payment Logging failed, syncing with JSON DB only.');
      }

      db.payments.push({
        id: transactionId,
        userId: user.id,
        userEmail: user.email,
        gardenId: garden.id,
        currency,
        amount,
        gateway,
        paymentMethod,
        screenshot: paymentScreenshot,
        status: 'pending',
        timestamp: now
      });
      writeDB(db);

      console.log(`[PAYMENT] Sandbox Checkout initiated for ${user.email} -> ${amount} ${currency} via ${paymentMethod}`);

      return res.json({
        success: true,
        transactionId,
        currency,
        amount,
        gateway,
        paymentMethod,
        message: 'Payment submitted! Your access will be activated once our registry verifies the transfer.'
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Checkout system offline.' });
    }
  });

  // Webhooks simulation
  app.post('/api/payments/webhook/:gateway', (req, res) => {
    const { gateway } = req.params;
    console.log(`[WEBHOOK] Received payment notification for gateway: ${gateway}`, req.body);
    return res.json({ success: true, received: true });
  });

  // --- Admin Authentication ---
  const adminTokens = new Map();

  app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin123';
    if (username !== adminUser || password !== adminPass) {
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }
    const token = 'adm_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    adminTokens.set(token, Date.now());
    setTimeout(() => adminTokens.delete(token), 24 * 60 * 60 * 1000);
    return res.json({ success: true, token });
  });

  app.use('/api/admin', (req, res, next) => {
    if (req.path === '/login') return next();
    const token = req.headers['x-admin-token'];
    if (!token || !adminTokens.has(token)) {
      return res.status(401).json({ error: 'Admin access denied. Please log in.' });
    }
    adminTokens.set(token, Date.now());
    next();
  });

  // Admin: Approve payment
  app.post('/api/admin/payments/approve', async (req, res) => {
    try {
      const { transactionId } = req.body;
      const db = readDB();

      let payment = db.payments.find(p => p.id === transactionId);
      try {
        const [sqlPayments] = await pool.query('SELECT * FROM payments WHERE id = ?', [transactionId]);
        if (sqlPayments && sqlPayments.length > 0) payment = sqlPayments[0];
      } catch {}

      if (!payment) return res.status(404).json({ error: 'Payment record not found' });
      if (payment.status === 'rejected') return res.status(400).json({ error: 'Cannot approve a rejected payment' });
      if (payment.status === 'approved') return res.status(400).json({ error: 'Already approved' });

      const userId = payment.userId;
      const gardenId = payment.gardenId;

      pool.query('UPDATE payments SET status = ? WHERE id = ?', ['approved', transactionId]).catch(() => {});
      const jsonPayment = db.payments.find(p => p.id === transactionId);
      if (jsonPayment) jsonPayment.status = 'approved';

      pool.query(
        'UPDATE users SET paidGardens = JSON_ARRAY_APPEND(COALESCE(paidGardens, \'[]\'), \'$\', ?) WHERE id = ? AND NOT JSON_CONTAINS(COALESCE(paidGardens, \'[]\'), ?, \'$\')',
        [gardenId, userId, JSON.stringify(gardenId)]
      ).catch(() => {});
      const user = db.users.find(u => u.id === userId);
      if (user) {
        if (!user.paidGardens) user.paidGardens = [];
        if (!user.paidGardens.includes(gardenId)) {
          user.paidGardens.push(gardenId);
        }
      }

      if (userId) {
        const userEmail = user ? user.email : payment.userEmail;
        const garden = db.gardens.find(g => g.id === payment.gardenId);
        const gNameEn = garden ? garden.titleEn : 'Garden';
        const gNameAr = garden ? garden.titleAr : 'الحديقة';
        const gNameTr = garden ? garden.titleTr : 'Bahçe';

        db.emails.push({
          id: 'em-pay-ok-' + genId(),
          userId: userId,
          toEmail: userEmail,
          subject: 'Payment Approved! Access Granted',
          bodyEn: `Your payment for "${gNameEn}" has been verified. Full classroom access is now unlocked!`,
          bodyAr: `تم توثيق دفعتك لـ "${gNameAr}". تم فتح الوصول الكامل لقاعة الدراسة الآن!`,
          bodyTr: `"${gNameTr}" ödemeniz doğrulandı. Sınıf erişimi artık tamamen açıldı!`,
          isRead: false,
          timestamp: new Date().toISOString(),
          isGrowthReport: false,
          isWelcome: false
        });

        sendEmail(userEmail, 'Payment Approved! Access Granted',
          `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px;border:1px solid rgba(168,85,247,0.2);border-radius:20px;background-color:#0c101d;color:#f3f4f6;">
            <h1 style="color:#c084fc;text-align:center;">Knowledge Garden</h1>
            <p style="font-size:15px;color:#e5e7eb;">Dear Gardener,</p>
            <p style="font-size:14px;color:#9ca3af;">Your payment for <strong>"${gNameEn}"</strong> has been verified. Full classroom access is now unlocked!</p>
            <p style="font-size:10px;text-align:center;color:#6b7280;margin-top:35px;">This is an automated transmission from the Knowledge Garden Academic Registry.</p>
          </div>`
        );
      }

      writeDB(db);
      logAdminAction('PAYMENT_APPROVE', { transactionId, userId, gardenId });
      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal approval logic error.' });
    }
  });

  // Admin: Reject payment
  app.post('/api/admin/payments/reject', async (req, res) => {
    try {
      const { transactionId, reason } = req.body;
      if (!transactionId || !reason) {
        return res.status(400).json({ error: 'Transaction ID and reason are required.' });
      }

      const db = readDB();

      let payment = db.payments.find(p => p.id === transactionId);
      try {
        const [sqlPayments] = await pool.query('SELECT * FROM payments WHERE id = ?', [transactionId]);
        if (sqlPayments && sqlPayments.length > 0) payment = sqlPayments[0];
      } catch {}

      if (!payment) return res.status(404).json({ error: 'Payment record not found' });
      if (payment.status === 'approved') return res.status(400).json({ error: 'Cannot reject an already approved payment' });
      if (payment.status === 'rejected') return res.status(400).json({ error: 'Payment is already rejected' });

      const userId = payment.userId;

      pool.query('UPDATE payments SET status = ? WHERE id = ?', ['rejected', transactionId]).catch(() => {});
      pool.query(
        'UPDATE users SET paidGardens = JSON_REMOVE(COALESCE(paidGardens, \'[]\'), JSON_UNQUOTE(JSON_SEARCH(COALESCE(paidGardens, \'[]\'), \'one\', ?))) WHERE id = ? AND JSON_CONTAINS(COALESCE(paidGardens, \'[]\'), ?, \'$\')',
        [payment.gardenId, userId, JSON.stringify(payment.gardenId)]
      ).catch(() => {});
      const jsonPayment = db.payments.find(p => p.id === transactionId);
      if (jsonPayment) jsonPayment.status = 'rejected';
      const jsonUser = db.users.find(u => u.id === userId);
      if (jsonUser && jsonUser.paidGardens) {
        jsonUser.paidGardens = jsonUser.paidGardens.filter(g => g !== payment.gardenId);
      }

      if (userId) {
        const garden = db.gardens.find(g => g.id === payment.gardenId);
        const gNameEn = garden ? garden.titleEn : 'Garden';
        const gNameAr = garden ? garden.titleAr : 'الحديقة';
        const gNameTr = garden ? garden.titleTr : 'Bahçe';

        let userEmail = payment.userEmail;
        try {
          const [rows] = await pool.query('SELECT email FROM users WHERE id = ?', [userId]);
          if (rows && rows.length > 0) userEmail = rows[0].email;
        } catch {}

        db.emails.push({
          id: 'em-pay-fail-' + genId(),
          userId: userId,
          toEmail: userEmail,
          subject: 'Payment Rejected - Action Required',
          bodyEn: `Your payment for "${gNameEn}" was rejected. Reason: ${reason}. Please verify your transfer details or contact support.`,
          bodyAr: `تم رفض دفعتك لـ "${gNameAr}". السبب: ${reason}. يرجى التحقق من تفاصيل التحويل أو التواصل مع الدعم.`,
          bodyTr: `"${gNameTr}" ödemeniz reddedildi. Sebep: ${reason}. Lütfen transfer detaylarını kontrol edin veya destekle iletişime geçin.`,
          isRead: false,
          timestamp: new Date().toISOString(),
          isGrowthReport: false,
          isWelcome: false
        });

        sendEmail(userEmail, 'Payment Rejected - Action Required',
          `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px;border:1px solid rgba(168,85,247,0.2);border-radius:20px;background-color:#0c101d;color:#f3f4f6;">
            <h1 style="color:#c084fc;text-align:center;">Knowledge Garden</h1>
            <p style="font-size:15px;color:#e5e7eb;">Dear Gardener,</p>
            <p style="font-size:14px;color:#9ca3af;">Your payment for <strong>"${gNameEn}"</strong> was rejected.</p>
            <p style="font-size:14px;color:#ef4444;">Reason: ${reason}</p>
            <p style="font-size:13px;color:#9ca3af;">Please verify your transfer details or contact support.</p>
            <p style="font-size:10px;text-align:center;color:#6b7280;margin-top:35px;">This is an automated transmission from the Knowledge Garden Academic Registry.</p>
          </div>`
        );
      }

      writeDB(db);
      logAdminAction('PAYMENT_REJECT', { transactionId, userId, reason });
      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Rejection system failure.' });
    }
  });

  // Analytics
  app.get('/api/admin/analytics', (req, res) => {
    const db = readDB();
    
    const approvedPayments = db.payments.filter(p => p.status === 'approved');
    let totalEGP = 0;
    let totalTRY = 0;

    approvedPayments.forEach(p => {
      if (p.currency === 'EGP') {
        totalEGP += p.amount;
      } else {
        totalTRY += p.amount;
      }
    });

    const activeConcurrentUsers = db.users.filter(u => u.current_session_id && u.current_session_id !== '').length;

    return res.json({
      success: true,
      totalEGP,
      totalTRY,
      totalUsers: db.users.length,
      activeConcurrentUsers,
      totalPayments: approvedPayments.length
    });
  });

  // Admin CMS: Garden
  app.post('/api/admin/cms/gardens', (req, res) => {
    const { id, titleEn, titleAr, titleTr, descriptionEn, descriptionAr, descriptionTr, category, priceEGP, priceTRY, image } = req.body;
    
    const db = readDB();
    if (id) {
      const idx = db.gardens.findIndex(g => g.id === id);
      if (idx !== -1) {
        db.gardens[idx] = {
          ...db.gardens[idx],
          titleEn, titleAr, titleTr,
          descriptionEn, descriptionAr, descriptionTr,
          category,
          priceEGP: Number(priceEGP),
          priceTRY: Number(priceTRY),
          image: image || db.gardens[idx].image
        };
      }
    } else {
      const newG = {
        id: 'g_' + genId(),
        titleEn, titleAr, titleTr,
        descriptionEn, descriptionAr, descriptionTr,
        category,
        priceEGP: Number(priceEGP || 1000),
        priceTRY: Number(priceTRY || 500),
        rating: 5.0,
        image: image || ''
      };
      db.gardens.push(newG);
    }
    
    const gardenData = id
      ? db.gardens.find(g => g.id === id)
      : db.gardens[db.gardens.length - 1];
    if (gardenData) {
      const gId = gardenData.id;
      pool.query(
        `INSERT INTO gardens (id, titleEn, titleAr, titleTr, descriptionEn, descriptionAr, descriptionTr, category, priceEGP, priceTRY, rating, image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET titleEn=EXCLUDED.titleEn, titleAr=EXCLUDED.titleAr, titleTr=EXCLUDED.titleTr,
           descriptionEn=EXCLUDED.descriptionEn, descriptionAr=EXCLUDED.descriptionAr, descriptionTr=EXCLUDED.descriptionTr,
           category=EXCLUDED.category, priceEGP=EXCLUDED.priceEGP, priceTRY=EXCLUDED.priceTRY, image=EXCLUDED.image`,
        [gId, titleEn, titleAr, titleTr, descriptionEn, descriptionAr, descriptionTr, category, Number(priceEGP), Number(priceTRY), 5.0, image || '']
      ).catch(err => console.warn('[PostgreSQL] Garden upsert failed:', err));
    }
    logAdminAction('CMS_GARDEN_UPDATE', { id, titleEn, category });
    return res.json({ success: true });
  });

  // Admin CMS: Seed
  app.post('/api/admin/cms/seeds', (req, res) => {
    const { id, gardenId, titleEn, titleAr, titleTr, duration, videoUrl, tags, section, sortOrder } = req.body;
    
    let finalTags;
    if (tags) {
      if (Array.isArray(tags)) {
        finalTags = tags.map(t => t.trim()).filter(Boolean);
      } else if (typeof tags === 'string') {
        finalTags = tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    const db = readDB();
    if (id) {
       const idx = db.seeds.findIndex(s => s.id === id);
       if (idx !== -1) {
         db.seeds[idx] = {
           ...db.seeds[idx],
           gardenId,
           titleEn, titleAr, titleTr,
           duration,
           videoUrl,
           section: section || '',
           sortOrder: sortOrder ?? 0,
           tags: finalTags
         };
       }
    } else {
       const newS = {
         id: 's_' + genId(),
         gardenId,
         titleEn, titleAr, titleTr,
         duration: duration || '30:00',
         videoUrl: videoUrl || 'bunny_mock_default',
         section: section || '',
         sortOrder: sortOrder ?? 0,
         status: 'bloomed',
         tags: finalTags
       };
       db.seeds.push(newS);
    }

    const seedData = id ? db.seeds.find(s => s.id === id) : db.seeds[db.seeds.length - 1];
    if (seedData) {
      const sId = seedData.id;
      pool.query(
        `INSERT INTO seeds (id, gardenId, titleEn, titleAr, titleTr, duration, videoUrl, status, section, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET gardenId=EXCLUDED.gardenId, titleEn=EXCLUDED.titleEn, titleAr=EXCLUDED.titleAr,
           titleTr=EXCLUDED.titleTr, duration=EXCLUDED.duration, videoUrl=EXCLUDED.videoUrl, section=EXCLUDED.section, sortOrder=EXCLUDED.sortOrder`,
        [sId, gardenId, titleEn, titleAr, titleTr, duration, videoUrl || 'bunny_mock_default', 'bloomed', section || '', sortOrder ?? 0]
      ).catch(err => console.warn('[PostgreSQL] Seed upsert failed:', err));
      if (finalTags) {
        pool.query('DELETE FROM seed_tags WHERE seedId = ?', [sId]).catch(() => {});
        for (const tag of finalTags) {
          pool.query('INSERT INTO seed_tags (seedId, tag) VALUES (?, ?)', [sId, tag]).catch(() => {});
        }
      }
    }
    logAdminAction('CMS_SEED_UPDATE', { id, gardenId, titleEn });
    return res.json({ success: true });
  });

  // Admin CMS: Bulk Create Seeds
  app.post('/api/admin/cms/seeds/bulk', (req, res) => {
    const { gardenId, seedsList } = req.body;
    if (!gardenId) {
      return res.status(400).json({ error: 'gardenId is required' });
    }
    if (!Array.isArray(seedsList)) {
      return res.status(400).json({ error: 'seedsList must be an array' });
    }

    const db = readDB();
    const createdSeeds = [];

    for (const item of seedsList.slice(0, 50)) {
      const { titleEn, titleAr, titleTr, duration, videoUrl, tags, section, sortOrder } = item;
      
      let finalTags;
      if (tags) {
        if (Array.isArray(tags)) {
          finalTags = tags.map(t => t.trim()).filter(Boolean);
        } else if (typeof tags === 'string') {
          finalTags = tags.split(',').map(t => t.trim()).filter(Boolean);
        }
      }

      const newS = {
        id: 's_' + genId(),
        gardenId,
        titleEn: titleEn || 'Untitled Lecture',
        titleAr: titleAr || titleEn || 'درس غير معنون',
        titleTr: titleTr || titleEn || 'Başlıksız Ders',
        duration: duration || '15:20',
        videoUrl: videoUrl || 'bunny_mock_uploaded',
        section: section || '',
        sortOrder: sortOrder ?? 0,
        status: 'bloomed',
        tags: finalTags
      };

      db.seeds.push(newS);
      createdSeeds.push(newS);
    }

    for (const seed of createdSeeds) {
      pool.query(
        'INSERT INTO seeds (id, gardenId, titleEn, titleAr, titleTr, duration, videoUrl, status, section, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [seed.id, gardenId, seed.titleEn, seed.titleAr, seed.titleTr, seed.duration, seed.videoUrl, 'bloomed', seed.section, seed.sortOrder]
      ).catch(err => console.warn('[PG] Bulk seed insert failed:', err));
      if (seed.tags) {
        for (const tag of seed.tags) {
          pool.query('INSERT INTO seed_tags (seedId, tag) VALUES (?, ?)', [seed.id, tag]).catch(() => {});
        }
      }
    }
    logAdminAction('CMS_SEED_BULK_UPLOAD', { gardenId, count: createdSeeds.length });
    return res.json({ success: true, count: createdSeeds.length });
  });

  // Admin CMS: Delete
  app.post('/api/admin/cms/delete', (req, res) => {
    const { type, id } = req.body;
    const db = readDB();

    if (type === 'garden') {
      db.gardens = db.gardens.filter(g => g.id !== id);
      db.seeds = db.seeds.filter(s => s.gardenId !== id);
    } else {
      db.seeds = db.seeds.filter(s => s.id !== id);
    }

    if (type === 'garden') {
      pool.query('DELETE FROM seeds WHERE gardenId = ?', [id]).catch(() => {});
      pool.query('DELETE FROM gardens WHERE id = ?', [id]).catch(() => {});
    } else {
      pool.query('DELETE FROM seeds WHERE id = ?', [id]).catch(() => {});
    }
    logAdminAction('CMS_ENTITY_DELETE', { type, id });
    return res.json({ success: true });
  });

  // Admin: Get all users
  app.get('/api/admin/users', (req, res) => {
    const db = readDB();
    return res.json(db.users);
  });

  // Admin: Toggle user payment state
  app.post('/api/admin/users/toggle-paid', (req, res) => {
    const { userId, paidGardens } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.id === userId);
    if (user) {
      user.paidGardens = paidGardens || [];
      writeDB(db);
      pool.query('UPDATE users SET paidGardens = ? WHERE id = ?', [JSON.stringify(paidGardens || []), userId]).catch(() => {});
      logAdminAction('USER_ACCESS_TOGGLE', { userId, paidGardens });
      return res.json({ success: true });
    }
    return res.status(404).json({ error: 'User not found' });
  });

  // Admin: SMTP status
  app.get('/api/admin/smtp/status', (req, res) => {
    return res.json({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      from: process.env.SMTP_FROM,
      isConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
    });
  });

  // Admin: Send test email
  app.post('/api/admin/smtp/test', async (req, res) => {
    try {
      const { testEmail } = req.body;
      if (!testEmail) {
        return res.status(400).json({ error: 'Test recipient email is required.' });
      }

      const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
      const testSubject = "Nodemailer Testing: Knowledge Garden Pipeline Active!";
      const testBody = "Hello Admin!\n\nThis is a real-time system delivery diagnostics message dispatched to test the live NodeMailer SMTP node pipeline. If you are reading this email, your configuration is 100% correct and ready for production OTP dispatch!";

      const result = await sendOTPEmail(testEmail, testOtp, testSubject, testBody);
      if (result.success) {
        return res.json({ success: true, messageId: result.messageId });
      } else {
        return res.status(500).json({ error: result.message || 'SMTP delivery failed. Check credentials.' });
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message || 'Nodemailer test crash' });
    }
  });

  // Admin: Answer student question
  app.post('/api/admin/queries/answer', (req, res) => {
    const { queryId, text } = req.body;
    if (!queryId || !text) {
      return res.status(400).json({ error: 'Params required.' });
    }

    const db = readDB();
    const query = db.queries.find(q => q.id === queryId);
    if (!query) {
      return res.status(404).json({ error: 'Query thread not found.' });
    }

    query.replies.push({
      author: 'System Admin',
      text,
      timestamp: new Date().toISOString()
    });

    const replyId = 'r_' + genId();
    const replyTimestamp = mysqlNow();
    pool.query(
      'INSERT INTO query_replies (id, queryId, author, text, timestamp) VALUES (?, ?, ?, ?, ?)',
      [replyId, queryId, 'System Admin', text, replyTimestamp]
    ).catch(err => console.warn('[PG] Reply insert failed:', err));
    logAdminAction('QUERY_ANSWERED', { queryId });
    return res.json({ success: true, query });
  });

  // Admin: Get all payments
  app.get('/api/admin/payments', (req, res) => {
    const db = readDB();
    return res.json(db.payments);
  });

  // Admin: Get all queries
  app.get('/api/admin/queries', (req, res) => {
    const db = readDB();
    return res.json(db.queries);
  });

  // Admin: Get all contacts
  app.get('/api/admin/contacts', (req, res) => {
    const db = readDB();
    return res.json(db.contacts || []);
  });

  // Admin: Mark contact as read
  app.post('/api/admin/contacts/read', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Contact ID required.' });
    const db = readDB();
    const contact = (db.contacts || []).find(c => c.id === id);
    if (contact) {
      contact.status = 'read';
      writeDB(db);
      pool.query('UPDATE contacts SET status = ? WHERE id = ?', ['read', id])
        .catch(err => console.warn('[PG] Contact update failed:', err));
    }
    return res.json({ success: true });
  });

  // Admin: Delete contact
  app.post('/api/admin/contacts/delete', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Contact ID required.' });
    const db = readDB();
    db.contacts = (db.contacts || []).filter(c => c.id !== id);
    writeDB(db);
    pool.query('DELETE FROM contacts WHERE id = ?', [id])
      .catch(err => console.warn('[PG] Contact delete failed:', err));
    return res.json({ success: true });
  });

  // Admin: Get audit logs
  app.get('/api/admin/audit-logs', (req, res) => {
    const logFile = path.join(process.cwd(), 'logs', 'admin_audit.log');
    fs.readFile(logFile, 'utf-8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          return res.status(200).json({ logs: '', message: 'No audit logs found yet.' });
        }
        console.error('[AUDIT LOG] Failed to read admin_audit.log:', err);
        return res.status(500).json({ error: 'Failed to read audit logs.' });
      }
      return res.json({ logs: data });
    });
  });

  // Get quiz for frontend QuizReview
  app.get('/api/quiz', async (req, res) => {
    try {
      const { seedId } = req.query;
      if (!seedId) return res.status(400).json({ error: 'seedId is required.' });
      const db = readDB();
      const questions = db.quiz_questions.filter(q => q.seedId === seedId);
      return res.json({ success: true, questions });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load quiz.' });
    }
  });

  // Get quiz questions
  app.get('/api/quiz_questions', async (req, res) => {
    try {
      const { seedId } = req.query;
      const db = readDB();
      const map = new Map();
      (db.quiz_questions || []).forEach(q => map.set(q.id, q));
      try {
        let sql = 'SELECT * FROM quiz_questions';
        const params = [];
        if (seedId) { sql += ' WHERE seedId = ?'; params.push(seedId); }
        const [rows] = await pool.query(sql, params);
        rows.forEach(r => {
          if (!map.has(r.id)) {
            r.optionsEn = typeof r.optionsEn === 'string' ? JSON.parse(r.optionsEn) : r.optionsEn;
            r.optionsAr = typeof r.optionsAr === 'string' ? JSON.parse(r.optionsAr) : r.optionsAr;
            r.optionsTr = typeof r.optionsTr === 'string' ? JSON.parse(r.optionsTr) : r.optionsTr;
            map.set(r.id, r);
          }
        });
      } catch {}
      let results = [...map.values()];
      if (seedId) results = results.filter(q => q.seedId === seedId);
      return res.json(results);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch quiz questions' });
    }
  });

  // Admin CMS: Quiz questions
  app.post('/api/admin/quiz_questions', (req, res) => {
    try {
      const { id, seedId, timestamp, questionEn, questionAr, questionTr, optionsEn, optionsAr, optionsTr, correctIndex } = req.body;
      if (!seedId || timestamp === undefined || !questionEn) {
        return res.status(400).json({ error: 'Seed ID, timestamp, and English question are required.' });
      }

      const db = readDB();
      const qId = id || 'qq_' + genId();
      const questionData = {
        id: qId,
        seedId,
        timestamp: Number(timestamp),
        questionEn,
        questionAr: questionAr || questionEn,
        questionTr: questionTr || questionEn,
        optionsEn: Array.isArray(optionsEn) ? optionsEn : [''],
        optionsAr: Array.isArray(optionsAr) ? optionsAr : [''],
        optionsTr: Array.isArray(optionsTr) ? optionsTr : [''],
        correctIndex: Number(correctIndex !== undefined ? correctIndex : 0)
      };

      if (id) {
        const idx = db.quiz_questions.findIndex(q => q.id === id);
        if (idx !== -1) {
          db.quiz_questions[idx] = questionData;
        } else {
          db.quiz_questions.push(questionData);
        }
      } else {
        db.quiz_questions.push(questionData);
      }

      writeDB(db);

      pool.query(
        `INSERT INTO quiz_questions (id, seedId, timestamp, questionEn, questionAr, questionTr, optionsEn, optionsAr, optionsTr, correctIndex)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET seedId=EXCLUDED.seedId, timestamp=EXCLUDED.timestamp, questionEn=EXCLUDED.questionEn,
         questionAr=EXCLUDED.questionAr, questionTr=EXCLUDED.questionTr, optionsEn=EXCLUDED.optionsEn,
         optionsAr=EXCLUDED.optionsAr, optionsTr=EXCLUDED.optionsTr, correctIndex=EXCLUDED.correctIndex`,
        [qId, seedId, questionData.timestamp, questionEn, questionData.questionAr, questionData.questionTr,
         JSON.stringify(questionData.optionsEn), JSON.stringify(questionData.optionsAr), JSON.stringify(questionData.optionsTr),
         questionData.correctIndex]
      ).catch(err => console.warn('[PostgreSQL] Quiz question sync failed:', err));

      logAdminAction('QUIZ_QUESTION_UPDATE', { id: questionData.id, seedId });
      return res.json({ success: true, question: questionData });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save quiz question' });
    }
  });

  // Admin: Delete quiz question
  app.post('/api/admin/quiz_questions/delete', (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'ID required' });

      const db = readDB();
      db.quiz_questions = db.quiz_questions.filter(q => q.id !== id);
      db.quiz_answers = db.quiz_answers.filter(a => a.questionId !== id);
      writeDB(db);

      pool.query('DELETE FROM quiz_answers WHERE questionId = ?', [id]).catch(() => {});
      pool.query('DELETE FROM quiz_questions WHERE id = ?', [id]).catch(() => {});

      logAdminAction('QUIZ_QUESTION_DELETE', { id });
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete quiz question' });
    }
  });

  // Submit quiz answer (used by QuizReview frontend)
  app.post('/api/quiz/answer', async (req, res) => {
    try {
      const { seedId, sessionId, questionId, answer } = req.body;
      if (!sessionId || !questionId || answer === undefined) {
        return res.status(400).json({ error: 'Missing parameters' });
      }

      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) return res.status(401).json({ error: 'Unauthorized session' });

      const question = db.quiz_questions.find(q => q.id === questionId);
      if (!question) return res.status(404).json({ error: 'Question not found' });

      const isCorrect = question.correctIndex === Number(answer);
      const now = mysqlNow();

      db.quiz_answers = db.quiz_answers.filter(a => !(a.userId === user.id && a.questionId === questionId));
      const userEmail = user.email || '';
      const userName = user.name || user.email?.split('@')[0] || '';
      db.quiz_answers.push({
        userId: user.id,
        userEmail,
        userName,
        seedId: question.seedId,
        questionId,
        isCorrect,
        timestamp: now
      });

      writeDB(db);

      pool.query(
        'INSERT INTO quiz_answers (userId, userEmail, userName, seedId, questionId, isCorrect, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (userId, seedId, questionId) DO UPDATE SET userEmail=EXCLUDED.userEmail, userName=EXCLUDED.userName, isCorrect=EXCLUDED.isCorrect, timestamp=EXCLUDED.timestamp',
        [user.id, userEmail, userName, question.seedId, questionId, isCorrect, now]
      ).catch(err => console.warn('[PostgreSQL] Quiz answer sync failed:', err));

      return res.json({ correct: isCorrect });
    } catch (err) {
      return res.status(500).json({ error: 'Submission failed' });
    }
  });

  // Submit quiz answer
  app.post('/api/quiz_questions/submit', (req, res) => {
    try {
      const { sessionId, questionId, selectedIndex } = req.body;
      if (!sessionId || !questionId || selectedIndex === undefined) {
        return res.status(400).json({ error: 'Missing parameters' });
      }

      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) return res.status(401).json({ error: 'Unauthorized session' });

      const question = db.quiz_questions.find(q => q.id === questionId);
      if (!question) return res.status(404).json({ error: 'Question not found' });

      const isCorrect = question.correctIndex === Number(selectedIndex);
      const now = mysqlNow();
      
      db.quiz_answers = db.quiz_answers.filter(a => !(a.userId === user.id && a.questionId === questionId));
      const userEmail = user.email || '';
      const userName = user.name || user.email?.split('@')[0] || '';
      db.quiz_answers.push({
        userId: user.id,
        userEmail,
        userName,
        seedId: question.seedId,
        questionId,
        isCorrect,
        timestamp: now
      });

      writeDB(db);

      pool.query(
        'INSERT INTO quiz_answers (userId, userEmail, userName, seedId, questionId, isCorrect, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (userId, seedId, questionId) DO UPDATE SET userEmail=EXCLUDED.userEmail, userName=EXCLUDED.userName, isCorrect=EXCLUDED.isCorrect, timestamp=EXCLUDED.timestamp',
        [user.id, userEmail, userName, question.seedId, questionId, isCorrect, now]
      ).catch(err => console.warn('[PostgreSQL] Quiz answer sync failed:', err));

      return res.json({ success: true, isCorrect, correctIndex: question.correctIndex });
    } catch (err) {
      return res.status(500).json({ error: 'Submission failed' });
    }
  });

  // Get quiz answers
  app.post('/api/quiz_answers/get', (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });

      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const answers = db.quiz_answers.filter(a => a.userId === user.id);
      return res.json({ answers });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load quiz answers' });
    }
  });

  // Quiz stats
  app.post('/api/quiz_answers/stats', (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });

      const db = readDB();
      const user = db.users.find(u => u.current_session_id === sessionId);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const answers = db.quiz_answers.filter(a => a.userId === user.id);
      const totalAnswered = answers.length;
      const correct = answers.filter(a => a.isCorrect).length;
      const wrong = totalAnswered - correct;
      const totalQuestions = (db.quiz_questions || []).length;

      const questionsBySeed = {};
      (db.quiz_questions || []).forEach(q => {
        questionsBySeed[q.seedId] = (questionsBySeed[q.seedId] || 0) + 1;
      });

      const seedStats = {};
      Object.keys(questionsBySeed).forEach(seedId => {
        seedStats[seedId] = { total: questionsBySeed[seedId], correct: 0 };
      });

      answers.forEach(a => {
        if (seedStats[a.seedId]) {
          if (a.isCorrect) seedStats[a.seedId].correct++;
        }
      });

      const rate = totalAnswered > 0 ? Math.round((correct / totalAnswered) * 100) : 0;

      return res.json({ totalAnswered, correct, wrong, totalQuestions, rate, seedStats });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load quiz stats' });
    }
  });

  // Admin: Get all quiz answers
  app.get('/api/quiz_answers/all', async (req, res) => {
    try {
      const db = readDB();
      const map = new Map();
      (db.quiz_answers || []).forEach(a => map.set(a.userId + '|' + a.questionId, a));
      try {
        const [rows] = await pool.query('SELECT * FROM quiz_answers');
        rows.forEach(r => {
          const key = r.userId + '|' + r.questionId;
          if (!map.has(key)) map.set(key, r);
        });
      } catch {}
      return res.json([...map.values()]);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load quiz answers' });
    }
  });

  // Admin: Quiz degrees
  app.get('/api/admin/quiz-degrees', async (req, res) => {
    try {
      const db = readDB();
      const answers = db.quiz_answers || [];
      const questions = db.quiz_questions || [];

      const userMap = new Map();
      answers.forEach(a => {
        const key = a.userId;
        if (!userMap.has(key)) {
          userMap.set(key, { email: a.userEmail || '', name: a.userName || '', total: 0, correct: 0, wrong: 0, answers: [] });
        }
        const entry = userMap.get(key);
        entry.total++;
        if (a.isCorrect) entry.correct++;
        else entry.wrong++;
        entry.answers.push(a);
      });

      const degrees = [];
      userMap.forEach((val, userId) => {
        const rate = val.total > 0 ? Math.round((val.correct / val.total) * 100) : 0;
        degrees.push({
          userId,
          email: val.email,
          name: val.name,
          totalAnswered: val.total,
          correct: val.correct,
          wrong: val.wrong,
          rate
        });
      });

      try {
        const [rows] = await pool.query('SELECT * FROM quiz_answers');
        const mysqlMap = new Map();
        rows.forEach(r => {
          const key = r.userId;
          if (!mysqlMap.has(key)) {
            mysqlMap.set(key, { email: r.userEmail || '', name: r.userName || '', total: 0, correct: 0, wrong: 0 });
          }
          const entry = mysqlMap.get(key);
          entry.total++;
          if (r.isCorrect) entry.correct++;
          else entry.wrong++;
        });
        mysqlMap.forEach((val, userId) => {
          const existing = degrees.find(d => d.userId === userId);
          if (!existing) {
            const rate = val.total > 0 ? Math.round((val.correct / val.total) * 100) : 0;
            degrees.push({ userId, email: val.email, name: val.name, totalAnswered: val.total, correct: val.correct, wrong: val.wrong, rate });
          }
        });
      } catch {}

      degrees.sort((a, b) => b.rate - a.rate || b.totalAnswered - a.totalAnswered);
      return res.json(degrees);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load quiz degrees' });
    }
  });

  // Auto-migrations
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS paidGardens JSONB DEFAULT '[]'`);
  } catch {}
  try {
    await pool.query(`ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS userEmail VARCHAR(255) NOT NULL DEFAULT ''`);
  } catch {}
  try {
    await pool.query(`ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS userName VARCHAR(255) NOT NULL DEFAULT ''`);
  } catch {}
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(100) NOT NULL DEFAULT ''`);
  } catch {}

  // Serve assets and handle Vite in development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { clientPort: PORT }
      },
      root: path.join(__dirname, '..', 'frontend'),
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      maxAge: '31536000000',
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (process.env.VERCEL) {
    return app;
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Knowledge Garden engine online on http://localhost:${PORT}`);
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.maxHeadersCount = 500;
  server.requestTimeout = 30000;

  const shutdown = async () => {
    console.log('[SERVER] Shutting down gracefully...');
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return app;
}

let app = null;

initializeDB()
  .then(() => {
    const isVercel = !!process.env.VERCEL;
    if (!isVercel) {
      startServer();
    }
  })
  .catch((err) => {
    console.error('[DB] Failed to initialize database:', err);
    console.warn('[DB] Running without PostgreSQL — some features may be degraded');
    const isVercel = !!process.env.VERCEL;
    if (!isVercel) {
      startServer().catch((e) => console.error('[SERVER] Failed to start:', e));
    }
  });

export default async function handler(req, res) {
  if (!app) {
    app = await startServer();
  }
  return app(req, res);
}
