/**
 * Hands a Blob to the browser as a file download.
 *
 * Goes through an object URL rather than pointing an anchor at the API: a blob:
 * URL is same-origin, so the `download` attribute is honoured and our filename
 * sticks. Linking straight to the API (a different port, so cross-origin) would
 * make the browser ignore `download` entirely.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; one turn of
  // the event loop is enough for it to have started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
