# Google Calendar для ServiceOS: что нужно сделать владельцу

Инструкция для подключения настоящего Google Calendar к ServiceOS (интеграция FreeBusy).
Код готов и проверен тестами на mock-провайдере. **С настоящим Google ещё не проверялся.**

> ⚠️ Никогда не отправляйте Client Secret, ключ шифрования, пароли или токены в чат (и мне тоже).
> Вставляйте их только в `.env.local` у себя на компьютере и в Vercel → Environment Variables.

---

## 1. Нужен ли отдельный Google-аккаунт для ServiceOS?

**Рекомендуется, но не обязательно.**

- Проект в Google Cloud должен принадлежать **рабочему** аккаунту ServiceOS, а не вашему личному.
  Иначе доступ к проекту будет привязан к личной почте.
- Включите 2-факторную аутентификацию и добавьте в проект второго владельца (например, Наталью), чтобы не потерять доступ.
- Сотрудникам отдельный аккаунт **не нужен**: каждый подключает **свой собственный** Google-аккаунт по ссылке.

## 2. Как создать Google Cloud Project

1. Откройте https://console.cloud.google.com и войдите рабочим аккаунтом.
2. Наверху нажмите на выбор проекта → **New Project**.
3. Название: `ServiceOS` (для теста можно `ServiceOS Staging`). Организация не обязательна.
4. Нажмите **Create** и переключитесь на новый проект.

Рекомендация: позже сделать **отдельные OAuth-клиенты (или проекты) для staging и production**.

## 3. Как включить Google Calendar API

1. Меню ☰ → **APIs & Services** → **Library**.
2. Найдите **Google Calendar API** → **Enable**.

Billing-аккаунт (карта) для Calendar API **не нужен**.

## 4. Как настроить OAuth Consent Screen

В новой консоли этот раздел называется **Google Auth Platform**: Branding / Audience / Data access / Clients.

1. **Branding**:
   - App name: `ServiceOS`;
   - User support email: рабочая почта;
   - Developer contact email.

   Ссылки на домашнюю страницу и политику конфиденциальности понадобятся для верификации (п. 9).
   Используйте только **настоящие** данные. Datenschutz сейчас НЕ готов (см. `docs/LEGAL_TODO.md`).
2. **Audience**:
   - User type: **External** (сотрудники заходят личными Google-аккаунтами);
   - Publishing status: пока **Testing**;
   - **Test users**: добавьте почты тех, кто будет тестировать (до 100 человек).
3. **Data access** → **Add or remove scopes** → добавьте ровно три:
   - `openid` — подтверждение, какой это Google-аккаунт (для страницы самостоятельного отключения; не sensitive);
   - `https://www.googleapis.com/auth/calendar.freebusy`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

   Больше ничего не добавляйте: ServiceOS не нужен доступ к событиям, почте (`email`) или профилю (`profile`).

⚠️ В режиме **Testing** Google выдаёт доступ только на **7 дней**. Через неделю подключение в ServiceOS
станет «Доступ отозван», и сотруднику нужно будет переподключиться. Для постоянной работы нужна публикация + верификация (п. 9).

## 5. Как получить Client ID и Client Secret

1. **Google Auth Platform → Clients → Create client**.
2. Application type: **Web application**, имя: `ServiceOS Web (staging)`.
3. **Authorized redirect URIs**: добавьте адреса из п. 6. JavaScript origins не нужны.
4. **Create**. Google покажет **Client ID** и **Client Secret**.
   - Сохраните их сразу в менеджер паролей: в новой консоли секрет может быть виден только при создании.
   - Если секрет утёк, удалите его и создайте новый (Clients → ваш клиент → Add secret).

## 6. Какие Redirect URI понадобятся

Адрес должен совпадать **символ в символ**:

| Среда | Redirect URI |
|---|---|
| Локально | `http://localhost:3000/api/integrations/google-calendar/callback` |
| Staging | `https://<ваш-фиксированный-staging-домен>/api/integrations/google-calendar/callback` |
| Production (сейчас, временно) | `https://ai-reception-two.vercel.app/api/integrations/google-calendar/callback` — домен должен подтвердить тимлид в Vercel → Domains |
| Production (после выбора своего домена) | `https://<новый-домен>/api/integrations/google-calendar/callback` — см. TODO в [PRODUCTION_DEPLOYMENT_CHECKLIST.md](PRODUCTION_DEPLOYMENT_CHECKLIST.md) |

Один и тот же Redirect URI используется и для подключения календаря, и для страницы `/connect-calendar/manage` (вход «только подтвердить аккаунт»).

Важно:
- Адрес строится из `NEXT_PUBLIC_APP_URL`. На staging он должен быть задан.
- Vercel Preview-ссылки (`...-git-...vercel.app`) меняются с каждым деплоем, их нельзя зарегистрировать.
  Тестируйте на фиксированном staging-домене.

