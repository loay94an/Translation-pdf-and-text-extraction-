# تجهيز الهاتف لاستخراج مكتبة المراجع

## البنية المطلوبة

- الموقع: واجهة عربية تعمل من المتصفح أو كتطبيق PWA.
- Termux: خادم محلي مرافق على 127.0.0.1:8765.
- أدوات PDF: Poppler (pdftotext وpdfimages وpdftoppm).
- OCR: Tesseract مع ara وeng، ويمكن إضافة لغات أخرى حسب الكتب.
- النماذج المحلية: llama.cpp server بواجهة OpenAI-compatible على 127.0.0.1:8080/v1.
- النماذج السحابية: Gemini من خادم التطبيق؛ لا تضع مفاتيح API في صفحة المتصفح.

## تثبيت الأدوات

من Termux داخل مجلد mobile-agent:

```bash
bash install-termux.sh
bash doctor.sh
```

## تنزيل نسخة واجهة الهاتف

بعد تسجيل الدخول إلى GitHub من Termux (مرة واحدة)، نزّل فرع واجهة الهاتف في مجلد مستقل؛ فهو يحتوي خادم الاتصال وصفحة PWA:
```bash
pkg install gh -y
gh auth login
gh auth setup-git
git clone --branch feat/mobile-local-terminal-bridge https://github.com/loay94an/reference-and-books-on-patterns-and-models.git "$HOME/mobile-bridge"
```

## ربط مستودع الاستخراج

مجلد الاستخراج الذي يحتوي `extract_pages.py` و`scripts/analyze_scanned_pages.py` موجود في فرع العمل:

`feat/scanned-library-extraction-pipeline`

لأن المستودع خاص، سجّل الدخول أولاً (اختياريًا عبر GitHub CLI):

```bash
pkg install gh -y
gh auth login
gh auth setup-git
mkdir -p "$HOME/workspace"
git clone --branch feat/scanned-library-extraction-pipeline https://github.com/loay94an/reference-and-books-on-patterns-and-models.git "$HOME/workspace/reference-and-books-on-patterns-and-models"
```

إذا كان المجلد موجودًا بالفعل، لا تستنسخه مرة أخرى؛ حدّثه وتأكد من الفرع الصحيح. يجب أن يحتوي المجلد على:
- `assets/fashion-model-library/catalog/books.json`
- ملفات PDF الأصلية المتاحة محليًا (وقد تتطلب Git LFS).
- `extract_pages.py`
- `scripts/analyze_scanned_pages.py`

بعد الاستنساخ، تأكد من تنزيل كائنات Git LFS:
```bash
git -C "$HOME/workspace/reference-and-books-on-patterns-and-models" lfs pull
```
إذا لم يكن `git lfs` متاحًا في إصدار Termux لديك، نزّل ملفات PDF الأصلية إلى مجلدات المصدر يدويًا، ولا تبدأ الاستخراج قبل التأكد من وجودها.

## تشغيل الخادم وربطه بالموقع

شغّل خادم الهاتف من نسخة فرع واجهة الهاتف، مع توجيه مساحة العمل إلى نسخة مستودع الاستخراج:

```bash
cd /path/to/your/mobile-bridge-checkout/apps/Illustrated-pdf-books-turned-to-ash/mobile-agent
LOCAL_AGENT_WORKSPACE="$HOME/workspace/reference-and-books-on-patterns-and-models" \
LOCAL_AGENT_ALLOWED_ORIGINS="https://YOUR-PUBLISHED-DOMAIN" \
bash start.sh
```

استبدل `YOUR-PUBLISHED-DOMAIN` بعنوان الموقع الفعلي فقط. لا تستخدم `*` ولا تكشف المنفذ على الشبكة العامة. انسخ رمز الاتصال الظاهر في Termux إلى صفحة الطرفية المحلية، ولا تشاركه.

## تشغيل الاستخراج من واجهة الموقع

- شغّل فحص الأدوات أولًا.
- اختبر اتصال النموذج المحلي إذا كان llama-server يعمل على المنفذ 8080.
- شغّل استخراج النصوص المضمنة من PDF.
- بعد اكتماله شغّل OCR وفهرسة الصور للصفحات قليلة النص.
- تبقى نتائج OCR موسومة بأنها آلية وغير متحققة، ويجب مراجعتها قبل اعتماد القياسات أو تحويلها إلى باترونات.

## استخراج البيانات المنظمة بالنموذج

بعد اكتمال OCR، يوجد في فرع الاستخراج سكربت `scripts/model_enrich.py` يحوّل نص كل صفحة إلى حقول JSON منظمة:
- نوع القطعة أو الملابس عند ذكره صراحة.
- أسماء قطع الباترون كما وردت في النص.
- القياسات والقيم والوحدات مع مقتطف دليل من الصفحة.
- جداول المقاسات عندما تكون الصفوف واضحة بالكامل.
- طرق التنفيذ والخامات والمصطلحات الفنية.
- مواضع الشك التي تحتاج مراجعة بشرية.

السكربت قابل للاستئناف؛ يتجاوز الصفحات المسجلة مسبقًا ويحفظ كل صفحة فور نجاحها في `extracted-knowledge/structured-pages/`. ابدأ بعينة صغيرة:
```bash
python scripts/model_enrich.py --book-id BOOK_ID --max-pages 2
```
ثم شغّل جميع الصفحات:
```bash
python scripts/model_enrich.py --max-chars 800 --max-tokens 256
```
زر **استخراج البيانات بالنموذج** في صفحة الهاتف يشغّل هذه المرحلة في الخلفية.

## النماذج

لتشغيل llama.cpp، استخدم أمر `llama-server` المناسب لملف GGUF لديك، مع:
`--host 127.0.0.1 --port 8080`

يكتشف الموقع النماذج من:
`http://127.0.0.1:8080/v1/models`

يمكن تغيير العنوان عبر `LOCAL_MODEL_BASE_URL`، واختيار النموذج عبر `LOCAL_MODEL_NAME` (الافتراضي `qwen-local`)، وإضافة مفتاح عبر `LOCAL_MODEL_API_KEY` عند الحاجة. لا تضع المفتاح في HTML أو Git. النموذج المحلي الصغير مفيد للتصنيف الأولي لكنه قد لا يلتقط الجداول المعقدة بدقة؛ استخدم نموذجًا أقوى أو سحابيًا متوافقًا مع OpenAI عند الحاجة، وراجع النتائج دائمًا. هذا المسار النصي لا يحلل الرسومات أو هندسة قطع الباترون بصريًا.

## حدود مهمة

- مهام الاستخراج تعمل بالخلفية ويمكن متابعة مخرجاتها، لكن حالة المهمة الحية محفوظة في ذاكرة الخادم؛ إذا أُغلق Termux أو أعيد تشغيله، ستحتاج إلى مراجعة ملفات السجل ومخرجات الاستخراج قبل إعادة المهمة.
- يجب أن تبقى ملفات PDF ومساحة التخزين متاحة، والهاتف موصولًا بالطاقة عند معالجة الكتب الطويلة.
- هذا ليس عزلًا أمنيًا كاملًا: الأوامر تعمل بصلاحيات مستخدم Termux. لا تشغّل أوامر غير موثوقة.
- لا يتم رفع ملفات الكتب تلقائيًا إلى GitHub أو إلى أي خدمة سحابية. ارفع النتائج المسموح بها فقط بعد مراجعة الترخيص والخصوصية.
