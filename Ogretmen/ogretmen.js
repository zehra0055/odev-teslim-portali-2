"use strict";

/**
 * ✅ ÖĞRETMEN PANEL JS (FULL BACKEND + BİLDİRİM + 1'e 1 CHAT)
 * - Auth: token/role/user localStorage
 * - Classes: BACKEND (mine/create)
 * - Members: BACKEND (by class)
 * - Assignments: BACKEND (create/list by class)
 * - Submissions: BACKEND (list by class + review)
 * - Live: Notifications (Read & Clear), Chat (Teacher ↔ Select Student)
 */

// Sunucu URL'miz
const API_BASE = "http://localhost:3000"; 

// ========= AUTH GUARD =========
const token = localStorage.getItem("token");
const role = localStorage.getItem("role");
let me = null;

try {
  me = JSON.parse(localStorage.getItem("user") || "null");
} catch {
  me = null;
}

if (!token || role !== "teacher" || !me) {
  window.location.replace("/Ogretmen/ogretmen-giris.html");
}

// ========= HELPERS =========
function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString("tr-TR");
  } catch {
    return iso;
  }
}

function fmtOnlyDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("tr-TR");
  } catch {
    return iso;
  }
}

function setAlert(el, type, text) {
  if (!el) return;
  el.hidden = false;
  el.classList.remove("ok", "err");
  el.classList.add(type);
  el.textContent = text;
}

function clearAlert(el) {
  if (!el) return;
  el.hidden = true;
  el.classList.remove("ok", "err");
  el.textContent = "";
}

function pillForStatus(s) {
  if (s === "graded") return `<span class="pill ok">Notlandırıldı</span>`;
  return `<span class="pill warn">Bekliyor</span>`;
}

