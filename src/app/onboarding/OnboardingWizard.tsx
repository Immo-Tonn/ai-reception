"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import styles from "./page.module.css";

type Messages_ = Messages["onboarding"];

type IndustryKey =
  | "industryBeauty"
  | "industryCleaning"
  | "industryAuto"
  | "industryRepair"
  | "industryPhotography"
  | "industryEducation"
  | "industryConsulting"
  | "industryAgency"
  | "industryFitness"
  | "industryOther";

const industries: IndustryKey[] = [
  "industryBeauty",
  "industryCleaning",
  "industryAuto",
  "industryRepair",
  "industryPhotography",
  "industryEducation",
  "industryConsulting",
  "industryAgency",
  "industryFitness",
  "industryOther",
];

type ModeKey = "modeAppointments" | "modeJobs" | "modeProjects";
type ModeHintKey = "modeAppointmentsHint" | "modeJobsHint" | "modeProjectsHint";

const modes: { key: ModeKey; hint: ModeHintKey }[] = [
  { key: "modeAppointments", hint: "modeAppointmentsHint" },
  { key: "modeJobs", hint: "modeJobsHint" },
  { key: "modeProjects", hint: "modeProjectsHint" },
];

interface Service {
  name: string;
  duration: string;
  price: string;
}

const TOTAL_STEPS = 6;

