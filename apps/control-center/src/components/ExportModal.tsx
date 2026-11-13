import React, { useState } from 'react';
import {
  X,
  Download,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Sparkles,
  Loader2,
  Share2,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { TranslatedPageData } from '../types/translation';
import { exportTranslatedPDF } from '../services/reconstructionEngine';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentName: string;
  currentPage: number;
  totalPages: number;
  translations: Record<number, TranslatedPageData>;
  getPageImage: (pageNumber: number) => Promise<HTMLImageElement | null>;
  targetLang: string;
  fontSizeAdjustment: number;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  documentName,
  currentPage,
  totalPages,
  translations,
  getPageImage,
  targetLang,
  fontSizeAdjustment,
}) => {
  const [exportMode, setExportMode] = useState<'translated_pdf' | 'bilingual_pdf' | 'current_png' | 'markdown_text'>(
    'translated_pdf'
  );
  const [rangeMode, setRangeMode] = useState<'all_translated' | 'current_only' | 'custom'>('all_translated');
  const [customRange, setCustomRange] = useState<string>('1-5');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [exportSuccess, setExportSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const translatedPageNums = Object.keys(translations)
    .map(Number)
    .sort((a, b) => a - b);

  const getTargetPages = (): number[] => {
    if (rangeMode === 'current_only') {
      return translations[currentPage] ? [currentPage] : [];
    }
    if (rangeMode === 'all_translated') {
      return translatedPageNums;
    }
    // Custom range like "1-5, 8"
    const pages: number[] = [];
    const parts = customRange.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let p = start; p <= end; p++) {
            if (translations[p] && !pages.includes(p)) pages.push(p);
          }
        }
      } else {
        const p = Number(trimmed);
        if (!isNaN(p) && translations[p] && !pages.includes(p)) pages.push(p);
      }
    }
    return pages.sort((a, b) => a - b);
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setExportSuccess(false);

      const targetPages = getTargetPages();
      if (targetPages.length === 0) {
        alert('لم يتم العثور على صفحات مترجمة ضمن النطاق المحدد.');
        setIsExporting(false);
        return;
      }

      const cleanDocName = (documentName || 'مستند')
        .replace(/\.[^/.]+$/, '')
        .replace(/[^\w\u0600-\u06FF\s-_]/gi, '');

      // Mode: Markdown or Text
      if (exportMode === 'markdown_text') {
        let mdContent = `# ترجمة مستند: ${cleanDocName}\n\n`;
        mdContent += `*تمت الترجمة بواسطة مترجم الـ PDF المصور الذكي*\n\n---\n\n`;

        for (const p of targetPages) {
          const data = translations[p];
          if (!data) continue;
          mdContent += `## الصفحة ${p}\n\n`;
          if (data.summary) {
            mdContent += `> **ملخص الصفحة:** ${data.summary}\n\n`;
          }
          for (const b of data.blocks) {
            mdContent += `### [${b.category}] ${b.translatedText}\n`;
            mdContent += `*الأصل:* ${b.originalText}\n\n`;
          }
          mdContent += `---\n\n`;
        }

        const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${cleanDocName}_مترجم.md`;
        a.click();
        URL.revokeObjectURL(url);

        setExportSuccess(true);
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        setIsExporting(false);
        return;
      }

      // Mode: High-Res Current PNG
      if (exportMode === 'current_png') {
        setProgressMsg('جاري تحضير صورة الصفحة عالية الدقة...');
        const pageImg = await getPageImage(currentPage);
        const pageData = translations[currentPage];
        if (!pageImg || !pageData) {
          throw new Error('بيانات الصفحة الحالية غير متوفرة');
        }

        const offscreenCanvas = document.createElement('canvas');
        const { renderReconstructedPage } = await import('../services/reconstructionEngine');
        renderReconstructedPage(offscreenCanvas, pageImg, pageData, {
          fontSizeAdjustment,
          maskOpacity: 1.0,
          targetLang,
        });

        const dataUrl = offscreenCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${cleanDocName}_صفحة_${currentPage}_مترجمة.png`;
        a.click();

        setExportSuccess(true);
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        setIsExporting(false);
        return;
      }

      // Mode: PDF (Preserved Layout or Bilingual)
      const pagesToExport: Array<{
        pageNumber: number;
        originalImage: HTMLImageElement;
        pageData: TranslatedPageData;
      }> = [];

      for (let i = 0; i < targetPages.length; i++) {
        const pageNum = targetPages[i];
        setProgressMsg(`جاري تحميل خلفية الصفحة ${pageNum} (${i + 1}/${targetPages.length})...`);
        const img = await getPageImage(pageNum);
        if (img && translations[pageNum]) {
          pagesToExport.push({
            pageNumber: pageNum,
            originalImage: img,
            pageData: translations[pageNum],
          });
        }
      }

      const isBilingual = exportMode === 'bilingual_pdf';
      const outputFilename = isBilingual
        ? `${cleanDocName}_مترجم_ثنائي_اللغة.pdf`
        : `${cleanDocName}_مترجم_محفوظ_الرسوم.pdf`;

      await exportTranslatedPDF(pagesToExport, {
        filename: outputFilename,
        targetLang,
        fontSizeAdjustment,
        bilingual: isBilingual,
        onProgress: (p) => setProgressMsg(p.message),
      });

      setExportSuccess(true);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء التصدير: ' + (err as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const targetPages = getTargetPages();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">تصدير المستند المترجم</h3>
              <p className="text-xs text-slate-400">
                إعادة إنشاء ملف PDF بجودة فائقة مع الحفاظ التام على الرسوم
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {/* Format selection */}
          <div className="space-y-2">
            <span className="font-semibold text-slate-300 block">اختر صيغة التصدير:</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setExportMode('translated_pdf')}
                className={`p-3 rounded-xl border text-right transition flex flex-col gap-1.5 ${
                  exportMode === 'translated_pdf'
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    <FileCheck2 className="w-4 h-4 text-emerald-400" />
                    <span>ملف PDF مترجم</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-semibold">
                    موصى به
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 leading-normal">
                  تنسيق متطابق 100% مع الحفاظ الكامل على الرسوم والمخططات
                </span>
              </button>

              <button
                onClick={() => setExportMode('bilingual_pdf')}
                className={`p-3 rounded-xl border text-right transition flex flex-col gap-1.5 ${
                  exportMode === 'bilingual_pdf'
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    <Share2 className="w-4 h-4 text-sky-400" />
                    <span>PDF ثنائي اللغة</span>
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 leading-normal">
                  صفحة بالمسح الأصلي تليها الصفحة المترجمة للمقارنة الرسمية
                </span>
              </button>

              <button
                onClick={() => setExportMode('current_png')}
                className={`p-3 rounded-xl border text-right transition flex flex-col gap-1.5 ${
                  exportMode === 'current_png'
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <span className="font-bold flex items-center gap-1.5">
                  <ImageIcon className="w-4 h-4 text-amber-400" />
                  <span>صورة عالية الدقة PNG</span>
                </span>
                <span className="text-[11px] text-slate-400 leading-normal">
                  تصدير الصفحة الحالية المعروضة كصورة مفردة
                </span>
              </button>

              <button
                onClick={() => setExportMode('markdown_text')}
                className={`p-3 rounded-xl border text-right transition flex flex-col gap-1.5 ${
                  exportMode === 'markdown_text'
                    ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <span className="font-bold flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-purple-400" />
                  <span>ملف نصوص Markdown</span>
                </span>
                <span className="text-[11px] text-slate-400 leading-normal">
                  تصدير كافة النصوص المستخرجة والمترجمة كملف نصي
                </span>
              </button>
            </div>
          </div>

          {/* Page Range Selection (if PDF or Markdown) */}
          {exportMode !== 'current_png' && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="font-semibold text-slate-300 block">الصفحات المراد تضمينها:</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setRangeMode('all_translated')}
                  className={`flex-1 p-2 rounded-lg border text-center transition ${
                    rangeMode === 'all_translated'
                      ? 'bg-indigo-950/70 border-indigo-500 text-white font-medium'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  جميع المترجمة ({translatedPageNums.length})
                </button>
                <button
                  onClick={() => setRangeMode('current_only')}
                  className={`flex-1 p-2 rounded-lg border text-center transition ${
                    rangeMode === 'current_only'
                      ? 'bg-indigo-950/70 border-indigo-500 text-white font-medium'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  الصفحة الحالية (#{currentPage})
                </button>
                <button
                  onClick={() => setRangeMode('custom')}
                  className={`flex-1 p-2 rounded-lg border text-center transition ${
                    rangeMode === 'custom'
                      ? 'bg-indigo-950/70 border-indigo-500 text-white font-medium'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  تحديد نطاق
                </button>
              </div>

              {rangeMode === 'custom' && (
                <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 flex items-center gap-2">
                  <span className="text-slate-400">نطاق الصفحات:</span>
                  <input
                    type="text"
                    value={customRange}
                    onChange={(e) => setCustomRange(e.target.value)}
                    placeholder="مثال: 1-5, 8, 12"
                    className="flex-1 bg-slate-900 border border-slate-700 px-2 py-1 rounded text-white font-mono outline-none"
                  />
                </div>
              )}
            </div>
          )}

          {/* Progress / Status Display */}
          {isExporting && (
            <div className="p-3 bg-emerald-950/50 rounded-xl border border-emerald-500/40 flex items-center gap-3 animate-pulse">
              <Loader2 className="w-5 h-5 text-emerald-400 animate-spin flex-shrink-0" />
              <div className="text-xs">
                <p className="font-bold text-emerald-200">جاري إنشاء وتصدير الملف المترجم...</p>
                <p className="text-emerald-400/80 text-[11px] mt-0.5">{progressMsg}</p>
              </div>
            </div>
          )}

          {exportSuccess && (
            <div className="p-3 bg-emerald-950/60 rounded-xl border border-emerald-500/50 flex items-center gap-2 text-emerald-200 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>تم تنزيل المستند بنجاح على جهازك!</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition disabled:opacity-40"
          >
            إغلاق
          </button>

          <button
            onClick={handleExport}
            disabled={isExporting || (exportMode !== 'current_png' && targetPages.length === 0)}
            className="flex items-center gap-2 px-6 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>
              {isExporting
                ? 'جاري التصدير...'
                : `تصدير وتنزيل (${exportMode === 'current_png' ? '1 صورة' : `${targetPages.length} صفحة`})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
