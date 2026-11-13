package com.loay94an.controlcenter

import android.content.Intent
import android.content.ContentValues
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class MainActivity : ComponentActivity() {
    private var sharedContent by mutableStateOf("")
    private var incomingStatus by mutableStateOf("جاهز")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        acceptIncomingIntent(intent)
        setContent {
            MaterialTheme {
                ControlCenterScreen(
                    initialContent = sharedContent,
                    initialToken = TokenVault.read(this),
                    initialStatus = incomingStatus,
                    onOpenChrome = ::openInChrome,
                    onShare = ::shareText,
                    onReadUri = ::readSharedUri,
                    onConnect = ::connectAgent,
                    onRunCommand = ::runCommand,
                    onRunOcr = ::runOcr,
                    onAskLocal = ::askLocalModel
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        acceptIncomingIntent(intent)
    }

    private fun acceptIncomingIntent(intent: Intent?) {
        if (intent == null) return
        lifecycleScope.launch {
            when (intent.action) {
                Intent.ACTION_SEND -> {
                    val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
                    val fileText = uri?.let { readSharedUri(it) }.orEmpty()
                    sharedContent = listOf(text, fileText).filter { it.isNotBlank() }.joinToString("\n\n")
                }
                Intent.ACTION_SEND_MULTIPLE -> {
                    @Suppress("DEPRECATION")
                    val uris = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
                    sharedContent = uris.take(8).joinToString("\n\n") { readSharedUri(it) }
                }
                Intent.ACTION_VIEW -> sharedContent = intent.dataString.orEmpty()
            }
            incomingStatus = if (sharedContent.isBlank()) "لم أتمكن من قراءة محتوى المشاركة" else "تم استقبال المحتوى"
        }
    }

    private fun openInChrome(rawUrl: String) {
        val value = rawUrl.trim()
        val normalized = if (value.startsWith("https://") || value.startsWith("http://")) value else "https://$value"
        val uri = Uri.parse(normalized)
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage("com.android.chrome"))
        } catch (_: Exception) {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
    }

    private fun shareText(text: String) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        startActivity(Intent.createChooser(send, "مشاركة النتيجة"))
    }

    private suspend fun readSharedUri(uri: Uri): String = withContext(Dispatchers.IO) {
        val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: "shared-file"
        val mime = contentResolver.getType(uri).orEmpty()
        val temp = File(cacheDir, "incoming-${System.currentTimeMillis()}-${name.replace(Regex("[^A-Za-z0-9._-]"), "_")}")
        try {
            contentResolver.openInputStream(uri)?.use { input ->
                temp.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= 50L * 1024 * 1024) { "حجم الملف يتجاوز حد 50MB" }
                        output.write(buffer, 0, count)
                    }
                }
            } ?: return@withContext "تعذر فتح الملف: $name"
            val sharedPath = copyToDownloads(temp, name, mime)
            val pathNote = sharedPath?.let { "\nنسخة متاحة لـTermux: ~/storage/downloads/ControlCenter/$it" }.orEmpty()
            when {
                mime.startsWith("text/") || name.endsWith(".txt", true) || name.endsWith(".md", true) ||
                    name.endsWith(".csv", true) || name.endsWith(".json", true) -> {
                    val bytes = temp.readBytes().take(1_000_000).toByteArray()
                    "الملف: $name$pathNote\n\n" + String(bytes, StandardCharsets.UTF_8)
                }
                mime == "application/pdf" || name.endsWith(".pdf", true) -> {
                    com.tom_roush.pdfbox.android.PDFBoxResourceLoader.init(this@MainActivity)
                    val pdf = com.tom_roush.pdfbox.pdmodel.PDDocument.load(temp)
                    try {
                        val stripper = com.tom_roush.pdfbox.text.PDFTextStripper()
                        stripper.startPage = 1
                        stripper.endPage = minOf(pdf.numberOfPages, 40)
                        "الملف: $name — الصفحات: ${pdf.numberOfPages}$pathNote\n\n" + stripper.getText(pdf).take(1_000_000)
                    } finally { pdf.close() }
                }
                else -> "تم استلام الملف: $name$pathNote\nنوع المحتوى: $mime\nهذا النوع يحتاج محرك استخراج مناسبًا."
            }
        } catch (error: Exception) {
            "تعذر قراءة $name: ${error.message}"
        } finally {
            temp.delete()
        }
    }

    private fun copyToDownloads(source: File, originalName: String, mime: String): String? {
        if (Build.VERSION.SDK_INT < 29) return null
        val safeName = originalName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(100).ifBlank { "shared-file" }
        val outputName = "${System.currentTimeMillis()}-$safeName"
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, outputName)
            put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
            put(MediaStore.Downloads.RELATIVE_PATH, "Download/ControlCenter")
        }
        val target = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        return try {
            contentResolver.openOutputStream(target)?.use { output -> source.inputStream().use { it.copyTo(output) } }
                ?: throw IllegalStateException("تعذر حفظ نسخة المشاركة")
            outputName
        } catch (error: Exception) {
            contentResolver.delete(target, null, null)
            null
        }
    }
    private suspend fun connectAgent(token: String): String = withContext(Dispatchers.IO) {
        require(token.length >= 40) { "رمز الاتصال غير مكتمل؛ انسخ الرمز من تشغيل خادم Termux." }
        val response = request(token, "GET", "/api/health")
        TokenVault.write(this@MainActivity, token)
        "تم الاتصال بخادم Termux: ${response.optString("platform")} — مساحة العمل: ${response.optString("workspace")}"
    }

    private suspend fun runCommand(token: String, command: String): String = withContext(Dispatchers.IO) {
        require(command.isNotBlank()) { "اكتب أمرًا أولًا." }
        val body = JSONObject().put("command", command).put("cwd", ".").toString()
        val response = request(token, "POST", "/api/exec", body)
        "رمز الخروج: ${response.optInt("exitCode")}\n\nSTDOUT:\n${response.optString("stdout")}\n\nSTDERR:\n${response.optString("stderr")}"
    }

    private suspend fun runOcr(token: String, filename: String): String = withContext(Dispatchers.IO) {
        require(filename.matches(Regex("[A-Za-z0-9._-]{1,140}\\.pdf", RegexOption.IGNORE_CASE))) { "اسم ملف PDF غير صالح." }
        val file = "\$HOME/storage/downloads/ControlCenter/$filename"
        val command = "mkdir -p \"\$HOME/workspace/ocr\" && rm -f \"\$HOME/workspace/ocr\"/page-*.png && pdftoppm -f 1 -l 40 -r 250 -png \"$file\" \"\$HOME/workspace/ocr/page\" && for f in \"\$HOME/workspace/ocr\"/page-*.png; do [ -f \"\$f\" ] || continue; echo \"--- \$(basename \"\$f\") ---\"; tesseract \"\$f\" stdout -l ara+eng 2>/dev/null; done"
        val response = request(token, "POST", "/api/exec", JSONObject().put("command", command).put("cwd", ".").toString())
        "رمز الخروج: ${response.optInt("exitCode")}\n${response.optString("stdout")}\n${response.optString("stderr")}"
    }
    private suspend fun askLocalModel(token: String, prompt: String): String = withContext(Dispatchers.IO) {
        require(prompt.isNotBlank()) { "لا يوجد نص لإرساله." }
        val messages = JSONArray().put(JSONObject().put("role", "user").put("content", prompt))
        val body = JSONObject().put("provider", "local").put("messages", messages).toString()
        request(token, "POST", "/api/chat", body).optString("content", "لم يصل رد نصي من النموذج.")
    }

    private fun request(token: String, method: String, path: String, body: String? = null): JSONObject {
        val connection = URL("http://127.0.0.1:8765$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 5000
            connection.readTimeout = 125000
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = JSONObject(raw.ifBlank { "{}" })
            if (status !in 200..299 || json.optBoolean("ok") == false) {
                throw IllegalStateException(json.optString("error").ifBlank { "فشل الاتصال ($status)" })
            }
            return json
        } finally { connection.disconnect() }
    }
}

