require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const multer = require("multer");

// YENİ: Yapay Zeka Kurulumu (Groq API)
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "DUMMY_KEY" });

console.log("SERVER.JS LOADED ✅ (IN-MEMORY + BİLDİRİM + CHAT + AI + GRUPLAR)", __filename);

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
  messages: [],      // YENİ: Sohbet havuzu
  groups: [],        // YENİ: Öğrenci çalışma grupları
  group_messages: [], // YENİ: Grup içi mesajlaşmalar
  performanceOverrides: [] // YENİ: Öğretmen Performans Notları
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
// YENİ: GRUP SOHBETİ API'LERİ VE AYARLAR
// ============================

// 1. Yeni Grup Kurma
app.post("/api/groups/create", authRequired, (req, res) => {
  const { classId, name, memberIds } = req.body;
  const cls = db.classes.find(c => c.id === classId);
  if (!cls) return res.status(404).json({ok: false, message: "Sınıf bulunamadı."});

  // Grubu kuran kişiyi de üyeler listesine ekliyoruz
  const finalMembers = new Set(memberIds || []);
  finalMembers.add(req.auth.userId);

  const group = {
    id: makeId("grp"),
    classId,
    name: safeName(name),
    creatorId: req.auth.userId,
    members: Array.from(finalMembers), 
    createdAt: new Date().toISOString()
  };
  
  db.groups.push(group);
  res.json({ ok: true, group });
});

// 2. Sınıftaki Grupları Listeleme
app.get("/api/groups/:classId", authRequired, (req, res) => {
  const classId = req.params.classId;
  let list = [];
  
  if (req.auth.role === "teacher") {
    // Öğretmen o sınıftaki TÜM grupları görebilir
    list = db.groups.filter(g => g.classId === classId); 
  } else {
    // Öğrenci sadece "üyesi olduğu" grupları görebilir
    list = db.groups.filter(g => g.classId === classId && g.members.includes(req.auth.userId));
  }
  
  res.json({ ok: true, groups: list });
});

// 3. Belirli Bir Grubun Mesajlarını Getirme
app.get("/api/groups/:groupId/messages", authRequired, (req, res) => {
  const msgs = db.group_messages
    .filter(m => m.groupId === req.params.groupId)
    .sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ ok: true, messages: msgs });
});

// 4. Gruba Mesaj Atma (Fotoğraf/PDF Destekli)
app.post("/api/groups/message", authRequired, upload.single("file"), (req, res) => {
  const { groupId, text } = req.body;
  const user = db.users.find(u => u.id === req.auth.userId);
  const group = db.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ok: false});

  let fileInfo = null;
  if (req.file) {
    const fileId = makeId("file");
    db.files.push({
      id: fileId,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
      size: req.file.size
    });
    fileInfo = {
      fileId,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      fileUrl: `/api/files/${fileId}`
    };
  }

  const msg = {
    id: makeId("gmsg"),
    groupId,
    senderId: req.auth.userId,
    senderName: user ? user.name : "Kullanıcı",
    text: safeName(text) || "",
    createdAt: new Date().toISOString(),
    ...fileInfo
  };
  
  db.group_messages.push(msg);

  // Gruptaki diğer üyelere ve Öğretmene bildirim gönder (Mesajı atan hariç)
  const receivers = new Set(group.members);
  const cls = db.classes.find(c => c.id === group.classId);
  if (cls) receivers.add(cls.teacherId); // Öğretmene kesin bildirim gider
  receivers.delete(req.auth.userId); // Kendine bildirim atma

  receivers.forEach(rId => {
    db.notifications.push({ 
      id: makeId("nt"), 
      toUserId: rId, 
      text: `${group.name} grubuna yeni mesaj: ${user?.name}`, 
      createdAt: new Date().toISOString() 
    });
  });

  res.json({ ok: true, message: msg });
});

// YENİ: Grup İsmi Değiştirme
app.put("/api/groups/:groupId/name", authRequired, (req, res) => {
  const group = db.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ok: false});
  
  group.name = safeName(req.body.name);
  res.json({ ok: true, group });
});

