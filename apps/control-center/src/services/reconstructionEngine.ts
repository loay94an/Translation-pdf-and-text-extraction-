import { jsPDF } from 'jspdf';
import { TextBlock, TranslatedPageData } from '../types/translation';

export interface RenderOptions {
  fontSizeAdjustment?: number;
  maskOpacity?: number;
  highlightPreservedGraphics?: boolean;
  activeBlockId?: string | null;
  targetLang?: string;
}

/**
 * Samples surrounding pixels to estimate page paper color
 */
/**
 * Samples surrounding pixels of each text block to precisely match local background color (paper color)
 */
function getLocalBackgroundColor(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number
): string {
  try {
    // Sample a few pixels just outside or on the border of the box
    const sampleX = Math.min(canvasWidth - 1, Math.max(0, Math.round(left - 3)));
    const sampleY = Math.min(canvasHeight - 1, Math.max(0, Math.round(top - 3)));
    const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];
    // If valid color, return it
    if (r >= 0 && g >= 0 && b >= 0) {
      return `rgb(${r}, ${g}, ${b})`;
    }
  } catch {
    // Fallback
  }
  return '#ffffff';
}

/**
 * Helper to split text into wrapped lines fitting within maxWidth
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  // If words contain spaces
  const words = text.split(/\s+/);
  if (words.length === 0) return [text];

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine + ' ' + word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Checks if target language is right-to-left
 */
export function isRtlLanguage(langCode?: string): boolean {
  if (!langCode) return true; // Default to Arabic (RTL)
  const rtlCodes = ['ar', 'fa', 'ur', 'he'];
  return rtlCodes.includes(langCode.toLowerCase());
}

/**
 * Core function to render a reconstructed translated page onto a destination canvas
 * keeping all graphics, schematics, borders, and visual background intact.
 */
export function renderReconstructedPage(
  destCanvas: HTMLCanvasElement,
  originalImage: HTMLImageElement | HTMLCanvasElement,
  pageData: TranslatedPageData,
  options: RenderOptions = {}
): void {
  const {
    fontSizeAdjustment = 0,
    maskOpacity = 1.0,
    highlightPreservedGraphics = false,
    activeBlockId = null,
    targetLang = 'ar',
  } = options;

  const width = originalImage.width;
  const height = originalImage.height;

  destCanvas.width = width;
  destCanvas.height = height;

  const ctx = destCanvas.getContext('2d');
  if (!ctx) return;

  // 1. Draw original scanned page background (all drawings, formulas, diagrams, photos)
  ctx.drawImage(originalImage, 0, 0, width, height);

  const isRtl = isRtlLanguage(targetLang);

  // 2. Process each text block
  for (const block of pageData.blocks) {
    const [ymin, xmin, ymax, xmax] = block.box2d;

    // Convert normalized coordinates (0-1000) to actual canvas pixels
    const top = (ymin / 1000) * height;
    const left = (xmin / 1000) * width;
    const bottom = (ymax / 1000) * height;
    const right = (xmax / 1000) * width;

    const boxWidth = Math.max(12, right - left);
    const boxHeight = Math.max(8, bottom - top);

    // Padding around text to cover original scanned letters without spilling
    const padX = Math.min(3, boxWidth * 0.03);
    const padY = Math.min(3, boxHeight * 0.03);

    const maskLeft = Math.max(0, left - padX);
    const maskTop = Math.max(0, top - padY);
    const maskWidth = Math.min(width - maskLeft, boxWidth + padX * 2);
    const maskHeight = Math.min(height - maskTop, boxHeight + padY * 2);

    const localBgColor = getLocalBackgroundColor(ctx, maskLeft, maskTop, maskWidth, maskHeight, width, height);

    // 2a. Mask original scanned text region cleanly with local background color
    ctx.save();
    ctx.globalAlpha = maskOpacity;
    ctx.fillStyle = block.backgroundColor || localBgColor;
    ctx.fillRect(maskLeft, maskTop, maskWidth, maskHeight);
    ctx.restore();

    // 2b. Compute optimal font size to fit neatly within the exact bounding box
    const baseSize = block.fontSizeEstimate
      ? (block.fontSizeEstimate / 1000) * height
      : Math.max(10, boxHeight * 0.65);

    let fontSize = Math.max(7, Math.min(64, baseSize + fontSizeAdjustment));
    const fontFamily = isRtl ? "'Cairo', 'Amiri', sans-serif" : "'Plus Jakarta Sans', sans-serif";
    const fontWeight = block.isBold || block.category === 'title' || block.category === 'heading' ? 'bold' : 'normal';

    ctx.save();
    ctx.direction = isRtl ? 'rtl' : 'ltr';

    let lines: string[] = [];
    let fits = false;
    let attempts = 0;

    while (!fits && attempts < 6 && fontSize >= 6) {
      ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      lines = wrapText(ctx, block.translatedText, maskWidth - 4);
      const lineHeight = fontSize * 1.15;
      const totalTextHeight = lines.length * lineHeight;

      if (totalTextHeight <= maskHeight * 1.1 || lines.length <= 1) {
        fits = true;
      } else {
        fontSize = Math.floor(fontSize * 0.85);
        attempts++;
      }
    }

    // 2c. Draw translated text inside exact bounds
    const lineHeight = fontSize * 1.15;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = block.textColor || '#0f172a';
    ctx.textBaseline = 'top';

    const startY = maskTop + Math.max(0, (maskHeight - lines.length * lineHeight) / 2);

    lines.forEach((line, index) => {
      const lineY = startY + index * lineHeight;
      if (isRtl) {
        ctx.textAlign = 'right';
        ctx.fillText(line, maskLeft + maskWidth - 2, lineY);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(line, maskLeft + 2, lineY);
      }
    });

    // 2d. Highlight active / selected block
    if (activeBlockId === block.id) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(maskLeft, maskTop, maskWidth, maskHeight);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
      ctx.fillRect(maskLeft, maskTop, maskWidth, maskHeight);
    } else if (highlightPreservedGraphics) {
      // Subtle indicator showing translated text boxes
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(maskLeft, maskTop, maskWidth, maskHeight);
    }

    ctx.restore();
  }
}

