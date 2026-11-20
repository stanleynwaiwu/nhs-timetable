import { DAYS, HOURS, VENUES, INSTRUCTORS, pad, keyOf, findClash } from "./constants.js";
import { createStore } from "./store.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const instr = (id) => INSTRUCTORS.find((i) => i.id === id);
const timeLabel = (h) => `${pad(h)}:00–${pad(h + 1)}:00`;
const dayName = (short) => DAYS.find((d) => d[0] === short)[1];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const initialsOf = (name) => { const w = String(name || "?").trim().split(/\s+/); return (w[w.length - 1][0] || "?").toUpperCase(); };
const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/* ---------- App state ---------- */
let store, user = null, me = null, isAdmin = false;
let bookings = {}, adminData = { pending: {}, users: {}, admins: {} };
let section = "timetable", authMode = "signin";
let stopBookings = null, stopAdmin = null;
const adminDraft = {};                      // remembers half-chosen approval options while the list refreshes

/* ---------- Small UI helpers ---------- */
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2800);
}

function openDialog({ title, body, actions }) {
  $("#dlgTitle").textContent = title;
  $("#dlgBody").innerHTML = body;
  const box = $("#dlgActions"); box.innerHTML = "";
  actions.forEach((a) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn " + (a.kind || ""); b.textContent = a.label;
    b.onclick = async () => {
      if (a.onClick) {
        b.disabled = true;
        const keepOpen = await a.onClick(b);
        b.disabled = false;
        if (keepOpen) return;
      }
      $("#dlg").close();
    };
    box.appendChild(b);
  });
  const d = $("#dlg"); if (!d.open) d.showModal();
}
const closeBtn = { label: "Close" };

function showScreen(name) {
  $("#boot").hidden = name !== "boot";
  $("#auth").hidden = name !== "auth";
  $("#app").hidden = name !== "app";
  document.body.classList.toggle("in-app", name === "app");
}

/* =====================================================================
   SIGN IN / CREATE ACCOUNT / WAITING FOR APPROVAL
   ===================================================================== */
