package worlds.android

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.io.IOException

private val Context.appearanceDataStore by preferencesDataStore(name = "worlds_appearance")
internal data class AppearancePreferences(val theme: String = "system", val accent: String = "sand", val direction: String = "auto", val suggestions: Boolean = true)
internal data class AppearanceAccent(val id: String, val label: Int, val dark: Color, val light: Color)
internal val appearanceAccents = listOf(
    AppearanceAccent("sand", R.string.appearance_sand, Color(0xffd2a46e), Color(0xff765127)),
    AppearanceAccent("sage", R.string.appearance_sage, Color(0xff8db39a), Color(0xff38624b)),
    AppearanceAccent("sky", R.string.appearance_sky, Color(0xff7fa7d9), Color(0xff345e8e)),
    AppearanceAccent("rose", R.string.appearance_rose, Color(0xffd98c9a), Color(0xff8a3d50)),
    AppearanceAccent("copper", R.string.appearance_copper, Color(0xffd08560), Color(0xff8a452b)),
    AppearanceAccent("graphite", R.string.appearance_graphite, Color(0xffa1a1aa), Color(0xff575760)),
)

internal class AppearanceStore(private val dataStore: DataStore<Preferences>) {
    constructor(context: Context) : this(context.applicationContext.appearanceDataStore)
    private val theme = stringPreferencesKey("theme")
    private val accent = stringPreferencesKey("accent")
    private val direction = stringPreferencesKey("editor_direction")
    private val suggestions = booleanPreferencesKey("editor_suggestions")
    val values = dataStore.data.catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }.map { preferences ->
        AppearancePreferences(preferences[theme]?.takeIf { it in setOf("system", "light", "dark") } ?: "system",
            preferences[accent]?.takeIf { id -> appearanceAccents.any { it.id == id } } ?: "sand",
            preferences[direction]?.takeIf { it in setOf("auto", "ltr", "rtl") } ?: "auto", preferences[suggestions] ?: true)
    }
    suspend fun setTheme(value: String) { require(value in setOf("system", "light", "dark")); dataStore.edit { it[theme] = value } }
    suspend fun setAccent(value: String) { require(appearanceAccents.any { it.id == value }); dataStore.edit { it[accent] = value } }
    suspend fun setDirection(value: String) { require(value in setOf("auto", "ltr", "rtl")); dataStore.edit { it[direction] = value } }
    suspend fun setSuggestions(value: Boolean) { dataStore.edit { it[suggestions] = value } }
}

internal val LocalAppearanceStore = staticCompositionLocalOf<AppearanceStore> { error("AppearanceStore unavailable") }
internal val LocalAppearancePreferences = staticCompositionLocalOf { AppearancePreferences() }

@Composable internal fun AppearanceSettings(onBack: () -> Unit) {
    val store = LocalAppearanceStore.current
    val settings = LocalAppearancePreferences.current
    val scope = rememberCoroutineScope()
    var failed by remember { mutableStateOf(false) }
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            WorldsGlyph(R.drawable.ic_settings_2, tint = MaterialTheme.colorScheme.primary)
            Text(stringResource(R.string.appearance_title), color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.headlineMedium)
        }
        Text(stringResource(R.string.appearance_local_note), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        if (failed) Text(stringResource(R.string.appearance_save_error), color = MaterialTheme.colorScheme.error)
        Text(stringResource(R.string.appearance_theme), color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.titleSmall)
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth()) {
            Column(Modifier.selectableGroup()) {
                listOf("system" to R.string.appearance_system, "light" to R.string.appearance_light, "dark" to R.string.appearance_dark).forEach { (id, label) ->
                    AppearanceChoice(stringResource(label), settings.theme == id, null) { scope.launch { failed = runCatching { store.setTheme(id) }.isFailure } }
                }
            }
        }
        Text(stringResource(R.string.appearance_accent), color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.titleSmall)
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth()) {
            Column(Modifier.selectableGroup()) {
                appearanceAccents.forEach { accent ->
                    AppearanceChoice(stringResource(accent.label), settings.accent == accent.id, accent.dark) { scope.launch { failed = runCatching { store.setAccent(accent.id) }.isFailure } }
                }
            }
        }
        Text(stringResource(R.string.editor_settings_title), color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.titleSmall)
        Text(stringResource(R.string.editor_direction_hint), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth()) {
            Column(Modifier.selectableGroup()) {
                listOf("auto" to R.string.editor_direction_auto, "ltr" to R.string.editor_direction_ltr, "rtl" to R.string.editor_direction_rtl).forEach { (id, label) ->
                    AppearanceChoice(stringResource(label), settings.direction == id, null) { scope.launch { failed = runCatching { store.setDirection(id) }.isFailure } }
                }
            }
        }
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().toggleable(value = settings.suggestions, role = Role.Switch, onValueChange = { value -> scope.launch { failed = runCatching { store.setSuggestions(value) }.isFailure } }).heightIn(min = 60.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.editor_suggestions), color = MaterialTheme.colorScheme.onSurface)
                    Text(stringResource(R.string.editor_suggestions_hint), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.width(12.dp)); Switch(checked = settings.suggestions, onCheckedChange = null)
            }
        }
    }
}

@Composable private fun AppearanceChoice(label: String, selected: Boolean, swatch: Color?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().selectable(selected = selected, role = Role.RadioButton, onClick = onClick).heightIn(min = 52.dp).padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (swatch != null) { Box(Modifier.size(24.dp).background(swatch, CircleShape)); Spacer(Modifier.width(12.dp)) }
        Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface)
        RadioButton(selected = selected, onClick = null)
    }
}
