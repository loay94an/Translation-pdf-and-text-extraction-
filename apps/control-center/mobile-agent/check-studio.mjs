import fs from 'node:fs';

const file = 'apps/control-center/public/studio.html';
const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]);
if (scripts.length !== 1) throw new Error('Expected exactly one inline application script');
new Function(scripts[0]);
const required = [
  'id="pdf"', 'id="ocr"', 'id="models"', 'id="browser"', 'id="terminal"',
  'id="settings"', '/api/jobs', '/api/chat', '/api/exec', '/api/extracted-pages',
  'confirm(', 'localStorage'
];
for (const token of required) {
  if (!html.includes(token)) throw new Error('Missing required studio feature: ' + token);
}
console.log('Studio HTML and inline JavaScript checks passed.');
