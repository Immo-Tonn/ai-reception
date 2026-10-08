/**
 * ServiceOS booking widget loader — script-based embed (§3).
 *
 * Usage on a third-party site:
 *   <script src="https://<your-serviceos-domain>/embed.js"
 *           data-workspace="demo"
 *           data-origin="https://<your-serviceos-domain>"
 *           async></script>
 *
 * Optional attributes: `data-button-text` (overrides the label),
 * `data-locale` (de | en | uk | ru; default: the host page's <html lang>,
 * then the browser language, then English).
 *
 * Renders nothing until the script tag loads, then injects a floating
 * "Book" button. Clicking it opens the SAME chromeless booking page
 * (`/book/<workspace>/embed`) used by the plain iframe embed, inside a
 * full-screen modal overlay — one booking engine, three presentations
 * (standalone page, inline iframe, script-triggered modal).
 */
(function () {
  // `document.currentScript` is unset for scripts injected by frameworks
  // (e.g. Next.js's <Script> component) — fall back to finding our own
  // tag by src so the loader works regardless of how it was inserted.
  var currentScript =
    document.currentScript || document.querySelector('script[src*="embed.js"]');
  if (!currentScript) return;

  var workspace = currentScript.getAttribute("data-workspace");
  var origin = currentScript.getAttribute("data-origin") || new URL(currentScript.src).origin;
  // Default button/close labels per locale — never English-only.
  var LABELS = {
    en: { book: "Book an appointment", close: "Close" },
    de: { book: "Termin buchen", close: "Schließen" },
    uk: { book: "Записатися", close: "Закрити" },
    ru: { book: "Записаться", close: "Закрыть" },
  };
  function pickLocale() {
    var raw =
      currentScript.getAttribute("data-locale") ||
      document.documentElement.lang ||
      navigator.language ||
      "en";
    var code = String(raw).slice(0, 2).toLowerCase();
    return LABELS[code] ? code : "en";
  }
  var labels = LABELS[pickLocale()];
  var buttonText = currentScript.getAttribute("data-button-text") || labels.book;

  // Mirrors src/features/embed/messages.ts (keep in sync; a unit test pins
  // the message names). The iframe may only talk to us from the booking
  // origin, and we only trust messages coming from our own iframe window.
  var RESIZE_MESSAGE = "serviceos-booking-resize";
  var HELLO_MESSAGE = "serviceos-booking-parent-hello";
  var MIN_HEIGHT = 200;
  var MAX_HEIGHT = 4000;
  var frameOrigin;
  try {
    frameOrigin = new URL(origin).origin;
  } catch (e) {
    console.error("[ServiceOS embed] invalid data-origin.");
    return;
  }
  if (!workspace) {
    console.error("[ServiceOS embed] missing data-workspace attribute on the script tag.");
    return;
  }

  var button = document.createElement("button");
  button.textContent = buttonText;
  button.setAttribute("type", "button");
  button.style.cssText = [
    "position:fixed",
    "right:20px",
    "bottom:20px",
    "z-index:999999",
    "padding:14px 22px",
    "border-radius:999px",
    "border:none",
    "background:#111111",
    "color:#f6f5f2",
    "font-size:15px",
    "font-family:system-ui,-apple-system,sans-serif",
    "font-weight:500",
    "box-shadow:0 8px 24px rgba(17,17,17,0.24)",
    "cursor:pointer",
  ].join(";");

  var overlay = null;
  var activeIframe = null;
  var lastContentHeight = 560;

  function applyHeight() {
    if (!activeIframe) return;
    // Never taller than the viewport — the iframe scrolls internally instead.
    var cap = Math.floor(window.innerHeight * 0.9);
    activeIframe.style.height = Math.min(lastContentHeight, cap) + "px";
  }

  function onMessage(event) {
    if (!activeIframe) return;
    if (event.origin !== frameOrigin) return;
    if (event.source !== activeIframe.contentWindow) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.type !== RESIZE_MESSAGE) return;
    if (typeof data.height !== "number" || !isFinite(data.height)) return;
    lastContentHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height)));
    applyHeight();
  }
  window.addEventListener("message", onMessage);
  window.addEventListener("resize", applyHeight);

  function openModal() {
    overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:999998",
      "background:rgba(17,17,17,0.4)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:16px",
    ].join(";");
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) closeModal();
    });

    var frameWrapper = document.createElement("div");
    frameWrapper.style.cssText = [
      "width:100%",
      "max-width:480px",
      "max-height:90vh",
      "max-height:90dvh",
      "border-radius:20px",
      "overflow:hidden",
      "background:#f6f5f2",
      "position:relative",
    ].join(";");

    var closeButton = document.createElement("button");
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", labels.close);
    closeButton.style.cssText = [
      "position:absolute",
      "top:8px",
      "right:8px",
      "z-index:1",
      "width:32px",
      "height:32px",
      "border-radius:999px",
      "border:none",
      "background:rgba(255,255,255,0.9)",
      "font-size:20px",
      "cursor:pointer",
    ].join(";");
    closeButton.addEventListener("click", closeModal);

    var iframe = document.createElement("iframe");
    iframe.src = frameOrigin + "/book/" + encodeURIComponent(workspace) + "/embed";
    // Initial height only; the booking page reports its real height via the
    // resize message (see onMessage) and `applyHeight` caps it to the viewport.
    iframe.style.cssText = "width:100%;border:none;display:block;";
    iframe.setAttribute("title", buttonText);
    activeIframe = iframe;
    lastContentHeight = 560;
    applyHeight();
    iframe.addEventListener("load", function () {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: HELLO_MESSAGE }, frameOrigin);
      }
    });

    frameWrapper.appendChild(closeButton);
    frameWrapper.appendChild(iframe);
    overlay.appendChild(frameWrapper);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (overlay) {
      activeIframe = null;
      overlay.remove();
      overlay = null;
      document.body.style.overflow = "";
    }
  }

  button.addEventListener("click", openModal);
  document.body.appendChild(button);
})();
