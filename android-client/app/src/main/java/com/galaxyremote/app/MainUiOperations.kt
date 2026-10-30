package com.galaxyremote.app

import androidx.lifecycle.ViewModel

/** Retain a pending SAF approval across rotation/theme recreation, bound to the same transfer. */
class MainUiOperations : ViewModel() {
    var incomingManager: RemoteFileTransfer? = null
    var incomingId: String? = null

    override fun onCleared() {
        val manager = incomingManager
        if (manager === RemoteFileTransfer.current && manager?.pendingOffer?.id == incomingId) manager?.cancel()
        incomingManager = null
        incomingId = null
    }
}
