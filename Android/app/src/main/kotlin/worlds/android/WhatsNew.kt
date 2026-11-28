package worlds.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * "What's new" once after an update, as on the desktop (src/account/whatsNew.tsx):
 * the release's title, summary and highlights from its changelog file
 * (web/changelog/releases/<version>.txt), copied into the app's assets at build
 * time so it shows offline, with a link to the whole page. Settings opens it again.
 */
private const val LAST_VERSION = "last_version"
private const val NOTES_FOLDER = "release-notes"

internal data class ReleaseNotes(val title: String, val summary: String, val highlights: List<String>)

/** One language of a changelog file: "Arabic || English" on every line. */
internal fun parseReleaseNotes(raw: String, arabic: Boolean): ReleaseNotes {
    fun side(value: String): String {
        val parts = value.split(" || ")
        return (if (arabic) parts[0] else parts.getOrElse(1) { parts[0] }).trim()
    }
    var title = ""
    var summary = ""
    val highlights = mutableListOf<String>()
    var inHighlights = false
    val item = Regex("^- (new|improved|fixed): (.*)$")
    for (line in raw.lines().map { it.trimEnd('\r') }) {
        when {
            line.startsWith("# ") -> inHighlights = line.substring(2).trim() == "highlights"
            line.startsWith("title: ") -> title = side(line.substring(7))
            line.startsWith("summary: ") -> summary = side(line.substring(9))
            inHighlights && line.startsWith("- ") -> item.find(line)?.let { highlights += side(it.groupValues[2]) }
        }
    }
    return ReleaseNotes(title, summary, highlights)
}

/** Whether version a is newer than b, by major, minor and patch; a suffix such as "-beta.1" is ignored. */
internal fun versionNewer(a: String, b: String): Boolean {
    fun parts(v: String) = v.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    val pa = parts(a); val pb = parts(b)
    for (i in 0 until 3) {
        val x = pa.getOrElse(i) { 0 }; val y = pb.getOrElse(i) { 0 }
        if (x != y) return x > y
    }
    return false
}

internal enum class WhatsNewStep { Show, Remember, Nothing }

/**
 * What to do at start. A fresh install only remembers its version; an update
 * shows the notes once. Versions before 1.1 did not keep the last version, so
 * no stored version on an app that was updated (not freshly installed) means
 * someone just came from an older Worlds.
 */
internal fun whatsNewStep(current: String, last: String?, freshInstall: Boolean): WhatsNewStep = when {
    current.isBlank() -> WhatsNewStep.Nothing
    last.isNullOrBlank() -> if (freshInstall) WhatsNewStep.Remember else WhatsNewStep.Show
    versionNewer(current, last) -> WhatsNewStep.Show
    else -> WhatsNewStep.Nothing
}

private fun freshInstall(context: Context): Boolean = runCatching {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    info.firstInstallTime == info.lastUpdateTime
}.getOrDefault(false)

/** This version's notes from the bundled changelog file, or null when the build has none. */
internal fun loadReleaseNotes(context: Context, version: String, arabic: Boolean): ReleaseNotes? = runCatching {
    context.assets.open("$NOTES_FOLDER/$version.txt").bufferedReader(Charsets.UTF_8).use { parseReleaseNotes(it.readText(), arabic) }
}.getOrNull()?.takeIf { it.title.isNotBlank() || it.highlights.isNotEmpty() }

private fun markVersionSeen(context: Context, version: String) = servicePrefs(context).edit().putString(LAST_VERSION, version).apply()

/** Opened again from Settings. */
internal object WhatsNewState {
    var requested by mutableStateOf(false)
}

@Composable private fun arabicUi(): Boolean = LocalConfiguration.current.locales[0]?.language == "ar"

/** Mounted once over the whole window (MainActivity). */
@Composable internal fun WhatsNew() {
    val context = LocalContext.current
    val arabic = arabicUi()
    val version = remember { appVersion(context) }
    var notes by remember { mutableStateOf<ReleaseNotes?>(null) }

    LaunchedEffect(Unit) {
        val last = servicePrefs(context).getString(LAST_VERSION, null)
        when (whatsNewStep(version, last, freshInstall(context))) {
            WhatsNewStep.Remember -> markVersionSeen(context, version)
            WhatsNewStep.Show -> {
                val loaded = withContext(Dispatchers.IO) { loadReleaseNotes(context, version, arabic) }
                notes = loaded
                if (loaded == null) markVersionSeen(context, version)
            }
            WhatsNewStep.Nothing -> Unit
        }
    }
    LaunchedEffect(WhatsNewState.requested) {
        if (!WhatsNewState.requested) return@LaunchedEffect
        val loaded = withContext(Dispatchers.IO) { loadReleaseNotes(context, version, arabic) }
        notes = loaded
        if (loaded == null) WhatsNewState.requested = false
    }

    val shown = notes ?: return
    val close: () -> Unit = {
        markVersionSeen(context, version)
        WhatsNewState.requested = false
        notes = null
    }
    AlertDialog(onDismissRequest = close, modifier = Modifier.testTag("whats_new"),
        title = { Text(stringResource(R.string.whats_new_version, version)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (shown.title.isNotBlank()) Text(shown.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                if (shown.summary.isNotBlank()) Text(shown.summary, style = MaterialTheme.typography.bodyMedium, lineHeight = 21.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                shown.highlights.forEach { line ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.padding(top = 8.dp).size(5.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
                        Text(line, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, lineHeight = 21.sp, color = MaterialTheme.colorScheme.onSurface)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = close, modifier = Modifier.testTag("whats_new_continue")) { Text(stringResource(R.string.whats_new_continue)) } },
        dismissButton = {
            TextButton(onClick = {
                val url = "https://changelog.enterworlds.space/${if (arabic) "" else "en/"}$version/"
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            }) { Text(stringResource(R.string.whats_new_every_change)) }
        })
}

/** The Settings row that opens this version's notes again; hidden when the build has none. */
@Composable internal fun WhatsNewSettingsRow() {
    val context = LocalContext.current
    val version = remember { appVersion(context) }
    val available by produceState(false, version) { value = withContext(Dispatchers.IO) { loadReleaseNotes(context, version, false) != null } }
    if (!available) return
    Surface(onClick = { WhatsNewState.requested = true }, shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth().testTag("settings_whats_new")) {
        Row(Modifier.heightIn(min = 60.dp).padding(horizontal = 16.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            WorldsGlyph(R.drawable.ic_sparkles, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.whats_new_title), color = MaterialTheme.colorScheme.onSurface)
                Text(stringResource(R.string.whats_new_hint, version), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