const LOGO = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="11" height="11" rx="3" fill="#60a5fa"/><rect x="14" y="1" width="11" height="11" rx="3" fill="#f472b6"/><rect x="1" y="14" width="11" height="11" rx="3" fill="#34d399"/><rect x="14" y="14" width="11" height="11" rx="3" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="3 3"/></svg>`;

const authShell = (inner) => `
  <div class="auth-hero">
    <div class="auth-logo">${LOGO}<span>NHS Labs</span></div>
    <h1>One lab.<br>One hour.<br>One instructor.</h1>
    <p>The timetable that makes sure two classes never land in the same room.</p>
    <div class="auth-demo" aria-hidden="true">
      <div class="d-card">
        <small>Monday · 09:00</small>
        <div class="d-chip" style="--c:#2563eb"><b>Old NHS Lab</b><span>Mr Stanley</span></div>
        <div class="d-chip d-free"><b>New NHS Lab</b><span>+ Free</span></div>
      </div>
      <div class="d-card d-warn">
        <small>Miss Inem tries Old NHS Lab</small>
        <div class="d-note">Already booked. Please reach out to Mr Stanley.</div>
      </div>
    </div>
  </div>
  <div class="auth-panel">${inner}</div>`;

function renderAuth(mode = "signin", msg = "", ok = false) {
  authMode = mode;
  const signup = mode === "signup";
  $("#auth").innerHTML = authShell(`
    <div class="auth-card">
      <h2>${signup ? "Create your account" : "Welcome back"}</h2>
      <p class="sub">${signup ? "Use your work email. An admin confirms it's you before you can book." : "Sign in to book your lab slots."}</p>
      <form id="authForm" novalidate>
        ${signup ? `<label class="fld"><span>Full name</span><input id="f-name" type="text" autocomplete="name" placeholder="e.g. Mr Stanley" maxlength="60" /></label>` : ""}
        <label class="fld"><span>Email</span><input id="f-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" /></label>
        <label class="fld"><span>Password</span>
          <div class="pw"><input id="f-pw" type="password" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="${signup ? "At least 8 characters" : "Your password"}" />
          <button type="button" id="pwToggle" class="pw-btn">Show</button></div>
        </label>
        <div id="authMsg" class="auth-msg ${ok ? "ok" : ""}" role="alert">${esc(msg)}</div>
        <button class="btn primary wide" id="authGo" type="submit">${signup ? "Create account" : "Sign in"}</button>
      </form>
      ${signup ? "" : `<button class="link" id="forgot" type="button">Forgot password?</button>`}
      <p class="switch">${signup ? "Already have an account?" : "New here?"}
        <button class="link" id="switchMode" type="button">${signup ? "Sign in" : "Create an account"}</button></p>
    </div>`);
}

function renderPending(s) {
  const first = String(s.user.name || "").trim().split(/\s+/).pop();
  $("#auth").innerHTML = authShell(`
    <div class="auth-card center">
      <div class="wait" aria-hidden="true"><span></span></div>
      <h2>Almost there${first ? ", " + esc(first) : ""}</h2>
      <p class="sub">Your account is created. An admin needs to link it to your instructor profile before you can book. This page updates by itself the moment you're approved.</p>
      <p class="mail">${esc(s.user.email)}</p>
      ${s.warning ? `<div class="auth-msg">${esc(s.warning)}</div>` : ""}
      <button class="btn wide" id="signOut2" type="button">Sign out</button>
    </div>`);
}

function friendly(err) {
  const map = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "Wrong email or password.",
    "auth/invalid-email": "That email doesn't look right.",
    "auth/email-already-in-use": "That email already has an account. Try signing in.",
    "auth/weak-password": "Choose a stronger password (at least 8 characters).",
    "auth/missing-password": "Enter your password.",
    "auth/network-request-failed": "Network problem. Check your connection and try again.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/operation-not-allowed": "Email sign-in isn't switched on yet. The admin needs to enable it in Firebase."
  };
  return map[err && err.code] || "Something went wrong. Please try again.";
}

function setAuthMsg(msg, ok = false) {
  const el = $("#authMsg"); if (!el) return;
  el.textContent = msg; el.classList.toggle("ok", ok);
}
function setBusy(on) {
  const b = $("#authGo"); if (!b) return;
  b.disabled = on; b.textContent = on ? "Please wait…" : (authMode === "signup" ? "Create account" : "Sign in");
}

async function onAuthSubmit(e) {
  e.preventDefault();
  const name = ($("#f-name") ? $("#f-name").value : "").trim();
  const email = $("#f-email").value.trim();
  const pw = $("#f-pw").value;
  if (authMode === "signup" && name.length < 2) return setAuthMsg("Enter your full name.");
  if (!/^\S+@\S+\.\S+$/.test(email)) return setAuthMsg("Enter a valid email address.");
  if (!pw) return setAuthMsg("Enter your password.");
  if (authMode === "signup" && pw.length < 8) return setAuthMsg("Use at least 8 characters for your password.");
  setAuthMsg(""); setBusy(true);
  try {
    if (authMode === "signup") await store.signUp(name, email, pw);
    else await store.signIn(email, pw);
  } catch (err) {
    console.error(err);
    setAuthMsg(friendly(err));
    setBusy(false);
  }
}

async function onAuthClick(e) {
  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "switchMode") renderAuth(authMode === "signup" ? "signin" : "signup");
  else if (t.id === "pwToggle") {
    const i = $("#f-pw"), show = i.type === "password";
    i.type = show ? "text" : "password"; t.textContent = show ? "Hide" : "Show";
  } else if (t.id === "forgot") {
    const email = $("#f-email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setAuthMsg("Type your email above first, then tap Forgot password.");
    try { await store.resetPassword(email); } catch (err) { console.error(err); }
    setAuthMsg("If that email has an account, a reset link is on its way.", true);
  } else if (t.id === "signOut2") await store.signOut();
}

/* =====================================================================
   SESSION: reacts to sign-in / sign-out / approval
   ===================================================================== */
function stopData() {
  if (stopBookings) stopBookings(); if (stopAdmin) stopAdmin();
  stopBookings = stopAdmin = null;
}

function handleAuth(s) {
  stopData();
  bookings = {};
  user = s.user || null;
  me = null; isAdmin = false;

  if (s.status === "ready") {
    me = s.profile.instructorId; isAdmin = !!s.profile.isAdmin;
    if (section === "admin" && !isAdmin) section = "timetable";
    showScreen("app");
    renderChrome();
    stopBookings = store.subscribeBookings((d) => { bookings = d; render(); }, setStatus);
    if (isAdmin) stopAdmin = store.subscribeAdmin((d) => { adminData = d; renderAdmin(); renderChrome(); });
    render();
  } else if (s.status === "pending") {
    showScreen("auth"); renderPending(s);
  } else {
    section = "timetable";
    showScreen("auth"); renderAuth("signin");
  }
}

function renderChrome() {
  const prof = instr(me);
  const label = prof ? prof.name : (user.name || "Admin");
  $("#acct").innerHTML = `<i class="av" style="--c:${prof ? prof.color : "#111827"}">${esc(initialsOf(label))}</i><span>${esc(label)}</span>`;

  const nav = $("#sections");
  nav.hidden = !isAdmin;
  if (isAdmin) {
    const n = Object.keys(adminData.pending || {}).length;
    nav.innerHTML =
      `<button class="stab ${section === "timetable" ? "on" : ""}" data-sec="timetable">Timetable</button>` +
      `<button class="stab ${section === "admin" ? "on" : ""}" data-sec="admin">Admin${n ? `<b>${n}</b>` : ""}</button>`;
  }
  $("#sec-timetable").hidden = section !== "timetable";
  $("#sec-admin").hidden = section !== "admin";
}

