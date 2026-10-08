"use client";

import { useEffect, useRef, useState } from "react";
import { EMBED_HELLO_MESSAGE, parseResizeMessage } from "@/features/embed/messages";
import styles from "./page.module.css";

/**
 * Inline iframe embed (§3) — grows/shrinks to the height the embedded
 * booking page reports, so the host site never gets an inner scrollbar.
 *
 * Only accepts resize messages that come from THIS iframe's window and the
 * booking app's own origin (see features/embed/messages.ts), and greets the
 * iframe with a hello addressed to that origin so it can reply to us
 * instead of broadcasting to "*".
 */
export function ResizingIframe({ src }: { src: string }) {
  const [height, setHeight] = useState(480);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frameOrigin = new URL(src, window.location.href).origin;

    function handleMessage(event: MessageEvent) {
      const next = parseResizeMessage(event, {
        origin: frameOrigin,
        source: iframeRef.current?.contentWindow,
      });
      if (next !== null) setHeight(next);
    }
    function sendHello() {
      iframeRef.current?.contentWindow?.postMessage({ type: EMBED_HELLO_MESSAGE }, frameOrigin);
    }

    window.addEventListener("message", handleMessage);
    const iframe = iframeRef.current;
    iframe?.addEventListener("load", sendHello);
    return () => {
      window.removeEventListener("message", handleMessage);
      iframe?.removeEventListener("load", sendHello);
    };
  }, [src]);

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
