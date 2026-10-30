package com.galaxyremote.app

import android.content.Context
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.appcompat.app.AppCompatDelegate
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiSelector
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.After
import org.junit.runner.RunWith

/** UI-only runtime checks; never requests capture, starts pairing, or powers a panel off. */
@RunWith(AndroidJUnit4::class)
class MainUiTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val prefs get() = context.getSharedPreferences("galaxy_remote_secure_device", Context.MODE_PRIVATE)
    private val onboardingFlags = listOf("permission_onboarding_shown", "trusted_auto_connect_onboarding_shown_v031")
    private lateinit var previousFlags: Map<String, Boolean?>

    @Before fun suppressOnboardingOnlyForUiInspection() {
        previousFlags = onboardingFlags.associateWith { if (prefs.contains(it)) prefs.getBoolean(it, false) else null }
        onboardingFlags.forEach { prefs.edit().putBoolean(it, true).commit() }
    }

    @After fun restoreOnboardingFlags() {
        previousFlags.forEach { (key,value) -> prefs.edit().apply { if (value == null) remove(key) else putBoolean(key,value) }.commit() }
    }

    @Test fun themeSelectionRetainsTabAndForegroundServiceInstance() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val appearance = AppearancePreferences(context)
        val previousMode = appearance.mode
        val previousNightMode = AppCompatDelegate.getDefaultNightMode()
        val device = UiDevice.getInstance(instrumentation)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                val service = RemoteControlService.activeInstance
                scenario.onActivity { activity ->
                    activity.findViewById<Button>(R.id.navSettings).performClick()
                    activity.findViewById<Button>(R.id.appearanceButton).performClick()
                }
                assertTrue(device.findObject(UiSelector().text("다크 모드")).waitForExists(5000))
                device.findObject(UiSelector().text("다크 모드")).click()
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    assertEquals("dark", AppearancePreferences(activity).mode)
                    assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.settingsPage).visibility)
                    assertSame(service, RemoteControlService.activeInstance)
                    assertEquals("다크 모드", activity.findViewById<TextView>(R.id.appearanceStatus).text.toString())
                }
                scenario.recreate()
                scenario.onActivity { activity ->
                    assertEquals("dark", AppearancePreferences(activity).mode)
                    assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.settingsPage).visibility)
                    assertSame(service, RemoteControlService.activeInstance)
                }
            }
        } finally {
            appearance.mode = previousMode
            instrumentation.runOnMainSync { AppCompatDelegate.setDefaultNightMode(previousNightMode) }
        }
    }

    @Test fun tabsAndUnsubmittedCodeSurviveActivityRecreation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.homePage).visibility)
                activity.findViewById<Button>(R.id.navTools).performClick()
                assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.toolsPage).visibility)
                assertNotNull(activity.findViewById<Button>(R.id.sendFileButton))
                activity.findViewById<Button>(R.id.navDevices).performClick()
                activity.findViewById<EditText>(R.id.pairingCode).setText("123456")
            }
            scenario.recreate()
            scenario.onActivity { activity ->
                assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.devicesPage).visibility)
                assertEquals("123456", activity.findViewById<EditText>(R.id.pairingCode).text.toString())
                assertTrue(activity.findViewById<Button>(R.id.navDevices).isSelected)
                activity.findViewById<Button>(R.id.navSettings).performClick()
                assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.settingsPage).visibility)
                assertNotNull(activity.findViewById<TextView>(R.id.appearanceStatus).text)
                assertNotNull(activity.findViewById<Button>(R.id.settingsConnectionInfoButton))
            }
        }

    }
}
