import type { Locale } from "@/lib/i18n";

/**
 * Datenschutzerklärung — section "Google Kalender-Integration" (DRAFT).
 *
 * Every factual statement below is taken from the implementation
 * (docs/EXTERNAL_CALENDAR.md, migration 0025, src/server/externalCalendar/*).
 * Anything the code cannot prove — legal bases, controller/processor roles,
 * retention of connect-link records and backups, third-country transfers,
 * the production hosting location — is NOT asserted and is listed in
 * `reviewNotes` as "Needs legal review". This text is NOT legally approved;
 * `datenschutzApproved` stays false until a lawyer has reviewed it.
 */

export const GOOGLE_CALENDAR_SECTION_ID = "google-kalender";

export const GOOGLE_API_USER_DATA_POLICY_URL = "https://developers.google.com/terms/api-services-user-data-policy";

export interface PrivacyBlock {
  heading: string;
  paragraphs?: string[];
  items?: string[];
  /** Paragraphs shown after the list. */
  after?: string[];
}

export interface GoogleCalendarPrivacyText {
  title: string;
  draftNote: string;
  blocks: PrivacyBlock[];
  /** Shown as "Needs legal review" — open points that must not be presented as facts. */
  reviewTitle: string;
  reviewNotes: string[];
  policyLinkLabel: string;
}

