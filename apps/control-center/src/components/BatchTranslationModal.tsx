import React, { useState } from 'react';
import {
  X,
  Layers,
  Play,
  Pause,
  StopCircle,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
} from 'lucide-react';

interface BatchTranslationModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalPages: number;
  currentPage: number;
  translatedPages: number[];
  onStartBatch: (pagesToTranslate: number[]) => void;
  onStopBatch: () => void;
  isBatchRunning: boolean;
  batchProgress: {
    current: number;
    total: number;
    currentPageNum: number;
    completedPages: number[];
    failedPages: number[];
  } | null;
}

export const BatchTranslationModal: React.FC<BatchTranslationModalProps> = ({
  isOpen,
  onClose,
  totalPages,
  currentPage,
  translatedPages,
  onStartBatch,
  onStopBatch,
  isBatchRunning,
  batchProgress,
}) => {
  const [rangeMode, setRangeMode] = useState<'quick_5' | 'quick_10' | 'custom' | 'untranslated'>(
    'quick_5'
  );
  const [startPage, setStartPage] = useState<number>(currentPage);
  const [endPage, setEndPage] = useState<number>(Math.min(totalPages, currentPage + 4));

  if (!isOpen) return null;

  const calculateTargetPages = (): number[] => {
    if (rangeMode === 'quick_5') {
      const start = currentPage;
      const end = Math.min(totalPages, start + 4);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    if (rangeMode === 'quick_10') {
      const start = currentPage;
      const end = Math.min(totalPages, start + 9);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    if (rangeMode === 'untranslated') {
      const pages: number[] = [];
      for (let i = 1; i <= Math.min(totalPages, 50); i++) {
        if (!translatedPages.includes(i)) {
          pages.push(i);
        }
      }
      return pages;
    }
    // Custom range
    const s = Math.max(1, Math.min(totalPages, startPage));
    const e = Math.max(s, Math.min(totalPages, endPage));
    return Array.from({ length: e - s + 1 }, (_, i) => s + i);
  };

  const pagesToProcess = calculateTargetPages();
  const progressPercent = batchProgress
    ? Math.round((batchProgress.current / batchProgress.total) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/15 text-sky-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">ترجمة الصفحات بالدفعات (Batch Translation)</h3>
              <p className="text-xs text-slate-400">
                ترجمة عدة صفحات تلقائياً مع الحفاظ على التنسيق والرسومات
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isBatchRunning}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 text-xs">
          {!isBatchRunning ? (
            <>
              {/* Range Options */}
              <div className="space-y-2">
                <span className="font-semibold text-slate-300 block">اختر نطاق الترجمة:</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setRangeMode('quick_5')}
                    className={`p-3 rounded-xl border text-right transition flex flex-col gap-1 ${
                      rangeMode === 'quick_5'
                        ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-bold">5 صفحات متتالية</span>
                    <span className="text-[11px] text-slate-400">
                      من صفحة {currentPage} إلى {Math.min(totalPages, currentPage + 4)}
                    </span>
                  </button>

                  <button
                    onClick={() => setRangeMode('quick_10')}
                    className={`p-3 rounded-xl border text-right transition flex flex-col gap-1 ${
                      rangeMode === 'quick_10'
                        ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-bold">10 صفحات متتالية</span>
                    <span className="text-[11px] text-slate-400">
                      من صفحة {currentPage} إلى {Math.min(totalPages, currentPage + 9)}
                    </span>
                  </button>

                  <button
                    onClick={() => setRangeMode('untranslated')}
                    className={`p-3 rounded-xl border text-right transition flex flex-col gap-1 ${
                      rangeMode === 'untranslated'
                        ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-bold">الصفحات غير المترجمة</span>
                    <span className="text-[11px] text-slate-400">
                      تخطي الصفحات التي تمت ترجمتها سابقاً
                    </span>
                  </button>

                  <button
                    onClick={() => setRangeMode('custom')}
                    className={`p-3 rounded-xl border text-right transition flex flex-col gap-1 ${
                      rangeMode === 'custom'
                        ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-bold">نطاق مخصص</span>
                    <span className="text-[11px] text-slate-400">حدد البداية والنهاية يدوياً</span>
                  </button>
                </div>
              </div>

              {/* Custom Range Inputs */}
              {rangeMode === 'custom' && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">من صفحة:</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={startPage}
                      onChange={(e) => setStartPage(Number(e.target.value))}
                      className="w-16 p-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-center outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">إلى صفحة:</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={endPage}
                      onChange={(e) => setEndPage(Number(e.target.value))}
                      className="w-16 p-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-center outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Queue Summary Box */}
              <div className="p-3.5 bg-slate-950/90 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-slate-300">
                  <span>إجمالي الصفحات المستهدفة:</span>
                  <span className="font-bold text-sky-400 font-mono text-sm">
                    {pagesToProcess.length} صفحة
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>الوقت التقديري المتوقع:</span>
                  <span>~{Math.ceil(pagesToProcess.length * 2.5)} ثانية</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
                  * يتم إرسال كل صفحة ومعالجتها بتقنية التعرف البصري OCR والترجمة الفورية، مع حفظ
                  كامل للرسومات والخطوط والتنسيقات.
                </p>
              </div>
            </>
          ) : (
            /* Progress view when running */
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between text-slate-300">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                  <span className="font-bold text-white">
                    جاري ترجمة الصفحة {batchProgress?.currentPageNum}...
                  </span>
                </div>
                <span className="font-mono text-sky-400 font-bold text-sm">
                  {progressPercent}%
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  تم إنجاز {batchProgress?.current || 0} من أصل {batchProgress?.total || 0} صفحة
                </span>
                <span className="text-emerald-400 font-medium">
                  {batchProgress?.completedPages.length || 0} مكتملة بنجاح
                </span>
              </div>

              {/* Completed list preview */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 max-h-32 overflow-y-auto space-y-1.5">
                {batchProgress?.completedPages.map((num) => (
                  <div key={num} className="flex items-center gap-2 text-[11px] text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>تمت ترجمة وحفظ تنسيق ورسوم الصفحة #{num} بنجاح</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <button
            onClick={onClose}
            disabled={isBatchRunning}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition disabled:opacity-40"
          >
            إغلاق
          </button>

          {!isBatchRunning ? (
            <button
              onClick={() => onStartBatch(pagesToProcess)}
              disabled={pagesToProcess.length === 0}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-sky-600/25 transition disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>بدء ترجمة {pagesToProcess.length} صفحة</span>
            </button>
          ) : (
            <button
              onClick={onStopBatch}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-semibold transition"
            >
              <StopCircle className="w-4 h-4 text-rose-400" />
              <span>إيقاف الترجمة الدفعية</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