// ========= API =========
async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };

  const method = (options.method || "GET").toUpperCase();
  const hasBody = options.body !== undefined && options.body !== null;

  if (hasBody) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(API_BASE + path, { ...options, method, headers });
  } catch(e) {
    throw new Error("Sunucuya ulaşılamıyor. Arka plan açık mı?");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = data?.message || `İstek başarısız: ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

// ========= DOM =========
const who = document.getElementById("who");
const logoutBtn = document.getElementById("logoutBtn");

const navBtns = document.querySelectorAll(".navbtn");
const views = {
  dashboard: document.getElementById("view-dashboard"),
  assignments: document.getElementById("view-assignments"),
  submissions: document.getElementById("view-submissions"),
  students: document.getElementById("view-students"),
};

const classSelect = document.getElementById("classSelect");
const activeClassChip = document.getElementById("activeClassChip");
const assignClassChip = document.getElementById("assignClassChip");
const subClassChip = document.getElementById("subClassChip");
const studClassChip = document.getElementById("studClassChip");

// KPIs
const kpiStudents = document.getElementById("kpiStudents");
const kpiAssignments = document.getElementById("kpiAssignments");
const kpiSubmissions = document.getElementById("kpiSubmissions");
const kpiPending = document.getElementById("kpiPending");

// Dashboard lists
const lastSubmissions = document.getElementById("lastSubmissions");
const emptyLast = document.getElementById("emptyLast");
const goSubmissions = document.getElementById("goSubmissions");

// Assignment forms
const quickAssignmentForm = document.getElementById("quickAssignmentForm");
const qaCourse = document.getElementById("qaCourse");
const qaDue = document.getElementById("qaDue");
const qaTitle = document.getElementById("qaTitle");
const qaDesc = document.getElementById("qaDesc");
const qaAlert = document.getElementById("qaAlert");

const assignmentForm = document.getElementById("assignmentForm");
const aCourse = document.getElementById("aCourse");
const aDue = document.getElementById("aDue");
const aTitle = document.getElementById("aTitle");
const aDesc = document.getElementById("aDesc");
const aAlert = document.getElementById("aAlert");

const assignmentList = document.getElementById("assignmentList");
const emptyAssignments = document.getElementById("emptyAssignments");

// Submissions
const submissionList = document.getElementById("submissionList");
const emptySubmissions = document.getElementById("emptySubmissions");
const filterCourse = document.getElementById("filterCourse");
const filterStatus = document.getElementById("filterStatus");

// Detail
const detailEmpty = document.getElementById("detailEmpty");
const detailBox = document.getElementById("detailBox");
const dTitle = document.getElementById("dTitle");
const dSub = document.getElementById("dSub");
const dStatus = document.getElementById("dStatus");
const dStudent = document.getElementById("dStudent");
const dCourse = document.getElementById("dCourse");
const dFile = document.getElementById("dFile");
const dDate = document.getElementById("dDate");
const gradeInput = document.getElementById("gradeInput");
const statusInput = document.getElementById("statusInput");
const feedbackInput = document.getElementById("feedbackInput");
const saveReviewBtn = document.getElementById("saveReviewBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const reviewAlert = document.getElementById("reviewAlert");

// Students list
const studentList = document.getElementById("studentList");
const emptyStudents = document.getElementById("emptyStudents");

// Modals
const openCreateClass = document.getElementById("openCreateClass");
const openClassInfo = document.getElementById("openClassInfo");

const createClassModal = document.getElementById("createClassModal");
const createClassForm = document.getElementById("createClassForm");
const className = document.getElementById("className");
const classDesc = document.getElementById("classDesc");
const classCreateAlert = document.getElementById("classCreateAlert");

const classInfoModal = document.getElementById("classInfoModal");
const infoClassName = document.getElementById("infoClassName");
const infoClassCode = document.getElementById("infoClassCode");
const infoClassDesc = document.getElementById("infoClassDesc");
const copyClassCode = document.getElementById("copyClassCode");
const copyAlert = document.getElementById("copyAlert");

// ========= STATE =========
let activeClassId = null;
let selectedSubmissionId = null;
let selectedChatStudentId = null; // YENİ: Öğretmenin sohbet için seçtiği öğrenci

let classesCache = [];
let membersCache = [];
let assignmentsCache = [];
let submissionsCache = [];

// ========= DATA LAYER (BACKEND) =========
async function getClasses() {
  const data = await apiFetch(`/api/classes/mine?teacherId=${encodeURIComponent(me.id)}`);
  return Array.isArray(data?.classes) ? data.classes : [];
}

async function getMembersByClass(classId) {
  const data = await apiFetch(`/api/classes/members?classId=${encodeURIComponent(classId)}`);
  return Array.isArray(data?.members) ? data.members : [];
}

async function getAssignmentsByClass(classId) {
  const data = await apiFetch(`/api/assignments/by-class?classId=${encodeURIComponent(classId)}`);
  return Array.isArray(data?.assignments) ? data.assignments : [];
}

async function createAssignmentApi({ classId, course, title, desc, due }) {
  const body = {
    classId,
    course: (course || "").trim(),
    title: (title || "").trim(),
    desc: (desc || "").trim(),
    due: due ? new Date(due).toISOString() : "",
  };

  const data = await apiFetch(`/api/assignments/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return data?.assignment || null;
}

async function getSubmissionsByClass(classId) {
  const data = await apiFetch(`/api/teacher/submissions?classId=${encodeURIComponent(classId)}`);
  return Array.isArray(data?.submissions) ? data.submissions : [];
}

