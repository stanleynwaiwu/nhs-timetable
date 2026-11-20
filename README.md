# NHS Labs · Instructor Timetable

A live, shared timetable that stops instructors clashing in the two labs (Old NHS Lab / New NHS Lab), Monday to Friday, one-hour lessons.

## What it does
- **Accounts:** instructors sign in with email and password. An **admin** approves each new account and links it to an instructor profile (Mr Stanley, Miss Inem, Mr Femi).
- **Clash prevention:** one lab, one hour = one instructor. Someone else trying it is told who has it. An instructor can't be in both labs in the same hour. These rules are enforced **on the server** (see `database.rules.json`), not just in the page.
- **Ownership:** you can only book and cancel as yourself. Admins can also remove any booking.
- **Admin section:** approve or decline sign-ups, link accounts to instructor profiles, make or remove admins, remove access.
- **Phone view:** one day at a time with a floating Mon-Fri bar (screens 900px wide or less). The desktop grid is unchanged.

## Files
`index.html` · `style.css` · `app.js` (screens) · `store.js` (accounts and database) · `constants.js` (days, hours, labs, instructors, clash rule) · `config.js` (your Firebase keys) · `database.rules.json` (security rules)

## Setup (Firebase)
1. **Authentication:** Firebase console → Build → Authentication → Get started → Sign-in method → **Email/Password** → Enable.
2. **Rules:** Realtime Database → Rules → paste the contents of `database.rules.json` → Publish.
3. **First admin:** sign up on the site, then Authentication → Users → copy your **User UID**. In Realtime Database → Data, add the child `admins` → `<your UID>` with the value `true`. Reload the site: you now see the Admin tab. Approve yourself (link to Mr Stanley).
4. **Everyone else:** they create an account, wait on the "Almost there" screen, and you approve them in Admin.
5. **Deploy:** upload to GitHub, and run `firebase deploy --only hosting` for the Firebase link. Both links share one database.

## Customising
`constants.js`: `DAYS`, `HOURS`, `VENUES`, `INSTRUCTORS` (names and colours).

## Local demo mode
Until `config.js` has real Firebase values, the app runs in your browser only (the first account you create becomes the admin). Good for trying things out.
