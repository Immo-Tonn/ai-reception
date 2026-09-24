import type { WorkspaceConfig } from "../types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";
import type { ClientRecord } from "@/features/clients/types";
import type { Appointment } from "@/features/appointments/types";

const services: ServiceDefinition[] = [
  {
    id: "svc-haircut",
    name: "Haircut",
    translations: { en: "Haircut", de: "Haarschnitt", uk: "Стрижка", ru: "Стрижка" },
    durationMinutes: 45,
    price: 55,
    currency: "EUR",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 10,
    allowedStaffIds: ["staff-elena"],
    requiredResourceType: "station",
  },
  {
    id: "svc-consultation",
    name: "Consultation",
    translations: { en: "Consultation", de: "Beratung", uk: "Консультація", ru: "Консультация" },
    durationMinutes: 30,
    price: 40,
    currency: "EUR",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 5,
    allowedStaffIds: [],
    requiredResourceType: null,
  },
  {
    id: "svc-color",
    name: "Color",
    translations: { en: "Color", de: "Coloration", uk: "Фарбування", ru: "Окрашивание" },
    durationMinutes: 90,
    price: 95,
    currency: "EUR",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 15,
    allowedStaffIds: ["staff-elena"],
    requiredResourceType: "station",
  },
];

const staff: StaffMember[] = [
  { id: "staff-elena", name: "Elena", colorToken: "--color-accent-blue" },
  { id: "staff-you", name: "You", colorToken: "--color-accent-lavender" },
];

const resources: ResourceDefinition[] = [
  {
    id: "res-room-1",
    name: "Hair station 1",
    type: "station",
    translations: {
      de: "Friseurplatz 1",
      en: "Hair station 1",
      uk: "Перукарське крісло 1",
      ru: "Парикмахерское кресло 1",
    },
  },
  {
    id: "res-room-2",
    name: "Hair station 2",
    type: "station",
    translations: {
      de: "Friseurplatz 2",
      en: "Hair station 2",
      uk: "Перукарське крісло 2",
      ru: "Парикмахерское кресло 2",
    },
  },
  {
    id: "res-manicure",
    name: "Manicure table",
    type: "table",
    translations: {
      de: "Maniküretisch",
      en: "Manicure table",
      uk: "Манікюрний стіл",
      ru: "Маникюрный стол",
    },
  },
  {
    id: "res-massage",
    name: "Massage room",
    type: "room",
    translations: {
      de: "Massageraum",
      en: "Massage room",
      uk: "Масажний кабінет",
      ru: "Массажный кабинет",
    },
  },
];

const clients: ClientRecord[] = [
  {
    id: "anna-muller",
    name: "Anna Müller",
    email: "anna.muller@example.com",
    phone: "+49 151 2345 6789",
    tags: ["vip"],
    lastVisit: "2026-09-08",
    upcoming: [{ date: "2026-09-22", time: "09:00", service: "Haircut" }],
    history: [
      { date: "2026-09-08", service: "Haircut", price: 55 },
      { date: "2026-08-11", service: "Color", price: 95 },
    ],
    notes: "Prefers appointments in the morning. Allergic to ammonia-based dye.",
    customFields: [{ label: "Preferred specialist", value: "Elena" }],
  },
  {
    id: "jonas-schmidt",
    name: "Jonas Schmidt",
    email: "jonas.schmidt@example.com",
    phone: "+49 160 1122 3344",
    tags: ["new"],
    lastVisit: null,
    upcoming: [{ date: "2026-09-22", time: "10:30", service: "Consultation" }],
    history: [],
    notes: "",
  },
];

const appointments: Appointment[] = [
  {
    id: "1",
    client: "Anna Müller",
    service: "Haircut",
    staff: "Elena",
    resourceId: "res-room-1",
    date: "2026-09-22",
    time: "09:00",
    durationMinutes: 45,
    price: 55,
    currency: "EUR",
    notes: "",
    visibility: "normal",
    financialBucket: "main",
    status: "confirmed",
    paid: true,
    seriesId: null,
    recurrence: null,
  },
  {
    id: "2",
    client: "Jonas Schmidt",
    service: "Consultation",
    staff: "Elena",
    resourceId: null,
    date: "2026-09-22",
    time: "10:30",
    durationMinutes: 30,
    price: 40,
    currency: "EUR",
    notes: "",
    visibility: "normal",
    financialBucket: "main",
    status: "pending",
    paid: false,
    seriesId: null,
    recurrence: null,
  },
  {
    id: "3",
    client: "Example Client",
    service: "Consultation",
    staff: "You",
    resourceId: null,
    date: "2026-09-22",
    time: "14:00",
    durationMinutes: 60,
    price: 150,
    currency: "EUR",
    notes: "",
    visibility: "ownerOnly",
    financialBucket: "private",
    status: "confirmed",
    paid: true,
    seriesId: null,
    recurrence: null,
  },
  {
    id: "6",
    client: "Anna Müller",
    service: "Color",
    staff: "Elena",
    resourceId: "res-room-1",
    date: "2026-09-24",
    time: "13:30",
    durationMinutes: 90,
    price: 95,
    currency: "EUR",
    notes: "",
    visibility: "normal",
    financialBucket: "main",
    status: "confirmed",
    paid: false,
    seriesId: null,
    recurrence: null,
  },
];

/**
 * Beauty / Salon — a self-contained catalog, same pattern as every other
 * industry preset (werkstatt/cleaning/consulting): its own services,
 * staff, resources, clients and appointments, never shared with another
 * workspace's demo content (§ workspace isolation).
 */
export const salonWorkspace: WorkspaceConfig = {
  slug: "demo-salon",
  industry: "salon",
  name: "Beauty Salon",
  tagline: "Haircuts, color, brows, massage",
  emoji: "💇",
  clientDescription: {
    de: "Haare, Nägel, Pflege, Massage",
    en: "Hair, nails, care, massage",
    uk: "Волосся, нігті, догляд, масаж",
    ru: "Волосы, ногти, уход, массаж",
  },
  staffLabel: { de: "Spezialist", en: "Specialist", uk: "Спеціаліст", ru: "Специалист" },
  resourceLabel: {
    de: "Arbeitsplatz / Kabine",
    en: "Station / room",
    uk: "Робоче місце / кабінет",
    ru: "Рабочее место / кабинет",
  },
  noResourceLabel: {
    de: "Kein Arbeitsplatz erforderlich",
    en: "No station required",
    uk: "Без окремого робочого місця",
    ru: "Без отдельного рабочего места",
  },
  // A simple Salon walk-in/appointment business doesn't need a
  // lead→quote→job pipeline — Work stays out of the main nav (the
  // `/work` route itself is untouched, see WorkspaceConfig.workEnabled).
  workEnabled: false,
  financeIntro: {
    de: "Rechnungen, Zahlungen und Umsatz Ihres Unternehmens.",
    en: "Invoices, payments and revenue for your business.",
    uk: "Рахунки, оплати та дохід вашого бізнесу.",
    ru: "Счета, оплаты и выручка вашего бизнеса.",
  },
  analyticsIntro: {
    de: "Wichtige Kennzahlen auf Basis von Terminen, Kunden und Finanzen.",
    en: "Key business metrics based on appointments, clients and finance.",
    uk: "Ключові показники бізнесу на основі записів, клієнтів та фінансів.",
    ru: "Ключевые показатели бизнеса на основе записей, клиентов и финансов.",
  },
  services,
  staff,
  resources,
  clients,
  appointments,
};
