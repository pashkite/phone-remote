package com.galaxyremote.app

import android.app.UiAutomation
import androidx.test.uiautomator.Configurator
import android.content.Context
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class LiveTouchTest {
    @Test fun dragMovesBeforeReleaseAndTimeoutReleasesHeldPointer() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val configurator = Configurator.getInstance()
        val oldFlags = configurator.uiAutomationFlags
        configurator.setUiAutomationFlags(oldFlags or UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        val device = UiDevice.getInstance(instrumentation)
        val oldServices = device.executeShellCommand("settings get secure enabled_accessibility_services").trim()
        val oldEnabled = device.executeShellCommand("settings get secure accessibility_enabled").trim()
        val prefs = RemotePreferences(context)
        val oldStandby = prefs.standbyActive
        fun waitFor(label: String, predicate: () -> Boolean) {
            val end = System.currentTimeMillis() + 15000
            while (!predicate() && System.currentTimeMillis() < end) Thread.sleep(25)
            assertTrue(label, predicate())
        }
        try {
            device.wakeUp(); device.executeShellCommand("wm dismiss-keyguard"); device.pressHome(); device.waitForIdle(5000)
            device.executeShellCommand("settings put secure enabled_accessibility_services com.galaxyremote.app/com.galaxyremote.app.RemoteAccessibilityService")
            device.executeShellCommand("settings put secure accessibility_enabled 1")
            waitFor("Accessibility service connected") { RemoteAccessibilityService.isConnected() }
            prefs.standbyActive = true
            device.executeShellCommand("am start -W -n ${context.packageName}/.TouchProbeActivity")
            device.waitForIdle(2000)
            val probe = context.getSharedPreferences("touch_probe", Context.MODE_PRIVATE)
            waitFor("Probe window focused and ready for input") { probe.getBoolean("ready", false) }
            instrumentation.waitForIdleSync()
            val id = UUID.randomUUID().toString()
            fun touch(phase: String, x: Double = .3) {
                instrumentation.runOnMainSync {
                    assertTrue(RemoteAccessibilityService.dispatch(JSONObject().put("type","touch").put("touchId",id).put("phase",phase).put("x",x).put("y",.5)))
                }
            }
            touch("down")
            waitFor("Down delivered while held") { probe.getInt("down",0) == 1 }
            touch("move", .7)
            waitFor("Move delivered before up") { probe.getInt("move",0) > 0 && probe.getFloat("x",0f) > device.displayWidth * .6f }
            assertEquals("No early release",0,probe.getInt("up",0))
            touch("up", .7)
            waitFor("Up delivered") { probe.getInt("up",0) == 1 }
            touch("down")
            waitFor("Second down delivered") { probe.getInt("down",0) == 2 }
            waitFor("Missing heartbeat releases touch") { probe.getInt("up",0) == 2 || probe.getInt("cancel",0) > 0 }
            instrumentation.runOnMainSync {
                val invalid = JSONObject().put("type","touch").put("touchId",id).put("phase","down").put("x",2).put("y",.5)
                assertFalse(RemoteAccessibilityService.dispatch(invalid))
            }
        } finally {
            RemoteAccessibilityService.stopTouch()
            prefs.standbyActive = oldStandby
            device.executeShellCommand("settings put secure enabled_accessibility_services ${if (oldServices == "null") "\"\"" else oldServices}")
            device.executeShellCommand("settings put secure accessibility_enabled ${if (oldEnabled == "null") "0" else oldEnabled}")
            device.pressHome()
            configurator.setUiAutomationFlags(oldFlags)
        }
    }
}
