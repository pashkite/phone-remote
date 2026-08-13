package com.galaxyremote.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class DeviceCredentials(
    val deviceId: String,
    val deviceToken: String,
    val baseUrl: String,
    val owner: String,
)

class RemotePreferences(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    val credentials: DeviceCredentials?
        get() {
            val deviceId = prefs.getString(KEY_DEVICE_ID, null).orEmpty()
            val deviceToken = decryptToken(prefs.getString(KEY_DEVICE_TOKEN, null)).orEmpty()
            if (deviceId.isBlank() || deviceToken.isBlank()) return null
            return DeviceCredentials(
                deviceId = deviceId,
                deviceToken = deviceToken,
                baseUrl = prefs.getString(KEY_BASE_URL, BuildConfig.SIGNALING_BASE_URL)
                    ?.trimEnd('/')
                    .orEmpty(),
                owner = prefs.getString(KEY_OWNER, "").orEmpty(),
            )
        }

    var standbyActive: Boolean
        get() = prefs.getBoolean(KEY_STANDBY_ACTIVE, false)
        set(value) = prefs.edit().putBoolean(KEY_STANDBY_ACTIVE, value).apply()

    var listenerEnabled: Boolean
        get() = if (prefs.contains(KEY_LISTENER_ENABLED)) {
            prefs.getBoolean(KEY_LISTENER_ENABLED, false)
        } else {
            credentials != null
        }
        set(value) = prefs.edit().putBoolean(KEY_LISTENER_ENABLED, value).apply()

    var accessibilityDisclosureAccepted: Boolean
        get() = prefs.getBoolean(KEY_ACCESSIBILITY_DISCLOSURE_ACCEPTED, false)
        set(value) = prefs.edit().putBoolean(KEY_ACCESSIBILITY_DISCLOSURE_ACCEPTED, value).apply()

    var permissionOnboardingShown: Boolean
        get() = prefs.getBoolean(KEY_PERMISSION_ONBOARDING_SHOWN, false)
        set(value) = prefs.edit().putBoolean(KEY_PERMISSION_ONBOARDING_SHOWN, value).apply()

    var permissionSetupInProgress: Boolean
        get() = prefs.getBoolean(KEY_PERMISSION_SETUP_IN_PROGRESS, false)
        set(value) = prefs.edit().putBoolean(KEY_PERMISSION_SETUP_IN_PROGRESS, value).apply()

    var trustedAutoConnectOnboardingShown: Boolean
        get() = prefs.getBoolean(KEY_TRUSTED_AUTO_CONNECT_ONBOARDING_SHOWN, false)
        set(value) = prefs.edit()
            .putBoolean(KEY_TRUSTED_AUTO_CONNECT_ONBOARDING_SHOWN, value)
            .apply()

    fun recordRuntimeError(message: String) {
        prefs.edit().putString(KEY_RUNTIME_ERROR, message.take(MAX_DIAGNOSTIC_LENGTH)).apply()
    }

    val hasRuntimeError: Boolean
        get() = !prefs.getString(KEY_RUNTIME_ERROR, null).isNullOrBlank()

    var lastExitInspectionTimestamp: Long
        get() = prefs.getLong(KEY_LAST_EXIT_INSPECTION_TIMESTAMP, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_EXIT_INSPECTION_TIMESTAMP, value).apply()

    var lastDetailedNativeCrashTimestamp: Long
        get() = prefs.getLong(KEY_LAST_DETAILED_NATIVE_CRASH_TIMESTAMP, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_DETAILED_NATIVE_CRASH_TIMESTAMP, value).apply()

    val nativeStage: String?
        get() = prefs.getString(KEY_NATIVE_STAGE, null)?.takeIf(String::isNotBlank)

    fun markNativeStage(stage: String) {
        // A native abort can stop the process without giving SharedPreferences.apply()
        // time to flush. This small diagnostic marker must be durable immediately.
        prefs.edit().putString(KEY_NATIVE_STAGE, stage.take(80)).commit()
    }

    fun clearNativeStage() {
        prefs.edit().remove(KEY_NATIVE_STAGE).commit()
    }

    fun consumeRuntimeError(): String? {
        val message = prefs.getString(KEY_RUNTIME_ERROR, null)?.takeIf(String::isNotBlank)
        if (message != null) prefs.edit().remove(KEY_RUNTIME_ERROR).apply()
        return message
    }

    fun saveRegistration(
        deviceId: String,
        deviceToken: String,
        baseUrl: String,
        owner: String,
    ) {
        prefs.edit()
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_DEVICE_TOKEN, encryptToken(deviceToken))
            .putString(KEY_BASE_URL, baseUrl.trimEnd('/'))
            .putString(KEY_OWNER, owner)
            .putBoolean(KEY_LISTENER_ENABLED, true)
            .apply()
    }

    private fun encryptionKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }

    private fun encryptToken(token: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val combined = cipher.iv + ciphertext
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decryptToken(encoded: String?): String? {
        if (encoded.isNullOrBlank()) return null
        return try {
            val combined = Base64.decode(encoded, Base64.NO_WRAP)
            if (combined.size <= GCM_IV_LENGTH) return null
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                encryptionKey(),
                GCMParameterSpec(128, combined.copyOfRange(0, GCM_IV_LENGTH)),
            )
            String(cipher.doFinal(combined.copyOfRange(GCM_IV_LENGTH, combined.size)), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val ANDROID_KEY_STORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "galaxy_remote_device_token"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_LENGTH = 12
        private const val PREFS_NAME = "galaxy_remote_secure_device"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_OWNER = "owner"
        private const val KEY_STANDBY_ACTIVE = "standby_active"
        private const val KEY_LISTENER_ENABLED = "listener_enabled"
        private const val KEY_ACCESSIBILITY_DISCLOSURE_ACCEPTED =
            "accessibility_disclosure_accepted"
        private const val KEY_PERMISSION_ONBOARDING_SHOWN = "permission_onboarding_shown"
        private const val KEY_PERMISSION_SETUP_IN_PROGRESS = "permission_setup_in_progress"
        private const val KEY_TRUSTED_AUTO_CONNECT_ONBOARDING_SHOWN =
            "trusted_auto_connect_onboarding_shown_v031"
        private const val KEY_RUNTIME_ERROR = "runtime_error"
        private const val KEY_LAST_EXIT_INSPECTION_TIMESTAMP = "last_exit_inspection_timestamp"
        private const val KEY_LAST_DETAILED_NATIVE_CRASH_TIMESTAMP =
            "last_detailed_native_crash_timestamp"
        private const val KEY_NATIVE_STAGE = "native_stage"
        private const val MAX_DIAGNOSTIC_LENGTH = 1_800

        fun runtimeDiagnostic(stage: String, error: Throwable): String {
            val type = error.javaClass.simpleName.ifBlank { "RuntimeError" }
            val detail = error.message
                ?.replace(Regex("[\\r\\n\\t]+"), " ")
                ?.replace(Regex("\\s{2,}"), " ")
                ?.trim()
                ?.take(360)
                ?.takeIf(String::isNotBlank)
            return buildString {
                append(stage)
                append(" 단계에서 오류가 발생했습니다.\n\n진단 코드: ")
                append(type)
                if (detail != null) {
                    append("\n세부 내용: ")
                    append(detail)
                }
                append("\n\n이 내용은 기기에만 저장되며 서버로 전송되지 않습니다.")
            }.take(MAX_DIAGNOSTIC_LENGTH)
        }
    }
}
