// Adapted from itdog's renderScreenshotBlob; the station's own branding is retained.
export async function screenshot(element: HTMLElement, hideTarget: boolean, hideLocation: boolean, action: 'download' | 'copy' = 'download') {
  const { default: html2canvas } = await import('html2canvas');
  const width = Math.max(element.scrollWidth, element.clientWidth, ...Array.from(element.querySelectorAll<HTMLElement>('.standard-probe-results-table-wrap')).map(node => node.scrollWidth + 32));
  const canvas = await html2canvas(element, {
    backgroundColor: '#edf1f5', scale: Math.min(devicePixelRatio || 1, 2), useCORS: true,
    onclone(document) {
      document.querySelectorAll<HTMLElement>('[data-screenshot-mask]').forEach(node => {
        const kinds = node.dataset.screenshotMask?.split(' ') || [];
        if (hideTarget && kinds.includes('target') || hideLocation && kinds.includes('location')) {
          if (node.tagName === 'INPUT') (node as HTMLInputElement).value = '••••••'; else node.textContent = '••••••';
        }
      });
      document.querySelectorAll<HTMLElement>('.standard-probe-results-table-wrap').forEach(node => {
        node.style.overflow = 'visible';
        node.style.width = `${node.scrollWidth}px`;
      });
      const column = document.querySelector<HTMLElement>('.tool-column');
      if (column) { column.style.width = `${width}px`; column.style.maxWidth = 'none'; }
    },
    width
  });
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('screenshot failed');
  if (action === 'copy' && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return 'copied'; } catch { /* Download remains available when clipboard permissions are denied. */ }
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `dnspup-${Date.now()}.png`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return action === 'copy' ? 'copy-fallback' : 'downloaded';
}
