/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  Upload,
  Sparkles,
  Layers,
  Download,
  AlertCircle,
  FileCheck2,
  Cpu,
  Loader2,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Header } from './components/Header';
import { DocumentViewer } from './components/DocumentViewer';
import { BlockInspectorModal } from './components/BlockInspectorModal';
import { BatchTranslationModal } from './components/BatchTranslationModal';
import { ExportModal } from './components/ExportModal';
import { ThumbnailsBar } from './components/ThumbnailsBar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { PDFHandler } from './services/pdfService';
import {
  getAllTranslationsForDoc,
  getTranslationFromIDB,
  saveDocumentBufferToIDB,
  getDocumentBufferFromIDB,
  saveTranslationToIDB,
} from './services/storageService';
import {
  SamplePdfInfo,
  TextBlock,
  TranslatedPageData,
  TranslationSettings,
} from './types/translation';

export default function App() {
  const [pdfHandler] = useState<PDFHandler>(() => new PDFHandler());
  const [documentKey, setDocumentKey] = useState<string>('default_doc');
  const [documentName, setDocumentName] = useState<string>('');
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [samplePdfInfo, setSamplePdfInfo] = useState<SamplePdfInfo | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState<boolean>(false);
  const [isDocumentLoading, setIsDocumentLoading] = useState<boolean>(false);
  const [loadingStageText, setLoadingStageText] = useState<string>('جاري تحليل ملف الـ PDF...');
  const [documentLoadError, setDocumentLoadError] = useState<string | null>(null);

  // Translation settings state
  const [settings, setSettings] = useState<TranslationSettings>({
    sourceLang: 'auto',
    targetLang: 'ar',
    domain: 'general',
    preserveGraphics: true,
    maskOpacity: 1.0,
    renderMode: 'in_place',
    customGlossary: '',
    fontSizeAdjustment: 0,
  });

  // Translations dictionary: pageNumber -> TranslatedPageData (persisted via IndexedDB)
  const [translations, setTranslations] = useState<Record<number, TranslatedPageData>>({});
  const [isTranslatingCurrentPage, setIsTranslatingCurrentPage] = useState<boolean>(false);

  // Active rendered image for the current page
  const [currentOriginalImage, setCurrentOriginalImage] = useState<HTMLImageElement | null>(null);

  // Inspector modal state
  const [selectedBlock, setSelectedBlock] = useState<TextBlock | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);

  // Batch translation modal & queue
  const [isBatchModalOpen, setIsBatchModalOpen] = useState<boolean>(false);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentPageNum: number;
    completedPages: number[];
    failedPages: number[];
  } | null>(null);
  const shouldCancelBatchRef = useRef<boolean>(false);

  // Export modal state
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);

  // Check sample PDF availability on mount
  useEffect(() => {
    fetch('/api/sample-pdf-meta')
      .then((res) => res.json())
      .then(async (data: SamplePdfInfo) => {
        if (data.available) {
          setSamplePdfInfo(data);
          // Check if previously loaded sample exists in IndexedDB
          const cachedBuffer = await getDocumentBufferFromIDB('sample_doc_56mb');
          if (cachedBuffer) {
            try {
              setIsDocumentLoading(true);
              setLoadingStageText('جاري استعادة المستند المخزن محلياً (IndexedDB)...');
              const info = await pdfHandler.loadFromArrayBuffer(cachedBuffer);
              setDocumentKey('sample_doc_56mb');
              setDocumentName(data.filename);
              setFileSizeBytes(data.sizeBytes);
              setTotalPages(info.numPages);
              setCurrentPage(1);

              const savedTrans = await getAllTranslationsForDoc('sample_doc_56mb');
              setTranslations(savedTrans);
            } catch (e) {
              console.warn('Could not restore cached sample:', e);
            } finally {
              setIsDocumentLoading(false);
            }
          }
        }
      })
      .catch((err) => console.warn('Could not check sample PDF:', err));
  }, [pdfHandler]);

  // Load saved translations from IndexedDB when documentKey changes
  useEffect(() => {
    if (documentKey) {
      getAllTranslationsForDoc(documentKey)
        .then((saved) => {
          if (Object.keys(saved).length > 0) {
            setTranslations(saved);
          }
        })
        .catch((e) => console.warn('Error loading IndexedDB translations:', e));
    }
  }, [documentKey]);

  // Helper to load an HTMLImageElement from a page number using PDFHandler
  const loadPageImage = useCallback(
    async (pageNumber: number): Promise<HTMLImageElement | null> => {
      try {
        const { dataUrl } = await pdfHandler.renderPageToDataUrl(pageNumber, 1.75);
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = dataUrl;
        });
      } catch (err) {
        console.error(`Error loading page ${pageNumber} image:`, err);
        return null;
      }
    },
    [pdfHandler]
  );

  // When currentPage changes, render that page's image
  useEffect(() => {
    if (totalPages > 0 && currentPage >= 1 && currentPage <= totalPages) {
      let isCancelled = false;
      loadPageImage(currentPage).then((img) => {
        if (!isCancelled && img) {
          setCurrentOriginalImage(img);
        }
      });
      return () => {
        isCancelled = true;
      };
    }
  }, [currentPage, totalPages, loadPageImage]);

  // Handle loading the attached sample PDF (56.3 MB)
  const handleLoadSamplePdf = async () => {
    try {
      setIsLoadingSample(true);
      setIsDocumentLoading(true);
      setLoadingStageText('جاري تحميل وتخزين المستند الكبير (IndexedDB)...');
      setDocumentLoadError(null);

      const docKey = 'sample_doc_56mb';
      let buffer = await getDocumentBufferFromIDB(docKey);

      let info;
      if (buffer) {
        info = await pdfHandler.loadFromArrayBuffer(buffer);
      } else {
        const res = await fetch('/api/sample-pdf');
        if (!res.ok) throw new Error('تعذر جلب ملف العينة');
        buffer = await res.arrayBuffer();
        await saveDocumentBufferToIDB(docKey, buffer);
        info = await pdfHandler.loadFromArrayBuffer(buffer);
      }

      setDocumentKey(docKey);
      setDocumentName(samplePdfInfo?.filename || 'مستند_مصور_نموذجي_كبير_326_صفحة.pdf');
      setFileSizeBytes(samplePdfInfo?.sizeBytes || 59061765);
      setTotalPages(info.numPages);
      setCurrentPage(1);

      const savedTrans = await getAllTranslationsForDoc(docKey);
      setTranslations(savedTrans);
    } catch (err) {
      console.error('Failed to load sample PDF:', err);
      setDocumentLoadError((err as Error).message || 'فشل تحميل ملف الـ PDF النموذجي');
    } finally {
      setIsLoadingSample(false);
      setIsDocumentLoading(false);
    }
  };

  // Handle manual file upload from computer/phone
  const handleFileUpload = async (file: File) => {
    try {
      setIsDocumentLoading(true);
      setLoadingStageText(`جاري قراءة وتخزين ملف ${file.name} محلياً...`);
      setDocumentLoadError(null);

      const arrayBuffer = await file.arrayBuffer();
      const docKey = `doc_${file.name}_${file.size}`;
      await saveDocumentBufferToIDB(docKey, arrayBuffer);

      const info = await pdfHandler.loadFromArrayBuffer(arrayBuffer);

      setDocumentKey(docKey);
      setDocumentName(file.name);
      setFileSizeBytes(file.size);
      setTotalPages(info.numPages);
      setCurrentPage(1);

      const savedTrans = await getAllTranslationsForDoc(docKey);
      setTranslations(savedTrans);
    } catch (err) {
      console.error('Failed to load uploaded PDF:', err);
      setDocumentLoadError((err as Error).message || 'فشل قراءة ملف الـ PDF');
    } finally {
      setIsDocumentLoading(false);
    }
  };

  // Drag and drop handler for dropzone
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        handleFileUpload(file);
      } else {
        alert('يرجى سحب وإفلات ملف PDF صالح.');
      }
    }
  };

  // Translate a specific page with Google Lens style OCR & Layout preservation
  const translatePage = async (pageNumber: number): Promise<TranslatedPageData | null> => {
    try {
      // 1. Render high-res image of the page
      const { dataUrl, width, height } = await pdfHandler.renderPageToDataUrl(pageNumber, 1.75);

      // 2. Call server endpoint with Google Lens OCR
      const response = await fetch('/api/translate-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageImage: dataUrl,
          pageNumber,
          sourceLang: settings.sourceLang,
          targetLang: settings.targetLang,
          domain: settings.domain,
          preserveGraphics: settings.preserveGraphics,
          customGlossary: settings.customGlossary,
        }),
      });

      const result = await response.json();
      if (!result.success || !result.data) {
        throw new Error(result.error || 'فشلت الترجمة');
      }

      const pageData: TranslatedPageData = {
        ...result.data,
        timestamp: Date.now(),
        pageWidth: width,
        pageHeight: height,
      };

      // Save to IndexedDB for persistent offline storage
      await saveTranslationToIDB(documentKey, pageNumber, pageData);

      // Update state
      setTranslations((prev) => ({
        ...prev,
        [pageNumber]: pageData,
      }));

      return pageData;
    } catch (err) {
      console.error(`Error translating page ${pageNumber}:`, err);
      throw err;
    }
  };

  // Trigger translation for current page
  const handleTranslateCurrentPage = async () => {
    if (isTranslatingCurrentPage || totalPages === 0) return;
    try {
      setIsTranslatingCurrentPage(true);
      await translatePage(currentPage);
    } catch (err) {
      alert('حدث خطأ أثناء ترجمة الصفحة: ' + (err as Error).message);
    } finally {
      setIsTranslatingCurrentPage(false);
    }
  };

  // Start Batch Translation of multiple pages
  const handleStartBatch = async (pagesToTranslate: number[]) => {
    if (pagesToTranslate.length === 0) return;
    setIsBatchRunning(true);
    shouldCancelBatchRef.current = false;

    setBatchProgress({
      current: 0,
      total: pagesToTranslate.length,
      currentPageNum: pagesToTranslate[0],
      completedPages: [],
      failedPages: [],
    });

    const completed: number[] = [];
    const failed: number[] = [];

    for (let i = 0; i < pagesToTranslate.length; i++) {
      if (shouldCancelBatchRef.current) break;

      const pNum = pagesToTranslate[i];
      setBatchProgress((prev) =>
        prev
          ? {
              ...prev,
              current: i,
              currentPageNum: pNum,
              completedPages: completed,
              failedPages: failed,
            }
          : null
      );

      try {
        await translatePage(pNum);
        completed.push(pNum);
      } catch (e) {
        console.error(`Batch page ${pNum} failed:`, e);
        failed.push(pNum);
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    setBatchProgress((prev) =>
      prev
        ? {
            ...prev,
            current: pagesToTranslate.length,
            completedPages: completed,
            failedPages: failed,
          }
        : null
    );

    setIsBatchRunning(false);
  };

  const handleStopBatch = () => {
    shouldCancelBatchRef.current = true;
    setIsBatchRunning(false);
  };

  // Block Inspector handlers
  const handleSelectBlock = (block: TextBlock) => {
    setSelectedBlock(block);
    setIsInspectorOpen(true);
  };

  const handleSaveBlock = async (updatedBlock: TextBlock) => {
    if (!translations[currentPage]) return;
    const pageData = translations[currentPage];
    const newBlocks = pageData.blocks.map((b) => (b.id === updatedBlock.id ? updatedBlock : b));
    const updatedPageData = {
      ...pageData,
      blocks: newBlocks,
    };

    await saveTranslationToIDB(documentKey, currentPage, updatedPageData);

    setTranslations((prev) => ({
      ...prev,
      [currentPage]: updatedPageData,
    }));
  };

  const translatedCount = Object.keys(translations).length;
  const isCurrentPageTranslated = !!translations[currentPage];

  return (
    <div className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Top Application Header */}
      <Header
        documentName={documentName}
        fileSizeBytes={fileSizeBytes}
        totalPages={totalPages}
        translatedCount={translatedCount}
        samplePdfInfo={samplePdfInfo}
        settings={settings}
        onUpdateSettings={(newSettings) => setSettings((s) => ({ ...s, ...newSettings }))}
        onFileUpload={handleFileUpload}
        onLoadSample={handleLoadSamplePdf}
        isLoadingSample={isLoadingSample}
        isTranslating={isTranslatingCurrentPage || isBatchRunning}
        onTranslateCurrentPage={handleTranslateCurrentPage}
        onOpenBatchModal={() => setIsBatchModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
      />

      {/* Main View Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Loading Spinner Modal */}
        {isDocumentLoading && (
          <div className="absolute inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center">
            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-3" />
            <p className="font-bold text-base text-white">{loadingStageText}</p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              تخزين واسترجاع المستند والترجمات عبر IndexedDB لمحلياً بالكامل...
            </p>
          </div>
        )}

        {/* Empty State / Welcome Screen */}
        {totalPages === 0 && !isDocumentLoading && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 text-center max-w-3xl mx-auto overflow-y-auto"
          >
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-3xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-sky-400 p-0.5 shadow-2xl mb-4 md:mb-6">
              <div className="w-full h-full bg-slate-950 rounded-[22px] flex items-center justify-center">
                <FileText className="w-8 h-8 md:w-10 md:h-10 text-indigo-400" />
              </div>
            </div>

            <h2 className="text-xl md:text-3xl font-extrabold text-white mb-2 leading-tight">
              مترجم مستندات PDF المصورة (Google Lens OCR)
            </h2>

            <p className="text-xs md:text-sm text-slate-400 max-w-xl mb-6 leading-relaxed">
              تعرّف بصري فائق السرعة على النصوص (OCR) مع الحفاظ التام على الرسوم والتنسيق، مع تخزين
              آلي دائم في قاعدة بيانات IndexedDB المحلية لضمان عدم ضياع الملفات عند تحديث الصفحة.
            </p>

            {/* Quick Action Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 w-full max-w-lg mb-6">
              {/* Load Attached Sample Card */}
              {samplePdfInfo?.available && (
                <button
                  onClick={handleLoadSamplePdf}
                  disabled={isLoadingSample}
                  className="p-4 md:p-5 rounded-2xl bg-gradient-to-b from-slate-900 to-indigo-950/40 border border-indigo-500/40 hover:border-indigo-400 active:scale-[0.98] shadow-xl text-right transition flex flex-col justify-between group cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300">
                      <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-indigo-400" />
                    </span>
                    <span className="text-[10px] md:text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      المستند المرفق (56MB)
                    </span>
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-xs md:text-sm mb-1 group-hover:text-indigo-300 transition">
                      تحميل العينة الكبيرة المرفقة
                    </h3>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      326 صفحة مصورة بمخططات ورسومات
                    </p>
                  </div>
                </button>
              )}

              {/* Upload Custom File Card */}
              <label className="p-4 md:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 active:scale-[0.98] shadow-xl text-right transition flex flex-col justify-between group cursor-pointer">
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                  className="hidden"
                />
                <div className="flex items-center justify-between mb-2">
                  <span className="p-2 rounded-xl bg-slate-800 text-slate-300">
                    <Upload className="w-4 h-4 md:w-5 md:h-5" />
                  </span>
                  <span className="text-[10px] text-slate-400">PDF حتى 100MB+</span>
                </div>
                <div>
                  <h3 className="font-bold text-white text-xs md:text-sm mb-1 group-hover:text-sky-300 transition">
                    رفع ملف من الهاتف أو الكمبيوتر
                  </h3>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    انقر لاختيار ملف PDF وتخزينه محلياً
                  </p>
                </div>
              </label>
            </div>

            {/* Feature Highlights */}
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 text-[11px] md:text-xs text-slate-400 pt-3 border-t border-slate-900">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                تخزين IndexedDB دائم
              </span>
              <span className="flex items-center gap-1">
                <FileCheck2 className="w-3.5 h-3.5 text-sky-400" />
                Google Lens OCR سريع
              </span>
              <span className="flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                حفظ التنسيق والرسومات 100%
              </span>
            </div>

            {documentLoadError && (
              <div className="mt-4 p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{documentLoadError}</span>
              </div>
            )}
          </div>
        )}

        {/* Active Document Viewer */}
        {totalPages > 0 && (
          <DocumentViewer
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            originalImage={currentOriginalImage}
            translatedData={translations[currentPage] || null}
            settings={settings}
            onUpdateSettings={(newSettings) => setSettings((s) => ({ ...s, ...newSettings }))}
            isTranslatingCurrentPage={isTranslatingCurrentPage}
            onTranslateCurrentPage={handleTranslateCurrentPage}
            onSelectBlock={handleSelectBlock}
            activeBlockId={selectedBlock?.id || null}
          />
        )}
      </main>

      {/* Desktop/Tablet Bottom Filmstrip Thumbnails */}
      {totalPages > 0 && (
        <div className="hidden sm:block">
          <ThumbnailsBar
            totalPages={totalPages}
            currentPage={currentPage}
            onPageSelect={setCurrentPage}
            translations={translations}
          />
        </div>
      )}

      {/* Mobile-First Bottom Action Bar (Mobile Screens Only) */}
      {totalPages > 0 && (
        <MobileBottomNav
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          isTranslating={isTranslatingCurrentPage}
          isCurrentPageTranslated={isCurrentPageTranslated}
          onTranslateCurrentPage={handleTranslateCurrentPage}
          settings={settings}
          onUpdateSettings={(newSettings) => setSettings((s) => ({ ...s, ...newSettings }))}
          onOpenBatchModal={() => setIsBatchModalOpen(true)}
          onOpenExportModal={() => setIsExportModalOpen(true)}
          translatedCount={translatedCount}
        />
      )}

      {/* Interactive Text Block Inspector Modal */}
      <BlockInspectorModal
        block={selectedBlock}
        isOpen={isInspectorOpen}
        onClose={() => {
          setIsInspectorOpen(false);
          setSelectedBlock(null);
        }}
        onSaveBlock={handleSaveBlock}
        targetLang={settings.targetLang}
      />

      {/* Batch Translation Modal */}
      <BatchTranslationModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        totalPages={totalPages}
        currentPage={currentPage}
        translatedPages={Object.keys(translations).map(Number)}
        onStartBatch={handleStartBatch}
        onStopBatch={handleStopBatch}
        isBatchRunning={isBatchRunning}
        batchProgress={batchProgress}
      />

      {/* PDF Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        documentName={documentName}
        currentPage={currentPage}
        totalPages={totalPages}
        translations={translations}
        getPageImage={loadPageImage}
        targetLang={settings.targetLang}
        fontSizeAdjustment={settings.fontSizeAdjustment}
      />
    </div>
  );
}
