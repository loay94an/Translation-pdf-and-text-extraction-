import React from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Download,
  Layers,
  Eye,
  Loader2,
} from 'lucide-react';
import { TranslationSettings } from '../types/translation';

interface MobileBottomNavProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  isTranslating: boolean;
  isCurrentPageTranslated: boolean;
  onTranslateCurrentPage: () => void;
  settings: TranslationSettings;
  onUpdateSettings: (newSettings: Partial<TranslationSettings>) => void;
  onOpenBatchModal: () => void;
  onOpenExportModal: () => void;
  translatedCount: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  isTranslating,
  isCurrentPageTranslated,
  onTranslateCurrentPage,
  settings,
  onUpdateSettings,
  onOpenBatchModal,
  onOpenExportModal,
  translatedCount,
}) => {
  if (totalPages <= 0) return null;

  const toggleRenderMode = () => {
    const nextMode =
      settings.renderMode === 'in_place'
        ? 'dual_view'
        : settings.renderMode === 'dual_view'
        ? 'text_focus'
        : 'in_place';
    onUpdateSettings({ renderMode: nextMode });
  };

  return (
    <div className="sm:hidden bg-slate-900/95 border-t border-slate-800 backdrop-blur px-3 py-2 flex items-center justify-between gap-2 z-40 select-none shadow-2xl safe-area-bottom">
      {/* Page Navigation */}
      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-200 disabled:opacity-30 active:scale-95 transition"
          aria-label="الصفحة السابقة"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <span className="text-[11px] font-mono font-bold px-1.5 text-slate-200">
          {currentPage}/{totalPages}
        </span>

        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-200 disabled:opacity-30 active:scale-95 transition"
          aria-label="الصفحة التالية"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Main Translate Button */}
      <button
        onClick={onTranslateCurrentPage}
        disabled={isTranslating}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold text-white shadow-lg active:scale-95 transition ${
          isCurrentPageTranslated
            ? 'bg-slate-800 border border-slate-700 text-slate-200'
            : 'bg-gradient-to-r from-indigo-600 to-sky-500 shadow-indigo-600/30'
        }`}
      >
        {isTranslating ? (
          <Loader2 className="w-4 h-4 animate-spin text-indigo-300" />
        ) : (
          <Sparkles className="w-4 h-4 text-amber-300" />
        )}
        <span>
          {isTranslating
            ? 'جاري الترجمة...'
            : isCurrentPageTranslated
            ? 'إعادة ترجمة'
            : 'ترجمة الصفحة'}
        </span>
      </button>

      {/* View Mode Toggle Button */}
      <button
        onClick={toggleRenderMode}
        className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 active:scale-95 transition"
        title="تبديل طريقة العرض"
      >
        <Eye className="w-4 h-4" />
      </button>

      {/* Export / Batch Action */}
      {translatedCount > 0 ? (
        <button
          onClick={onOpenExportModal}
          className="p-2 rounded-xl bg-emerald-600 text-white shadow-md active:scale-95 transition"
          title="تصدير PDF"
        >
          <Download className="w-4 h-4" />
        </button>
      ) : (
        <button
          onClick={onOpenBatchModal}
          className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-sky-400 active:scale-95 transition"
          title="ترجمة دفعات"
        >
          <Layers className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
