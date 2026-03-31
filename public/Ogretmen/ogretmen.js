"use strict";

/**
 * ✅ ÖĞRETMEN PANEL JS (FULL BACKEND + BİLDİRİM + 1'e 1 CHAT + GRUPLAR VE AYARLAR)
 */

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
  groups: document.getElementById("view-groups"), // YENİ EKLENDİ
  graphs: document.getElementById("view-graphs"),
  live: document.getElementById("view-live")
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
let selectedChatStudentId = null; 
let activeGroupId = null; // YENİ: Öğretmenin o an baktığı grup

let classesCache = [];
let membersCache = [];
let assignmentsCache = [];
let submissionsCache = [];
let groupsCache = []; // YENİ: Gruplar önbelleği

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

// ========= YENİ: GRUP SOHBETİ VE YÖNETİMİ MODÜLÜ (ÖĞRETMEN GOD MODE) =========
async function loadGroups() {
  if(!activeClassId) return;
  try {
    const data = await apiFetch(`/api/groups/${activeClassId}`);
    groupsCache = data.groups || [];
    renderGroupList();
  } catch(e) {}
}

function renderGroupList() {
  const list = document.getElementById("groupList");
  if(!list) return;
  list.innerHTML = "";
  if(groupsCache.length === 0) {
    list.innerHTML = "<div style='color:#64748b; font-size:13px; text-align:center; margin-top:20px;'>Sınıfta henüz öğrenci grubu yok.</div>";
    return;
  }
  groupsCache.forEach(g => {
    const div = document.createElement("div");
    div.className = `group-item ${g.id === activeGroupId ? 'active' : ''}`;
    div.textContent = g.name;
    div.onclick = () => {
      activeGroupId = g.id;
      const titleEl = document.getElementById("activeGroupName");
      if(titleEl) titleEl.textContent = g.name;
      
      const emptyArea = document.getElementById("groupChatEmpty");
      if(emptyArea) emptyArea.hidden = true;
      
      const chatArea = document.getElementById("groupChatArea");
      if(chatArea) chatArea.hidden = false;
      
      const settingsArea = document.getElementById("groupSettingsArea");
      if(settingsArea) settingsArea.hidden = true;
      
      renderGroupList(); 
      loadGroupMessages();
    };
    list.appendChild(div);
  });
}

async function loadGroupMessages() {
  if(!activeGroupId) return;
  const body = document.getElementById("groupChatBody");
  if(!body) return;
  try {
    const data = await apiFetch(`/api/groups/${activeGroupId}/messages`);
    body.innerHTML = "";
    if(data.messages.length === 0) {
      body.innerHTML = "<div style='text-align:center; color:#64748b; margin-top:20px; font-size:13px;'>Grupta henüz mesaj yok.</div>";
      return;
    }
    data.messages.forEach(m => {
      const isMine = m.senderId === me.id;
      let bubbleContent = m.text ? `<div>${m.text}</div>` : "";
      
      if(m.fileUrl) {
        if(m.mimeType && m.mimeType.startsWith("image/")) {
          bubbleContent += `<img src="${API_BASE}${m.fileUrl}" alt="Resim" style="max-width:200px; border-radius:8px; display:block; margin-top:5px; cursor:pointer;" onclick="window.open('${API_BASE}${m.fileUrl}', '_blank')" />`;
        } else {
          bubbleContent += `<a href="${API_BASE}${m.fileUrl}" target="_blank" style="display:inline-block; margin-top:5px; background:rgba(0,0,0,0.1); padding:4px 8px; border-radius:4px; text-decoration:none; color:inherit; font-weight:bold; font-size:12px;">📎 ${m.originalFileName || 'Dosya İndir'}</a>`;
        }
      }

      body.innerHTML += `<div class="w-msg ${isMine ? 'mine' : 'others'}"><span class="w-sender">${isMine ? '' : m.senderName}</span><div class="w-bubble">${bubbleContent}</div></div>`;
    });
    body.scrollTop = body.scrollHeight;
  } catch(e) {}
}

