(function () {
  const cfg = (window.CONFIG || {});
  if (cfg.ENV !== "TEST") return; // Ne s’active qu’en TEST

  function injectDiagnostics() {
    const details = document.createElement("details");
    details.open = true;

    const summary = document.createElement("summary");
    summary.textContent = "Diagnostics";

    const pre = document.createElement("pre");
    pre.id = "diag";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.background = "#111";
    pre.style.color = "#0f0";
    pre.style.padding = "8px";
    pre.style.borderRadius = "6px";
    pre.style.overflow = "auto";
    pre.style.maxHeight = "220px";

    details.appendChild(summary);
    details.appendChild(pre);
    document.body.prepend(details);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectDiagnostics);
  } else {
    injectDiagnostics();
  }
})();
