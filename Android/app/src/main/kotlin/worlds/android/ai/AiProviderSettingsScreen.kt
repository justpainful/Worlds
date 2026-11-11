package worlds.android.ai

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.android.OutlinedTextField
import worlds.android.R
import worlds.android.WorldsActionButton
import worlds.android.WorldsActionLabel
import worlds.android.WorldsBackButton
import worlds.android.WorldsGlyph
import worlds.android.WorldsTile

private data class ProviderRowState(val preset: AiProviderPreset, val configured: Boolean, val hasKey: Boolean, val model: String, val isDefault: Boolean)

/** Choose a provider, add its key, load its models and pick one. */
@Composable
internal fun AiProviderSettingsScreen(onBack: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val store = remember { AiProviderStore(context) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var version by remember { mutableIntStateOf(0) }
    var rows by remember { mutableStateOf<List<ProviderRowState>>(emptyList()) }

    LaunchedEffect(version) {
        rows = withContext(Dispatchers.IO) {
            val default = store.defaultProviderId
            AI_PROVIDER_PRESETS.map { ProviderRowState(it, store.isConfigured(it.id), store.hasKey(it.id), store.settings(it.id).model, it.id == default) }
        }
    }

    val current = editing?.let { aiPreset(it) }
    if (current != null) {
        ProviderDetail(current, store, onBack = { editing = null; version++ }, modifier = modifier)
        return
    }

    BackHandler(onBack = onBack)
    LazyColumn(
        modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.safeDrawing),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { WorldsBackButton(onBack) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                WorldsTile(R.drawable.pi_sparkles, 44.dp)
                Text(stringResource(R.string.ai_providers_title), color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.headlineMedium)
            }
        }
        item {
            Text(
                stringResource(R.string.ai_providers_intro),
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium
            )
        }
        val hosted = rows.filter { it.preset.requiresKey }
        val local = rows.filter { !it.preset.requiresKey }
        item { Text(stringResource(R.string.ai_hosted), color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.titleSmall) }
        item { ProviderGroup(hosted) { editing = it } }
        item { Text(stringResource(R.string.ai_local_section), color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.titleSmall) }
        item { ProviderGroup(local) { editing = it } }
    }
}

