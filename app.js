import { FIREBASE_CONFIG } from "./config.js";

/* ---------- Settings: edit these to change the timetable ---------- */
const DAYS = [["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"], ["Fri", "Friday"]];
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];          // each = a 1-hour lesson (8:00 to 18:00)
const VENUES = { old: "Old NHS Lab", new: "New NHS Lab" };
const INSTRUCTORS = [
  { id: "stanley", name: "Mr Stanley", color: "#2563eb" },
  { id: "inem",    name: "Miss Inem",  color: "#db2777" },
  { id: "femi",    name: "Mr Femi",    color: "#059669" }
];
/* ------------------------------------------------------------------ */

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (day, hour) => `${day}_${pad(hour)}`;
const instr = (id) => INSTRUCTORS.find((i) => i.id === id);
const timeLabel = (h) => `${pad(h)}:00–${pad(h + 1)}:00`;
const dayName = (short) => DAYS.find((d) => d[0] === short)[1];

/* ---------- The clash rules (used by both backends) ---------- */
// slot = { old: {...}|undefined, new: {...}|undefined }  for ONE day+hour
function findClash(slot, venue, instructorId) {
  slot = slot || {};
  if (slot[venue]) return { type: "venue", by: slot[venue] };
  for (const v of Object.keys(VENUES)) {
    if (v !== venue && slot[v] && slot[v].instructor === instructorId)
      return { type: "self", venue: v, course: slot[v].course };
  }
  return null;
}

/* ---------- Backends ---------- */
function makeLocalBackend() {
  const LS = "nhs_timetable_demo";
  const read = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
  const write = (d) => localStorage.setItem(LS, JSON.stringify(d));
  let cb = () => {};
  window.addEventListener("storage", (e) => { if (e.key === LS) cb(read()); });
  return {
    mode: "local",
    subscribe(onData, onStatus) { cb = onData; onData(read()); onStatus("local"); },
    async book(key, venue, payload) {
      const data = read();
      const slot = data[key] || {};
      const clash = findClash(slot, venue, payload.instructor);
      if (clash) return { ok: false, clash };
      slot[venue] = payload; data[key] = slot; write(data); cb(data);
      return { ok: true };
    },
    async cancel(key, venue, instructorId) {
      const data = read();
      const slot = data[key];
      if (!slot || !slot[venue] || slot[venue].instructor !== instructorId) return { ok: false };
      delete slot[venue];
      if (!Object.keys(slot).length) delete data[key];
      write(data); cb(data);
      return { ok: true };
    }
  };
}

