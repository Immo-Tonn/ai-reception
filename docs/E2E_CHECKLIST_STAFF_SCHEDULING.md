# E2E: staff / resources / hours / time off / booking rules (iPhone = client, MacBook = Labrity owner)

Use only Labrity test data; nothing here deletes data (deactivate/cancel instead). Berlin time is the business time.

## A. MacBook: set up the model (Settings)
1. **Booking** (`/labrity/settings/booking`): auto-confirm OFF, minimum notice 2 hours, horizon 30 days, slot interval 15 min. Save: green "Saved". Reload: values stay.
2. **Hours** (`/labrity/settings/hours`): Mon-Fri 09:00-13:00 + 14:00-18:00, Sat 10:00-14:00, Sun closed. Add a business closure for one future weekday (a "closed day").
3. **Staff** (`/labrity/settings/staff`): add "Anna" (title Master), services: Haircut only; schedule *custom* Mon-Wed 09:00-16:00. Add a second person "Maria" (inherit, service Manicure). Add 1 time off for Maria (full day, a future day) and a partial time off for Anna (12:00-13:30).
4. **Resources**: add "Room 1" (room) and link it to Manicure; check that Manicure now needs a room and that the resource type is locked while linked.

## B. iPhone (client, `/book/labrity`)
1. Choose Haircut: only Anna (and "any specialist") is offered, never Maria. Manicure: only Maria.
2. The date strip greys out: Sunday, the closed business day, Maria's time-off day (for Manicure), today if less than 2 hours remain, anything beyond 30 days.
3. Pick Anna on a Wednesday: last start for a 50-min service is 15:00 (grid 15 min, ends 16:00); no start inside 12:00-13:30 or 13:00-14:00 gap spanning; no start after 16:00. Thursday: Anna not available, "any specialist" shows no Haircut slots.
4. Book a slot. Status on the business side must be **pending** (auto-confirm OFF).
5. Try the same slot from a second tab/another phone after the first booked it: it is gone / a clear "no longer available" message.

## C. MacBook: auto-confirm + conflicts
1. Turn auto-confirm ON; book another Haircut from the iPhone: status **confirmed** at once. Turn it OFF again.
2. Two clients, one resource: book Manicure at 10:00 on the iPhone; from a second device book Manicure at 10:00 with the same room: second is refused (room busy).
3. Calendar: both bookings on the right Berlin day and time; the business can still create an appointment by hand; creating one inside Anna's time off or the closure is blocked/warned.
4. Deactivate Maria: she disappears from public booking and from new-appointment pickers; her old appointment still shows her name.
5. Deactivate and reactivate "Room 1": same for the resource.

## D. Client account + rules
1. iPhone: sign in as the client (claim the booking from B4). Cancel inside the deadline works; set cancellation deadline to 24 h on the MacBook, then cancel a booking that starts in less than 24 h: refused with a clear message. Same for reschedule.
2. Reschedule to a free slot works; onto Anna's time off / outside hours it is not offered.

## E. Demo + boundaries
1. `/demo-salon/settings/staff|resources|hours|booking`: read-only with the demo note, no Save buttons. `/demo-salon` booking still works.
2. Logged-in as a second owner (optional): `/labrity/settings/staff` is 404.

## Not part of this E2E (not implemented / known)
Staff invitations and roles UI, per-resource capacity, recurring time off, staff-specific buffers, e-mail/push notifications, warning when deactivating staff with future appointments, logo upload, Finance/Work/Inbox on the shared backend, production Auth flows (Confirm email, callback, forgot/reset password, SMTP), DST-gap hours 02:00-02:59 on 2026-03-29, private time-off reason is readable by any workspace member via direct query.