@Composable
private fun ProviderGroup(rows: List<ProviderRowState>, onOpen: (String) -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth()) {
        Column {
            rows.forEachIndexed { index, row ->
                if (index > 0) HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
                val status = when {
                    row.isDefault && row.model.isNotBlank() -> stringResource(R.string.ai_status_in_use, row.model)
                    row.configured && row.model.isNotBlank() -> row.model
                    row.configured -> stringResource(R.string.ai_status_ready)
                    row.preset.requiresKey -> stringResource(R.string.ai_status_needs_key)
                    else -> stringResource(R.string.ai_status_needs_address)
                }
                Row(
                    Modifier.fillMaxWidth().selectable(selected = row.isDefault, role = Role.Button, onClick = { onOpen(row.preset.id) }).heightIn(min = 60.dp).padding(start = 16.dp, end = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                        Text(row.preset.label(), color = MaterialTheme.colorScheme.onSurface)
                        Text(status, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (row.isDefault) { WorldsGlyph(R.drawable.ic_check, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(8.dp)) }
                    WorldsGlyph(R.drawable.ic_chevron_right, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun ProviderDetail(preset: AiProviderPreset, store: AiProviderStore, onBack: () -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val providerName = preset.label()
    var baseUrl by rememberSaveable(preset.id) { mutableStateOf("") }
    var keyDraft by remember(preset.id) { mutableStateOf("") }
    var hasKey by remember(preset.id) { mutableStateOf(false) }
    var model by remember(preset.id) { mutableStateOf("") }
    var models by remember(preset.id) { mutableStateOf<List<AiModelOption>>(emptyList()) }
    var filter by remember(preset.id) { mutableStateOf("") }
    var manualModel by remember(preset.id) { mutableStateOf("") }
    var loading by remember(preset.id) { mutableStateOf(false) }
    var error by remember(preset.id) { mutableStateOf<String?>(null) }
    var note by remember(preset.id) { mutableStateOf<String?>(null) }
    var loaded by remember(preset.id) { mutableStateOf(false) }

    LaunchedEffect(preset.id) {
        val saved = withContext(Dispatchers.IO) { store.settings(preset.id) to store.hasKey(preset.id) }
        if (baseUrl.isEmpty()) baseUrl = saved.first.baseUrl
        model = saved.first.model; models = saved.first.models; hasKey = saved.second; loaded = true
    }

    fun persist(chosen: String = model, list: List<AiModelOption> = models) {
        val url = baseUrl.trim()
        val typedKey = keyDraft.trim()
        if (typedKey.isNotEmpty()) { hasKey = true; keyDraft = "" }
        scope.launch(Dispatchers.IO) {
            store.save(preset.id, AiProviderSettings(url, chosen, list))
            if (typedKey.isNotEmpty()) store.saveKey(preset.id, typedKey)
        }
    }

    fun loadModels() {
        error = null; note = null
        if (!AiRequests.isValidBase(baseUrl)) { error = AiError.BadUrl(preset.displayName).localized(context); return }
        if (preset.requiresKey && keyDraft.isBlank() && !hasKey) { error = AiError.NoKey(preset.displayName).localized(context); return }
        loading = true
        val url = baseUrl.trim()
        val typedKey = keyDraft.trim()
        scope.launch {
            try {
                val list = withContext(Dispatchers.IO) {
                    if (typedKey.isNotEmpty()) store.saveKey(preset.id, typedKey)
                    store.save(preset.id, AiProviderSettings(url, model, models))
                    val provider = store.provider(preset.id) ?: throw AiError.NoProvider()
                    AiClient(provider).listModels()
                }
                if (typedKey.isNotEmpty()) { hasKey = true; keyDraft = "" }
                models = list
                if (model.isNotBlank() && list.none { it.id == model }) model = ""
                withContext(Dispatchers.IO) { store.save(preset.id, AiProviderSettings(url, model, list)) }
                note = if (list.isEmpty()) context.getString(R.string.ai_models_none, providerName) else context.getString(R.string.ai_models_count, list.size)
            } catch (e: AiError) {
                error = e.localized(context)
            } catch (e: Exception) {
                error = context.getString(R.string.ai_models_load_failed, providerName)
            } finally {
                loading = false
            }
        }
    }

    fun choose(id: String) {
        model = id
        persist(chosen = id)
        scope.launch(Dispatchers.IO) { store.defaultProviderId = preset.id }
        note = context.getString(R.string.ai_model_now_default, providerName, id)
    }

    BackHandler(onBack = onBack)
    val visible = if (filter.isBlank()) models else models.filter { it.id.contains(filter.trim(), ignoreCase = true) || it.name.contains(filter.trim(), ignoreCase = true) }
    LazyColumn(
        modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.safeDrawing),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { WorldsBackButton(onBack) }
        item { Text(providerName, color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.headlineMedium) }
        item {
            val kind = stringResource(if (preset.kind == AiProviderKind.Anthropic) R.string.ai_kind_anthropic else R.string.ai_kind_openai)
            Text(stringResource(R.string.ai_provider_summary, kind, preset.hint()), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        }
        if (!loaded) { item { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) }; return@LazyColumn }
        item {
            OutlinedTextField(
                value = baseUrl, onValueChange = { baseUrl = it; error = null },
                label = { Text(stringResource(R.string.ai_base_url)) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth()
            )
        }
        if (!preset.requiresKey) {
            item {
                Text(
                    stringResource(R.string.ai_localhost_note),
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall
                )
            }
        }
        item {
            OutlinedTextField(
                value = keyDraft, onValueChange = { keyDraft = it; error = null },
                label = { Text(stringResource(if (preset.requiresKey) R.string.ai_api_key else R.string.ai_api_key_optional)) },
                placeholder = { Text(stringResource(if (hasKey) R.string.ai_key_saved_placeholder else R.string.ai_paste_key)) },
                singleLine = true, visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth()
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { loadModels() }, enabled = !loading) { WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.ai_load_models)) }
                if (hasKey) {
                    WorldsActionButton(onClick = {
                        hasKey = false; keyDraft = ""
                        scope.launch(Dispatchers.IO) { store.saveKey(preset.id, null) }
                        note = context.getString(R.string.ai_key_removed)
                    }) { WorldsActionLabel(R.drawable.ic_trash_2, stringResource(R.string.ai_remove_key)) }
                }
                if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            }
        }
        error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) } }
        note?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium) } }
        if (models.isNotEmpty()) {
            item { Text(stringResource(R.string.ai_model), color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.titleSmall) }
            if (models.size > 12) {
                item {
                    OutlinedTextField(
                        value = filter, onValueChange = { filter = it }, singleLine = true,
                        placeholder = { Text(stringResource(R.string.ai_filter_models, models.size)) },
                        leadingIcon = { WorldsGlyph(R.drawable.ic_search) },
                        modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth()
                    )
                }
            }
            item {
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.widthIn(max = 600.dp).fillMaxWidth()) {
                    Column(Modifier.selectableGroup()) {
                        visible.take(200).forEachIndexed { index, option ->
                            if (index > 0) HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
                            Row(
                                Modifier.fillMaxWidth().selectable(selected = option.id == model, role = Role.RadioButton, onClick = { choose(option.id) }).heightIn(min = 52.dp).padding(start = 16.dp, end = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                                    Text(option.name, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (option.name != option.id) Text(option.id, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) { if (option.id == model) WorldsGlyph(R.drawable.ic_check, tint = MaterialTheme.colorScheme.primary) }
                            }
                        }
                        if (visible.isEmpty()) Text(stringResource(R.string.ai_no_model_matches), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        item { Text(stringResource(R.string.ai_model_id), color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.titleSmall) }
        item {
            Text(
                if (model.isBlank()) stringResource(R.string.ai_no_model_chosen) else stringResource(R.string.ai_in_use_model, model),
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall
            )
        }
        item {
            Row(Modifier.widthIn(max = 600.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = manualModel, onValueChange = { manualModel = it }, singleLine = true,
                    placeholder = { Text(stringResource(R.string.ai_type_model_id)) },
                    keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                    modifier = Modifier.weight(1f)
                )
                WorldsActionButton(onClick = {
                    val id = manualModel.trim()
                    if (id.isNotEmpty()) { choose(id); manualModel = "" }
                }, enabled = manualModel.isNotBlank()) { Text(stringResource(R.string.ai_use)) }
            }
        }
    }
}