function openAccount() {
  const prof = instr(me);
  openDialog({
    title: "Your account",
    body: `<p><b>${esc(user.name)}</b><br>${esc(user.email)}</p>
      <p>${prof ? `Teaching as <b>${esc(prof.name)}</b>` : "Not linked to an instructor profile"}${isAdmin ? ` <span class="badge">Admin</span>` : ""}</p>`,
    actions: [closeBtn, { label: "Sign out", kind: "danger", onClick: async () => { await store.signOut(); return false; } }]
  });
}

/* =====================================================================
   TIMETABLE (unchanged look and behaviour)
   ===================================================================== */
function setupHeader() {
  $("#onlyMine").onchange = render;
  $("#legend").innerHTML = INSTRUCTORS.map((i) =>
    `<span><i class="dot" style="background:${i.color}"></i>${i.name}</span>`).join("") +
    `<span>· Two labs per hour: ${Object.values(VENUES).join(" / ")}</span>`;
}

function render() {
  const grid = $("#grid");
  const todayShort = SHORT_DAYS[new Date().getDay()];
  const onlyMine = $("#onlyMine").checked && me;
  let html = `<div class="hd">Time</div>` +
    DAYS.map(([s, l]) => `<div class="hd ${s === todayShort ? "today" : ""}">${l}</div>`).join("");

  for (const h of HOURS) {
    html += `<div class="time">${timeLabel(h)}</div>`;
    for (const [d] of DAYS) {
      const key = keyOf(d, h), slot = bookings[key] || {};
      html += `<div class="cell ${d === todayShort ? "today" : ""}">`;
      for (const v of Object.keys(VENUES)) html += slotHtml(key, v, slot, onlyMine);
      html += `</div>`;
    }
  }
  grid.innerHTML = html;
  renderMobile();
}

// One lab tile (used by both the desktop grid and the phone view)
function slotHtml(key, v, slot, onlyMine) {
  const b = slot[v];
  if (b) {
    const who = instr(b.instructor) || { name: "Unknown", color: "#6b7280" };
    const mine = b.instructor === me;
    const dim = onlyMine && !mine ? "dim" : "";
    return `<button class="slot booked ${mine ? "mine" : ""} ${dim}" style="--c:${who.color}"
            data-key="${key}" data-venue="${v}" title="${VENUES[v]} · ${who.name} · ${esc(b.course)}">
            <span class="v">${VENUES[v]}</span>
            <span class="who-name">${who.name}</span>
            <span class="course">${esc(b.course)}</span></button>`;
  }
  return `<button class="slot free ${onlyMine ? "dim" : ""}" data-key="${key}" data-venue="${v}">
            <span class="v">${VENUES[v]}</span><span>+ Free</span></button>`;
}

/* ---------- Phone view: one day at a time ---------- */
let mDay = DAYS.some((d) => d[0] === SHORT_DAYS[new Date().getDay()]) ? SHORT_DAYS[new Date().getDay()] : "Mon";

function dayCount(d) {
  let n = 0;
  for (const h of HOURS) n += Object.keys(bookings[keyOf(d, h)] || {}).filter((v) => VENUES[v]).length;
  return n;
}

