package com.galaxyremote.app

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import androidx.core.content.ContextCompat

class ProjectionSmokeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        getSharedPreferences(ProjectionSmokeContract.PREFERENCES, MODE_PRIVATE)
            .edit()
            .clear()
            .commit()

        val manager = getSystemService(MediaProjectionManager::class.java)
        val consentIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
            manager.createScreenCaptureIntent()
        }
        startActivityForResult(consentIntent, REQUEST_PROJECTION)
    }

    @Deprecated("Activity result is sufficient for this debug-only smoke harness")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_PROJECTION) return
        if (resultCode != RESULT_OK || data == null) {
            recordFailure("화면 공유 승인이 취소되었습니다.")
            finish()
            return
        }

        ContextCompat.startForegroundService(
            this,
            Intent(this, ProjectionSmokeService::class.java)
                .putExtra(ProjectionSmokeContract.EXTRA_RESULT_DATA, data),
        )
        finish()
    }

    private fun recordFailure(detail: String) {
        getSharedPreferences(ProjectionSmokeContract.PREFERENCES, MODE_PRIVATE)
            .edit()
            .putString(ProjectionSmokeContract.RESULT, ProjectionSmokeContract.RESULT_FAILURE)
            .putString(ProjectionSmokeContract.DETAIL, detail)
            .commit()
    }

    companion object {
        private const val REQUEST_PROJECTION = 1401
    }
}
