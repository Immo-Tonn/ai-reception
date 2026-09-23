"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

/**
 * Inline iframe embed (§3) — listens for the `serviceos-booking-resize`
 * postMessage the embedded page sends (see BookingWizard's chromeless
 * effect) and grows/shrinks to fit, so the host site never gets an
 * inner scrollbar.
 */
export function ResizingIframe({ src }: { src: string }) {
  const [height, setHeight] = useState(480);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "serviceos-booking-resize" && typeof event.data.height === "number") {
        setHeight(event.data.height);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title="ServiceOS booking"
      className={styles.iframeFrame}
      style={{ height }}
    />
  );
}
