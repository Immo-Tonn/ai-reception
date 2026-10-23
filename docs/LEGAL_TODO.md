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

## Operator identity (decision pending, do not assume)
A client-style Impressum exists on this machine (Desktop/Labrity: "Labrity, Inhaber: Andreas Tonn, Muenster"). It is NOT confirmed as the operator of ServiceOS and its data must not be copied into the ServiceOS Impressum until the owner confirms who the operator is. Do not invent legal data. `npm run check:legal` must pass before production.
