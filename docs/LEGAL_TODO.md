# Legal TODO (production blockers)

Status: `/impressum` and `/datenschutz` exist (public, indexable) but are NOT release-ready.
Release check: `npm run check:legal` exits 1 while any item below is open (normal `vitest run` stays green).
Flags: `src/content/legal/datenschutz.ts` -> `datenschutzApproved`, `src/content/legal/impressum.ts` -> `impressumApproved`.
All of this Needs legal review (not a substitute for a lawyer).

## Datenschutzerklaerung
- [ ] Write the full text (controller, data and purposes, legal bases, recipients/processors e.g. hosting, Supabase, e-mail provider, retention, rights, supervisory authority complaint). Only a heading skeleton + loud draft banner exists.
- [ ] Set `datenschutzLastUpdated` and `datenschutzApproved = true` after approval.

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