const de: GoogleCalendarPrivacyText = {
  title: "Google Kalender-Integration",
  draftNote:
    "Entwurf zur rechtlichen Prüfung. Dieser Abschnitt beschreibt die technische Umsetzung und ist noch nicht rechtlich freigegeben (Needs legal review).",
  blocks: [
    {
      heading: "Freiwillige Verbindung durch die Mitarbeiterin bzw. den Mitarbeiter",
      paragraphs: [
        "Unternehmen, die ServiceOS nutzen, können die Online-Terminbuchung mit Google Kalender abgleichen. Die Verbindung wird nicht vom Unternehmen, sondern von der jeweiligen Mitarbeiterin bzw. dem jeweiligen Mitarbeiter selbst hergestellt: Das Unternehmen erstellt einen persönlichen Verbindungslink (einmal verwendbar, 72 Stunden gültig). Die Person öffnet ihn, meldet sich direkt bei Google mit ihrem eigenen Google-Konto an und erteilt dort die Berechtigung. ServiceOS erhält dabei weder das Google-Passwort noch Zugriff auf das Google-Konto als Ganzes.",
        "Vor der Weiterleitung zu Google zeigt ServiceOS an, welche Daten angefragt werden und wofür sie verwendet werden.",
      ],
    },
    {
      heading: "Angefragte Berechtigungen",
      items: [
        "Frei/Belegt-Informationen der ausgewählten Kalender (Google-Berechtigung „calendar.freebusy“): nur Beginn und Ende belegter Zeiträume.",
        "Liste der eigenen Kalender (Google-Berechtigung „calendar.calendarlist.readonly“): Kennung, Name und Kennzeichnung des Hauptkalenders, damit die Person auswählen kann, welche Kalender berücksichtigt werden.",
      ],
      after: [
        "ServiceOS fragt keinen Zugriff auf Inhalte von Terminen an: keine Titel, Beschreibungen, Teilnehmenden, Orte, Anhänge oder Videokonferenz-Links. ServiceOS kann im Google Kalender nichts erstellen, ändern oder löschen und fragt weder die E-Mail-Adresse noch das Profil des Google-Kontos an.",
      ],
    },
    {
      heading: "Welche Daten ServiceOS speichert",
      paragraphs: [
        "In der Datenbank von ServiceOS (Supabase, PostgreSQL) werden je verbundener Person gespeichert:",
      ],
      items: [
        "die Zuordnung zum Unternehmen und zum Mitarbeiterprofil;",
        "die Kennungen der ausgewählten Kalender (höchstens 10). Die Kennung des Hauptkalenders entspricht bei Google in der Regel der E-Mail-Adresse des Google-Kontos;",
        "ein OAuth-Aktualisierungstoken (Refresh Token), verschlüsselt (AES-256-GCM); der Schlüssel liegt nicht in der Datenbank. Kurzlebige Zugriffstoken werden nur während einer Anfrage im Arbeitsspeicher verwendet und nicht gespeichert;",
        "der Verbindungsstatus („verbunden“, „Synchronisierungsfehler“, „Zugriff entzogen“), der Zeitpunkt der Verbindung, der letzten erfolgreichen Prüfung sowie Code und Zeitpunkt des letzten Fehlers;",
        "ein Zwischenspeicher (Cache) der belegten Zeiträume — nur Beginn und Ende — für den Zeitraum von einem Tag in der Vergangenheit bis etwa sechs Monate (183 Tage) in der Zukunft. Er wird bei Bedarf, frühestens nach fünf Minuten, durch eine neue Abfrage bei Google ersetzt; ältere Zeiträume entfallen dabei. Findet keine neue Abfrage statt, bleibt der zuletzt abgerufene Stand bis zur nächsten Abfrage oder bis zum Trennen gespeichert; eine zeitgesteuerte automatische Löschung gibt es derzeit nicht (Needs legal review). Der Zeitraum von 183 Tagen ergibt sich aus dem maximalen Buchungszeitraum und ist keine festgelegte Speicherfrist;",
        "zum Verbindungslink: nur ein Prüfwert (SHA-256-Hash) des Links, Unternehmen, Mitarbeiterprofil, Ablaufzeitpunkt, Zeitpunkt der Verwendung und das Benutzerkonto, das den Link erstellt hat.",
      ],
    },
    {
      heading: "Was ServiceOS nicht speichert",
      items: [
        "Kalendernamen: Sie werden nur während der Auswahl live bei Google abgefragt und der verbindenden Person angezeigt.",
        "Inhalte von Terminen (Titel, Beschreibung, Teilnehmende, Ort).",
        "Google-Passwörter.",
      ],
    },
    {
      heading: "Technisch notwendige Cookies während der Verbindung",
      paragraphs: [
        "Während der Anmeldung bei Google setzt ServiceOS im Browser der verbindenden Person zwei verschlüsselte, nur für den Server lesbare Cookies (httpOnly): eines zum Schutz der Anmeldung (Sicherheitswert „state“ und PKCE-Prüfwert, höchstens 10 Minuten gültig) und eines für die anschließende Kalenderauswahl (höchstens 30 Minuten gültig).",
      ],
    },
    {
      heading: "Zweck der Verarbeitung",
      paragraphs: [
        "Die Daten werden ausschließlich verwendet, um Doppelbuchungen zu vermeiden: Zeiten, zu denen die Person laut Google Kalender belegt ist, werden in der Online-Buchung und im Terminkalender des Unternehmens für diese Person nicht als frei angeboten. Andere Mitarbeitende sind davon nicht betroffen.",
        "Kundinnen und Kunden sehen nur, dass eine Zeit nicht verfügbar ist. Inhaber und Administratoren des Unternehmens sehen den Verbindungsstatus, die Anzahl der berücksichtigten Kalender, den Zeitpunkt der letzten Prüfung sowie eine Liste von ServiceOS-Terminen, die sich mit belegten Zeiten überschneiden. Sie sehen keine Kalenderinhalte, Kalendernamen, Kalenderkennungen oder Token.",
        "Kann Google nicht erreicht werden, verwendet ServiceOS den Zwischenspeicher höchstens 15 Minuten weiter; danach wird die betroffene Person bis zur nächsten erfolgreichen Prüfung nicht für Online-Buchungen angeboten. Termine in ServiceOS werden aufgrund von Google-Daten nie automatisch geändert oder storniert.",
      ],
    },
    {
      heading: "Google API Services User Data Policy",
      paragraphs: [
        "Die Nutzung und Übertragung von Informationen, die ServiceOS über Google-APIs erhält, erfolgt gemäß der Google API Services User Data Policy, einschließlich der Anforderungen zur eingeschränkten Nutzung (Limited Use). Die Daten werden nur für die oben beschriebene Verfügbarkeitsprüfung verwendet, nicht für Werbung, nicht verkauft und nicht zum Training von KI-Modellen genutzt. (Zusage des Betreibers — Needs legal review.)",
      ],
    },
    {
      heading: "Trennen der Verbindung und Löschung",
      items: [
        "Trennen in ServiceOS: Inhaber oder Administratoren des Unternehmens (bzw. die Person selbst, wenn ihr Benutzerkonto mit dem Mitarbeiterprofil verknüpft ist) können die Verbindung unter Einstellungen → Google Kalender trennen. Die verbindende Person kann die Verbindung außerdem direkt nach der Kalenderauswahl auf derselben Seite trennen (innerhalb von 30 Minuten). Beim Trennen werden der Verbindungsdatensatz mit verschlüsseltem Token, Kalenderkennungen, Status und Zwischenspeicher sofort aus der Datenbank gelöscht, und ServiceOS fordert Google auf, die Berechtigung zu widerrufen.",
        "Widerruf bei Google: Die Person kann den Zugriff jederzeit in ihrem Google-Konto widerrufen (Sicherheit → Verbindungen zu Drittanbieter-Apps und -Diensten). ServiceOS erkennt dies bei der nächsten Abfrage, löscht dann Token und Zwischenspeicher und zeigt den Status „Zugriff entzogen“. Status und Kalenderkennungen bleiben bis zum Trennen in ServiceOS gespeichert.",
        "Löschen des Mitarbeiterprofils oder des Unternehmens in ServiceOS löscht die zugehörige Verbindung automatisch. Das bloße Deaktivieren eines Mitarbeiterprofils löscht sie nicht.",
        "Datensätze zu Verbindungslinks werden derzeit nicht automatisch gelöscht; abgelaufene Links sind nicht mehr verwendbar (Löschfrist: Needs legal review).",
      ],
    },
  ],
  reviewTitle: "Offene Punkte für die rechtliche Prüfung (Needs legal review)",
  reviewNotes: [
    "Rechtsgrundlage der Verarbeitung (z. B. Einwilligung, Beschäftigtendatenschutz nach § 26 BDSG, berechtigtes Interesse) — nicht festgelegt.",
    "Rollen: Verantwortlicher (Unternehmen als Arbeitgeber und/oder Betreiber von ServiceOS) und Auftragsverarbeitung — nicht festgelegt.",
    "Freiwilligkeit im Beschäftigungsverhältnis und Information der Mitarbeitenden vor dem Verbinden.",
    "Speicherort und Auftragsverarbeitungsvertrag des Produktivsystems (das aktuelle Entwicklungssystem liegt in der Supabase-Region eu-central-1, Frankfurt) sowie Hosting (Vercel).",
    "Datenübermittlung an Google (Google Ireland Limited / Google LLC) bei den API-Abfragen und mögliche Drittlandübermittlung.",
    "Aufbewahrung in Datensicherungen (Backups) und Server-Protokollen.",
    "Löschfrist für Datensätze zu Verbindungslinks.",
    "Löschfrist für den Zwischenspeicher, wenn längere Zeit keine Abfrage stattfindet, und für Verbindungen deaktivierter Mitarbeiterprofile.",
    "Formulierung der Limited-Use-Zusage und deren organisatorische Absicherung.",
  ],
  policyLinkLabel: "Google API Services User Data Policy",
};

