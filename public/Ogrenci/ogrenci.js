"use strict";

/**
 * ✅ ÖĞRENCİ PANEL (FULL BACKEND + GRIDFS UPLOAD + AI + CHAT + BİLDİRİM + GRUPLAR + AYARLAR)
 */

const API_BASE = "http://localhost:3000"; 

// ========= auth guard =========
const token = localStorage.getItem("token");
const role = localStorage.getItem("role");
let me = null;
try { me = JSON.parse(localStorage.getItem("user") || "null"); } catch { me = null; }

if (!token || role !== "student" || !me) {
  window.location.replace("/Ogrenci/ogrenci-giris.html");
}

// ========= apiFetch (FormData safe + good error) =========
async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isFormData = (typeof FormData !== "undefined") && (options.body instanceof FormData);

  if (!isFormData && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(API_BASE + path, { ...options, headers });
  } catch (err) {
    throw new Error("Sunucuya ulaşılamadı. Sunucunun çalıştığından emin olun.");
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!res.ok || (data && data.ok === false)) {
    throw new Error((data && data.message) ? data.message : `İstek başarısız: ${res.status}`);
  }

  return data;
}

// ========= YENİ: AKTİVİTE TAKİBİ (HEARTBEAT) =========
function sendPing(statusStr) {
  if (!token) return;
  apiFetch("/api/users/ping", {
    method: "POST",
    body: JSON.stringify({ status: statusStr })
  }).catch(()=>null);
}

let idleTimer;
let userActivity = "active";

function resetActivityTimer() {
  if (userActivity !== "active") {
    userActivity = "active";
    sendPing("active");
  }
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    userActivity = "idle";
    sendPing("idle");
  }, 60000); // 1 dakika fare veya klavye hareketi olmazsa Pasif olur
}

// Sadece bu fiziksel etkileşimlerde "aktif" kabul et
window.addEventListener("mousemove", resetActivityTimer);
window.addEventListener("keypress", resetActivityTimer);
window.addEventListener("click", resetActivityTimer);
window.addEventListener("scroll", resetActivityTimer);

// 30 saniyede bir o anki durumu (Aktif/Pasif) sunucuya bildir
setInterval(() => {
  sendPing(userActivity);
}, 30000);

resetActivityTimer();

// ========= helpers =========
function fmtDate(iso){ try { return new Date(iso).toLocaleString("tr-TR"); } catch { return iso; } }
function fmtOnlyDate(iso){ try { return new Date(iso).toLocaleDateString("tr-TR"); } catch { return iso; } }
function setAlert(el, type, text){
  if (!el) return;
  el.hidden = false;
  el.classList.remove("ok","err", "warn");
  el.classList.add(type);
  el.textContent = text;
}
function clearAlert(el){
  if (!el) return;
  el.hidden = true;
  el.classList.remove("ok","err", "warn");
  el.textContent = "";
}
function pillForStatus(s){
  if (s === "graded") return `<span class="pill ok">Notlandırıldı</span>`;
  return `<span class="pill warn">Bekliyor</span>`;
}

// ========= DOM =========
const who = document.getElementById("who");
const logoutBtn = document.getElementById("logoutBtn");

const navBtns = document.querySelectorAll(".navbtn");
const views = {
  dashboard: document.getElementById("view-dashboard"),
  assignments: document.getElementById("view-assignments"),
  submit: document.getElementById("view-submit"),
  history: document.getElementById("view-history"),
  groups: document.getElementById("view-groups"), // YENİ: Gruplar
  live: document.getElementById("view-live")
};

const classSelect = document.getElementById("classSelect");
const activeClassChip = document.getElementById("activeClassChip");
const assClassChip = document.getElementById("assClassChip");
const subClassChip = document.getElementById("subClassChip");
const histClassChip = document.getElementById("histClassChip");

// KPIs
const kpiMyClasses = document.getElementById("kpiMyClasses");
const kpiActiveAssignments = document.getElementById("kpiActiveAssignments");
const kpiMySubmissions = document.getElementById("kpiMySubmissions");
const kpiGraded = document.getElementById("kpiGraded");

// Dashboard
const upcomingList = document.getElementById("upcomingList");
const emptyUpcoming = document.getElementById("emptyUpcoming");
const myLastSubs = document.getElementById("myLastSubs");
const emptyMyLast = document.getElementById("emptyMyLast");
const goAssignments = document.getElementById("goAssignments");
const goHistory = document.getElementById("goHistory");

// Assignments view
const assignmentList = document.getElementById("assignmentList");
const emptyAssignments = document.getElementById("emptyAssignments");

// Submit view
const assignmentSelect = document.getElementById("assignmentSelect");
const emptyAssignSelect = document.getElementById("emptyAssignSelect");
const submitForm = document.getElementById("submitForm");
const fileInput = document.getElementById("fileInput");
const studentNote = document.getElementById("studentNote");
const submitAlert = document.getElementById("submitAlert");

// History view
const filterCourse = document.getElementById("filterCourse");
const filterStatus = document.getElementById("filterStatus");
const historyList = document.getElementById("historyList");
const emptyHistory = document.getElementById("emptyHistory");

// Detail
const detailEmpty = document.getElementById("detailEmpty");
const detailBox = document.getElementById("detailBox");
const dTitle = document.getElementById("dTitle");
const dSub = document.getElementById("dSub");
const dStatus = document.getElementById("dStatus");
const dFile = document.getElementById("dFile");
const dDate = document.getElementById("dDate");
const dGrade = document.getElementById("dGrade");
const dFeedback = document.getElementById("dFeedback");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");

// Join modal
const openJoin = document.getElementById("openJoin");
const joinModal = document.getElementById("joinModal");
const joinForm = document.getElementById("joinForm");
const classCode = document.getElementById("classCode");
const joinAlert = document.getElementById("joinAlert");

// Find modal
const openFind = document.getElementById("openFind");
const findModal = document.getElementById("findModal");
const teacherQuery = document.getElementById("teacherQuery");
const searchTeacherBtn = document.getElementById("searchTeacherBtn");
const foundClassList = document.getElementById("foundClassList");
const emptyFound = document.getElementById("emptyFound");
const findAlert = document.getElementById("findAlert");

// state
let activeClassId = null;
let selectedSubmissionId = null;
let activeGroupId = null; 

let myClassesCache = [];
let assignmentsCache = [];
let mySubmissionsCache = [];
let classMembersCache = []; 
let groupsCache = []; 