async function sendGroupMessage() {
  const inp = document.getElementById("groupChatInput");
  const fileInput = document.getElementById("groupChatFileInput");
  const file = fileInput ? fileInput.files[0] : null;

  if(!activeGroupId) return;
  if((!inp || !inp.value.trim()) && !file) return;

  const text = inp ? inp.value.trim() : "";
  if(inp) inp.value = "";
  
  if(fileInput) fileInput.value = "";
  const preview = document.getElementById("groupChatFilePreview");
  if(preview) preview.hidden = true;

  const body = document.getElementById("groupChatBody");
  if(body && body.innerHTML.includes("henüz mesaj yok")) body.innerHTML = "";
  if(body) {
    let tempTxt = text;
    if(file) tempTxt += ` <i><br>(📎 ${file.name} yükleniyor...)</i>`;
    body.innerHTML += `<div class="w-msg mine"><div class="w-bubble">${tempTxt}</div></div>`;
    body.scrollTop = body.scrollHeight;
  }

  try {
    const btn = document.getElementById("sendGroupMsgBtn");
    if(btn) { btn.disabled = true; btn.textContent = "..."; }

    const fd = new FormData();
    fd.append("groupId", activeGroupId);
    fd.append("text", text);
    if(file) fd.append("file", file);

    const token = localStorage.getItem("token");
    const res = await fetch("/api/groups/message", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: fd
    });
    if(!res.ok) throw new Error("Grup mesajı gönderilemedi");
    
    if(btn) { btn.disabled = false; btn.textContent = "Gönder"; }
    loadGroupMessages();
  } catch(e) {
    const btn = document.getElementById("sendGroupMsgBtn");
    if(btn) { btn.disabled = false; btn.textContent = "Gönder"; }
  }
}

