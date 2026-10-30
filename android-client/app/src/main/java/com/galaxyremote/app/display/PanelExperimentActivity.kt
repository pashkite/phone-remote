package com.galaxyremote.app.display

import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.galaxyremote.app.BuildConfig
import com.galaxyremote.app.R

class PanelExperimentActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var refresh: Runnable? = null
    private var trialScheduled = false
    private var busy = false
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL) { finish(); return }
        DisplayControl.initialize(applicationContext)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(24))
        }
        val scroll = ScrollView(this).apply {
            setBackgroundColor(getColor(R.color.page)); clipToPadding = true; addView(column)
        }
        setContentView(scroll)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }
        ViewCompat.requestApplyInsets(scroll)
        WindowCompat.getInsetsController(window, scroll).isAppearanceLightStatusBars = resources.getBoolean(R.bool.light_system_bars)
        fun text(value: String, heading: Boolean = false) = TextView(this).also {
            it.text = value; it.textSize = if (heading) 22f else 14f
            it.setTextColor(getColor(if (heading) R.color.ink else R.color.muted))
            it.setPadding(0, dp(8), 0, dp(8))
            if (heading) ViewCompat.setAccessibilityHeading(it, true)
            column.addView(it)
        }
        text("물리 패널 OFF 실험 · 미검증", true)
        text("테스트 앱의 실험 기능입니다. 실제 패널 매핑과 외부 복구를 별도 검증하기 전에는 OFF 금지. 화면 잠금과 패널 전원 OFF는 다릅니다.")
        val displayOutput = text("화면 ID·상태: 아직 조회하지 않았습니다.")
        val commandsOutput = text(DisplayControl.commandSummary)
        val gateOutput = text(DisplayControl.gateSummary)
        val output = text(DisplayControl.status).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        val offButtons = mutableListOf<Button>()
        val setupButtons = mutableListOf<Button>()
        val confirmed = CheckBox(this).apply {
            text = "이 기기·현재 펌웨어에서 ADB 복구 경로와 display 0의 실제 패널 매핑을 별도 검증했습니다. ON 명령 수락만으로 확인하지 않았습니다."
            setTextColor(getColor(R.color.ink)); minHeight = dp(48)
        }
        fun refreshUi() {
            if (output.text.toString() != DisplayControl.status) output.text = DisplayControl.status
            commandsOutput.text = DisplayControl.commandSummary
            gateOutput.text = DisplayControl.gateSummary + if (trialScheduled) "\nOFF 시험 확인·5초 대기 중입니다. 취소하려면 즉시 복구를 누르세요." else ""
            setupButtons.forEach { it.isEnabled = !busy && !trialScheduled }
            confirmed.isEnabled = !busy && !trialScheduled
            offButtons.forEach { it.isEnabled = !busy && !trialScheduled && confirmed.isChecked && DisplayControl.trialReady }
        }
        fun work(action: () -> String) {
            busy = true
            refreshUi()
            DisplayControl.work(action) { runOnUiThread {
                busy = false
                if (!isDestroyed && !isFinishing) refreshUi()
            } }
        }
        fun button(label: String, action: () -> Unit): Button = Button(this).also {
            it.text = label; it.isAllCaps = false; it.minHeight = dp(52)
            it.setOnClickListener { try { action() } catch (error: Exception) { DisplayControl.recordFailure(error); refreshUi() } }
            column.addView(it, LinearLayout.LayoutParams(-1, -2))
        }
        fun localDisplays() {
            displayOutput.text = try {
                val displays = getSystemService(DisplayManager::class.java).displays.joinToString("\n") {
                    val state = when (it.state) { Display.STATE_ON -> "ON"; Display.STATE_OFF -> "OFF"; else -> "상태 코드 ${it.state}" }
                    "ID ${it.displayId} · ${it.name} · $state"
                }
                "앱에서 조회한 논리 화면\n$displays\n잠금: ${getSystemService(KeyguardManager::class.java).isKeyguardLocked}\n이 값은 실제 패널 전원·물리 매핑의 증거가 아닙니다."
            } catch (error: Exception) { "앱 화면 정보 조회 실패: ${error.javaClass.simpleName}" }
        }
        fun requireScreenOn() {
            check(!getSystemService(KeyguardManager::class.java).isKeyguardLocked) { "DEVICE_LOCKED" }
            check(getSystemService(DisplayManager::class.java).getDisplay(0)?.state == Display.STATE_ON) { "DISPLAY_NOT_ON" }
        }
        setupButtons += button("1. Shizuku 권한 요청") { DisplayControl.requestPermission(); refreshUi() }
        setupButtons += button("2. 승인 후 shell 서비스 연결") { DisplayControl.bind(); refreshUi() }
        setupButtons += button("3. display 0 매핑·명령 조회") {
            confirmed.isChecked = false
            localDisplays() // remains visible even if Shizuku or command inspection fails
            work { DisplayControl.inspect() }
        }
        setupButtons += button("4. 화면 ON 상태에서 복구 명령 사전 검사") {
            confirmed.isChecked = false
            localDisplays()
            work { requireScreenOn(); DisplayControl.checkRecovery() }
        }
        column.addView(confirmed)
        confirmed.setOnCheckedChangeListener { _, _ -> refreshUi() }
        text("OFF 버튼은 명령 지원·복구 사전 검사·WebRTC 연결·외부 복구 확인 조건이 충족될 때만 활성화됩니다. 실제 복구와 타이머 생존은 여전히 미검증입니다.")
        fun trial(seconds: Int) {
            check(!busy && !trialScheduled && confirmed.isChecked && DisplayControl.trialReady) { "RECOVERY_NOT_VERIFIED" }
            requireScreenOn()
            val ticket = DisplayControl.trialTicket()
            trialScheduled = true
            refreshUi()
            var started = false
            AlertDialog.Builder(this).setTitle("${seconds}초 제한 패널 OFF 시험")
                .setMessage("5초 뒤 실행합니다. 게임으로 돌아가세요. 외부 복구가 충분히 검증되지 않았다면 취소하세요. 영상·입력·실제 복구는 미검증입니다.")
                .setNegativeButton("취소", null).setPositiveButton("검증했으며 시험 시작") { _, _ ->
                    started = true
                    confirmed.isChecked = false
                    handler.postDelayed({
                        work {
                            try { requireScreenOn(); DisplayControl.turnOff(seconds, true, ticket) }
                            finally { runOnUiThread { trialScheduled = false } }
                        }
                    }, 5000)
                }.setOnDismissListener {
                    if (!started) { trialScheduled = false; refreshUi() }
                }.show()
        }
        offButtons += button("5. 30초 OFF 시험 (5초 후)") { trial(30) }
        offButtons += button("30초 시험 통과 후: 330초 시험 (5초 후)") { trial(330) }
        button("즉시 복구 · 입력 해제") {
            DisplayControl.cancelTrial()
            handler.removeCallbacksAndMessages(null)
            trialScheduled = false
            confirmed.isChecked = false
            work { DisplayControl.restore() }
            refresh?.let { handler.postDelayed(it, 1000) }
        }
        button("상태 다시 보기") { localDisplays(); refreshUi() }
        button("전체 진단 보기") {
            val details = TextView(this).apply {
                text = displayOutput.text.toString() + "\n\n" + DisplayControl.diagnostics
                textSize = 12f; setPadding(dp(16), dp(16), dp(16), dp(16)); setTextIsSelectable(true)
            }
            AlertDialog.Builder(this).setTitle("패널 사전 검사 전체 진단")
                .setView(ScrollView(this).apply { addView(details) }).setPositiveButton("닫기", null).show()
        }
        refresh = object : Runnable { override fun run() { refreshUi(); handler.postDelayed(this, 1000) } }
        refreshUi()
    }
    override fun onResume() { super.onResume(); refresh?.let { handler.post(it) } }
    override fun onPause() { refresh?.let { handler.removeCallbacks(it) }; super.onPause() }
    override fun onDestroy() {
        if (trialScheduled) DisplayControl.cancelTrial()
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
