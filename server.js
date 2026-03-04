require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const multer = require("multer");

// YENİ: Yapay Zeka Kurulumu
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "DUMMY_KEY");

console.log("SERVER.JS LOADED ✅ (IN-MEMORY + BİLDİRİM + CHAT + AI)", __filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================
// MIDDLEWARE
// ============================
app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static
app.use(express.static(path.join(__dirname, "..", "public")));

// Health
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ============================
// IN-MEMORY DATABASES (RAM)
// ============================
const db = {
  users: [],
  classes: [],
  class_members: [],
  assignments: [],
  submissions: [],
  files: [], // Yüklenen dosyaların buffer'larını burada tutacağız
  notifications: [], // YENİ: Bildirim havuzu
  messages: []       // YENİ: Sohbet havuzu
};

// ============================
// HELPERS
// ============================
function normEmail(v) { return String(v || "").trim().toLowerCase(); }
function safeName(v) { return String(v || "").trim(); }
function isValidRole(role) { return ["student", "teacher"].includes(role); }
function makeId(prefix = "id") { return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`; }
function genToken() { return crypto.randomBytes(24).toString("hex"); }
function nowPlusMinutes(min) { return new Date(Date.now() + min * 60 * 1000); }
function gen6DigitCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function isBcryptHash(s) { return typeof s === "string" && (s.startsWith("$2a$") || s.startsWith("$2b$") || s.startsWith("$2y$")); }

// ============================
// SESSIONS (RAM)
// ============================
const sessions = new Map();
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 24);

function authRequired(req, res, next) {
  if (req.method === "OPTIONS") return res.sendStatus(200);

  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, message: "Token yok." });

  const s = sessions.get(token);
  if (!s) return res.status(401).json({ ok: false, message: "Oturum süresi dolmuş veya geçersiz. Lütfen tekrar giriş yapın." });

  if (s.exp && new Date(s.exp) < new Date()) {
    sessions.delete(token);
    return res.status(401).json({ ok: false, message: "Token süresi dolmuş." });
  }

  req.auth = s;
  req.token = token;
  next();
}

// ============================
// YENİ: NOTIFICATION, CHAT & AI API
// ============================

// 1. Bildirimleri Getir (Sadece okunmamışları veya hepsini)
app.get("/api/notifications", authRequired, (req, res) => {
  const notifs = db.notifications
    .filter(n => n.toUserId === req.auth.userId && !n.read)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ ok: true, notifications: notifs });
});

// 1.5 Bildirimleri Okundu İşaretle (Kırmızı baloncuğu silmek için)
app.post("/api/notifications/read", authRequired, (req, res) => {
  db.notifications.forEach(n => {
    if (n.toUserId === req.auth.userId) n.read = true;
  });
  res.json({ ok: true });
});

// 2. Sohbet Mesajlarını Getir (SADECE ÖĞRENCİ - ÖĞRETMEN ARASI)
app.get("/api/chat/:classId", authRequired, (req, res) => {
  const cls = db.classes.find(c => c.id === req.params.classId);
  if (!cls) return res.json({ ok: true, messages: [] });

  let msgs = [];
  if (req.auth.role === "student") {
    // Öğrenci, kendi mesajlarını VE öğretmenin mesajlarını görür
    msgs = db.messages.filter(m => 
      m.classId === req.params.classId && 
      (m.senderId === req.auth.userId || m.senderId === cls.teacherId)
    );
  } else if (req.auth.role === "teacher") {
    msgs = db.messages.filter(m => m.classId === req.params.classId);
  }
  
  msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ ok: true, messages: msgs });
});

// 3. Mesaj Gönder
app.post("/api/chat", authRequired, (req, res) => {
  const { classId, text, receiverId } = req.body;
  const user = db.users.find(u => u.id === req.auth.userId);
  const cls = db.classes.find(c => c.id === classId);
  if (!cls) return res.status(404).json({ok: false});

  // Öğrenci atıyorsa alıcı direk Öğretmen. Öğretmen atıyorsa alıcı frontend'den gelen receiverId.
  let finalReceiverId = req.auth.role === "student" ? cls.teacherId : receiverId; 

  const msg = {
    id: makeId("msg"),
    classId,
    senderId: req.auth.userId,
    receiverId: finalReceiverId,
    senderName: user ? user.name : "Kullanıcı",
    text: safeName(text),
    createdAt: new Date().toISOString()
  };
  db.messages.push(msg);

  // Bildirim Gönder
  if (req.auth.role === "student") {
    db.notifications.push({ 
      id: makeId("nt"), 
      toUserId: cls.teacherId, 
      text: `${user.name} sana bir mesaj gönderdi.`, 
      createdAt: new Date().toISOString() 
    });
  } else if (req.auth.role === "teacher" && finalReceiverId) {
    db.notifications.push({ 
      id: makeId("nt"), 
      toUserId: finalReceiverId, 
      text: `Öğretmeninden yeni bir mesaj var.`, 
      createdAt: new Date().toISOString() 
    });
  }

  res.json({ ok: true, message: msg });
});

// 4. Gerçek Yapay Zeka (Gemini API)
app.post("/api/ai/ask", authRequired, async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "DUMMY_KEY") {
       return res.json({ ok: true, reply: "Sistemde ücretsiz yapay zeka (Gemini) API anahtarı tanımlanmamış. .env dosyasına anahtar eklendiğinde gerçek cevaplar vermeye başlayacağım! Sorun: '" + prompt + "'" });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt + " (Sen eğitim portalındaki bir asistansın, kısa ve öz, öğrencilere yardımcı olacak şekilde Türkçe cevap ver.)");
    
    res.json({ ok: true, reply: result.response.text() });

  } catch(e) {
    console.error("AI Hatası:", e);
    res.json({ ok: true, reply: "Şu an yoğunluktan dolayı bağlanamıyorum, lütfen biraz sonra tekrar dene." });
  }
});

// ============================
// MAIL (OTP reset)
// ============================
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

const mailEnabled = SMTP_HOST && SMTP_USER && SMTP_PASS;
const transporter = mailEnabled
  ? nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

const RESET_CODE_TTL_MIN = Number(process.env.RESET_CODE_TTL_MIN || 10);
const RESET_TOKEN_TTL_MIN = Number(process.env.RESET_TOKEN_TTL_MIN || 15);

// ============================
// MULTER (memory)
// ============================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    cb(null, true); 
  },
});

// ============================
// FILE DOWNLOAD (RAM)
// ============================
app.get("/api/files/:id", (req, res) => {
  try {
    const fileId = req.params.id;
    const file = db.files.find(f => f.id === fileId);
    
    if (!file) {
      return res.status(404).send("Dosya bulunamadı.");
    }

    res.setHeader("Content-Type", file.mimetype || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${file.originalname || "file"}"`);
    res.send(file.buffer);
  } catch (error) {
    console.error("Dosya indirme hatası:", error);
    res.status(500).send("Sunucu hatası.");
  }
});

