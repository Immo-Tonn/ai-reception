import type { Locale } from "@/lib/i18n";

/**
 * Datenschutzerklärung — section "Google Kalender-Integration" (DRAFT).
 *
 * Every factual statement is taken from the implementation
 * (docs/EXTERNAL_CALENDAR.md, docs/DATA_RETENTION.md, docs/BACKUP_RECOVERY.md,
 * migrations 0025/0026, src/server/externalCalendar/*). Anything the code
 * cannot prove — legal bases, controller/processor roles, data processing
 * agreements, third-country transfers, backup retention — is NOT asserted and
 * is listed in `reviewNotes` ("Needs legal review"). Retention periods are
 * provisional until legal review. NOT legally approved: `datenschutzApproved`
 * stays false.
 */

export const GOOGLE_CALENDAR_SECTION_ID = "google-kalender";

export const GOOGLE_API_USER_DATA_POLICY_URL = "https://developers.google.com/terms/api-services-user-data-policy";

/**
 * false while the Google Calendar integration is not deployed/enabled for
 * production users (no Google credentials in production yet). The page then
 * says so instead of describing it as a live feature. Flip only together with
 * the production launch of the integration.
 */
export const googleCalendarIntegrationLive = false;

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
  /** Shown while `googleCalendarIntegrationLive` is false. */
  notLiveNote: string;
  blocks: PrivacyBlock[];
  /** Shown as "Needs legal review" — open points that must not be presented as facts. */
  reviewTitle: string;
  reviewNotes: string[];
  policyLinkLabel: string;
}

