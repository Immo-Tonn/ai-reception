import type { Invoice } from "./types";

/**
 * Demo data for the design/navigation pass only. Real revenue reads must
 * stay scoped by workspace + permissions, with the Main/Private/Custom
 * split as first-class data (§7), never a single `is_private` flag (§69).
 */
export const demoInvoices: Invoice[] = [
  {
    id: "1",
    number: "#1042",
    client: "Anna Müller",
    amount: 55,
    currency: "EUR",
    status: "paid",
    bucket: "main",
    visibility: "normal",
    date: "2026-09-08",
  },
  {
    id: "2",
    number: "#1043",
    client: "Laura Fischer",
    amount: 80,
    currency: "EUR",
    status: "unpaid",
    bucket: "main",
    visibility: "normal",
    date: "2026-09-15",
  },
  {
    id: "3",
    number: "#1044",
    client: "Mia Weber",
    amount: 180,
    currency: "EUR",
    status: "partial",
    bucket: "main",
    visibility: "normal",
    date: "2026-07-30",
  },
  {
    id: "4",
    number: "#1045",
    client: "Example Client",
    amount: 150,
    currency: "EUR",
    status: "paid",
    bucket: "private",
    visibility: "ownerOnly",
    date: "2026-09-20",
  },
];

export const demoRevenue = {
  main: 8450,
  private: 1320,
  currency: "EUR",
};
