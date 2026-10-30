package com.galaxyremote.app.interaction
import org.junit.Assert.*
import org.junit.Test
class MultiPointerStateTest {
    private fun e(id:String,phase:String,x:Double=.5)=PointerEvent(id,phase,x,.5)
    @Test fun independentPointersKeepTheirIdentityAndReleaseSeparately(){
        val s=MultiPointerState()
        assertTrue(s.apply(1,listOf(e("move","down")),0))
        assertTrue(s.apply(2,listOf(e("move","move",.7),e("attack","down")),100))
        assertEquals(2,s.pointers.size)
        assertTrue(s.apply(3,listOf(e("move","move"),e("attack","up")),200));assertEquals(setOf("move"),s.pointers.keys)
        assertTrue(s.apply(4,listOf(e("move","cancel")),300));assertTrue(s.pointers.isEmpty())
    }
    @Test fun malformedAndStaleFramesDoNotMutateState(){
        val s=MultiPointerState();assertTrue(s.apply(1,listOf(e("a","down")),0))
        assertFalse(s.apply(1,listOf(e("a","up")),1));assertFalse(s.apply(2,listOf(e("b","move")),1))
        assertFalse(s.apply(2,listOf(e("a","move",Double.NaN)),1));assertFalse(s.apply(2,listOf(e("a","move",2.0)),1))
        assertFalse(s.apply(2,listOf(e("a","move"),e("a","up")),1));assertEquals(1,s.pointers.size)
    }
    @Test fun completeSnapshotAndFivePointerLimitAreEnforced(){
        val s=MultiPointerState();assertFalse(s.apply(1,(1..6).map{e("p$it","down")},0));assertTrue(s.pointers.isEmpty())
        assertTrue(s.apply(1,(1..5).map{e("p$it","down")},0));assertFalse(s.apply(2,listOf(e("p1","move")),1));assertEquals(5,s.pointers.size)
    }
    @Test fun timeoutReleaseAndSessionResetPreventStuckOrReplayedPointers(){
        val s=MultiPointerState();s.apply(10,listOf(e("a","down")),0);assertFalse(s.expire(1999));assertTrue(s.expire(2000));assertTrue(s.pointers.isEmpty())
        s.clear();assertFalse(s.apply(9,listOf(e("a","down")),3000));s.newSession();assertTrue(s.apply(1,listOf(e("b","down")),3001))
    }
    @Test fun invalidTransitionAndPointerIdAreRejected(){
        val s=MultiPointerState();assertFalse(s.apply(1,listOf(e("","down")),0));assertFalse(s.apply(1,listOf(e("../x","down")),0))
        assertFalse(s.apply(1,listOf(e("a","up")),0));assertTrue(s.apply(1,listOf(e("a","down")),0));assertFalse(s.apply(2,listOf(e("a","down")),1))
    }
}
