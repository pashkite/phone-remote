package com.galaxyremote.app

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.media.projection.MediaProjectionConfig
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var preferences: RemotePreferences
    private var editingRegistration = false
    private lateinit var statusBadge: TextView
    private lateinit var pairingDescription: TextView
    private lateinit var pairingCode: EditText
    private lateinit var pairButton: Button
    private lateinit var accessibilityStatus: TextView
    private lateinit var accessibilityButton: Button
    private lateinit var keyboardStatus: TextView
    private lateinit var keyboardButton: Button
    private lateinit var standbyStatus: TextView
    private lateinit var standbyButton: Button
    private val executor = Executors.newSingleThreadExecutor()
    private var receiverRegistered = false
    private var startListenerAfterNotification = false
    private var pendingSessionId: String? = null
    private var preparingTrustedAccess = false
    private var runtimeErrorDialogShowing = false
    private var incomingManager: RemoteFileTransfer? = null
    private var incomingId: String? = null
    private val sendFilePicker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) RemoteFileTransfer.current?.queueFiles(uris)
    }
    private val receiveFilePicker = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val manager = incomingManager
        val id = incomingId
        incomingManager = null; incomingId = null
        if (uri != null && manager != null && manager === RemoteFileTransfer.current && id != null && manager.pendingOffer?.id == id) manager.accept(uri, id)
        else {
            if (uri != null) try { android.provider.DocumentsContract.deleteDocument(contentResolver, uri) } catch (_: Exception) { }
            manager?.cancel()
        }
    }
    private val diagnosticsPicker = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) try { contentResolver.openOutputStream(uri)?.use { it.write(RemoteDiagnostics.export(this).toByteArray(Charsets.UTF_8)) } }
        catch (_: Exception) { Toast.makeText(this, "진단 저장 실패", Toast.LENGTH_LONG).show() }
    }
    private val audioPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        Toast.makeText(this, if (granted) "PC에서 소리 켜기를 눌러 주세요. 마이크 소리는 보내지 않습니다." else "소리 권한이 거부됐습니다. 화면 조작은 계속 가능합니다.", Toast.LENGTH_LONG).show()
    }

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            setStatus("화면 공유 승인이 취소되었습니다.", false)
            if (preparingTrustedAccess) {
                preparingTrustedAccess = false
                Toast.makeText(
                    this,
                    "자동 연결을 준비하려면 Android 화면 공유를 한 번 허용해 주세요.",
                    Toast.LENGTH_LONG,
                ).show()
            } else {
                rejectPendingSession()
                Toast.makeText(this, "PC 연결 요청을 승인하려면 화면 공유를 허용해 주세요.", Toast.LENGTH_LONG).show()
            }
            return@registerForActivityResult
        }

        val sessionId = pendingSessionId
        pendingSessionId = null
        val prepareOnly = preparingTrustedAccess
        preparingTrustedAccess = false
        if (sessionId.isNullOrBlank() && !prepareOnly) {
            setStatus("PC 연결 요청이 만료되었습니다.", false)
            return@registerForActivityResult
        }

        val serviceIntent = Intent(this, RemoteControlService::class.java).apply {
            action = if (prepareOnly) RemoteControlService.ACTION_PREPARE else RemoteControlService.ACTION_START
            putExtra(RemoteControlService.EXTRA_RESULT_CODE, result.resultCode)
            putExtra(RemoteControlService.EXTRA_RESULT_DATA, data)
            if (!sessionId.isNullOrBlank()) putExtra(RemoteControlService.EXTRA_SESSION_ID, sessionId)
        }
        ContextCompat.startForegroundService(this, serviceIntent)
        preferences.standbyActive = true
        renderState()
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        if (startListenerAfterNotification) {
            startListenerAfterNotification = false
            startRequestListener()
        } else {
            Toast.makeText(this, R.string.first_run_permissions_ready, Toast.LENGTH_LONG).show()
        }
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ConnectionListenerService.ACTION_STATUS) {
                val message = intent.getStringExtra(ConnectionListenerService.EXTRA_STATUS_MESSAGE)
                if (!message.isNullOrBlank()) standbyStatus.text = message
                renderState()
                return
            }
            val message = intent?.getStringExtra(RemoteControlService.EXTRA_STATUS_MESSAGE)
            val active = intent?.getBooleanExtra(RemoteControlService.EXTRA_STATUS_ACTIVE, false) ?: false
            preferences.standbyActive = active
            if (!message.isNullOrBlank()) setStatus(message, active)
            renderState()
            if (!active) showPendingRuntimeError()
        }
    }

    private fun openRemoteTools() {
        val labels = arrayOf("클립보드 텍스트를 PC로 보내기", "파일을 PC로 보내기", "PC 파일 수신 승인·저장 위치 선택", "재생 소리 캡처 권한 설정", "대기 모드 선택", "진단 보기", "진단 JSON 내보내기", "파일 전송 취소", "테스트 연결 정보")
        AlertDialog.Builder(this).setTitle("전송·대기·진단").setItems(labels) { _, which ->
            when (which) {
                0 -> {
                    try {
                        val clipboard = getSystemService(android.content.ClipboardManager::class.java)
                        val text = clipboard.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()
                        val sent = text != null && RemoteControlService.activeInstance?.sendLocalClipboard(text) == true
                        Toast.makeText(this, if (sent) "PC로 텍스트를 보냈습니다." else "클립보드가 없거나 PC 연결이 없습니다. 최대 64KiB입니다.", Toast.LENGTH_LONG).show()
                    } catch (_: Exception) { Toast.makeText(this, "클립보드 접근이 제한됐습니다.", Toast.LENGTH_LONG).show() }
                }
                1 -> if (RemoteFileTransfer.current != null) sendFilePicker.launch(arrayOf("*/*")) else Toast.makeText(this, "PC와 먼저 연결해 주세요.", Toast.LENGTH_LONG).show()
                2 -> {
                    val manager = RemoteFileTransfer.current
                    val offer = manager?.pendingOffer
                    if (offer == null) Toast.makeText(this, "수신 대기 파일이 없습니다.", Toast.LENGTH_LONG).show()
                    else AlertDialog.Builder(this).setTitle("파일 수신 승인").setMessage("${offer.name} · ${offer.size} bytes\n수신할 파일과 저장 위치를 확인하세요.")
                        .setPositiveButton("저장 위치 선택") { _, _ -> incomingManager = manager; incomingId = offer.id; receiveFilePicker.launch(offer.name) }
                        .setNegativeButton("거절") { _, _ -> manager?.cancel() }.show()
                }
                3 -> audioPermission.launch(Manifest.permission.RECORD_AUDIO)
                4 -> AlertDialog.Builder(this).setTitle("대기 모드").setItems(arrayOf("빠른 연결 (약 2초)", "균형 (약 4초)", "절약 (약 12초)")) { _, index ->
                    preferences.standbyMode = arrayOf("fast", "balanced", "saving")[index]
                    Toast.makeText(this, "대기 모드가 변경됐습니다. 자동 연결 중에는 화면 공유 승인 세션을 유지합니다.", Toast.LENGTH_LONG).show()
                }.show()
                5 -> AlertDialog.Builder(this).setTitle("로컬 진단").setMessage(RemoteDiagnostics.export(this)).setPositiveButton("닫기", null).show()
                6 -> diagnosticsPicker.launch("Linro-diagnostics-${System.currentTimeMillis()}.json")
                7 -> RemoteFileTransfer.current?.cancel()
                8 -> AlertDialog.Builder(this).setTitle("린로 · 테스트 연결 정보")
                    .setMessage("시험 버전: ${BuildConfig.DEVICE_TEST_BUILD_ID}\n패키지: ${BuildConfig.APPLICATION_ID}\n앱 버전 코드: ${BuildConfig.VERSION_CODE}\n신규 등록 주소: ${BuildConfig.SIGNALING_BASE_URL}\n기존 등록 주소: ${preferences.credentials?.baseUrl ?: "미등록"}\n\n웹 설정의 테스트 연결 정보와 주소·시험 버전을 비교하세요. 기존 등록 정보는 업데이트로 바뀌지 않습니다. 실기기·패널 OFF·복구는 미검증입니다.")
                    .setPositiveButton("닫기", null).show()
            }
        }.show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        preferences = RemotePreferences(this)
        pendingSessionId = savedInstanceState?.getString(STATE_PENDING_SESSION_ID)
        preparingTrustedAccess = savedInstanceState?.getBoolean(STATE_PREPARING_TRUSTED_ACCESS) == true
        inspectPreviousProcessExit()

        statusBadge = findViewById(R.id.statusBadge)
        pairingDescription = findViewById(R.id.pairingDescription)
        pairingCode = findViewById(R.id.pairingCode)
        findViewById<Button>(R.id.editRegistrationButton).setOnClickListener {
            editingRegistration = !editingRegistration
            renderState()
        }
        pairButton = findViewById(R.id.pairButton)
        accessibilityStatus = findViewById(R.id.accessibilityStatus)
        accessibilityButton = findViewById(R.id.accessibilityButton)
        keyboardStatus = findViewById(R.id.keyboardStatus)
        keyboardButton = findViewById(R.id.keyboardButton)
        standbyStatus = findViewById(R.id.standbyStatus)
        standbyButton = findViewById(R.id.standbyButton)

        findViewById<Button>(R.id.remoteToolsButton).setOnClickListener { openRemoteTools() }
        if (BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL) {
            val parent = findViewById<Button>(R.id.remoteToolsButton).parent as android.view.ViewGroup
            parent.addView(Button(this).apply {
                text = "물리 패널 OFF 실험 (미검증)"
                setOnClickListener { startActivity(Intent(this@MainActivity, com.galaxyremote.app.display.PanelExperimentActivity::class.java)) }
            })
        }
        pairButton.setOnClickListener { pairDevice() }
        accessibilityButton.setOnClickListener { openAccessibilitySettings() }
        keyboardButton.setOnClickListener { configureRemoteKeyboard() }
        standbyButton.setOnClickListener {
            when {
                preferences.standbyActive -> stopScreenShare()
                preferences.listenerEnabled -> prepareTrustedAutoConnect()
                else -> enableRequestListener()
            }
        }
        renderState()

        if (preferences.listenerEnabled && preferences.credentials != null && hasNotificationPermission()) {
            startRequestListener()
        }
        window.decorView.post { handleApprovalIntent(intent) }

        if (!preferences.permissionOnboardingShown) {
            preferences.permissionOnboardingShown = true
            window.decorView.post { showFirstRunPermissionSetup() }
        } else if (
            preferences.credentials != null &&
            !preferences.trustedAutoConnectOnboardingShown
        ) {
            preferences.trustedAutoConnectOnboardingShown = true
            window.decorView.post {
                if (pendingSessionId == null && !RemoteControlService.isProjectionReady()) {
                    prepareTrustedAutoConnect()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleApprovalIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(STATE_PENDING_SESSION_ID, pendingSessionId)
        outState.putBoolean(STATE_PREPARING_TRUSTED_ACCESS, preparingTrustedAccess)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (!receiverRegistered) {
            ContextCompat.registerReceiver(
                this,
                statusReceiver,
                IntentFilter().apply {
                    addAction(RemoteControlService.ACTION_STATUS)
                    addAction(ConnectionListenerService.ACTION_STATUS)
                },
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            receiverRegistered = true
        }
        renderState()
        window.decorView.post { showPendingRuntimeError() }
        if (
            preferences.permissionSetupInProgress &&
            RemoteAccessibilityService.isEnabled(this)
        ) {
            preferences.permissionSetupInProgress = false
            window.decorView.post { continueFirstRunPermissionSetup() }
        }
        if (preferences.listenerEnabled && preferences.credentials != null && hasNotificationPermission()) {
            startRequestListener()
        }
    }

    override fun onPause() {
        if (receiverRegistered) {
            unregisterReceiver(statusReceiver)
            receiverRegistered = false
        }
        super.onPause()
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun pairDevice() {
        val code = pairingCode.text.toString().filter(Char::isDigit)
        if (code.length != 6) {
            pairingCode.error = "PC 사이트에 표시된 6자리 코드를 입력해 주세요."
            return
        }

        pairButton.isEnabled = false
        pairButton.text = "등록하는 중…"
        val manufacturer = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        val deviceName = "$manufacturer ${Build.MODEL}".trim()
        executor.execute {
            try {
                val result = ApiClient().pair(code, deviceName, BuildConfig.VERSION_NAME)
                preferences.saveRegistration(
                    result.deviceId,
                    result.deviceToken,
                    result.signalingBaseUrl,
                    result.owner,
                )
                runOnUiThread {
                    pairingCode.text.clear()
                    editingRegistration = false
                    Toast.makeText(this, "이 갤럭시가 계정에 등록됐어요.", Toast.LENGTH_LONG).show()
                    renderState()
                    enableRequestListener()
                    prepareTrustedAutoConnect()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    pairingCode.error = error.message ?: "기기를 등록하지 못했습니다."
                }
            } finally {
                runOnUiThread {
                    pairButton.isEnabled = true
                    pairButton.text = if (preferences.credentials == null) "기기 등록" else "다시 등록"
                }
            }
        }
    }

    private fun enableRequestListener() {
        if (preferences.credentials == null) {
            Toast.makeText(this, "먼저 PC 사이트의 6자리 코드로 기기를 등록해 주세요.", Toast.LENGTH_LONG).show()
            pairingCode.requestFocus()
            return
        }
        if (!hasNotificationPermission()) {
            startListenerAfterNotification = true
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            startRequestListener()
        }
    }

    private fun startRequestListener() {
        if (preferences.credentials == null || !hasNotificationPermission()) return
        preferences.listenerEnabled = true
        ContextCompat.startForegroundService(
            this,
            Intent(this, ConnectionListenerService::class.java)
                .setAction(ConnectionListenerService.ACTION_START),
        )
        renderState()
    }

    private fun stopRequestListener() {
        startService(
            Intent(this, ConnectionListenerService::class.java)
                .setAction(ConnectionListenerService.ACTION_STOP),
        )
        preferences.listenerEnabled = false
        standbyStatus.text = "연결 요청 알림을 껐습니다."
        renderState()
    }

    private fun stopScreenShare() {
        startService(Intent(this, RemoteControlService::class.java).setAction(RemoteControlService.ACTION_STOP))
        preferences.standbyActive = false
        setStatus("화면 공유를 중지했습니다. 새 PC 요청은 계속 받을 수 있어요.", false)
        renderState()
    }

    private fun handleApprovalIntent(intent: Intent?) {
        if (intent?.action != ACTION_APPROVE_SESSION) return
        val sessionId = intent.getStringExtra(ConnectionListenerService.EXTRA_SESSION_ID)
            ?.takeIf(String::isNotBlank)
            ?: return
        if (preferences.credentials == null) {
            Toast.makeText(this, "기기 등록이 만료되었습니다. 다시 등록해 주세요.", Toast.LENGTH_LONG).show()
            return
        }
        pendingSessionId = sessionId
        preparingTrustedAccess = false
        intent.action = null
        executor.execute {
            try {
                preferences.credentials?.let { ApiClient(it).decideSession(sessionId, "opened") }
            } catch (_: Exception) {
                // The approval endpoint is retried by the projection service after consent.
            }
        }
        launchProjectionConsent()
    }

    private fun prepareTrustedAutoConnect() {
        if (RemoteControlService.isProjectionReady()) return
        preferences.trustedAutoConnectOnboardingShown = true
        pendingSessionId = null
        preparingTrustedAccess = true
        Toast.makeText(
            this,
            "이 화면 공유를 한 번 허용하면 이후 등록된 PC 요청은 자동으로 연결됩니다.",
            Toast.LENGTH_LONG,
        ).show()
        launchProjectionConsent()
    }

    private fun rejectPendingSession() {
        val sessionId = pendingSessionId ?: return
        pendingSessionId = null
        executor.execute {
            try {
                preferences.credentials?.let { ApiClient(it).decideSession(sessionId, "reject") }
            } catch (_: Exception) {
                // The request expires automatically after 60 seconds.
            }
        }
    }

    private fun configureRemoteKeyboard() {
        if (!RemoteKeyboardService.isEnabled(this)) {
            Toast.makeText(this, "목록에서 린로 키보드를 먼저 켜 주세요.", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
            return
        }
        getSystemService(InputMethodManager::class.java).showInputMethodPicker()
    }

    private fun hasNotificationPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
    }

    private fun showFirstRunPermissionSetup() {
        AlertDialog.Builder(this)
            .setTitle(R.string.first_run_permissions_title)
            .setMessage(R.string.first_run_permissions_message)
            .setNegativeButton(R.string.first_run_permissions_later, null)
            .setPositiveButton(R.string.first_run_permissions_start) { _, _ ->
                openAccessibilitySettings(continueFirstRunSetup = true)
            }
            .show()
    }

    private fun continueFirstRunPermissionSetup() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            startListenerAfterNotification = false
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            Toast.makeText(this, R.string.first_run_permissions_ready, Toast.LENGTH_LONG).show()
        }
    }

    private fun openAccessibilitySettings(continueFirstRunSetup: Boolean = false) {
        if (RemoteAccessibilityService.isEnabled(this)) {
            if (continueFirstRunSetup) continueFirstRunPermissionSetup()
            else startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            return
        }

        fun launchSettings() {
            preferences.permissionSetupInProgress = continueFirstRunSetup
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        if (preferences.accessibilityDisclosureAccepted) {
            launchSettings()
            return
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.accessibility_disclosure_title)
            .setMessage(R.string.accessibility_disclosure_message)
            .setNegativeButton(R.string.accessibility_disclosure_cancel) { _, _ ->
                preferences.permissionSetupInProgress = false
            }
            .setPositiveButton(R.string.accessibility_disclosure_accept) { _, _ ->
                preferences.accessibilityDisclosureAccepted = true
                launchSettings()
            }
            .show()
    }

    private fun launchProjectionConsent() {
        val manager = getSystemService(MediaProjectionManager::class.java)
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
            manager.createScreenCaptureIntent()
        }
        projectionLauncher.launch(intent)
    }

    private fun showPendingRuntimeError() {
        if (runtimeErrorDialogShowing || isFinishing || isDestroyed) return
        val diagnostic = preferences.consumeRuntimeError() ?: return
        runtimeErrorDialogShowing = true
        AlertDialog.Builder(this)
            .setTitle(R.string.runtime_error_title)
            .setMessage(diagnostic)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                runtimeErrorDialogShowing = false
            }
            .setOnCancelListener { runtimeErrorDialogShowing = false }
            .show()
    }

    private fun inspectPreviousProcessExit() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val exits = getSystemService(ActivityManager::class.java)
            .getHistoricalProcessExitReasons(packageName, 0, 10)
        val lastInspection = preferences.lastExitInspectionTimestamp
        val newestTimestamp = exits.maxOfOrNull(ApplicationExitInfo::getTimestamp) ?: return
        val freshCrash = exits
            .asSequence()
            .filter { it.timestamp > lastInspection }
            .filter {
                it.reason == ApplicationExitInfo.REASON_CRASH ||
                    it.reason == ApplicationExitInfo.REASON_CRASH_NATIVE ||
                    it.reason == ApplicationExitInfo.REASON_ANR
            }
            .maxByOrNull(ApplicationExitInfo::getTimestamp)
        // Version 0.1.4 only showed Android's short "crash" description. After
        // updating, inspect that same native tombstone once so the next report
        // can include the failing library before another reproduction.
        val detailedNativeCrash = exits
            .asSequence()
            .filter { it.reason == ApplicationExitInfo.REASON_CRASH_NATIVE }
            .filter { it.timestamp > preferences.lastDetailedNativeCrashTimestamp }
            .maxByOrNull(ApplicationExitInfo::getTimestamp)
        val crash = detailedNativeCrash ?: freshCrash
        preferences.lastExitInspectionTimestamp = newestTimestamp
        if (crash == null || preferences.hasRuntimeError) return

        val kind = when (crash.reason) {
            ApplicationExitInfo.REASON_CRASH_NATIVE -> "네이티브 충돌"
            ApplicationExitInfo.REASON_ANR -> "응답 없음"
            else -> "앱 충돌"
        }
        val detail = crash.description
            ?.replace(Regex("[\\r\\n\\t]+"), " ")
            ?.trim()
            ?.take(260)
            ?.takeIf(String::isNotBlank)
        val stage = preferences.nativeStage
        val traceSummary = nativeTraceSummary(crash)
        preferences.recordRuntimeError(
            buildString {
                append("이전 화면 공유 실행이 ")
                append(kind)
                append("로 종료되었습니다.\n\n진단 코드: AndroidExit-")
                append(crash.reason)
                if (detail != null) {
                    append("\n세부 내용: ")
                    append(detail)
                }
                stage?.let {
                    append("\n마지막 WebRTC 단계: ")
                    append(it)
                }
                crash.processName?.takeIf(String::isNotBlank)?.let {
                    append("\n프로세스: ")
                    append(it)
                }
                if (crash.status != 0) {
                    append("\n종료 상태: ")
                    append(crash.status)
                }
                traceSummary?.let {
                    append("\n네이티브 단서:\n")
                    append(it)
                }
                append("\n\n이 내용은 기기에만 저장되며 서버로 전송되지 않습니다.")
            },
        )
        if (crash.reason == ApplicationExitInfo.REASON_CRASH_NATIVE) {
            preferences.lastDetailedNativeCrashTimestamp = crash.timestamp
        }
        preferences.clearNativeStage()
    }

    private fun nativeTraceSummary(crash: ApplicationExitInfo): String? {
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            crash.reason != ApplicationExitInfo.REASON_CRASH_NATIVE
        ) return null

        val bytes = try {
            crash.traceInputStream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(4_096)
                var total = 0
                while (total < MAX_NATIVE_TRACE_BYTES) {
                    val count = input.read(
                        buffer,
                        0,
                        minOf(buffer.size, MAX_NATIVE_TRACE_BYTES - total),
                    )
                    if (count <= 0) break
                    output.write(buffer, 0, count)
                    total += count
                }
                output.toByteArray()
            }
        } catch (_: Exception) {
            null
        } ?: return null

        val printable = mutableListOf<String>()
        val current = StringBuilder()
        fun flush() {
            if (current.length in 4..240) printable += current.toString().trim()
            current.setLength(0)
        }
        bytes.forEach { byte ->
            val value = byte.toInt() and 0xff
            if (value in 32..126) current.append(value.toChar()) else flush()
        }
        flush()

        val keywords = listOf(
            "sigsegv",
            "sigabrt",
            "signal",
            "abort message",
            "libjingle",
            "libvpx",
            "webrtc",
            "mediacodec",
            "surface",
            "egl",
            ".so",
        )
        return printable
            .asSequence()
            .map { it.replace(Regex("\\s+"), " ").trim() }
            .filter(String::isNotBlank)
            .filter { line -> keywords.any { line.contains(it, ignoreCase = true) } }
            .distinct()
            .take(8)
            .joinToString("\n")
            .take(700)
            .takeIf(String::isNotBlank)
    }

    private fun setStatus(message: String, active: Boolean) {
        standbyStatus.text = message
        statusBadge.text = if (active) "연결 중" else if (preferences.listenerEnabled) "요청 대기" else if (preferences.credentials != null) "등록됨" else "설정 필요"
        statusBadge.setTextColor(
            ContextCompat.getColor(this, if (active) R.color.online else R.color.primary_dark),
        )
    }

    private fun renderState() {
        val credentials = preferences.credentials
        val accessibilityEnabled = RemoteAccessibilityService.isEnabled(this)
        val active = preferences.standbyActive
        val listening = preferences.listenerEnabled
        val keyboardEnabled = RemoteKeyboardService.isEnabled(this)
        val keyboardSelected = RemoteKeyboardService.isSelected(this)

        pairingDescription.text = if (credentials == null) {
            "PC 사이트에 로그인해 만든 6자리 코드를 입력하세요. 비밀번호는 앱에 저장되지 않습니다."
        } else {
            val ownerLabel = credentials.owner.ifBlank { "현재 ChatGPT 계정" }
            "$ownerLabel 계정에 등록된 기기입니다. 필요한 경우 새 코드로 다시 등록할 수 있어요."
        }
        pairButton.text = if (credentials == null) "기기 등록" else "다시 등록"
        val showRegistration = credentials == null || editingRegistration
        pairingCode.visibility = if (!active && showRegistration) View.VISIBLE else View.GONE
        pairButton.visibility = if (!active && showRegistration) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.editRegistrationButton).apply {
            visibility = if (credentials != null && !active) View.VISIBLE else View.GONE
            text = if (editingRegistration) "등록 변경 취소" else "기기 등록 변경"
        }

        accessibilityStatus.text = if (accessibilityEnabled) {
            "허용됨 · PC의 터치와 키 입력을 전달할 준비가 됐어요."
        } else {
            "접근성 설정에서 ‘린로 조작’을 허용해 주세요."
        }
        accessibilityStatus.setTextColor(
            ContextCompat.getColor(this, if (accessibilityEnabled) R.color.online else R.color.muted),
        )
        accessibilityButton.text = if (accessibilityEnabled) "접근성 설정 확인" else "접근성 설정 열기"

        keyboardStatus.text = when {
            keyboardSelected -> "선택됨 · Discord 같은 앱에서도 실제 입력 칸으로 문자를 전달합니다."
            keyboardEnabled -> "켜짐 · 키보드 선택 버튼을 눌러 린로를 선택해 주세요."
            else -> "선택 사항 · 복잡한 채팅 앱에서 입력 지연과 문자 오염을 줄여 줍니다."
        }
        keyboardStatus.setTextColor(
            ContextCompat.getColor(this, if (keyboardSelected) R.color.online else R.color.muted),
        )
        keyboardButton.text = when {
            keyboardSelected -> "키보드 선택 변경"
            keyboardEnabled -> "린로 키보드 선택"
            else -> "원격 키보드 켜기"
        }

        standbyButton.isEnabled = credentials != null
        standbyButton.text = when {
            active -> "화면 공유 중지"
            listening -> "자동 연결 준비"
            else -> "연결 요청 알림 켜기"
        }
        when {
            active -> {
            statusBadge.text = "자동 연결 준비"
            statusBadge.setTextColor(ContextCompat.getColor(this, R.color.online))
            standbyStatus.text = "자동 연결 준비됨 · PC에서 연결을 시작하세요. 아래 버튼을 누르면 화면 공유와 자동 연결이 중지됩니다."
            }
            listening -> {
                statusBadge.text = "요청 대기"
                statusBadge.setTextColor(ContextCompat.getColor(this, R.color.online))
                standbyStatus.text = "현재는 요청마다 휴대폰에서 승인합니다. 아래 버튼으로 화면 공유를 허용하면, 공유를 중지할 때까지 자동으로 연결됩니다."
            }
            else -> {
            statusBadge.text = if (credentials == null) "설정 필요" else "등록됨"
            statusBadge.setTextColor(ContextCompat.getColor(this, R.color.primary_dark))
            standbyStatus.text = if (credentials == null) {
                "아래에서 기기를 등록하고 조작 권한을 허용한 뒤 연결 요청 알림을 켜세요."
            } else {
                "연결 요청 알림을 켜면 휴대폰에서 미리 화면 공유를 시작할 필요가 없습니다."
            }
            }
        }
    }

    companion object {
        const val ACTION_APPROVE_SESSION = "com.galaxyremote.app.action.APPROVE_SESSION"
        private const val STATE_PENDING_SESSION_ID = "pending_session_id"
        private const val STATE_PREPARING_TRUSTED_ACCESS = "preparing_trusted_access"
        private const val MAX_NATIVE_TRACE_BYTES = 256 * 1_024
    }
}
