import React, { useRef, useEffect } from 'react';
import { CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react';
import { TranslatedPageData } from '../types/translation';

interface ThumbnailsBarProps {
  totalPages: number;
  currentPage: number;
  onPageSelect: (pageNumber: number) => void;
  translations: Record<number, TranslatedPageData>;
}

export const ThumbnailsBar: React.FC<ThumbnailsBarProps> = ({
  totalPages,
  currentPage,
  onPageSelect,
  translations,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll the active thumbnail into view
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [currentPage]);

  const scroll = (direction: 'left' | 'right') => {
    if (containerRef.current) {
      const scrollAmount = direction === 'left' ? -300 : 300;
      containerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  if (totalPages <= 0) return null;

  return (
    <div className="bg-slate-950 border-t border-slate-800/80 px-4 py-2 flex items-center gap-2 select-none z-30">
      {/* Scroll Left Button */}
      <button
        onClick={() => scroll('left')}
        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition flex-shrink-0"
        title="تمرير لليمين"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Thumbnails Container */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center gap-2 overflow-x-auto py-1 scrollbar-none scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
          const isTranslated = !!translations[pageNum];
          const isCurrent = pageNum === currentPage;

          return (
            <button
              key={pageNum}
              ref={isCurrent ? activeItemRef : null}
              onClick={() => onPageSelect(pageNum)}
              className={`flex-shrink-0 relative flex flex-col items-center justify-between w-14 h-16 rounded-lg p-1.5 border transition cursor-pointer ${
                isCurrent
                  ? 'bg-indigo-950/80 border-indigo-500 shadow-md ring-1 ring-indigo-500'
                  : isTranslated
                  ? 'bg-emerald-950/30 border-emerald-500/40 hover:border-emerald-500'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Status Badge */}
              <div className="w-full flex items-center justify-between">
                <span
                  className={`text-[10px] font-bold font-mono ${
                    isCurrent ? 'text-indigo-300' : 'text-slate-400'
                  }`}
                >
                  #{pageNum}
                </span>
                {isTranslated && (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                )}
              </div>

              {/* Mini visual representation */}
              <div
                className={`w-full h-7 rounded border border-dashed flex items-center justify-center ${
                  isTranslated
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-slate-700 bg-slate-950'
                }`}
              >
                <span className="text-[9px] text-slate-500">
                  {isTranslated ? 'مترجمة' : 'مسح'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Scroll Right Button */}
      <button
        onClick={() => scroll('right')}
        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition flex-shrink-0"
        title="تمرير لليسار"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    </div>
  );
};