const en: GoogleCalendarPrivacyText = {
  title: "Google Calendar integration",
  draftNote:
    "Draft for legal review. This section describes the technical implementation and has not been legally approved yet (Needs legal review).",
  blocks: [
    {
      heading: "Voluntary connection by the staff member",
      paragraphs: [
        "Businesses using ServiceOS can match online booking against Google Calendar. The connection is made by each staff member personally, not by the business: the business creates a personal connect link (single use, valid for 72 hours). The person opens it, signs in directly at Google with their own Google account and grants the permission there. ServiceOS never receives the Google password or access to the Google account as a whole.",
        "Before redirecting to Google, ServiceOS shows which data is requested and what it is used for.",
      ],
    },
    {
      heading: "Requested permissions",
      items: [
        "Free/busy information of the selected calendars (Google scope “calendar.freebusy”): only the start and end of busy periods.",
        "List of the person's calendars (Google scope “calendar.calendarlist.readonly”): ID, name and the main-calendar flag, so the person can choose which calendars count.",
      ],
      after: [
        "ServiceOS does not request access to the content of events: no titles, descriptions, participants, locations, attachments or video-call links. ServiceOS cannot create, change or delete anything in Google Calendar and requests neither the e-mail address nor the profile of the Google account.",
      ],
    },
    {
      heading: "Data stored by ServiceOS",
      paragraphs: ["The ServiceOS database (Supabase, PostgreSQL) stores for each connected person:"],
      items: [
        "the link to the business and to the staff profile;",
        "the IDs of the selected calendars (at most 10). At Google, the ID of the main calendar is usually the e-mail address of the Google account;",
        "an OAuth refresh token, encrypted (AES-256-GCM); the key is not stored in the database. Short-lived access tokens are only held in memory during a request and are not stored;",
        "the connection status (“connected”, “sync error”, “access withdrawn”), when it was connected, the time of the last successful check, and code and time of the last error;",
        "a cache of busy periods — start and end only — from one day in the past to about six months (183 days) ahead. It is replaced by a new request to Google when needed, at most every five minutes; older periods are dropped then. If no new request happens, the last fetched state stays stored until the next request or until disconnecting; there is currently no scheduled automatic deletion (Needs legal review). The 183 days follow from the maximum booking horizon and are not a defined retention period;",
        "for the connect link: only a check value (SHA-256 hash) of the link, the business, the staff profile, expiry, time of use and the user account that created the link.",
      ],
    },
    {
      heading: "Data ServiceOS does not store",
      items: [
        "Calendar names: they are read live from Google only during the selection and shown to the connecting person.",
        "Event content (title, description, participants, location).",
        "Google passwords.",
      ],
    },
    {
      heading: "Technically necessary cookies while connecting",
      paragraphs: [
        "While signing in at Google, ServiceOS sets two encrypted cookies in the connecting person's browser that only the server can read (httpOnly): one protecting the sign-in (security value “state” and PKCE check value, valid for at most 10 minutes) and one for the following calendar selection (valid for at most 30 minutes).",
      ],
    },
    {
      heading: "Purpose",
      paragraphs: [
        "The data is used solely to prevent double bookings: times at which the person is busy according to Google Calendar are not offered as free for this person in online booking and in the business's calendar. Other staff members are not affected.",
        "Clients only see that a time is not available. Owners and administrators of the business see the connection status, the number of calendars counted, the time of the last check and a list of ServiceOS appointments that overlap busy times. They see no calendar content, calendar names, calendar IDs or tokens.",
        "If Google cannot be reached, ServiceOS keeps using the cache for at most 15 minutes; after that the person is not offered for online booking until the next successful check. ServiceOS never changes or cancels appointments automatically because of Google data.",
      ],
    },
    {
      heading: "Google API Services User Data Policy",
      paragraphs: [
        "ServiceOS's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. The data is used only for the availability check described above, not for advertising, not sold and not used to train AI models. (Operator commitment — Needs legal review.)",
      ],
    },
    {
      heading: "Disconnecting and deletion",
      items: [
        "Disconnecting in ServiceOS: owners or administrators of the business (or the person themselves, if their user account is linked to the staff profile) can disconnect under Settings → Google Calendar. The connecting person can also disconnect right after choosing calendars on the same page (within 30 minutes). Disconnecting immediately deletes the connection record with the encrypted token, calendar IDs, status and cache from the database, and ServiceOS asks Google to revoke the permission.",
        "Revoking at Google: the person can withdraw access at any time in their Google account (Security → Third-party apps and services). ServiceOS notices this at the next request, then deletes the token and the cache and shows “access withdrawn”. Status and calendar IDs remain stored until disconnected in ServiceOS.",
        "Deleting the staff profile or the business in ServiceOS deletes the connection automatically. Merely deactivating a staff profile does not.",
        "Connect-link records are currently not deleted automatically; expired links can no longer be used (retention period: Needs legal review).",
      ],
    },
  ],
  reviewTitle: "Open points for legal review (Needs legal review)",
  reviewNotes: [
    "Legal basis of the processing (e.g. consent, employee data protection under § 26 BDSG, legitimate interest) — not decided.",
    "Roles: controller (business as employer and/or the operator of ServiceOS) and data processing on behalf — not decided.",
    "Voluntariness in the employment relationship and informing staff before they connect.",
    "Storage location and data processing agreement of the production system (the current development system is in Supabase region eu-central-1, Frankfurt) and hosting (Vercel).",
    "Data exchange with Google (Google Ireland Limited / Google LLC) during API requests and possible third-country transfer.",
    "Retention in backups and server logs.",
    "Retention period for connect-link records.",
    "Retention of the cache when no request happens for a long time, and of connections of deactivated staff profiles.",
    "Wording of the Limited Use commitment and how it is ensured organisationally.",
  ],
  policyLinkLabel: "Google API Services User Data Policy",
};

