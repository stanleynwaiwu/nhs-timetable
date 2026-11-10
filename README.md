# NHS Labs · Instructor Timetable

A live, shared timetable that stops instructors clashing in the two labs (Old NHS Lab / New NHS Lab), Monday to Friday, one-hour lessons.

**Rules it enforces**
1. One lab, one hour = one instructor. A second instructor trying to take it is told who has it and to contact them.
2. An instructor can't be booked in both labs in the same hour.
3. Only the person who made a booking can cancel it (in the app).

The check runs as an atomic Firebase transaction, so even simultaneous clicks can't both succeed.

## Why Firebase?
GitHub Pages only hosts static files. To let all three instructors see the same data, bookings must live in a shared database. Firebase Realtime Database's free tier is plenty for this.

## Setup (about 5 minutes)

### Step 1: Create the database
1. Go to <https://console.firebase.google.com> → **Add project** (any name, skip Analytics).
2. **Build → Realtime Database → Create Database** (pick any region, start in *locked mode*).
3. **Project settings (gear) → General → Your apps → Web (`</>`)**, register an app, and copy the `firebaseConfig` values.
4. Paste them into `config.js`. Make sure `databaseURL` is included (it's shown in the Realtime Database page).

### Step 2: Set the database rules
In **Realtime Database → Rules**, paste and **Publish**:

```json
{
  "rules": {
    "bookings": {
      ".read": true,
      "$slot": {
        "$venue": {
          ".write": true,
          ".validate": "$venue === 'old' || $venue === 'new'"
        }
      }
    }
  }
}
```

(Anyone with the link can edit, which is fine for a small trusted team. There is no login, so "who you are" is just the dropdown.)

### Step 3: Deploy on GitHub Pages
1. Create a GitHub repo and upload `index.html`, `style.css`, `config.js`, `app.js`.
2. **Settings → Pages → Deploy from branch → `main` / root**.
3. Share the link `https://<your-username>.github.io/<repo>/` with Miss Inem and Mr Femi.

## Customising
At the top of `app.js`: `DAYS`, `HOURS`, `VENUES`, `INSTRUCTORS` (names and colours).

## Local demo mode
Until `config.js` is filled in, the app saves to your own browser only (other tabs in the same browser sync). Good for trying it out.
