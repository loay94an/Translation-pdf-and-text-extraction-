import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker source using local same-origin build to avoid cross-origin and CSP worker restrictions
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

export interface PDFDocumentInfo {
  numPages: number;
  fingerprint: string;
  title?: string;
}

export class PDFHandler {
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  private cachedPageRenders = new Map<number, { dataUrl: string; width: number; height: number }>();

  async loadFromUrl(url: string): Promise<PDFDocumentInfo> {
    this.cachedPageRenders.clear();
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`تعذر جلب المستند (خطأ السيرفر ${res.status})`);
      }
      const buffer = await res.arrayBuffer();
      return this.loadFromArrayBuffer(buffer);
    } catch (err) {
      console.error('Failed to load PDF from URL:', err);
      throw new Error(`تعذر تحميل ملف الـ PDF: ${(err as Error).message}`);
    }
  }

  async loadFromArrayBuffer(data: ArrayBuffer): Promise<PDFDocumentInfo> {
    this.cachedPageRenders.clear();
    const loadingTask = pdfjsLib.getDocument({
      data,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
      cMapPacked: true,
    });
    this.pdfDoc = await loadingTask.promise;
    return {
      numPages: this.pdfDoc.numPages,
      fingerprint: this.pdfDoc.fingerprints?.[0] || '',
    };
  }

  getNumPages(): number {
    return this.pdfDoc?.numPages || 0;
  }

  /**
   * Render a specific page to an offscreen canvas and return high-res JPEG dataUrl and dimensions.
   * scale = 1.5 - 2.0 provides ideal OCR sharpness without excessive memory usage.
   */
  async renderPageToDataUrl(
    pageNumber: number,
    scale: number = 1.75
  ): Promise<{ dataUrl: string; width: number; height: number }> {
    if (!this.pdfDoc) {
      throw new Error('PDF document not loaded');
    }

    if (this.cachedPageRenders.has(pageNumber) && scale === 1.75) {
      return this.cachedPageRenders.get(pageNumber)!;
    }

    const page = await this.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    // Fill white background for scanned pages
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };

    await page.render(renderContext).promise;

    // Use JPEG with 0.88 quality for optimal OCR quality vs network transfer size
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const result = {
      dataUrl,
      width: canvas.width,
      height: canvas.height,
    };

    if (scale === 1.75) {
      this.cachedPageRenders.set(pageNumber, result);
    }

    return result;
  }

  clearCache() {
    this.cachedPageRenders.clear();
  }
}