async function reviewSubmissionApi({ submissionId, grade, status, feedback }) {
  const body = {
    submissionId,
    grade,
    status,
    feedback,
  };

  const data = await apiFetch(`/api/teacher/submissions/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return data?.submission || null;
}

// ========= YENİ: BİLDİRİM & SOHBET (ÖĞRENCİ SEÇMELİ & SIFIRLAMALI) =========
async function loadNotifications() {
  try {
    const data = await apiFetch("/api/notifications");
    const list = document.getElementById("notifList");
    const badge = document.getElementById("notifBadge");
    if(!list) return;
    
    if(!data.notifications || data.notifications.length === 0) {
      list.innerHTML = '<div class="notif-item">Henüz bildirim yok.</div>';
      if(badge) badge.hidden = true; // Kırmızı baloncuk tamamen gizlenir
      return;
    }
    
    if(badge) { 
      badge.textContent = data.notifications.length; 
      badge.hidden = false; 
    }
    
    list.innerHTML = "";
    data.notifications.reverse().forEach(n => {
      const div = document.createElement("div");
      div.className = "notif-item unread";
      
      let icon = "🔔";
      if(n.text.includes("mesaj")) icon = "💬";
      if(n.text.includes("teslim")) icon = "📥";

      div.innerHTML = `<div class="notif-icon">${icon}</div><div class="notif-content"><div class="notif-text">${n.text}</div><div class="notif-time">${fmtDate(n.createdAt)}</div></div>`;
      list.appendChild(div);
    });
  } catch(e) {
    console.error("Bildirim hatası:", e);
  }
}

// Sohbet için öğrenci listesini açılır menüye doldur
function fillChatStudents() {
  const sel = document.getElementById("chatStudentSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Öğrenci Seçin --</option>';
  
  if (membersCache && membersCache.length > 0) {
    membersCache.forEach(m => {
      sel.innerHTML += `<option value="${m.studentId}">${m.studentName}</option>`;
    });
  }
  
  if(selectedChatStudentId) {
    sel.value = selectedChatStudentId;
  }
}

async function loadChat() {
  const body = document.getElementById("chatBody");
  
  // Eğer sınıf yoksa veya öğrenci seçilmemişse uyarı ver
  if(!activeClassId || !selectedChatStudentId) {
    if(body) body.innerHTML = `<div style="text-align:center; color:#64748b; font-size:12px; margin-top:20px;">Sohbet etmek için yukarıdan bir öğrenci seçin...</div>`;
    return;
  }

  try {
    const data = await apiFetch(`/api/chat/${activeClassId}`);
    if(!body) return;
    
    // Yalnızca Öğretmen (kendisi) ile Seçili Öğrenci arasındaki mesajları filtrele
    const filteredMsgs = (data.messages || []).filter(m => 
      (m.senderId === me.id && m.receiverId === selectedChatStudentId) ||
      (m.senderId === selectedChatStudentId && m.receiverId === me.id)
    );

    if(filteredMsgs.length === 0) {
      body.innerHTML = `<div style="text-align:center; color:#64748b; font-size:12px; margin-top:20px;">Bu öğrenciyle mesajlaşma başlatın...</div>`;
      return;
    }

    body.innerHTML = "";
    filteredMsgs.forEach(m => {
      const isMine = m.senderId === me.id;
      const div = document.createElement("div");
      div.className = `w-msg ${isMine ? 'mine' : 'others'}`;
      div.innerHTML = `<span class="w-sender">${isMine ? '' : m.senderName}</span><div class="w-bubble">${m.text}</div>`;
      body.appendChild(div);
    });
    body.scrollTop = body.scrollHeight;
  } catch(e) {
    console.error("Chat hatası:", e);
  }
}

async function sendChat() {
  const inp = document.getElementById("chatInput");
  if(!inp || !inp.value.trim() || !activeClassId) return;

  if(!selectedChatStudentId) {
    alert("Lütfen kime mesaj göndereceğini seçmek için yukarıdan bir öğrenci seçin.");
    return;
  }
  
  const text = inp.value.trim();
  inp.value = ""; 
  
  const body = document.getElementById("chatBody");
  if(body) {
    if(body.innerHTML.includes("öğrenci seçin") || body.innerHTML.includes("mesajlaşma başlatın")) body.innerHTML = "";
    body.innerHTML += `<div class="w-msg mine"><div class="w-bubble">${text}</div></div>`;
    body.scrollTop = body.scrollHeight;
  }

  try {
    // Alıcı olarak seçilen öğrencinin ID'sini (receiverId) arka plana gönderiyoruz
    await apiFetch("/api/chat", { 
      method: "POST", 
      body: JSON.stringify({ classId: activeClassId, text: text, receiverId: selectedChatStudentId }) 
    });
    loadChat();
  } catch(e) {
    console.error("Mesaj gönderilemedi:", e);
  }
}

// ========= UI / NAV =========
function setView(name) {
  navBtns.forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  Object.entries(views).forEach(([k, el]) => el.classList.toggle("active", k === name));
}

function setActiveClassChip() {
  const cls = classesCache.find((c) => c.id === activeClassId);
  const label = cls ? `Sınıf: ${cls.name}` : "Sınıf: —";
  if (activeClassChip) activeClassChip.textContent = label;
  if (assignClassChip) assignClassChip.textContent = label;
  if (subClassChip) subClassChip.textContent = label;
  if (studClassChip) studClassChip.textContent = label;
}

async function fillClassSelect() {
  if (!classSelect) return;
  classSelect.innerHTML = "";

  try {
    classesCache = (await getClasses()).sort((a, b) =>
      (a.createdAt || "").localeCompare(b.createdAt || "")
    );
  } catch (err) {
    console.error(err);
    classesCache = [];
  }

  if (!classesCache.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Önce sınıf oluştur";
    classSelect.appendChild(opt);
    classSelect.disabled = true;
    activeClassId = null;
    setActiveClassChip();
    return;
  }

  classSelect.disabled = false;

  classesCache.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.code})`;
    classSelect.appendChild(opt);
  });

  if (!activeClassId || !classesCache.some((c) => c.id === activeClassId)) {
    activeClassId = classesCache[0].id;
  }

  classSelect.value = activeClassId;
  setActiveClassChip();
}