function renderMobile() {
  const box = $("#mobile");
  if (!box) return;
  const onlyMine = $("#onlyMine").checked && me;
  const now = new Date();
  const todayShort = SHORT_DAYS[now.getDay()];
  const total = HOURS.length * Object.keys(VENUES).length;
  const taken = dayCount(mDay);
  const pct = Math.round((taken / total) * 100);
  const prof = instr(me);

  let rows = "";
  for (const h of HOURS) {
    const key = keyOf(mDay, h), slot = bookings[key] || {};
    const isNow = mDay === todayShort && h === now.getHours();
    rows += `<div class="m-hour ${isNow ? "now" : ""}">
      <div class="m-time"><b>${pad(h)}</b><small>:00</small></div>
      <div class="m-tiles">${Object.keys(VENUES).map((v) => slotHtml(key, v, slot, onlyMine)).join("")}</div>
    </div>`;
  }

  const tabs = DAYS.map(([s]) =>
    `<button class="m-tab ${s === mDay ? "on" : ""} ${s === todayShort ? "today" : ""}" data-day="${s}">
      <span>${s}</span><em>${dayCount(s)}</em></button>`).join("");

  box.innerHTML = `
    <div class="m-hello"><span>Booking as</span>
      <b${prof ? ` style="--c:${prof.color}"` : ""}>${prof ? `<i class="dot" style="background:${prof.color}"></i>${esc(prof.name)}` : "Admin (view only)"}</b></div>
    <div class="m-day">
      <h2>${dayName(mDay)}${mDay === todayShort ? ' <small>Today</small>' : ""}</h2>
      <p>${taken} of ${total} lab slots taken</p>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>
    <div class="m-hours">${rows}</div>
    <nav class="m-nav" aria-label="Choose a day">${tabs}</nav>`;
}

function onMobileClick(e) {
  const tab = e.target.closest("[data-day]");
  if (tab) { mDay = tab.dataset.day; renderMobile(); window.scrollTo({ top: 0 }); return; }
  onSlotClick(e);
}

function parseKey(key) { const [day, hh] = key.split("_"); return { day, hour: Number(hh) }; }

function showClash(key, venue, clash) {
  const { day, hour } = parseKey(key);
  const when = `${dayName(day)}, ${timeLabel(hour)}`;
  if (clash.type === "venue") {
    const by = instr(clash.by.instructor);
    openDialog({
      title: "Slot already taken",
      body: `<div class="alert"><b>${VENUES[venue]}</b> on <b>${when}</b> has already been booked by
        <b>${by ? by.name : "another instructor"}</b> for “${esc(clash.by.course)}”.</div>
        <p>Please reach out to <b>${by ? by.name : "them"}</b> if you need this slot, or pick another time or lab.</p>`,
      actions: [closeBtn]
    });
  } else if (clash.type === "self") {
    openDialog({
      title: "You're already teaching then",
      body: `<div class="alert">You already have “${esc(clash.course)}” in <b>${VENUES[clash.venue]}</b> on <b>${when}</b>.
        You can't be in two labs at the same time.</div>`,
      actions: [closeBtn]
    });
  } else {
    openDialog({
      title: "Booking not allowed",
      body: `<div class="alert">This booking was refused. Refresh the page and check you're signed in as the right instructor.</div>`,
      actions: [closeBtn]
    });
  }
}

function openBooking(key, venue) {
  const { day, hour } = parseKey(key);
  const who = instr(me);
  openDialog({
    title: "Book this slot",
    body: `<p><b>${who.name}</b> · ${dayName(day)}, ${timeLabel(hour)}</p>
      <label for="course">Class / course name</label>
      <input type="text" id="course" maxlength="60" placeholder="e.g. Web Development 101" autocomplete="off" />
      <label>Venue</label>
      <div class="radios">
        ${Object.entries(VENUES).map(([k, n]) =>
          `<label><input type="radio" name="venue" value="${k}" ${k === venue ? "checked" : ""}/> ${n}</label>`).join("")}
      </div>`,
    actions: [
      { label: "Cancel" },
      {
        label: "Book it", kind: "primary",
        onClick: async () => {
          const course = $("#course").value.trim();
          const v = document.querySelector('input[name="venue"]:checked').value;
          if (!course) { $("#course").focus(); toast("Enter the class name first"); return true; }
          try {
            const res = await store.book(key, v, { instructor: me, course, ts: Date.now() });
            if (res.ok) { toast(`Booked ${VENUES[v]} ✔`); return false; }
            showClash(key, v, res.clash || { type: "denied" });
            return true;
          } catch (e) {
            console.error(e); toast("Network problem. Nothing was booked."); return true;
          }
        }
      }
    ]
  });
  setTimeout(() => $("#course") && $("#course").focus(), 50);
}

