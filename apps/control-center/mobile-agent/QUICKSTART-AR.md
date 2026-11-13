# دليل التشغيل السريع — مركز PDF والتحكم المركزي

## تنزيل المشروع على Android / Termux

```bash
pkg update -y
pkg install -y git nodejs-lts python poppler tesseract
mkdir -p "$HOME/workspace"
cd "$HOME/workspace"
git clone https://github.com/loay94an/Translation-pdf-and-text-extraction-.git
cd Translation-pdf-and-text-extraction-/apps/control-center/mobile-agent
bash install-termux.sh
bash doctor.sh
bash start.sh
```

عند تشغيل الخادم يظهر رمز اتصال. احتفظ به محليًا ولا تنشره. افتح واجهة الطرفية من الموقع/الواجهة وأدخل الرمز.

## تجهيز ملفات الكتب للاستخراج

محركات الاستخراج موجودة في المستودع العام داخل `extraction/`.

لكن ملفات الكتب وبيانات المراجع الأصلية لم تُنقل لأنها محفوظة في مستودع خاص ولا ينبغي نشرها. ضع نسخة العمل الخاصة التي تحتوي على:

- `assets/fashion-model-library/catalog/books.json`
- مجلدات ملفات PDF الأصلية

داخل مساحة عمل Termux، مثل:

`$HOME/workspace/reference-and-books-on-patterns-and-models`

عند استخدام أزرار OCR والاستخراج في واجهة الطرفية، اجعل مجلد العمل الحالي هو مجلد مكتبة المراجع هذا. يحدد `start.sh` تلقائيًا `EXTRACTION_ROOT` إلى مجلد `extraction` في نسخة المستودع العام، وتستخدم الواجهة هذه المسارات لتشغيل المحركات. لا تبدأ المعالجة قبل التأكد من وجود ملفات PDF ومجلد الفهرس.

## تشغيل واجهة PDF وخادم الترجمة

```bash
cd "$HOME/workspace/Translation-pdf-and-text-extraction-/apps/control-center"
npm install
npm run build
npm start
```

يعمل خادم Node على المنفذ 3000 افتراضيًا. ميزة الترجمة السحابية في الخادم الحالي تحتاج متغير البيئة `GEMINI_API_KEY` محفوظًا على الخادم فقط؛ لا تضعه في ملفات الواجهة أو Git. واجهة PDF تستطيع أيضًا استقبال ملفات يختارها المستخدم، أما عينة PDF المضمنة القديمة فلم تُنقل إلى المستودع.

## ملاحظات مهمة

- لا تُرفع ملفات الكتب أو صور الصفحات أو OCR الخام إلى المستودع العام.
- خادم Termux يستمع محليًا فقط، ورمز الاتصال سري.
- أوامر Termux تنفذ بصلاحيات المستخدم؛ راجع الأمر قبل تشغيله.
- تكامل ChatGPT الرسمي عبر SIWC ما زال موثقًا كمرحلة تصميم وليس تكاملًا مكتملًا.
- لا تعتبر التطبيق أو الموقع منشورًا نهائيًا قبل نجاح اختبارات البناء وتجربة الاتصال على هاتف Android فعلي.