// ============================
// AUTH
// ============================
app.post("/api/auth/register", async (req, res) => {
  try {
    const { role, name, email, password } = req.body || {};
    if (!role || !email || !password) return res.status(400).json({ ok: false, message: "Eksik alan var." });
    if (!isValidRole(role)) return res.status(400).json({ ok: false, message: "Geçersiz rol." });

    const mail = normEmail(email);
    const pass = String(password);

    if (!mail.includes("@")) return res.status(400).json({ ok: false, message: "Geçerli bir e-posta gir." });
    if (pass.length < 6) return res.status(400).json({ ok: false, message: "Şifre en az 6 karakter olmalı." });

    const existing = db.users.find(u => u.email === mail);

    if (!existing) {
      const hash = await bcrypt.hash(pass, 10);
      const newUser = {
        id: makeId("usr"),
        name: safeName(name) || "(İsimsiz)",
        email: mail,
        password: hash,
        roles: [role],
        createdAt: new Date().toISOString(),
      };
      db.users.push(newUser);
      return res.json({
        ok: true,
        user: { id: newUser.id, name: newUser.name, email: newUser.email, roles: newUser.roles },
      });
    }

    const stored = existing.password || "";
    const okPass = isBcryptHash(stored) ? await bcrypt.compare(pass, stored) : String(stored) === pass;
    if (!okPass) {
      return res.status(409).json({ ok: false, message: "Bu e-posta zaten kayıtlı. Şifre yanlış." });
    }

    if (!isBcryptHash(stored)) {
      existing.password = await bcrypt.hash(pass, 10);
    }

    if (!existing.roles.includes(role)) existing.roles.push(role);
    existing.name = safeName(name) || existing.name || "(İsimsiz)";

    return res.json({
      ok: true,
      user: { id: existing.id, name: existing.name, email: existing.email, roles: existing.roles },
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ ok: false, message: "Sunucu hatası." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { role, email, password } = req.body || {};
    if (!role || !email || !password) return res.status(400).json({ ok: false, message: "Eksik alan var." });
    if (!isValidRole(role)) return res.status(400).json({ ok: false, message: "Geçersiz rol." });

    const mail = normEmail(email);
    const pass = String(password);

    const user = db.users.find(u => u.email === mail);
    if (!user) return res.status(401).json({ ok: false, message: "E-posta/şifre hatalı." });

    const stored = user.password || "";
    const okPass = isBcryptHash(stored) ? await bcrypt.compare(pass, stored) : String(stored) === pass;
    if (!okPass) return res.status(401).json({ ok: false, message: "E-posta/şifre hatalı." });

    if (!isBcryptHash(stored)) {
      user.password = await bcrypt.hash(pass, 10);
    }

    if (!user.roles.includes(role)) {
      return res.status(403).json({ ok: false, message: "Bu hesap bu role sahip değil." });
    }

    const token = "t_" + genToken();
    sessions.set(token, {
      userId: user.id,
      role,
      exp: nowPlusMinutes(SESSION_TTL_HOURS * 60).toISOString(),
    });

    return res.json({
      ok: true, token, selectedRole: role,
      user: { id: user.id, name: user.name, email: user.email, roles: user.roles },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ ok: false, message: "Sunucu hatası." });
  }
});

app.post("/api/auth/logout", authRequired, (req, res) => {
  if (req.token) sessions.delete(req.token);
  res.json({ ok: true });
});

// FORGOT & RESET
app.post("/api/auth/forgot", async (req, res) => {
  try {
    const { role, email } = req.body || {};
    const emailNorm = normEmail(email);
    if (!emailNorm || !isValidRole(role)) return res.json({ ok: true });

    const user = db.users.find(u => u.email === emailNorm);
    if (!user || !user.roles.includes(role)) return res.json({ ok: true });

    const code = gen6DigitCode();
    user.resetCodeHash = await bcrypt.hash(code, 10);
    user.resetCodeExp = nowPlusMinutes(RESET_CODE_TTL_MIN).toISOString();
    user.resetCodeTries = 0;
    user.resetRole = role;
    delete user.resetToken;
    delete user.resetTokenExp;

    if (mailEnabled && transporter) {
      await transporter.sendMail({
        from: SMTP_FROM, to: emailNorm, subject: "Şifre Sıfırlama Kodu",
        text: `Şifre sıfırlama kodun: ${code}\nBu kod ${RESET_CODE_TTL_MIN} dakika geçerlidir.\nEğer bu işlemi sen yapmadıysan bu maili yok say.`,
      });
    } else {
      console.log("⚠️ SMTP yok. Reset kodu:", code, "email:", emailNorm);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.json({ ok: true });
  }
});

app.post("/api/auth/reset/verify", async (req, res) => {
  try {
    const { role, email, code } = req.body || {};
    const emailNorm = normEmail(email);
    const codeStr = String(code || "").trim();

    if (!emailNorm || !codeStr || !isValidRole(role)) return res.status(400).json({ ok: false, message: "E-posta, rol ve kod gerekli." });

    const user = db.users.find(u => u.email === emailNorm);
    if (!user || user.resetRole !== role || !user.resetCodeHash || !user.resetCodeExp) {
      return res.status(400).json({ ok: false, message: "Kod geçersiz veya süresi dolmuş." });
    }

    if (new Date(user.resetCodeExp) < new Date()) return res.status(400).json({ ok: false, message: "Kodun süresi dolmuş." });
    
    if (user.resetCodeTries >= 5) return res.status(429).json({ ok: false, message: "Çok fazla deneme. Yeni kod iste." });

    const ok = await bcrypt.compare(codeStr, user.resetCodeHash);
    if (!ok) {
      user.resetCodeTries = (user.resetCodeTries || 0) + 1;
      return res.status(400).json({ ok: false, message: "Kod yanlış." });
    }

    const token = genToken();
    user.resetToken = token;
    user.resetTokenExp = nowPlusMinutes(RESET_TOKEN_TTL_MIN).toISOString();

    return res.json({ ok: true, resetToken: token });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Sunucu hatası." });
  }
});

app.post("/api/auth/reset", async (req, res) => {
  try {
    const { role, email, resetToken, newPassword } = req.body || {};
    const emailNorm = normEmail(email);
    const token = String(resetToken || "").trim();
    const pw = String(newPassword || "");

    if (!emailNorm || !token || !pw || !isValidRole(role)) return res.status(400).json({ ok: false, message: "Eksik bilgi." });
    if (pw.length < 6) return res.status(400).json({ ok: false, message: "Şifre en az 6 karakter olmalı." });

    const user = db.users.find(u => u.email === emailNorm);
    if (!user || user.resetRole !== role || user.resetToken !== token || !user.resetTokenExp) {
      return res.status(400).json({ ok: false, message: "Yetkisiz veya süresi dolmuş." });
    }

    if (new Date(user.resetTokenExp) < new Date()) return res.status(400).json({ ok: false, message: "Sıfırlama oturumu süresi dolmuş." });

    user.password = await bcrypt.hash(pw, 10);
    delete user.resetCodeHash; delete user.resetCodeExp; delete user.resetCodeTries;
    delete user.resetToken; delete user.resetTokenExp; delete user.resetRole;

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Sunucu hatası." });
  }
});

// ============================
// CLASSES
// ============================
app.post("/api/classes/create", authRequired, (req, res) => {
  if (req.auth.role !== "teacher") return res.status(403).json({ ok: false, message: "Sadece öğretmen." });

  const n = safeName(req.body.name);
  if (!n) return res.status(400).json({ ok: false, message: "Sınıf adı zorunlu." });

  let code = "";
  for (let i = 0; i < 15; i++) {
    code = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split("").sort(() => 0.5 - Math.random()).slice(0, 6).join("");
    if (!db.classes.find(c => c.code === code)) break;
  }

  const item = {
    id: makeId("cls"), teacherId: req.auth.userId, name: n,
    desc: safeName(req.body.desc), code, createdAt: new Date().toISOString(),
  };
  db.classes.push(item);
  res.json({ ok: true, class: item });
});

app.get("/api/classes/mine", authRequired, (req, res) => {
  if (req.auth.role !== "teacher") return res.status(403).json({ ok: false, message: "Sadece öğretmen." });
  const teacherId = String(req.query.teacherId || "").trim() || req.auth.userId;
  if (teacherId !== req.auth.userId) return res.status(403).json({ ok: false, message: "Yetkisiz." });

  const classes = db.classes.filter(c => c.teacherId === teacherId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ ok: true, classes });
});

app.get("/api/classes/search", (req, res) => {
  const code = String(req.query.code || "").trim().toUpperCase();
  if (code.length !== 6) return res.status(400).json({ ok: false, message: "Kod 6 haneli olmalı." });

  const cls = db.classes.find(c => c.code === code);
  if (!cls) return res.status(404).json({ ok: false, message: "Sınıf bulunamadı." });

  const teacher = db.users.find(u => u.id === cls.teacherId);
  res.json({ ok: true, class: { ...cls, teacherName: teacher?.name || "" } });
});

app.get("/api/classes/search-by-teacher", (req, res) => {
  const q = String(req.query.teacher || "").trim().toLowerCase();
  if (!q) return res.json({ ok: true, classes: [] });

  const teachers = db.users.filter(u => u.roles.includes("teacher") && u.name.toLowerCase().includes(q));
  const teacherIds = teachers.map(t => t.id);
  
  if (!teacherIds.length) return res.json({ ok: true, classes: [] });

  const classes = db.classes.filter(c => teacherIds.includes(c.teacherId));
  const out = classes.map(c => ({ ...c, teacherName: teachers.find(t => t.id === c.teacherId)?.name || "" }));
  res.json({ ok: true, classes: out });
});

app.post("/api/classes/join", authRequired, (req, res) => {
  if (req.auth.role !== "student") return res.status(403).json({ ok: false, message: "Sadece öğrenci katılabilir." });

  const { classId, studentName } = req.body || {};
  if (!classId) return res.status(400).json({ ok: false, message: "classId gerekli." });

  const cls = db.classes.find(c => c.id === classId);
  if (!cls) return res.status(404).json({ ok: false, message: "Sınıf bulunamadı." });

  const exists = db.class_members.find(m => m.classId === classId && m.studentId === req.auth.userId);
  if (exists) return res.json({ ok: true, message: "Zaten üyesin." });

  const mem = {
    id: makeId("mem"), classId, studentId: req.auth.userId,
    studentName: safeName(studentName) || "Öğrenci", joinedAt: new Date().toISOString(),
  };
  db.class_members.push(mem);
  res.json({ ok: true, membership: mem });
});

app.get("/api/classes/my", authRequired, (req, res) => {
  if (req.auth.role !== "student") return res.status(403).json({ ok: false, message: "Sadece öğrenci." });

  const studentId = String(req.query.studentId || "").trim() || req.auth.userId;
  if (studentId !== req.auth.userId) return res.status(403).json({ ok: false, message: "Yetkisiz." });

  const ids = db.class_members.filter(m => m.studentId === studentId).map(m => m.classId);
  const classes = db.classes.filter(c => ids.includes(c.id));
  res.json({ ok: true, classes });
});

// Öğretmenin kendi sınıfındaki öğrencileri listelemesi için API
app.get("/api/classes/members", authRequired, (req, res) => {
  if (req.auth.role !== "teacher") return res.status(403).json({ ok: false, message: "Sadece öğretmen." });
  
  const classId = String(req.query.classId || "").trim();
  if (!classId) return res.json({ ok: true, members: [] });

  // İlgili sınıftaki tüm üyeleri filtrele
  const members = db.class_members.filter(m => m.classId === classId);
  res.json({ ok: true, members });
});

// ============================
// ASSIGNMENTS (BİLDİRİM EKLENDİ)
// ============================
app.post("/api/assignments/create", authRequired, (req, res) => {
  if (req.auth.role !== "teacher") return res.status(403).json({ ok: false, message: "Sadece öğretmen." });

  const { classId, course, title, desc, due } = req.body || {};
  if (!classId || !course || !title || !due) return res.status(400).json({ ok: false, message: "Eksik alan var." });

  const cls = db.classes.find(c => c.id === classId);
  if (!cls) return res.status(404).json({ ok: false, message: "Sınıf bulunamadı." });
  if (cls.teacherId !== req.auth.userId) return res.status(403).json({ ok: false, message: "Yetkisiz." });

  const item = {
    id: makeId("ass"), classId, teacherId: req.auth.userId, course: safeName(course),
    title: safeName(title), desc: safeName(desc), due: new Date(due).toISOString(), createdAt: new Date().toISOString(),
  };
  db.assignments.push(item);

  // YENİ: ÖĞRENCİLERE BİLDİRİM GÖNDER
  const members = db.class_members.filter(m => m.classId === item.classId);
  members.forEach(m => {
    db.notifications.push({ 
      id: makeId("nt"), 
      toUserId: m.studentId, 
      text: `${item.course} dersinden yeni bir ödev eklendi: ${item.title}`, 
      createdAt: new Date().toISOString() 
    });
  });

  res.json({ ok: true, assignment: item });
});

app.get("/api/assignments/by-class", authRequired, (req, res) => {
  const classId = String(req.query.classId || "").trim();
  const cls = db.classes.find(c => c.id === classId);
  if (!cls) return res.json({ ok: true, assignments: [] });

  if (req.auth.role === "teacher" && cls.teacherId !== req.auth.userId) return res.status(403).json({ ok: false, message: "Yetkisiz." });
  
  if (req.auth.role === "student") {
    if (!db.class_members.find(m => m.classId === classId && m.studentId === req.auth.userId)) {
      return res.status(403).json({ ok: false, message: "Bu sınıfta değilsin." });
    }
  }

  const list = db.assignments.filter(a => a.classId === classId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ ok: true, assignments: list });
});

// ============================
// SUBMISSIONS (BİLDİRİM EKLENDİ)
// ============================
app.post("/api/submissions/upload", authRequired, upload.single("file"), (req, res) => {
  try {
    if (req.auth.role !== "student") return res.status(403).json({ ok: false, message: "Sadece öğrenci teslim edebilir." });

    const { classId, assignmentId, teacherId, studentName, course, title, studentNote } = req.body || {};
    if (!req.file) return res.status(400).json({ ok: false, message: "Lütfen bir dosya seçin." });
    if (!classId || !assignmentId || !teacherId) return res.status(400).json({ ok: false, message: "Sınıf veya ödev bilgisi eksik." });

    const mem = db.class_members.find(m => m.classId === classId && m.studentId === req.auth.userId);
    if (!mem) return res.status(403).json({ ok: false, message: "Bu sınıfta değilsin." });

    const exists = db.submissions.find(s => s.classId === classId && s.assignmentId === assignmentId && s.studentId === req.auth.userId);
    if (exists) return res.status(409).json({ ok: false, message: "Bu ödeve zaten teslim yaptın." });

    const fileId = makeId("file");
    db.files.push({
      id: fileId,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
      size: req.file.size
    });

    const item = {
      id: makeId("sub"), classId, assignmentId, teacherId, studentId: req.auth.userId,
      studentName: safeName(studentName) || mem.studentName || "Öğrenci",
      course: safeName(course) || "", title: safeName(title) || "", studentNote: safeName(studentNote) || "",
      submittedAt: new Date().toISOString(), status: "pending", grade: "", feedback: "",
      fileId, originalFileName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, fileUrl: `/api/files/${fileId}`,
    };

    db.submissions.push(item);

    // YENİ: ÖĞRETMENE TESLİM BİLDİRİMİ GÖNDER
    db.notifications.push({ 
      id: makeId("nt"), 
      toUserId: teacherId, 
      text: `${item.studentName}, ${item.course} ödevini teslim etti.`, 
      createdAt: new Date().toISOString() 
    });

    return res.json({ ok: true, submission: item });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    return res.status(500).json({ ok: false, message: err.message || "Upload başarısız." });
  }
});

app.get("/api/teacher/submissions", authRequired, (req, res) => {
  if (req.auth.role !== "teacher") return res.status(403).json({ ok: false, message: "Sadece öğretmen." });
  const classId = String(req.query.classId || "").trim();

  const subs = db.submissions.filter(s => s.classId === classId && s.teacherId === req.auth.userId).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  res.json({ ok: true, submissions: subs });
});

app.get("/api/student/submissions", authRequired, (req, res) => {
  if (req.auth.role !== "student") return res.status(403).json({ ok: false, message: "Sadece öğrenci." });
  const classId = String(req.query.classId || "").trim();

  const subs = db.submissions.filter(s => s.classId === classId && s.studentId === req.auth.userId).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  res.json({ ok: true, submissions: subs });
});

app.post("/api/teacher/submissions/review", authRequired, (req, res) => {
  if (req.auth.role !== "teacher") return res.status(403).json({ ok: false, message: "Sadece öğretmen." });

  const { submissionId, status, grade, feedback } = req.body || {};
  if (!submissionId) return res.status(400).json({ ok: false, message: "submissionId gerekli." });

  const sub = db.submissions.find(s => s.id === submissionId);
  if (!sub) return res.status(404).json({ ok: false, message: "Teslim bulunamadı." });
  if (sub.teacherId !== req.auth.userId) return res.status(403).json({ ok: false, message: "Yetkisiz." });

  let gradeVal = "";
  if (grade !== "" && grade !== null && typeof grade !== "undefined") {
    const n = Number(grade);
    if (Number.isNaN(n) || n < 0 || n > 100) return res.status(400).json({ ok: false, message: "Not 0-100 olmalı." });
    gradeVal = Math.round(n);
  }

  sub.status = status === "graded" ? "graded" : "pending";
  sub.grade = gradeVal;
  sub.feedback = safeName(feedback);

  // YENİ: ÖĞRENCİYE NOTLANDIRMA BİLDİRİMİ GÖNDER
  db.notifications.push({ 
    id: makeId("nt"), 
    toUserId: sub.studentId, 
    text: `${sub.course} ödevin notlandırıldı. Notun: ${sub.grade}`, 
    createdAt: new Date().toISOString() 
  });

  res.json({ ok: true });
});

// ===== FALLBACK =====
app.use((req, res) => res.status(404).send("404 - Not Found"));

// ============================
// START
// ============================
app.listen(PORT, () => {
  console.log(`🚀 Server (IN-MEMORY) çalışıyor: http://localhost:${PORT}`);
  console.log(`⚠️ Uyarı: Veritabanı kullanılmıyor. Sunucu kapandığında tüm veriler silinir.`);
});