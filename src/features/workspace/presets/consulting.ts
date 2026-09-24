import type { WorkspaceConfig } from "../types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";
import type { ClientRecord } from "@/features/clients/types";
import type { Appointment } from "@/features/appointments/types";

const services: ServiceDefinition[] = [
  {
    id: "svc-erstberatung",
    name: "Erstberatung",
    translations: {
      en: "Initial consultation",
      de: "Erstberatung",
      uk: "Первинна консультація",
      ru: "Первичная консультация",
    },
    durationMinutes: 30,
    price: 0,
    currency: "EUR",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 5,
    allowedStaffIds: [],
    requiredResourceType: null,
  },
  {
    id: "svc-website-audit",
    name: "Website Audit",
    translations: { en: "Website audit", de: "Website-Audit", uk: "Аудит сайту", ru: "Аудит сайта" },
    durationMinutes: 60,
    price: 180,
    currency: "EUR",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 10,
    allowedStaffIds: [],
    requiredResourceType: null,
  },
  {
    id: "svc-projektbesprechung",
    name: "Projektbesprechung",
    translations: {
      en: "Project meeting",
      de: "Projektbesprechung",
      uk: "Обговорення проєкту",
      ru: "Обсуждение проекта",
    },
    durationMinutes: 45,
    price: 120,
    currency: "EUR",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    allowedStaffIds: [],
    requiredResourceType: "room",
  },
];

const staff: StaffMember[] = [
  { id: "staff-you", name: "You", colorToken: "--color-accent-lavender" },
  { id: "staff-elena", name: "Elena", colorToken: "--color-accent-blue" },
];

const resources: ResourceDefinition[] = [
  {
    id: "res-meeting-1",
    name: "Meeting Room 1",
    type: "room",
    translations: {
      de: "Besprechungsraum 1",
      en: "Meeting Room 1",
      uk: "Переговорна 1",
      ru: "Переговорная 1",
    },
  },
  {
    id: "res-meeting-2",
    name: "Meeting Room 2",
    type: "room",
    translations: {
      de: "Besprechungsraum 2",
      en: "Meeting Room 2",
      uk: "Переговорна 2",
      ru: "Переговорная 2",
    },
  },
  {
    id: "res-video",
    name: "Video Call / Online",
    type: "room",
    translations: {
      de: "Videoanruf / Online",
      en: "Video Call / Online",
      uk: "Відеодзвінок / Онлайн",
      ru: "Видеозвонок / Онлайн",
    },
  },
];

const clients: ClientRecord[] = [
  {
    id: "company-nordwind",
    name: "Nordwind GmbH",
    email: "kontakt@nordwind.example",
    phone: "+49 40 2233 4455",
    tags: ["vip"],
    lastVisit: "2026-09-05",
    upcoming: [{ date: "2026-09-22", time: "14:00", service: "Projektbesprechung" }],
    history: [{ date: "2026-09-05", service: "Website Audit", price: 180 }],
    notes: "E-commerce relaunch, Q4 deadline.",
    customFields: [
      { label: "Company", value: "Nordwind GmbH" },
      { label: "Domain", value: "nordwind.example" },
      { label: "Project type", value: "E-commerce relaunch" },
    ],
  },
  {
    id: "company-bergmann-studio",
    name: "Bergmann Studio",
    email: "hello@bergmannstudio.example",
    phone: "+49 30 9988 1122",
    tags: ["new"],
    lastVisit: null,
    upcoming: [{ date: "2026-09-22", time: "10:00", service: "Erstberatung" }],
    history: [],
    notes: "Referred by Nordwind GmbH.",
    customFields: [
      { label: "Company", value: "Bergmann Studio" },
      { label: "Domain", value: "bergmannstudio.example" },
      { label: "Project type", value: "Portfolio website" },
    ],
  },
  {
    id: "company-fischer-partner",
    name: "Fischer & Partner",
    email: "info@fischer-partner.example",
    phone: "+49 69 4433 2211",
    tags: [],
    lastVisit: "2026-08-28",
    upcoming: [],
    history: [{ date: "2026-08-28", service: "Website Audit", price: 180 }],
    notes: "Law firm — accessibility compliance is the priority.",
    customFields: [
      { label: "Company", value: "Fischer & Partner Rechtsanwälte" },
      { label: "Domain", value: "fischer-partner.example" },
      { label: "Project type", value: "Accessibility audit" },
    ],
  },
];