## 7. Какие ENV нужно добавить и куда

| Имя | Значение | Где |
|---|---|---|
| `GOOGLE_CALENDAR_CLIENT_ID` | Client ID из п. 5 | `.env.local` и Vercel |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Client Secret из п. 5 | `.env.local` и Vercel (Sensitive) |
| `EXTERNAL_CALENDAR_ENCRYPTION_KEY` | 32 случайных байта в base64 | `.env.local` и Vercel (Sensitive) |
| `CRON_SECRET` | ≥ 16 случайных символов (`openssl rand -hex 32`) — защита ежедневной очистки | только Vercel (Sensitive) |
| `NEXT_PUBLIC_APP_URL` | уже существует, публичный адрес приложения | staging/production |

Ключ шифрования сгенерируйте сами в терминале и скопируйте результат прямо в файл (не в чат):

```bash
openssl rand -base64 32
```

**Локально:** откройте `.env.local` в редакторе, добавьте три строки `ИМЯ=значение`, сохраните и перезапустите `npm run dev`.

**Vercel:** Project → Settings → Environment Variables:
- добавьте три переменные и отметьте **Sensitive**;
- задавайте **разные** значения для Preview/Staging и Production (свой ключ шифрования на каждую среду);
- после добавления нужен Redeploy.

Правила для ключа шифрования:
- его смена = все подключения придётся переподключить;
- храните его в менеджере паролей;
- без `NEXT_PUBLIC_`.

## 8. Как подключить первый тестовый Google Calendar

Шаги 1 и 4 требуют вашего отдельного разрешения.

1. **Миграции:** `0025` уже применена (2026-10-13). **`0026_external_calendar_subject.sql` — нужна отдельная команда/разрешение** (одна новая колонка). Порядок такой же:
   - сначала проверить, что `supabase/.temp/project-ref` совпадает с проектом в `.env.local`;
   - затем выполнить `supabase db push --dry-run`.

   Миграция только добавляет 2 таблицы и 3 функции, существующие данные не трогает.
2. Добавить ENV (п. 7) в `.env.local` и перезапустить dev-сервер.
3. Войти владельцем → **Настройки → Google Календарь**.
4. Нажать **«Подключить мой Google Календарь»** → откроется страница ServiceOS с объяснением → **«Продолжить с Google»**.
5. Google покажет предупреждение «Google hasn't verified this app» (нормально в режиме Testing):
   - нажмите **Continue**;
   - **отметьте обе галочки** доступа.
6. Выберите календари → **Сохранить выбор**.
7. Проверка:
   - создайте в Google событие на ближайший рабочий день 14:00–15:00;
   - откройте `/book/<ваш-slug>`: у этого сотрудника 14:00 нет, у остальных есть;
   - удалите событие → через ≤ 5 минут (или «Проверить сейчас» в настройках) время снова свободно.
8. Для другого сотрудника: **«Создать ссылку для подключения»** → отправьте ссылку человеку.
   Ссылка одноразовая и действует 72 часа. Его почта должна быть в Test users.

## 9. Понадобится ли Google OAuth Verification

- **Для теста (Testing, до 100 тест-пользователей): нет.** Но доступ истекает каждые 7 дней.
- **Для production (любой сотрудник любого бизнеса): да.** Google относит Calendar-scopes к категории
  **sensitive** — консоль покажет классификацию при добавлении scopes.

  Для верификации понадобятся:
  - подтверждённый домен (Google Search Console);
  - домашняя страница;
  - **готовая политика конфиденциальности** (Datenschutz). Черновик раздела о Google: `/datenschutz#google-kalender` (ещё не утверждён юристом);
  - объяснение, зачем каждый scope;
  - короткое видео на YouTube, показывающее процесс подключения.

  Обычно это занимает от нескольких дней до нескольких недель.
- Платная проверка безопасности (CASA) нужна для **restricted**-scopes (например Gmail); наших scopes это не касается.

## 10. Есть ли обязательные платные услуги

**Нет.**
- Google Calendar API бесплатен в пределах квот, billing не нужен.
- Верификация OAuth бесплатна.
- Google Workspace не обязателен.
- Vercel и Supabase — без изменений тарифов.

Возможные расходы только косвенные: домен (уже нужен для production) и юридическая проверка Datenschutz.

---

## Юридическое (Needs legal review)

- Занятость сотрудников — это персональные данные работников (DSGVO, § 26 BDSG).
- Нужны: согласие/информирование сотрудников, упоминание интеграции в Datenschutzerklärung,
  срок хранения (кеш занятости ≤ 6 месяцев вперёд, удаляется при отключении).
- Это не юридическая консультация.
