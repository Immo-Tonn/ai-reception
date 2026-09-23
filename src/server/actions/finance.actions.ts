"use server";

import { getSession } from "@/server/auth/session";
import * as financeService from "@/server/services/finance.service";
import type { CreateInvoiceInput, UpdateInvoiceStatusInput } from "@/server/validation/finance.schema";

export async function getFinanceSummaryAction(workspaceId: string) {
  const session = await getSession(workspaceId);
  return financeService.getFinanceSummary(session);
}

export async function createInvoiceAction(workspaceId: string, input: CreateInvoiceInput) {
  const session = await getSession(workspaceId);
  return financeService.createInvoice(session, input);
}

export async function updateInvoiceStatusAction(
  workspaceId: string,
  input: UpdateInvoiceStatusInput,
) {
  const session = await getSession(workspaceId);
  return financeService.updateInvoiceStatus(session, input);
}
