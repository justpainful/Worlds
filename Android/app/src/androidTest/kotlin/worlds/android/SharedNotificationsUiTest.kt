package worlds.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.Workspace
import worlds.sync.*
import java.util.UUID
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class SharedNotificationsUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun authenticatedFeedAndOpenMarksOnlyTheSelectedItem() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val name = "notices-${UUID.randomUUID()}.db"
        val store = AndroidSyncStore(app, name)
        val server = MockWebServer()
        server.start()
        val authority = "https://identity.example"
        val endpoint = server.url("/").toString().trimEnd('/')
        val item = """{"id":"comment:user","kind":"mention","workspaceId":"other-space","docId":"other-page","threadId":"thread","commentId":"comment","from":"sender","fromName":"Sara","excerpt":"Please review this page","createdAt":1700000000000,"readAt":null}"""
        val feed = """{"items":[$item],"unread":1}"""
        server.enqueue(MockResponse().setBody(feed))
        server.enqueue(MockResponse().setBody("""{"ok":true,"marked":1}"""))
        server.enqueue(MockResponse().setBody("""{"items":[],"unread":0}"""))
        val runtime = AccountSyncRuntime(
            credentials = { SyncCredentials(authority, "user", "device", "secret") }, allowLoopbackForTests = true,
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
                override fun start() { callback.onAuthenticated("view"); callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0))); callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0))) }
                override fun send(frame: SyncWire.Frame) = true
                override fun close() { }
            } }, listener) }
        )
        val controller = SharedPageController(runtime, authority, "space")
        var target: NotificationTarget? = null
        try {
            controller.open(endpoint, "page")
            compose.setContent { WorldsTheme { SharedPageScreen(authority, Workspace("space", "Team", "owner", 1), {}, controller, onOpenNotification = { target = it }) } }
            compose.waitUntil(20_000) { controller.state.value.access == "view" }
            compose.onNodeWithTag("shared_notices").performScrollTo().performClick()
            compose.waitUntil(20_000) { controller.state.value.notices.size == 1 }
            compose.onNodeWithText("Please review this page").assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-notifications.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("notice_comment:user").performClick()
            compose.waitUntil(20_000) { target != null }
            assertEquals("other-space", target!!.workspace)
            assertEquals("other-page", target!!.page)
            assertEquals("thread", target!!.thread); assertEquals("comment", target!!.comment)
            val list = server.takeRequest(5, TimeUnit.SECONDS)!!
            val mark = server.takeRequest(5, TimeUnit.SECONDS)!!
            val refreshed = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertEquals("GET", list.method); assertEquals("/v1/notifications?limit=50", list.path)
            assertEquals("Bearer secret", list.getHeader("Authorization"))
            assertEquals("POST", mark.method); assertEquals("/v1/notifications/read", mark.path)
            assertEquals("comment:user", org.json.JSONObject(mark.body.readUtf8()).getJSONArray("ids").getString(0))
            assertEquals("GET", refreshed.method)
        } finally {
            controller.close(); runtime.accountChange { }; store.close(); app.deleteDatabase(name); server.shutdown()
        }
    }
    @Test fun samePageFocusesTheReferencedMessageAndHandlesMissingThread() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val db = "notice-target-${UUID.randomUUID()}.db"; val store = AndroidSyncStore(app, db)
        val server = MockWebServer(); server.start()
        val endpoint = server.url("/").toString().trimEnd('/'); val authority = "https://identity.example"
        val fixture = android.util.Base64.decode("AQ3o1I6DAwAnAQd0aHJlYWRzB3RocmVhZDEBKADo1I6DAwACaWQBdwd0aHJlYWQxKADo1I6DAwAFcXVvdGUBdw1Qcm9qZWN0IG5vdGVzKADo1I6DAwAJY3JlYXRlZEJ5AXcEc2FyYSgA6NSOgwMACWNyZWF0ZWRBdAF7Qni8/laAAAAoAOjUjoMDAAhyZXNvbHZlZAF5JwDo1I6DAwAIY29tbWVudHMABwDo1I6DAwYBKADo1I6DAwcCaWQBdwJjMSgA6NSOgwMHBmF1dGhvcgF3BHNhcmEoAOjUjoMDBwRib2R5AXcXUGxlYXNlIHJldmlldyB0aGlzIHBhZ2UoAOjUjoMDBwljcmVhdGVkQXQBe0J4vP5WgAAAKAEGcGVvcGxlBHNhcmEBdgIEbmFtZXcEU2FyYQVjb2xvcncHIzEyMzQ1NgA=", android.util.Base64.DEFAULT)
        fun feed(id: String, thread: String, comment: String) = """{"items":[{"id":"$id","kind":"reply","workspaceId":"space","docId":"page","threadId":"$thread","commentId":"$comment","from":"sara","excerpt":"Example","createdAt":1700000000000}],"unread":1}"""
        server.enqueue(MockResponse().setBody(feed("first", "thread1", "c1")))
        server.enqueue(MockResponse().setBody("""{"ok":true,"marked":1}"""))
        server.enqueue(MockResponse().setBody("""{"items":[],"unread":0}"""))
        server.enqueue(MockResponse().setBody(feed("second", "removed-thread", "removed-comment")))
        server.enqueue(MockResponse().setBody("""{"ok":true,"marked":1}"""))
        server.enqueue(MockResponse().setBody("""{"items":[],"unread":0}"""))
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(authority, "user", "device", "token") }, allowLoopbackForTests = true,
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
                override fun start() { callback.onAuthenticated("view"); callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0))); callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0))); callback.onFrame(SyncWire.Frame.Sync(1, 1, fixture)) }
                override fun send(frame: SyncWire.Frame) = true
                override fun close() { }
            } }, listener) })
        val controller = SharedPageController(runtime, authority, "space")
        var navigations = 0
        try {
            controller.open(endpoint, "page")
            compose.setContent { WorldsTheme { SharedPageScreen(authority, Workspace("space", "Team", "owner", 1), {}, controller, onOpenNotification = { navigations++ }) } }
            compose.waitUntil(20_000) { controller.state.value.access == "view" && controller.state.value.commentsSynced }
            compose.onNodeWithTag("shared_notices").performScrollTo().performClick()
            compose.waitUntil(20_000) { controller.state.value.notices.size == 1 }
            compose.onNodeWithTag("notice_first").performClick()
            compose.waitUntil(20_000) { controller.state.value.focusedThread == "thread1" }
            compose.onNodeWithTag("conversation_target").assertIsDisplayed()
            compose.onNodeWithTag("conversation_message_c1").assertIsDisplayed()
            assertEquals(0, navigations)
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-notification-target.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("conversation_show_all").performClick()
            compose.onNodeWithTag("conversation_thread1").assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.close)).performClick()
            compose.onNodeWithTag("shared_notices").performScrollTo().performClick()
            compose.waitUntil(20_000) { controller.state.value.notices.singleOrNull()?.id == "second" }
            compose.onNodeWithTag("notice_second").performClick()
            compose.waitUntil(20_000) { controller.state.value.focusedThread == "removed-thread" }
            compose.onNodeWithTag("conversation_missing").assertIsDisplayed()
            compose.onNodeWithTag("conversation_show_all").performClick()
            compose.onNodeWithTag("conversation_thread1").assertIsDisplayed()
        } finally { controller.close(); runtime.accountChange { }; store.close(); app.deleteDatabase(db); server.shutdown() }
    }

}