// Grup Ayarları (Sağ Menü) Verilerini Doldurma
async function populateGroupSettings() {
  if (activeClassId) {
    try {
      const data = await apiFetch(`/api/classes/members?classId=${activeClassId}`);
      if (data && data.members) membersCache = data.members;
    } catch(e) {}
  }

  const group = groupsCache.find(g => g.id === activeGroupId);
  if(!group) return;
  
  const alertEl = document.getElementById("groupSettingsAlert");
  if(alertEl) clearAlert(alertEl);
  
  const editName = document.getElementById("editGroupName");
  if(editName) editName.value = group.name;
  
  const memList = document.getElementById("groupMembersList");
  if(memList) {
    memList.innerHTML = "";
    group.members.forEach(mId => {
      const student = membersCache.find(cm => cm.studentId === mId);
      const name = student ? student.studentName : (mId === me.id ? "Öğretmen (Sen)" : "Bilinmeyen Üye");
      
      let statusPill = "";
      if (mId !== me.id) {
        statusPill = `<span class="pill offline-status">Çevrimdışı</span>`;
        if (student && student.status === "active") statusPill = `<span class="pill active-status">Aktif</span>`;
        else if (student && student.status === "idle") statusPill = `<span class="pill idle-status">Pasif</span>`;
      } else {
        statusPill = `<span class="pill active-status">Aktif</span>`;
      }
      
      const div = document.createElement("div");
      div.className = "member-item";
      div.innerHTML = `<span style="display:flex; align-items:center; gap:8px;">👤 ${name} ${statusPill}</span> <button class="btn" style="background:#ef4444; color:white; padding:4px 10px; height:28px; font-size:12px;" title="Gruptan At">At</button>`;
      
      div.querySelector("button").onclick = async () => {
        if(!confirm(`${name} isimli kullanıcıyı gruptan atmak istediğine emin misin?`)) return;
        try {
          await apiFetch(`/api/groups/${activeGroupId}/members/${mId}`, { method: "DELETE" });
          if(alertEl) setAlert(alertEl, "ok", "Kullanıcı başarıyla atıldı.");
          loadGroups(); setTimeout(populateGroupSettings, 500);
        } catch(e) {
          if(alertEl) setAlert(alertEl, "err", "Kullanıcı atılırken hata oluştu.");
        }
      };
      memList.appendChild(div);
    });
  }

  const addList = document.getElementById("addMembersList");
  if(addList) {
    addList.innerHTML = "";
    const nonMembers = membersCache.filter(cm => !group.members.includes(cm.studentId));
    
    if(nonMembers.length === 0) {
      addList.innerHTML = "<div style='color:#888; font-size:13px; font-weight:bold;'>Sınıftaki tüm öğrenciler bu grupta.</div>";
    } else {
      nonMembers.forEach(m => {
        let statusPill = `<span class="pill offline-status" style="font-size:10px; padding:2px 6px;">Çevrimdışı</span>`;
        if (m.status === "active") statusPill = `<span class="pill active-status" style="font-size:10px; padding:2px 6px;">Aktif</span>`;
        else if (m.status === "idle") statusPill = `<span class="pill idle-status" style="font-size:10px; padding:2px 6px;">Pasif</span>`;
        addList.innerHTML += `<label class="checkbox-row" style="display:flex; justify-content:space-between; width:100%;"><span style="display:flex; align-items:center; gap:8px;"><input type="checkbox" value="${m.studentId}"> ${m.studentName}</span> ${statusPill}</label>`;
      });
    }
  }
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
      if(data.unreadCount > 0) {
        badge.textContent = data.unreadCount;
        badge.hidden = false; 
      } else {
        badge.hidden = true;
      }
    }
    
    list.innerHTML = "";
    data.notifications.reverse().forEach(n => {
      const div = document.createElement("div");
      div.className = "notif-item unread"; 
      div.style.cursor = "pointer";
      div.title = "Kapatmak için tıkla";
      
      let icon = "🔔";
      if(n.text.includes("mesaj")) icon = "💬";
      if(n.text.includes("teslim")) icon = "📥";

      div.innerHTML = `<div class="notif-icon">${icon}</div><div class="notif-content"><div class="notif-text">${n.text}</div><div class="notif-time" style="color:#64748b;">${fmtDate(n.createdAt)} • <b style="color:#ef4444;">Gizle</b></div></div>`;
      
      div.addEventListener("click", async () => {
        div.style.opacity = "0.5";
        try {
          await apiFetch(`/api/notifications/dismiss/${n.id}`, { method: "POST" });
          div.remove();
          loadNotifications(); // Badge'i güncellemek için
        } catch(e) {}
      });

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
      let statusText = "Çevrimdışı";
      if (m.status === "active") statusText = "Aktif";
      else if (m.status === "idle") statusText = "Pasif";
      sel.innerHTML += `<option value="${m.studentId}">${m.studentName} [${statusText}]</option>`;
    });
  }
  
  if(selectedChatStudentId) {
    sel.value = selectedChatStudentId;
  }
}

