"use strict";
console.count("PAGE JS INIT");

const ROLE = "student";
const PANEL_URL = "/Ogrenci/ogrenci-panel.html";

// Sunucu URL'si: Kendi bilgisayarında 3000 portunda çalışıyorsa bu şekilde kalmalı.
const API_BASE = "http://localhost:3000"; 

// ---- DOM ----
const tabs = document.querySelectorAll(".tab");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

const loginAlert = document.getElementById("loginAlert");
const regAlert = document.getElementById("regAlert");
const loginSubmit = document.getElementById("loginSubmit");
const regSubmit = document.getElementById("regSubmit");
const rememberMe = document.getElementById("rememberMe");

// strength UI
const strengthBar = document.getElementById("strengthBar");
const strengthText = document.getElementById("strengthText");
const regPasswordInput = document.getElementById("regPassword");
const terms = document.getElementById("terms");

let busy = false;

console.log("ogrenci-giris.js yüklendi ✅");

// ---- helpers ----
function setAlert(el, type, text) {
  if (!el) return;
  el.hidden = false;
  el.className = "alert " + type;
  el.textContent = text;
}
function clearAlert(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}
function setLoading(btn, v) {
  if (!btn) return;
  btn.disabled = v;
  btn.classList.toggle("loading", v);
}
function setTab(name) {
  tabs.forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });

  if (loginForm) loginForm.classList.toggle("active", name === "login");
  if (registerForm) registerForm.classList.toggle("active", name === "register");

  clearAlert(loginAlert);
  clearAlert(regAlert);
}

function v(id) {
  return (document.getElementById(id)?.value || "").trim();
}
function vRaw(id) {
  return (document.getElementById(id)?.value || "");
}
function normalizeEmail(s) {
  return String(s || "").trim().toLowerCase();
}
async function safeJson(res) {
  try { return await res.json(); }
  catch { return {}; }
}

// ---- UI EVENTS (TAB / JUMP) ----
document.addEventListener("click", (e) => {
  const tabBtn = e.target.closest(".tab");
  if (tabBtn) return setTab(tabBtn.dataset.tab);

  const jumpBtn = e.target.closest("[data-jump]");
  if (jumpBtn) return setTab(jumpBtn.dataset.jump);
});

// ---- password toggle ----
// ---- password strength (Görsel ve İşlevsel Düzeltme) ----
function calcStrength(pw) {
  let score = 0;
  if (!pw) return { label: "—", pct: 0, color: "transparent" };

  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;

  if (/[a-z]/.test(pw)) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  // Aynı karakterin tekrarını cezalandır (örn: aaaaaa)
  if (/^(.)\1+$/.test(pw)) score = Math.max(0, score - 2);

  const pct = Math.min(100, Math.round((score / 6) * 100));

  let label = "Çok Zayıf";
  let color = "#ff4d4f"; // Kırmızı
  
  if (score >= 5) { label = "Çok Güçlü"; color = "#52c41a"; } // Koyu Yeşil
  else if (score >= 4) { label = "Güçlü"; color = "#95de64"; } // Açık Yeşil
  else if (score >= 3) { label = "Orta"; color = "#faad14"; } // Turuncu
  else if (score >= 2) { label = "Zayıf"; color = "#ff7a45"; } // Koyu Turuncu

  return { label, pct, color };
}

function updateStrengthUI(pw) {
  if (!strengthBar || !strengthText) return;
  const { label, pct, color } = calcStrength(pw);
  
  // Barın görsel ayarları
  strengthBar.style.width = pct + "%";
  strengthBar.style.backgroundColor = color;
  strengthBar.style.height = "6px"; 
  strengthBar.style.borderRadius = "4px";
  strengthBar.style.transition = "width 0.3s ease, background-color 0.3s ease";
  
  // Metnin görsel ayarları
  strengthText.textContent = `Şifre gücü: ${pw ? label : "—"}`;
  strengthText.style.color = pw ? color : "#666";
  strengthText.style.fontWeight = "bold";
  strengthText.style.fontSize = "0.9em";
  strengthText.style.marginTop = "5px";
}

