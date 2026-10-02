import type { Messages } from "@/lib/i18n";
import type { PublicBaseUrlSource } from "@/lib/config/publicBaseUrl";
import type { BookingDistribution } from "@/features/distribution/urls";
import { CopyField } from "./CopyField";
import { QrCard } from "./QrCard";
import styles from "./OnlineBooking.module.css";

/**
 * "Online booking" — lets a business with no website of its own start
 * taking bookings: public link, website-button link, embed snippet, QR.
 * Every item points at the same existing booking flow.
 */
export function OnlineBookingSection({
  workspaceSlug,
  distribution,
  baseSource,
  labels,
}: {
  workspaceSlug: string;
  /** `null` when no public address is configured — nothing shareable can be built. */
  distribution: BookingDistribution | null;
  baseSource: PublicBaseUrlSource;
  labels: Messages["settings"]["onlineBooking"];
}) {
  return (
    <section className={styles.section} aria-labelledby="online-booking-title">
      <h2 id="online-booking-title" className={styles.sectionTitle}>
        {labels.title}
      </h2>
      <p className={styles.sectionDescription}>{labels.description}</p>

      {distribution === null ? (
        <div className={styles.notice} role="alert">
          <p className={styles.noticeTitle}>{labels.notConfiguredTitle}</p>
          <p>{labels.notConfiguredHint}</p>
        </div>
      ) : (
        <>
          {baseSource === "dev-fallback" && <p className={styles.noticeInline}>{labels.devAddressHint}</p>}
          <CopyField
            label={labels.publicLinkLabel}
            hint={labels.publicLinkHint}
            value={distribution.bookingUrl}
            labels={labels}
          />
          <CopyField
            label={labels.websiteLinkLabel}
            hint={labels.websiteLinkHint}
            value={distribution.websiteLinkUrl}
            labels={labels}
          />
          <CopyField
            label={labels.embedLabel}
            hint={labels.embedHint}
            value={distribution.scriptSnippet}
            multiline
            labels={labels}
          />
          <QrCard
            url={distribution.qrUrl}
            filenameBase={`booking-qr-${workspaceSlug}`}
            label={labels.qrLabel}
            hint={labels.qrHint}
            labels={labels}
          />
        </>
      )}

      <p className={styles.demoNote}>{labels.demoNote}</p>
    </section>
  );
}
