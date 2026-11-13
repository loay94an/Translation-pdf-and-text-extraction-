import React, { useEffect, useRef, useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Eye,
  Columns,
  Type,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  FileSearch,
  Layers,
  ArrowRightLeft,
} from 'lucide-react';
import { TextBlock, TranslatedPageData, TranslationSettings } from '../types/translation';
import { renderReconstructedPage } from '../services/reconstructionEngine';

interface DocumentViewerProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  originalImage: HTMLImageElement | null;
  translatedData: TranslatedPageData | null;
  settings: TranslationSettings;
  onUpdateSettings: (newSettings: Partial<TranslationSettings>) => void;
  isTranslatingCurrentPage: boolean;
  onTranslateCurrentPage: () => void;
  onSelectBlock: (block: TextBlock) => void;
  activeBlockId: string | null;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  originalImage,
  translatedData,
  settings,
  onUpdateSettings,
  isTranslatingCurrentPage,
  onTranslateCurrentPage,
  onSelectBlock,
  activeBlockId,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [showGraphicsHighlight, setShowGraphicsHighlight] = useState<boolean>(false);
  const [pageJumpVal, setPageJumpVal] = useState<string>(String(currentPage));
  const [mobileDualTab, setMobileDualTab] = useState<'translated' | 'original'>('translated');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dualOriginalCanvasRef = useRef<HTMLCanvasElement>(null);
  const dualTranslatedCanvasRef = useRef<HTMLCanvasElement>(null);

  // Sync jump input with current page
  useEffect(() => {
    setPageJumpVal(String(currentPage));
  }, [currentPage]);

  // Render canvas whenever originalImage, translatedData, settings, or activeBlock changes
  useEffect(() => {
    if (!originalImage) return;

    if (settings.renderMode === 'in_place' || settings.renderMode === 'text_focus') {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (translatedData) {
        renderReconstructedPage(canvas, originalImage, translatedData, {
          fontSizeAdjustment: settings.fontSizeAdjustment,
          maskOpacity: settings.maskOpacity,
          highlightPreservedGraphics: showGraphicsHighlight,
          activeBlockId,
          targetLang: settings.targetLang,
        });
      } else {
        // Draw original scan directly
        canvas.width = originalImage.width;
        canvas.height = originalImage.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(originalImage, 0, 0);
        }
      }
    } else if (settings.renderMode === 'dual_view') {
      // Dual view mode
      const origCanvas = dualOriginalCanvasRef.current;
      const transCanvas = dualTranslatedCanvasRef.current;

      if (origCanvas) {
        origCanvas.width = originalImage.width;
        origCanvas.height = originalImage.height;
        const ctx = origCanvas.getContext('2d');
        ctx?.drawImage(originalImage, 0, 0);

        if (translatedData && ctx) {
          ctx.save();
          for (const b of translatedData.blocks) {
            const [ymin, xmin, ymax, xmax] = b.box2d;
            const top = (ymin / 1000) * originalImage.height;
            const left = (xmin / 1000) * originalImage.width;
            const w = (xmax / 1000) * originalImage.width - left;
            const h = (ymax / 1000) * originalImage.height - top;

            ctx.strokeStyle = activeBlockId === b.id ? '#3b82f6' : 'rgba(99, 102, 241, 0.45)';
            ctx.lineWidth = activeBlockId === b.id ? 3 : 1.5;
            ctx.strokeRect(left, top, w, h);
          }
          ctx.restore();
        }
      }

      if (transCanvas) {
        if (translatedData) {
          renderReconstructedPage(transCanvas, originalImage, translatedData, {
            fontSizeAdjustment: settings.fontSizeAdjustment,
            maskOpacity: settings.maskOpacity,
            highlightPreservedGraphics: showGraphicsHighlight,
            activeBlockId,
            targetLang: settings.targetLang,
          });
        } else {
          transCanvas.width = originalImage.width;
          transCanvas.height = originalImage.height;
          const ctx = transCanvas.getContext('2d');
          ctx?.drawImage(originalImage, 0, 0);
        }
      }
    }
  }, [
    originalImage,
    translatedData,
    settings.renderMode,
    settings.fontSizeAdjustment,
    settings.maskOpacity,
    settings.targetLang,
    showGraphicsHighlight,
    activeBlockId,
  ]);

  // Handle clicking on canvas to detect text block click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!translatedData || !originalImage) return;

    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    for (const block of translatedData.blocks) {
      const [ymin, xmin, ymax, xmax] = block.box2d;
      const top = (ymin / 1000) * canvas.height;
      const left = (xmin / 1000) * canvas.width;
      const bottom = (ymax / 1000) * canvas.height;
      const right = (xmax / 1000) * canvas.width;

      if (clickX >= left && clickX <= right && clickY >= top && clickY <= bottom) {
        onSelectBlock(block);
        return;
      }
    }
  };

  const handlePageJump = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(pageJumpVal, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      onPageChange(pageNum);
    } else {
      setPageJumpVal(String(currentPage));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden relative">
      {/* Viewer Navigation & Controls Subheader */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-3 md:px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs z-20">
        {/* Page Nav (Prev, Jump, Next) */}
        <div className="flex items-center gap-1.5 md:gap-2">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 transition"
            title="الصفحة السابقة"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <form onSubmit={handlePageJump} className="flex items-center gap-1">
            <span className="text-slate-400 text-[11px]">ص</span>
            <input
              type="text"
              value={pageJumpVal}
              onChange={(e) => setPageJumpVal(e.target.value)}
              onBlur={handlePageJump}
              className="w-10 md:w-12 text-center py-1 bg-slate-950 border border-slate-700 rounded-md text-white font-medium focus:border-indigo-500 outline-none text-xs"
            />
            <span className="text-slate-400 text-[11px]">/ {totalPages || 1}</span>
          </form>

          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 transition"
            title="الصفحة التالية"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* View Mode Switcher (Desktop/Tablet) */}
        <div className="hidden sm:flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => onUpdateSettings({ renderMode: 'in_place' })}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
              settings.renderMode === 'in_place'
                ? 'bg-indigo-600 text-white font-medium shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>ترجمة مطابقة</span>
          </button>

          <button
            onClick={() => onUpdateSettings({ renderMode: 'dual_view' })}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
              settings.renderMode === 'dual_view'
                ? 'bg-indigo-600 text-white font-medium shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>شاشتان</span>
          </button>

          <button
            onClick={() => onUpdateSettings({ renderMode: 'text_focus' })}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
              settings.renderMode === 'text_focus'
                ? 'bg-indigo-600 text-white font-medium shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileSearch className="w-3.5 h-3.5" />
            <span>النصوص</span>
          </button>
        </div>

        {/* Display Tuning (Font Size & Zoom) */}
        <div className="flex items-center gap-2">
          {/* Toggle Graphics Bounding Boxes */}
          <button
            onClick={() => setShowGraphicsHighlight(!showGraphicsHighlight)}
            className={`hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md border transition ${
              showGraphicsHighlight
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="إبراز إطارات النصوص المترجمة والرسومات المحمية"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>إبراز التنسيق</span>
          </button>

          {/* Font Size Adjustment */}
          <div className="flex items-center gap-0.5 bg-slate-800 px-1.5 py-0.5 rounded-md border border-slate-700">
            <Type className="w-3 h-3 text-slate-400" />
            <button
              onClick={() =>
                onUpdateSettings({
                  fontSizeAdjustment: Math.max(-4, settings.fontSizeAdjustment - 1),
                })
              }
              className="px-1 text-slate-300 hover:text-white font-bold"
              title="تصغير خط الترجمة"
            >
              -
            </button>
            <span className="text-[10px] text-slate-300 w-4 text-center font-mono">
              {settings.fontSizeAdjustment >= 0
                ? `+${settings.fontSizeAdjustment}`
                : settings.fontSizeAdjustment}
            </span>
            <button
              onClick={() =>
                onUpdateSettings({
                  fontSizeAdjustment: Math.min(8, settings.fontSizeAdjustment + 1),
                })
              }
              className="px-1 text-slate-300 hover:text-white font-bold"
              title="تكبير خط الترجمة"
            >
              +
            </button>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 bg-slate-800 p-0.5 rounded-md border border-slate-700">
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.3, Number((z - 0.15).toFixed(2))))}
              className="p-1 text-slate-300 hover:text-white"
              title="تصغير"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-slate-300 px-0.5 w-8 text-center font-mono">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
              className="p-1 text-slate-300 hover:text-white"
              title="تكبير"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel(1.0)}
              className="p-1 text-slate-300 hover:text-white border-r border-slate-700 pr-1 mr-0.5"
              title="ملاءمة الشاشة"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Canvas Viewport Area */}
      <div className="flex-1 overflow-auto p-2 sm:p-4 md:p-6 pdf-viewport-container flex flex-col items-center justify-start relative">
        {/* Untranslated status banner */}
        {!translatedData && !isTranslatingCurrentPage && (
          <div className="sticky top-1 z-30 mb-3 px-3.5 py-2 rounded-xl bg-slate-900/95 border border-indigo-500/30 text-slate-200 shadow-xl backdrop-blur flex items-center justify-between gap-3 max-w-xl w-full">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0"></span>
              <p className="text-[11px] sm:text-xs">
                الصفحة <span className="font-bold text-white">{currentPage}</span> غير مترجمة بعد.
              </p>
            </div>
            <button
              onClick={onTranslateCurrentPage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>ترجمة الآن</span>
            </button>
          </div>
        )}

        {/* Translation in progress overlay banner */}
        {isTranslatingCurrentPage && (
          <div className="sticky top-1 z-30 mb-3 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-indigo-500/50 text-slate-100 shadow-2xl backdrop-blur flex items-center gap-3 max-w-md w-full animate-pulse">
            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin flex-shrink-0" />
            <div className="text-xs">
              <p className="font-bold text-indigo-200">
                جاري التعرف على النصوص وحفظ الرسوم (Gemini OCR)...
              </p>
              <p className="text-slate-400 text-[10px] mt-0.5">
                استخراج الكتل النصية ومطابقة إحداثيات الرسوم...
              </p>
            </div>
          </div>
        )}

        {/* Success badge if translated */}
        {translatedData && (
          <div className="sticky top-1 z-30 mb-2 px-3 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 text-xs shadow-md backdrop-blur flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-[11px]">
              مترجمة بالكامل مع حفظ الرسوم ({translatedData.blocks.length} عنصر نصي)
            </span>
          </div>
        )}

        {/* 1. In-Place Translation View (Default Mobile-Optimized) */}
        {settings.renderMode === 'in_place' && (
          <div
            className="w-full flex justify-center items-center transition-transform duration-150 origin-top"
            style={{
              transform: zoomLevel !== 1.0 ? `scale(${zoomLevel})` : undefined,
              maxWidth: '100%',
            }}
          >
            <div className="max-w-full overflow-hidden shadow-2xl rounded-sm bg-white border border-slate-700">
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                className="block max-w-full h-auto object-contain cursor-crosshair"
                title="انقر على أي نص مترجم لتعديله أو معاينته"
              />
            </div>
          </div>
        )}

        {/* 2. Dual View (Mobile: Toggle Tab / Desktop: Side-by-Side) */}
        {settings.renderMode === 'dual_view' && (
          <div className="w-full flex flex-col items-center">
            {/* Mobile Segmented Switcher for Dual View */}
            <div className="lg:hidden flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 mb-3 w-full max-w-xs">
              <button
                onClick={() => setMobileDualTab('translated')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                  mobileDualTab === 'translated'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>المترجمة</span>
              </button>
              <button
                onClick={() => setMobileDualTab('original')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                  mobileDualTab === 'original'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>الأصلية</span>
              </button>
            </div>

            {/* Desktop Side-by-Side & Mobile Tabbed */}
            <div
              className="w-full flex flex-col lg:flex-row gap-4 lg:gap-6 items-center lg:items-start justify-center transition-transform duration-150 origin-top"
              style={{
                transform: zoomLevel !== 1.0 ? `scale(${zoomLevel})` : undefined,
                maxWidth: '100%',
              }}
            >
              {/* Original Scanned Canvas */}
              <div
                className={`flex flex-col items-center max-w-full ${
                  mobileDualTab === 'original' ? 'flex' : 'hidden lg:flex'
                }`}
              >
                <div className="mb-2 px-3 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-slate-300 text-xs font-medium">
                  المسح الضوئي الأصلي (صفحة {currentPage})
                </div>
                <div className="max-w-full overflow-hidden shadow-2xl rounded-sm bg-white border border-slate-700">
                  <canvas
                    ref={dualOriginalCanvasRef}
                    onClick={handleCanvasClick}
                    className="block max-w-full h-auto object-contain cursor-pointer"
                  />
                </div>
              </div>

              {/* Translated Canvas */}
              <div
                className={`flex flex-col items-center max-w-full ${
                  mobileDualTab === 'translated' ? 'flex' : 'hidden lg:flex'
                }`}
              >
                <div className="mb-2 px-3 py-0.5 rounded-md bg-indigo-950 border border-indigo-500/40 text-indigo-200 text-xs font-medium flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-indigo-400" />
                  <span>الصفحة المترجمة مطابقة التنسيق</span>
                </div>
                <div className="max-w-full overflow-hidden shadow-2xl rounded-sm bg-white border border-slate-700">
                  <canvas
                    ref={dualTranslatedCanvasRef}
                    onClick={handleCanvasClick}
                    className="block max-w-full h-auto object-contain cursor-crosshair"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. Text Focus View */}
        {settings.renderMode === 'text_focus' && (
          <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
            {/* Visual canvas preview */}
            <div className="flex flex-col items-center bg-slate-900 p-3 md:p-4 rounded-xl border border-slate-800 w-full">
              <h3 className="text-xs font-semibold text-slate-200 mb-2">المعاينة البصرية</h3>
              <div className="max-w-full overflow-auto shadow-xl rounded-sm bg-white max-h-[500px]">
                <canvas ref={canvasRef} onClick={handleCanvasClick} className="block max-w-full h-auto" />
              </div>
            </div>

            {/* Extracted Blocks List */}
            <div className="bg-slate-900 p-3 md:p-4 rounded-xl border border-slate-800 flex flex-col max-h-[600px] w-full">
              <div className="flex items-center justify-between mb-2 border-b border-slate-800 pb-2">
                <h3 className="text-xs font-semibold text-slate-200">
                  النصوص المستخرجة ({translatedData?.blocks.length || 0})
                </h3>
                <span className="text-[11px] text-slate-400">انقر للتعديل المباشر</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {translatedData?.blocks.map((block) => (
                  <div
                    key={block.id}
                    onClick={() => onSelectBlock(block)}
                    className={`p-2.5 rounded-lg border text-xs cursor-pointer transition ${
                      activeBlockId === block.id
                        ? 'bg-indigo-950/60 border-indigo-500 shadow-md ring-1 ring-indigo-500'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
                        {block.category || 'نص'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-1.5 text-slate-200">
                      <div className="p-1.5 bg-slate-900 rounded border border-slate-800 text-[11px]">
                        <span className="block text-[9px] text-slate-500">الأصل:</span>
                        <p className="line-clamp-2 text-slate-300">{block.originalText}</p>
                      </div>
                      <div className="p-1.5 bg-indigo-950/40 rounded border border-indigo-500/20 text-[11px]">
                        <span className="block text-[9px] text-indigo-400">الترجمة:</span>
                        <p className="line-clamp-2 text-indigo-100 font-semibold">
                          {block.translatedText}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {!translatedData && (
                  <div className="py-8 text-center text-slate-500 text-xs">
                    لم تتم ترجمة نصوص هذه الصفحة بعد.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Action Button for Mobile when Untranslated */}
      {!translatedData && !isTranslatingCurrentPage && (
        <button
          onClick={onTranslateCurrentPage}
          className="sm:hidden fixed bottom-16 right-4 z-30 p-3.5 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-2xl shadow-indigo-500/50 flex items-center justify-center border border-indigo-400/40 active:scale-95 transition"
          aria-label="ترجمة الصفحة"
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};
