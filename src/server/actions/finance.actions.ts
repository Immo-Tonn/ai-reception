"use server";

import { getSession } from "@/server/auth/session";
import * as financeService from "@/server/services/finance.service";
import { assertFeatureEnabled } from "@/server/features";
import { runAction, type ActionResult } from "./result";
import type {
  CreateInvoiceInput,
  RecordPaymentInput,
  UpdateInvoiceInput,
  UpdateInvoiceStatusInput,
} from "@/server/validation/finance.schema";
import type { Invoice } from "@/features/finance/types";

export async function getFinanceSummaryAction(workspaceId: string): Promise<ActionResult<financeService.FinanceSummary>> {
  return runAction(async () => {
    assertFeatureEnabled("finance");
    return financeService.getFinanceSummary(await getSession(workspaceId));
  });
}

export async function listInvoicesAction(workspaceId: string): Promise<ActionResult<Invoice[]>> {
  return runAction(async () => {
    assertFeatureEnabled("finance");
    return financeService.listInvoices(await getSession(workspaceId));
  });
}

export async function getInvoiceAction(workspaceId: string, id: string): Promise<ActionResult<Invoice | undefined>> {
  return runAction(async () => {
    assertFeatureEnabled("finance");
    return financeService.getInvoice(await getSession(workspaceId), id);
  });
}

export async function createInvoiceAction(workspaceId: string, input: CreateInvoiceInput): Promise<ActionResult<Invoice>> {
  return runAction(async () => {
    assertFeatureEnabled("finance");
    return financeService.createInvoice(await getSession(workspaceId), input);
  });
}

export async function updateInvoiceAction(workspaceId: string, input: UpdateInvoiceInput): Promise<ActionResult<Invoice>> {
  return runAction(async () => {
    assertFeatureEnabled("finance");
    return financeService.updateInvoice(await getSession(workspaceId), input);
  });
}

export async function updateInvoiceStatusAction(
  workspaceId: string,
  input: UpdateInvoiceStatusInput,
): Promise<ActionResult<Invoice | undefined>> {
  return runAction(async () => {
    assertFeatureEnabled("finance");
    return financeService.updateInvoiceStatus(await getSession(workspaceId), input);
  });
}

export async function recordPaymentAction(workspaceId: string, input: RecordPaymentInput): Promise<ActionResult<Invoice>> {
  return runAction(async () => {
    assertFeatureEnabled("finance");
    return financeService.recordPayment(await getSession(workspaceId), input);
  });
}