export function OnboardingWizard({ messages }: { messages: Messages_ }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState<IndustryKey | null>(null);
  const [mode, setMode] = useState<ModeKey | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [draft, setDraft] = useState<Service>({ name: "", duration: "", price: "" });
  const [defaultHours, setDefaultHours] = useState(true);
  const [includePrivateBucket, setIncludePrivateBucket] = useState(false);

  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  function goBack() {
    if (step === 0) {
      router.push("/signup");
      return;
    }
    setStep((value) => value - 1);
  }

  function goNext() {
    if (step === TOTAL_STEPS - 1) {
      router.push("/demo/today");
      return;
    }
    setStep((value) => value + 1);
  }

  function addService() {
    if (!draft.name.trim()) return;
    setServices((value) => [...value, draft]);
    setDraft({ name: "", duration: "", price: "" });
  }

  const canContinue =
    (step === 0 && industry !== null) || (step === 1 && mode !== null) || step >= 2;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={goBack} aria-label={messages.back}>
          <Icon name="chevronRight" size={18} style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <span className={styles.stepLabel}>
          {messages.stepLabel
            .replace("{current}", String(step + 1))
            .replace("{total}", String(TOTAL_STEPS))}
        </span>
      </header>

      <div className={styles.content}>
        {step === 0 && (
          <>
            <h1 className={styles.stepTitle}>{messages.industryTitle}</h1>
            <p className={styles.stepSubtitle}>{messages.industrySubtitle}</p>
            <div className={styles.optionGrid}>
              {industries.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`${styles.optionCard} ${industry === key ? styles.optionCardSelected : ""}`}
                  onClick={() => setIndustry(key)}
                >
                  <span className={styles.optionTitle}>{messages[key]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className={styles.stepTitle}>{messages.modeTitle}</h1>
            <p className={styles.stepSubtitle}>{messages.modeSubtitle}</p>
            <div className={styles.optionList}>
              {modes.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`${styles.optionCard} ${mode === item.key ? styles.optionCardSelected : ""}`}
                  onClick={() => setMode(item.key)}
                >
                  <span className={styles.optionTitle}>{messages[item.key]}</span>
                  <span className={styles.optionHint}>{messages[item.hint]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className={styles.stepTitle}>{messages.servicesTitle}</h1>
            <p className={styles.stepSubtitle}>{messages.servicesSubtitle}</p>

            {services.length > 0 && (
              <div className={styles.serviceList}>
                {services.map((service, index) => (
                  <div key={`${service.name}-${index}`} className={styles.serviceRow}>
                    <span className={styles.serviceRowName}>{service.name}</span>
                    <span className={styles.serviceRowMeta}>
                      {service.duration ? `${service.duration} min` : ""}
                      {service.duration && service.price ? " · " : ""}
                      {service.price ? `€${service.price}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.serviceForm}>
              <Input
                label={messages.serviceNamePlaceholder}
                value={draft.name}
                onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
              />
              <Input
                label={messages.serviceDurationPlaceholder}
                inputMode="numeric"
                value={draft.duration}
                onChange={(event) => setDraft((d) => ({ ...d, duration: event.target.value }))}
              />
              <Input
                label={messages.servicePricePlaceholder}
                inputMode="decimal"
                value={draft.price}
                onChange={(event) => setDraft((d) => ({ ...d, price: event.target.value }))}
              />
            </div>
            <Button variant="secondary" type="button" onClick={addService}>
              {messages.addService}
            </Button>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className={styles.stepTitle}>{messages.hoursTitle}</h1>
            <p className={styles.stepSubtitle}>{messages.hoursSubtitle}</p>
            <div className={styles.hoursCard}>
              <div>
                <div className={styles.hoursLabel}>{messages.hoursDefault}</div>
                <div className={styles.hoursValue}>{messages.hoursWeekend}</div>
              </div>
              <button
                type="button"
                className={`${styles.toggle} ${defaultHours ? styles.toggleOn : ""}`}
                role="switch"
                aria-checked={defaultHours}
                onClick={() => setDefaultHours((v) => !v)}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1 className={styles.stepTitle}>{messages.bucketsTitle}</h1>
            <p className={styles.stepSubtitle}>{messages.bucketsSubtitle}</p>

            <div className={`${styles.bucketCard} ${styles.bucketMain}`}>
              <div className={styles.bucketBody}>
                <span className={styles.bucketName}>{messages.bucketMain}</span>
                <span className={styles.bucketHint}>{messages.bucketMainHint}</span>
              </div>
              <Icon name="check" size={18} />
            </div>

            <div className={`${styles.bucketCard} ${styles.bucketPrivate}`}>
              <div className={styles.bucketBody}>
                <span className={styles.bucketName}>{messages.bucketPrivate}</span>
                <span className={styles.bucketHint}>{messages.bucketPrivateHint}</span>
              </div>
              <button
                type="button"
                className={`${styles.toggle} ${includePrivateBucket ? styles.toggleOn : ""}`}
                role="switch"
                aria-checked={includePrivateBucket}
                onClick={() => setIncludePrivateBucket((v) => !v)}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>

            <Button variant="secondary" type="button">
              {messages.bucketAddCustom}
            </Button>
          </>
        )}

        {step === 5 && (
          <>
            <h1 className={styles.stepTitle}>{messages.readyTitle}</h1>
            <p className={styles.stepSubtitle}>{messages.readySubtitle}</p>

            <div className={styles.summaryList}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{messages.readySummaryIndustry}</span>
                <span className={styles.summaryValue}>
                  {industry ? messages[industry] : "—"}
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{messages.readySummaryMode}</span>
                <span className={styles.summaryValue}>{mode ? messages[mode] : "—"}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{messages.readySummaryServices}</span>
                <span className={styles.summaryValue}>
                  {messages.servicesAdded.replace("{count}", String(services.length))}
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{messages.readySummaryBuckets}</span>
                <span className={styles.summaryValue}>
                  {includePrivateBucket
                    ? `${messages.bucketMain}, ${messages.bucketPrivate}`
                    : messages.bucketMain}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className={styles.footer}>
        {step < TOTAL_STEPS - 1 && step >= 2 && (
          <Button variant="secondary" className={styles.footerSkip} onClick={goNext}>
            {messages.skip}
          </Button>
        )}
        <Button
          className={styles.footerNext}
          fullWidth
          onClick={goNext}
          disabled={!canContinue}
        >
          {step === TOTAL_STEPS - 1 ? messages.finish : messages.next}
        </Button>
      </div>
    </div>
  );
}
