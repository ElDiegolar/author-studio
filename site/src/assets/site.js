/* Author Studio landing page. No dependencies.
 *
 * DOWNLOADS is the single place to change installer links.
 * build.mjs also reads `windows` from here and writes it into the HTML,
 * so the link works without JavaScript too.
 * Use null for a platform that is not released yet.
 */
const DOWNLOADS = {
  windows: "https://github.com/ElDiegolar/author-studio/releases/download/v0.1.0/AuthorStudio-Setup-0.1.0.exe",
  macos: null,
  ios: null,
  releaseNotes: "https://github.com/ElDiegolar/author-studio/releases/tag/v0.1.0",
};

(function () {
  "use strict";

  // Download links
  document.querySelectorAll("[data-download]").forEach(function (el) {
    var url = DOWNLOADS[el.getAttribute("data-download")];
    if (url) el.setAttribute("href", url);
  });
  if (DOWNLOADS.releaseNotes) {
    document.querySelectorAll("[data-release]").forEach(function (el) {
      var a = document.createElement("a");
      a.href = DOWNLOADS.releaseNotes;
      a.textContent = el.textContent;
      el.replaceWith(a);
    });
  }

  // "This is me" / "Not me" demo toggle
  document.querySelectorAll(".verdict").forEach(function (group) {
    var buttons = group.querySelectorAll("button");
    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        buttons.forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
      });
    });
  });

  // Entrance fade-up
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var items = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  items.forEach(function (el) { io.observe(el); });
})();
