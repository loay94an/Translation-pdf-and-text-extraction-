import fs from 'node:fs';

const file = 'apps/control-center/public/studio.html';
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('<script>');
const end = html.indexOf('</script>', start + 8);
if (start < 0 || end < 0 || html.indexOf('<script>', start + 8) >= 0) {
  throw new Error('Expected exactly one inline application script');
}
const script = html.slice(start + 8, end);
new Function(script);
const required = [
  'id="pdf"', 'id="ocr"', 'id="models"', 'id="browser"', 'id="terminal"',
  'id="settings"', 'id="translation"', 'id="sourceLanguage"', 'id="targetLanguage"', 'id="translationModel"', 'id="translationImages"', 'id="translationChunkChars"', 'id="translationProgress"', 'id="htmlContent"', 'startTranslation', 'pollTranslation', 'translate_extracted_pages.py', 'id="ocrMode"', 'id="minTextChars"', 'id="cancelJob"', 'id="jobsHistory"', '/api/jobs', '/api/chat', '/api/exec', '/api/extracted-pages', '/api/context', 'p.percent', '/cancel', '/retry',
  'confirm(', 'localStorage'
];
for (const token of required) {
  if (!html.includes(token)) throw new Error('Missing required studio feature: ' + token);
}
console.log('Studio HTML and inline JavaScript checks passed.');