function requireActiveClass() {
  if (!activeClassId) {
    alert("Önce bir sınıf oluşturmalısın.");
    return false;
  }
  return true;
}

// ========= RENDER =========
function renderKPIs() {
  if (!activeClassId) {
    if(kpiStudents) kpiStudents.textContent = "0";
    if(kpiAssignments) kpiAssignments.textContent = "0";
    if(kpiSubmissions) kpiSubmissions.textContent = "0";
    if(kpiPending) kpiPending.textContent = "0";
    return;
  }

  const members = membersCache;
  const as = assignmentsCache;
  const subs = submissionsCache;
  const pending = subs.filter((s) => s.status !== "graded").length;

  if(kpiStudents) kpiStudents.textContent = members.length.toLocaleString("tr-TR");
  if(kpiAssignments) kpiAssignments.textContent = as.length.toLocaleString("tr-TR");
  if(kpiSubmissions) kpiSubmissions.textContent = subs.length.toLocaleString("tr-TR");
  if(kpiPending) kpiPending.textContent = pending.toLocaleString("tr-TR");
}

function renderAssignmentList() {
  if(!assignmentList) return;
  assignmentList.innerHTML = "";

  if (!activeClassId) {
    if(emptyAssignments) emptyAssignments.hidden = false;
    return;
  }

  const as = (assignmentsCache || []).slice().sort((x, y) =>
    (y.createdAt || "").localeCompare(x.createdAt || "")
  );

  if (!as.length) {
    if(emptyAssignments) emptyAssignments.hidden = false;
    return;
  }

  if(emptyAssignments) emptyAssignments.hidden = true;

  as.forEach((a) => {
    const el = document.createElement("div");
    el.className = "rowcard";
    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${a.course} — ${a.title}</div>
        <div class="subline">
          Son: ${a.due ? fmtOnlyDate(a.due) : "—"} • ${
      a.desc ? a.desc.slice(0, 72) + (a.desc.length > 72 ? "…" : "") : ""
    }
        </div>
      </div>
      <span class="pill">Ödev</span>
    `;
    assignmentList.appendChild(el);
  });
}

function renderLastSubmissions() {
  if(!lastSubmissions) return;
  lastSubmissions.innerHTML = "";

  if (!activeClassId) {
    if(emptyLast) emptyLast.hidden = false;
    return;
  }

  const subs = (submissionsCache || [])
    .slice()
    .sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""))
    .slice(0, 4);

  if (!subs.length) {
    if(emptyLast) emptyLast.hidden = false;
    return;
  }

  if(emptyLast) emptyLast.hidden = true;

  subs.forEach((s) => {
    const fileName = s.originalFileName || s.fileName || "İsimsiz Dosya"; 
    const el = document.createElement("div");
    el.className = "rowcard";
    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${s.studentName} • ${s.course}</div>
        <div class="subline">${fileName} • ${fmtDate(s.submittedAt)}</div>
      </div>
      ${pillForStatus(s.status)}
    `;
    el.addEventListener("click", () => {
      setView("submissions");
      selectSubmission(s.id);
    });
    lastSubmissions.appendChild(el);
  });
}

function applySubmissionFilters(list) {
  const c = (filterCourse?.value || "").trim().toLowerCase();
  const st = filterStatus?.value || "all";

  return list.filter((s) => {
    const courseOk = !c || (s.course || "").toLowerCase().includes(c);
    const statusOk = st === "all" ? true : s.status === st;
    return courseOk && statusOk;
  });
}

