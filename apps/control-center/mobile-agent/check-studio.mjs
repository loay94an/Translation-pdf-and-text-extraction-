import fs from 'node:fs';

const file = 'apps/control-center/public/studio.html';
const html = fs.readFileSync(file, 'utf8');
const androidAsset = 'apps/control-center/mobile-agent/android-app/app/src/main/assets/studio.html';
const bundledHtml = fs.readFileSync(androidAsset, 'utf8');
if (bundledHtml !== html) throw new Error('Android Studio asset is out of sync with the web Studio source');
for (const token of ['AndroidSecureStore', 'getToken', 'setToken']) {
  if (!html.includes(token)) throw new Error('Missing secure Android token bridge: ' + token);
}
const activity = fs.readFileSync('apps/control-center/mobile-agent/android-app/app/src/main/java/com/loay94an/controlcenter/MainActivity.kt', 'utf8');
for (const token of ['WebViewAssetLoader', 'AndroidSecureStore', 'appassets.androidplatform.net/assets/studio.html']) {
  if (!activity.includes(token)) throw new Error('Missing embedded Android Studio integration: ' + token);
}
const agent = fs.readFileSync('apps/control-center/mobile-agent/agent.mjs', 'utf8');
for (const token of ['/api/files/pdf', '/api/model-config', '/api/models', '/api/chat']) {
  if (!agent.includes(token)) throw new Error('Missing Termux agent API route: ' + token);
}
for (const token of ['id="pdfFile"', 'id="uploadPdf"', 'id="modelEndpoint"', '--base-url']) {
  if (!html.includes(token)) throw new Error('Missing PDF/model integration in Studio: ' + token);
}
for (const token of ['WebChromeClient', 'onShowFileChooser', 'studioPdfPicker', 'openStudioPdfPicker']) {
  if (!activity.includes(token)) throw new Error('Missing Android PDF picker integration: ' + token);
}
const startScript = fs.readFileSync('apps/control-center/mobile-agent/start.sh', 'utf8');
if (!startScript.includes('https://appassets.androidplatform.net')) throw new Error('Android Studio origin is not allowed by the Termux agent launcher');
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
  'confirm(', 'localStorage', 'id="quickCommands"', 'id="commandSearch"', 'id="customCommandName"', 'id="customCommandValue"', 'id="saveCustomCommand"', 'id="analyzeTerminalError"', 'id="storageInfo"', 'id="refreshStorage"', 'cc_custom_commands', '/api/storage', 'LOCAL_AGENT_WORKSPACE', 'id="termuxSetupCommand"', 'id="copySetupCommand"', 'cat "$HOME/.config/mobile-terminal-bridge/token"'
];
for (const token of required) {
  if (!html.includes(token)) throw new Error('Missing required studio feature: ' + token);
}
console.log('Studio HTML and inline JavaScript checks passed.');
