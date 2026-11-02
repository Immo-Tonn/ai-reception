"use client";

import { useEffect, useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import {
  listDataSubjectRequestsAction,
  setDataSubjectRequestStatusAction,
} from "@/server/actions/dataSubjectRequests.actions";
import type { DataSubjectRequestRow, DsrStatus } from "@/server/services/clientExport.service";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";
import { localIsoDate } from "@/lib/date/localIsoDate";
import formStyles from "../AddClientSheet.module.css";
import styles from "./ExportClientSheet.module.css";

type Mode = "admin" | "data_subject_request";
type RequestType = keyof Messages["clients"]["exportRequestTypes"];

function isoPlusDays(base: string, days: number) {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
}

/**
 * Export of one client's data as a JSON download (owner / admin). Shows what is
 * included, the format and a confidentiality warning; internal notes only for
 * the owner after confirming the legal check. The file comes straight from the
 * server response (no-store) and is never stored or linked.
 */
export function ExportClientSheet({
  workspaceSlug,
  clientId,
  open,
  onClose,
  canExportInternalNotes,
  today,
  locale,
  messages,
}: {
  workspaceSlug: string;
  clientId: string;
  open: boolean;
  onClose: () => void;
  canExportInternalNotes: boolean;
  today: string;
  locale: Locale;
  messages: Messages["clients"];
}) {
  const [mode, setMode] = useState<Mode>("admin");
  const [internal, setInternal] = useState(false);
  const [internalChecked, setInternalChecked] = useState(false);
  const [type, setType] = useState<RequestType>("access");
  const [receivedOn, setReceivedOn] = useState(today);
  const [dueOn, setDueOn] = useState(isoPlusDays(today, 30));
  const [identityVerified, setIdentityVerified] = useState(false);
  const [status, setStatus] = useState<DsrStatus>("completed");
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [requests, setRequests] = useState<DataSubjectRequestRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listDataSubjectRequestsAction(workspaceSlug, clientId).then((r) => {
      if (!cancelled) setRequests(r.ok ? r.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceSlug, clientId]);

  const ready =
    !working &&
    (!internal || internalChecked) &&
    (mode === "admin" || (identityVerified && dueOn >= receivedOn));

  async function handleExport() {
    if (!ready) return;
    setWorking(true);
    setFailed(false);
    const body =
      mode === "admin"
        ? { mode, includeInternalNotes: internal }
        : { mode, includeInternalNotes: internal, request: { type, receivedOn, dueOn, identityVerified: true, status } };
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/clients/${encodeURIComponent(clientId)}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("export_failed");
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "client-export.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      if (mode === "data_subject_request") {
        const r = await listDataSubjectRequestsAction(workspaceSlug, clientId);
        if (r.ok) setRequests(r.data);
      }
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  }

  async function changeStatus(id: string, next: DsrStatus) {
    const r = await setDataSubjectRequestStatusAction(workspaceSlug, id, next);
    if (r.ok) setRequests((list) => (list ?? []).map((x) => (x.id === id ? { ...x, status: next } : x)));
  }

  const statusOptions = Object.entries(messages.exportStatuses) as [DsrStatus, string][];

  return (
    <Sheet open={open} onClose={onClose} title={messages.exportTitle}>
      <div className={formStyles.form}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>{messages.exportModeLabel}</legend>
          <label className={formStyles.checkRow}>
            <input suppressHydrationWarning type="radio" name="export-mode" checked={mode === "admin"} onChange={() => setMode("admin")} />
            <span>{messages.exportModeAdmin}</span>
          </label>
          <label className={formStyles.checkRow}>
            <input suppressHydrationWarning type="radio" name="export-mode" checked={mode === "data_subject_request"} onChange={() => setMode("data_subject_request")} />
            <span>{messages.exportModeRequest}</span>
          </label>
        </fieldset>

        <section className={styles.section}>
          <h3 className={styles.label}>{messages.exportCategoriesTitle}</h3>
          <ul className={styles.list}>
            {messages.exportCategories.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className={styles.note}>{messages.exportExcluded}</p>
          <p className={styles.note}>{messages.exportFormat}</p>
        </section>

        {mode === "data_subject_request" && (
          <section className={styles.section}>
            <label className={formStyles.field}>
              <span>{messages.exportRequestType}</span>
              <select suppressHydrationWarning className={styles.select} value={type} onChange={(e) => setType(e.target.value as RequestType)}>
                {Object.entries(messages.exportRequestTypes).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Input label={messages.exportReceivedOn} type="date" value={receivedOn} max={today} onChange={(e) => setReceivedOn(e.target.value)} />
            <Input label={messages.exportDueOn} type="date" value={dueOn} min={receivedOn} onChange={(e) => setDueOn(e.target.value)} />
            <label className={formStyles.field}>
              <span>{messages.exportStatus}</span>
              <select suppressHydrationWarning className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as DsrStatus)}>
                {statusOptions.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={formStyles.checkRow}>
              <input suppressHydrationWarning type="checkbox" checked={identityVerified} onChange={(e) => setIdentityVerified(e.target.checked)} />
              <span>{messages.exportIdentityVerified}</span>
            </label>
            <p className={styles.note}>{messages.exportDraftNotice}</p>
          </section>
        )}

        {canExportInternalNotes && (
          <section className={styles.section}>
            <label className={formStyles.checkRow}>
              <input suppressHydrationWarning
                type="checkbox"
                checked={internal}
                onChange={(e) => {
                  setInternal(e.target.checked);
                  setInternalChecked(false);
                }}
              />
              <span>{messages.exportInternalLabel}</span>
            </label>
            {internal && (
              <>
                <p className={styles.note}>{messages.exportInternalHint}</p>
                <label className={formStyles.checkRow}>
                  <input suppressHydrationWarning type="checkbox" checked={internalChecked} onChange={(e) => setInternalChecked(e.target.checked)} />
                  <span>{messages.exportInternalConfirm}</span>
                </label>
              </>
            )}
          </section>
        )}

        <p className={styles.warning} role="note">
          {messages.exportConfidential}
        </p>
        {failed ? (
          <p role="alert" className={formStyles.error}>
            {messages.exportError}
          </p>
        ) : null}
        <Button fullWidth onClick={handleExport} disabled={!ready}>
          {working ? messages.exportWorking : messages.exportSubmit}
        </Button>

        <section className={styles.section}>
          <h3 className={styles.label}>{messages.exportRequestsTitle}</h3>
          {requests && requests.length === 0 ? <p className={styles.note}>{messages.exportRequestsEmpty}</p> : null}
          {(requests ?? []).map((r) => (
            <div key={r.id} className={styles.request}>
              <span>
                {messages.exportRequestTypes[r.requestType]} · {formatDate(new Date(`${r.receivedOn}T00:00:00`), locale, { dateStyle: "medium" })} ·{" "}
                {messages.exportRequestDue.replace("{date}", formatDate(new Date(`${r.dueOn}T00:00:00`), locale, { dateStyle: "medium" }))}
              </span>
              <select suppressHydrationWarning
                className={styles.select}
                aria-label={messages.exportStatus}
                value={r.status}
                onChange={(e) => void changeStatus(r.id, e.target.value as DsrStatus)}
              >
                {statusOptions.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </section>
      </div>
    </Sheet>
  );
}
