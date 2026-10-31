package com.galaxyremote.app.interaction

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Handler
import android.os.SystemClock

/** Experimental synchronized continued strokes, NOT arbitrary shell/native MotionEvent injection. */
class MultiPointerController(private val service: AccessibilityService, private val handler: Handler,
    private val screenSize: () -> Pair<Float,Float>, private val fault: (String) -> Unit) : PointerBackend {
    override val experimental = true
    private data class Stroke(val description: GestureDescription.StrokeDescription, val x: Float, val y: Float)
    private val state = MultiPointerState()
    private var rendered = linkedMapOf<String,Stroke>()
    private var display: Pair<Float,Float>? = null
    private var session: String? = null
    private var busy = false
    private var dirty = false
    private val watchdog = object : Runnable {
        override fun run() {
            if(state.expire(SystemClock.elapsedRealtime())){ dirty=true; drain(); fault("POINTER_TIMEOUT") }
            if(state.pointers.isNotEmpty())handler.postDelayed(this,250)
        }
    }
    override fun begin(sessionId: String) { release(); session=sessionId; state.newSession() }
    override fun accept(sessionId: String, sequence: Long, events: List<PointerEvent>): Boolean {
        if(sessionId != session || session == null)return false
        val size=screenSize()
        if(display != null && display != size){release();fault("DISPLAY_CHANGED");return false}
        if(!state.apply(sequence,events,SystemClock.elapsedRealtime())){release();fault("INVALID_POINTER_FRAME");return false}
        if(display==null)display=size
        dirty=true
        handler.removeCallbacks(watchdog);handler.postDelayed(watchdog,250)
        drain();return true
    }
    override fun release() { state.clear(); dirty=true; handler.removeCallbacks(watchdog);drain() }
    private fun drain() {
        if(busy||!dirty)return
        dirty=false
        val desired=state.pointers
        val ids=rendered.keys+desired.keys
        if(ids.isEmpty()){display=null;return}
        val size=display ?: screenSize()
        val builder=GestureDescription.Builder()
        val next=linkedMapOf<String,Stroke>()
        val origin=InteractionDiagnostics.trace.currentPhase()
        try {
            for(id in ids) {
                val old=rendered[id];val p=desired[id]
                val x=if(p!=null)(p.x*(size.first-1)).toFloat() else old!!.x
                val y=if(p!=null)(p.y*(size.second-1)).toFloat() else old!!.y
                val path=Path().apply { moveTo(old?.x?:x,old?.y?:y);if(old!=null&&(old.x!=x||old.y!=y))lineTo(x,y) }
                val stroke=old?.description?.continueStroke(path,0,24,p!=null)
                    ?: GestureDescription.StrokeDescription(path,0,24,p!=null)
                builder.addStroke(stroke)
                if(p!=null)next[id]=Stroke(stroke,x,y)
            }
            busy=true
            val callback=object: AccessibilityService.GestureResultCallback(){
                override fun onCompleted(gestureDescription: GestureDescription?) {InteractionDiagnostics.trace.record(InteractionTrace.Kind.MULTI_TOUCH,InteractionTrace.Result.COMPLETED,origin);busy=false;rendered=next;drain()}
                override fun onCancelled(gestureDescription: GestureDescription?) {InteractionDiagnostics.trace.record(InteractionTrace.Kind.MULTI_TOUCH,InteractionTrace.Result.CANCELLED,origin);reset();fault("MULTI_GESTURE_CANCELLED")}
            }
            if(!service.dispatchGesture(builder.build(),callback,handler)){
                InteractionDiagnostics.trace.record(InteractionTrace.Kind.MULTI_TOUCH,InteractionTrace.Result.REJECTED,origin);reset();fault("MULTI_GESTURE_REJECTED")
            } else InteractionDiagnostics.trace.record(InteractionTrace.Kind.MULTI_TOUCH,InteractionTrace.Result.SUBMITTED,origin)
        }catch(_:Exception){InteractionDiagnostics.trace.record(InteractionTrace.Kind.MULTI_TOUCH,InteractionTrace.Result.ERROR,origin);reset();fault("MULTI_GESTURE_ERROR")}
    }
    private fun reset(){busy=false;dirty=false;rendered.clear();state.clear();display=null;handler.removeCallbacks(watchdog)}
}
