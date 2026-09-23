/**
 * ServiceOS booking widget loader — script-based embed (§3).
 *
 * Usage on a third-party site:
 *   <script src="https://<your-serviceos-domain>/embed.js"
 *           data-workspace="demo"
 *           data-origin="https://<your-serviceos-domain>"
 *           data-button-text="Book an appointment"
 *           async></script>
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
  var buttonText = currentScript.getAttribute("data-button-text") || "Book an appointment";
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
      "border-radius:20px",
      "overflow:hidden",
      "background:#f6f5f2",
      "position:relative",
    ].join(";");

    var closeButton = document.createElement("button");
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close");
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
    iframe.src = origin + "/book/" + encodeURIComponent(workspace) + "/embed";
    iframe.style.cssText = "width:100%;height:640px;max-height:90vh;border:none;display:block;";
    iframe.setAttribute("title", "ServiceOS booking");

    frameWrapper.appendChild(closeButton);
    frameWrapper.appendChild(iframe);
    overlay.appendChild(frameWrapper);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (overlay) {
      overlay.remove();
      overlay = null;
      document.body.style.overflow = "";
    }
  }

  button.addEventListener("click", openModal);
  document.body.appendChild(button);
})();