function renderSubmissionList() {
  if(!submissionList) return;
  submissionList.innerHTML = "";

  if (!activeClassId) {
    if(emptySubmissions) emptySubmissions.hidden = false;
    return;
  }

  const all = (submissionsCache || [])
    .slice()
    .sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));

  const subs = applySubmissionFilters(all);

  if (!subs.length) {
    if(emptySubmissions) emptySubmissions.hidden = false;
    return;
  }

  if(emptySubmissions) emptySubmissions.hidden = true;

  subs.forEach((s) => {
    const fileName = s.originalFileName || s.fileName || "İsimsiz Dosya"; 
    const el = document.createElement("div");
    el.className = "rowcard";
    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${s.studentName} • ${s.course}</div>
        <div class="subline">${s.title} • ${fileName}</div>
        <div class="subline">Teslim: ${fmtDate(s.submittedAt)}</div>
      </div>
      ${pillForStatus(s.status)}
    `;
    el.addEventListener("click", () => selectSubmission(s.id));
    submissionList.appendChild(el);
  });
}

function renderStudentList() {
  if(!studentList) return;
  studentList.innerHTML = "";

  if (!activeClassId) {
    if(emptyStudents) emptyStudents.hidden = false;
    return;
  }

  const members = (membersCache || [])
    .slice()
    .sort((a, b) => (a.studentName || "").localeCompare(b.studentName || ""));

  if (!members.length) {
    if(emptyStudents) emptyStudents.hidden = false;
    return;
  }

  if(emptyStudents) emptyStudents.hidden = true;

  members.forEach((m) => {
    const el = document.createElement("div");
    el.className = "rowcard";
    el.style.cursor = "default";
    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${m.studentName}</div>
        <div class="subline">Katılım: ${fmtDate(m.joinedAt)}</div>
      </div>
      <span class="pill">Üye</span>
    `;
    studentList.appendChild(el);
  });
}

// ========= DETAIL =========
function clearSelection() {
  selectedSubmissionId = null;
  if(detailBox) detailBox.hidden = true;
  if(detailEmpty) detailEmpty.hidden = false;
  clearAlert(reviewAlert);
}

function selectSubmission(id) {
  if (!activeClassId) return;

  const s = (submissionsCache || []).find((x) => x.id === id);
  if (!s) return;

  selectedSubmissionId = id;

  if(detailEmpty) detailEmpty.hidden = true;
  if(detailBox) detailBox.hidden = false;

  const fileName = s.originalFileName || s.fileName || "İsimsiz Dosya";

  if(dTitle) dTitle.textContent = `${s.course} — ${s.title}`;
  if(dSub) dSub.textContent = fileName;
  if(dStudent) dStudent.textContent = s.studentName;
  if(dCourse) dCourse.textContent = s.course;
  
  if (dFile) {
    if (s.fileUrl) {
      dFile.innerHTML = `<a href="${API_BASE}${s.fileUrl}" target="_blank" rel="noopener">Dosyayı Görüntüle / İndir</a>`;
    } else {
      dFile.textContent = "Dosya bulunamadı";
    }
  }
  
  if(dDate) dDate.textContent = fmtDate(s.submittedAt);

  if (dStatus) {
    if (s.status === "graded") {
      dStatus.textContent = "Notlandırıldı";
      dStatus.className = "pill ok";
    } else {
      dStatus.textContent = "Bekliyor";
      dStatus.className = "pill warn";
    }
  }

  if(gradeInput) gradeInput.value = (s.grade ?? "") === "" ? "" : String(s.grade);
  if(statusInput) statusInput.value = s.status || "pending";
  if(feedbackInput) feedbackInput.value = s.feedback || "";

  clearAlert(reviewAlert);
}

async function saveReview() {
  if (!activeClassId || !selectedSubmissionId) return;

  clearAlert(reviewAlert);

  const gradeRaw = gradeInput?.value.trim() || "";
  const status = statusInput?.value || "pending";
  const feedback = feedbackInput?.value.trim() || "";

  let grade = "";
  if (gradeRaw !== "") {
    const n = Number(gradeRaw);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      setAlert(reviewAlert, "err", "Not 0-100 arasında olmalı.");
      return;
    }
    grade = Math.round(n);
  }

  try {
    await reviewSubmissionApi({
      submissionId: selectedSubmissionId,
      grade,
      status,
      feedback,
    });

    setAlert(reviewAlert, "ok", "Değerlendirme kaydedildi.");

    await refreshAll(true);
    selectSubmission(selectedSubmissionId);
  } catch (err) {
    console.error(err);
    setAlert(reviewAlert, "err", err.message || "Kaydedilemedi.");
  }
}

