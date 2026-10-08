# Bootstrap ServiceOS on a fresh Supabase project

Цель: поднять рабочий ServiceOS на **совершенно новом** Supabase project, не переписывая код. Источник истины для структуры backend — **репозиторий + `supabase/migrations/`**. Текущий проект `ai-reception` — временное/reference-окружение, не единственный источник истины. В коде нет ни одного идентификатора конкретного проекта: переезд = новые ENV + redeploy.

Что живёт ТОЛЬКО вне репозитория (и поэтому описано здесь): ключи проекта и настройки Auth в панели Supabase.

---

## 1. Создать проект

1. Supabase Dashboard → New project (регион по вашему выбору, для DACH — Frankfurt).
2. Дождаться готовности. Из **Project Settings → API** понадобятся:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` / secret key → `SUPABASE_SERVICE_ROLE_KEY` (**секрет**, только server-side)

## 2. Настроить Auth (вручную, в панели)

| Настройка | Значение |
|---|---|
| Authentication → Providers → Email | включён (сейчас используется только email/password) |
| Confirm email | для тестов можно выключить; **для production включить** (иначе любой может зарегистрироваться на чужой email) |
| URL Configuration → Site URL | публичный адрес приложения (то же, что `NEXT_PUBLIC_APP_URL`) |
| URL Configuration → Redirect URLs | тот же адрес (и `http://localhost:3000` для разработки) |

Google/Apple/Microsoft сейчас **не** используются.

## 3. Применить миграции

Только на **пустом** проекте, строго по порядку `0001 → 0010`. Файлы лежат в `supabase/migrations/`.

**Вариант A — SQL Editor (без CLI):** по очереди открыть каждый файл, вставить в SQL Editor → Run. После каждого файла убедиться, что нет ошибки.

**Вариант B — Supabase CLI:**
```bash
supabase link --project-ref <project-ref>
supabase db push
```
(`<project-ref>` — идентификатор нового проекта; в репозиторий не записывается.)

Замечания:
- `0001`–`0006` создают типы (`create type`) без `if not exists` → их запускают **один раз** на чистой базе.
- `0007`–`0010` идемпотентны и безопасны при повторном запуске (это проверяется тестами).
- Проект, где `0001`–`0006` уже применены (как `ai-reception`), получает только `0007`+.
- `0008` добавляет ограничения как `NOT VALID`: существующие строки не отвергаются, новые — проверяются.
- `0011` требует расширение `btree_gist` (входит в Supabase и в любой PostgreSQL; `create extension if not exists` в самой миграции). Она добавляет защиту от double booking. На базе, где уже есть **пересекающиеся активные записи** одного сотрудника/ресурса, миграция намеренно упадёт — сначала разрешите пересечения (на тестовом проекте записей нет).
- `0013`/`0014` — функции для гостевой брони и rate limiting; доступны **только** `service_role`.
- `0009` включает RLS на **всех** таблицах (на новом проекте без него таблицы были бы открыты через anon-ключ) и создаёт политики. Ничего не удаляет.

### Проверка (только SELECT)

```sql
-- RLS включён везде? (все 19 строк должны быть true)
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;

-- Политики созданы?
select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2;

-- Функции на месте?
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('is_workspace_member','has_workspace_permission','shares_workspace_with',
                  'is_slug_allowed','provision_workspace','complete_onboarding',
                  'can_see_appointment','list_masked_appointments','resolve_financial_bucket',
                  'get_public_booking_catalog','get_public_busy','create_public_booking','rate_limit_hit');

-- Защита от double booking на месте? (должно вернуть 2 строки)
select conname from pg_constraint
where conname in ('appointments_no_staff_overlap','appointments_no_resource_overlap');

-- Публичные функции недоступны anon/authenticated? (anon и authenticated НЕ должны быть в списке)
select grantee, routine_name from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('create_public_booking','get_public_booking_catalog','get_public_busy','rate_limit_hit','provision_workspace')
order by routine_name, grantee;
```

## 4. Подставить ENV

