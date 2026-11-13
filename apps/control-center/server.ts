import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// High limit for processing large scanned PDF page images (up to 50MB)
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Initialize GoogleGenAI client (Server-side only)
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

const SAMPLE_PDF_PATH = path.join(
  __dirname,
  'public/assets/aistudio/_________________edited__1__803c6a16.pdf'
);

// Serve static public folder for local pdf.worker.min.mjs and assets
app.use(express.static(path.join(__dirname, 'public')));

// Route: Sample PDF metadata
app.get('/api/sample-pdf-meta', (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(SAMPLE_PDF_PATH)) {
      const stats = fs.statSync(SAMPLE_PDF_PATH);
      res.json({
        available: true,
        filename: 'مستند_مصور_نموذجي_كبير_326_صفحة.pdf',
        realFilename: '_________________edited__1__803c6a16.pdf',
        sizeBytes: stats.size,
        sizeMb: (stats.size / (1024 * 1024)).toFixed(1),
        totalPagesEstimate: 326,
        url: '/assets/aistudio/_________________edited__1__803c6a16.pdf',
      });
    } else {
      res.json({ available: false, message: 'Sample PDF not found in local path' });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Route: Stream sample PDF with native HTTP 206 Range requests & connection close cleanup
app.get('/api/sample-pdf', (req: Request, res: Response) => {
  try {
    if (!fs.existsSync(SAMPLE_PDF_PATH)) {
      res.status(404).send('Sample PDF not found');
      return;
    }

    const stat = fs.statSync(SAMPLE_PDF_PATH);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/pdf');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);

      const fileStream = fs.createReadStream(SAMPLE_PDF_PATH, { start, end });
      fileStream.pipe(res);

      req.on('close', () => {
        fileStream.destroy();
      });
      fileStream.on('error', (err) => {
        console.warn('Stream aborted or errored:', err.message);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
    } else {
      res.status(200);
      res.setHeader('Content-Length', fileSize);
      const fileStream = fs.createReadStream(SAMPLE_PDF_PATH);
      fileStream.pipe(res);

      req.on('close', () => {
        fileStream.destroy();
      });
      fileStream.on('error', (err) => {
        console.warn('Full stream aborted or errored:', err.message);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
    }
  } catch (err) {
    console.error('Error in sample-pdf stream:', err);
    if (!res.headersSent) {
      res.status(500).send('Error reading PDF file');
    }
  }
});

// Language display helper
function getLanguageLabel(code: string): string {
  const map: Record<string, string> = {
    ar: 'العربية (Arabic)',
    en: 'الإنجليزية (English)',
    fr: 'الفرنسية (French)',
    de: 'الألمانية (German)',
    es: 'الإسبانية (Spanish)',
    tr: 'التركية (Turkish)',
    zh: 'الصينية (Chinese)',
    ru: 'الروسية (Russian)',
    ja: 'اليابانية (Japanese)',
    auto: 'اكتشاف تلقائي (Auto-Detect)',
  };
  return map[code] || code;
}

// Route: OCR & Translate Page with Layout Preservation
app.post('/api/translate-page', async (req: Request, res: Response) => {
  try {
    if (!ai) {
      res.status(503).json({ success: false, error: 'GEMINI_API_KEY is not configured on the server' });
      return;
    }
    const {
      pageImage,
      pageNumber = 1,
      sourceLang = 'auto',
      targetLang = 'ar',
      domain = 'general',
      preserveGraphics = true,
      customGlossary = '',
    } = req.body;

    if (!pageImage || typeof pageImage !== 'string') {
      res.status(400).json({ error: 'pageImage base64 is required' });
      return;
    }

    // Extract base64 and mime type
    let mimeType = 'image/jpeg';
    let base64Data = pageImage;
    if (pageImage.includes(';base64,')) {
      const parts = pageImage.split(';base64,');
      mimeType = parts[0].replace('data:', '');
      base64Data = parts[1];
    }

    const targetLangName = getLanguageLabel(targetLang);
    const sourceLangName = sourceLang === 'auto' ? 'Auto-Detect' : getLanguageLabel(sourceLang);

    const prompt = `You are Google Lens Translate AI engine specialized in document layout preservation and tables.
Analyze this scanned page (Page ${pageNumber}) and translate all text into ${targetLangName}.

CRITICAL RULES TO PREVENT TEXT OVERLAP AND TABLE DISTORTION:
1. PRECISE BOUNDING BOXES: For every text block, title, paragraph, table cell, or diagram label, give the exact [ymin, xmin, ymax, xmax] coordinates normalized from 0 to 1000.
2. TABLES & GRIDS: If the page contains tables, treat each table cell as an individual text block with tight box coordinates [ymin, xmin, ymax, xmax] so text stays strictly inside its table cell without spilling over adjacent cells.
3. NO OVERLAPPING BOXES: Ensure box coordinates do not overlap incorrectly.
4. Return originalText, translatedText, category, fontSizeEstimate, textColor, backgroundColor, isBold, alignment.
Output strict JSON matching schema.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: [
        {
          inlineData: {
            mimeType: mimeType || 'image/jpeg',
            data: base64Data,
          },
        },
        {
          text: prompt,
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pageNumber: { type: Type.INTEGER },
            detectedLanguage: { type: Type.STRING },
            targetLanguage: { type: Type.STRING },
            pageType: {
              type: Type.STRING,
              description: 'e.g., technical_diagram, scanned_text, table_data, mixed_layout, cover_page',
            },
            summary: {
              type: Type.STRING,
              description: 'Short 1-sentence summary of this page in Arabic & English',
            },
            blocks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  box2d: {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER },
                    description: '[ymin, xmin, ymax, xmax] coordinates normalized from 0 to 1000',
                  },
                  originalText: { type: Type.STRING },
                  translatedText: { type: Type.STRING },
                  category: { type: Type.STRING },
                  fontSizeEstimate: { type: Type.NUMBER },
                  textColor: { type: Type.STRING },
                  backgroundColor: { type: Type.STRING },
                  isBold: { type: Type.BOOLEAN },
                  alignment: { type: Type.STRING },
                },
                required: ['id', 'box2d', 'originalText', 'translatedText', 'category'],
              },
            },
          },
          required: ['detectedLanguage', 'blocks'],
        },
      },
    });

    const rawText = response.text;
    if (!rawText) {
      throw new Error('No response received from translation model');
    }

    const parsedData = JSON.parse(rawText);
    res.json({
      success: true,
      data: parsedData,
    });
  } catch (error) {
    console.error('Error translating page:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message || 'Failed to translate page',
    });
  }
});

// Route: Refine or rephrase a specific block translation
app.post('/api/refine-block', async (req: Request, res: Response) => {
  try {
    if (!ai) {
      res.status(503).json({ success: false, error: 'GEMINI_API_KEY is not configured on the server' });
      return;
    }
    const { originalText, currentTranslation, instruction, targetLang = 'ar' } = req.body;

    const prompt = `Refine this translated text block from a scanned document.
Original text: "${originalText}"
Current translation: "${currentTranslation}"
User instruction: "${instruction}"
Target language: ${getLanguageLabel(targetLang)}

Provide an improved translation strictly adhering to the user's instruction (e.g. more formal, more concise, technical terminology, or corrected grammar).
Return JSON with { "refinedTranslation": "..." }`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            refinedTranslation: { type: Type.STRING },
          },
          required: ['refinedTranslation'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({ success: true, refinedTranslation: parsed.refinedTranslation });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Express & Vite integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