// YENİ: Gruba Sonradan Kişi Ekleme
app.post("/api/groups/:groupId/members", authRequired, (req, res) => {
  const group = db.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ok: false});
  
  (req.body.memberIds || []).forEach(id => {
    if(!group.members.includes(id)) {
      group.members.push(id);
    }
  });
  res.json({ ok: true, group });
});

// YENİ: Gruptan Çıkma veya Öğretmenin Öğrenciyi Atması
app.delete("/api/groups/:groupId/members/:studentId", authRequired, (req, res) => {
  const group = db.groups.find(g => g.id === req.params.groupId);
  if (!group) return res.status(404).json({ok: false});
  
  const studentId = req.params.studentId;
  
  // Öğrenci sadece kendini gruptan çıkarabilir. 
  // (Öğretmense zaten bu bloğa girmez, istediği öğrenciyi silebilir)
  if (req.auth.role === "student" && req.auth.userId !== studentId) {
    return res.status(403).json({ok: false, message: "Sadece kendin çıkabilirsin."});
  }
  
  group.members = group.members.filter(m => m !== studentId);
  res.json({ ok: true, group });
});

// ============================
// YENİ: NOTIFICATION, CHAT & AI API
// ============================

// 1. Bildirimleri Getir (Hepsini getirir, okunmamış sayısını da döner)
app.get("/api/notifications", authRequired, (req, res) => {
  const notifs = db.notifications
    .filter(n => n.toUserId === req.auth.userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unreadCount = notifs.filter(n => !n.read).length;
  // Sadece en son 50 bildirimi döndür (şişmeyi önlemek için)
  const topNotifs = notifs.slice(0, 50);
  res.json({ ok: true, notifications: topNotifs, unreadCount });
});

// 1.5 Bildirimleri Okundu İşaretle (Kırmızı baloncuğu silmek için)
app.post("/api/notifications/read", authRequired, (req, res) => {
  db.notifications.forEach(n => {
    if (n.toUserId === req.auth.userId) n.read = true;
  });
  res.json({ ok: true });
});

// YENİ: Bildirimi tekli olarak kalıcı sil
app.post("/api/notifications/dismiss/:id", authRequired, (req, res) => {
  db.notifications = db.notifications.filter(n => n.id !== req.params.id);
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

// YENİ: Öğrenci Performans & Rozet Hesaplama Fonksiyonu
function calcStudentPerformance(classId, studentId) {
  const asgn = db.assignments.filter(a => a.classId === classId);
  const subs = db.submissions.filter(s => s.classId === classId && s.studentId === studentId);
  
  if (asgn.length === 0) return { score: 100, badges: ["🎯 Yeni Başlangıç"] };
  
  let score = 50; 
  let lateCount = 0;
  let missingCount = 0;
  let gradedCount = 0;
  let totalGrade = 0;

  asgn.forEach(a => {
    const sub = subs.find(s => s.assignmentId === a.id) || subs.find(s => s.title === a.title);
    if (!sub) {
      if (a.due && new Date(a.due) < new Date(new Date().setHours(0,0,0,0))) {
        missingCount++;
        score -= 10;
      }
    } else {
      if (a.due && sub.submittedAt) {
        const dDue = new Date(a.due).setHours(23,59,59,999);
        if (new Date(sub.submittedAt).getTime() > dDue) {
          lateCount++;
          score -= 5;
        } else {
          score += 3; 
        }
      } else {
        score += 3;
      }
      
      if (sub.status === "graded" && sub.grade) {
        gradedCount++;
        const g = Number(sub.grade);
        totalGrade += g;
        if (g >= 85) score += 5;
        else if (g >= 50) score += 2;
        else score -= 3;
      } else {
        score += 2;
      }
    }
  });

  score = Math.floor(score);
  if (score > 100) score = 100;
  if (score < 0) score = 0;

  const average = gradedCount > 0 ? (totalGrade / gradedCount) : 0;
  const badges = [];

  if (subs.length > 0 && lateCount === 0 && missingCount === 0) badges.push("⏰ Zaman Şampiyonu");
  if (subs.length === asgn.length) badges.push("🚀 Görev Adamı");
  if (average >= 85) badges.push("🌟 Yıldız Öğrenci");
  if (score >= 90) badges.push("👑 Sistem Lideri");
  if (badges.length === 0) badges.push("🌱 Gelişiyor");

  // YENİ: Öğretmenin girdiği manuel override kontrolü
  const override = (db.performanceOverrides || []).find(o => o.classId === classId && o.studentId === studentId);
  if (override) {
    score = override.score;
  }

  return { score, badges, average: average.toFixed(0) };
}

// 4. AI Bağlam Toplama Fonksiyonu (6. Hafta: Veri ve İçerik Tanımlama)
function buildAIContext(userId, classId, role = "student") {
  const ctx = { className: null, courses: [], assignments: [], submissions: [], studentProfile: {}, classProfile: null };

  if (!classId) return ctx;

  // Sınıf bilgisi
  const cls = db.classes.find(c => c.id === classId);
  if (cls) {
    ctx.className = cls.name;
    ctx.courses = cls.courses || [];
  }

  // Ödevler
  const assignments = db.assignments.filter(a => a.classId === classId);
  ctx.assignments = assignments.map(a => ({
    title: a.title, course: a.course, desc: a.desc,
    due: a.due, createdAt: a.createdAt
  }));

  // Teslimler
  let subs = [];
  if (role === "teacher") {
    subs = db.submissions.filter(s => s.classId === classId);
  } else {
    subs = db.submissions.filter(s => s.classId === classId && s.studentId === userId);
  }

  ctx.submissions = subs.map(s => ({
    course: s.course, title: s.title, status: s.status,
    grade: s.grade, feedback: s.feedback, submittedAt: s.submittedAt
  }));

  // Öğrenci profili
  const gradedSubs = subs.filter(s => s.status === "graded" && s.grade !== "" && s.grade !== null);
  const avg = gradedSubs.length > 0
    ? Math.round(gradedSubs.reduce((sum, s) => sum + Number(s.grade), 0) / gradedSubs.length)
    : null;

  ctx.studentProfile = {
    totalAssignments: assignments.length,
    submittedCount: subs.length,
    pendingCount: subs.filter(s => s.status === "pending").length,
    gradedCount: gradedSubs.length,
    notSubmittedCount: (role === "student") ? (assignments.length - subs.length) : 0,
    averageGrade: avg
  };

  if (role === "teacher") {
    ctx.classProfile = {
      totalSubmissions: subs.length,
      averageClassGrade: avg
    };
  }

  return ctx;
}

// 5. AI Bağlam API (Öğretmen/Admin erişimi için)
app.get("/api/ai/context/:classId", authRequired, (req, res) => {
  const ctx = buildAIContext(req.auth.userId, req.params.classId, req.auth.role);
  res.json({ ok: true, context: ctx });
});

// 6. Gerçek Yapay Zeka — Bağlam Zenginleştirilmiş (Groq API)
app.post("/api/ai/ask", authRequired, async (req, res) => {
  try {
    const { prompt, classId } = req.body;
    
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === "DUMMY_KEY") {
       return res.json({ ok: true, reply: "Sistemde yapay zeka API anahtarı tanımlanmamış. .env dosyasına GROQ_API_KEY eklendiğinde çalışmaya başlayacağım!" });
    }

    // 6. Hafta: Portal verilerini topluyoruz
    const userRole = req.auth.role;
    const ctx = buildAIContext(req.auth.userId, classId, userRole);
    const user = db.users.find(u => u.id === req.auth.userId);
    const userName = user ? user.name : (userRole === "teacher" ? "Öğretmen" : "Öğrenci");

    // Bağlam metnini oluşturuyoruz
    let contextText = `\n--- PORTAL VERİLERİ (Bu bilgileri cevap verirken kullan) ---\n`;
    contextText += `Kullanıcı Rolü: ${userRole === "teacher" ? "Eğitmen/Öğretmen" : "Öğrenci"}\n`;
    contextText += `Kullanıcı Adı: ${userName}\n`;
    
    if (ctx.className) {
      contextText += `Aktif Sınıf: ${ctx.className}\n`;
      if (ctx.courses.length > 0) contextText += `Dersler: ${ctx.courses.join(", ")}\n`;
    }

    if (ctx.assignments.length > 0) {
      contextText += `\nÖdevler (${ctx.assignments.length} adet):\n`;
      ctx.assignments.forEach((a, i) => {
        const dueDate = a.due ? new Date(a.due).toLocaleDateString("tr-TR") : "Belirsiz";
        contextText += `  ${i+1}. [${a.course}] ${a.title} — Son: ${dueDate}${a.desc ? " — Açıklama: " + a.desc : ""}\n`;
      });
    }

    if (ctx.submissions.length > 0) {
      contextText += `\nTeslimler (${ctx.submissions.length} adet):\n`;
      ctx.submissions.forEach((s, i) => {
        contextText += `  ${i+1}. [${s.course}] ${s.title} — Durum: ${s.status === "graded" ? "Notlandırıldı (" + s.grade + "/100)" : "Bekliyor"}${s.feedback ? " — Geri bildirim: " + s.feedback : ""}\n`;
      });
    }

    const p = ctx.studentProfile;
    if (p.totalAssignments > 0) {
      contextText += `\nÖğrenci Profili:\n`;
      contextText += `  Toplam Ödev: ${p.totalAssignments}, Teslim Edilmiş: ${p.submittedCount}, Teslim Edilmemiş: ${p.notSubmittedCount}\n`;
      contextText += `  Notlandırılmış: ${p.gradedCount}, Bekleyen: ${p.pendingCount}\n`;
      if (p.averageGrade !== null) contextText += `  Not Ortalaması: ${p.averageGrade}/100\n`;
    }
    
    if (userRole === "teacher" && ctx.classProfile) {
      contextText += `\nSınıf Genel Özeti:\n`;
      contextText += `  Sınıftaki Toplam Teslim Sayısı: ${ctx.classProfile.totalSubmissions}\n`;
      contextText += `  Sınıf Genel Not Ortalaması: ${ctx.classProfile.averageClassGrade !== null ? ctx.classProfile.averageClassGrade : "Henüz not yok"}\n`;
    }

    contextText += `--- PORTAL VERİLERİ SONU ---\n`;
    contextText += `Şu anki sistem tarihi ve saati: ${new Date().toLocaleString("tr-TR")}\n`;

    const systemPrompt = `Sen bir eğitim portalındaki yapay zeka asistanısın. Adın "Portal Asistanı". ` +
      `Kullanıcıya (Öğrenci veya Öğretmen) sınıf bilgileri, ödevler, notlar ve teslimler hakkında yardımcı oluyorsun. ` +
      `Bu bilgileri kullanarak kısa, öz, motive edici ve KESİNLİKLE SADECE TÜRKÇE (Türk alfabesi ile) cevap ver. Cevabının arasına kesinlikle Çince (方面 vb.), İngilizce veya başka yabancı karakterler/kelimeler KARIŞTIRMA! Emoji kullanabilirsin.\n\n` +
      `ÖZEL DAVRANIŞ VE ANALİZ TALİMATLARI (YALNIZCA GEREKTİĞİNDE KULLAN):\n` +
      `1. ÖĞRENCİ GÜNLÜK RAPOR İSTERSE: Öğrencinin teslim tarihlerine (submittedAt) ve yaklaşan ödevlere (due date) bak. Başarılarını öv, eksiklerini kibarca hatırlat ve yarınki önceliklerini listele.\n` +
      `2. AKILLI HATA TESPİTİ (ÖĞRENCİ İÇİN): Teslim (submittedAt) ve son gün (due date) arasındaki farka dikkat et. Eğer hep son dakikaya bırakıyorsa zaman yönetimi tavsiyesi ver.\n` +
      `3. TÜKENMİŞLİK (BURNOUT) KONTROLÜ (ÖĞRENCİ İÇİN): Çok fazla bekleyen (pending) ve teslim tarihi yakın ödevi varsa, moral vererek küçük adımlara bölmesini sağla.\n` +
      `4. ÖNCELİK SIRALAMASI: 'Hangi ödevden başlamalıyım?' diye sorarsa, teslim tarihi en yakın olan ve zorlandığı derse öncelik vererek yol haritası çiz.\n` +
      `5. ROZET VE ÖVGÜ: Öğrenci zamanında iş bitiriyorsa sanal başarı rozetleri (Örn: 'Planlama Ustası') hediye et.\n` + 
      `6. ÖĞRETMEN SINIF ANALİZİ İSTERSE: Sınıfın genel durumunu değerlendir. Hangi derslerde teslim oranının düşük veya notların kötü olduğuna bakarak öğretmene tavsiye ver (Örn: 'Matematik ödevinde sınıfın %70'i zorlanmış, konuyu tekrar etmeyi düşünebilirsiniz').\n\n`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt + contextText },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 1024,
    });
    
    res.json({ ok: true, reply: chatCompletion.choices[0]?.message?.content || "Cevap üretilemedi." });

  } catch(e) {
    console.error("AI Hatası:", e.message || e);
    let errorMsg = "Şu an bağlantı kuramıyorum, lütfen biraz sonra tekrar dene.";
    if (e.message && e.message.includes("429")) {
      errorMsg = "Çok fazla istek gönderildi, lütfen birkaç saniye bekleyip tekrar dene. ⏳";
    }
    res.json({ ok: true, reply: errorMsg });
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
// USER PROFILE API
// ============================
app.get("/api/users/profile", authRequired, (req, res) => {
  const user = db.users.find(u => u.id === req.auth.userId);
  if (!user) return res.status(404).json({ ok: false, message: "Kullanıcı bulunamadı." });
  
  res.json({
    ok: true,
    profile: {
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      schoolNumber: user.schoolNumber || "",
      address: user.address || "",
      bio: user.bio || "",
      avatarUrl: user.avatarUrl || null
    }
  });
});

app.put("/api/users/profile", authRequired, (req, res) => {
  const user = db.users.find(u => u.id === req.auth.userId);
  if (!user) return res.status(404).json({ ok: false, message: "Kullanıcı bulunamadı." });

  const { phone, schoolNumber, address, bio, email } = req.body;
  if (phone !== undefined) user.phone = safeName(phone);
  if (schoolNumber !== undefined) user.schoolNumber = safeName(schoolNumber);
  if (address !== undefined) user.address = safeName(address);
  if (bio !== undefined) user.bio = safeName(bio);
  if (email !== undefined && email.includes("@")) user.email = email.trim();

  res.json({ ok: true, message: "Profil güncellendi.", profile: {
    name: user.name, email: user.email, phone: user.phone, schoolNumber: user.schoolNumber, address: user.address, bio: user.bio, avatarUrl: user.avatarUrl
  }});
});

app.post("/api/users/profile/avatar", authRequired, upload.single("avatar"), (req, res) => {
  const user = db.users.find(u => u.id === req.auth.userId);
  if (!user) return res.status(404).json({ ok: false, message: "Kullanıcı bulunamadı." });

  if (!req.file) return res.status(400).json({ ok: false, message: "Dosya yüklenemedi." });

  const fileId = makeId("avatar");
  db.files.push({
    id: fileId,
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
    originalname: req.file.originalname,
    size: req.file.size
  });

  const url = `/api/files/${fileId}`;
  user.avatarUrl = url;

  res.json({ ok: true, message: "Profil fotoğrafı güncellendi.", avatarUrl: url });
});

app.get("/api/users/profile/:userId", authRequired, (req, res) => {
  // Sadece öğretmenler diğer kullanıcıların detaylı profiline rahatça erişebilir 
  // (veya aynı sınıftaki öğrenciler, ama şimdilik güvenlik için öğretmene özel diyelim, gerçi öğrenciler de görebilir)
  // İstersek rol kontrolü yapabiliriz. Şimdilik sadece bulup dönelim, özel bilgi yok.
  
  const user = db.users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ ok: false, message: "Kullanıcı bulunamadı." });

  res.json({
    ok: true,
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || "Belirtilmemiş",
      schoolNumber: user.schoolNumber || "Belirtilmemiş",
      address: user.address || "Belirtilmemiş",
      bio: user.bio || "Belirtilmemiş",
      avatarUrl: user.avatarUrl || null,
      roles: user.roles
    }
  });
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
    courses: []
  };
  db.classes.push(item);
  res.json({ ok: true, class: item });
});