Локально — файл `.env.local` в корне проекта (он в `.gitignore`, **никогда не коммитить**):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=
```
Имена перечислены в `.env.example` (без значений).

Vercel: Project → Settings → Environment Variables — те же 4 переменные для Production (и Preview при необходимости). `NEXT_PUBLIC_*` вшиваются в build, поэтому после изменения нужен **redeploy**. `SUPABASE_SERVICE_ROLE_KEY` — без префикса `NEXT_PUBLIC_`, никогда не показывать в браузере.

## 5. Auth и приватность регистрации

- **Confirm email — для production ВКЛЮЧИТЬ.** Регистрация намеренно не сообщает, есть ли уже аккаунт с этим email (нет user enumeration): и для нового, и для существующего адреса пользователь видит одно и то же «проверьте почту». При выключенном Confirm email (только для разработки) новый владелец сразу попадает в онбординг, а уже существующий адрес видит «проверьте почту» — разницу можно заметить, поэтому в production подтверждение включено.
- Настройте SMTP в Supabase Auth (или встроенную отправку для тестов) и Redirect URLs.

## 6. Проверить

1. `npm test` — 290+ тестов. Среди них `src/server/db/__tests__/rls.test.ts` **заново проигрывает все миграции** в изолированном in-process Postgres (PGlite) и проверяет изоляцию tenants, права ролей, идемпотентность. Это доказывает, что миграции воспроизводят схему с нуля.
2. `npm run build && npm start`.
3. `/signup` → создать бизнес → онбординг → `/<slug>/settings/services` → добавить услугу.
   Для брони нужны: услуга, сотрудник («You» создаётся автоматически) и рабочие часы (по умолчанию Пн–Пт 09–18).
4. Выйти (Settings → Sign out), снова войти на `/login`. Второй пользователь не должен видеть workspace первого (`/<slug-первого>/today` → 404).
5. **Кросс-девайс бронь (главный сценарий):** устройство A открывает `/book/<slug>` (без входа), выбирает услугу → время → вводит данные → подтверждает; устройство B (владелец, залогинен) открывает `/<slug>/calendar` — запись видна, и остаётся после перезагрузки. Клиент появляется в `/<slug>/clients`.
6. Без ENV demo-страницы (`/demo-salon/today`, `/book/demo-salon`) продолжают работать — это нормально и проверено.

## 7. Что НЕ нужно делать

- Не вставлять `service_role` ключ в `NEXT_PUBLIC_*`, README, HANDOFF, тесты, SQL.
- Не править применённые миграции — только новые нумерованные файлы.
- Не запускать «bootstrap»-SQL из чужих веток: вся схема и политики — в `supabase/migrations/`.
- Не класть seed/demo-данные в миграции. Demo-данные живут в коде (`src/features/workspace/presets/*`) и в localStorage; production-схема их не содержит.

## 8. Окружения и известные ограничения

- **`ai-reception` — только reference/временное окружение**, не незаменимая инфраструктура. По последнему аудиту на нём применены `0001`–`0007` (+ grants и FK, сделанные вручную). **Миграции `0008`–`0016` на него НЕ применять.**
- Основной E2E планируется на отдельном контролируемом проекте **ServiceOS Dev Supabase**: чистый проект → `0001 → 0016` → новый signup/provisioning (старые workspace `ai-reception` не используются, backfill для них не делается).

**Roadmap / known limitations (не реализовано намеренно):**
N2 `/auth/callback` и «забыл пароль» (нужны при включённом Confirm email); N3 пагинация/окно дат для списков (лимит PostgREST 1000 строк); N4 авто-обновление Calendar (сейчас — после reload); N5 уведомления о новой брони (гостю и владельцу, после merge Notifications); N6 UI для staff, ресурсов, рабочих часов и `auto_confirm_bookings`; N7 GDPR: экспорт/удаление клиента; N8 browser-E2E (Playwright). Finance, Waiting List, Work, Inbox для реального workspace пока пустые (shared backend — Phase 3–4); demo-данные показываются только demo-workspaces.

## 9. Security hardening (`0016`)

`0016_security_hardening.sql` закрывает замечания Supabase Advisor (отзыв EXECUTE у trigger-функций, перенос `btree_gist` из `public` в `extensions`, разделение `FOR ALL` write-политик; последнее также закрывает чтение PRIVATE financial bucket ролью `admin`). **Применять к ServiceOS Dev после первого E2E и до production** (`supabase db push`), затем повторить `supabase db advisors --linked`. Оставшиеся WARN по SECURITY DEFINER-хелперам для `authenticated` сознательные (их вызывают RLS-политики и приложение); возможное будущее улучшение — вынести хелперы в неэкспонируемую схему.

## 10. ⛔ Production blocker: Confirm email

Состояние ServiceOS Dev: **Confirm email = OFF** (временно, только на время первого ручного E2E). **До production обязательно включить обратно (ON).** Перед включением должны быть готовы и проверены: `/auth/callback`, Site URL и Redirect URLs, flow подтверждения email, Forgot/Reset Password, production SMTP (встроенная отправка Supabase годится только для тестов), E2E регистрации с подтверждением. **Условие релиза: Confirm email = ON и E2E подтверждения email = PASS.**

## 11. Если что-то пошло не так

| Симптом | Причина |
|---|---|
| Регистрация возвращает общую ошибку | Нет `SUPABASE_SERVICE_ROLE_KEY`, не применена `0010`, либо Confirm email включён без настроенной почты |
| `/<slug>/today` всегда 404 после входа | Не применены `0009` (политики) или у пользователя нет строки в `workspace_members` |
| Бронь: «время занято» на свободный слот | Не применена `0011`/`0013`, нет сотрудника или рабочих часов у workspace |
| Любая страница реального workspace → 404 | Не заданы `NEXT_PUBLIC_SUPABASE_*` (или не сделан redeploy после их добавления) |
| `permission denied for function provision_workspace` при регистрации | Ключ в `SUPABASE_SERVICE_ROLE_KEY` не service-role |