const uk: GoogleCalendarPrivacyText = {
  title: "Інтеграція з Google Календарем",
  draftNote:
    "Чернетка для юридичної перевірки. Розділ описує технічну реалізацію і ще не затверджений юридично (Needs legal review).",
  blocks: [
    {
      heading: "Добровільне підключення співробітником",
      paragraphs: [
        "Бізнеси, що користуються ServiceOS, можуть звіряти онлайн-запис із Google Календарем. Підключення виконує кожен співробітник особисто, а не бізнес: бізнес створює персональне посилання (одноразове, дійсне 72 години). Людина відкриває його, входить безпосередньо в Google зі своїм власним обліковим записом і надає дозвіл там. ServiceOS не отримує ні пароля Google, ні доступу до облікового запису Google загалом.",
        "Перед переходом до Google ServiceOS показує, які дані запитуються і для чого вони використовуються.",
      ],
    },
    {
      heading: "Запитувані дозволи",
      items: [
        "Інформація «вільний/зайнятий» вибраних календарів (дозвіл Google «calendar.freebusy»): лише початок і кінець зайнятих проміжків.",
        "Список власних календарів (дозвіл Google «calendar.calendarlist.readonly»): ідентифікатор, назва й позначка основного календаря, щоб людина могла вибрати, які календарі враховувати.",
      ],
      after: [
        "ServiceOS не запитує доступу до змісту подій: жодних назв, описів, учасників, місць, вкладень чи посилань на відеозустрічі. ServiceOS не може нічого створювати, змінювати чи видаляти в Google Календарі й не запитує ні адреси електронної пошти, ні профілю облікового запису Google.",
      ],
    },
    {
      heading: "Які дані зберігає ServiceOS",
      paragraphs: ["У базі даних ServiceOS (Supabase, PostgreSQL) для кожної підключеної людини зберігаються:"],
      items: [
        "прив’язка до бізнесу та профілю співробітника;",
        "ідентифікатори вибраних календарів (не більше 10). Ідентифікатор основного календаря в Google зазвичай збігається з адресою електронної пошти облікового запису Google;",
        "OAuth-токен оновлення (refresh token) у зашифрованому вигляді (AES-256-GCM); ключ не зберігається в базі даних. Короткочасні токени доступу використовуються лише в пам’яті під час запиту й не зберігаються;",
        "статус підключення («підключено», «помилка синхронізації», «доступ відкликано»), час підключення, час останньої успішної перевірки, а також код і час останньої помилки;",
        "кеш зайнятих проміжків — лише початок і кінець — від одного дня в минулому до приблизно шести місяців (183 дні) наперед. За потреби, не частіше ніж раз на п’ять хвилин, він замінюється новим запитом до Google; старіші проміжки при цьому зникають. Якщо нового запиту немає, останній отриманий стан зберігається до наступного запиту або до відключення; автоматичного видалення за розкладом наразі немає (Needs legal review). 183 дні випливають із максимального періоду бронювання і не є визначеним строком зберігання;",
        "для посилання на підключення: лише контрольне значення (SHA-256-хеш) посилання, бізнес, профіль співробітника, час закінчення дії, час використання та обліковий запис, який створив посилання.",
      ],
    },
    {
      heading: "Що ServiceOS не зберігає",
      items: [
        "Назви календарів: їх запитують у Google лише під час вибору й показують людині, яка підключається.",
        "Зміст подій (назва, опис, учасники, місце).",
        "Паролі Google.",
      ],
    },
    {
      heading: "Технічно необхідні cookie під час підключення",
      paragraphs: [
        "Під час входу в Google ServiceOS встановлює в браузері людини, яка підключається, два зашифровані cookie, які може прочитати лише сервер (httpOnly): один для захисту входу (захисне значення «state» і контрольне значення PKCE, дійсний не довше 10 хвилин) і один для подальшого вибору календарів (дійсний не довше 30 хвилин).",
      ],
    },
    {
      heading: "Мета обробки",
      paragraphs: [
        "Дані використовуються виключно для запобігання подвійним записам: час, коли людина за Google Календарем зайнята, не пропонується для неї як вільний в онлайн-записі та в календарі бізнесу. Інших співробітників це не стосується.",
        "Клієнти бачать лише, що час недоступний. Власники й адміністратори бізнесу бачать статус підключення, кількість врахованих календарів, час останньої перевірки та список записів ServiceOS, які перетинаються із зайнятим часом. Вони не бачать змісту календарів, назв, ідентифікаторів календарів чи токенів.",
        "Якщо Google недоступний, ServiceOS використовує кеш не довше 15 хвилин; після цього людина не пропонується для онлайн-запису до наступної успішної перевірки. ServiceOS ніколи автоматично не змінює й не скасовує записи через дані Google.",
      ],
    },
    {
      heading: "Google API Services User Data Policy",
      paragraphs: [
        "Використання та передача інформації, отриманої ServiceOS через Google API, відповідають Google API Services User Data Policy, зокрема вимогам щодо обмеженого використання (Limited Use). Дані використовуються лише для описаної вище перевірки доступності, не для реклами, не продаються й не використовуються для навчання моделей ШІ. (Зобов’язання оператора — Needs legal review.)",
      ],
    },
    {
      heading: "Відключення та видалення",
      items: [
        "Відключення в ServiceOS: власники чи адміністратори бізнесу (або сама людина, якщо її обліковий запис пов’язаний із профілем співробітника) можуть відключити інтеграцію в розділі Налаштування → Google Календар. Людина, яка підключається, також може відключити її одразу після вибору календарів на тій самій сторінці (протягом 30 хвилин). Під час відключення запис підключення із зашифрованим токеном, ідентифікаторами календарів, статусом і кешем одразу видаляється з бази даних, а ServiceOS просить Google відкликати дозвіл.",
        "Відкликання в Google: людина будь-коли може відкликати доступ у своєму обліковому записі Google (Безпека → Сторонні застосунки та сервіси). ServiceOS помічає це під час наступного запиту, видаляє токен і кеш та показує статус «доступ відкликано». Статус та ідентифікатори календарів зберігаються до відключення в ServiceOS.",
        "Видалення профілю співробітника або бізнесу в ServiceOS автоматично видаляє підключення. Просте деактивування профілю співробітника його не видаляє.",
        "Записи про посилання на підключення наразі не видаляються автоматично; прострочені посилання більше не працюють (строк зберігання: Needs legal review).",
      ],
    },
  ],
  reviewTitle: "Відкриті питання для юридичної перевірки (Needs legal review)",
  reviewNotes: [
    "Правова підстава обробки (наприклад, згода, захист даних працівників за § 26 BDSG, законний інтерес) — не визначена.",
    "Ролі: контролер (бізнес як роботодавець і/або оператор ServiceOS) та обробка за дорученням — не визначені.",
    "Добровільність у трудових відносинах та інформування співробітників перед підключенням.",
    "Місце зберігання й договір про обробку даних для робочої системи (поточна система розробки розташована в регіоні Supabase eu-central-1, Франкфурт) та хостинг (Vercel).",
    "Обмін даними з Google (Google Ireland Limited / Google LLC) під час API-запитів і можлива передача до третіх країн.",
    "Зберігання в резервних копіях і серверних журналах.",
    "Строк зберігання записів про посилання на підключення.",
    "Строк зберігання кешу, якщо тривалий час немає запитів, і підключень деактивованих профілів співробітників.",
    "Формулювання зобов’язання Limited Use та його організаційне забезпечення.",
  ],
  policyLinkLabel: "Google API Services User Data Policy",
};

