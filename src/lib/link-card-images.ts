// Keep links usable when an external preview or favicon cannot be loaded.
export function setupLinkCardImages(): void {
  document.querySelectorAll<HTMLImageElement>('.link-card img').forEach((image) => {
    const removeFailedImage = () => {
      const thumbnail = image.closest('.link-card-thumb');
      if (thumbnail) {
        image.closest('.link-card')?.classList.add('link-card--no-image');
        thumbnail.remove();
      } else {
        image.remove();
      }
    };

    image.addEventListener('error', removeFailedImage, { once: true });
    // Cached failures can precede the deferred module's event listeners.
    if (image.complete && image.naturalWidth === 0) removeFailedImage();
  });
}
