# تجهيز الهاتف لاستخراج ملفات PDF

## مكونات النظام

- واجهة PDF في `apps/control-center/`.
- خادم Termux المحلي وواجهة التحكم في `apps/control-center/mobile-agent/`.
- محركات الاستخراج في `extraction/` في جذر هذا المستودع.
- ملفات الكتب الأصلية والفهرس الخاص تبقى في مساحة عمل خاصة منفصلة ولا تُرفع إلى المستودع العام.

## تثبيت Termux

من مجلد المشروع:

```bash
pkg update -y
pkg install -y nodejs-lts python poppler tesseract
cd "$HOME/workspace/Translation-pdf-and-text-extraction-/apps/control-center/mobile-agent"
bash install-termux.sh
bash doctor.sh
bash start.sh
```

يعين `start.sh` متغير `EXTRACTION_ROOT` تلقائيًا إلى مجلد `extraction` في جذر المستودع. خادم الطرفية يستمع إلى `127.0.0.1` ويولد رمز Bearer عشوائيًا؛ لا تشارك الرمز ولا تفتح المنفذ على الشبكة العامة.

## تجهيز مكتبة المراجع

ضع نسخة مكتبة المراجع الخاصة في مجلد منفصل ضمن مساحة العمل، مثل:

`$HOME/workspace/reference-and-books-on-patterns-and-models`

يجب أن تحتوي على:
- `assets/fashion-model-library/catalog/books.json`
- ملفات PDF الأصلية في مساراتها المتوقعة.

هذه الملفات غير موجودة في المستودع العام. احتفظ بها في مستودع خاص أو على الجهاز، ولا ترفع ملفات PDF أو صور الصفحات أو النصوص الكاملة المستخرجة إلى GitHub العام.

## تشغيل الاستخراج من واجهة الطرفية

في صفحة الطرفية المحلية:
1. اتصل بخادم Termux باستخدام الرمز.
2. غيّر مجلد العمل إلى مجلد مكتبة المراجع الخاصة.
3. شغّل استخراج النصوص المضمنة.
4. شغّل OCR للصفحات المصورة.
5. شغّل استخراج البيانات المنظمة بالنموذج المحلي عند الحاجة.

المحركات التي تستدعيها الواجهة موجودة هنا:
- `$EXTRACTION_ROOT/extract_pages.py`
- `$EXTRACTION_ROOT/scripts/analyze_scanned_pages.py`
- `$EXTRACTION_ROOT/scripts/model_enrich.py`

## متطلبات OCR

ثبت Poppler وTesseract، وتأكد من توفر اللغتين العربية والإنجليزية. بعض توزيعات Termux تحتاج تثبيت حزم اللغات بشكل منفصل. افحص الأدوات عبر:

```bash
pdftotext -v
pdfimages -v
pdftoppm -v
tesseract --list-langs
```

## النموذج المحلي

شغّل خادم llama.cpp بواجهة OpenAI-compatible على:

`http://127.0.0.1:8080/v1`

يمكن ضبط:
- `LOCAL_MODEL_BASE_URL`
- `LOCAL_MODEL_NAME`
- `LOCAL_MODEL_API_KEY` (إذا كان خادمك المحلي يطلبه)

لا تحفظ المفاتيح في ملفات Git أو HTML. راجع نتائج OCR والبيانات المنظمة قبل اعتمادها؛ قد يخطئ النموذج في الأرقام والجداول والقياسات.

## حدود التكامل

- ربط النموذج المحلي متاح عبر خادم Termux إذا كان خادم النموذج يعمل.
- تكامل ChatGPT عبر Sign in with ChatGPT موثق كتصميم، لكنه ليس منفذًا بالكامل في التطبيق الحالي.
- لا يقرأ التطبيق Cookies أو سجل Chrome أو جلسات تطبيق ChatGPT.
- أوامر Termux تعمل بصلاحيات المستخدم؛ لا تشغّل أوامر غير موثوقة.