// ========= API data =========
async function fetchMyClasses(){
  const data = await apiFetch(`/api/classes/my?studentId=${encodeURIComponent(me.id)}`);
  return Array.isArray(data?.classes) ? data.classes : [];
}

async function fetchAssignments(classId){
  const data = await apiFetch(`/api/assignments/by-class?classId=${encodeURIComponent(classId)}`);
  return Array.isArray(data?.assignments) ? data.assignments : [];
}

async function fetchMySubmissions(classId){
  const data = await apiFetch(`/api/student/submissions?classId=${encodeURIComponent(classId)}`);
  return Array.isArray(data?.submissions) ? data.submissions : [];
}

// ========= YENİ: GRUPLAR SOHBETİ VE AYARLAR =========

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
    list.innerHTML = "<div style='color:#64748b; font-size:13px; text-align:center; margin-top:20px;'>Henüz grubun yok.</div>";
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
      if(settingsArea) settingsArea.hidden = true; // Farklı gruba geçince ayarlar kapansın
      
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
      body.innerHTML = "<div style='text-align:center; color:#64748b; margin-top:20px; font-size:13px;'>Gruba ilk mesajı sen yaz!</div>";
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
  if(body && body.innerHTML.includes("ilk mesajı")) body.innerHTML = "";
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

// Grup Kurma
async function openGroupModal() {
  if(!activeClassId) return alert("Önce bir sınıf seçin!");
  const newGroupName = document.getElementById("newGroupName");
  if(newGroupName) newGroupName.value = "";
  clearAlert(document.getElementById("groupAlert"));
  
  const cBox = document.getElementById("studentCheckboxes");
  if(cBox) cBox.innerHTML = "Sınıf arkadaşları yükleniyor...";
  openModal(document.getElementById("createGroupModal"));

  try {
    const data = await apiFetch(`/api/classes/members?classId=${activeClassId}`);
    classMembersCache = data.members;
    if(cBox) {
      cBox.innerHTML = "";
      const others = classMembersCache.filter(m => m.studentId !== me.id);
      if(others.length === 0) {
        cBox.innerHTML = "<div style='color:#888; font-size:12px;'>Sınıfta henüz başka öğrenci yok.</div>"; 
        return;
      }
      others.forEach(m => {
        let statusPill = `<span class="pill offline-status" style="font-size:10px; padding:2px 6px;">Çevrimdışı</span>`;
        if (m.status === "active") statusPill = `<span class="pill active-status" style="font-size:10px; padding:2px 6px;">Aktif</span>`;
        else if (m.status === "idle") statusPill = `<span class="pill idle-status" style="font-size:10px; padding:2px 6px;">Pasif</span>`;
        cBox.innerHTML += `<label class="checkbox-row" style="display:flex; justify-content:space-between; width:100%;"><span style="display:flex; align-items:center; gap:8px;"><input type="checkbox" value="${m.studentId}"> ${m.studentName}</span> ${statusPill}</label>`;
      });
    }
  } catch(e) { if(cBox) cBox.innerHTML = "Öğrenciler yüklenemedi."; }
}

async function createGroup() {
  const nameInput = document.getElementById("newGroupName");
  const name = nameInput ? nameInput.value.trim() : "";
  const alertEl = document.getElementById("groupAlert");
  if(!name) return setAlert(alertEl, "err", "Grup adı zorunlu.");
  
  const checkboxes = document.querySelectorAll("#studentCheckboxes input:checked");
  const memberIds = Array.from(checkboxes).map(c => c.value);
  if(memberIds.length === 0) return setAlert(alertEl, "err", "En az 1 öğrenci seçmelisin.");

  try {
    await apiFetch("/api/groups/create", { method: "POST", body: JSON.stringify({ classId: activeClassId, name, memberIds }) });
    closeModal(document.getElementById("createGroupModal"));
    loadGroups(); 
  } catch(e) { setAlert(alertEl, "err", "Grup kurulamadı."); }
}

