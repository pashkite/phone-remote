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
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.ViewModelProvider
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var preferences: RemotePreferences
    private var editingRegistration = false
    private var currentTab = "home"
    private var latestServiceMessage: String? = null
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
    private val pendingOperations by lazy { ViewModelProvider(this)[MainUiOperations::class.java] }
    private var incomingManager: RemoteFileTransfer?
        get() = pendingOperations.incomingManager
        set(value) { pendingOperations.incomingManager = value }
    private var incomingId: String?
        get() = pendingOperations.incomingId
        set(value) { pendingOperations.incomingId = value }
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
                if (!message.isNullOrBlank()) latestServiceMessage = message
                renderState()
                return
            }
            val message = intent?.getStringExtra(RemoteControlService.EXTRA_STATUS_MESSAGE)
            val active = intent?.getBooleanExtra(RemoteControlService.EXTRA_STATUS_ACTIVE, false) ?: false
            preferences.standbyActive = active
            if (!message.isNullOrBlank()) { latestServiceMessage = message; setStatus(message, active) }
            renderState()
            if (!active) showPendingRuntimeError()
        }
    }

    private fun openRemoteTools() {
        val labels = arrayOf("클립보드 텍스트를 PC로 보내기", "파일을 PC로 보내기", "PC 파일 수신 승인·저장 위치 선택", "재생 소리 캡처 권한 설정", "대기 모드 선택", "진단 보기", "진단 JSON 내보내기", "파일 전송 취소", "테스트 연결 정보")
        AlertDialog.Builder(this).setTitle("전송·대기·진단").setItems(labels) { _, which -> performTool(which) }.show()
    }

    private fun performTool(which: Int) {
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
    }


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        preferences = RemotePreferences(this)
        currentTab = savedInstanceState?.getString(STATE_TAB) ?: "home"
        editingRegistration = savedInstanceState?.getBoolean(STATE_EDITING_REGISTRATION) == true
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.appRoot)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            insets
        }
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
        findViewById<Button>(R.id.experimentButton).apply {
            visibility = if (BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL) View.VISIBLE else View.GONE
            setOnClickListener { startActivity(Intent(this@MainActivity, com.galaxyremote.app.display.PanelExperimentActivity::class.java)) }
        }
        bindNavigation()
        pairButton.setOnClickListener { pairDevice() }
        accessibilityButton.setOnClickListener { openAccessibilitySettings() }
        keyboardButton.setOnClickListener { configureRemoteKeyboard() }
        standbyButton.setOnClickListener {
            when {
                RemoteControlService.activeInstance != null || RemoteControlService.isProjectionReady() -> stopScreenShare()
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
        outState.putString(STATE_TAB, currentTab)
        outState.putBoolean(STATE_EDITING_REGISTRATION, editingRegistration)
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

    private fun bindNavigation() {
        mapOf(R.id.navHome to "home", R.id.navTools to "tools", R.id.navDevices to "devices", R.id.navSettings to "settings").forEach { (id, tab) ->
            findViewById<Button>(id).setOnClickListener { selectTab(tab) }
        }
        findViewById<View>(R.id.headerSettingsButton).setOnClickListener { selectTab("settings") }
        findViewById<Button>(R.id.homePairButton).setOnClickListener { selectTab("devices") }
        findViewById<Button>(R.id.homeAccessibilityButton).setOnClickListener { openAccessibilitySettings() }
        findViewById<Button>(R.id.homeWaitingButton).setOnClickListener { selectTab("settings") }
        mapOf(R.id.sendClipboardButton to 0, R.id.sendFileButton to 1, R.id.receiveFileButton to 2,
            R.id.audioPermissionButton to 3, R.id.settingsAudioButton to 3, R.id.standbyModeButton to 4,
            R.id.diagnosticsButton to 5, R.id.exportDiagnosticsButton to 6, R.id.cancelTransferButton to 7,
            R.id.connectionInfoButton to 8, R.id.settingsConnectionInfoButton to 8).forEach { (id, action) ->
            findViewById<Button>(id).setOnClickListener { performTool(action) }
        }
        findViewById<Button>(R.id.appearanceButton).setOnClickListener {
            val appearance = AppearancePreferences(this)
            AlertDialog.Builder(this).setTitle("외관").setSingleChoiceItems(arrayOf("시스템 설정", "다크 모드", "라이트 모드"), AppearancePreferences.MODES.indexOf(appearance.mode)) { dialog, index ->
                appearance.mode = AppearancePreferences.MODES[index]
                dialog.dismiss()
                // AppCompat recreates the Activity; foreground services and WebRTC keep running.
                AppCompatDelegate.setDefaultNightMode(appearance.nightMode)
                renderState()
            }.setNegativeButton("취소", null).show()
        }
        findViewById<Button>(R.id.notificationSettingsButton).setOnClickListener {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        }
        findViewById<Button>(R.id.listenerSettingsButton).setOnClickListener {
            if (preferences.listenerEnabled && ConnectionListenerService.isRunning) {
                AlertDialog.Builder(this).setTitle("연결 요청 알림 끄기").setMessage("새 연결 요청 알림을 끕니다. 이미 승인한 화면 공유를 중지하려면 홈의 화면 공유 중지를 사용하세요.")
                    .setPositiveButton("알림 끄기") { _, _ -> stopRequestListener() }.setNegativeButton("취소", null).show()
            } else enableRequestListener()
        }
        selectTab(currentTab)
    }

    private fun selectTab(tab: String) {
        val pages = mapOf("home" to R.id.homePage, "tools" to R.id.toolsPage, "devices" to R.id.devicesPage, "settings" to R.id.settingsPage)
        currentTab = tab.takeIf { it in pages } ?: "home"
        pages.forEach { (name, id) -> findViewById<View>(id).visibility = if (name == currentTab) View.VISIBLE else View.GONE }
        mapOf("home" to R.id.navHome, "tools" to R.id.navTools, "devices" to R.id.navDevices, "settings" to R.id.navSettings).forEach { (name, id) ->
            findViewById<Button>(id).apply { isSelected = name == currentTab; ViewCompat.setStateDescription(this, if (isSelected) "선택됨" else "선택 안 됨") }
        }
        renderState()
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
            selectTab("devices")
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
        if (ConnectionListenerService.isRunning) { renderState(); return }
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
        val active = RemoteControlService.activeInstance != null || RemoteControlService.isProjectionReady()
        val listening = preferences.listenerEnabled && ConnectionListenerService.isRunning
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

        val state = ConnectionReadiness(credentials != null, accessibilityEnabled, hasNotificationPermission(), listening, RemoteControlService.isProjectionReady(), RemoteControlService.isRemoteConnected())
        findViewById<TextView>(R.id.statusHeadline).text = state.title
        statusBadge.text = when {
            state.connected -> "PC와 연결됨"
            state.projection -> "화면 공유 중"
            state.listening -> "알림 대기 중"
            else -> "설정 확인"
        }
        val observed = "화면 공유: ${if (state.projection) "현재 세션 승인됨" else "승인된 세션 없음"} · 알림 권한: ${if (state.notifications) "허용" else "미허용"}"
        findViewById<TextView>(R.id.homeDeviceName).text = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
        findViewById<TextView>(R.id.homeDeviceStatus).text = "${if (credentials == null) "미등록" else "등록 정보 저장됨"}\n$observed"
        findViewById<TextView>(R.id.registeredDeviceName).text = "${Build.MANUFACTURER} ${Build.MODEL}"
        findViewById<TextView>(R.id.deviceRegistrationStatus).text = if (credentials == null) "미등록 · PC 웹에서 코드를 만들어 주세요." else "${credentials.owner.ifBlank { "소유자 계정" }}에 등록 정보 저장됨 · 서버 유효성은 연결 시 확인"
        findViewById<TextView>(R.id.registeredOrigin).text = "연결 주소: ${credentials?.baseUrl ?: BuildConfig.SIGNALING_BASE_URL}\n${state.title}"
        findViewById<TextView>(R.id.toolsConnectionStatus).text = if (state.connected) "PC 연결 중 · 전송 도구 사용 가능" else "PC 연결 없음 · 연결 후 파일/클립보드 전송 가능"
        listOf(R.id.sendFileButton, R.id.sendClipboardButton, R.id.cancelTransferButton).forEach { findViewById<Button>(it).isEnabled = state.connected }
        findViewById<TextView>(R.id.listenerSettingsStatus).text = "${if (listening) "요청 대기 서비스 실행 중" else "요청 대기 서비스 중지"} · 알림 ${if (hasNotificationPermission()) "허용" else "미허용"}"
        findViewById<TextView>(R.id.appearanceStatus).text = when (AppearancePreferences(this).mode) { "dark" -> "다크 모드"; "light" -> "라이트 모드"; else -> "시스템 설정 사용" }
        findViewById<TextView>(R.id.appVersionStatus).text = "린로 · Linro · Link Road\n${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"
        if (active && !state.projection) standbyStatus.text = "화면 공유를 시작하고 있습니다. 아직 연결 준비가 완료되지 않았습니다."
        if (state.projection) standbyStatus.text = "${if (state.connected) "PC와 연결 중입니다." else "승인된 화면 공유 세션을 유지하며 PC 요청을 기다립니다."} 화면 공유를 중지하면 자동 연결도 중지됩니다."
        latestServiceMessage?.let { standbyStatus.append("\n$it") }
    }

    companion object {
        const val ACTION_APPROVE_SESSION = "com.galaxyremote.app.action.APPROVE_SESSION"
        private const val STATE_TAB = "linro_selected_tab"
        private const val STATE_EDITING_REGISTRATION = "linro_editing_registration"
        private const val STATE_PENDING_SESSION_ID = "pending_session_id"
        private const val STATE_PREPARING_TRUSTED_ACCESS = "preparing_trusted_access"
        private const val MAX_NATIVE_TRACE_BYTES = 256 * 1_024
    }
}