// ========= MODALS =========
function openModal(modalEl) {
  if(!modalEl) return;
  modalEl.classList.add("open");
  modalEl.setAttribute("aria-hidden", "false");
}
function closeModal(modalEl) {
  if(!modalEl) return;
  modalEl.classList.remove("open");
  modalEl.setAttribute("aria-hidden", "true");
}
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-close");
    const el = document.getElementById(id);
    if (el) closeModal(el);
  });
});
[createClassModal, classInfoModal].forEach((m) => {
  if(!m) return;
  m.addEventListener("click", (e) => {
    if (e.target === m) closeModal(m);
  });
});

// ========= CLASS ACTIONS =========
openCreateClass?.addEventListener("click", () => {
  clearAlert(classCreateAlert);
  if(className) className.value = "";
  if(classDesc) classDesc.value = "";
  openModal(createClassModal);
});

createClassForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(classCreateAlert);

  const name = className?.value.trim() || "";
  const desc = classDesc?.value.trim() || "";

  if (!name) {
    setAlert(classCreateAlert, "err", "Sınıf adı zorunlu.");
    return;
  }

  try {
    const data = await apiFetch("/api/classes/create", {
      method: "POST",
      body: JSON.stringify({
        name,
        desc
      }),
    });

    const newClass = data?.class;
    if (!newClass?.id) {
      setAlert(classCreateAlert, "err", "Sınıf oluşturuldu ama veri dönmedi.");
      return;
    }

    setAlert(classCreateAlert, "ok", `Sınıf oluşturuldu. Kod: ${newClass.code}`);

    await fillClassSelect();
    activeClassId = newClass.id;
    if(classSelect) classSelect.value = activeClassId;
    setActiveClassChip();

    setTimeout(() => closeModal(createClassModal), 600);
    await refreshAll(true);
  } catch (err) {
    console.error(err);
    setAlert(classCreateAlert, "err", err.message || "Sınıf oluşturulamadı.");
  }
});

openClassInfo?.addEventListener("click", () => {
  if (!requireActiveClass()) return;

  const cls = classesCache.find((c) => c.id === activeClassId);
  if (!cls) return;

  if(infoClassName) infoClassName.textContent = cls.name;
  if(infoClassCode) infoClassCode.textContent = cls.code;
  if(infoClassDesc) infoClassDesc.textContent = cls.desc || "—";
  clearAlert(copyAlert);

  openModal(classInfoModal);
});

copyClassCode?.addEventListener("click", async () => {
  if(!infoClassCode) return;
  const code = infoClassCode.textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    setAlert(copyAlert, "ok", "Kod kopyalandı.");
  } catch {
    setAlert(copyAlert, "err", "Kopyalanamadı. Kodu manuel kopyala.");
  }
});

// ========= ASSIGNMENT CREATE =========
async function onCreateAssignment(course, title, desc, due, alertEl, resetFn) {
  clearAlert(alertEl);
  if (!requireActiveClass()) return;

  if (!course.trim() || !title.trim() || !due) {
    setAlert(alertEl, "err", "Ders, başlık ve son tarih zorunlu.");
    return;
  }

  try {
    await createAssignmentApi({
      classId: activeClassId,
      course,
      title,
      desc,
      due,
    });

    setAlert(alertEl, "ok", "Ödev oluşturuldu.");
    resetFn?.();

    await refreshAll(true);
  } catch (err) {
    console.error(err);
    setAlert(alertEl, "err", err.message || "Ödev oluşturulamadı.");
  }
}

quickAssignmentForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  onCreateAssignment(
    qaCourse?.value || "",
    qaTitle?.value || "",
    qaDesc?.value || "",
    qaDue?.value || "",
    qaAlert,
    () => {
      if(qaCourse) qaCourse.value = "";
      if(qaTitle) qaTitle.value = "";
      if(qaDesc) qaDesc.value = "";
      if(qaDue) qaDue.value = "";
    }
  );
});

assignmentForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  onCreateAssignment(
    aCourse?.value || "",
    aTitle?.value || "",
    aDesc?.value || "",
    aDue?.value || "",
    aAlert,
    () => {
      if(aCourse) aCourse.value = "";
      if(aTitle) aTitle.value = "";
      if(aDesc) aDesc.value = "";
      if(aDue) aDue.value = "";
    }
  );
});

// ========= EVENTS =========
if(who) who.textContent = me?.name ? `👨‍🏫 ${me.name}` : "👨‍🏫 Öğretmen";