// Grup Ayarları Menüsü Veri Doldurma
async function populateGroupSettings() {
  if (activeClassId) {
    try {
      const data = await apiFetch(`/api/classes/members?classId=${activeClassId}`);
      if (data && data.members) classMembersCache = data.members;
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
      const student = classMembersCache.find(cm => cm.studentId === mId);
      const name = student ? student.studentName : (mId === me.id ? me.name : "Öğrenci");
      
      let statusPill = `<span class="pill offline-status">Çevrimdışı</span>`;
      if (student && student.status === "active") statusPill = `<span class="pill active-status">Aktif</span>`;
      else if (student && student.status === "idle") statusPill = `<span class="pill idle-status">Pasif</span>`;
      else if (mId === me.id) statusPill = `<span class="pill active-status">Aktif</span>`;

      memList.innerHTML += `<div class="member-item" style="display:flex; justify-content:space-between; width:100%;">
                              <span style="display:flex; align-items:center; gap:8px;">👤 ${name} ${mId === me.id ? '(Sen)' : ''}</span>
                              ${statusPill}
                            </div>`;
    });
  }

  const addList = document.getElementById("addMembersList");
  if(addList) {
    addList.innerHTML = "";
    const nonMembers = classMembersCache.filter(cm => !group.members.includes(cm.studentId) && cm.studentId !== me.id);
    
    if(nonMembers.length === 0) {
      addList.innerHTML = "<div style='color:#888; font-size:12px; padding:6px 0;'>Sınıftaki herkes bu grupta.</div>";
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

// ========= BİLDİRİM, CHAT VE GERÇEK YAPAY ZEKA =========

async function loadNotifications() {
  const data = await apiFetch("/api/notifications");
  const list = document.querySelector(".notif-list");
  const badge = document.getElementById("notifBadge");
  if(!list) return;
  
  list.innerHTML = data.notifications?.length ? "" : '<div class="notif-item">Bildirim yok.</div>';
  if(!data.notifications || data.notifications.length === 0) {
    if(badge) badge.hidden = true;
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
  
  data.notifications.reverse().forEach(n => {
    const div = document.createElement("div");
    div.className = "notif-item unread"; 
    div.style.cursor = "pointer";
    div.title = "Kapatmak için tıkla";
    
    let icon = "🔔";
    if(n.text.includes("mesaj")) icon = "💬";
    if(n.text.includes("ödev")) icon = "📌";
    if(n.text.includes("notlandırıldı")) icon = "✅";

    div.innerHTML = `<div class="notif-icon">${icon}</div><div class="notif-content"><div class="notif-text">${n.text}</div><div class="notif-time" style="color:#64748b;">${fmtDate(n.createdAt)} • <b style="color:#ef4444;">Gizle</b></div></div>`;
    
    div.addEventListener("click", async () => {
      div.style.opacity = "0.5";
      try {
        await apiFetch(`/api/notifications/dismiss/${n.id}`, { method: "POST" });
        div.remove();
        loadNotifications(); // Reload to update badge
      } catch(e) {}
    });

    list.appendChild(div);
  });
}

async function loadPrivateChat() {
  if(!activeClassId) return;
  const data = await apiFetch(`/api/chat/${activeClassId}`);
  const body = document.getElementById("privateChatBody");
  if(!body) return;

  body.innerHTML = "";
  
  if(!data.messages || data.messages.length === 0) {
    body.innerHTML = `<div style="text-align:center; color:#64748b; font-size:12px; margin-top:20px;">Öğretmeninle arandaki özel sohbet burada başlar...</div>`;
    return;
  }

  data.messages.forEach(m => {
    const isMine = m.senderId === me.id;
    const div = document.createElement("div");
    div.className = `w-msg ${isMine ? 'mine' : 'others'}`;
    div.innerHTML = `<span class="w-sender">${isMine ? '' : '👨‍🏫 Öğretmen'}</span><div class="w-bubble">${m.text}</div>`;
    body.appendChild(div);
  });
  body.scrollTop = body.scrollHeight;
}

async function sendPrivateChat() {
  const inp = document.getElementById("privateChatInput");
  if(!inp || !inp.value.trim() || !activeClassId) return;
  
  const text = inp.value.trim();
  inp.value = ""; 
  
  const body = document.getElementById("privateChatBody");
  if(body && body.innerHTML.includes("Öğretmeninle arandaki özel sohbet")) body.innerHTML = "";
  if(body) {
    body.innerHTML += `<div class="w-msg mine"><div class="w-bubble">${text}</div></div>`;
    body.scrollTop = body.scrollHeight;
  }

  await apiFetch("/api/chat", { method: "POST", body: JSON.stringify({ classId: activeClassId, text: text }) });
  loadPrivateChat();
}

async function askAI(questionOverride) {
  const inp = document.getElementById("aiInput");
  const body = document.getElementById("aiBody");
  const question = questionOverride || (inp ? inp.value.trim() : "");
  if(!question) return;
  
  if(inp) inp.value = "";
  
  // Bağlı sınıf etiketini güncelle
  updateAIClassChip();
  
  const uDiv = document.createElement("div"); 
  uDiv.className = "w-msg mine"; 
  uDiv.innerHTML = `<div class="w-bubble">${question}</div>`;
  if(body) {
    body.appendChild(uDiv);
    const tId = "typing_" + Date.now();
    const typingDiv = document.createElement("div"); 
    typingDiv.id = tId;
    typingDiv.className = "w-msg others ai-msg";
    typingDiv.innerHTML = `<span class="w-sender">Portal Asistanı</span><div class="w-bubble"><span class="ai-typing-dots">Düşünüyorum<span>.</span><span>.</span><span>.</span></span> 🧠</div>`;
    body.appendChild(typingDiv);
    body.scrollTop = body.scrollHeight;

    // Sor butonunu devre dışı bırak
    const sendBtn = document.getElementById("sendAiBtn");
    if(sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "⏳"; }

    try {
      // 6. Hafta: classId'yi de gönderiyoruz
      const data = await apiFetch("/api/ai/ask", { 
        method: "POST", 
        body: JSON.stringify({ prompt: question, classId: activeClassId || "" }) 
      });
      const el = document.getElementById(tId);
      if(el) el.remove();
      
      // Markdown formatlamayı iyileştir
      let formattedReply = (data.reply || "")
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/\n/g, '<br>');

      const aDiv = document.createElement("div"); 
      aDiv.className = "w-msg others ai-msg";
      aDiv.innerHTML = `<span class="w-sender">Portal Asistanı</span><div class="w-bubble">${formattedReply}</div>`;
      body.appendChild(aDiv); 
      body.scrollTop = body.scrollHeight;
    } catch (error) {
      const el = document.getElementById(tId);
      if(el) el.remove();
      const errDiv = document.createElement("div"); errDiv.className = "w-msg others ai-msg";
      errDiv.innerHTML = `<span class="w-sender">Portal Asistanı</span><div class="w-bubble" style="color:#ef4444;">Bağlantı hatası oluştu. Lütfen tekrar dene.</div>`;
      body.appendChild(errDiv);
    } finally {
      if(sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Sor"; }
    }
  }
}

// 6. Hafta: AI bağlı sınıf göstergesi güncelleme
function updateAIClassChip() {
  const chip = document.getElementById("aiClassChip");
  if(!chip) return;
  const cls = myClassesCache.find(c => c.id === activeClassId);
  chip.textContent = cls ? `📚 ${cls.name}` : "📚 Sınıf seçilmedi";
  chip.title = cls ? `AI bu sınıfın verilerine erişebilir` : "Sınıf seçince AI daha akıllı cevaplar verir";
}

// ========= UI =========
function setView(name){
  navBtns.forEach(b => b.classList.toggle("active", b.dataset.view === name));
  Object.entries(views).forEach(([k, el]) => {
    if(el) el.classList.toggle("active", k === name);
  });
  if(name === 'groups') loadGroups();
}

function setActiveClassChip(){
  const cls = myClassesCache.find(c => c.id === activeClassId);
  const label = cls ? `Sınıf: ${cls.name}` : "Sınıf: —";
  if (activeClassChip) activeClassChip.textContent = label;
  if (assClassChip) assClassChip.textContent = label;
  if (subClassChip) subClassChip.textContent = label;
  if (histClassChip) histClassChip.textContent = label;
}

async function fillClassSelect(){
  if (!classSelect) return;
  classSelect.innerHTML = "";

  try {
    myClassesCache = (await fetchMyClasses()).sort((a,b)=> (a.createdAt||"").localeCompare(b.createdAt||""));
  } catch (e) {
    console.error(e);
    myClassesCache = [];
  }

  if (!myClassesCache.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Henüz sınıf yok";
    classSelect.appendChild(opt);
    classSelect.disabled = true;
    activeClassId = null;
    setActiveClassChip();
    return;
  }

  classSelect.disabled = false;
  myClassesCache.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.code})`;
    classSelect.appendChild(opt);
  });

  if (!activeClassId || !myClassesCache.some(c => c.id === activeClassId)) {
    activeClassId = myClassesCache[0].id;
  }
  classSelect.value = activeClassId;
  setActiveClassChip();
}

function requireActiveClass(){
  if (!activeClassId) {
    alert("Önce bir sınıfa katılmalısın.");
    return false;
  }
  return true;
}

// ========= render =========
function renderKPIs(){
  if (kpiMyClasses) kpiMyClasses.textContent = myClassesCache.length.toLocaleString("tr-TR");

  if (!activeClassId) {
    if (kpiActiveAssignments) kpiActiveAssignments.textContent = "0";
    if (kpiMySubmissions) kpiMySubmissions.textContent = "0";
    if (kpiGraded) kpiGraded.textContent = "0";
    return;
  }

  const graded = mySubmissionsCache.filter(s => s.status === "graded").length;

  if (kpiActiveAssignments) kpiActiveAssignments.textContent = assignmentsCache.length.toLocaleString("tr-TR");
  if (kpiMySubmissions) kpiMySubmissions.textContent = mySubmissionsCache.length.toLocaleString("tr-TR");
  if (kpiGraded) kpiGraded.textContent = graded.toLocaleString("tr-TR");
}

function renderUpcoming(){
  if (!upcomingList || !emptyUpcoming) return;
  upcomingList.innerHTML = "";

  if (!activeClassId) { emptyUpcoming.hidden = false; return; }

  const as = [...assignmentsCache].sort((a,b)=> (a.due||"").localeCompare(b.due||"")).slice(0,5);
  if (!as.length) { emptyUpcoming.hidden = false; return; }
  emptyUpcoming.hidden = true;

  as.forEach(a => {
    const mySub = mySubmissionsCache.find(s => s.assignmentId === a.id);
    const statusPill = mySub ? pillForStatus(mySub.status) : `<span class="pill">Teslim yok</span>`;

    const el = document.createElement("div");
    el.className = "rowcard";
    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${a.course} — ${a.title}</div>
        <div class="subline">Son: ${a.due ? fmtOnlyDate(a.due) : "—"}</div>
        <div class="subline">${a.desc ? a.desc.slice(0, 80) + (a.desc.length>80 ? "…" : "") : ""}</div>
      </div>
      ${statusPill}
    `;
    el.addEventListener("click", () => {
      setView("submit");
      if (assignmentSelect) assignmentSelect.value = a.id;
      fillSubmitPanel();
    });
    upcomingList.appendChild(el);
  });
}

