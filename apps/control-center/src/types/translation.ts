export interface TextBlock {
  id: string;
  box2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0-1000 normalized range
  originalText: string;
  translatedText: string;
  category:
    | 'title'
    | 'heading'
    | 'paragraph'
    | 'diagram_label'
    | 'table_cell'
    | 'caption'
    | 'footnote'
    | 'header_footer'
    | string;
  fontSizeEstimate?: number;
  textColor?: string;
  backgroundColor?: string;
  isBold?: boolean;
  alignment?: 'right' | 'left' | 'center' | string;
}

export interface TranslatedPageData {
  pageNumber: number;
  detectedLanguage: string;
  targetLanguage: string;
  pageType?: string;
  summary?: string;
  blocks: TextBlock[];
  timestamp: number;
  pageWidth: number;
  pageHeight: number;
}

export interface SamplePdfInfo {
  available: boolean;
  filename: string;
  realFilename: string;
  sizeBytes: number;
  sizeMb: string;
  totalPagesEstimate: number;
  url: string;
}

export interface TranslationSettings {
  sourceLang: string;
  targetLang: string;
  domain: 'general' | 'technical' | 'medical' | 'legal' | 'academic' | 'business';
  preserveGraphics: boolean;
  maskOpacity: number; // 0 to 1 (1 = fully opaque white/paper patch, 0.9 = slight blend)
  renderMode: 'in_place' | 'dual_view' | 'overlay_compare' | 'text_focus';
  customGlossary: string;
  fontSizeAdjustment: number; // -4 to +8
}

export interface BatchTranslationJob {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  currentPageIndex: number;
  totalPages: number;
  pagesToProcess: number[];
  completedPages: number[];
  failedPages: number[];
  errorMessage?: string;
}