app.get("/api/classes/mine", authRequired, (req, res) => {
  if (req.auth.role !== "teacher") return res.status(403).json({ ok: false, message: "Sadece öğretmen." });
  const teacherId = String(req.query.teacherId || "").trim() || req.auth.userId;
  if (teacherId !== req.auth.userId) return res.status(403).json({ ok: false, message: "Yetkisiz." });

  const classes = db.classes.filter(c => c.teacherId === teacherId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  
  // Retro-compatibility for existing classes to have courses array
  classes.forEach(c => { if(!c.courses) c.courses = []; });
  
  res.json({ ok: true, classes });
});

app.post("/api/classes/:classId/courses", authRequired, (req, res) => {
  if (req.auth.role !== "teacher") return res.status(403).json({ ok: false, message: "Sadece öğretmen." });
  const classId = req.params.classId;
  const courseName = String(req.body.courseName || "").trim();
  const cls = db.classes.find(c => c.id === classId);
  if (!cls) return res.status(404).json({ ok: false, message: "Sınıf bulunamadı." });
  if (cls.teacherId !== req.auth.userId) return res.status(403).json({ ok: false, message: "Yetkisiz." });
  if (!courseName) return res.status(400).json({ ok: false, message: "Ders adı boş." });

  if (!cls.courses) cls.courses = [];
  if (!cls.courses.includes(courseName)) cls.courses.push(courseName);

  res.json({ ok: true, class: cls });
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

// Sınıftaki öğrencileri listeleme (Artık öğrenciler de grup kurmak için listeyi görebilmeli)
app.get("/api/classes/members", authRequired, (req, res) => {
  const classId = String(req.query.classId || "").trim();
  if (!classId) return res.json({ ok: true, members: [] });

  // İlgili sınıftaki tüm üyeleri filtrele
  const members = db.class_members.filter(m => m.classId === classId).map(m => {
    const user = db.users.find(u => u.id === m.studentId);
    let status = "offline";
    if (user && user.lastSeen) {
      const diffMin = (new Date() - new Date(user.lastSeen)) / 60000;
      if (diffMin < 2) {
        status = user.status === "idle" ? "idle" : "active";
      }
    }
    
    // YENİ: Performans ve Rozet Analizi
    const performance = calcStudentPerformance(classId, m.studentId);

    return { ...m, status, performance };
  });
  res.json({ ok: true, members });
});

// YENİ: Öğrenci Aktivite Durumu Güncelleme
app.post("/api/users/ping", authRequired, (req, res) => {
  const user = db.users.find(u => u.id === req.auth.userId);
  if (user) {
    user.lastSeen = new Date().toISOString();
    user.status = req.body.status || "active"; 
  }
  res.json({ ok: true });
});

// ==========================================
// CANLI DERS & QUIZ API (YENİ EKLENTİ)
// ==========================================

// Bellekte tutulacak canlı ders durumu
db.activeLessons = [];

// Öğretmen: Canlı Dersi Başlat
app.post("/api/live/start", authRequired, (req, res) => {
  const { classId, link } = req.body;
  if (!classId || !link) return res.status(400).json({ ok: false, message: "Sınıf ve link gerekli." });
  
  db.activeLessons = db.activeLessons.filter(l => l.classId !== classId);
  db.activeLessons.push({ classId, teacherId: req.auth.userId, link, startTime: new Date().toISOString(), attendees: [], activeQuiz: null });
  res.json({ ok: true, message: "Ders başlatıldı." });
});

// Öğretmen: Canlı Dersi Bitir
app.post("/api/live/end", authRequired, (req, res) => {
  const { classId } = req.body;
  db.activeLessons = db.activeLessons.filter(l => l.classId !== classId);
  res.json({ ok: true });
});

// Öğrenci / Öğretmen: Aktif ders durumunu çek
app.get("/api/live/status", authRequired, (req, res) => {
  const classId = req.query.classId;
  const lesson = db.activeLessons.find(l => l.classId === classId);
  if (!lesson) return res.json({ ok: true, active: false });
  res.json({ ok: true, active: true, lesson });
});

// Öğrenci: Derse Katıl (Yoklama)
app.post("/api/live/join", authRequired, (req, res) => {
  const { classId } = req.body;
  const lesson = db.activeLessons.find(l => l.classId === classId);
  if (lesson) {
    if (!lesson.attendees.includes(req.auth.userId)) lesson.attendees.push(req.auth.userId);
    const user = db.users.find(u => u.id === req.auth.userId);
    if (user) { user.status = "busy"; user.lastSeen = new Date().toISOString(); } // Derste olan Yoğun Gözükür
  }
  res.json({ ok: true });
});

// Öğretmen: Quiz Gönder
app.post("/api/quiz/publish", authRequired, (req, res) => {
  const { classId, question, options, correctAnswer } = req.body;
  const lesson = db.activeLessons.find(l => l.classId === classId);
  if (!lesson) return res.status(400).json({ ok: false, message: "Aktif bir ders bulunamadı." });
  lesson.activeQuiz = { id: Date.now().toString(), question, options, correctAnswer: correctAnswer || "", answers: [] };
  res.json({ ok: true });
});

// Öğrenci: Quiz Cevapla
app.post("/api/quiz/submit", authRequired, (req, res) => {
  const { classId, quizId, choice } = req.body;
  const lesson = db.activeLessons.find(l => l.classId === classId);
  if (lesson && lesson.activeQuiz && lesson.activeQuiz.id === quizId) {
    const existing = lesson.activeQuiz.answers.find(a => a.studentId === req.auth.userId);
    if (existing) existing.choice = choice;
    else lesson.activeQuiz.answers.push({ studentId: req.auth.userId, choice });
    
    const correctAnswer = lesson.activeQuiz.correctAnswer || "";
    const isCorrect = correctAnswer && choice.trim() === correctAnswer.trim();
    return res.json({ ok: true, isCorrect, correctAnswer });
  }
  res.json({ ok: true });
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
      isPresentation: req.body.isPresentation === "true"
    };

    db.submissions.push(item);

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

  db.notifications.push({ 
    id: makeId("nt"), 
    toUserId: sub.studentId, 
    text: `${sub.course} ödevin notlandırıldı. Notun: ${sub.grade}`, 
    createdAt: new Date().toISOString() 
  });

  res.json({ ok: true });
});

// YENİ: Öğrenci Kendi Performansını Çekebilsin
app.get("/api/student/performance", authRequired, (req, res) => {
  if (req.auth.role !== "student") return res.status(403).json({ ok: false });
  const classId = String(req.query.classId || "").trim();
  if (!classId) return res.status(400).json({ ok: false });
  const performance = calcStudentPerformance(classId, req.auth.userId);
  res.json({ ok: true, performance });
});

// YENİ: Öğretmen Öğrencinin Performans Notunu Elle Düzenler (Override)
app.put("/api/teacher/performance-override", authRequired, express.json(), (req, res) => {
  if (req.auth.role !== "teacher") return res.status(403).json({ ok: false });
  const { classId, studentId, score } = req.body;
  if (!classId || !studentId || score === undefined) return res.status(400).json({ ok: false });
  
  // Sınıfın öğretmeni mi?
  const cls = db.classes.find(c => c.id === classId);
  if (!cls || cls.teacherId !== req.auth.userId) return res.status(403).json({ ok: false, msg: "Yetkisiz." });

  let override = db.performanceOverrides.find(o => o.classId === classId && o.studentId === studentId);
  if (!override) {
    override = { classId, studentId, score: Number(score) };
    db.performanceOverrides.push(override);
  } else {
    override.score = Number(score);
  }

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