async function loadChat() {
  const body = document.getElementById("privateChatBody"); // DİKKAT: Artık privateChatBody
  
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
  const inp = document.getElementById("privateChatInput"); // DİKKAT: Artık privateChatInput
  if(!inp || !inp.value.trim() || !activeClassId) return;

  if(!selectedChatStudentId) {
    alert("Lütfen kime mesaj göndereceğini seçmek için yukarıdan bir öğrenci seçin.");
    return;
  }
  
  const text = inp.value.trim();
  inp.value = ""; 
  
  const body = document.getElementById("privateChatBody");
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
  Object.entries(views).forEach(([k, el]) => {
    if(el) el.classList.toggle("active", k === name);
  });
  if(name === 'groups') loadGroups();
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
    
    let statusPill = `<span class="pill offline-status">Çevrimdışı</span>`;
    if (m.status === "active") statusPill = `<span class="pill active-status">Aktif</span>`;
    else if (m.status === "idle") statusPill = `<span class="pill idle-status">Pasif</span>`;

    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${m.studentName}</div>
        <div class="subline">Katılım: ${fmtDate(m.joinedAt)}</div>
      </div>
      <div>${statusPill} <span class="pill">Üye</span></div>
    `;
    studentList.appendChild(el);
  });

  if (typeof updateGraphUI === "function") {
    updateGraphUI();
  }
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
  selectedChatStudentId = null; 
  activeGroupId = null; // YENİ
  if(document.getElementById("groupChatArea")) document.getElementById("groupChatArea").hidden = true;
  if(document.getElementById("groupSettingsArea")) document.getElementById("groupSettingsArea").hidden = true;
  const cName = classSelect.options[classSelect.selectedIndex].text;
  if(document.getElementById("studClassChip")) document.getElementById("studClassChip").innerText = "Sınıf: " + cName;
  if(document.getElementById("liveClassChip")) document.getElementById("liveClassChip").innerText = "Sınıf: " + cName;
  setActiveClassChip();
  clearSelection();
  if (typeof graphIncludedStudentIds !== "undefined") {
    graphIncludedStudentIds.clear();
  }
  await refreshAll(true);
});

goSubmissions?.addEventListener("click", () => setView("submissions"));

filterCourse?.addEventListener("input", () => renderSubmissionList());
filterStatus?.addEventListener("change", () => renderSubmissionList());

clearSelectionBtn?.addEventListener("click", clearSelection);
saveReviewBtn?.addEventListener("click", saveReview);

// Chat & Bildirim & Gruplar UI Eventleri
document.addEventListener("DOMContentLoaded", () => {
  const notifBtn = document.getElementById('notifBtn');
  const notifDropdown = document.getElementById('notifDropdown');
  if(notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', () => { 
      notifDropdown.hidden = !notifDropdown.hidden; 
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

  const chatInput = document.getElementById("privateChatInput"); 
  const sendChatBtn = document.getElementById("sendPrivateChatBtn"); 
  if(chatInput) chatInput.addEventListener("keypress", (e) => { if(e.key === 'Enter') sendChat(); });
  if(sendChatBtn) sendChatBtn.addEventListener("click", sendChat);

  // Öğrenci seçimi değiştiğinde
  const chatStudentSelect = document.getElementById("chatStudentSelect");
  if(chatStudentSelect) {
    chatStudentSelect.addEventListener("change", (e) => {
      selectedChatStudentId = e.target.value;
      loadChat(); 
    });
  }

  // YENİ: GRUP EVENTLERİ (Sağ Ayar Menüsü ve Mesajlaşma)
  document.getElementById("openGroupSettingsBtn")?.addEventListener("click", () => {
    document.getElementById("groupSettingsArea").hidden = false;
    populateGroupSettings();
  });
  document.getElementById("closeGroupSettingsBtn")?.addEventListener("click", () => {
    document.getElementById("groupSettingsArea").hidden = true;
  });

  document.getElementById("saveGroupNameBtn")?.addEventListener("click", async () => {
    const name = document.getElementById("editGroupName").value.trim();
    const alertEl = document.getElementById("groupSettingsAlert");
    if(!name) return setAlert(alertEl, "err", "Lütfen bir isim girin.");
    try {
      await apiFetch(`/api/groups/${activeGroupId}/name`, { method: "PUT", body: JSON.stringify({name}) });
      setAlert(alertEl, "ok", "Grup ismi güncellendi!");
      const titleEl = document.getElementById("activeGroupName");
      if(titleEl) titleEl.textContent = name;
      loadGroups(); setTimeout(populateGroupSettings, 500);
    } catch(e) { setAlert(alertEl, "err", "İsim değiştirilemedi."); }
  });

  document.getElementById("openAddMembersModal")?.addEventListener("click", () => {
    clearAlert(document.getElementById("addMembersAlert"));
    openModal(document.getElementById("addMembersModal"));
  });

  document.getElementById("addMembersBtn")?.addEventListener("click", async () => {
    const alertEl = document.getElementById("addMembersAlert");
    const cbs = document.querySelectorAll("#addMembersList input:checked");
    const memberIds = Array.from(cbs).map(c => c.value);
    if(memberIds.length === 0) return setAlert(alertEl, "err", "Lütfen gruba alınacak öğrencileri seçin.");
    
    try {
      const btn = document.getElementById("addMembersBtn");
      btn.disabled = true; btn.textContent = "Ekleniyor...";
      await apiFetch(`/api/groups/${activeGroupId}/members`, { method: "POST", body: JSON.stringify({memberIds}) });
      setAlert(alertEl, "ok", "Öğrenciler başarıyla gruba eklendi!");
      loadGroups(); 
      setTimeout(() => {
        populateGroupSettings();
        closeModal(document.getElementById("addMembersModal"));
      }, 700);
      btn.disabled = false; btn.textContent = "Seçilenleri Ekle";
    } catch(e) { 
      setAlert(alertEl, "err", "Öğrenci eklenemedi.");
      document.getElementById("addMembersBtn").disabled = false; 
      document.getElementById("addMembersBtn").textContent = "Seçilenleri Ekle";
    }
  });

  document.getElementById("groupChatInput")?.addEventListener("keypress", (e) => { if(e.key === 'Enter') sendGroupMessage(); });
  document.getElementById("sendGroupMsgBtn")?.addEventListener("click", sendGroupMessage);

  const fileInput = document.getElementById("groupChatFileInput");
  const attachBtn = document.getElementById("groupChatAttachBtn");
  const filePreview = document.getElementById("groupChatFilePreview");
  const fileName = document.getElementById("groupChatFileName");
  const fileClear = document.getElementById("groupChatFileClear");

  if(attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if(fileInput.files.length > 0) {
        if(fileName) fileName.textContent = "📎 " + fileInput.files[0].name;
        if(filePreview) filePreview.hidden = false;
      } else {
        if(filePreview) filePreview.hidden = true;
      }
    });
  }
  if(fileClear) {
    fileClear.addEventListener("click", () => {
      if(fileInput) fileInput.value = "";
      if(filePreview) filePreview.hidden = true;
    });
  }
});

// ========= DERS (COURSE) YÖNETİMİ =========
function populateCourseSelects() {
  const qa = document.getElementById("qaCourse");
  const a = document.getElementById("aCourse");
  if(!qa || !a) return;
  qa.innerHTML = '<option value="">-- Ders Seç --</option>';
  a.innerHTML = '<option value="">-- Ders Seç --</option>';
  const cls = (classesCache || []).find(c => c.id === activeClassId);
  if (cls && cls.courses && Array.isArray(cls.courses)) {
    cls.courses.forEach(c => {
      qa.innerHTML += `<option value="${c}">${c}</option>`;
      a.innerHTML += `<option value="${c}">${c}</option>`;
    });
  }
}

document.querySelectorAll(".add-course-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (!requireActiveClass()) return;
    const cName = prompt("Eklemek istediğiniz yeni dersin adını girin (Örn: Matematik):");
    if (!cName || !cName.trim()) return;
    try {
      const resp = await apiFetch(`/api/classes/${activeClassId}/courses`, {
        method: "POST",
        body: JSON.stringify({ courseName: cName.trim() })
      });
      const cls = (classesCache || []).find(c => c.id === activeClassId);
      if(cls && resp.class) cls.courses = resp.class.courses;
      populateCourseSelects();
      alert("Ders eklendi!");
    } catch(err) {
      alert("Hata: " + err.message);
    }
  });
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
  populateCourseSelects();
  renderAssignmentList();
  renderSubmissionList();
  renderLastSubmissions();
  renderStudentList();
  fillChatStudents(); 
  loadChat(); 
  loadGroups(); // YENİ: Sınıf yenilendiğinde grupları da yenile
}

// ========= YENİ: GRAFIKLER =========
let performanceChart = null;
const chartWrapper = document.getElementById("chartWrapper");
const chartContainer = document.getElementById("chartContainer");
const emptyChartMsg = document.getElementById("emptyChartMsg");
const includedStudentsArea = document.getElementById("includedStudentsArea");
const dragPlaceholder = document.getElementById("dragPlaceholder");
const draggableStudentList = document.getElementById("draggableStudentList");
const graphStudentSearch = document.getElementById("graphStudentSearch");

let graphIncludedStudentIds = new Set();

if (graphStudentSearch) {
  graphStudentSearch.addEventListener("input", renderDraggableStudents);
}

function renderDraggableStudents() {
  if (!draggableStudentList) return;
  draggableStudentList.innerHTML = "";
  if (!activeClassId) return;
  
  const members = (membersCache || []).slice().sort((a,b) => (a.studentName || "").localeCompare(b.studentName || ""));
  const term = (graphStudentSearch?.value || "").toLowerCase().trim();
  
  const available = members.filter(m => !graphIncludedStudentIds.has(m.studentId) && m.studentName.toLowerCase().includes(term));
  
  if (available.length === 0) {
    draggableStudentList.innerHTML = '<div style="color:#999; font-size:12px; padding:10px;">Bulunamadı veya hepsi grafiğe eklendi.</div>';
    return;
  }
  
  available.forEach(m => {
    const el = document.createElement("div");
    el.className = "rowcard";
    el.style.cursor = "grab";
    el.style.padding = "8px";
    el.draggable = true;
    el.innerHTML = `<div style="flex:1;">${m.studentName}</div><div style="font-size:12px; color:#666; font-weight:bold;">Sürükle ➜</div>`;
    el.ondragstart = (e) => {
      e.dataTransfer.setData("studentId", m.studentId);
    };
    draggableStudentList.appendChild(el);
  });
}

window.handleDrop = function(e) {
  e.preventDefault();
  const sId = e.dataTransfer.getData("studentId");
  if(sId && !graphIncludedStudentIds.has(sId)) {
    graphIncludedStudentIds.add(sId);
    updateGraphUI();
  }
};

function renderIncludedStudents() {
  if (!includedStudentsArea || !dragPlaceholder) return;
  
  Array.from(includedStudentsArea.children).forEach(ch => {
    if (ch.id !== "dragPlaceholder") ch.remove();
  });
  
  if (graphIncludedStudentIds.size === 0) {
    dragPlaceholder.style.display = "block";
  } else {
    dragPlaceholder.style.display = "none";
    
    Array.from(graphIncludedStudentIds).forEach(sId => {
      const m = (membersCache || []).find(x => x.studentId === sId);
      if(!m) return;
      
      const chip = document.createElement("div");
      chip.className = "chip clickable";
      chip.style.cursor = "pointer";
      chip.style.backgroundColor = "var(--primary)";
      chip.style.color = "white";
      chip.style.padding = "4px 8px";
      chip.style.borderRadius = "12px";
      chip.title = "Grafikten Çıkarmak İçin Tıkla";
      chip.textContent = m.studentName + " ✕";
      
      chip.onclick = () => {
        graphIncludedStudentIds.delete(sId);
        updateGraphUI();
      };
      
      includedStudentsArea.appendChild(chip);
    });
  }
}

function updateGraphUI() {
  renderDraggableStudents();
  renderIncludedStudents();
  renderClassGraph();
}

function renderClassGraph() {
  if(!chartWrapper || !emptyChartMsg || !chartContainer) return;
  
  if (graphIncludedStudentIds.size === 0) {
    chartWrapper.style.display = "none";
    emptyChartMsg.style.display = "block";
    emptyChartMsg.textContent = "Lütfen listeden grafiğe öğrenci sürükleyin.";
    if(performanceChart) performanceChart.destroy();
    return;
  }
  
  const includedMembers = (membersCache || []).filter(m => graphIncludedStudentIds.has(m.studentId));
  const cls = (classesCache || []).find(c => c.id === activeClassId);
  
  let uniqueCourses = [];
  if (cls && cls.courses && cls.courses.length > 0) {
    uniqueCourses = cls.courses;
  } else {
    const cSet = new Set();
    (assignmentsCache || []).forEach(a => { if (a.course) cSet.add(a.course); });
    uniqueCourses = Array.from(cSet);
  }
  uniqueCourses.sort();
  
  if(uniqueCourses.length === 0) {
    chartWrapper.style.display = "none";
    emptyChartMsg.style.display = "block";
    emptyChartMsg.textContent = "Grafik için veri (ders) yok.";
    return;
  }
  
  chartWrapper.style.display = "block";
  emptyChartMsg.style.display = "none";
  
  const minWidth = Math.max(800, includedMembers.length * uniqueCourses.length * 30 + 150);
  chartContainer.style.minWidth = minWidth + "px";

  const labels = uniqueCourses;

  const datasets = includedMembers.map((m, idx) => {
    const hue = (idx * 137.508) % 360; 
    const bgColor = `hsla(${hue}, 70%, 55%, 0.7)`;
    const borderColor = `hsl(${hue}, 70%, 50%)`;
    
    // Y-Axis averge grades by course
    const data = labels.map(cName => {
      const subs = (submissionsCache || []).filter(s => 
        s.studentId === m.studentId && 
        s.course === cName && 
        s.status === "graded" &&
        !isNaN(Number(s.grade))
      );
      if (subs.length === 0) return 0;
      const total = subs.reduce((acc, s) => acc + Number(s.grade), 0);
      return Math.round(total / subs.length);
    });

    return {
      label: m.studentName,
      data: data,
      backgroundColor: bgColor,
      borderColor: borderColor,
      borderWidth: 1,
      borderRadius: 4
    };
  });

  const ctx = document.getElementById('studentPerformanceChart');
  if(!ctx) return;
  if(performanceChart) performanceChart.destroy();

  performanceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100, title: { display: true, text: 'Ortalama Not' } },
        x: { title: { display: true, text: 'Dersler' }, grid: { offset: true } }
      },
      plugins: {
        tooltip: { mode: 'index', intersect: false },
        legend: { position: 'top' }
      }
    }
  });
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
    // YENİ: Grup sekmesi açıksa mesajları güncelle
    if (activeGroupId && document.getElementById('groupChatArea') && !document.getElementById('groupChatArea').hidden) {
      loadGroupMessages();
    }
    loadNotifications();
  }, 5000);

  // ==========================================
  // CANLI DERS & QUIZ (ÖĞRETMEN)
  // ==========================================
  
  async function checkLiveStatus() {
    if (!activeClassId) return;
    try {
      const data = await apiFetch(`/api/live/status?classId=${activeClassId}`);
      if (data && data.active) {
        document.getElementById("liveStartPanel").hidden = true;
        document.getElementById("liveActivePanel").hidden = false;
        document.getElementById("activeLiveLink").href = data.lesson.link;
        renderAttendance(data.lesson);
      } else {
        document.getElementById("liveStartPanel").hidden = false;
        document.getElementById("liveActivePanel").hidden = true;
        document.getElementById("attendanceList").innerHTML = "";
        document.getElementById("emptyAttendance").hidden = false;
      }
    } catch(e) {}
  }
  
  function renderAttendance(lesson) {
    const list = document.getElementById("attendanceList");
    const empty = document.getElementById("emptyAttendance");
    if (!lesson.attendees || lesson.attendees.length === 0) {
      list.innerHTML = "";
      empty.hidden = false;
      empty.innerText = "Henüz katılan yok. Biri katıldığında burada belirecek...";
      return;
    }
    
    empty.hidden = true;
    list.innerHTML = "";
    
    const quizAnswers = lesson.activeQuiz ? lesson.activeQuiz.answers : [];
    const correctAns = lesson.activeQuiz ? (lesson.activeQuiz.correctAnswer || "").trim() : "";
  
    lesson.attendees.forEach(studentId => {
      const student = membersCache.find(m => m.studentId === studentId);
      const name = student ? student.studentName : "Öğrenci (" + studentId + ")";
      
      let answerText = "";
      if (lesson.activeQuiz) {
        const qAns = quizAnswers.find(a => a.studentId === studentId);
        if (qAns) {
          const isCorrect = correctAns && qAns.choice.trim() === correctAns;
          if (isCorrect) {
            answerText = `<span style="font-size:15px; font-weight:900; background:#10b981; color:white; padding:6px 14px; border-radius:20px; display:inline-flex; align-items:center; gap:6px;">✅ ${qAns.choice}</span>`;
          } else {
            answerText = `<span style="font-size:15px; font-weight:900; background:#ef4444; color:white; padding:6px 14px; border-radius:20px; display:inline-flex; align-items:center; gap:6px;">❌ ${qAns.choice}</span>`;
          }
        } else {
          answerText = `<span style="font-size:14px; font-weight:bold; background:#fef3c7; color:#d97706; padding:6px 14px; border-radius:20px;">⏳ Yanıt Bekleniyor</span>`;
        }
      }
  
      list.innerHTML += `
        <div class="rowcard" style="padding:14px 16px; display:flex; justify-content:space-between; width:100%; align-items:center;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="display:inline-block; width:12px; height:12px; background:#10b981; border-radius:50%;"></span>
            <span style="font-weight:900; color:#1e3a5f; font-size:16px;">${name}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            ${answerText}
            <span class="pill active-status" style="margin:0;">Derste (Yoğun)</span>
          </div>
        </div>
      `;
    });
  }
  
  const liveStartForm = document.getElementById("liveStartForm");
  if (liveStartForm) {
    liveStartForm.onsubmit = async (e) => {
      e.preventDefault();
      if (!activeClassId) return alert("Önce sol menüden sınıf seçmelisiniz.");
      const link = document.getElementById("liveLink").value;
      try {
        await apiFetch("/api/live/start", {
          method: "POST",
          body: JSON.stringify({ classId: activeClassId, link })
        });
        document.getElementById("liveLink").value = "";
        checkLiveStatus();
      } catch(e) { alert("Hata: " + e.message); }
    };
  }
  
  const endLiveBtn = document.getElementById("endLiveBtn");
  if (endLiveBtn) {
    endLiveBtn.onclick = async () => {
      if (!activeClassId) return;
      if (!confirm("Dersi bitirmek istediğinize emin misiniz? Sınıf yoklama listesi sıfırlanacak.")) return;
      try {
        await apiFetch("/api/live/end", { method: "POST", body: JSON.stringify({ classId: activeClassId }) });
        checkLiveStatus();
      } catch(e) {}
    };
  }
  
  const liveQuizForm = document.getElementById("liveQuizForm");
  if (liveQuizForm) {
    liveQuizForm.onsubmit = async (e) => {
      e.preventDefault();
      if (!activeClassId) return;
      const q = document.getElementById("quizQuestion").value;
      const optsStr = document.getElementById("quizOpts").value.trim();
      const options = optsStr.split(/\s+(?=[A-Za-z]\))/).map(o => o.trim()).filter(Boolean);
      if (options.length < 2) return alert("En az 2 şık girmelisiniz.\nÖrnek: A)py B)cs C)js");
      const correctAnswer = (document.getElementById("quizCorrectAnswer")?.value || "").trim();
      if (!correctAnswer) return alert("Lütfen doğru cevap şıkkını yazın.");
      try {
        const btn = liveQuizForm.querySelector("button");
        btn.disabled = true; btn.innerText = "Gönderiliyor...";
        await apiFetch("/api/quiz/publish", { method: "POST", body: JSON.stringify({ classId: activeClassId, question: q, options, correctAnswer }) });
        document.getElementById("quizQuestion").value = "";
        document.getElementById("quizOpts").value = "";
        if (document.getElementById("quizCorrectAnswer")) document.getElementById("quizCorrectAnswer").value = "";
        const st = document.getElementById("quizStatus");
        st.className = "alert ok";
        st.innerText = "Soru anında tüm öğrencilere gönderildi!";
        st.hidden = false;
        setTimeout(() => { st.hidden = true; }, 3000);
        btn.disabled = false; btn.innerText = "Yeni Soru Gönder";
        checkLiveStatus();
      } catch(err) {
        alert("Hata: " + err.message);
      }
    };
  }
  
  // 5 saniyede bir paneli otomatik tazele (Yoklama için)
  setInterval(() => {
    const isLiveTab = document.getElementById("view-live").classList.contains("active");
    if (isLiveTab && activeClassId) {
      checkLiveStatus();
    }
  }, 5000);

})();