function onSlotClick(e) {
  const btn = e.target.closest(".slot"); if (!btn) return;
  const { key, venue } = btn.dataset;
  const b = (bookings[key] || {})[venue];
  const { day, hour } = parseKey(key);
  const when = `${dayName(day)}, ${timeLabel(hour)}`;

  if (!b) {
    if (!me) { toast("Your account isn't linked to an instructor profile yet"); return; }
    const clash = findClash(bookings[key], venue, me);
    if (clash && clash.type === "self") return showClash(key, venue, clash);
    return openBooking(key, venue);
  }
  if (b.instructor === me) {
    openDialog({
      title: "Your booking",
      body: `<p><b>${esc(b.course)}</b><br>${VENUES[venue]} · ${when}</p>`,
      actions: [
        closeBtn,
        { label: "Cancel booking", kind: "danger", onClick: async () => {
            const r = await store.cancel(key, venue);
            toast(r.ok ? "Booking cancelled" : "Couldn't cancel"); return false; } }
      ]
    });
  } else if (isAdmin) {
    const by = instr(b.instructor);
    openDialog({
      title: `Booked by ${by ? by.name : "another instructor"}`,
      body: `<p><b>${esc(b.course)}</b><br>${VENUES[venue]} · ${when}</p>
        <p>Contact ${by ? esc(by.name) : "them"} if you need this slot. As an admin you can also remove it.</p>`,
      actions: [
        closeBtn,
        { label: "Remove booking", kind: "danger", onClick: async () => {
            const r = await store.cancel(key, venue);
            toast(r.ok ? "Booking removed" : "Couldn't remove"); return false; } }
      ]
    });
  } else {
    showClash(key, venue, { type: "venue", by: b });
  }
}

function setStatus(s) {
  const el = $("#status");
  el.className = "status " + (s === "online" ? "online" : s === "offline" ? "offline" : "");
  el.title = { online: "Live and synced", offline: "Offline: reconnecting…", local: "Local demo mode" }[s] || "";
}

/* =====================================================================
   ADMIN: approve accounts, link them to instructor profiles
   ===================================================================== */
function instructorOptions(selectedId, linkedTo, ownUid) {
  return `<option value="">No instructor (admin only)</option>` +
    INSTRUCTORS.map((i) => {
      const other = linkedTo[i.id] && linkedTo[i.id] !== ownUid;
      return `<option value="${i.id}" ${i.id === selectedId ? "selected" : ""} ${other ? "disabled" : ""}>${i.name}${other ? " (already linked)" : ""}</option>`;
    }).join("");
}

function renderAdmin() {
  const box = $("#sec-admin");
  if (!box || !isAdmin) return;
  const { pending = {}, users = {}, admins = {} } = adminData;
  const linkedTo = {};
  Object.entries(users).forEach(([uid, u]) => { if (u.instructorId) linkedTo[u.instructorId] = uid; });
  const pend = Object.entries(pending).sort((a, b) => (a[1].requestedAt || 0) - (b[1].requestedAt || 0));
  const accts = Object.entries(users).sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));

  const profiles = INSTRUCTORS.map((i) => {
    const uid = linkedTo[i.id];
    return `<div class="pf" style="--c:${i.color}"><b>${i.name}</b>
      <small>${uid ? "Linked to " + esc(users[uid].name) : "Not linked yet"}</small></div>`;
  }).join("");

  const pendHtml = pend.length ? pend.map(([uid, p]) => {
    const d = adminDraft[uid] || {};
    return `<div class="pend" data-uid="${esc(uid)}">
      <div class="who2"><i class="av" style="--c:#6b7280">${esc(initialsOf(p.name))}</i>
        <div><b>${esc(p.name)}</b><small>${esc(p.email)} · ${ago(p.requestedAt || Date.now())}</small></div></div>
      <label class="sel"><span>Link to</span><select class="p-inst">${instructorOptions(d.inst, linkedTo, uid)}</select></label>
      <label class="chk"><input type="checkbox" class="p-admin" ${d.admin ? "checked" : ""}/> Make admin</label>
      <div class="row-actions"><button class="btn primary sm" data-act="approve">Approve</button><button class="btn sm" data-act="decline">Decline</button></div>
    </div>`;
  }).join("") : `<p class="empty">Nobody is waiting. New sign-ups will appear here.</p>`;

  const acctHtml = accts.length ? accts.map(([uid, u]) => {
    const self = user && uid === user.uid;
    return `<div class="acct-row" data-uid="${esc(uid)}">
      <div class="who2"><i class="av" style="--c:${(instr(u.instructorId) || { color: "#6b7280" }).color}">${esc(initialsOf(u.name))}</i>
        <div><b>${esc(u.name)}</b>${admins[uid] ? ` <span class="badge">Admin</span>` : ""}${self ? ` <span class="badge you">You</span>` : ""}
        <small>${esc(u.email)}</small></div></div>
      <label class="sel"><span>Instructor</span><select class="a-inst">${instructorOptions(u.instructorId, linkedTo, uid)}</select></label>
      <div class="row-actions">
        ${self ? "" : `<button class="btn sm" data-act="toggleAdmin">${admins[uid] ? "Remove admin" : "Make admin"}</button>
        <button class="btn sm danger-o" data-act="revoke">Remove access</button>`}
      </div>
    </div>`;
  }).join("") : `<p class="empty">No approved accounts yet.</p>`;

  box.innerHTML = `
    <h2>Admin</h2>
    <div class="a-card"><h3>Instructor profiles</h3><div class="profiles">${profiles}</div></div>
    <div class="a-card"><h3>Waiting for approval ${pend.length ? `<span class="count">${pend.length}</span>` : ""}</h3>${pendHtml}</div>
    <div class="a-card"><h3>Accounts</h3>${acctHtml}</div>`;
}

