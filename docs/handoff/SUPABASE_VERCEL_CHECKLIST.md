# Чеклист для проверки облачных настроек (только чтение) — Supabase и Vercel

Для Кристины / тимлида. Ничего не менять: смотреть и записывать результат. Значения ключей не копировать и не присылать.

## A. Supabase Dashboard (проект «ServiceOS Dev» = production)

| # | Где смотреть | Что смотреть | Норма |
|---|---|---|---|
| 1 | Project Settings → API (Data API) → Exposed schemas | список схем, доступных через API | Только `public` (и `graphql_public`, если GraphQL включён). Нет `auth`, `storage`, `extensions`, `pg_catalog`. Приложение использует только `public` |
| 2 | Database → Extensions → `pg_graphql` | включён ли GraphQL | Приложение GraphQL не использует → лучше **выключен**. Если включён: права и RLS всё равно действуют, но это лишняя поверхность. (В моей локальной проверке он был выключен, поэтому GraphQL-проверки слабые) |
| 3 | Authentication → Providers → Email | «Confirm email» | **Включено** |
| 4 | Authentication → URL Configuration | Site URL и Redirect URLs | Site URL = https://livetermin.de; в списке только нужные адреса, без `*` для всего домена Vercel Preview |
| 5 | Authentication → Sign In / Providers | разрешена ли самостоятельная регистрация, минимальная длина пароля, защита от утёкших паролей (если тариф позволяет) | Регистрация — как задумано продуктом; длина ≥ 8; leaked-password protection включена, если доступна |
| 6 | Project Settings → Infrastructure | версия PostgreSQL, регион, доступные обновления | Поддерживаемая основная версия (локально проверено на 17); нет пометок об обязательном security-обновлении; регион eu-central-1 (Frankfurt) |
| 7 | Project Settings → Database → Connection pooling | режим пула | Приложение работает через REST API (supabase-js), прямых подключений к БД нет → режим пула на него не влияет. Если пул виден: Transaction mode — норма. Защита «флагами транзакции» (`set_config(..., true)`) работает внутри одного вызова и режимом пула не ломается |
| 8 | Advisors → Security | список предупреждений | Нет уровня ERROR. Особенно: «RLS disabled», «function search_path mutable», «security definer view». Записать все WARN — разберём |
| 9 | Database → Backups | включены ли ежедневные копии, есть ли PITR | Зависит от тарифа. Записать факт; восстановление всё равно проверяем отдельно |
| 10 | Project Settings → API Keys | типы ключей, где используется `service_role` | `service_role` только на сервере (Vercel, не `NEXT_PUBLIC_`). Подтверждено кодом: ключ читается в одном файле |
| 11 | Authentication → Rate Limits | лимиты входа/писем | Не отключены |

## B. Vercel — переменные в scope Preview (только названия)

Названия, которые использует приложение (значения не нужны):
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Cron: `CRON_SECRET`
- Google Calendar: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `EXTERNAL_CALENDAR_ENCRYPTION_KEY`
- Прочее: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_ENV` (встроенные `VERCEL_*` задаёт сам Vercel)

Что проверить: какие из них отмечены галочкой **Preview**. Особенно важны `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (дают Preview доступ к реальной базе), `EXTERNAL_CALENDAR_ENCRYPTION_KEY` и ключи Google.

## C. Как отвязать Preview от реальной базы (варианты)
1. **Убрать три Supabase-переменные из scope Preview (рекомендуется).** Проверено: приложение без них собирается и запускается, страницы отвечают, внешних соединений нет, к production оно не подключается. Минус: вход и запись в Preview не работают. Переменные NEXT_PUBLIC встраиваются при сборке — после изменения Preview нужно пересобрать.
2. **Отдельный пустой проект Supabase для Preview** (синтетические данные, миграции 0001–0033), его ключи — в Preview. Preview полностью работает, production не затронут. Нужен второй проект (тариф/лимиты).
3. Оставить как есть + Deployment Protection (её включает Кристина): закрывает чужой доступ к ссылкам, но Preview по-прежнему имеет ключи реальной базы — слабее вариантов 1–2.

Cron (`vercel.json`) выполняется только в production-деплое, Preview его не запускает.
Сами переменные я не менял и не удалял.