const de: GoogleCalendarPrivacyText = {
  title: "Google Kalender-Integration",
  draftNote:
    "Entwurf zur rechtlichen Prüfung. Dieser Abschnitt beschreibt die technische Umsetzung und ist noch nicht rechtlich freigegeben (Needs legal review). Alle genannten Speicherfristen sind vorläufig.",
  notLiveNote:
    "Hinweis: Die Google Kalender-Integration ist für Nutzerinnen und Nutzer der Produktivumgebung noch nicht freigeschaltet. Der Abschnitt beschreibt die vorbereitete Funktion.",
  blocks: [
    {
      heading: "Freiwillige Verbindung durch die Mitarbeiterin bzw. den Mitarbeiter",
      paragraphs: [
        "Unternehmen, die ServiceOS nutzen, können die Online-Terminbuchung mit Google Kalender abgleichen. Die Verbindung stellt die jeweilige Mitarbeiterin bzw. der jeweilige Mitarbeiter selbst her: Das Unternehmen erstellt einen persönlichen Verbindungslink (einmal verwendbar, 72 Stunden gültig). Die Person öffnet ihn, meldet sich direkt bei Google mit dem eigenen Google-Konto an und erteilt dort die Berechtigung. ServiceOS erhält weder das Google-Passwort noch Zugriff auf das Google-Konto als Ganzes.",
        "Vor der Weiterleitung zu Google zeigt ServiceOS an, welche Berechtigungen angefragt werden, welche Daten gespeichert werden, wofür sie verwendet werden und wie die Verbindung beendet werden kann.",
      ],
    },
    {
      heading: "Angefragte Berechtigungen (Google OAuth 2.0)",
      items: [
        "Frei/Belegt-Informationen der ausgewählten Kalender (Google-Berechtigung „calendar.freebusy“): nur Beginn und Ende belegter Zeiträume.",
        "Liste der eigenen Kalender (Google-Berechtigung „calendar.calendarlist.readonly“): Kennung, Name und Kennzeichnung des Hauptkalenders, damit die Person auswählen kann, welche Kalender berücksichtigt werden.",
        "OpenID Connect (Google-Berechtigung „openid“): Google bestätigt mit einem signierten Identitätsnachweis (ID-Token), welches Google-Konto verbunden wurde. ServiceOS wertet daraus ausschließlich die dauerhafte Kontokennung („sub“) aus und prüft Signatur, Aussteller, Empfänger, Gültigkeit und einen Einmalwert (Nonce).",
      ],
      after: [
        "ServiceOS fragt keinen Zugriff auf Inhalte von Terminen an: keine Titel, Beschreibungen, Teilnehmenden, Orte, Anhänge oder Videokonferenz-Links. ServiceOS kann im Google Kalender nichts erstellen, ändern oder löschen und fragt weder die E-Mail-Adresse („email“) noch das Profil („profile“) des Google-Kontos an.",
        "Für die Verwaltungsseite (siehe „Trennen der Verbindung“) meldet sich die Person nur mit der Berechtigung „openid“ an; dabei erhält ServiceOS keinen Kalenderzugriff und kein dauerhaftes Token.",
      ],
    },
    {
      heading: "Welche Daten ServiceOS speichert",
      paragraphs: ["In der Datenbank von ServiceOS (Supabase, PostgreSQL) werden je verbundener Person gespeichert:"],
      items: [
        "die Zuordnung zum Unternehmen und zum Mitarbeiterprofil;",
        "die Kennungen der ausgewählten Kalender (höchstens 10). Die Kennung des Hauptkalenders entspricht bei Google in der Regel der E-Mail-Adresse des Google-Kontos;",
        "ein OAuth-Aktualisierungstoken (Refresh Token), verschlüsselt (AES-256-GCM); der Schlüssel liegt nicht in der Datenbank. Kurzlebige Zugriffstoken werden nur während einer Anfrage im Arbeitsspeicher verwendet und nicht gespeichert;",
        "eine pseudonymisierte Kontokennung: ein HMAC-SHA256-Wert der Google-Kontokennung („sub“), berechnet mit einem geheimen Serverschlüssel. Die Kontokennung selbst wird nicht gespeichert. Der Wert dient dazu, dass die Person auf der Verwaltungsseite ihre eigenen Verbindungen findet, und zur Entscheidung, ob der Google-Zugriff widerrufen werden kann;",
        "der Verbindungsstatus („verbunden“, „Synchronisierungsfehler“, „Zugriff entzogen“), der Zeitpunkt der Verbindung, der letzten erfolgreichen Prüfung sowie Code und Zeitpunkt des letzten Fehlers;",
        "ein Zwischenspeicher (Cache) der belegten Zeiträume — nur Beginn und Ende — für den Zeitraum von einem Tag in der Vergangenheit bis etwa sechs Monate (183 Tage) in der Zukunft. Die 183 Tage ergeben sich aus dem maximalen Buchungszeitraum und sind keine Speicherfrist;",
        "zum Verbindungslink: nur ein Prüfwert (SHA-256-Hash) des Links, Unternehmen, Mitarbeiterprofil, Ablaufzeitpunkt, Zeitpunkt der Verwendung und das Benutzerkonto, das den Link erstellt hat.",
      ],
    },
    {
      heading: "Was ServiceOS nicht speichert",
      items: [
        "Kalendernamen: Sie werden nur während der Auswahl live bei Google abgefragt und der verbindenden Person angezeigt.",
        "Inhalte von Terminen (Titel, Beschreibung, Teilnehmende, Ort).",
        "Google-Passwörter, Zugriffstoken, die unverschlüsselte Google-Kontokennung und — abgesehen von einer Kalenderkennung, die einer E-Mail-Adresse entsprechen kann — die E-Mail-Adresse.",
      ],
    },
    {
      heading: "Technisch notwendige Cookies",
      paragraphs: [
        "ServiceOS setzt im Browser der Person ausschließlich verschlüsselte, nur für den Server lesbare Cookies (httpOnly): während der Anmeldung bei Google eines mit Sicherheitswert („state“), PKCE-Prüfwert und Einmalwert (Nonce), höchstens 10 Minuten gültig; danach eines für die Kalenderauswahl (höchstens 30 Minuten) bzw. für die Verwaltungsseite (höchstens 15 Minuten).",
      ],
    },
    {
      heading: "Zweck der Verarbeitung",
      paragraphs: [
        "Die Daten werden ausschließlich verwendet, um Doppelbuchungen zu vermeiden: Zeiten, zu denen die Person laut Google Kalender belegt ist, werden in der Online-Buchung und im Terminkalender des Unternehmens für diese Person nicht als frei angeboten. Andere Mitarbeitende sind davon nicht betroffen.",
        "Kundinnen und Kunden sehen nur, dass eine Zeit nicht verfügbar ist. Inhaber und Administratoren des Unternehmens sehen den Verbindungsstatus, die Anzahl der berücksichtigten Kalender, den Zeitpunkt der letzten Prüfung sowie eine Liste von ServiceOS-Terminen, die sich mit belegten Zeiten überschneiden. Sie sehen keine Kalenderinhalte, Kalendernamen, Kalenderkennungen, Kontokennungen oder Token.",
      ],
    },
    {
      heading: "Aktualität des Zwischenspeichers und Verhalten bei Störungen",
      items: [
        "Belegte Zeiten werden bei Bedarf, frühestens nach fünf Minuten, neu bei Google abgefragt; vor dem Speichern eines Termins werden höchstens 60 Sekunden alte Daten verwendet.",
        "Kann Google nicht erreicht werden, verwendet ServiceOS den Zwischenspeicher höchstens 15 Minuten weiter. Danach wird die betroffene Person bis zur nächsten erfolgreichen Prüfung nicht für Buchungen angeboten. Eine fehlende Antwort von Google wird nie als „frei“ gewertet.",
        "Ein Zwischenspeicher, der 24 Stunden lang nicht aktualisiert wurde, wird automatisch geleert (tägliche Bereinigung; die Löschung kann daher bis zu einem Tag später erfolgen).",
        "Termine in ServiceOS werden aufgrund von Google-Daten nie automatisch geändert oder storniert.",
      ],
    },
    {
      heading: "Trennen der Verbindung",
      items: [
        "Durch das Unternehmen: Inhaber oder Administratoren (bzw. die Person selbst, wenn ihr Benutzerkonto mit dem Mitarbeiterprofil verknüpft ist) können die Verbindung unter Einstellungen → Google Kalender trennen.",
        "Durch die Person selbst, jederzeit: auf der Seite /connect-calendar/manage nach Anmeldung mit Google. Dort werden alle ServiceOS-Verbindungen dieses Google-Kontos angezeigt, auch bei verschiedenen Unternehmen; jede kann einzeln oder alle gemeinsam getrennt werden. Direkt nach der Kalenderauswahl ist das Trennen auch auf derselben Seite möglich.",
        "Beim Trennen wird der Verbindungsdatensatz (verschlüsseltes Token, Kalenderkennungen, pseudonymisierte Kontokennung, Status und Zwischenspeicher) sofort aus der Datenbank gelöscht. Danach plant das Unternehmen für diese Person wieder nur mit den hinterlegten Arbeitszeiten.",
        "Google widerruft den Zugriff technisch immer für alle Verbindungen eines Google-Kontos mit ServiceOS gleichzeitig. ServiceOS fordert den Widerruf bei Google deshalb erst an, wenn die letzte ServiceOS-Verbindung dieses Kontos getrennt wird. Solange das Konto noch bei einem anderen Unternehmen verbunden ist, bleibt der Google-Zugriff für diese Verbindung bestehen.",
      ],
    },
    {
      heading: "Widerruf direkt bei Google",
      paragraphs: [
        "Die Person kann den Zugriff jederzeit in ihrem Google-Konto widerrufen (Sicherheit → Verbindungen zu Drittanbieter-Apps und -Diensten). Das betrifft alle ServiceOS-Verbindungen dieses Kontos. ServiceOS erkennt den Widerruf bei der nächsten Abfrage und löscht dann Token, Kalenderkennungen und Zwischenspeicher.",
        "Gespeichert bleibt nur ein minimaler technischer Status: Zuordnung zu Unternehmen und Mitarbeiterprofil, Status „Zugriff entzogen“, Zeitpunkt und Fehlercode sowie die pseudonymisierte Kontokennung. Solange dieser Status besteht, wird die Person nicht für Buchungen angeboten, weil ihre belegten Zeiten nicht mehr bekannt sind. Der Status wird nicht automatisch gelöscht; er endet, wenn das Unternehmen oder die Person selbst (Verwaltungsseite) die Verbindung trennt oder die Person neu verbindet.",
      ],
    },
    {
      heading: "Deaktivierung und Löschung von Mitarbeiterprofilen",
      items: [
        "Wird ein Mitarbeiterprofil deaktiviert, entfernt ServiceOS die Google Kalender-Verbindung sofort (wie beim Trennen). Gelingt dies nicht sofort, holt die tägliche Bereinigung es nach.",
        "Wird ein Mitarbeiterprofil oder das Unternehmen gelöscht, wird die Verbindung automatisch mitgelöscht.",
      ],
    },
    {
      heading: "Verbindungslinks",
      paragraphs: [
        "Ein Verbindungslink ist 72 Stunden gültig und nur einmal verwendbar; ein neuer Link für dieselbe Person macht ältere, nicht verwendete Links ungültig. Datensätze zu Links werden automatisch gelöscht: 30 Tage nach der Verwendung bzw. 30 Tage nach Ablauf eines nicht verwendeten Links (tägliche Bereinigung).",
      ],
    },
    {
      heading: "Datensicherungen",
      paragraphs: [
        "Im aktuellen Tarif des Datenbankanbieters werden keine automatischen Datensicherungen erstellt. Der Betreiber erstellt bei Bedarf manuelle, verschlüsselte Sicherungen. Daten, die in ServiceOS gelöscht wurden, können in solchen Sicherungen bis zu deren Löschung enthalten bleiben; eine sofortige Löschung aus allen Sicherungen ist nicht möglich. Die Aufbewahrungsdauer von Sicherungen ist noch nicht festgelegt (Needs legal review). Werden künftig automatische Sicherungen des Anbieters genutzt, bleiben gelöschte Daten bis zum Ablauf der jeweiligen Sicherungsfrist darin enthalten.",
      ],
    },
    {
      heading: "Google API Services User Data Policy",
      paragraphs: [
        "Die Nutzung und Übertragung von Informationen, die ServiceOS über Google-APIs erhält, erfolgt gemäß der Google API Services User Data Policy, einschließlich der Anforderungen zur eingeschränkten Nutzung (Limited Use). Die Daten werden nur für die oben beschriebene Verfügbarkeitsprüfung verwendet, nicht für Werbung, nicht verkauft und nicht zum Training von KI-Modellen genutzt. (Zusage des Betreibers — Needs legal review.)",
      ],
    },
  ],
  reviewTitle: "Offene Punkte für die rechtliche Prüfung (Needs legal review)",
  reviewNotes: [
    "Rechtsgrundlage der Verarbeitung (z. B. Einwilligung, Beschäftigtendatenschutz nach § 26 BDSG, berechtigtes Interesse) und Freiwilligkeit im Beschäftigungsverhältnis.",
    "Rollen: Verantwortlicher (Unternehmen als Arbeitgeber und/oder Betreiber von ServiceOS), gemeinsame Verantwortlichkeit oder Auftragsverarbeitung; erforderliche Verträge (Art. 26/28 DSGVO).",
    "Auftragsverarbeitungsverträge und Standorte: Supabase (Datenbank, derzeit Region eu-central-1, Frankfurt) und Vercel (Hosting). Nach technischer Kennung laufen Serverfunktionen derzeit in der Vercel-Region iad1 (USA) — Drittlandübermittlung prüfen bzw. Region ändern.",
    "Datenaustausch mit Google (Google Ireland Limited / Google LLC) bei OAuth- und API-Abfragen, Rolle von Google, mögliche Drittlandübermittlung.",
    "Endgültige Speicherfristen: Zwischenspeicher 24 Stunden, Verbindungslinks 30 Tage, Status „Zugriff entzogen“ ohne automatische Löschung.",
    "Aufbewahrung und Verschlüsselung von Datensicherungen; Server-Protokolle des Hostings.",
    "Informationspflichten gegenüber Mitarbeitenden (Art. 13 DSGVO), Verzeichnis von Verarbeitungstätigkeiten, Erforderlichkeit einer Datenschutz-Folgenabschätzung.",
    "Formulierung der Limited-Use-Zusage und deren organisatorische Absicherung (Voraussetzung der Google-Verifizierung).",
  ],
  policyLinkLabel: "Google API Services User Data Policy",
};