function renderMyLastSubs(){
  if (!myLastSubs || !emptyMyLast) return;
  myLastSubs.innerHTML = "";

  if (!activeClassId) { emptyMyLast.hidden = false; return; }

  const subs = [...mySubmissionsCache].sort((a,b)=> (b.submittedAt||"").localeCompare(a.submittedAt||"")).slice(0,4);
  if (!subs.length) { emptyMyLast.hidden = false; return; }
  emptyMyLast.hidden = true;

  subs.forEach(s => {
    const shownName = s.originalFileName || s.fileName || "Dosya";
    const el = document.createElement("div");
    el.className = "rowcard";
    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${s.course} • ${s.title}</div>
        <div class="subline">${shownName} • ${fmtDate(s.submittedAt)}</div>
      </div>
      ${pillForStatus(s.status)}
    `;
    el.addEventListener("click", () => {
      setView("history");
      selectHistorySubmission(s.id);
    });
    myLastSubs.appendChild(el);
  });
}

function renderAssignments(){
  if (!assignmentList || !emptyAssignments) return;
  assignmentList.innerHTML = "";

  if (!activeClassId) { emptyAssignments.hidden = false; return; }

  const as = [...assignmentsCache].sort((a,b)=> (b.createdAt||"").localeCompare(a.createdAt||""));
  if (!as.length) { emptyAssignments.hidden = false; return; }
  emptyAssignments.hidden = true;

  as.forEach(a => {
    const mySub = mySubmissionsCache.find(s => s.assignmentId === a.id);
    const statusPill = mySub ? pillForStatus(mySub.status) : `<span class="pill">Teslim yok</span>`;

    const el = document.createElement("div");
    el.className = "rowcard";
    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${a.course} — ${a.title}</div>
        <div class="subline">Son: ${a.due ? fmtOnlyDate(a.due) : "—"}</div>
        <div class="subline">${a.desc ? a.desc.slice(0, 120) + (a.desc.length>120 ? "…" : "") : ""}</div>
      </div>
      ${statusPill}
    `;
    el.addEventListener("click", () => {
      setView("submit");
      if (assignmentSelect) assignmentSelect.value = a.id;
      fillSubmitPanel();
    });
    assignmentList.appendChild(el);
  });
}

function fillAssignmentSelect(){
  if (!assignmentSelect || !emptyAssignSelect) return;
  assignmentSelect.innerHTML = "";

  if (!activeClassId) {
    emptyAssignSelect.hidden = false;
    assignmentSelect.disabled = true;
    return;
  }

  const as = [...assignmentsCache].sort((a,b)=> (a.due||"").localeCompare(b.due||""));
  if (!as.length) {
    emptyAssignSelect.hidden = false;
    assignmentSelect.disabled = true;
    return;
  }

  emptyAssignSelect.hidden = true;
  assignmentSelect.disabled = false;

  as.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.course} — ${a.title} (Son: ${a.due ? fmtOnlyDate(a.due) : "—"})`;
    assignmentSelect.appendChild(opt);
  });

  if (!assignmentSelect.value) assignmentSelect.value = as[0].id;
}

function fillSubmitPanel(){
  clearAlert(submitAlert);
  if (!activeClassId || !assignmentSelect) return;

  const aId = assignmentSelect.value;
  if (!aId) return;

  const prev = mySubmissionsCache.find(s => s.assignmentId === aId);
  if (prev) setAlert(submitAlert, "err", "Bu ödeve zaten teslim yaptın. (Tekrar teslim kapalı)");
}

function applyHistoryFilters(list){
  const c = (filterCourse?.value || "").trim().toLowerCase();
  const st = filterStatus?.value || "all";
  return list.filter(s => {
    const courseOk = !c || (s.course || "").toLowerCase().includes(c);
    const statusOk = st === "all" ? true : (s.status === st);
    return courseOk && statusOk;
  });
}

function renderHistory(){
  if (!historyList || !emptyHistory) return;
  historyList.innerHTML = "";

  if (!activeClassId) { emptyHistory.hidden = false; return; }

  const subs = applyHistoryFilters([...mySubmissionsCache].sort((a,b)=> (b.submittedAt||"").localeCompare(a.submittedAt||"")));
  if (!subs.length) { emptyHistory.hidden = false; return; }
  emptyHistory.hidden = true;

  subs.forEach(s => {
    const shownName = s.originalFileName || s.fileName || "Dosya";
    const el = document.createElement("div");
    el.className = "rowcard";
    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${s.course} • ${s.title}</div>
        <div class="subline">${shownName} • ${fmtDate(s.submittedAt)}</div>
      </div>
      ${pillForStatus(s.status)}
    `;
    el.addEventListener("click", () => selectHistorySubmission(s.id));
    historyList.appendChild(el);
  });
}

