# مركز التحكم لنظام Android

تم استيراد مشروع مركز التحكم إلى هذا المستودع داخل `mobile-agent/` مع إبقاء ملفات المشروع الأصلية في جذر المستودع دون استبدال.

## المحتويات
- `mobile-agent/android-app/`: تطبيق Android أصلي باستخدام Kotlin وJetpack Compose.
- `mobile-agent/agent.mjs`: خادم محلي يعمل داخل Termux على `127.0.0.1:8765`.
- `mobile-agent/install-termux.sh`: تثبيت Node.js وأدوات PDF/OCR.
- `mobile-agent/install-boot-start.sh`: إعداد بدء الخادم عند إقلاع الهاتف عبر Termux:Boot.
- ملفات التوثيق العربية تشرح تكامل Chrome، استخراج المراجع، ومزودي النماذج.

## بناء APK
يعمل GitHub Actions عبر:
`.github/workflows/android-control-center-build.yml`

عند نجاح البناء سيظهر artifact باسم `control-center-debug-apk` يحتوي على:
`app-debug.apk`

يمكن تشغيل البناء يدويًا من تبويب Actions باستخدام workflow_dispatch.

## إعداد Termux على الهاتف
من مجلد `mobile-agent`:
```bash
bash install-termux.sh
termux-setup-storage
bash start.sh
```
انسخ رمز Bearer الذي يظهر في سجل الخادم إلى التطبيق، ثم اختبر الاتصال. لإعداد التشغيل بعد إعادة تشغيل الهاتف راجع `mobile-agent/README.md` وثبّت Termux:Boot.

## حدود التنفيذ الحالية
- تكامل النموذج المحلي عبر خادم OpenAI-compatible محلي؛ يجب أن يكون النموذج المحلي يعمل على المنفذ المضبوط.
- لا يوجد بعد تكامل SIWC الرسمي مع ChatGPT.
- لا يقرأ التطبيق Cookies أو كلمات مرور Chrome ولا يستخرج جلسة ChatGPT.
- OCR للـPDF المصوّر يجري عبر Poppler وTesseract في Termux.
- لا يوجد APK إنتاجي موقّع أو نشر متجر حتى الآن.
- أوامر Termux تعمل بصلاحيات مستخدم Termux؛ راجع الأوامر قبل تنفيذها.

## الفرع
التغييرات أضيفت إلى:
`feat/android-control-center-import`

ولم يتم الدمج في `main`.
