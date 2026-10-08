# Full E2E checklist: iPhone = CLIENT, MacBook = BUSINESS (Labrity)

Dev server on the LAN (`npm run dev`), ServiceOS Dev database. Use a NEW test client e-mail
(for example `e2e-client-1@example.com`) so the client record is easy to find.
Nothing here deletes data; cancel/mark instead.

## A. Client books (iPhone, no login)
1. Open `/book/labrity`. The business name, description and contact lines show; phone and e-mail are tappable.
2. Pick a service. The description is shown under it. Pick a person (or any).
3. The date strip starts on today's date in Berlin. If your phone is set to another time zone, a note says times are in Berlin time.
4. Pick a free slot, enter name, e-mail, phone, a note, confirm. A confirmation screen appears.
5. Immediately open `/book/labrity` again, same service/day: the booked slot is no longer offered.
6. Try booking the same e-mail again for another slot: it works and reuses the same client (see D2).

## B. Business sees it (MacBook, owner login)
1. Today: the new booking appears under today / needs attention (status pending unless auto-confirm). Date shown = Berlin today.
2. Calendar: it opens on the same date as Today; the booking sits on the right day and time (no one-hour or one-day shift).
3. Open the booking: client, service, person, the guest's note.
4. Confirm it (status change). Reload: the status stays.

## C. Manage the appointment (MacBook)
1. Move it to another free time: it saves, no red error. Move it onto an occupied slot of the same person: a clear message (no overlay), nothing changes.
2. Change service / person / notes / duration; each saves and survives a reload.
3. Create a second appointment by hand (central + > appointment) for an existing client; check the same day in Calendar.
4. Mark one completed, cancel one. Cancelled slots become bookable again on `/book/labrity` (iPhone).
5. Visibility and Financial Account stay two separate settings: set one appointment to Private and check its look in Calendar (lock) without changing its financial account.

## D. ClientRecord (MacBook)
1. Clients: the guest from A appears with the "new" tag.
2. Open it: upcoming and history list the bookings. Edit name, phone, notes, VIP: Saved check mark, then reload.
3. Edit the e-mail to another existing client's e-mail: a friendly "already exists" message, no overlay.
4. Add a client with an e-mail that already exists: same friendly message.

## E. Settings round trip
1. Business profile: change the description, save (green check), reload `/book/labrity` on the iPhone: the new text shows. Name changes show in the header and switcher; the link stays `/book/labrity`.
2. Turn "Accept online bookings" off: iPhone `/book/labrity` shows 404 and the catalog switch turns off. Turn it on again.
3. Listing: switch "List in the ServiceOS directory" on: Labrity appears at `/client/book` (iPhone); switch it off again. Demo businesses must never appear there.
4. Services: add a service with a description and a person; it shows on the booking page. Archive it: it disappears from booking; old appointments keep the name. Restore.

## F. Boundaries (where implemented)
1. Logged out, open `/labrity/today`: redirected to login. Another logged-in owner (second signup, optional) gets 404 on `/labrity/...` and sees no Labrity data.
2. `/demo-salon/today` works without login and shows demo data only; Labrity never shows demo data.
3. Bottom navigation (iPhone as business, optional): More stays highlighted in Clients/Finance/Settings; the plus opens the three create sheets.

## Not implemented yet: NOT a failure in this E2E
- Real Client Account, "My Bookings", cancel/reschedule by the guest (still local/demo storage; no manage-token).
- E-mail/SMS/push confirmations and reminders (no notifications).
- Staff, Resources, Working hours EDIT screens (hours come from onboarding), inviting staff / roles UI (roles are covered by automated RLS tests only).
- User Profile, change/forgot/reset password, e-mail confirmation callback; Confirm email in Dev.
- Logo upload (only the initial is shown).
- Finance, Work, Waiting list, Inbox, Analytics, Assistant still use browser-local demo-style data, not the shared database.
- Google Calendar sync, payments, Danger Zone (archive/delete workspace).