// Şifre kutusuna her harf girildiğinde tetikle
if (regPasswordInput) {
  updateStrengthUI(regPasswordInput.value);
  regPasswordInput.addEventListener("input", (e) => updateStrengthUI(e.target.value));
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-toggle-password]");
  if (!btn) return;

  const wrap = btn.closest(".input-wrap");
  const input = wrap ? wrap.querySelector("input") : null;
  if (!input) return;

  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";

  btn.textContent = isHidden ? "👁️" : "🙈";
  btn.setAttribute("aria-label", isHidden ? "Şifreyi gizle" : "Şifreyi göster");
});

// ---- auto redirect ----
(() => {
  if (location.search.includes("noredirect=1")) return;

  try {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");

    if (token && role === ROLE) {
      if (window.location.pathname !== PANEL_URL) {
        window.location.replace(PANEL_URL);
      }
    }
  } catch (e) {
    console.warn("Auto redirect iptal edildi:", e);
  }
})();

// ==========================
// LOGIN
// ==========================
loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;

  clearAlert(loginAlert);
  busy = true;
  setLoading(loginSubmit, true);

  try {
    const email = normalizeEmail(v("loginEmail"));
    const password = vRaw("loginPassword");

    if (!email || !password) throw new Error("E-posta ve şifre zorunlu.");

    // API_BASE EKLENDİ
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: ROLE, email, password }),
    });

    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      throw new Error(data.message || `Giriş başarısız (HTTP ${res.status})`);
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("role", ROLE);
    localStorage.setItem("user", JSON.stringify(data.user || {}));
    localStorage.setItem("remember", rememberMe?.checked ? "1" : "0");

    // Localhost veya Live Server kullanımında rotayı kök dizine göre ayarlamak daha güvenlidir
    window.location.href = API_BASE ? `${API_BASE}${PANEL_URL}` : PANEL_URL;

  } catch (err) {
    console.error("LOGIN ERR:", err);
    // TypeError: Failed to fetch hatasını daha kullanıcı dostu bir mesaja çevirelim
    if (err.message.includes("Failed to fetch")) {
      setAlert(loginAlert, "err", "Sunucuya bağlanılamadı. Node.js sunucusunun (localhost:3000) açık olduğundan emin olun.");
    } else {
      setAlert(loginAlert, "err", err?.message || "Giriş başarısız");
    }
  } finally {
    busy = false;
    setLoading(loginSubmit, false);
  }
});

// ==========================
// REGISTER
// ==========================
registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;

  clearAlert(regAlert);

  if (terms && !terms.checked) {
    setAlert(regAlert, "err", "Devam etmek için şartları kabul etmelisin.");
    return;
  }

  busy = true;
  setLoading(regSubmit, true);

  try {
    const first = v("regFirstName");
    const last = v("regLastName");
    const name = `${first} ${last}`.trim();

    const email = normalizeEmail(v("regEmail"));
    const password = vRaw("regPassword");

    if (!name || !email || !password) {
      throw new Error("Lütfen tüm alanları doldur (Ad, Soyad, Email, Şifre).");
    }

    // API_BASE EKLENDİ
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: ROLE, name, email, password }),
    });

    const data = await safeJson(res);

    if (!res.ok || !data.ok) {
      throw new Error(data.message || `Kayıt başarısız (HTTP ${res.status})`);
    }

    setAlert(regAlert, "ok", "Kayıt başarılı. Giriş yapabilirsin.");
    
    // Formu temizle ve Login sekmesine geç
    registerForm.reset();
    setTab("login");
  } catch (err) {
    console.error("REGISTER ERR:", err);
    // TypeError: Failed to fetch hatasını daha anlaşılır yapalım
    if (err.message.includes("Failed to fetch")) {
      setAlert(regAlert, "err", "Sunucuya bağlanılamadı. Node.js sunucusunun (localhost:3000) açık olduğundan emin olun.");
    } else {
      setAlert(regAlert, "err", err?.message || "Kayıt başarısız");
    }
  } finally {
    busy = false;
    setLoading(regSubmit, false);
  }
});