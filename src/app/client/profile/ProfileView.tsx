"use client";

import { useEffect, useState } from "react";
import { LanguageSwitcher } from "@/components/ui";
import { CalendarSubscription } from "../bookings/CalendarSubscription";
import { getMyProfileAction, signOutClientAction, updateMyProfileAction, type MyProfile } from "@/server/actions/clientAccount.actions";
import type { Locale, Messages } from "@/lib/i18n";
import styles from "./ProfileView.module.css";

type SaveState = "idle" | "saving" | "saved" | "error" | "invalid";

/** Signed-in client's profile: contact details, language, calendar, sign out. */
export function ProfileView({ locale, client }: { locale: Locale; client: Messages["client"] }) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [save, setSave] = useState<SaveState>("idle");

  useEffect(() => {
    let cancelled = false;
    void getMyProfileAction().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setProfile(result.data);
        setFullName(result.data.fullName);
        setPhone(result.data.phone);
      } else {
        setLoadFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = profile !== null && (fullName.trim() !== profile.fullName || phone.trim() !== profile.phone);

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || save === "saving") return;
    setSave("saving");
    const result = await updateMyProfileAction({ fullName, phone });
    if (result.ok) {
      setProfile(result.data);
      setFullName(result.data.fullName);
      setPhone(result.data.phone);
      setSave("saved");
    } else {
      setSave(result.code === "invalid_input" ? "invalid" : "error");
    }
  }

  return (
    <div className={styles.body}>
      <h1 className={styles.title}>{client.profileTitle}</h1>

      <section className={styles.card} aria-labelledby="profile-contact">
        <h2 id="profile-contact" className={styles.cardTitle}>
          {client.profileContactTitle}
        </h2>
        {loadFailed ? (
          <p className={styles.error} role="alert">
            {client.errUnknown}
          </p>
        ) : !profile ? (
          <p className={styles.muted} role="status">
            …
          </p>
        ) : (
          <form className={styles.form} onSubmit={(e) => void onSave(e)} suppressHydrationWarning>
            <div className={styles.field}>
              <span className={styles.label}>{client.profileEmail}</span>
              <span className={styles.readonly}>{profile.email ?? "—"}</span>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>{client.profileName}</span>
              <input
                className={styles.input}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setSave("idle");
                }}
                autoComplete="name"
                maxLength={120}
                suppressHydrationWarning
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{client.profilePhone}</span>
              <input
                className={styles.input}
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setSave("idle");
                }}
                autoComplete="tel"
                inputMode="tel"
                maxLength={40}
                suppressHydrationWarning
              />
              <span className={styles.hint}>{client.profilePhoneHint}</span>
            </label>
            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={!dirty || save === "saving"}>
                {save === "saving" ? client.profileSaving : client.profileSave}
              </button>
              <span className={save === "error" || save === "invalid" ? styles.error : styles.muted} role="status" aria-live="polite">
                {save === "saved" ? client.profileSaved : save === "invalid" ? client.profileInvalid : save === "error" ? client.errUnknown : ""}
              </span>
            </div>
          </form>
        )}
      </section>

      <section className={styles.card} aria-labelledby="profile-language">
        <h2 id="profile-language" className={styles.cardTitle}>
          {client.profileLanguage}
        </h2>
        <LanguageSwitcher currentLocale={locale} />
      </section>

      <CalendarSubscription client={client} />

      <form action={signOutClientAction} className={styles.signOutRow} suppressHydrationWarning>
        <button type="submit" className={styles.signOut}>
          {client.signOut}
        </button>
      </form>
    </div>
  );
}
