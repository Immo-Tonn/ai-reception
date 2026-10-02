"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import styles from "./OnlineBooking.module.css";

function triggerDownload(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * QR code for the public booking URL. Generated in the browser (no
 * third-party service sees the URL). Always rendered black-on-white on a
 * white tile regardless of theme — inverted QR codes scan unreliably.
 * Download as PNG (print/share) or SVG (vector, any print size).
 */
export function QrCard({
  url,
  filenameBase,
  label,
  hint,
  labels,
}: {
  url: string;
  filenameBase: string;
  label: string;
  hint: string;
  labels: { downloadPng: string; downloadSvg: string; qrAlt: string };
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("qrcode").then(async (QRCode) => {
      const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 2, errorCorrectionLevel: "M" });
      if (!cancelled) setPreview(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function downloadPng() {
    const QRCode = await import("qrcode");
    const dataUrl = await QRCode.toDataURL(url, { width: 1024, margin: 4, errorCorrectionLevel: "M" });
    triggerDownload(dataUrl, `${filenameBase}.png`);
  }

  async function downloadSvg() {
    const QRCode = await import("qrcode");
    const svg = await QRCode.toString(url, { type: "svg", margin: 4, errorCorrectionLevel: "M" });
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    triggerDownload(blobUrl, `${filenameBase}.svg`);
    URL.revokeObjectURL(blobUrl);
  }

  return (
    <div className={styles.block}>
      <p className={styles.blockLabel}>{label}</p>
      <p className={styles.blockHint}>{hint}</p>
      <div className={styles.qrRow}>
        <div className={styles.qrTile}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={labels.qrAlt} width={192} height={192} className={styles.qrImage} />
          ) : null}
        </div>
        <div className={styles.qrActions}>
          <Button variant="secondary" size="sm" onClick={downloadPng} disabled={!preview}>
            {labels.downloadPng}
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadSvg} disabled={!preview}>
            {labels.downloadSvg}
          </Button>
        </div>
      </div>
    </div>
  );
}
