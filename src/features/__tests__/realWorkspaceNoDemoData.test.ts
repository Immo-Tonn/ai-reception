import { beforeEach, describe, expect, it } from "vitest";
import { getInvoicesRepository } from "@/features/finance/repository";
import { getWaitingListRepository } from "@/features/waitingList/repository";
import { getInboxRepository } from "@/features/inbox/repository";
import { getJobsRepository, getLeadsRepository, getProjectsRepository, getQuotesRepository } from "@/features/work/repository";
import { demoInvoices } from "@/features/finance/demoData";
import { demoWaitingList } from "@/features/waitingList/demoData";
import { demoConversations } from "@/features/inbox/demoData";
import { demoJobs, demoLeads, demoProjects, demoQuotes } from "@/features/work/demoData";
import { computeAnalytics } from "@/features/analytics/calculations";

// The local repositories persist to window.localStorage; give Node a tiny one.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  };
});

const REAL = "my-real-salon";
const filters = { periodDays: 30, service: "all", staff: "all", bucket: "all" } as never;

describe("a REAL workspace never receives demo Finance / Waiting List / Work / Inbox data", () => {
  it.each([
    ["invoices", () => getInvoicesRepository(REAL)],
    // waiting list: a real workspace uses the shared database (Server Actions), covered by waitingListInbox.test.ts
    ["inbox", () => getInboxRepository(REAL)],
    ["leads", () => getLeadsRepository(REAL)],
    ["quotes", () => getQuotesRepository(REAL)],
    ["jobs", () => getJobsRepository(REAL)],
    ["projects", () => getProjectsRepository(REAL)],
  ])("%s start empty", async (_name, repo) => {
    expect(await repo().list()).toEqual([]);
  });

  it("so Analytics for a real workspace is built from nothing, not from someone's fake invoices", async () => {
    const real = computeAnalytics({
      today: "2026-10-05",
      appointments: [],
      invoices: await getInvoicesRepository(REAL).list(),
      leads: await getLeadsRepository(REAL).list(),
      filters,
    });
    const empty = computeAnalytics({ today: "2026-10-05", appointments: [], invoices: [], leads: [], filters });
    expect(real).toEqual(empty);
  });

  it("any non-demo slug is treated the same (only the four demo slugs get demo data)", async () => {
    for (const slug of ["anna-beauty", "demo", "book", "x-demo-salon"]) {
      expect(await getInvoicesRepository(slug).list(), slug).toEqual([]);
      expect(await getInboxRepository(slug).list(), slug).toEqual([]);
    }
  });

  it("demo workspaces are untouched: they still get their demo data", async () => {
    expect(demoInvoices.length + demoLeads.length + demoConversations.length).toBeGreaterThan(0);
    for (const slug of ["demo-salon", "demo-werkstatt", "demo-cleaning", "demo-consulting"]) {
      expect((await getInvoicesRepository(slug).list()).length, slug).toBe(demoInvoices.length);
      expect((await getWaitingListRepository(slug).list()).length, slug).toBe(demoWaitingList.length);
      expect((await getInboxRepository(slug).list()).length, slug).toBe(demoConversations.length);
      expect((await getLeadsRepository(slug).list()).length, slug).toBe(demoLeads.length);
      expect((await getQuotesRepository(slug).list()).length, slug).toBe(demoQuotes.length);
      expect((await getJobsRepository(slug).list()).length, slug).toBe(demoJobs.length);
      expect((await getProjectsRepository(slug).list()).length, slug).toBe(demoProjects.length);
    }
  });
});
