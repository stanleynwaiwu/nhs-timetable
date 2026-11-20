/* Data layer: accounts, roles, bookings.
   Two interchangeable backends with the same methods:
   - Firebase (shared, real accounts)  - used when config.js is filled in
   - Local demo (this browser only)    - used otherwise, handy for trying things out */
import { FIREBASE_CONFIG } from "./config.js";
import { findClash } from "./constants.js";

const clean = (e) => String(e || "").trim().toLowerCase();
const authError = (code) => Object.assign(new Error(code), { code });
const isDenied = (e) => /permission/i.test(String((e && (e.code || e.message)) || ""));

/* ===================== LOCAL DEMO BACKEND ===================== */
function makeLocalStore() {
  const DBK = "nhs_demo_db_v2", AUTHK = "nhs_demo_auth_v2";
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const db = () => { const d = read(DBK); for (const k of ["users", "admins", "pending", "bookings"]) d[k] = d[k] || {}; return d; };
  const auth = () => { const a = read(AUTHK); a.accounts = a.accounts || {}; return a; };
  const listeners = new Set();
  const notify = () => listeners.forEach((f) => f());
  window.addEventListener("storage", (e) => { if (e.key === DBK || e.key === AUTHK) notify(); });
  const listen = (fn) => { listeners.add(fn); fn(); return () => listeners.delete(fn); };

  const current = () => {
    const a = auth();
    const acc = Object.values(a.accounts).find((x) => x.uid === a.session);
    if (!acc) return null;
    const d = db(), rec = d.users[acc.uid];
    return {
      uid: acc.uid, email: acc.email, name: acc.name,
      isAdmin: !!d.admins[acc.uid], instructorId: (rec && rec.instructorId) || null,
      approved: !!rec || !!d.admins[acc.uid]
    };
  };
  const needAdmin = () => { const m = current(); if (!m || !m.isAdmin) throw authError("permission-denied"); };

  return {
    mode: "local",

    onAuth(cb) {
      let last = "";
      return listen(() => {
        const m = current();
        let s = { status: "out" };
        if (m) {
          const user = { uid: m.uid, email: m.email, name: m.name };
          s = m.approved
            ? { status: "ready", user, profile: { instructorId: m.instructorId, isAdmin: m.isAdmin } }
            : { status: "pending", user };
        }
        const sig = JSON.stringify(s);
        if (sig !== last) { last = sig; cb(s); }
      });
    },
    async signUp(name, email, pw) {
      email = clean(email);
      const a = auth();
      if (a.accounts[email]) throw authError("auth/email-already-in-use");
      if (pw.length < 6) throw authError("auth/weak-password");
      const uid = "u" + Math.random().toString(36).slice(2, 10);
      a.accounts[email] = { uid, email, name, pw }; a.session = uid; write(AUTHK, a);
      const d = db();
      d.pending[uid] = { name, email, requestedAt: Date.now() };
      // Demo only: the very first account becomes admin so you can try everything.
      if (!Object.keys(d.admins).length && !Object.keys(d.users).length) d.admins[uid] = true;
      write(DBK, d); notify();
    },
    async signIn(email, pw) {
      const a = auth(), acc = a.accounts[clean(email)];
      if (!acc || acc.pw !== pw) throw authError("auth/invalid-credential");
      a.session = acc.uid; write(AUTHK, a); notify();
    },
    async signOut() { const a = auth(); a.session = null; write(AUTHK, a); notify(); },
    async resetPassword() {},

    subscribeBookings(cb, onStatus) { onStatus("local"); return listen(() => cb(db().bookings)); },
    async book(key, venue, payload) {
      const m = current(), d = db();
      if (!m || !(m.isAdmin || (m.instructorId && m.instructorId === payload.instructor)))
        return { ok: false, clash: { type: "denied" } };
      const slot = d.bookings[key] || {};
      const clash = findClash(slot, venue, payload.instructor);
      if (clash) return { ok: false, clash };
      slot[venue] = payload; d.bookings[key] = slot; write(DBK, d); notify();
      return { ok: true };
    },
    async cancel(key, venue) {
      const m = current(), d = db(), slot = d.bookings[key];
      if (!m || !slot || !slot[venue]) return { ok: false };
      if (!(m.isAdmin || slot[venue].instructor === m.instructorId)) return { ok: false };
      delete slot[venue];
      if (!Object.keys(slot).length) delete d.bookings[key];
      write(DBK, d); notify();
      return { ok: true };
    },

    subscribeAdmin(cb) { return listen(() => { const d = db(); cb({ pending: d.pending, users: d.users, admins: d.admins }); }); },
    async approve(uid, { instructorId, makeAdmin }) {
      needAdmin(); const d = db(), p = d.pending[uid]; if (!p) return;
      const rec = { name: p.name, email: p.email, approvedAt: Date.now() };
      if (instructorId) rec.instructorId = instructorId;
      d.users[uid] = rec; if (makeAdmin) d.admins[uid] = true; delete d.pending[uid];
      write(DBK, d); notify();
    },
    async decline(uid) { needAdmin(); const d = db(); delete d.pending[uid]; write(DBK, d); notify(); },
    async setAdmin(uid, on) { needAdmin(); const d = db(); if (on) d.admins[uid] = true; else delete d.admins[uid]; write(DBK, d); notify(); },
    async setInstructor(uid, id) {
      needAdmin(); const d = db(); if (!d.users[uid]) return;
      if (id) d.users[uid].instructorId = id; else delete d.users[uid].instructorId;
      write(DBK, d); notify();
    },
    async revoke(uid) { needAdmin(); const d = db(); delete d.users[uid]; delete d.admins[uid]; write(DBK, d); notify(); }
  };
}