logoutBtn?.addEventListener("click", () => {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("user");
  window.location.replace("/Ogretmen/ogretmen-giris.html");
});

navBtns.forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

classSelect?.addEventListener("change", async () => {
  activeClassId = classSelect.value || null;
  selectedChatStudentId = null; // Sınıf değişince sohbet öğrenci seçimini sıfırla
  setActiveClassChip();
  clearSelection();
  await refreshAll(true);
});

goSubmissions?.addEventListener("click", () => setView("submissions"));

filterCourse?.addEventListener("input", () => renderSubmissionList());
filterStatus?.addEventListener("change", () => renderSubmissionList());

clearSelectionBtn?.addEventListener("click", clearSelection);
saveReviewBtn?.addEventListener("click", saveReview);

// Chat & Bildirim UI Eventleri
document.addEventListener("DOMContentLoaded", () => {
  const notifBtn = document.getElementById('notifBtn');
  const notifDropdown = document.getElementById('notifDropdown');
  if(notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', async () => { 
      notifDropdown.hidden = !notifDropdown.hidden; 
      
      // Bildirim kutusu AÇILDIĞINDA bildirimleri okundu say ve sayıyı gizle
      if (!notifDropdown.hidden) {
        try {
          await apiFetch("/api/notifications/read", { method: "POST" });
          const badge = document.getElementById("notifBadge");
          if(badge) badge.hidden = true;
        } catch(e) {}
      }
    });
  }

  const chatBtn = document.getElementById('chatBtn');
  const chatPanel = document.getElementById('chatPanel');
  const closeChat = document.getElementById('closeChat');
  if(chatBtn) chatBtn.addEventListener('click', () => { 
    if(chatPanel) chatPanel.hidden = false; 
    loadChat(); 
  });
  if(closeChat) closeChat.addEventListener('click', () => { if(chatPanel) chatPanel.hidden = true; });

  const chatInput = document.getElementById("chatInput");
  const sendChatBtn = document.getElementById("sendChatBtn");
  if(chatInput) chatInput.addEventListener("keypress", (e) => { if(e.key === 'Enter') sendChat(); });
  if(sendChatBtn) sendChatBtn.addEventListener("click", sendChat);

  // Öğrenci seçimi değiştiğinde
  const chatStudentSelect = document.getElementById("chatStudentSelect");
  if(chatStudentSelect) {
    chatStudentSelect.addEventListener("change", (e) => {
      selectedChatStudentId = e.target.value;
      loadChat(); // Seçilen öğrenciye göre sohbeti hemen yükle
    });
  }
});

// ========= REFRESH =========
async function refreshAll(fetchFresh = false) {
  if (!activeClassId) {
    membersCache = [];
    assignmentsCache = [];
    submissionsCache = [];
    setActiveClassChip();
    renderKPIs();
    renderAssignmentList();
    renderSubmissionList();
    renderLastSubmissions();
    renderStudentList();
    fillChatStudents();
    return;
  }

  setActiveClassChip();

  if (fetchFresh) {
    const [members, assignments, submissions] = await Promise.allSettled([
      getMembersByClass(activeClassId),
      getAssignmentsByClass(activeClassId),
      getSubmissionsByClass(activeClassId),
    ]);

    membersCache = members.status === "fulfilled" ? members.value : [];
    assignmentsCache = assignments.status === "fulfilled" ? assignments.value : [];
    submissionsCache = submissions.status === "fulfilled" ? submissions.value : [];
  }

  renderKPIs();
  renderAssignmentList();
  renderSubmissionList();
  renderLastSubmissions();
  renderStudentList();
  fillChatStudents(); // Öğrenci listesini açılır menüye doldur
  loadChat(); // Sınıf değişince ilgili sınıfın chat'i yüklenir
}

// ========= BOOT =========
(async function boot() {
  try {
    await fillClassSelect();
  } catch (e) {
    console.error(e);
  }

  setActiveClassChip();
  setView("dashboard");
  clearSelection();

  if(activeClassId) {
    await refreshAll(true);
  }
  
  loadNotifications();

  // Arka planda 5 saniyede bir yeni mesaj ve bildirimleri çek
  setInterval(() => {
    if (activeClassId && document.getElementById('chatPanel') && !document.getElementById('chatPanel').hidden) {
      loadChat(); 
    }
    loadNotifications();
  }, 5000);
})();