async function makeFirebaseBackend() {
  const V = "10.12.2";
  const [{ initializeApp }, { getDatabase, ref, onValue, runTransaction }] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`)
  ]);
  const db = getDatabase(initializeApp(FIREBASE_CONFIG));
  return {
    mode: "firebase",
    subscribe(onData, onStatus) {
      onValue(ref(db, "bookings"), (snap) => onData(snap.val() || {}));
      onValue(ref(db, ".info/connected"), (snap) => onStatus(snap.val() ? "online" : "offline"));
    },
    // One atomic transaction per day+hour. If two people click at the same moment,
    // Firebase runs them one after the other, so only the first can win.
    async book(key, venue, payload) {
      let clash = null;
      const res = await runTransaction(ref(db, `bookings/${key}`), (cur) => {
        clash = findClash(cur, venue, payload.instructor);
        if (clash) return;                       // abort: nothing is written
        const next = cur || {};
        next[venue] = payload;
        return next;
      });
      return res.committed ? { ok: true } : { ok: false, clash };
    },
    async cancel(key, venue, instructorId) {
      const res = await runTransaction(ref(db, `bookings/${key}`), (cur) => {
        if (!cur || !cur[venue] || cur[venue].instructor !== instructorId) return;
        delete cur[venue];
        return Object.keys(cur).length ? cur : null;
      });
      return { ok: res.committed };
    }
  };
}

async function createBackend() {
  const c = FIREBASE_CONFIG || {};
  const configured = c.apiKey && c.databaseURL && !c.apiKey.startsWith("PASTE");
  if (configured) {
    try { return await makeFirebaseBackend(); }
    catch (e) { console.error("Firebase failed, using local demo mode:", e); }
  }
  return makeLocalBackend();
}

/* ---------- UI ---------- */
let backend, bookings = {}, me = localStorage.getItem("nhs_me") || "";

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

function setupHeader() {
  const sel = $("#who");
  sel.innerHTML = `<option value="">Select your name…</option>` +
    INSTRUCTORS.map((i) => `<option value="${i.id}">${i.name}</option>`).join("");
  sel.value = me;
  sel.onchange = () => { me = sel.value; localStorage.setItem("nhs_me", me); render(); };
  $("#onlyMine").onchange = render;
  $("#legend").innerHTML = INSTRUCTORS.map((i) =>
    `<span><i class="dot" style="background:${i.color}"></i>${i.name}</span>`).join("") +
    `<span>· Two labs per hour: ${Object.values(VENUES).join(" / ")}</span>`;
}

function render() {
  const grid = $("#grid");
  const todayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
  const onlyMine = $("#onlyMine").checked && me;
  let html = `<div class="hd">Time</div>` +
    DAYS.map(([s, l]) => `<div class="hd ${s === todayShort ? "today" : ""}">${l}</div>`).join("");

  for (const h of HOURS) {
    html += `<div class="time">${timeLabel(h)}</div>`;
    for (const [d] of DAYS) {
      const key = keyOf(d, h), slot = bookings[key] || {};
      html += `<div class="cell ${d === todayShort ? "today" : ""}">`;
      for (const v of Object.keys(VENUES)) {
        const b = slot[v];
        if (b) {
          const who = instr(b.instructor) || { name: "Unknown", color: "#6b7280" };
          const mine = b.instructor === me;
          const dim = onlyMine && !mine ? "dim" : "";
          html += `<button class="slot booked ${mine ? "mine" : ""} ${dim}" style="--c:${who.color}"
            data-key="${key}" data-venue="${v}" title="${VENUES[v]} · ${who.name} · ${esc(b.course)}">
            <span class="v">${VENUES[v]}</span>
            <span class="who-name">${who.name}</span>
            <span class="course">${esc(b.course)}</span></button>`;
        } else {
          html += `<button class="slot free ${onlyMine ? "dim" : ""}" data-key="${key}" data-venue="${v}">
            <span class="v">${VENUES[v]}</span><span>+ Free</span></button>`;
        }
      }
      html += `</div>`;
    }
  }
  grid.innerHTML = html;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
  } else {
    openDialog({
      title: "You're already teaching then",
      body: `<div class="alert">You already have “${esc(clash.course)}” in <b>${VENUES[clash.venue]}</b> on <b>${when}</b>.
        You can't be in two labs at the same time.</div>`,
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
            const res = await backend.book(key, v, { instructor: me, course, ts: Date.now() });
            if (res.ok) { toast(`Booked ${VENUES[v]} ✔`); return false; }
            showClash(key, v, res.clash || { type: "venue", by: { instructor: "", course: "" } });
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

  if (!me) { toast("Select your name at the top first"); $("#who").focus(); return; }

  if (!b) {
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
            const r = await backend.cancel(key, venue, me);
            toast(r.ok ? "Booking cancelled" : "Couldn't cancel"); return false; } }
      ]
    });
  } else {
    showClash(key, venue, { type: "venue", by: b });
  }
}

function setStatus(s) {
  const el = $("#status");
  el.className = "status " + (s === "online" ? "online" : s === "offline" ? "offline" : "");
  el.title = { online: "Live and synced", offline: "Offline: reconnecting…", local: "Local demo mode" }[s];
}

async function init() {
  setupHeader();
  render();
  $("#grid").addEventListener("click", onSlotClick);
  backend = await createBackend();
  if (backend.mode === "local") {
    const b = $("#banner");
    b.hidden = false;
    b.innerHTML = "<b>Local demo mode:</b> bookings are saved only in this browser. Add your Firebase config in <code>config.js</code> so every instructor shares the same live timetable (see README).";
  }
  backend.subscribe((data) => { bookings = data; render(); }, setStatus);
}
init();