private object TokenVault {
    private const val PREFS = "control_center_secure"
    private const val TOKEN = "termux_token"
    private const val KEY_ALIAS = "control_center_token_key"

    fun write(activity: ComponentActivity, value: String) {
        val key = getOrCreateKey()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val encrypted = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        val stored = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP)
        activity.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(TOKEN, stored).apply()
    }

    fun read(activity: ComponentActivity): String {
        return try {
            val stored = activity.getSharedPreferences(PREFS, MODE_PRIVATE).getString(TOKEN, null) ?: return ""
            val parts = stored.split(":")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8)
        } catch (_: Exception) { "" }
    }

    private fun getOrCreateKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance("AES", "AndroidKeyStore")
        generator.init(android.security.keystore.KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        return generator.generateKey()
    }

    private const val MODE_PRIVATE = 0
}

@Composable
private fun ControlCenterScreen(
    initialContent: String,
    initialToken: String,
    initialStatus: String,
    onOpenChrome: (String) -> Unit,
    onShare: (String) -> Unit,
    onReadUri: suspend (Uri) -> String,
    onConnect: suspend (String) -> String,
    onRunCommand: suspend (String, String) -> String,
    onRunOcr: suspend (String, String) -> String,
    onAskLocal: suspend (String, String) -> String
) {
    var content by remember { mutableStateOf(initialContent) }
    var token by remember { mutableStateOf(initialToken) }
    var url by remember { mutableStateOf("https://www.google.com") }
    var command by remember { mutableStateOf("pwd && ls -la") }
    var output by remember { mutableStateOf("") }
    var status by remember { mutableStateOf(initialStatus) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val documentPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            content = onReadUri(uri)
            status = "تم استيراد محتوى الملف"
            busy = false
        }
    }
    LaunchedEffect(initialContent) { if (initialContent.isNotBlank()) content = initialContent }
    LaunchedEffect(initialStatus) { status = initialStatus }

    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(18.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("مركز التحكم", style = MaterialTheme.typography.headlineMedium)
            Text("Chrome • ChatGPT • النموذج المحلي • Termux")
            Text("الحالة: $status", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(value = url, onValueChange = { url = it }, label = { Text("رابط لفتحه في Chrome") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { onOpenChrome(url) }, modifier = Modifier.fillMaxWidth()) { Text("فتح في Google Chrome") }

            HorizontalDivider()
            Text("ربط الطرفية المحلية", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = token, onValueChange = { token = it },
                label = { Text("رمز Termux — يُدخل مرة واحدة") }, modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Button(enabled = !busy && token.length >= 40, onClick = {
                scope.launch {
                    busy = true
                    status = try { onConnect(token) } catch (e: Exception) { "فشل الاتصال: ${e.message}" }
                    busy = false
                }
            }, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الاتصال..." else "اختبار الاتصال وحفظه") }

            OutlinedTextField(value = command, onValueChange = { command = it }, label = { Text("أمر Linux") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            Button(enabled = !busy && token.length >= 40 && command.isNotBlank(), onClick = {
                scope.launch {
                    busy = true
                    output = try { onRunCommand(token, command) } catch (e: Exception) { "خطأ: ${e.message}" }
                    busy = false
                }
            }, modifier = Modifier.fillMaxWidth()) { Text("تنفيذ الأمر في Termux") }

            OutlinedButton(onClick = { documentPicker.launch(arrayOf("*/*")) }, modifier = Modifier.fillMaxWidth()) { Text("اختيار ملف أو PDF") }
            OutlinedTextField(value = content, onValueChange = { content = it }, label = { Text("النص المستلم أو المستخرج") }, modifier = Modifier.fillMaxWidth(), minLines = 5)
            val pdfMatch = Regex("نسخة متاحة لـTermux: ~/storage/downloads/ControlCenter/([A-Za-z0-9._-]+\\.pdf)", RegexOption.IGNORE_CASE).find(content)
            if (pdfMatch != null) {
                OutlinedButton(enabled = !busy && token.length >= 40, onClick = {
                    scope.launch {
                        busy = true
                        output = try { onRunOcr(token, pdfMatch.groupValues[1]) } catch (e: Exception) { "OCR error: ${e.message}" }
                        busy = false
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text("تشغيل OCR عربي/إنجليزي عبر Termux") }
            }
            Button(enabled = !busy && token.length >= 40 && content.isNotBlank(), onClick = {
                scope.launch {
                    busy = true
                    output = try { onAskLocal(token, content) } catch (e: Exception) { "خطأ: ${e.message}" }
                    busy = false
                }
            }, modifier = Modifier.fillMaxWidth()) { Text("تحليل بالنموذج المحلي") }
            if (output.isNotBlank()) {
                Text("النتيجة", style = MaterialTheme.typography.titleMedium)
                SelectionContainer { Text(output) }
                OutlinedButton(onClick = { onShare(output) }) { Text("مشاركة النتيجة") }
            }
            HorizontalDivider()
            Text("ChatGPT: لم يُفعّل SIWC بعد؛ لا يتم استخدام جلسة Chrome أو استخراج ملفات تعريف الارتباط.")
            Text("ملاحظة: أوامر الطرفية تُنفذ بصلاحيات Termux. لا تنفذ أوامر غير موثوقة.")
        }
    }
}
