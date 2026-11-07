# Legal TODO (production blockers)

Status: `/impressum` and `/datenschutz` exist (public, indexable) but are NOT release-ready.
Release check: `npm run check:legal` exits 1 while any item below is open (normal `vitest run` stays green).
Flags: `src/content/legal/datenschutz.ts` -> `datenschutzApproved`, `src/content/legal/impressum.ts` -> `impressumApproved`.
All of this Needs legal review (not a substitute for a lawyer).

## Datenschutzerklaerung
- [ ] Write the full text (controller, data and purposes, legal bases, recipients/processors e.g. hosting, Supabase, e-mail provider, retention, rights, supervisory authority complaint). Only a heading skeleton + loud draft banner exists.
- [ ] Set `datenschutzLastUpdated` and `datenschutzApproved = true` after approval.

### Google Calendar section (`src/content/legal/googleCalendarPrivacy.ts`, DE/EN/UK/RU, updated 2026-10-13)
Text describes the implementation (docs/EXTERNAL_CALENDAR.md, docs/DATA_RETENTION.md, docs/BACKUP_RECOVERY.md).
NOT approved; `googleCalendarIntegrationLive = false` (page says the feature is not enabled in production yet).

**Questions for the lawyer (Needs legal review):**
- [ ] Legal basis for processing staff calendar busy time (consent / § 26 BDSG / legitimate interest) and voluntariness in employment
- [ ] Roles: controller (business as employer and/or ServiceOS operator), joint controllership (Art. 26) or processing (Art. 28); which contracts are needed with businesses
- [ ] Processors and locations: Supabase (eu-central-1 Frankfurt), Vercel (functions currently appear to run in **iad1, USA** per `x-vercel-id`) — third-country transfer, DPAs, or move functions to `fra1`
- [ ] Google: role and possible third-country transfer during OAuth / API calls (Google Ireland / Google LLC)
- [ ] Is the pseudonymised account id (HMAC of Google `sub`) still personal data — wording OK?
- [ ] Provisional retention: busy cache 24 h, connect-link records 30 days after use/expiry, "access withdrawn" status kept until disconnect (no auto-delete, booking safety)
- [ ] Backups: none automatic on the current plan; manual encrypted backups — retention period and how deletion requests are handled for data in backups
- [ ] Art. 13 information to staff before connecting (connect page text sufficient?), record of processing activities, need for a DPIA
- [ ] Google API Services User Data Policy / Limited Use statement wording (required for Google OAuth verification)

## Impressum (all fields are `TODO` in `src/content/legal/impressum.ts`)
- [ ] Provider name / company; owner / authorised representative
- [ ] Street, postal code + city, country
- [ ] E-mail, phone
- [ ] Person responsible for content (§ 18 Abs. 2 MStV) + address
- [ ] If applicable: legal form, commercial register + number, VAT ID, supervisory authority
- [ ] Decide who the legal operator of ServiceOS is (the only Impressum found on this machine, Desktop/Labrity, is "Labrity, Inhaber Andreas Tonn, Muenster"; it appears to be another site and was NOT copied). Confirm before reusing any of it.
- [ ] Verify the statutory basis wording (DDG / MStV) with a lawyer.

## Other
- [ ] Cookie / consent review (language + theme + claim cookies, localStorage demo data, service worker; third-party requests e.g. Google Fonts via next/font is self-hosted but confirm).
- [ ] German law check of the whole public surface (Impressum reachable in two clicks, footer on all public pages) - Needs legal review.
- [ ] Footer credit "Entwickelt von Labrity Web Studio" confirmed by the operator.

## GDPR client data (stages 1–6) — questions for the lawyer (Needs legal review)
Implementation: [GDPR_IMPLEMENTATION_PLAN.md](GDPR_IMPLEMENTATION_PLAN.md), [DATA_RETENTION.md](DATA_RETENTION.md) §6. All periods are provisional.
- [ ] Client data period: 36 months after the last completed visit as the recommendation; allowed range 12–120 months per business; the counting event; clients without any completed visit
- [ ] Inbox notifications 12 months; unclaimed booking links deleted 30 days after expiry
- [ ] Category C: keeping the client name on invoices after anonymisation (§ 147 AO / § 257 HGB periods and what must stay on the document)
- [ ] Art. 15: wording of purposes, legal bases, recipients, retention, source, rights in the export; whether a JSON file is an acceptable form; one-month deadline handling and extensions
- [ ] Disclosure of internal notes (assessments, third-party data) in an access request
- [ ] Identity verification procedure before answering a request ("identity verified" is only a staff confirmation)
- [ ] Roles: business = controller for its client data, LiveTermin operator = processor (AVV/DPA with each business?); client accounts = operator's own data
- [ ] Health data (Art. 9): the app warns under notes; is a warning enough, or must free-text notes be restricted?
- [ ] Erasure in backups: how long backups may keep anonymised data, and the re-apply procedure (BACKUP_RECOVERY.md §7)
- [ ] Need for a DPIA and the record of processing activities

### Services, regions and contracts — confirmed vs to verify
| Item | Status | Source |
|---|---|---|
| Supabase project region eu-central-1 (Frankfurt) | **confirmed** | Supabase project settings, BACKUP_RECOVERY.md (2026-10-13) |
| Vercel functions region | **observed `iad1` (USA)** — move to `fra1` pending, to verify | `x-vercel-id` response header, checked 2026-10-24; team lead TODO |
| Vercel and Supabase plans (Hobby / Free?) | **to verify** | team lead |
| AVV / DPA with Supabase and Vercel signed / accepted | **to verify** | not on file |
| Vercel log retention | **to verify** | plan dependent |
| E-mail provider (other developer) and its region / DPA | **to verify** | not on file |
| International transfer (Vercel US functions, possibly Google) and transfer basis (DPF / SCC) | **to verify** | depends on the items above |
| Google Calendar integration | not live (`googleCalendarIntegrationLive = false`) | content/legal |


A client-style Impressum exists on this machine (Desktop/Labrity: "Labrity, Inhaber: Andreas Tonn, Muenster"). It is NOT confirmed as the operator of ServiceOS and its data must not be copied into the ServiceOS Impressum until the owner confirms who the operator is. Do not invent legal data. `npm run check:legal` must pass before production.