const ru: GoogleCalendarPrivacyText = {
  title: "Интеграция с Google Календарём",
  draftNote:
    "Черновик для юридической проверки. Раздел описывает техническую реализацию и ещё не утверждён юридически (Needs legal review).",
  blocks: [
    {
      heading: "Добровольное подключение сотрудником",
      paragraphs: [
        "Бизнесы, использующие ServiceOS, могут сверять онлайн-запись с Google Календарём. Подключение выполняет каждый сотрудник лично, а не бизнес: бизнес создаёт персональную ссылку (одноразовую, действующую 72 часа). Человек открывает её, входит непосредственно в Google со своим собственным аккаунтом и выдаёт разрешение там. ServiceOS не получает ни пароля Google, ни доступа к аккаунту Google в целом.",
        "Перед переходом в Google ServiceOS показывает, какие данные запрашиваются и для чего они используются.",
      ],
    },
    {
      heading: "Запрашиваемые разрешения",
      items: [
        "Информация «свободен/занят» по выбранным календарям (разрешение Google «calendar.freebusy»): только начало и конец занятых промежутков.",
        "Список собственных календарей (разрешение Google «calendar.calendarlist.readonly»): идентификатор, название и отметка основного календаря, чтобы человек мог выбрать, какие календари учитывать.",
      ],
      after: [
        "ServiceOS не запрашивает доступ к содержанию событий: никаких названий, описаний, участников, мест, вложений или ссылок на видеовстречи. ServiceOS не может ничего создавать, изменять или удалять в Google Календаре и не запрашивает ни адрес электронной почты, ни профиль аккаунта Google.",
      ],
    },
    {
      heading: "Какие данные хранит ServiceOS",
      paragraphs: ["В базе данных ServiceOS (Supabase, PostgreSQL) для каждого подключённого человека хранятся:"],
      items: [
        "привязка к бизнесу и профилю сотрудника;",
        "идентификаторы выбранных календарей (не более 10). Идентификатор основного календаря в Google обычно совпадает с адресом электронной почты аккаунта Google;",
        "OAuth-токен обновления (refresh token) в зашифрованном виде (AES-256-GCM); ключ не хранится в базе данных. Краткосрочные токены доступа используются только в памяти во время запроса и не сохраняются;",
        "статус подключения («подключено», «ошибка синхронизации», «доступ отозван»), время подключения, время последней успешной проверки, а также код и время последней ошибки;",
        "кеш занятых промежутков — только начало и конец — от одного дня в прошлом до примерно шести месяцев (183 дня) вперёд. При необходимости, не чаще чем раз в пять минут, он заменяется новым запросом к Google; более старые промежутки при этом удаляются. Если нового запроса нет, последнее полученное состояние хранится до следующего запроса или до отключения; автоматического удаления по расписанию сейчас нет (Needs legal review). 183 дня следуют из максимального периода записи и не являются установленным сроком хранения;",
        "для ссылки на подключение: только контрольное значение (SHA-256-хеш) ссылки, бизнес, профиль сотрудника, срок действия, время использования и аккаунт, создавший ссылку.",
      ],
    },
    {
      heading: "Что ServiceOS не хранит",
      items: [
        "Названия календарей: их запрашивают у Google только во время выбора и показывают подключающемуся человеку.",
        "Содержание событий (название, описание, участники, место).",
        "Пароли Google.",
      ],
    },
    {
      heading: "Технически необходимые cookie во время подключения",
      paragraphs: [
        "Во время входа в Google ServiceOS устанавливает в браузере подключающегося человека два зашифрованных cookie, которые может прочитать только сервер (httpOnly): один для защиты входа (защитное значение «state» и контрольное значение PKCE, действует не дольше 10 минут) и один для последующего выбора календарей (действует не дольше 30 минут).",
      ],
    },
    {
      heading: "Цель обработки",
      paragraphs: [
        "Данные используются исключительно для предотвращения двойных записей: время, когда человек по Google Календарю занят, не предлагается для него как свободное в онлайн-записи и в календаре бизнеса. Других сотрудников это не затрагивает.",
        "Клиенты видят только, что время недоступно. Владельцы и администраторы бизнеса видят статус подключения, количество учитываемых календарей, время последней проверки и список записей ServiceOS, пересекающихся с занятым временем. Они не видят содержания календарей, названий, идентификаторов календарей или токенов.",
        "Если Google недоступен, ServiceOS использует кеш не дольше 15 минут; после этого человек не предлагается для онлайн-записи до следующей успешной проверки. ServiceOS никогда автоматически не изменяет и не отменяет записи из-за данных Google.",
      ],
    },
    {
      heading: "Google API Services User Data Policy",
      paragraphs: [
        "Использование и передача информации, полученной ServiceOS через Google API, соответствуют Google API Services User Data Policy, включая требования об ограниченном использовании (Limited Use). Данные используются только для описанной выше проверки доступности, не для рекламы, не продаются и не используются для обучения моделей ИИ. (Обязательство оператора — Needs legal review.)",
      ],
    },
    {
      heading: "Отключение и удаление",
      items: [
        "Отключение в ServiceOS: владельцы или администраторы бизнеса (или сам человек, если его аккаунт связан с профилем сотрудника) могут отключить интеграцию в разделе Настройки → Google Календарь. Подключающийся человек также может отключить её сразу после выбора календарей на той же странице (в течение 30 минут). При отключении запись подключения с зашифрованным токеном, идентификаторами календарей, статусом и кешем сразу удаляется из базы данных, а ServiceOS просит Google отозвать разрешение.",
        "Отзыв в Google: человек в любой момент может отозвать доступ в своём аккаунте Google (Безопасность → Сторонние приложения и сервисы). ServiceOS замечает это при следующем запросе, удаляет токен и кеш и показывает статус «доступ отозван». Статус и идентификаторы календарей хранятся до отключения в ServiceOS.",
        "Удаление профиля сотрудника или бизнеса в ServiceOS автоматически удаляет подключение. Простая деактивация профиля сотрудника его не удаляет.",
        "Записи о ссылках на подключение сейчас не удаляются автоматически; просроченные ссылки больше не работают (срок хранения: Needs legal review).",
      ],
    },
  ],
  reviewTitle: "Открытые вопросы для юридической проверки (Needs legal review)",
  reviewNotes: [
    "Правовое основание обработки (например, согласие, защита данных работников по § 26 BDSG, законный интерес) — не определено.",
    "Роли: ответственный (бизнес как работодатель и/или оператор ServiceOS) и обработка по поручению — не определены.",
    "Добровольность в трудовых отношениях и информирование сотрудников перед подключением.",
    "Место хранения и договор об обработке данных для рабочей системы (текущая система разработки находится в регионе Supabase eu-central-1, Франкфурт) и хостинг (Vercel).",
    "Обмен данными с Google (Google Ireland Limited / Google LLC) при API-запросах и возможная передача в третьи страны.",
    "Хранение в резервных копиях и серверных журналах.",
    "Срок хранения записей о ссылках на подключение.",
    "Срок хранения кеша, если долго нет запросов, и подключений деактивированных профилей сотрудников.",
    "Формулировка обязательства Limited Use и его организационное обеспечение.",
  ],
  policyLinkLabel: "Google API Services User Data Policy",
};

export const googleCalendarPrivacy: Record<Locale, GoogleCalendarPrivacyText> = { de, en, uk, ru };
