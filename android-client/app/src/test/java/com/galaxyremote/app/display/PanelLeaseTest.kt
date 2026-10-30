package com.galaxyremote.app.display

import org.junit.Assert.*
import org.junit.Test

class PanelLeaseTest {
    private fun rejects(action: () -> Unit) {
        try { action(); fail("unsafe transition accepted") } catch (_: IllegalStateException) { }
    }
    @Test fun refusesOffWithoutRecoveryAndLocalAttestation() {
        val lease = PanelLease()
        rejects { lease.requireOff(30) }
        rejects { lease.arm(true) }
        lease.checked(true)
        rejects { lease.arm(false) }
        lease.arm(true); lease.requireOff(30)
        rejects { lease.requireOff(30) }
        rejects { lease.arm(true) }
    }
    @Test fun recoveryAndResetInvalidatePreviousConsent() {
        val lease = PanelLease(); lease.checked(true); lease.arm(true)
        lease.reset(); rejects { lease.requireOff(30) }; rejects { lease.arm(true) }
        lease.checked(true); lease.arm(true); lease.checked(false)
        rejects { lease.requireOff(30) }
    }
    @Test fun boundsOffDuration() {
        for (seconds in listOf(0, 9, 331, Int.MAX_VALUE)) {
            val lease = PanelLease(); lease.checked(true); lease.arm(true)
            try { lease.requireOff(seconds); fail("unbounded duration accepted") } catch (_: IllegalArgumentException) { }
        }
    }
}
