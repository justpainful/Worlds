package worlds.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import worlds.identity.EncryptedSessionStore
import worlds.identity.IdentityService

/**
 * What the account service tells this app (docs/admin/PLAN.md, phase 9):
 * maintenance, an incident, announcements and an update to install, shown at
 * the bottom of the window; the daily usage counts when the person agreed; and
 * the question about them, asked once.
 */
private const val PREFS = "worlds_service"
private const val USAGE_ON = "usage_on"
private const val USAGE_ASKED = "usage_asked"
private const val USAGE_SENT = "usage_sent"
private const val DISMISSED = "dismissed"
private const val DAY = 86_400_000L

internal fun servicePrefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
internal fun usageCountsOn(context: Context) = servicePrefs(context).getBoolean(USAGE_ON, false)
internal fun setUsageCounts(context: Context, on: Boolean) = servicePrefs(context).edit().putBoolean(USAGE_ON, on).putBoolean(USAGE_ASKED, true).apply()
internal fun appVersion(context: Context): String = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull().orEmpty()
private fun lang() = if (java.util.Locale.getDefault().language == "ar") "ar" else "en"

private data class Notice(val id: String, val warning: Boolean, val text: String, val link: String?, val linkLabel: Int, val dismissible: Boolean)

private fun pick(o: JSONObject?): String {
    if (o == null) return ""
    val ar = o.optString("ar"); val en = o.optString("en")
    return if (lang() == "ar") ar.ifBlank { en } else en.ifBlank { ar }
}

private fun noticesOf(config: JSONObject, dismissed: Set<String>, resources: android.content.res.Resources): List<Notice> {
    val out = mutableListOf<Notice>()
    config.optJSONObject("incident")?.takeIf { it.optBoolean("on") }?.let { i ->
        out += Notice("incident", true, listOf(pick(i.optJSONObject("title")), pick(i.optJSONObject("body"))).filter { it.isNotBlank() }.joinToString(". "),
            "https://status.enterworlds.space", R.string.service_status, false)
    }
    config.optJSONObject("maintenance")?.takeIf { it.optBoolean("on") }?.let { m ->
        val text = pick(m.optJSONObject("message")).ifBlank { resources.getString(if (m.optBoolean("readOnly")) R.string.service_maintenance_read_only else R.string.service_maintenance) }
        out += Notice("maintenance", true, text, null, 0, false)
    }
    val list = config.optJSONArray("announcements")
    for (i in 0 until (list?.length() ?: 0)) {
        val a = list!!.getJSONObject(i); val id = a.optString("id")
        if (a.optBoolean("dismissible") && id in dismissed) continue
        out += Notice(id, a.optString("level") != "info", pick(a.optJSONObject("text")), a.optString("link").takeIf { it.startsWith("https://") }, R.string.service_learn_more, a.optBoolean("dismissible"))
    }
    config.optJSONObject("update")?.takeIf { it.optBoolean("required") }?.let { u ->
        val id = "update:" + u.optString("minimum")
        if (!u.optBoolean("dismissible") || id !in dismissed) out += Notice(id, !u.optBoolean("dismissible"), resources.getString(R.string.service_update, u.optString("minimum")),
            u.optString("url").takeIf { it.startsWith("https://") } ?: "https://enterworlds.space/apps/", R.string.service_download, u.optBoolean("dismissible"))
    }
    return out.filter { it.text.isNotBlank() }.take(3)
}

@Composable internal fun ServiceNotices(identity: String?, pageCount: Int, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val prefs = remember { servicePrefs(context) }
    var config by remember { mutableStateOf<JSONObject?>(null) }
    var dismissed by remember { mutableStateOf(prefs.getStringSet(DISMISSED, emptySet()).orEmpty()) }
    var ask by remember { mutableStateOf(false) }
    val count by rememberUpdatedState(pageCount)

    LaunchedEffect(identity) {
        val server = identity?.takeIf { it.isNotBlank() } ?: OFFICIAL_SERVER
        val service = IdentityService(server, EncryptedSessionStore(context.applicationContext), networkAvailable = { networkAvailable(context.applicationContext) })
        var first = true
        while (true) {
            config = runCatching { withContext(Dispatchers.IO) { service.serviceConfig("android", appVersion(context), lang()) } }.getOrNull() ?: config
            val signedIn = runCatching { withContext(Dispatchers.IO) { service.session() != null } }.getOrDefault(false)
            if (signedIn && prefs.getBoolean(USAGE_ON, false) && System.currentTimeMillis() - prefs.getLong(USAGE_SENT, 0) > DAY) {
                val data = JSONObject().put("platform", "android").put("version", appVersion(context)).put("pages", count).put("language", lang())
                    .put("features", JSONObject().put("sync", true))
                if (runCatching { withContext(Dispatchers.IO) { service.sendUsage(data) } }.isSuccess) prefs.edit().putLong(USAGE_SENT, System.currentTimeMillis()).apply()
            }
            // A minute after start, once: the question about usage counts.
            if (first && signedIn && !prefs.getBoolean(USAGE_ASKED, false)) { delay(60_000); ask = true }
            first = false
            delay(5 * 60_000L)
        }
    }

    val notices = config?.let { noticesOf(it, dismissed, resources) }.orEmpty()
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).windowInsetsPadding(WindowInsets.navigationBars), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (ask) Surface(shape = RoundedCornerShape(16.dp), tonalElevation = 6.dp, shadowElevation = 6.dp, modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.service_usage_title), style = MaterialTheme.typography.titleSmall)
                Text(stringResource(R.string.service_usage_text), style = MaterialTheme.typography.bodySmall, lineHeight = 20.sp)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { setUsageCounts(context, false); ask = false }) { Text(stringResource(R.string.service_usage_no)) }
                    TextButton(onClick = { setUsageCounts(context, true); ask = false }) { Text(stringResource(R.string.service_usage_yes)) }
                }
            }
        }
        notices.forEach { n ->
            Surface(shape = RoundedCornerShape(16.dp), tonalElevation = 6.dp, shadowElevation = 6.dp,
                color = if (n.warning) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth()) {
                Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(n.text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, lineHeight = 20.sp)
                    n.link?.let { url -> TextButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }) { Text(stringResource(n.linkLabel)) } }
                    if (n.dismissible) TextButton(onClick = {
                        dismissed = (dismissed + n.id).toList().takeLast(50).toSet()
                        prefs.edit().putStringSet(DISMISSED, dismissed).apply()
                    }) { Text(stringResource(R.string.service_dismiss)) }
                }
            }
        }
    }
}