const en: GoogleCalendarPrivacyText = {
  title: "Google Calendar integration",
  draftNote:
    "Draft for legal review. This section describes the technical implementation and has not been legally approved yet (Needs legal review). All retention periods are provisional.",
  notLiveNote:
    "Note: the Google Calendar integration is not yet enabled for users of the production environment. This section describes the prepared feature.",
  blocks: [
    {
      heading: "Voluntary connection by the staff member",
      paragraphs: [
        "Businesses using ServiceOS can match online booking against Google Calendar. Each staff member makes the connection personally: the business creates a personal connect link (single use, valid for 72 hours). The person opens it, signs in directly at Google with their own Google account and grants the permission there. ServiceOS never receives the Google password or access to the Google account as a whole.",
        "Before redirecting to Google, ServiceOS shows which permissions are requested, which data is stored, what it is used for and how the connection can be ended.",
      ],
    },
    {
      heading: "Requested permissions (Google OAuth 2.0)",
      items: [
        "Free/busy information of the selected calendars (Google scope “calendar.freebusy”): only the start and end of busy periods.",
        "List of the person's calendars (Google scope “calendar.calendarlist.readonly”): ID, name and the main-calendar flag, so the person can choose which calendars count.",
        "OpenID Connect (Google scope “openid”): Google confirms with a signed identity token (ID token) which Google account was connected. ServiceOS reads only the permanent account identifier (“sub”) and checks signature, issuer, audience, validity and a one-time value (nonce).",
      ],
      after: [
        "ServiceOS does not request access to the content of events: no titles, descriptions, participants, locations, attachments or video-call links. ServiceOS cannot create, change or delete anything in Google Calendar and requests neither the e-mail address (“email”) nor the profile (“profile”) of the Google account.",
        "For the management page (see “Disconnecting”), the person signs in with the “openid” permission only; ServiceOS then receives no calendar access and no long-lived token.",
      ],
    },
    {
      heading: "Data stored by ServiceOS",
      paragraphs: ["The ServiceOS database (Supabase, PostgreSQL) stores for each connected person:"],
      items: [
        "the link to the business and to the staff profile;",
        "the IDs of the selected calendars (at most 10). At Google, the ID of the main calendar is usually the e-mail address of the Google account;",
        "an OAuth refresh token, encrypted (AES-256-GCM); the key is not stored in the database. Short-lived access tokens are only held in memory during a request and are not stored;",
        "a pseudonymised account identifier: an HMAC-SHA256 value of the Google account identifier (“sub”), computed with a secret server key. The account identifier itself is not stored. It lets the person find their own connections on the management page and decides whether Google access may be revoked;",
        "the connection status (“connected”, “sync error”, “access withdrawn”), when it was connected, the time of the last successful check, and code and time of the last error;",
        "a cache of busy periods — start and end only — from one day in the past to about six months (183 days) ahead. The 183 days follow from the maximum booking horizon and are not a retention period;",
        "for the connect link: only a check value (SHA-256 hash) of the link, the business, the staff profile, expiry, time of use and the user account that created the link.",
      ],
    },
    {
      heading: "Data ServiceOS does not store",
      items: [
        "Calendar names: they are read live from Google only during the selection and shown to the connecting person.",
        "Event content (title, description, participants, location).",
        "Google passwords, access tokens, the unencrypted Google account identifier and — apart from a calendar ID that may equal an e-mail address — the e-mail address.",
      ],
    },
    {
      heading: "Technically necessary cookies",
      paragraphs: [
        "ServiceOS only sets encrypted cookies that only the server can read (httpOnly): while signing in at Google one with a security value (“state”), PKCE check value and one-time value (nonce), valid for at most 10 minutes; afterwards one for the calendar selection (at most 30 minutes) or for the management page (at most 15 minutes).",
      ],
    },
    {
      heading: "Purpose",
      paragraphs: [
        "The data is used solely to prevent double bookings: times at which the person is busy according to Google Calendar are not offered as free for this person in online booking and in the business's calendar. Other staff members are not affected.",
        "Clients only see that a time is not available. Owners and administrators of the business see the connection status, the number of calendars counted, the time of the last check and a list of ServiceOS appointments that overlap busy times. They see no calendar content, calendar names, calendar IDs, account identifiers or tokens.",
      ],
    },
    {
      heading: "Freshness of the cache and behaviour on failures",
      items: [
        "Busy times are requested again from Google when needed, at most every five minutes; before an appointment is saved, data at most 60 seconds old is used.",
        "If Google cannot be reached, ServiceOS keeps using the cache for at most 15 minutes. After that the person is not offered for bookings until the next successful check. A missing answer from Google is never treated as “free”.",
        "A cache not refreshed for 24 hours is cleared automatically (daily cleanup; deletion can therefore happen up to one day later).",
        "ServiceOS never changes or cancels appointments automatically because of Google data.",
      ],
    },
    {
      heading: "Disconnecting",
      items: [
        "By the business: owners or administrators (or the person themselves, if their user account is linked to the staff profile) can disconnect under Settings → Google Calendar.",
        "By the person, at any time: on the page /connect-calendar/manage after signing in with Google. It shows every ServiceOS connection of this Google account, also with different businesses; each can be disconnected individually or all together. Right after choosing calendars, disconnecting is also possible on that page.",
        "Disconnecting immediately deletes the connection record (encrypted token, calendar IDs, pseudonymised account identifier, status and cache) from the database. Afterwards the business plans this person with the stored working hours only.",
        "Technically, Google always withdraws access for all ServiceOS connections of one Google account at once. ServiceOS therefore asks Google to revoke only when the last ServiceOS connection of that account is disconnected. While the account is still connected with another business, Google access remains for that connection.",
      ],
    },
    {
      heading: "Revoking directly at Google",
      paragraphs: [
        "The person can withdraw access at any time in their Google account (Security → Third-party apps and services). This affects all ServiceOS connections of the account. ServiceOS notices the revocation at the next request and then deletes the token, the calendar IDs and the cache.",
        "Only a minimal technical status remains: the link to the business and staff profile, the status “access withdrawn”, its time and error code, and the pseudonymised account identifier. While this status exists the person is not offered for bookings, because their busy times are no longer known. It is not deleted automatically; it ends when the business or the person (management page) disconnects or the person reconnects.",
      ],
    },
    {
      heading: "Deactivating and deleting staff profiles",
      items: [
        "When a staff profile is deactivated, ServiceOS removes the Google Calendar connection immediately (as when disconnecting). If that does not succeed right away, the daily cleanup catches up.",
        "When a staff profile or the business is deleted, the connection is deleted with it.",
      ],
    },
    {
      heading: "Connect links",
      paragraphs: [
        "A connect link is valid for 72 hours and can be used once; a new link for the same person invalidates older unused links. Link records are deleted automatically 30 days after use, or 30 days after an unused link expired (daily cleanup).",
      ],
    },
    {
      heading: "Backups",
      paragraphs: [
        "The database provider's current plan creates no automatic backups. The operator creates manual, encrypted backups when needed. Data deleted in ServiceOS can remain in such backups until they are deleted; immediate deletion from all backups is not possible. The retention period of backups is not defined yet (Needs legal review). If automatic provider backups are used in future, deleted data remains in them until the respective backup period ends.",
      ],
    },
    {
      heading: "Google API Services User Data Policy",
      paragraphs: [
        "ServiceOS's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. The data is used only for the availability check described above, not for advertising, not sold and not used to train AI models. (Operator commitment — Needs legal review.)",
      ],
    },
  ],
  reviewTitle: "Open points for legal review (Needs legal review)",
  reviewNotes: [
    "Legal basis of the processing (e.g. consent, employee data protection under § 26 BDSG, legitimate interest) and voluntariness in the employment relationship.",
    "Roles: controller (business as employer and/or the operator of ServiceOS), joint controllership or processing on behalf; required agreements (Art. 26/28 GDPR).",
    "Data processing agreements and locations: Supabase (database, currently region eu-central-1, Frankfurt) and Vercel (hosting). According to technical identifiers, server functions currently run in Vercel region iad1 (USA) — check third-country transfer or change the region.",
    "Data exchange with Google (Google Ireland Limited / Google LLC) during OAuth and API requests, Google's role, possible third-country transfer.",
    "Final retention periods: cache 24 hours, connect links 30 days, “access withdrawn” status without automatic deletion.",
    "Retention and encryption of backups; hosting server logs.",
    "Information duties towards staff (Art. 13 GDPR), record of processing activities, whether a data protection impact assessment is required.",
    "Wording of the Limited Use commitment and how it is ensured organisationally (prerequisite for Google verification).",
  ],
  policyLinkLabel: "Google API Services User Data Policy",
};

