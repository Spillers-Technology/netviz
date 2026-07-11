(() => {
  const triggers = [...document.querySelectorAll("[data-lightbox]")];
  if (!triggers.length) return;

  const dialog = document.createElement("dialog");
  dialog.className = "image-lightbox";
  dialog.setAttribute("aria-label", "Full-size image preview");
  dialog.innerHTML = `
    <div class="image-lightbox__shell">
      <button class="image-lightbox__close" type="button" aria-label="Close image preview">&times;</button>
      <div class="image-lightbox__viewport">
        <img class="image-lightbox__image" alt="">
      </div>
      <div class="image-lightbox__footer">
        <span class="image-lightbox__caption"></span>
        <span class="image-lightbox__hint">Click image for actual size &middot; Esc to close</span>
      </div>
    </div>`;
  document.body.append(dialog);

  const preview = dialog.querySelector(".image-lightbox__image");
  const caption = dialog.querySelector(".image-lightbox__caption");
  const closeButton = dialog.querySelector(".image-lightbox__close");
  let activeTrigger = null;

  const close = () => {
    if (!dialog.hasAttribute("open")) return;
    if (typeof dialog.close === "function") dialog.close();
    else {
      dialog.removeAttribute("open");
      activeTrigger?.focus({ preventScroll: true });
    }
  };

  const open = (trigger) => {
    const sourceImage = trigger.matches("img") ? trigger : trigger.querySelector("img");
    if (!sourceImage) return;
    activeTrigger = trigger;
    preview.classList.remove("is-zoomed");
    preview.src = trigger.dataset.lightboxSrc || sourceImage.currentSrc || sourceImage.src;
    preview.alt = sourceImage.alt || "Full-size preview";

    const figureCaption = trigger.closest("figure")?.querySelector("figcaption h3, figcaption strong, figcaption");
    caption.textContent = trigger.dataset.lightboxCaption || figureCaption?.textContent.trim() || sourceImage.alt || "";

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    closeButton.focus({ preventScroll: true });
  };

  triggers.forEach((trigger) => {
    const sourceImage = trigger.matches("img") ? trigger : trigger.querySelector("img");
    if (!sourceImage) return;
    if (trigger.matches("img")) {
      trigger.tabIndex = 0;
      trigger.setAttribute("role", "button");
    }
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-label", `Open full-size preview: ${sourceImage.alt || "product image"}`);
    trigger.title = trigger.title || "Open full-size preview";

    const host = trigger;
    if (host && !host.classList.contains("lightbox-host")) {
      host.classList.add("lightbox-host");
      const badge = document.createElement("span");
      badge.className = "lightbox-badge";
      badge.setAttribute("aria-hidden", "true");
      badge.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4M11 8v6M8 11h6"></path></svg><span>Expand</span>`;
      host.append(badge);
    }

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      open(trigger);
    });
    if (trigger.matches("img")) {
      trigger.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        open(trigger);
      });
    }
  });

  closeButton.addEventListener("click", close);
  preview.addEventListener("click", () => preview.classList.toggle("is-zoomed"));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.classList.contains("image-lightbox__viewport")) close();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => {
    preview.removeAttribute("src");
    activeTrigger?.focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.hasAttribute("open")) close();
  });
})();
