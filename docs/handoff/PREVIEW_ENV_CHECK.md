# Проверка: безопасно ли приложение без переменных Supabase (Preview)

Ничего не менялось в Vercel/Supabase. Проверка в чистой копии репозитория **без** `.env*` (только `.env.example`), с пустым окружением (`env -i`).

Результат:
- Код: `src/lib/supabase/config.ts` читает только `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` из окружения; запасных значений и вшитых адресов проекта нет (поиск `supabase.co` по `src` — пусто). Без переменных конфигурация = `null`; места, которым нужна база, проверяют `isSupabaseConfigured()`.
- `next build` без переменных: успешно.
- `next start` без переменных, маршруты `/`, `/login`, `/signup`, `/book/<slug>`, `/business`, `/client/book`, `/client/profile`, `/connect-calendar/setup`: 200; `/api/cron/external-calendar-cleanup`: 401; несуществующие маршруты: 404.
- Сетевые соединения процесса: только локальные, **внешних/к production нет**; ошибок в логе нет.
- Вывод: приложение безопасно работает без переменных Supabase и не подключается к production через запасные настройки. Рабочие функции (вход, запись, кабинет) в таком Preview недоступны — это ожидаемо.
- Не проверено: что на самом Vercel переменные Preview заданы/не заданы — это читается только в настройках Vercel (read-only, её роль). Список имён переменных для проверки: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Переменные Preview не удалялись.
