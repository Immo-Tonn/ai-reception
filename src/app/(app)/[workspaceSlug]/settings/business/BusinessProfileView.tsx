"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { Button, Icon, Input, SaveStatus, type SaveState } from "@/components/ui";
import { updateBusinessProfileAction } from "@/server/actions/businessProfile.actions";
import type { BusinessProfile } from "@/server/services/businessProfile.service";
import { businessCountries, businessCurrencies, businessIndustries } from "@/server/validation/businessProfile.schema";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Messages } from "@/lib/i18n";
import styles from "./page.module.css";

type Profile = BusinessProfile;

const codeToKey = {
  forbidden: "forbidden",
  unauthenticated: "unauthenticated",
  invalid_input: "invalidInput",
  not_found: "notFound",
  conflict: "conflict",
  unknown: "generic",
} as const;

function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function BusinessProfileView({
  workspaceSlug,
  initial,
  messages,
  errors,
  backLabel,
  statusLabels,
}: {
  workspaceSlug: string;
  initial: Profile;
  messages: Messages["businessProfile"];
  errors: Messages["repositoryErrors"];
  backLabel: string;
  statusLabels: { unsaved: string; saving: string; saved: string };
}) {
  const { locale } = useI18n();
  const [saved, setSaved] = useState<Profile>(initial);
  const [form, setForm] = useState<Profile>(initial);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = (Object.keys(form) as (keyof Profile)[]).some((key) => form[key] !== saved[key]);
  const withCurrent = (list: readonly string[], current: string) => (current === "" || list.includes(current) ? [...list] : [current, ...list]);
  const industries = withCurrent(businessIndustries, form.industry);
  const currencies = withCurrent(businessCurrencies, form.currency);
  const countries = withCurrent(businessCountries, form.country);

  const expireSaved = useCallback(() => setJustSaved(false), []);
  const status: SaveState = pending ? "saving" : error ? "error" : justSaved && !dirty ? "saved" : dirty ? "dirty" : "idle";

  function change(patch: Partial<Profile>) {
    setForm((value) => ({ ...value, ...patch }));
    setJustSaved(false);
    setError(null);
  }

  function save() {
    if (!dirty || pending || !form.name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await updateBusinessProfileAction(workspaceSlug, form);
      if (result.ok) {
        setSaved(result.data);
        setForm(result.data);
        setJustSaved(true);
      } else {
        setError(errors[codeToKey[result.code]]);
      }
    });
  }

  const text = (key: keyof Profile) => (event: React.ChangeEvent<HTMLInputElement>) => change({ [key]: event.target.value } as Partial<Profile>);

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <Link href={`/${workspaceSlug}/settings`} className={styles.backButton} aria-label={backLabel}>
          <Icon name="chevronRight" size={16} style={{ transform: "rotate(180deg)" }} />
        </Link>
        <div>
          <h1 className={styles.title}>{messages.title}</h1>
          <p className={styles.subtitle}>{messages.subtitle}</p>
        </div>
      </div>

      <div className={styles.form}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.sectionIdentity}</h2>
          <div className={styles.logoRow}>
            <span className={styles.logoAvatar} aria-hidden="true">
              {[...form.name.trim()][0]?.toUpperCase() ?? "?"}
            </span>
            <div>
              <div className={styles.logoLabel}>{messages.logoLabel}</div>
              <p className={styles.hint}>{messages.logoSoon}</p>
            </div>
          </div>
          <Input label={messages.nameLabel} value={form.name} maxLength={120} onChange={text("name")} />
          <label className={styles.field}>
            <span>{messages.industryLabel}</span>
            <select suppressHydrationWarning className={styles.select} value={form.industry} onChange={(e) => change({ industry: e.target.value })}>
              {industries.map((value) => (
                <option key={value} value={value}>
                  {messages.industries[value as keyof typeof messages.industries] ?? value}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{messages.descriptionLabel}</span>
            <textarea
              suppressHydrationWarning
              className={styles.textarea}
              rows={4}
              maxLength={1000}
              value={form.description}
              onChange={(e) => change({ description: e.target.value })}
            />
            <span className={styles.hint}>{messages.descriptionHint}</span>
          </label>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.sectionContact}</h2>
          <p className={styles.notice}>{messages.contactPublicNote}</p>
          <Input label={messages.phoneLabel} type="tel" value={form.phone} maxLength={40} onChange={text("phone")} />
          <Input label={messages.emailLabel} type="email" value={form.email} maxLength={254} onChange={text("email")} />
          <Input label={messages.websiteLabel} type="url" value={form.website} maxLength={300} onChange={text("website")} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.sectionLocation}</h2>
          <Input label={messages.addressLabel} value={form.addressLine1} maxLength={200} onChange={text("addressLine1")} />
          <div className={styles.twoCols}>
            <Input label={messages.postalLabel} value={form.postalCode} maxLength={20} onChange={text("postalCode")} />
            <Input label={messages.cityLabel} value={form.city} maxLength={100} onChange={text("city")} />
          </div>
          <label className={styles.field}>
            <span>{messages.countryLabel}</span>
            <select suppressHydrationWarning className={styles.select} value={form.country} onChange={(e) => change({ country: e.target.value })}>
              <option value="">{messages.countryNone}</option>
              {countries.filter(Boolean).map((code) => (
                <option key={code} value={code}>
                  {countryName(code, locale)}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.sectionRegional}</h2>
          <Input label={messages.timezoneLabel} value={form.timezone} onChange={text("timezone")} />
          <label className={styles.field}>
            <span>{messages.currencyLabel}</span>
            <select suppressHydrationWarning className={styles.select} value={form.currency} onChange={(e) => change({ currency: e.target.value as Profile["currency"] })}>
              {currencies.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.sectionBooking}</h2>
          <label className={styles.toggle}>
            <input
              suppressHydrationWarning
              type="checkbox"
              checked={form.publicBookingEnabled}
              onChange={(e) => change({ publicBookingEnabled: e.target.checked, discoverable: e.target.checked ? form.discoverable : false })}
            />
            <span>
              <span className={styles.toggleLabel}>{messages.publicBookingLabel}</span>
              <span className={styles.hint}>{messages.publicBookingHint.replace("{slug}", workspaceSlug)}</span>
            </span>
          </label>
          <label className={styles.toggle}>
            <input
              suppressHydrationWarning
              type="checkbox"
              checked={form.discoverable}
              disabled={!form.publicBookingEnabled}
              onChange={(e) => change({ discoverable: e.target.checked })}
            />
            <span>
              <span className={styles.toggleLabel}>{messages.discoverableLabel}</span>
              <span className={styles.hint}>{messages.discoverableHint}</span>
              {!form.publicBookingEnabled ? <span className={styles.hint}>{messages.discoverableNeedsBooking}</span> : null}
            </span>
          </label>
          <p className={styles.hint}>{messages.slugHint.replace("{slug}", workspaceSlug)}</p>
        </section>

        <SaveStatus state={status} labels={statusLabels} error={error} onSavedExpire={expireSaved} />

        <div className={styles.saveBar}>
          <Button fullWidth onClick={save} disabled={!dirty || pending || !form.name.trim()}>
            {pending ? statusLabels.saving : messages.save}
          </Button>
        </div>
      </div>
    </main>
  );
}