/* ===================== FIREBASE BACKEND ===================== */
async function makeFirebaseStore() {
  const base = "https://www.gstatic.com/firebasejs/10.12.2";
  const [{ initializeApp }, A, D] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-database.js`)
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  const db = D.getDatabase(app);
  const { ref, onValue, runTransaction, set, update, get } = D;

  let profile = { instructorId: null, isAdmin: false };   // who is signed in right now
  let cache = {};                                          // latest bookings
  let signupName = "";

  return {
    mode: "firebase",

    onAuth(cb) {
      let stopWatch = () => {}, last = "";
      const emit = (s) => { const sig = JSON.stringify(s); if (sig !== last) { last = sig; cb(s); } };
      const stopAuth = A.onAuthStateChanged(auth, (u) => {
        stopWatch();
        profile = { instructorId: null, isAdmin: false };
        if (!u) { emit({ status: "out" }); return; }
        const user = { uid: u.uid, email: u.email, name: u.displayName || signupName || u.email };
        let isAdmin = null, rec;                 // null / undefined = not loaded yet
        let asked = false;
        const settle = () => {
          if (isAdmin === null || rec === undefined) return;
          profile = { instructorId: (rec && rec.instructorId) || null, isAdmin };
          if (rec || isAdmin) return emit({ status: "ready", user, profile });
          if (!asked) {                          // first time here: ask the admin to approve us
            asked = true;
            set(ref(db, `pending/${u.uid}`), { name: user.name, email: user.email, requestedAt: Date.now() })
              .catch((e) => { console.error(e); emit({ status: "pending", user, warning: "Couldn't send your request to the admin. Check your connection, then sign out and in again." }); });
          }
          emit({ status: "pending", user });
        };
        const a = onValue(ref(db, `admins/${u.uid}`), (s) => { isAdmin = s.val() === true; settle(); }, () => { isAdmin = false; settle(); });
        const b = onValue(ref(db, `users/${u.uid}`), (s) => { rec = s.val(); settle(); }, () => { rec = null; settle(); });
        stopWatch = () => { a(); b(); };
      });
      return () => { stopAuth(); stopWatch(); };
    },
    async signIn(email, pw) { await A.signInWithEmailAndPassword(auth, clean(email), pw); },
    async signUp(name, email, pw) {
      signupName = name;
      const c = await A.createUserWithEmailAndPassword(auth, clean(email), pw);
      try { await A.updateProfile(c.user, { displayName: name }); } catch (e) { console.error(e); }
    },
    async signOut() { await A.signOut(auth); },
    async resetPassword(email) { await A.sendPasswordResetEmail(auth, clean(email)); },

    subscribeBookings(cb, onStatus) {
      const a = onValue(ref(db, "bookings"),
        (s) => { cache = s.val() || {}; cb(cache); },
        (e) => { console.error(e); onStatus("offline"); cb({}); });
      const b = onValue(ref(db, ".info/connected"), (s) => onStatus(s.val() ? "online" : "offline"));
      return () => { a(); b(); };
    },
    // Each lab-hour is its own tiny record. The transaction only succeeds if it was empty,
    // and the database rules double-check on the server, so two simultaneous clicks can't both win.
    async book(key, venue, payload) {
      const pre = findClash(cache[key], venue, payload.instructor);
      if (pre) return { ok: false, clash: pre };
      let clash = null;
      try {
        const res = await runTransaction(ref(db, `bookings/${key}/${venue}`), (cur) => {
          if (cur) { clash = { type: "venue", by: cur }; return; }
          return payload;
        });
        if (res.committed) return { ok: true };
        return { ok: false, clash: clash || findClash(cache[key], venue, payload.instructor) || { type: "denied" } };
      } catch (e) {
        if (isDenied(e)) return { ok: false, clash: findClash(cache[key], venue, payload.instructor) || { type: "denied" } };
        throw e;
      }
    },
    async cancel(key, venue) {
      const allowed = (c) => c && (profile.isAdmin || c.instructor === profile.instructorId);
      try {
        const res = await runTransaction(ref(db, `bookings/${key}/${venue}`), (c) => (allowed(c) ? null : undefined));
        return { ok: res.committed };
      } catch (e) { console.error(e); return { ok: false }; }
    },

    subscribeAdmin(cb) {
      const st = { pending: {}, users: {}, admins: {} };
      const stops = Object.keys(st).map((k) =>
        onValue(ref(db, k), (s) => { st[k] = s.val() || {}; cb({ ...st }); }, (e) => console.error(k, e)));
      return () => stops.forEach((f) => f());
    },
    async approve(uid, { instructorId, makeAdmin }) {
      const p = (await get(ref(db, `pending/${uid}`))).val();
      if (!p) return;
      const rec = { name: p.name, email: p.email, approvedAt: Date.now() };
      if (instructorId) rec.instructorId = instructorId;
      const changes = { [`users/${uid}`]: rec, [`pending/${uid}`]: null };
      if (makeAdmin) changes[`admins/${uid}`] = true;
      await update(ref(db), changes);
    },
    async decline(uid) { await set(ref(db, `pending/${uid}`), null); },
    async setAdmin(uid, on) { await set(ref(db, `admins/${uid}`), on ? true : null); },
    async setInstructor(uid, id) { await set(ref(db, `users/${uid}/instructorId`), id || null); },
    async revoke(uid) { await update(ref(db), { [`users/${uid}`]: null, [`admins/${uid}`]: null }); }
  };
}

export async function createStore() {
  const c = FIREBASE_CONFIG || {};
  const configured = c.apiKey && c.databaseURL && !String(c.apiKey).startsWith("PASTE");
  if (configured) {
    try { return await makeFirebaseStore(); }
    catch (e) { console.error("Firebase failed, using local demo mode:", e); }
  }
  return makeLocalStore();
}