// ========= detail =========
function clearSelection(){
  selectedSubmissionId = null;
  if (detailBox) detailBox.hidden = true;
  if (detailEmpty) detailEmpty.hidden = false;
}

function selectHistorySubmission(id){
  const s = mySubmissionsCache.find(x => x.id === id);
  if (!s) return;

  selectedSubmissionId = id;
  if (detailEmpty) detailEmpty.hidden = true;
  if (detailBox) detailBox.hidden = false;

  if (dTitle) dTitle.textContent = `${s.course} — ${s.title}`;
  if (dSub) dSub.textContent = `Durum: ${s.status === "graded" ? "Notlandırıldı" : "Bekliyor"}`;

  if (dStatus) {
    dStatus.textContent = s.status === "graded" ? "Notlandırıldı" : "Bekliyor";
    dStatus.className = s.status === "graded" ? "pill ok" : "pill warn";
  }

  // ✅ GridFS: fileUrl + originalFileName
  if (dFile) {
    if (s.fileUrl) {
      const text = s.originalFileName || "Dosyayı indir";
      dFile.innerHTML = `<a href="${API_BASE}${s.fileUrl}" target="_blank" rel="noopener">${text}</a>`;
    } else {
      dFile.textContent = s.originalFileName || s.fileName || "—";
    }
  }

  if (dDate) dDate.textContent = fmtDate(s.submittedAt);
  if (dGrade) dGrade.textContent = (s.grade === "" || s.grade === null || typeof s.grade === "undefined") ? "—" : String(s.grade);
  if (dFeedback) dFeedback.textContent = s.feedback ? s.feedback : "—";
}

// ========= modals =========
function openModal(modalEl){
  if (!modalEl) return;
  modalEl.classList.add("open");
  modalEl.setAttribute("aria-hidden","false");
}
function closeModal(modalEl){
  if (!modalEl) return;
  modalEl.classList.remove("open");
  modalEl.setAttribute("aria-hidden","true");
}
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-close");
    const el = document.getElementById(id);
    if (el) closeModal(el);
  });
});
[joinModal, findModal, document.getElementById("createGroupModal")].forEach(m => {
  if (!m) return;
  m.addEventListener("click", (e) => { if (e.target === m) closeModal(m); });
});

// ========= join/search =========
async function joinByCode(codeRaw){
  const code = (codeRaw || "").trim().toUpperCase();
  if (code.length !== 6) return { ok:false, msg:"Kod 6 haneli olmalı." };

  try {
    const data = await apiFetch(`/api/classes/search?code=${encodeURIComponent(code)}`);
    const cls = data?.class;
    if (!cls?.id) return { ok:false, msg:"Bu kodla sınıf bulunamadı." };

    await apiFetch(`/api/classes/join`, {
      method: "POST",
      body: JSON.stringify({ classId: cls.id, studentName: me.name || "Öğrenci" })
    });

    return { ok:true, msg:`Katıldın: ${cls.name}` };
  } catch (err) {
    return { ok:false, msg: err.message || "Katılım başarısız." };
  }
}

