package com.galaxyremote.app.display

import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.galaxyremote.app.BuildConfig
import rikka.shizuku.Shizuku

class PanelExperimentActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL) { finish(); return }
        DisplayControl.initialize(applicationContext)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 24, 24, 24) }
        setContentView(ScrollView(this).apply { addView(column) })
        fun text(value: String) = TextView(this).also { it.text = value; column.addView(it) }
        text("물리 패널 OFF 실험 · 미검증\n별도 테스트 앱입니다. 잠금 해제 상태에서 사용하세요. 복구를 실기기로 확인하지 않았다면 OFF 금지. 타이머는 기기에서 검증되지 않았습니다.")
        val output = text(DisplayControl.status)
        fun work(action: () -> String) = DisplayControl.work(action) { result -> runOnUiThread { output.text = result } }
        fun button(label: String, action: () -> Unit) {
            column.addView(Button(this).apply { this.text = label; setOnClickListener { action() } })
        }
        button("1. Shizuku 권한 요청") {
            try { check(Shizuku.pingBinder()) { "Shizuku를 먼저 시작하세요" }; Shizuku.requestPermission(202) }
            catch (e: Exception) { output.text = e.message }
        }
        button("2. 승인 후 shell 서비스 연결") {
            try { DisplayControl.bind(); output.text = "연결 요청됨. 상태 조회로 확인하세요." }
            catch (e: Exception) { output.text = e.message }
        }
        button("3. display 0 매핑·명령 조회") {
            val dm = getSystemService(DisplayManager::class.java)
            val summary = dm.displays.joinToString("\n") { "id=${it.displayId}, name=${it.name}, state=${it.state} (ON=${Display.STATE_ON}, OFF=${Display.STATE_OFF})" }
            val locked = getSystemService(KeyguardManager::class.java).isKeyguardLocked
            work { "KeyguardLocked=$locked\n$summary\nDisplay state is not proof of panel power.\n" + DisplayControl.inspect() }
        }
        button("4. 화면 ON 상태에서 복구 명령 사전 검사") { work { DisplayControl.checkRecovery() } }
        val confirmed = CheckBox(this).apply { text = "이 기기·현재 펌웨어에서 ADB 복구 경로와 display 0의 실제 패널 매핑을 별도 검증했습니다. ON 상태 명령 성공만으로 확인하지 않았습니다." }
        column.addView(confirmed)
        fun trial(seconds: Int) {
            if (!confirmed.isChecked) { output.text = "외부 복구 검증 확인이 필요합니다."; return }
            if (getSystemService(KeyguardManager::class.java).isKeyguardLocked) { output.text = "기기를 직접 잠금 해제하세요."; return }
            AlertDialog.Builder(this).setTitle("${seconds}초 제한 패널 OFF 시험")
                .setMessage("5초 뒤 실행합니다. 게임으로 돌아가세요. 복구 경로가 검증되지 않았다면 취소하세요. 영상·입력 유지는 미검증입니다.")
                .setNegativeButton("취소", null).setPositiveButton("검증했으며 시험 시작") { _, _ ->
                    confirmed.isChecked = false
                    handler.postDelayed({ work {
                        check(!getSystemService(KeyguardManager::class.java).isKeyguardLocked) { "DEVICE_LOCKED" }
                        DisplayControl.turnOff(seconds, true)
                    } }, 5000)
                }.show()
        }
        button("5. 30초 OFF 시험 (5초 후)") { trial(30) }
        button("30초 시험 통과 후: 330초 시험 (5초 후)") { trial(330) }
        button("즉시 복구 · 입력 해제") { handler.removeCallbacksAndMessages(null); work { DisplayControl.restore() } }
        button("상태 다시 보기") { output.text = DisplayControl.status }
    }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy() }
}
