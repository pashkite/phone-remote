package com.galaxyremote.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class RemoteProtocolTest {
    @Test fun duplicateAndStaleCommandsNeverExecuteTwice() {
        val executed = AtomicInteger(0)
        val completed = CountDownLatch(1)
        val rejected = CountDownLatch(1)
        val processor = RemoteCommandProcessor(
            send = { ack ->
                if (ack.optString("status") == "completed") completed.countDown()
                if (ack.optString("code") == "STALE_COMMAND") rejected.countDown()
            },
            handle = { _, finish -> executed.incrementAndGet(); finish(true, null) },
        )
        val command = JSONObject().put("v", 1).put("seq", 1).put("id", "6b6f61b2-6251-4fc5-92bc-ae2207c5f82a").put("type", "global").put("action", "home")
        processor.receive(command); processor.receive(command)
        processor.receive(JSONObject(command.toString()).put("id", "7b6f61b2-6251-4fc5-92bc-ae2207c5f82a"))
        assertTrue(completed.await(3, TimeUnit.SECONDS)); assertTrue(rejected.await(3, TimeUnit.SECONDS))
        assertEquals(1, executed.get()); processor.close()
    }
}
