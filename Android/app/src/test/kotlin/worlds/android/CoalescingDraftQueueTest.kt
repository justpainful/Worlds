package worlds.android

import org.junit.Assert.*
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class CoalescingDraftQueueTest {
    @Test fun retainsLatestQueuedWriteAndFlushesItOnClose() {
        val queue = CoalescingDraftQueue()
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val writes = Collections.synchronizedList(mutableListOf<String>())
        assertTrue(queue.update("draft", { started.countDown(); check(release.await(5, TimeUnit.SECONDS)); writes.add("first") }, {}))
        assertTrue(started.await(5, TimeUnit.SECONDS))
        repeat(1_000) { index -> assertTrue(queue.update("draft", { writes.add("value $index") }, {})) }
        queue.close()
        assertFalse(queue.update("draft", {}, {}))
        release.countDown()
        assertTrue(queue.awaitTermination(5_000))
        assertEquals(listOf("first", "value 999"), writes)
    }

    @Test fun discardBarrierCannotBeOvertakenByAnotherDraft() {
        val queue = CoalescingDraftQueue()
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val events = Collections.synchronizedList(mutableListOf<String>())
        assertTrue(queue.update("old", { started.countDown(); check(release.await(5, TimeUnit.SECONDS)); events.add("old first") }, {}))
        assertTrue(started.await(5, TimeUnit.SECONDS))
        assertTrue(queue.update("old", { events.add("old last") }, {}))
        assertTrue(queue.barrier("old") { events.add("discard old") })
        assertTrue(queue.update("new", { events.add("new last") }, {}))
        queue.close(); release.countDown()
        assertTrue(queue.awaitTermination(5_000))
        assertEquals(listOf("old first", "discard old", "new last"), events)
    }

    @Test fun failureDoesNotStopLaterWrites() {
        val queue = CoalescingDraftQueue()
        val failed = CountDownLatch(1)
        val saved = CountDownLatch(1)
        assertTrue(queue.update("draft", { error("disk") }, { ok -> assertFalse(ok); failed.countDown() }))
        assertTrue(failed.await(5, TimeUnit.SECONDS))
        assertTrue(queue.update("draft", {}, { ok -> assertTrue(ok); saved.countDown() }))
        assertTrue(saved.await(5, TimeUnit.SECONDS))
        queue.close(); assertTrue(queue.awaitTermination(5_000))
    }
}
