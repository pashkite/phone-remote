package com.galaxyremote.app.display

import org.junit.Assert.*
import org.junit.Test

class ShellTouchStateTest {
    private class Rig {
        val events = mutableListOf<ShellMotion>()
        var accepted = true
        var owner = true
        var heartbeat = true
        var now = 100L
        var size = TouchGeometry(1440,3120,0)
        val state = ShellTouchState { events += it; accepted }
        fun input(token: Long, action: Int, x: Float = .5f, y: Float = .5f) =
            state.inject(token,action,x,y,size,now,now,owner,heartbeat)
    }
    @Test fun noConsentOrPreparationNeverInjects() {
        val r = Rig()
        assertFalse(r.input(0,0))
        try { r.state.prepare(false,r.now); fail("consent skipped") } catch (_: IllegalStateException) { }
        assertTrue(r.events.isEmpty())
    }
    @Test fun orderedDownMoveUpScalesDisplayZeroGeometryAndKeepsDownTime() {
        val r = Rig(); val token = r.state.prepare(true,r.now)
        assertTrue(r.input(token,0,0f,1f))
        r.now += 40; assertTrue(r.input(token,2,1f,0f))
        r.now += 40; assertTrue(r.input(token,1,1f,0f))
        assertEquals(listOf(0,2,1),r.events.map { it.action })
        assertEquals(1439f,r.events[1].x); assertEquals(3119f,r.events[0].y)
        assertTrue(r.events.all { it.downAt == 100L })
        assertFalse(r.input(token,2))
    }
    @Test fun malformedAndSecondDownCancelHeldPointerInsteadOfRetargeting() {
        for (bad in listOf(Float.NaN,Float.POSITIVE_INFINITY,-.1f,1.1f)) {
            val r = Rig();val token = r.state.prepare(true,r.now)
            assertTrue(r.input(token,0));assertFalse(r.input(token,2,bad))
            assertEquals(3,r.events.last().action)
        }
        val r = Rig();val token = r.state.prepare(true,r.now)
        assertTrue(r.input(token,0));assertFalse(r.input(token,0))
        assertEquals(listOf(0,3),r.events.map { it.action })
    }
    @Test fun unsupportedActionAndInvalidGeometryCannotInject() {
        for (action in listOf(-1,4,5,6,100)) {
            val r=Rig();val token=r.state.prepare(true,r.now)
            assertFalse(r.input(token,action));assertTrue(r.events.isEmpty())
        }
        for (size in listOf(TouchGeometry(0,10,0),TouchGeometry(10,20000,0),TouchGeometry(10,10,4))) {
            val r=Rig();r.size=size;val token=r.state.prepare(true,r.now)
            assertFalse(r.input(token,0));assertTrue(r.events.isEmpty())
        }
    }
    @Test fun rotationOrSizeChangeCancelsAndRequiresNewDown() {
        val r=Rig();val token=r.state.prepare(true,r.now)
        assertTrue(r.input(token,0));r.size=TouchGeometry(3120,1440,1)
        assertFalse(r.input(token,2));assertEquals(3,r.events.last().action)
        assertFalse(r.input(token,1));assertTrue(r.input(token,0))
    }
    @Test fun oldTrialPacketsAndReleasesCannotAffectNewTrial() {
        val r=Rig();val old=r.state.prepare(true,r.now)
        val fresh=r.state.prepare(true,r.now)
        assertTrue(r.input(fresh,0));val count=r.events.size
        assertFalse(r.input(old,2));assertFalse(r.state.release(old))
        assertEquals(count,r.events.size);assertTrue(r.input(fresh,1))
    }
    @Test fun durationOwnerHeartbeatAndStopRevokeInputAndReleaseHeldPointer() {
        for (condition in 0..3) {
            val r=Rig();val token=r.state.prepare(true,r.now)
            assertTrue(r.input(token,0))
            when(condition){0->r.now+=30_000;1->r.owner=false;2->r.heartbeat=false;3->r.state.stop()}
            assertFalse(r.input(token,2));assertEquals(3,r.events.last().action)
            assertFalse(r.input(token,0))
        }
    }
    @Test fun missingPointerHeartbeatTimesOutWithoutEndingAnOtherwiseValidTrial() {
        val r=Rig();val token=r.state.prepare(true,r.now)
        assertTrue(r.input(token,0));r.now+=1500
        r.state.tick(r.now,r.now,true,true)
        assertEquals(3,r.events.last().action);assertFalse(r.input(token,1))
        assertTrue(r.input(token,0))
    }
    @Test fun boundedOffLeaseExtendsOnlyPreparedInputAndExpiresExactlyAtDeadline() {
        val r=Rig()
        try{r.state.extendForOff(30,r.now);fail("unprepared")}catch(_:IllegalStateException){}
        val token=r.state.prepare(true,r.now)
        for (duration in listOf(0,9,331,Int.MAX_VALUE)) {
            try{r.state.extendForOff(duration,r.now);fail("unbounded")}catch(_:IllegalArgumentException){}
        }
        r.state.extendForOff(330,r.now);r.now+=329_999
        assertTrue(r.input(token,0));r.now++
        assertFalse(r.input(token,2));assertEquals(3,r.events.last().action)
    }
    @Test fun frameworkRejectionNeverBecomesDeliverySuccessAndAttemptsCancel() {
        val r=Rig();val token=r.state.prepare(true,r.now);r.accepted=false
        assertFalse(r.input(token,0))
        assertEquals(listOf(0,3),r.events.map { it.action })
        r.accepted=true;assertTrue(r.input(token,0))
    }
    @Test fun candidateCannotUseLongOffTrialsAndLegacyPanelDurationRemainsIndependent() {
        ShellTouchPolicy.requireOffDuration(true,30)
        ShellTouchPolicy.requireOffDuration(false,330)
        for (seconds in listOf(0,10,29,31,330,Int.MAX_VALUE)) {
            try { ShellTouchPolicy.requireOffDuration(true,seconds);fail("long/invalid candidate trial") }
            catch (error:IllegalStateException) { assertEquals("SHELL_TOUCH_SHORT_TRIAL_ONLY",error.message) }
        }
    }
    @Test fun emitterExceptionDoesNotLeavePhantomPointerOrAuthorizeNewTrial() {
        var throws = true
        val state=ShellTouchState { if(throws) error("framework failure") else true }
        val token=state.prepare(true,0)
        val size=TouchGeometry(1440,3120,0)
        assertFalse(state.inject(token,0,.5f,.5f,size,1,1,true,true))
        throws=false
        assertFalse(state.inject(token,2,.5f,.5f,size,2,2,true,true))
        assertTrue(state.inject(token,0,.5f,.5f,size,3,3,true,true))
        state.stop()
        assertFalse(state.inject(token,0,.5f,.5f,size,4,4,true,true))
    }

}
