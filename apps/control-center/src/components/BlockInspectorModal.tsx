import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Sparkles,
  Type,
  AlignRight,
  AlignCenter,
  AlignLeft,
  Loader2,
  Edit3,
} from 'lucide-react';
import { TextBlock } from '../types/translation';

interface BlockInspectorModalProps {
  block: TextBlock | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveBlock: (updatedBlock: TextBlock) => void;
  targetLang: string;
}

export const BlockInspectorModal: React.FC<BlockInspectorModalProps> = ({
  block,
  isOpen,
  onClose,
  onSaveBlock,
  targetLang,
}) => {
  const [editedText, setEditedText] = useState<string>('');
  const [fontSize, setFontSize] = useState<number>(14);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  useEffect(() => {
    if (block) {
      setEditedText(block.translatedText);
      setFontSize(block.fontSizeEstimate || 14);
      setRefineError(null);
    }
  }, [block]);

  if (!isOpen || !block) return null;

  const handleCopyOriginal = () => {
    navigator.clipboard.writeText(block.originalText);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSave = () => {
    onSaveBlock({
      ...block,
      translatedText: editedText,
      fontSizeEstimate: fontSize,
    });
    onClose();
  };

  const handleAiRefine = async (instruction: string) => {
    try {
      setIsRefining(true);
      setRefineError(null);
      const res = await fetch('/api/refine-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalText: block.originalText,
          currentTranslation: editedText,
          instruction,
          targetLang,
        }),
      });
      const data = await res.json();
      if (data.success && data.refinedTranslation) {
        setEditedText(data.refinedTranslation);
      } else {
        setRefineError(data.error || 'فشل تحسين الترجمة');
      }
    } catch (err) {
      setRefineError((err as Error).message);
    } finally {
      setIsRefining(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold">تعديل النص المترجم المباشر</h3>
              <p className="text-xs text-slate-400">
                تصنيف: <span className="text-indigo-300 font-mono">{block.category}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {/* Original Text Box */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-400">
              <span className="font-semibold text-slate-300">النص الأصلي (من المسح الضوئي):</span>
              <button
                onClick={handleCopyOriginal}
                className="flex items-center gap-1 text-[11px] hover:text-indigo-300 transition"
              >
                {isCopied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">تم النسخ</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>نسخ النص</span>
                  </>
                )}
              </button>
            </div>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-sans text-slate-300 max-h-24 overflow-y-auto leading-relaxed">
              {block.originalText}
            </div>
          </div>

          {/* Translated Text (Editable) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-400">
              <span className="font-semibold text-indigo-300">النص المترجم التفاعلي:</span>
              <span className="text-[11px]">يمكنك التعديل مباشرة وسينعكس فوراً على المستند</span>
            </div>
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={4}
              dir="rtl"
              className="w-full p-3 bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl text-white outline-none font-medium leading-relaxed resize-none"
              placeholder="اكتب الترجمة هنا..."
            />
          </div>

          {/* Quick AI Refine Prompts */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>تحسين فوري بواسطة الذكاء الاصطناعي:</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => handleAiRefine('صياغة رسمية وأكاديمية دقيقة')}
                disabled={isRefining}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition disabled:opacity-50"
              >
                رسمي وأكاديمي
              </button>
              <button
                onClick={() => handleAiRefine('صياغة تقنية وهندسية متخصصة')}
                disabled={isRefining}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition disabled:opacity-50"
              >
                مصطلحات تقنية
              </button>
              <button
                onClick={() => handleAiRefine('اختصار الجملة لتكون مقتضبة ومطابقة لحجم المستطيل دون تغيير المعنى')}
                disabled={isRefining}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition disabled:opacity-50"
              >
                اختصار ليلائم الإطار
              </button>
              <button
                onClick={() => handleAiRefine('تصحيح التشكيل والقواعد والنحو العربي بدقة')}
                disabled={isRefining}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition disabled:opacity-50"
              >
                تدقيق لغوي
              </button>
            </div>
            {isRefining && (
              <div className="flex items-center gap-2 text-indigo-400 text-xs py-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>جاري تطبيق التحسين الذكي...</span>
              </div>
            )}
            {refineError && <p className="text-rose-400 text-xs">{refineError}</p>}
          </div>

          {/* Font Controls */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Type className="w-4 h-4 text-slate-400" />
              <span className="text-slate-300">حجم الخط النسبي:</span>
              <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
                <button
                  onClick={() => setFontSize((s) => Math.max(8, s - 1))}
                  className="px-2 py-0.5 hover:bg-slate-700 rounded font-bold"
                >
                  -
                </button>
                <span className="w-6 text-center font-mono">{fontSize}</span>
                <button
                  onClick={() => setFontSize((s) => Math.min(48, s + 1))}
                  className="px-2 py-0.5 hover:bg-slate-700 rounded font-bold"
                >
                  +
                </button>
              </div>
            </div>

            <span className="text-slate-500 font-mono text-[11px]">
              [{block.box2d[0]}, {block.box2d[1]}, {block.box2d[2]}, {block.box2d[3]}]
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
          >
            إلغاء
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition"
          >
            حفظ وتطبيق على الصفحة
          </button>
        </div>
      </div>
    </div>
  );
};
