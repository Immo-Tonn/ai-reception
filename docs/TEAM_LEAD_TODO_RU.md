# Что осталось сделать тимлиду (обновлено 24.10.2026)

Здесь только то, что **не может сделать код**: нужны доступы к Vercel, Google Cloud или Supabase Dashboard, которые есть только у тимлида. Секреты не отправлять в чат, а сразу вводить в Vercel и менеджер паролей.

## Почему это ещё не сделано
Код всех функций уже в `main` и опубликован на livetermin.de. Не хватает только настроек в чужих сервисах:
- **Google Cloud:** проект, OAuth-клиент и ключи тимлид ещё готовит (со слов владельца проекта).
- **Vercel и Supabase:** настройки зависят от домена, а домен livetermin.de подключён недавно. Инструкции в PR #7 были написаны под старый адрес `ai-reception-two.vercel.app`.

Пока это не сделано, сайт работает безопасно: Google Календарь у бизнеса показывает «скоро станет доступно», бронирование работает как без него.

## 1. Срочно (безопасность)
| Задача | Где | Как проверить |
|---|---|---|
| Включить защиту Preview-ссылок | Vercel → Settings → Deployment Protection → Vercel Authentication (Preview) | Preview-адрес в приватном окне требует вход Vercel. Сейчас он открыт всем и работает с настоящей базой |
| Перенести функции во Франкфурт | Vercel → Settings → Functions → Function Regions → `fra1` → Redeploy | `curl -sI https://livetermin.de/client/book \| grep x-vercel-id` показывает `…::fra1::…`. Сейчас `iad1` (США), база во Франкфурте: каждое действие ждёт ответа из-за океана |

## 2. Домен livetermin.de
| Задача | Где |
|---|---|
| `NEXT_PUBLIC_APP_URL=https://livetermin.de` (Production) + Redeploy | Vercel → Environment Variables. Нужен для ссылок записи, QR, **ссылки подписки клиента на календарь** и Google OAuth. Без него ссылки могут указывать на `*.vercel.app` |
| Site URL и Redirect URLs = `https://livetermin.de` | Supabase → Authentication → URL Configuration (письма, вход) |

## 3. Google Календарь сотрудников (PR #7)
Пошагово: описание PR #7, разделы 3 и 4, и `docs/GOOGLE_CALENDAR_SETUP_RU.md`. Во всех адресах вместо старого домена — `livetermin.de`.
1. Google Cloud: проект → Google Calendar API → Google Auth Platform (Branding, Audience: External/Testing, test users) → 3 разрешения: `openid`, `calendar.freebusy`, `calendar.calendarlist.readonly`.
2. OAuth-клиент (Web application), Authorized redirect URI: `https://livetermin.de/api/integrations/google-calendar/callback`.
3. Vercel → Production: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `EXTERNAL_CALENDAR_ENCRYPTION_KEY` (`openssl rand -base64 32`), `CRON_SECRET` (`openssl rand -hex 32`) → **Redeploy**.
4. Проверка: страница `https://livetermin.de/connect-calendar/manage` больше не пишет «not available», в кабинете (Ещё → Настройки → Google Календарь) появляется «Подключить».

## 4. Календарь для клиентов — тимлиду делать НИЧЕГО не нужно
- «Добавить в календарь» (Google / Apple / Outlook) после записи и в «Моих записях» работает без ключей.
- Подписка «Все мои записи в моём календаре» работает без ключей и без миграции базы. Нужен только `NEXT_PUBLIC_APP_URL` из п. 2, чтобы ссылка была на livetermin.de.

**На будущее (не делать без решения владельца):** если понадобится, чтобы ServiceOS **сам записывал** события в Google клиента (мгновенная синхронизация), к тому же OAuth-клиенту нужно добавить разрешение `calendar.events`. Google считает его «чувствительным»: нужна проверка приложения в Google (обычно несколько недель) и утверждённая Datenschutz.

## 5. До коммерческого запуска
- Supabase Pro (сейчас нет автоматических бэкапов), затем PITR.
- Vercel Pro (Hobby — только некоммерческое использование).
- Юридическая проверка Datenschutz и Impressum.
