package worlds.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import worlds.android.planning.PackCatalog
import worlds.android.planning.currentLocale
import worlds.android.planning.packValue
import worlds.sync.YrsNative

/**
 * A shared pack item's fields on the phone (docs/PACKS.md, Design 1): read
 * from the page's synced document, where the desktop keeps them in a `fields`
 * map with the item's kind in `meta`, and labelled from the shipped
 * definitions. Changing them from the phone is the next step.
 */
@Composable internal fun SharedPackFields(snapshot: ByteArray) {
    val context = LocalContext.current
    val arabic = currentLocale().language == "ar"
    val shown = remember(snapshot) {
        runCatching {
            val root = JSONObject(YrsNative.fieldsJson(snapshot))
            val kind = root.optString("kind").takeIf { it.isNotBlank() } ?: return@runCatching null
            val fields = root.optJSONObject("fields") ?: return@runCatching null
            val (pack, def) = PackCatalog.load(context).kindOf(kind) ?: return@runCatching null
            Triple(pack, def, fields)
        }.getOrNull()
    } ?: return
    val (pack, kind, data) = shown
    val rows = kind.fields.mapNotNull { f -> packValue(f, data, arabic) { "" }.ifBlank { null }?.let { f.label.text(arabic) to it } }
    if (rows.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(bottom = 12.dp).testTag("shared_pack_fields"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("${kind.label.text(arabic)} · ${pack.label.text(arabic)}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        WorldsCard(Modifier.fillMaxWidth()) {
            rows.forEachIndexed { index, (label, value) ->
                Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp)) {
                    Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(value, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
                }
                if (index < rows.lastIndex) HorizontalDivider(Modifier.padding(start = 14.dp), color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}
