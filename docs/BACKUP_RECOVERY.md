# Backups & Disaster Recovery

No secrets and no personal data in this document. Prices and plan features are from supabase.com (docs/backups
and pricing), checked 2026-10-13 — re-check before deciding.

## 1. Current state (2026-10-13)
| Item | State |
|---|---|
| Production database | Supabase project **ServiceOS Dev** (only database; serves production), region eu-central-1 |
| Supabase automatic backups | **none** (`supabase backups list`: empty, PITR disabled) — consistent with the Free plan; team lead to confirm the plan in Dashboard -> Billing |
| Free-plan risk | Free projects are **paused after 1 week of inactivity** (pricing page) |
| Manual backup | one full logical dump (roles, schema, data incl. Supabase Auth) taken 2026-10-13 before migration 0025, plus one after |
| Where | operator's MacBook only: AES-256 encrypted disk image `~/ServiceOS-Backups-Encrypted/serviceos-supabase-2026-10-13.dmg` (+ the unencrypted originals in `~/ServiceOS-Backups/`, kept until the owner approves deleting them) |
| Password | generated randomly, stored in the macOS login Keychain (item "ServiceOS Supabase Backup", account `serviceos-backup-2026-10-13`); never written to the repo, logs or chat |
| Restore test | **passed** (see §3): encrypted image -> isolated local Supabase stack -> all 57 `public` + `auth` tables identical row counts, Supabase Auth (GoTrue v2.197.0) lists all restored users |

### Risks
1. Single copy on one laptop. The login Keychain is **not** synced to iCloud: if the MacBook is lost, the image and
   its password are lost. **Action for the owner:** copy the Keychain password into the team password manager and
   copy the encrypted image to a second secure place (e.g. encrypted external drive or company cloud storage).
2. The dump contains highly sensitive data: personal data of clients, password hashes, **active Supabase Auth
   sessions and refresh tokens**. Treat as secret; never commit, never upload unencrypted.
3. No automatic backups and an inactivity pause on the current plan.
4. Manual dumps are point-in-time; data created after a dump is lost on restore.

## 2. How the backup was made (repeatable)
```
supabase db dump --linked --role-only -f roles.sql
supabase db dump --linked -f schema.sql
supabase db dump --linked --data-only --use-copy -f data.sql
```
(requires Docker; run from the linked repo after checking `supabase/.temp/project-ref`). Then create an encrypted
image (`hdiutil create -encryption AES-256 -stdinpass -srcfolder <folder> -format UDZO <file>.dmg`) with a random
password stored in a password manager, and delete the plaintext files once the image is verified.

## 3. Restore procedure
**Test / verification (never against production):**
1. Mount the image with its password (read-only).
2. Start an isolated local stack: `supabase start` (binds to 127.0.0.1 only; applies migrations 0001-…).
3. Filter out `supabase_migrations`, `storage`, `realtime`, `vault` from `data.sql`; in one transaction:
   `SET session_replication_role = replica`, truncate `public` tables, load `data.sql`.
4. Compare row counts per table with the counts recorded at dump time; check Auth (`/auth/v1/admin/users`).
5. `supabase stop --no-backup` (deletes the local volumes and the restored copy).

**Real disaster (new or emptied Supabase project; needs team lead decision):**
1. Create/choose the target project (same region), link it, keep the old one untouched if it still exists.
2. `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql` (Supabase "restore from logical backup" procedure).
3. Re-set passwords of custom roles if any; re-create Storage objects (not part of database backups).
4. Point Vercel `NEXT_PUBLIC_SUPABASE_URL` / keys to the restored project; re-check Auth Site URL / redirects.
5. Verify: login, public booking, business calendar, Google Calendar connections (tokens decrypt only with the same
   `EXTERNAL_CALENDAR_ENCRYPTION_KEY`).
Notes from the test: a bare Postgres image lacks Supabase roles (e.g. `supabase_realtime_admin`) and has an older
`auth` schema — always restore into a real Supabase project or the Supabase CLI stack.

## 4. Supabase options
| Option | Daily backups | PITR | Retention | Price / month | Restore & limits |
|---|---|---|---|---|---|
| **Free** (current, to be confirmed) | no | no | — | $0 | only own `supabase db dump`; project pauses after 1 week inactivity |
| **Pro** | yes | add-on | 7 days | from $25 (includes Micro compute) | restore from dashboard; project inaccessible during restore; Storage objects not included |
| **Team** | yes | add-on | 14 days | from $599 | as Pro |
| **Enterprise** | yes | add-on | up to 30 days | custom | as Pro |
| **PITR add-on** (Pro/Team/Enterprise) | replaces daily backups | yes, seconds granularity, worst-case RPO ~2 min | 7 / 14 / 28 days | ~$100 / $200 / $400, **plus at least Small compute** ($15) | restore to any point in the window; downtime during restore |

General limits: custom role passwords are not in daily backups; deleting the project deletes its backups; restoring
to a new project goes through "Duplicate project".

## 5. Recommendation
- **Now (testing, no real customers):** at least **Pro** ($25/month) — ends the inactivity pause and gives 7 days of
  daily backups; keep a manual encrypted dump before every migration (as done for 0025). Store image + password
  off the laptop.
- **Commercial operation with real customers:** **Pro + PITR 7 days** (~$100 + compute) or Team if required by
  customers/compliance; weekly encrypted off-site logical dump with documented retention; restore drill every
  quarter; document backup retention in the Datenschutz (deleted data stays in backups until they expire).
- Nothing was purchased or changed — the plan decision belongs to the team lead.

## 6. Team lead decisions
- [ ] Confirm the current Supabase plan; choose Pro (now) and PITR (before real customers)
- [ ] Where encrypted backups live (off-laptop location) and who holds the password (2 people)
- [ ] Backup retention period (Needs legal review) and when to delete the local unencrypted copies
- [ ] Restore drill schedule