async function searchClassesByTeacherName(q){
  const query = (q || "").trim();
  if (!query) return [];
  try {
    const data = await apiFetch(`/api/classes/search-by-teacher?teacher=${encodeURIComponent(query)}`);
    return Array.isArray(data?.classes) ? data.classes : [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

function renderFoundClasses(classes){
  if (!foundClassList || !emptyFound) return;

  foundClassList.innerHTML = "";
  if (!classes.length) { emptyFound.hidden = false; return; }
  emptyFound.hidden = true;

  classes.forEach(cls => {
    const el = document.createElement("div");
    el.className = "rowcard";
    el.innerHTML = `
      <div class="leftcol">
        <div class="titleline">${cls.name}</div>
        <div class="subline">Öğretmen: ${cls.teacherName || "—"}</div>
        <div class="subline">Kod: ${cls.code} • ${cls.desc ? cls.desc.slice(0, 80) : "—"}</div>
      </div>
      <span class="pill">Katıl</span>
    `;
    el.addEventListener("click", async () => {
      clearAlert(findAlert);
      const res = await joinByCode(cls.code);
      if (!res.ok) return setAlert(findAlert, "err", res.msg);

      setAlert(findAlert, "ok", res.msg);
      await fillClassSelect();

      const fresh = myClassesCache.find(x => x.id === cls.id);
      if (fresh) {
        activeClassId = fresh.id;
        if (classSelect) classSelect.value = activeClassId;
      }

      await refreshAll();
      setTimeout(() => closeModal(findModal), 500);
    });
    foundClassList.appendChild(el);
  });
}

async function submitAssignment() {
  clearAlert(submitAlert);
  
  if (!requireActiveClass()) return;

  const aId = assignmentSelect?.value;
  if (!aId) return setAlert(submitAlert, "err", "Lütfen bir ödev seçin.");

  const a = assignmentsCache.find(x => x.id === aId);
  if (!a) return setAlert(submitAlert, "err", "Seçilen ödev bulunamadı.");

  const file = fileInput.files[0];
  if (!file) {
    return setAlert(submitAlert, "err", "Lütfen yüklenecek dosyayı seçin (PDF/ZIP/DOCX vb.).");
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("classId", activeClassId);
  fd.append("assignmentId", a.id);
  fd.append("teacherId", a.teacherId);
  fd.append("studentName", me.name || "Öğrenci");
  fd.append("course", a.course || "");
  fd.append("title", a.title || "");
  fd.append("studentNote", (studentNote?.value || "").trim());
  
  setAlert(submitAlert, "warn", "Dosya sunucuya yükleniyor, lütfen bekleyin...");
  const submitBtn = submitForm ? submitForm.querySelector('button[type="submit"]') : null;
  if(submitBtn) submitBtn.disabled = true;

  try {
    await apiFetch(`/api/submissions/upload`, {
      method: "POST",
      body: fd
    });

    setAlert(submitAlert, "ok", "Ödev başarıyla teslim edildi!");
    
    if (studentNote) studentNote.value = "";
    if (fileInput) fileInput.value = "";
    
    await refreshAll(); 
  } catch (err) {
    setAlert(submitAlert, "err", err.message || "Ödev yüklenirken bir hata oluştu.");
  } finally {
    if(submitBtn) submitBtn.disabled = false;
  }
}

// ========= refresh =========
async function refreshAll(){
  if (activeClassId) {
    try {
      assignmentsCache = await fetchAssignments(activeClassId);
      mySubmissionsCache = await fetchMySubmissions(activeClassId);
      
      const data = await apiFetch(`/api/classes/members?classId=${activeClassId}`);
      classMembersCache = data.members || [];
      
      const perfData = await apiFetch(`/api/student/performance?classId=${activeClassId}`);
      const perfElement = document.getElementById("myPerfScore");
      const badgeElement = document.getElementById("myPerfBadges");
      
      if(perfData && perfData.performance && perfElement && badgeElement) {
        const perf = perfData.performance;
        perfElement.textContent = perf.score;
        badgeElement.innerHTML = perf.badges.map(b => `<span class="pill" style="background:#fff; color:#b45309; border:1px solid #fde68a; font-weight:900; box-shadow:0 1px 3px rgba(0,0,0,0.05); font-size:12px; padding:4px 10px;">${b}</span>`).join(" ");
      }

    } catch (e) {
      console.error(e);
      assignmentsCache = [];
      mySubmissionsCache = [];
      classMembersCache = [];
    }
  } else {
    assignmentsCache = [];
    mySubmissionsCache = [];
    classMembersCache = [];
  }

  setActiveClassChip();
  renderKPIs();
  renderUpcoming();
  renderMyLastSubs();
  renderAssignments();
  fillAssignmentSelect();
  fillSubmitPanel();
  renderHistory();
  loadPrivateChat();
  loadGroups(); 
}

// ========= EVENTLER =========
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
  const aiPanel = document.getElementById('aiPanel');

  if(chatBtn) chatBtn.addEventListener('click', () => { 
    if(chatPanel) chatPanel.hidden = false; 
    if(aiPanel) aiPanel.hidden = true; 
    loadPrivateChat(); 
  });
  if(closeChat) closeChat.addEventListener('click', () => { if(chatPanel) chatPanel.hidden = true; });

  const aiBtn = document.getElementById('aiBtn');
  const closeAi = document.getElementById('closeAi');
  if(aiBtn) aiBtn.addEventListener('click', () => { 
    if(aiPanel) aiPanel.hidden = false; 
    if(chatPanel) chatPanel.hidden = true; 
    updateAIClassChip(); // 6. Hafta: Sınıf bilgisini güncelle
  });
  if(closeAi) closeAi.addEventListener('click', () => { if(aiPanel) aiPanel.hidden = true; });

  // 6. Hafta: Hızlı soru butonları
  document.querySelectorAll('.ai-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-question');
      if(q) askAI(q);
    });
  });

  const privateChatInput = document.getElementById("privateChatInput");
  const sendPrivateChatBtn = document.getElementById("sendPrivateChatBtn");
  if(privateChatInput) privateChatInput.addEventListener("keypress", (e) => { if(e.key === 'Enter') sendPrivateChat(); });
  if(sendPrivateChatBtn) sendPrivateChatBtn.addEventListener("click", sendPrivateChat);

  const aiInput = document.getElementById("aiInput");
  const sendAiBtn = document.getElementById("sendAiBtn");
  if(aiInput) aiInput.addEventListener("keypress", (e) => { if(e.key === 'Enter') askAI(); });
  if(sendAiBtn) sendAiBtn.addEventListener("click", () => askAI());

  // YENİ: Grup Ayarları Eventleri
  document.getElementById("openGroupSettingsBtn")?.addEventListener("click", () => {
    const el = document.getElementById("groupSettingsArea");
    if(el) el.hidden = false;
    populateGroupSettings();
  });
  
  document.getElementById("closeGroupSettingsBtn")?.addEventListener("click", () => {
    const el = document.getElementById("groupSettingsArea");
    if(el) el.hidden = true;
  });

  document.getElementById("saveGroupNameBtn")?.addEventListener("click", async () => {
    const nameInput = document.getElementById("editGroupName");
    const name = nameInput ? nameInput.value.trim() : "";
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
    if(memberIds.length===0) return setAlert(alertEl, "err", "Lütfen eklenecek öğrencileri seçin.");
    try {
      const btn = document.getElementById("addMembersBtn");
      btn.disabled = true; btn.textContent = "Ekleniyor...";
      await apiFetch(`/api/groups/${activeGroupId}/members`, { method: "POST", body: JSON.stringify({memberIds}) });
      setAlert(alertEl, "ok", "Öğrenciler başarıyla eklendi!");
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

  document.getElementById("leaveGroupBtn")?.addEventListener("click", async () => {
    if(!confirm("Gruptan çıkmak istediğine emin misin?")) return;
    try {
      await apiFetch(`/api/groups/${activeGroupId}/members/${me.id}`, { method: "DELETE" });
      activeGroupId = null;
      if(document.getElementById("groupChatArea")) document.getElementById("groupChatArea").hidden = true;
      if(document.getElementById("groupSettingsArea")) document.getElementById("groupSettingsArea").hidden = true;
      if(document.getElementById("groupChatEmpty")) document.getElementById("groupChatEmpty").hidden = false;
      loadGroups();
    } catch(e) {}
  });

  // Grup Chat Eventleri
  document.getElementById("openCreateGroupModal")?.addEventListener("click", openGroupModal);
  document.getElementById("submitCreateGroupBtn")?.addEventListener("click", createGroup);
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

// ==========================================
// EKRAN VE ODAK TAKİP SİSTEMİ (SCREEN TRACKING)
// ==========================================
let trackTotalSeconds = 0;
let trackActiveSeconds = 0;
let trackDistractSeconds = 0;

let isWindowFocused = true;
let lastInteractionTime = Date.now();

// Olay dinleyiciler
window.addEventListener("focus", () => { isWindowFocused = true; lastInteractionTime = Date.now(); });
window.addEventListener("blur", () => { isWindowFocused = false; });
window.addEventListener("mousemove", () => { lastInteractionTime = Date.now(); });
window.addEventListener("keydown", () => { lastInteractionTime = Date.now(); });

setInterval(() => {
  trackTotalSeconds++;
  
  // 30 saniye mause/klavye dokunulmazsa afk kalındı sayılır
  const isIdle = (Date.now() - lastInteractionTime) > 30000; 
  
  if (isWindowFocused && !isIdle) {
    trackActiveSeconds++;
  } else {
    trackDistractSeconds++;
  }
  
  // Arayüzü güncelle
  const elTotal = document.getElementById("trackTotalTime");
  const elActive = document.getElementById("trackActiveTime");
  const elDistract = document.getElementById("trackDistractTime");
  const elAi = document.getElementById("trackAiComment");
  
  if (elTotal) elTotal.textContent = Math.floor(trackTotalSeconds / 60) + "dk " + (trackTotalSeconds % 60) + "sn";
  if (elActive) elActive.textContent = Math.floor(trackActiveSeconds / 60) + "dk " + (trackActiveSeconds % 60) + "sn";
  if (elDistract) elDistract.textContent = Math.floor(trackDistractSeconds / 60) + "dk " + (trackDistractSeconds % 60) + "sn";
  
  // Yapay Zeka Yorumu Güncellemesi (Her 5 saniyede bir değerlendir fakat mesaj okunaklı kalsın)
  if (elAi && trackTotalSeconds > 10) {
    const distractRatio = trackDistractSeconds / trackTotalSeconds;
    if (distractRatio > 0.5) {
      elAi.innerHTML = "<span style='color:#f43f5e;'>Aklın başka yerde gibi! 📵 Başka sekmelerde geziniyor veya AFK kalıyor olabilirsin. Hemen derse dön!</span>";
    } else if (distractRatio > 0.2) {
      elAi.innerHTML = "<span style='color:#f59e0b;'>Dikkat dağınıklığın biraz artıyor. ☕ Ufak bir su/kahve molası iyi gelebilir.</span>";
    } else {
      elAi.innerHTML = "<span style='color:#10b981;'>Harika gidiyorsun! 🚀 Saf odaklanma oranının yüksek olması ödevlerinde sana başarı getirecektir.</span>";
    }
  }
}, 1000);

// ========= init =========
(async function boot(){
  if (who) who.textContent = me?.name ? `👩‍🎓 ${me.name}` : "👩‍🎓 Öğrenci";

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("user");
      window.location.replace("/Ogrenci/ogrenci-giris.html");
    });
  }

  navBtns.forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));

  if (classSelect) {
    classSelect.addEventListener("change", async () => {
      activeClassId = classSelect.value || null;
      activeGroupId = null;
      if(document.getElementById("groupChatArea")) document.getElementById("groupChatArea").hidden = true;
      if(document.getElementById("groupSettingsArea")) document.getElementById("groupSettingsArea").hidden = true;
      if(document.getElementById("groupChatEmpty")) document.getElementById("groupChatEmpty").hidden = false;
      clearSelection();
      await refreshAll();
    });
  }

  const goAss = document.getElementById("goAssignments");
  if (goAss) goAss.addEventListener("click", () => setView("assignments"));
  
  const goHist = document.getElementById("goHistory");
  if (goHist) goHist.addEventListener("click", () => setView("history"));

  if (filterCourse) filterCourse.addEventListener("input", () => renderHistory());
  if (filterStatus) filterStatus.addEventListener("change", () => renderHistory());

  if (clearSelectionBtn) clearSelectionBtn.addEventListener("click", clearSelection);

  if (openJoin) {
    openJoin.addEventListener("click", () => {
      clearAlert(joinAlert);
      if (classCode) classCode.value = "";
      openModal(joinModal);
    });
  }

  if (joinForm) {
    joinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAlert(joinAlert);

      const res = await joinByCode(classCode?.value);
      if (!res.ok) return setAlert(joinAlert, "err", res.msg);

      setAlert(joinAlert, "ok", res.msg);
      await fillClassSelect();

      const code = (classCode?.value || "").trim().toUpperCase();
      const joined = myClassesCache.find(c => (c.code || "").toUpperCase() === code);
      if (joined) {
        activeClassId = joined.id;
        if (classSelect) classSelect.value = activeClassId;
      }

      await refreshAll();
      setTimeout(() => closeModal(joinModal), 500);
    });
  }

  if (openFind) {
    openFind.addEventListener("click", () => {
      clearAlert(findAlert);
      if (foundClassList) foundClassList.innerHTML = "";
      if (emptyFound) emptyFound.hidden = true;
      if (teacherQuery) teacherQuery.value = "";
      openModal(findModal);
    });
  }

  if (searchTeacherBtn) {
    searchTeacherBtn.addEventListener("click", async () => {
      clearAlert(findAlert);
      const q = teacherQuery?.value || "";
      if (!q.trim()) {
        setAlert(findAlert, "err", "Öğretmen adı yazmalısın.");
        return renderFoundClasses([]);
      }
      setAlert(findAlert, "ok", "Aranıyor...");
      const list = await searchClassesByTeacherName(q);
      if (!list.length) setAlert(findAlert, "err", "Sonuç bulunamadı.");
      else clearAlert(findAlert);
      renderFoundClasses(list);
    });
  }

  if (assignmentSelect) assignmentSelect.addEventListener("change", fillSubmitPanel);

  if (submitForm) {
    submitForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await submitAssignment();
    });
  }

  await fillClassSelect();
  setView("dashboard");
  clearSelection();
  await refreshAll();
  
  loadNotifications();
  
  // Arka planda 5 saniyede bir yeni mesaj/bildirim kontrolü
  setInterval(() => {
    if (activeClassId && document.getElementById('chatPanel') && !document.getElementById('chatPanel').hidden) {
      loadPrivateChat(); 
    }
    if (activeGroupId && document.getElementById('groupChatArea') && !document.getElementById('groupChatArea').hidden) {
      loadGroupMessages();
    }
    loadNotifications();
  }, 5000);

  // ==========================================
  // CANLI DERS & QUIZ (ÖĞRENCİ)
  // ==========================================
  let activeQuizId = null;
  
  async function checkStudentLiveStatus() {
    if (!activeClassId) return;
    try {
      const data = await apiFetch(`/api/live/status?classId=${activeClassId}`);
      if (data && data.active) {
        document.getElementById("liveWaiting").hidden = true;
        document.getElementById("liveActive").hidden = false;
        
        const btn = document.getElementById("joinLiveBtn");
        btn.onclick = async () => {
          try { await apiFetch("/api/live/join", { method: "POST", body: JSON.stringify({ classId: activeClassId }) }); } catch(e) {}
          window.open(data.lesson.link, "_blank");
          // Butonu da güncelleyelim
          btn.innerText = "Derstesiniz (Tekrar Aç)";
          btn.style.background = "#10b981";
          btn.style.borderColor = "#059669";
        };
  
        if (data.lesson.activeQuiz && data.lesson.activeQuiz.id !== activeQuizId) {
          const myAns = data.lesson.activeQuiz.answers.find(a => a.studentId === me.id);
          if (!myAns) {
            activeQuizId = data.lesson.activeQuiz.id;
            const qText = document.getElementById("quizQuestionText");
            const optsContainer = document.getElementById("quizOptions");
            if (qText && optsContainer) {
              qText.innerText = data.lesson.activeQuiz.question;
              optsContainer.innerHTML = "";
              data.lesson.activeQuiz.options.forEach(opt => {
                optsContainer.innerHTML += `
                  <label style="display:flex; align-items:center; gap:10px; padding:12px; border:1px solid #cbd5e1; border-radius:8px; cursor:pointer; background:#f8fafc; font-weight:bold; color:#1e3a5f;">
                    <input type="radio" name="quizChoice" value="${opt}" style="width:18px; height:18px;" />
                    ${opt}
                  </label>
                `;
              });
              document.getElementById("quizAlert").hidden = true;
              document.getElementById("submitQuizBtn").disabled = false;
              openModal(document.getElementById("quizModal"));
            }
          }
        }
      } else {
        document.getElementById("liveWaiting").hidden = false;
        document.getElementById("liveActive").hidden = true;
        closeModal(document.getElementById("quizModal"));
        activeQuizId = null;
        const btn = document.getElementById("joinLiveBtn");
        if(btn) {
           btn.innerText = "🚀 Derse Katıl";
           btn.style.background = "#ef4444";
           btn.style.borderColor = "#b91c1c";
        }
      }
    } catch(e) {}
  }
  
  const submitQuizBtn = document.getElementById("submitQuizBtn");
  if (submitQuizBtn) {
    submitQuizBtn.onclick = async () => {
      const selected = document.querySelector('input[name="quizChoice"]:checked');
      const alertEl = document.getElementById("quizAlert");
      if (!selected) {
        alertEl.className = "alert err"; alertEl.innerText = "Lütfen önce bir cevap şıkkı seçin."; alertEl.hidden = false;
        return;
      }

      const chosenValue = selected.value;
      submitQuizBtn.disabled = true;
      submitQuizBtn.innerText = "Gönderiliyor...";

      try {
        const result = await apiFetch("/api/quiz/submit", { method: "POST", body: JSON.stringify({ classId: activeClassId, quizId: activeQuizId, choice: chosenValue }) });

        const correctAns = (result.correctAnswer || "").trim();
        const isCorrect = result.isCorrect === true;

        // Gönder butonunu gizle
        submitQuizBtn.hidden = true;

        // Şıkları sonuca göre yeniden render et
        const optsContainer = document.getElementById("quizOptions");
        if (optsContainer) {
          const allLabels = optsContainer.querySelectorAll("label");
          allLabels.forEach(label => {
            const radio = label.querySelector('input[type="radio"]');
            if (!radio) return;

            const val = radio.value.trim();
            const wasChosen = val === chosenValue.trim();
            const isCorrectOption = correctAns && val === correctAns;

            // Hepsini disable et
            radio.disabled = true;

            if (isCorrectOption) {
              // Doğru cevabı yeşil göster - BÜYÜK VE BELİRGİN
              label.style.cssText = "display:flex; align-items:center; gap:12px; padding:16px; border:3px solid #10b981; border-radius:12px; cursor:default; background:rgba(16,185,129,0.15); font-weight:900; color:#059669; opacity:1; font-size:16px; box-shadow: 0 0 12px rgba(16,185,129,0.3);";
              const checkMark = document.createElement("span");
              checkMark.style.cssText = "margin-left:auto; font-weight:900; font-size:15px; background:#10b981; color:white; padding:4px 12px; border-radius:20px;";
              checkMark.textContent = "✅ Doğru Cevap";
              label.appendChild(checkMark);
            } else if (wasChosen && !isCorrect) {
              // Yanlış seçimi kırmızı göster - BÜYÜK VE BELİRGİN
              label.style.cssText = "display:flex; align-items:center; gap:12px; padding:16px; border:3px solid #ef4444; border-radius:12px; cursor:default; background:rgba(239,68,68,0.12); font-weight:900; color:#ef4444; opacity:1; font-size:16px; box-shadow: 0 0 12px rgba(239,68,68,0.25);";
              const wrongMark = document.createElement("span");
              wrongMark.style.cssText = "margin-left:auto; font-weight:900; font-size:15px; background:#ef4444; color:white; padding:4px 12px; border-radius:20px;";
              wrongMark.textContent = "❌ Yanlış";
              label.appendChild(wrongMark);
            } else {
              // Diğer şıkları soluk göster
              label.style.cssText = "display:flex; align-items:center; gap:10px; padding:12px; border:1px solid #e2e8f0; border-radius:8px; cursor:default; background:#f8fafc; font-weight:bold; color:#94a3b8; opacity:0.4; font-size:14px;";
            }
          });
        }

        // Sonuç mesajını göster - BÜYÜK VE BELİRGİN
        if (isCorrect) {
          alertEl.className = "alert ok";
          alertEl.style.cssText = "font-size:16px; padding:16px 18px; text-align:center;";
          alertEl.innerHTML = '🎉 <b style="font-size:18px;">Tebrikler! Doğru cevap!</b><br><span style="font-size:13px;">Cevabınız öğretmene iletildi.</span>';
          alertEl.hidden = false;
        } else {
          alertEl.className = "alert err";
          alertEl.style.cssText = "font-size:16px; padding:16px 18px; text-align:center;";
          alertEl.innerHTML = '❌ <b style="font-size:18px;">Yanlış cevap!</b><br><span style="font-size:14px;">Doğru cevap: </span><b style="color:#059669; font-size:18px; background:rgba(16,185,129,0.12); padding:2px 10px; border-radius:8px;">' + (correctAns || "Belirtilmemiş") + '</b>';
          alertEl.hidden = false;
        }

        // Modal'ı 6 saniye sonra otomatik kapat
        setTimeout(() => closeModal(document.getElementById("quizModal")), 6000);
      } catch(err) {
        alertEl.className = "alert err"; alertEl.innerText = err.message; alertEl.hidden = false;
        submitQuizBtn.disabled = false;
        submitQuizBtn.innerText = "Cevabı Gönder";
      }
    };
  }
  
  setInterval(() => {
    if (activeClassId) checkStudentLiveStatus();
  }, 5000);

})();