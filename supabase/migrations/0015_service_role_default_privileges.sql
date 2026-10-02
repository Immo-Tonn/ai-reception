-- ServiceOS — 0015: default privileges for the service role on FUTURE objects
--
-- 0009 granted the service role access to the tables that existed then. On a
-- database where the hosting platform does not already do this by default, a
-- table added by a later migration would be "permission denied" for trusted
-- server code. This makes that automatic and portable.
--
-- Deliberately narrow:
--   * service_role ONLY — nothing is granted to `anon` or `authenticated`
--     (their access stays exactly as 0009/0012 define, enforced by RLS);
--   * RLS is not touched: the service role bypasses it by design, and it is
--     used only from whitelisted server modules (never browser code);
--   * nothing existing is changed or revoked.
-- Idempotent: re-running changes nothing.

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Cover anything created after 0009 but before this migration (e.g. rate_limits).
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
