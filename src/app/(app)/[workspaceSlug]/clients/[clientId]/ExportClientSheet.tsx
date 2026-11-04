"use client";

import { useEffect, useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import {
  applyDataSubjectRequestActionAction,
  listDataSubjectRequestsAction,
  registerDataSubjectRequestAction,
} from "@/server/actions/dataSubjectRequests.actions";
import type { DataSubjectRequestRow, DsrChannel, DsrCloseReason, DsrReopenReason, RequestAction } from "@/server/services/clientExport.service";
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
  const [notice, setNotice] = useState<string | null>(null);
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

  async function reloadRequests() {
    const r = await listDataSubjectRequestsAction(workspaceSlug, clientId);
    if (r.ok) setRequests(r.data);
  }

  /** Produces the file. In request mode the register is written in the same database transaction. */
  async function runExport(body: Record<string, unknown>) {
    setWorking(true);
    setFailed(false);
    setNotice(null);
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
      if (body.mode === "data_subject_request") setNotice(messages.exportGeneratedNotice);
    } catch {
      setFailed(true);
    } finally {
      if (body.mode === "data_subject_request") await reloadRequests();
      setWorking(false);
    }
  }

  function handleExport() {
    if (!ready) return;
    void runExport(
      mode === "admin"
        ? { mode, includeInternalNotes: internal }
        : { mode, includeInternalNotes: internal, request: { type, receivedOn, dueOn, identityVerified: true } },
    );
  }

  async function handleRegister() {
    if (working || dueOn < receivedOn) return;
    setWorking(true);
    setFailed(false);
    setNotice(null);
    const r = await registerDataSubjectRequestAction(workspaceSlug, clientId, { type, receivedOn, dueOn, identityVerified });
    if (r.ok) await reloadRequests();
    else setFailed(true);
    setWorking(false);
  }

  async function applyAction(id: string, action: RequestAction) {
    setWorking(true);
    setFailed(false);
    setNotice(null);
    const r = await applyDataSubjectRequestActionAction(workspaceSlug, id, action);
    if (r.ok) await reloadRequests();
    else setFailed(true);
    setWorking(false);
  }

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
        {notice ? (
          <p role="status" className={styles.note}>
            {notice}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className={formStyles.error}>
            {messages.exportError}
          </p>
        ) : null}
        <Button fullWidth onClick={handleExport} disabled={!ready}>
          {working ? messages.exportWorking : messages.exportSubmit}
        </Button>
        {mode === "data_subject_request" ? (
          <Button fullWidth variant="secondary" onClick={() => void handleRegister()} disabled={working || dueOn < receivedOn}>
            {messages.exportRegister}
          </Button>
        ) : null}

        <section className={styles.section}>
          <h3 className={styles.label}>{messages.exportRequestsTitle}</h3>
          {requests && requests.length === 0 ? <p className={styles.note}>{messages.exportRequestsEmpty}</p> : null}
          {(requests ?? []).map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              locale={locale}
              messages={messages}
              busy={working}
              onAction={(action) => void applyAction(r.id, action)}
              onExport={() => void runExport({ mode: "data_subject_request", includeInternalNotes: false, requestId: r.id })}
            />
          ))}
        </section>
      </div>
    </Sheet>
  );
}

/** One request: its state and only the steps the database allows next. */
function RequestRow({
  request: r,
  locale,
  messages,
  busy,
  onAction,
  onExport,
}: {
  request: DataSubjectRequestRow;
  locale: Locale;
  messages: Messages["clients"];
  busy: boolean;
  onAction: (action: RequestAction) => void;
  onExport: () => void;
}) {
  const [channel, setChannel] = useState<DsrChannel>("email");
  const [reason, setReason] = useState<DsrCloseReason>("fulfilled");
  const [reopenReason, setReopenReason] = useState<DsrReopenReason>("closed_by_mistake");
  const date = (iso: string) => formatDate(new Date(iso), locale, { dateStyle: "medium" });
  const closed = r.status === "closed";
  return (
    <div className={styles.request}>
      <span>
        {messages.exportRequestTypes[r.requestType]} · {date(`${r.receivedOn}T00:00:00`)} ·{" "}
        {messages.exportRequestDue.replace("{date}", date(`${r.dueOn}T00:00:00`))}
      </span>
      <strong>
        {messages.exportStatuses[r.status]}
        {r.closureReason ? ` · ${messages.exportCloseReasons[r.closureReason]}` : ""}
      </strong>
      {r.exportCount > 0 ? <span className={styles.note}>{messages.exportCount.replace("{n}", String(r.exportCount))}</span> : null}
      {r.deliveredAt && r.deliveryChannel ? (
        <span className={styles.note}>
          {messages.exportDeliveredNote.replace("{date}", date(r.deliveredAt)).replace("{channel}", messages.exportChannels[r.deliveryChannel])}
        </span>
      ) : null}
      {r.reopenCount > 0 ? <span className={styles.note}>{messages.exportReopenedCount.replace("{n}", String(r.reopenCount))}</span> : null}
      {closed ? (
        <div className={styles.requestStep}>
          <select suppressHydrationWarning className={styles.select} aria-label={messages.exportReopenLabel} value={reopenReason} onChange={(e) => setReopenReason(e.target.value as DsrReopenReason)}>
            {(Object.entries(messages.exportReopenReasons) as [DsrReopenReason, string][]).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => onAction({ kind: "reopen", reason: reopenReason })} disabled={busy}>
            {messages.exportReopen}
          </Button>
        </div>
      ) : (
        <div className={styles.requestActions}>
          {!r.identityVerified ? (
            <Button variant="secondary" onClick={() => onAction({ kind: "verify_identity" })} disabled={busy}>
              {messages.exportIdentityVerified}
            </Button>
          ) : null}
          {r.status === "open" ? (
            <Button variant="secondary" onClick={() => onAction({ kind: "start" })} disabled={busy}>
              {messages.exportStart}
            </Button>
          ) : null}
          {r.identityVerified ? (
            <Button variant="secondary" onClick={onExport} disabled={busy}>
              {r.exportCount > 0 ? messages.exportAgain : messages.exportGenerate}
            </Button>
          ) : null}
          {r.status === "export_generated" ? (
            <div className={styles.requestStep}>
              <select suppressHydrationWarning className={styles.select} aria-label={messages.exportChannelLabel} value={channel} onChange={(e) => setChannel(e.target.value as DsrChannel)}>
                {(Object.entries(messages.exportChannels) as [DsrChannel, string][]).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => onAction({ kind: "record_delivery", channel })} disabled={busy}>
                {messages.exportRecordDelivery}
              </Button>
            </div>
          ) : null}
          <div className={styles.requestStep}>
            <select suppressHydrationWarning className={styles.select} aria-label={messages.exportCloseLabel} value={reason} onChange={(e) => setReason(e.target.value as DsrCloseReason)}>
              {(Object.entries(messages.exportCloseReasons) as [DsrCloseReason, string][]).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => onAction({ kind: "close", reason })} disabled={busy}>
              {messages.exportClose}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