const uk: GoogleCalendarPrivacyText = {
  title: "Інтеграція з Google Календарем",
  draftNote:
    "Чернетка для юридичної перевірки. Розділ описує технічну реалізацію і ще не затверджений юридично (Needs legal review). Усі строки зберігання попередні.",
  notLiveNote:
    "Примітка: інтеграцію з Google Календарем ще не ввімкнено для користувачів робочого середовища. Розділ описує підготовлену функцію.",
  blocks: [
    {
      heading: "Добровільне підключення співробітником",
      paragraphs: [
        "Бізнеси, що користуються ServiceOS, можуть звіряти онлайн-запис із Google Календарем. Підключення виконує кожен співробітник особисто: бізнес створює персональне посилання (одноразове, дійсне 72 години). Людина відкриває його, входить безпосередньо в Google зі своїм обліковим записом і надає дозвіл там. ServiceOS не отримує ні пароля Google, ні доступу до облікового запису Google загалом.",
        "Перед переходом до Google ServiceOS показує, які дозволи запитуються, які дані зберігаються, для чого вони використовуються та як завершити підключення.",
      ],
    },
    {
      heading: "Запитувані дозволи (Google OAuth 2.0)",
      items: [
        "Інформація «вільний/зайнятий» вибраних календарів (дозвіл Google «calendar.freebusy»): лише початок і кінець зайнятих проміжків.",
        "Список власних календарів (дозвіл Google «calendar.calendarlist.readonly»): ідентифікатор, назва й позначка основного календаря, щоб людина могла вибрати, які календарі враховувати.",
        "OpenID Connect (дозвіл Google «openid»): Google підписаним підтвердженням особи (ID-токеном) засвідчує, який обліковий запис Google підключено. ServiceOS використовує з нього лише постійний ідентифікатор облікового запису («sub») і перевіряє підпис, видавця, отримувача, строк дії та одноразове значення (nonce).",
      ],
      after: [
        "ServiceOS не запитує доступу до змісту подій: жодних назв, описів, учасників, місць, вкладень чи посилань на відеозустрічі. ServiceOS не може нічого створювати, змінювати чи видаляти в Google Календарі й не запитує ні адреси електронної пошти («email»), ні профілю («profile») облікового запису Google.",
        "Для сторінки керування (див. «Відключення») людина входить лише з дозволом «openid»; ServiceOS при цьому не отримує доступу до календаря й довготривалого токена.",
      ],
    },
    {
      heading: "Які дані зберігає ServiceOS",
      paragraphs: ["У базі даних ServiceOS (Supabase, PostgreSQL) для кожної підключеної людини зберігаються:"],
      items: [
        "прив’язка до бізнесу та профілю співробітника;",
        "ідентифікатори вибраних календарів (не більше 10). Ідентифікатор основного календаря в Google зазвичай збігається з адресою електронної пошти облікового запису Google;",
        "OAuth-токен оновлення (refresh token) у зашифрованому вигляді (AES-256-GCM); ключ не зберігається в базі даних. Короткочасні токени доступу використовуються лише в пам’яті під час запиту й не зберігаються;",
        "псевдонімізований ідентифікатор облікового запису: значення HMAC-SHA256 від ідентифікатора облікового запису Google («sub»), обчислене із секретним ключем сервера. Сам ідентифікатор не зберігається. Значення потрібне, щоб людина знайшла свої підключення на сторінці керування, і для рішення, чи можна відкликати доступ Google;",
        "статус підключення («підключено», «помилка синхронізації», «доступ відкликано»), час підключення, час останньої успішної перевірки, а також код і час останньої помилки;",
        "кеш зайнятих проміжків — лише початок і кінець — від одного дня в минулому до приблизно шести місяців (183 дні) наперед. 183 дні випливають із максимального періоду бронювання і не є строком зберігання;",
        "для посилання на підключення: лише контрольне значення (SHA-256-хеш) посилання, бізнес, профіль співробітника, час закінчення дії, час використання та обліковий запис, який створив посилання.",
      ],
    },
    {
      heading: "Що ServiceOS не зберігає",
      items: [
        "Назви календарів: їх запитують у Google лише під час вибору й показують людині, яка підключається.",
        "Зміст подій (назва, опис, учасники, місце).",
        "Паролі Google, токени доступу, незашифрований ідентифікатор облікового запису Google і — крім ідентифікатора календаря, що може збігатися з адресою електронної пошти — адресу електронної пошти.",
      ],
    },
    {
      heading: "Технічно необхідні cookie",
      paragraphs: [
        "ServiceOS встановлює лише зашифровані cookie, які може прочитати тільки сервер (httpOnly): під час входу в Google — один із захисним значенням («state»), контрольним значенням PKCE та одноразовим значенням (nonce), дійсний не довше 10 хвилин; потім — один для вибору календарів (не довше 30 хвилин) або для сторінки керування (не довше 15 хвилин).",
      ],
    },
    {
      heading: "Мета обробки",
      paragraphs: [
        "Дані використовуються виключно для запобігання подвійним записам: час, коли людина за Google Календарем зайнята, не пропонується для неї як вільний в онлайн-записі та в календарі бізнесу. Інших співробітників це не стосується.",
        "Клієнти бачать лише, що час недоступний. Власники й адміністратори бізнесу бачать статус підключення, кількість врахованих календарів, час останньої перевірки та список записів ServiceOS, які перетинаються із зайнятим часом. Вони не бачать змісту календарів, назв, ідентифікаторів календарів, ідентифікаторів облікових записів чи токенів.",
      ],
    },
    {
      heading: "Актуальність кешу та поведінка під час збоїв",
      items: [
        "Зайнятий час за потреби повторно запитується в Google не частіше ніж раз на п’ять хвилин; перед збереженням запису використовуються дані не старші за 60 секунд.",
        "Якщо Google недоступний, ServiceOS використовує кеш не довше 15 хвилин. Після цього людина не пропонується для записів до наступної успішної перевірки. Відсутність відповіді Google ніколи не вважається «вільним» часом.",
        "Кеш, який не оновлювався 24 години, автоматично очищується (щоденне очищення; тому видалення може відбутися до одного дня пізніше).",
        "ServiceOS ніколи автоматично не змінює й не скасовує записи через дані Google.",
      ],
    },
    {
      heading: "Відключення",
      items: [
        "Бізнесом: власники чи адміністратори (або сама людина, якщо її обліковий запис пов’язаний із профілем співробітника) можуть відключити інтеграцію в розділі Налаштування → Google Календар.",
        "Самою людиною, будь-коли: на сторінці /connect-calendar/manage після входу через Google. Там показано всі підключення ServiceOS цього облікового запису Google, зокрема в різних бізнесах; кожне можна відключити окремо або всі разом. Одразу після вибору календарів відключити можна й на тій самій сторінці.",
        "Під час відключення запис підключення (зашифрований токен, ідентифікатори календарів, псевдонімізований ідентифікатор облікового запису, статус і кеш) одразу видаляється з бази даних. Після цього бізнес планує цю людину лише за збереженим робочим часом.",
        "Технічно Google завжди відкликає доступ для всіх підключень ServiceOS одного облікового запису Google одночасно. Тому ServiceOS просить Google відкликати доступ лише тоді, коли відключається останнє підключення ServiceOS цього облікового запису. Поки обліковий запис підключено до іншого бізнесу, доступ Google для того підключення зберігається.",
      ],
    },
    {
      heading: "Відкликання безпосередньо в Google",
      paragraphs: [
        "Людина будь-коли може відкликати доступ у своєму обліковому записі Google (Безпека → Сторонні застосунки та сервіси). Це стосується всіх підключень ServiceOS цього облікового запису. ServiceOS помічає відкликання під час наступного запиту й видаляє токен, ідентифікатори календарів і кеш.",
        "Зберігається лише мінімальний технічний статус: прив’язка до бізнесу й профілю співробітника, статус «доступ відкликано», час і код помилки та псевдонімізований ідентифікатор облікового запису. Поки цей статус існує, людина не пропонується для записів, бо її зайнятий час більше невідомий. Він не видаляється автоматично; він завершується, коли бізнес або сама людина (сторінка керування) відключає інтеграцію чи людина підключається знову.",
      ],
    },
    {
      heading: "Деактивація та видалення профілів співробітників",
      items: [
        "Під час деактивації профілю співробітника ServiceOS одразу видаляє підключення Google Календаря (як під час відключення). Якщо це не вдається одразу, щоденне очищення завершує його пізніше.",
        "Під час видалення профілю співробітника або бізнесу підключення видаляється разом із ним.",
      ],
    },
    {
      heading: "Посилання на підключення",
      paragraphs: [
        "Посилання на підключення дійсне 72 години й спрацьовує один раз; нове посилання для тієї самої людини робить недійсними старі невикористані. Записи про посилання автоматично видаляються через 30 днів після використання або через 30 днів після закінчення строку дії невикористаного посилання (щоденне очищення).",
      ],
    },
    {
      heading: "Резервні копії",
      paragraphs: [
        "Поточний тариф постачальника бази даних не створює автоматичних резервних копій. Оператор за потреби створює ручні зашифровані копії. Дані, видалені в ServiceOS, можуть залишатися в таких копіях до їх видалення; миттєве видалення з усіх копій неможливе. Строк зберігання резервних копій ще не визначено (Needs legal review). Якщо в майбутньому використовуватимуться автоматичні копії постачальника, видалені дані залишатимуться в них до закінчення відповідного строку зберігання.",
      ],
    },
    {
      heading: "Google API Services User Data Policy",
      paragraphs: [
        "Використання та передача інформації, отриманої ServiceOS через Google API, відповідають Google API Services User Data Policy, зокрема вимогам щодо обмеженого використання (Limited Use). Дані використовуються лише для описаної вище перевірки доступності, не для реклами, не продаються й не використовуються для навчання моделей ШІ. (Зобов’язання оператора — Needs legal review.)",
      ],
    },
  ],
  reviewTitle: "Відкриті питання для юридичної перевірки (Needs legal review)",
  reviewNotes: [
    "Правова підстава обробки (наприклад, згода, захист даних працівників за § 26 BDSG, законний інтерес) і добровільність у трудових відносинах.",
    "Ролі: контролер (бізнес як роботодавець і/або оператор ServiceOS), спільна відповідальність чи обробка за дорученням; потрібні договори (ст. 26/28 GDPR).",
    "Договори про обробку даних і місця розташування: Supabase (база даних, зараз регіон eu-central-1, Франкфурт) і Vercel (хостинг). За технічними ідентифікаторами серверні функції зараз працюють у регіоні Vercel iad1 (США) — перевірити передачу до третьої країни або змінити регіон.",
    "Обмін даними з Google (Google Ireland Limited / Google LLC) під час OAuth- і API-запитів, роль Google, можлива передача до третіх країн.",
    "Остаточні строки зберігання: кеш 24 години, посилання 30 днів, статус «доступ відкликано» без автоматичного видалення.",
    "Зберігання й шифрування резервних копій; серверні журнали хостингу.",
    "Обов’язки інформування співробітників (ст. 13 GDPR), реєстр операцій обробки, потреба в оцінці впливу на захист даних.",
    "Формулювання зобов’язання Limited Use та його організаційне забезпечення (умова верифікації Google).",
  ],
  policyLinkLabel: "Google API Services User Data Policy",
};

