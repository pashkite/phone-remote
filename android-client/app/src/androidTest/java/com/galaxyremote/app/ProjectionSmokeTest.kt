package com.galaxyremote.app

import android.content.Context
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern

@RunWith(AndroidJUnit4::class)
class ProjectionSmokeTest {
    @Test
    fun projectionEngineNegotiatesAndStreamsFramesThenStopsCleanly() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences(
            ProjectionSmokeContract.PREFERENCES,
            Context.MODE_PRIVATE,
        )
        preferences.edit().clear().commit()

        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp()
        device.pressHome()
        device.executeShellCommand("wm dismiss-keyguard")
        device.waitForIdle(5_000L)
        var approved = false
        for (attempt in 0 until CONSENT_ATTEMPTS) {
            context.startActivity(
                Intent(context, ProjectionSmokeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            if (approveProjection(device)) {
                approved = true
                break
            }
            // A cold Android 16 SystemUI can recreate the protected consent
            // window without a touchable input channel. Close that attempt
            // and open a fresh projection request after SystemUI settles.
            device.pressBack()
            device.pressHome()
            device.waitForIdle(2_000L)
            Thread.sleep(1_000L)
        }

        assertTrue(
            "Android 화면 공유 승인 버튼을 누르지 못했습니다.",
            approved,
        )

        val deadline = System.currentTimeMillis() + RESULT_TIMEOUT_MS
        var result: String? = null
        while (System.currentTimeMillis() < deadline) {
            result = preferences.getString(ProjectionSmokeContract.RESULT, null)
            if (result != null) break
            Thread.sleep(250)
        }

        val detail = preferences.getString(ProjectionSmokeContract.DETAIL, "결과가 기록되지 않았습니다.")
        assertEquals(detail, ProjectionSmokeContract.RESULT_SUCCESS, result)
    }

    private fun approveProjection(device: UiDevice): Boolean {
        val selectors = listOf(
            By.res("android", "button1"),
            By.res("com.android.systemui", "button_start"),
            By.text(
                Pattern.compile(
                    "(?i)^(start now|start recording|share screen|share|continue)$",
                ),
            ),
        )
        val startedAt = System.currentTimeMillis()
        val deadline = startedAt + CONSENT_TIMEOUT_MS
        var coordinateIndex = 0
        while (System.currentTimeMillis() < deadline) {
            selectors.forEach { selector ->
                device.findObject(selector)?.let {
                    if (it.isClickable && it.isEnabled) {
                        it.click()
                        return true
                    }
                }
            }
            // Android 16 can temporarily expose no accessibility root for the
            // protected dialog. Keep retrying the real selectors; only after
            // they have had time to appear, cycle narrowly around the AOSP
            // positive-button location while the exact dialog has focus.
            if (
                System.currentTimeMillis() - startedAt >= COORDINATE_FALLBACK_DELAY_MS &&
                isProjectionDialogVisible(device)
            ) {
                val (xFraction, yFraction) = POSITIVE_BUTTON_FRACTIONS[
                    coordinateIndex % POSITIVE_BUTTON_FRACTIONS.size
                ]
                coordinateIndex += 1
                device.click(
                    (device.displayWidth * xFraction).toInt(),
                    (device.displayHeight * yFraction).toInt(),
                )
                Thread.sleep(750)
                if (!isProjectionDialogVisible(device)) return true
            } else {
                Thread.sleep(250)
            }
        }
        return false
    }

    private fun isProjectionDialogVisible(device: UiDevice): Boolean {
        return device.executeShellCommand(
            "dumpsys window | grep -m 1 'mCurrentFocus.*MediaProjectionPermissionActivity'",
        ).isNotBlank()
    }

    companion object {
        private const val CONSENT_ATTEMPTS = 3
        private const val CONSENT_TIMEOUT_MS = 45_000L
        private const val COORDINATE_FALLBACK_DELAY_MS = 18_000L
        // Two peer negotiations, three live quality changes and final cleanup.
        private const val RESULT_TIMEOUT_MS = 100_000L
        private val POSITIVE_BUTTON_FRACTIONS = listOf(
            0.76 to 0.70,
            0.82 to 0.70,
            0.76 to 0.66,
            0.76 to 0.74,
            0.82 to 0.66,
            0.82 to 0.74,
            0.76 to 0.78,
            0.82 to 0.78,
        )
    }
}
