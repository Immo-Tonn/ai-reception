/**
 * Localization foundation — same 4 locales as the web app (DE/EN/UK/RU),
 * same "one flat dictionary per locale" shape so a future pass can share
 * translation content with `src/lib/i18n/data/*.ts` on the web side if
 * that ever makes sense. Only enough keys for the placeholder screens —
 * not a port of the web app's full dictionary.
 */
export type Locale = "en" | "de" | "uk" | "ru";
export const locales: Locale[] = ["en", "de", "uk", "ru"];
export const defaultLocale: Locale = "en";

export interface Messages {
  welcomeTitle: string;
  welcomeSubtitle: string;
  manageBusiness: string;
  bookService: string;
  businessTitle: string;
  businessBody: string;
  clientTitle: string;
  clientBody: string;
  signInTitle: string;
  signInBody: string;
  back: string;
}

export const messages: Record<Locale, Messages> = {
  en: {
    welcomeTitle: "Everything for services and bookings, in one place.",
    welcomeSubtitle: "ServiceOS connects a business with the people who book its services.",
    manageBusiness: "Manage a business",
    bookService: "Book a service",
    businessTitle: "Business",
    businessBody: "Native business shell — foundation only. Calendar, clients and jobs come later.",
    clientTitle: "Client",
    clientBody: "Native booking shell — foundation only. Full booking flow comes later.",
    signInTitle: "Sign in",
    signInBody: "Placeholder — no real authentication is connected yet.",
    back: "Back",
  },
  de: {
    welcomeTitle: "Alles für Dienstleistungen und Termine an einem Ort.",
    welcomeSubtitle: "ServiceOS verbindet ein Unternehmen mit den Menschen, die seine Leistungen buchen.",
    manageBusiness: "Unternehmen verwalten",
    bookService: "Termin buchen",
    businessTitle: "Unternehmen",
    businessBody: "Native Business-Hülle — nur Grundlage. Kalender, Kunden und Aufträge folgen später.",
    clientTitle: "Kunde",
    clientBody: "Native Buchungs-Hülle — nur Grundlage. Der vollständige Ablauf folgt später.",
    signInTitle: "Anmelden",
    signInBody: "Platzhalter — es ist noch keine echte Authentifizierung angebunden.",
    back: "Zurück",
  },
  uk: {
    welcomeTitle: "Усе для послуг і записів в одному місці.",
    welcomeSubtitle: "ServiceOS з'єднує бізнес і людей, які записуються на послуги.",
    manageBusiness: "Керувати бізнесом",
    bookService: "Записатися на послугу",
    businessTitle: "Бізнес",
    businessBody: "Нативна оболонка для бізнесу — лише основа. Календар, клієнти й замовлення — пізніше.",
    clientTitle: "Клієнт",
    clientBody: "Нативна оболонка бронювання — лише основа. Повний флоу — пізніше.",
    signInTitle: "Увійти",
    signInBody: "Заглушка — справжня автентифікація ще не підключена.",
    back: "Назад",
  },
  ru: {
    welcomeTitle: "Всё для услуг и записей в одном месте.",
    welcomeSubtitle: "ServiceOS соединяет бизнес и людей, которые записываются на услуги.",
    manageBusiness: "Управлять бизнесом",
    bookService: "Записаться на услугу",
    businessTitle: "Бизнес",
    businessBody: "Нативная оболочка бизнеса — только основа. Календарь, клиенты и заказы — позже.",
    clientTitle: "Клиент",
    clientBody: "Нативная оболочка записи — только основа. Полный flow — позже.",
    signInTitle: "Войти",
    signInBody: "Заглушка — настоящая аутентификация ещё не подключена.",
    back: "Назад",
  },
};