const ru: GoogleCalendarPrivacyText = {
  title: "Интеграция с Google Календарём",
  draftNote:
    "Черновик для юридической проверки. Раздел описывает техническую реализацию и ещё не утверждён юридически (Needs legal review). Все сроки хранения предварительные.",
  notLiveNote:
    "Примечание: интеграция с Google Календарём ещё не включена для пользователей рабочей среды. Раздел описывает подготовленную функцию.",
  blocks: [
    {
      heading: "Добровольное подключение сотрудником",
      paragraphs: [
        "Бизнесы, использующие ServiceOS, могут сверять онлайн-запись с Google Календарём. Подключение выполняет каждый сотрудник лично: бизнес создаёт персональную ссылку (одноразовую, действующую 72 часа). Человек открывает её, входит непосредственно в Google со своим аккаунтом и выдаёт разрешение там. ServiceOS не получает ни пароля Google, ни доступа к аккаунту Google в целом.",
        "Перед переходом в Google ServiceOS показывает, какие разрешения запрашиваются, какие данные сохраняются, для чего они используются и как завершить подключение.",
      ],
    },
    {
      heading: "Запрашиваемые разрешения (Google OAuth 2.0)",
      items: [
        "Информация «свободен/занят» по выбранным календарям (разрешение Google «calendar.freebusy»): только начало и конец занятых промежутков.",
        "Список собственных календарей (разрешение Google «calendar.calendarlist.readonly»): идентификатор, название и отметка основного календаря, чтобы человек мог выбрать, какие календари учитывать.",
        "OpenID Connect (разрешение Google «openid»): Google подписанным подтверждением личности (ID-токеном) удостоверяет, какой аккаунт Google подключён. ServiceOS использует из него только постоянный идентификатор аккаунта («sub») и проверяет подпись, издателя, получателя, срок действия и одноразовое значение (nonce).",
      ],
      after: [
        "ServiceOS не запрашивает доступ к содержанию событий: никаких названий, описаний, участников, мест, вложений или ссылок на видеовстречи. ServiceOS не может ничего создавать, изменять или удалять в Google Календаре и не запрашивает ни адрес электронной почты («email»), ни профиль («profile») аккаунта Google.",
        "Для страницы управления (см. «Отключение») человек входит только с разрешением «openid»; ServiceOS при этом не получает доступа к календарю и долгоживущего токена.",
      ],
    },
    {
      heading: "Какие данные хранит ServiceOS",
      paragraphs: ["В базе данных ServiceOS (Supabase, PostgreSQL) для каждого подключённого человека хранятся:"],
      items: [
        "привязка к бизнесу и профилю сотрудника;",
        "идентификаторы выбранных календарей (не более 10). Идентификатор основного календаря в Google обычно совпадает с адресом электронной почты аккаунта Google;",
        "OAuth-токен обновления (refresh token) в зашифрованном виде (AES-256-GCM); ключ не хранится в базе данных. Краткосрочные токены доступа используются только в памяти во время запроса и не сохраняются;",
        "псевдонимизированный идентификатор аккаунта: значение HMAC-SHA256 от идентификатора аккаунта Google («sub»), вычисленное с секретным ключом сервера. Сам идентификатор не хранится. Значение нужно, чтобы человек нашёл свои подключения на странице управления, и для решения, можно ли отозвать доступ Google;",
        "статус подключения («подключено», «ошибка синхронизации», «доступ отозван»), время подключения, время последней успешной проверки, а также код и время последней ошибки;",
        "кеш занятых промежутков — только начало и конец — от одного дня в прошлом до примерно шести месяцев (183 дня) вперёд. 183 дня следуют из максимального периода записи и не являются сроком хранения;",
        "для ссылки на подключение: только контрольное значение (SHA-256-хеш) ссылки, бизнес, профиль сотрудника, срок действия, время использования и аккаунт, создавший ссылку.",
      ],
    },
    {
      heading: "Что ServiceOS не хранит",
      items: [
        "Названия календарей: их запрашивают у Google только во время выбора и показывают подключающемуся человеку.",
        "Содержание событий (название, описание, участники, место).",
        "Пароли Google, токены доступа, незашифрованный идентификатор аккаунта Google и — кроме идентификатора календаря, который может совпадать с адресом электронной почты, — адрес электронной почты.",
      ],
    },
    {
      heading: "Технически необходимые cookie",
      paragraphs: [
        "ServiceOS устанавливает только зашифрованные cookie, которые может прочитать лишь сервер (httpOnly): во время входа в Google — один с защитным значением («state»), контрольным значением PKCE и одноразовым значением (nonce), действует не дольше 10 минут; затем — один для выбора календарей (не дольше 30 минут) или для страницы управления (не дольше 15 минут).",
      ],
    },
    {
      heading: "Цель обработки",
      paragraphs: [
        "Данные используются исключительно для предотвращения двойных записей: время, когда человек по Google Календарю занят, не предлагается для него как свободное в онлайн-записи и в календаре бизнеса. Других сотрудников это не затрагивает.",
        "Клиенты видят только, что время недоступно. Владельцы и администраторы бизнеса видят статус подключения, количество учитываемых календарей, время последней проверки и список записей ServiceOS, пересекающихся с занятым временем. Они не видят содержания календарей, названий, идентификаторов календарей, идентификаторов аккаунтов или токенов.",
      ],
    },
    {
      heading: "Актуальность кеша и поведение при сбоях",
      items: [
        "Занятое время при необходимости повторно запрашивается у Google не чаще чем раз в пять минут; перед сохранением записи используются данные не старше 60 секунд.",
        "Если Google недоступен, ServiceOS использует кеш не дольше 15 минут. После этого человек не предлагается для записей до следующей успешной проверки. Отсутствие ответа Google никогда не считается «свободным» временем.",
        "Кеш, который не обновлялся 24 часа, автоматически очищается (ежедневная очистка; поэтому удаление может произойти до одного дня позже).",
        "ServiceOS никогда автоматически не изменяет и не отменяет записи из-за данных Google.",
      ],
    },
    {
      heading: "Отключение",
      items: [
        "Бизнесом: владельцы или администраторы (или сам человек, если его аккаунт связан с профилем сотрудника) могут отключить интеграцию в разделе Настройки → Google Календарь.",
        "Самим человеком, в любой момент: на странице /connect-calendar/manage после входа через Google. Там показаны все подключения ServiceOS этого аккаунта Google, в том числе в разных бизнесах; каждое можно отключить отдельно или все вместе. Сразу после выбора календарей отключить можно и на той же странице.",
        "При отключении запись подключения (зашифрованный токен, идентификаторы календарей, псевдонимизированный идентификатор аккаунта, статус и кеш) сразу удаляется из базы данных. После этого бизнес планирует этого человека только по сохранённому рабочему времени.",
        "Технически Google всегда отзывает доступ для всех подключений ServiceOS одного аккаунта Google одновременно. Поэтому ServiceOS просит Google отозвать доступ только тогда, когда отключается последнее подключение ServiceOS этого аккаунта. Пока аккаунт подключён к другому бизнесу, доступ Google для того подключения сохраняется.",
      ],
    },
    {
      heading: "Отзыв непосредственно в Google",
      paragraphs: [
        "Человек в любой момент может отозвать доступ в своём аккаунте Google (Безопасность → Сторонние приложения и сервисы). Это касается всех подключений ServiceOS этого аккаунта. ServiceOS замечает отзыв при следующем запросе и удаляет токен, идентификаторы календарей и кеш.",
        "Сохраняется только минимальный технический статус: привязка к бизнесу и профилю сотрудника, статус «доступ отозван», время и код ошибки, а также псевдонимизированный идентификатор аккаунта. Пока этот статус существует, человек не предлагается для записей, так как его занятое время больше неизвестно. Он не удаляется автоматически; он заканчивается, когда бизнес или сам человек (страница управления) отключает интеграцию или человек подключается заново.",
      ],
    },
    {
      heading: "Деактивация и удаление профилей сотрудников",
      items: [
        "При деактивации профиля сотрудника ServiceOS сразу удаляет подключение Google Календаря (как при отключении). Если это не удаётся сразу, ежедневная очистка завершает его позже.",
        "При удалении профиля сотрудника или бизнеса подключение удаляется вместе с ним.",
      ],
    },
    {
      heading: "Ссылки на подключение",
      paragraphs: [
        "Ссылка на подключение действует 72 часа и срабатывает один раз; новая ссылка для того же человека делает недействительными старые неиспользованные. Записи о ссылках автоматически удаляются через 30 дней после использования или через 30 дней после истечения срока неиспользованной ссылки (ежедневная очистка).",
      ],
    },
    {
      heading: "Резервные копии",
      paragraphs: [
        "Текущий тариф поставщика базы данных не создаёт автоматических резервных копий. Оператор при необходимости создаёт ручные зашифрованные копии. Данные, удалённые в ServiceOS, могут оставаться в таких копиях до их удаления; мгновенное удаление из всех копий невозможно. Срок хранения резервных копий ещё не определён (Needs legal review). Если в будущем будут использоваться автоматические копии поставщика, удалённые данные останутся в них до истечения соответствующего срока хранения.",
      ],
    },
    {
      heading: "Google API Services User Data Policy",
      paragraphs: [
        "Использование и передача информации, полученной ServiceOS через Google API, соответствуют Google API Services User Data Policy, включая требования об ограниченном использовании (Limited Use). Данные используются только для описанной выше проверки доступности, не для рекламы, не продаются и не используются для обучения моделей ИИ. (Обязательство оператора — Needs legal review.)",
      ],
    },
  ],
  reviewTitle: "Открытые вопросы для юридической проверки (Needs legal review)",
  reviewNotes: [
    "Правовое основание обработки (например, согласие, защита данных работников по § 26 BDSG, законный интерес) и добровольность в трудовых отношениях.",
    "Роли: ответственный (бизнес как работодатель и/или оператор ServiceOS), совместная ответственность или обработка по поручению; необходимые договоры (ст. 26/28 GDPR).",
    "Договоры об обработке данных и места размещения: Supabase (база данных, сейчас регион eu-central-1, Франкфурт) и Vercel (хостинг). По техническим идентификаторам серверные функции сейчас работают в регионе Vercel iad1 (США) — проверить передачу в третью страну или сменить регион.",
    "Обмен данными с Google (Google Ireland Limited / Google LLC) при OAuth- и API-запросах, роль Google, возможная передача в третьи страны.",
    "Окончательные сроки хранения: кеш 24 часа, ссылки 30 дней, статус «доступ отозван» без автоматического удаления.",
    "Хранение и шифрование резервных копий; серверные журналы хостинга.",
    "Обязанности информирования сотрудников (ст. 13 GDPR), реестр операций обработки, необходимость оценки воздействия на защиту данных.",
    "Формулировка обязательства Limited Use и его организационное обеспечение (условие верификации Google).",
  ],
  policyLinkLabel: "Google API Services User Data Policy",
};

export const googleCalendarPrivacy: Record<Locale, GoogleCalendarPrivacyText> = { de, en, uk, ru };