function confirmDialog(title, body, label, fn) {
  openDialog({ title, body, actions: [{ label: "Cancel" }, { label, kind: "danger", onClick: async () => { await fn(); return false; } }] });
}

async function onAdminClick(e) {
  const btn = e.target.closest("[data-act]"); if (!btn) return;
  const row = btn.closest("[data-uid]"), uid = row.dataset.uid, act = btn.dataset.act;
  try {
    if (act === "approve") {
      const inst = row.querySelector(".p-inst").value, mk = row.querySelector(".p-admin").checked;
      if (!inst && !mk) return toast("Choose an instructor, or tick Make admin");
      await store.approve(uid, { instructorId: inst || null, makeAdmin: mk });
      delete adminDraft[uid]; toast("Approved ✔");
    } else if (act === "decline") {
      await store.decline(uid); delete adminDraft[uid]; toast("Request declined");
    } else if (act === "toggleAdmin") {
      const on = !adminData.admins[uid];
      confirmDialog(on ? "Make admin?" : "Remove admin?",
        `<p>${on ? "They'll be able to approve accounts and see everything." : "They'll lose admin access."}</p>`,
        on ? "Make admin" : "Remove admin", () => store.setAdmin(uid, on));
    } else if (act === "revoke") {
      const u = adminData.users[uid] || {};
      confirmDialog("Remove access?",
        `<p><b>${esc(u.name)}</b> will no longer be able to use the timetable. Their existing bookings stay until cancelled.</p>`,
        "Remove access", () => store.revoke(uid));
    }
  } catch (err) { console.error(err); toast("That didn't work. Check your connection and permissions."); }
}

async function onAdminChange(e) {
  const row = e.target.closest("[data-uid]"); if (!row) return;
  const uid = row.dataset.uid;
  if (e.target.matches(".p-inst, .p-admin")) {
    adminDraft[uid] = { inst: row.querySelector(".p-inst").value, admin: row.querySelector(".p-admin").checked };
  } else if (e.target.matches(".a-inst")) {
    try { await store.setInstructor(uid, e.target.value); toast("Updated ✔"); }
    catch (err) { console.error(err); toast("Couldn't update"); renderAdmin(); }
  }
}

/* =====================================================================
   START
   ===================================================================== */
async function init() {
  setupHeader();
  $("#auth").addEventListener("click", onAuthClick);
  $("#auth").addEventListener("submit", (e) => { if (e.target.id === "authForm") onAuthSubmit(e); });
  $("#acct").addEventListener("click", openAccount);
  $("#sections").addEventListener("click", (e) => {
    const t = e.target.closest("[data-sec]"); if (!t) return;
    section = t.dataset.sec; renderChrome(); window.scrollTo({ top: 0 });
  });
  $("#grid").addEventListener("click", onSlotClick);
  $("#mobile").addEventListener("click", onMobileClick);
  $("#sec-admin").addEventListener("click", onAdminClick);
  $("#sec-admin").addEventListener("change", onAdminChange);

  store = await createStore();
  if (store.mode === "local") {
    const b = $("#banner");
    b.hidden = false;
    b.innerHTML = "<b>Local demo mode:</b> accounts and bookings are saved only in this browser, and the first account you create becomes the admin. Add your Firebase config in <code>config.js</code> to share the timetable (see README).";
  }
  store.onAuth(handleAuth);
}
init();
