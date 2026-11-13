import React, { useRef, useState } from 'react';
import {
  FileText,
  Upload,
  Download,
  Languages,
  Sparkles,
  Layers,
  Settings2,
  Cpu,
  Loader2,
  Menu,
  X,
  Eye,
  Columns,
  FileSearch,
  Terminal,
} from 'lucide-react';
import { SamplePdfInfo, TranslationSettings } from '../types/translation';

interface HeaderProps {
  documentName: string;
  fileSizeBytes: number;
  totalPages: number;
  translatedCount: number;
  samplePdfInfo: SamplePdfInfo | null;
  settings: TranslationSettings;
  onUpdateSettings: (newSettings: Partial<TranslationSettings>) => void;
  onFileUpload: (file: File) => void;
  onLoadSample: () => void;
  isLoadingSample: boolean;
  isTranslating: boolean;
  onTranslateCurrentPage: () => void;
  onOpenBatchModal: () => void;
  onOpenExportModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  documentName,
  fileSizeBytes,
  totalPages,
  translatedCount,
  samplePdfInfo,
  settings,
  onUpdateSettings,
  onFileUpload,
  onLoadSample,
  isLoadingSample,
  isTranslating,
  onTranslateCurrentPage,
  onOpenBatchModal,
  onOpenExportModal,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 MB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileUpload(e.target.files[0]);
      setMobileMenuOpen(false);
    }
  };

  return (
    <>
      <header className="bg-slate-900/95 border-b border-slate-800 backdrop-blur sticky top-0 z-40 px-3 md:px-5 py-2 md:py-2.5 shadow-md">
        <div className="max-w-[1800px] mx-auto flex items-center justify-between gap-2">
          {/* Left: Branding & Document Info */}
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-sky-400 p-0.5 shadow flex-shrink-0 flex items-center justify-center">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <FileText className="w-4 h-4 md:w-4.5 md:h-4.5 text-indigo-400" />
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-sm md:text-base text-white truncate">
                  مترجم الـ PDF المصور
                </h1>
                <span className="hidden xl:inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 rounded-full">
                  حفظ الرسوم 100%
                </span>
              </div>

              {totalPages > 0 && (
                <p className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                  <span className="truncate max-w-[120px] sm:max-w-[200px] text-slate-300">
                    {documentName}
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-300 font-medium">{totalPages} ص</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-emerald-400 font-medium">{translatedCount} مترجمة</span>
                </p>
              )}
            </div>
          </div>

          {/* Desktop Center: Languages & Domain */}
          <div className="hidden lg:flex items-center gap-2 text-xs">
            {/* Source */}
            <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-1.5 rounded-lg border border-slate-700/70">
              <Languages className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400 text-[11px]">من:</span>
              <select
                value={settings.sourceLang}
                onChange={(e) => onUpdateSettings({ sourceLang: e.target.value })}
                className="bg-transparent text-slate-200 outline-none cursor-pointer font-medium"
              >
                <option value="auto" className="bg-slate-900 text-slate-200">
                  اكتشاف تلقائي
                </option>
                <option value="en" className="bg-slate-900 text-slate-200">
                  الإنجليزية
                </option>
                <option value="ar" className="bg-slate-900 text-slate-200">
                  العربية
                </option>
                <option value="fr" className="bg-slate-900 text-slate-200">
                  الفرنسية
                </option>
                <option value="de" className="bg-slate-900 text-slate-200">
                  الألمانية
                </option>
                <option value="es" className="bg-slate-900 text-slate-200">
                  الإسبانية
                </option>
                <option value="tr" className="bg-slate-900 text-slate-200">
                  التركية
                </option>
                <option value="zh" className="bg-slate-900 text-slate-200">
                  الصينية
                </option>
              </select>
            </div>

            {/* Target */}
            <div className="flex items-center gap-1 bg-indigo-950/50 px-2 py-1.5 rounded-lg border border-indigo-500/40">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-indigo-300 text-[11px]">إلى:</span>
              <select
                value={settings.targetLang}
                onChange={(e) => onUpdateSettings({ targetLang: e.target.value })}
                className="bg-transparent text-indigo-100 font-semibold outline-none cursor-pointer"
              >
                <option value="ar" className="bg-slate-900 text-slate-200">
                  العربية (Arabic)
                </option>
                <option value="en" className="bg-slate-900 text-slate-200">
                  الإنجليزية (English)
                </option>
                <option value="fr" className="bg-slate-900 text-slate-200">
                  الفرنسية (French)
                </option>
                <option value="de" className="bg-slate-900 text-slate-200">
                  الألمانية (German)
                </option>
                <option value="es" className="bg-slate-900 text-slate-200">
                  الإسبانية (Spanish)
                </option>
                <option value="tr" className="bg-slate-900 text-slate-200">
                  التركية (Turkish)
                </option>
              </select>
            </div>

            {/* Domain */}
            <div className="hidden xl:flex items-center gap-1 bg-slate-800/80 px-2 py-1.5 rounded-lg border border-slate-700/70">
              <Settings2 className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400 text-[11px]">المجال:</span>
              <select
                value={settings.domain}
                onChange={(e) =>
                  onUpdateSettings({ domain: e.target.value as TranslationSettings['domain'] })
                }
                className="bg-transparent text-slate-200 outline-none cursor-pointer"
              >
                <option value="general" className="bg-slate-900 text-slate-200">
                  عام
                </option>
                <option value="technical" className="bg-slate-900 text-slate-200">
                  تقني وهندسي
                </option>
                <option value="academic" className="bg-slate-900 text-slate-200">
                  أكاديمي وعلمي
                </option>
                <option value="medical" className="bg-slate-900 text-slate-200">
                  طبي
                </option>
                <option value="legal" className="bg-slate-900 text-slate-200">
                  قانوني
                </option>
              </select>
            </div>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Quick Sample Button (Desktop & Tablet) */}
            {samplePdfInfo?.available && totalPages === 0 && (
              <button
                onClick={onLoadSample}
                disabled={isLoadingSample || isTranslating}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition shadow-sm"
              >
                {isLoadingSample ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Cpu className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>تحميل العينة (56MB)</span>
              </button>
            )}

            {/* File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,application/pdf"
              className="hidden"
            />

            {/* Upload Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              title="رفع ملف PDF"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>رفع</span>
            </button>

            {/* Translate Current Page Button (Always Visible & Prominent) */}
            {totalPages > 0 && (
              <button
                onClick={onTranslateCurrentPage}
                disabled={isTranslating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-md shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isTranslating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span className="hidden xs:inline">
                  {isTranslating ? 'جاري الترجمة...' : 'ترجمة الصفحة'}
                </span>
                <span className="xs:hidden">{isTranslating ? '...' : 'ترجمة'}</span>
              </button>
            )}

            {/* Batch Modal Button (Tablet/Desktop) */}
            {totalPages > 0 && (
              <button
                onClick={onOpenBatchModal}
                className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                title="ترجمة دفعات"
              >
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                <span>دفعات</span>
              </button>
            )}

            {/* Export PDF Button */}
            {translatedCount > 0 && (
              <button
                onClick={onOpenExportModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/25 transition"
                title="تصدير المستند المترجم"
              >
                <Download className="w-3.5 h-3.5" />
                <span>تصدير</span>
              </button>
            )}

            <button
              onClick={() => { window.location.href = '/mobile-terminal.html'; }}
              className="p-2 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border border-emerald-500/30 transition"
              aria-label="فتح الطرفية المحلية"
              title="الطرفية المحلية للهاتف"
            >
              <Terminal className="w-4 h-4" />
            </button>

            {/* Mobile Hamburger / Settings Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              aria-label="القائمة والإعدادات"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer / Sheet */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-x-0 top-[52px] z-50 bg-slate-900 border-b border-slate-800 shadow-2xl p-4 space-y-4 animate-in slide-in-from-top-2 text-xs">
          {/* Mobile Document Actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                fileInputRef.current?.click();
              }}
              className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 font-medium"
            >
              <Upload className="w-4 h-4" />
              <span>رفع ملف PDF</span>
            </button>

            {samplePdfInfo?.available && (
              <button
                onClick={() => {
                  onLoadSample();
                  setMobileMenuOpen(false);
                }}
                disabled={isLoadingSample}
                className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium"
              >
                {isLoadingSample ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Cpu className="w-4 h-4 text-amber-400" />
                )}
                <span>تحميل العينة (56MB)</span>
              </button>
            )}
          </div>

          {/* Languages selection */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <span className="font-semibold text-slate-400 block">لغات الترجمة:</span>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-slate-950 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 block mb-1">من:</span>
                <select
                  value={settings.sourceLang}
                  onChange={(e) => onUpdateSettings({ sourceLang: e.target.value })}
                  className="w-full bg-transparent text-slate-200 outline-none font-medium"
                >
                  <option value="auto">اكتشاف تلقائي</option>
                  <option value="en">الإنجليزية</option>
                  <option value="ar">العربية</option>
                  <option value="fr">الفرنسية</option>
                  <option value="de">الألمانية</option>
                  <option value="es">الإسبانية</option>
                  <option value="tr">التركية</option>
                </select>
              </div>

              <div className="p-2 bg-indigo-950/40 rounded-lg border border-indigo-500/30">
                <span className="text-[10px] text-indigo-400 block mb-1">إلى:</span>
                <select
                  value={settings.targetLang}
                  onChange={(e) => onUpdateSettings({ targetLang: e.target.value })}
                  className="w-full bg-transparent text-indigo-100 font-bold outline-none"
                >
                  <option value="ar">العربية</option>
                  <option value="en">الإنجليزية</option>
                  <option value="fr">الفرنسية</option>
                  <option value="de">الألمانية</option>
                  <option value="es">الإسبانية</option>
                  <option value="tr">التركية</option>
                </select>
              </div>
            </div>
          </div>

          {/* Domain & Mode */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <span className="font-semibold text-slate-400 block">المجال وطريقة العرض:</span>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-slate-950 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 block mb-1">مجال المستند:</span>
                <select
                  value={settings.domain}
                  onChange={(e) =>
                    onUpdateSettings({ domain: e.target.value as TranslationSettings['domain'] })
                  }
                  className="w-full bg-transparent text-slate-200 outline-none"
                >
                  <option value="general">عام</option>
                  <option value="technical">تقني وهندسي</option>
                  <option value="academic">أكاديمي وعلمي</option>
                  <option value="medical">طبي</option>
                  <option value="legal">قانوني</option>
                </select>
              </div>

              <div className="p-2 bg-slate-950 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 block mb-1">طريقة العرض:</span>
                <select
                  value={settings.renderMode}
                  onChange={(e) =>
                    onUpdateSettings({
                      renderMode: e.target.value as TranslationSettings['renderMode'],
                    })
                  }
                  className="w-full bg-transparent text-slate-200 outline-none"
                >
                  <option value="in_place">ترجمة مطابقة</option>
                  <option value="dual_view">شاشتان متزامنتان</option>
                  <option value="text_focus">جدول النصوص</option>
                </select>
              </div>
            </div>
          </div>

          {/* Quick buttons in drawer */}
          {totalPages > 0 && (
            <div className="pt-2 border-t border-slate-800 flex gap-2">
              <button
                onClick={() => {
                  onOpenBatchModal();
                  setMobileMenuOpen(false);
                }}
                className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-200 font-medium flex items-center justify-center gap-1.5"
              >
                <Layers className="w-4 h-4 text-sky-400" />
                <span>ترجمة دفعات</span>
              </button>

              {translatedCount > 0 && (
                <button
                  onClick={() => {
                    onOpenExportModal();
                    setMobileMenuOpen(false);
                  }}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 text-white font-semibold flex items-center justify-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  <span>تصدير PDF</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};