/**
 * Generates and downloads a complete multi-page Translated PDF document
 */
export async function exportTranslatedPDF(
  pagesToExport: Array<{
    pageNumber: number;
    originalImage: HTMLImageElement | HTMLCanvasElement;
    pageData: TranslatedPageData;
  }>,
  options: {
    filename?: string;
    targetLang?: string;
    fontSizeAdjustment?: number;
    bilingual?: boolean;
    onProgress?: (progress: { current: number; total: number; message: string }) => void;
  } = {}
): Promise<Blob> {
  const {
    filename = 'مستند_مترجم.pdf',
    targetLang = 'ar',
    fontSizeAdjustment = 0,
    bilingual = false,
    onProgress,
  } = options;

  if (pagesToExport.length === 0) {
    throw new Error('No translated pages available to export');
  }

  const firstPage = pagesToExport[0];
  const firstWidth = firstPage.originalImage.width;
  const firstHeight = firstPage.originalImage.height;

  // Convert pixel dimensions to points (72 DPI standard, 0.75 pt/px)
  const orientation = firstWidth > firstHeight ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    orientation,
    unit: 'pt',
    format: [firstWidth * 0.75, firstHeight * 0.75],
  });

  const offscreenCanvas = document.createElement('canvas');

  for (let i = 0; i < pagesToExport.length; i++) {
    const item = pagesToExport[i];
    const { pageNumber, originalImage, pageData } = item;

    onProgress?.({
      current: i + 1,
      total: pagesToExport.length,
      message: `جاري إعداد الصفحة ${pageNumber} من ${pagesToExport.length}...`,
    });

    const w = originalImage.width;
    const h = originalImage.height;
    const ptWidth = w * 0.75;
    const ptHeight = h * 0.75;

    if (i > 0) {
      pdf.addPage([ptWidth, ptHeight], w > h ? 'landscape' : 'portrait');
    }

    // 1. Render reconstructed translated page onto canvas
    renderReconstructedPage(offscreenCanvas, originalImage, pageData, {
      fontSizeAdjustment,
      maskOpacity: 1.0,
      targetLang,
    });

    const translatedDataUrl = offscreenCanvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(translatedDataUrl, 'JPEG', 0, 0, ptWidth, ptHeight);

    // If bilingual mode is selected, also append the original page right after
    if (bilingual) {
      pdf.addPage([ptWidth, ptHeight], w > h ? 'landscape' : 'portrait');
      let origDataUrl: string;
      if (originalImage instanceof HTMLCanvasElement) {
        origDataUrl = originalImage.toDataURL('image/jpeg', 0.92);
      } else {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx?.drawImage(originalImage, 0, 0);
        origDataUrl = tempCanvas.toDataURL('image/jpeg', 0.92);
      }
      pdf.addImage(origDataUrl, 'JPEG', 0, 0, ptWidth, ptHeight);
    }

    // Yield back to event loop so UI does not freeze during large exports
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const pdfBlob = pdf.output('blob');

  // Trigger browser download
  const downloadUrl = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);

  return pdfBlob;
}