const appointments: Appointment[] = [
  {
    id: "co-1",
    client: "Bergmann Studio",
    service: "Erstberatung",
    staff: "You",
    resourceId: null,
    date: "2026-09-22",
    time: "10:00",
    durationMinutes: 30,
    price: 0,
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
    id: "co-2",
    client: "Nordwind GmbH",
    service: "Projektbesprechung",
    staff: "Elena",
    resourceId: "res-meeting-1",
    date: "2026-09-22",
    time: "14:00",
    durationMinutes: 45,
    price: 120,
    currency: "EUR",
    notes: "E-commerce relaunch — Q4 Deadline besprechen.",
    visibility: "normal",
    financialBucket: "main",
    status: "confirmed",
    paid: false,
    seriesId: null,
    recurrence: null,
  },
  {
    id: "co-3",
    client: "Fischer & Partner",
    service: "Website Audit",
    staff: "You",
    resourceId: null,
    date: "2026-09-24",
    time: "11:00",
    durationMinutes: 60,
    price: 180,
    currency: "EUR",
    notes: "",
    visibility: "normal",
    financialBucket: "main",
    status: "pending",
    paid: false,
    seriesId: null,
    recurrence: null,
  },
];

/** Consulting / Web Studio — B2B, company-level clients; resources are
 * meeting rooms plus a virtual "Video Call" option. */
export const consultingWorkspace: WorkspaceConfig = {
  slug: "demo-consulting",
  industry: "consulting",
  name: "Consulting / Web Studio",
  tagline: "Erstberatung, Website Audit, Projektbesprechung",
  emoji: "💼",
  clientDescription: {
    de: "Beratung und Projektleistungen",
    en: "Consulting and project services",
    uk: "Консультації та проєктні послуги",
    ru: "Консультации и проектные услуги",
  },
  staffLabel: { de: "Berater", en: "Consultant", uk: "Консультант", ru: "Консультант" },
  resourceLabel: {
    de: "Raum / Besprechungsraum",
    en: "Room / meeting room",
    uk: "Кабінет / переговорна",
    ru: "Кабинет / переговорная",
  },
  noResourceLabel: {
    de: "Kein Raum erforderlich",
    en: "No room needed",
    uk: "Без кабінету",
    ru: "Без кабинета",
  },
  workLabel: { de: "Projekte", en: "Projects", uk: "Проєкти", ru: "Проекты" },
  workIntro: {
    de: "Verwalten Sie Kundenanfragen, Angebote und Projekte vom Erstkontakt bis zur Rechnung.",
    en: "Manage client requests, quotes and projects from first contact through to invoicing.",
    uk: "Керуйте запитами, пропозиціями та проєктами клієнтів від першого контакту до рахунку.",
    ru: "Управляйте запросами, предложениями и проектами клиентов от первого контакта до счёта.",
  },
  financeIntro: {
    de: "Rechnungen, Zahlungen und Umsatz Ihres Unternehmens.",
    en: "Invoices, payments and revenue for your business.",
    uk: "Рахунки, оплати та дохід вашого бізнесу.",
    ru: "Счета, оплаты и выручка вашего бизнеса.",
  },
  analyticsIntro: {
    de: "Wichtige Kennzahlen auf Basis von Kunden, Projekten und Finanzen.",
    en: "Key business metrics based on clients, projects and finance.",
    uk: "Ключові показники бізнесу на основі клієнтів, проєктів та фінансів.",
    ru: "Ключевые показатели бизнеса на основе клиентов, проектов и финансов.",
  },
  services,
  staff,
  resources,
  clients,
  appointments,
};
