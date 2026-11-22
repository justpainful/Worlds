package worlds.android

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.identity.*
import java.text.DateFormat
import java.util.Date

internal const val SUPPORT_SITE = "https://support.enterworlds.space"

/**
 * Help and feedback, messages from the Worlds team, a copy of one's data and
 * deleting the account (docs/admin/PLAN.md, phase 9), from Account.
 */
internal interface HelpGateway {
    fun suggest(title: String, body: String): Int
    fun report(subject: String, body: String, fields: Map<String, String>): String
    fun messages(): List<TeamThread>
    fun reply(thread: String, body: String)
    fun export(): String
    fun deletionDueAt(): Long?
    fun sendDeletionCode(): EmailChallenge
    fun delete(challengeId: String, code: String): Long
    fun cancelDeletion()
}

private class DeviceHelpGateway(private val identity: String, private val app: android.content.Context, private val sync: AccountSyncRuntime) : HelpGateway {
    private fun service() = IdentityService(identity, EncryptedSessionStore(app), networkAvailable = { networkAvailable(app) })
    private fun <T> guarded(action: () -> T): T = try { action() } catch (e: Exception) {
        if (e is ReauthenticationRequired || e is RefreshUncertain || (e is IdentityApiException && e.status == 401)) sync.accountChange { }
        throw e
    }
    override fun suggest(title: String, body: String) = guarded { service().suggestIdea(title, body) }
    override fun report(subject: String, body: String, fields: Map<String, String>) = guarded { service().reportProblem(subject, body, fields) }
    override fun messages() = guarded { service().teamMessages() }
    override fun reply(thread: String, body: String) = guarded { service().replyToTeam(thread, body) }
    override fun export() = guarded { service().exportAccount().toString(2) }
    override fun deletionDueAt() = guarded { service().deletionDueAt() }
    override fun sendDeletionCode() = guarded { val client = service(); client.startEmail(client.accountEmail()) }
    override fun delete(challengeId: String, code: String): Long {
        val due = guarded { service().scheduleDeletion(challengeId, code) }
        // The service signed every device out; this one forgets its session too.
        sync.accountChange { service().forget() }
        return due
    }
    override fun cancelDeletion() = guarded { service().cancelDeletion() }
}

private enum class HelpDialog { IDEA, PROBLEM, DELETE }

@Composable internal fun HelpScreen(identity: String, onBack: () -> Unit, onSignedOut: () -> Unit, gatewayOverride: HelpGateway? = null) {
    val context = LocalContext.current
    val app = context.applicationContext
    val gateway = remember(identity, gatewayOverride) { gatewayOverride ?: DeviceHelpGateway(identity, app, WorldsAccountSync.get(app)) }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<HelpDialog?>(null) }
    var threads by remember { mutableStateOf<List<TeamThread>?>(null) }
    var dueAt by remember { mutableStateOf<Long?>(null) }
    val errorText = stringResource(R.string.help_error)

    fun perform(action: suspend () -> String?) {
        if (busy) return
        busy = true; message = null; failed = false
        scope.launch {
            runCatching { action() }.fold({ message = it }, { e ->
                failed = true
                message = if (e is IdentityApiException && e.code == "owns_shared_workspaces") context.getString(R.string.help_delete_shared) else errorText
            })
            busy = false
        }
    }
    fun open(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }

    LaunchedEffect(gateway) {
        dueAt = runCatching { withContext(Dispatchers.IO) { gateway.deletionDueAt() } }.getOrNull()
        threads = runCatching { withContext(Dispatchers.IO) { gateway.messages() } }.getOrNull()
    }

    val saveData = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) perform {
            val json = withContext(Dispatchers.IO) { gateway.export() }
            withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(json.toByteArray()) } ?: error("no stream") }
            context.getString(R.string.help_data_saved)
        }
    }

    BackHandler(enabled = !busy && dialog == null) { onBack() }
    when (dialog) {
        HelpDialog.IDEA -> TextDialog(stringResource(R.string.help_idea), stringResource(R.string.help_idea_title), stringResource(R.string.help_idea_body), false, onDismiss = { dialog = null }) { title, body, _ ->
            dialog = null
            perform { val n = withContext(Dispatchers.IO) { gateway.suggest(title, body) }; context.getString(R.string.help_idea_sent, n) }
        }
        HelpDialog.PROBLEM -> TextDialog(stringResource(R.string.help_problem), stringResource(R.string.help_problem_title), stringResource(R.string.help_problem_body), true, onDismiss = { dialog = null }) { title, body, details ->
            dialog = null
            val fields = buildMap {
                put("platform", "android"); put("version", runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "")
                if (details) { put("system", "Android ${Build.VERSION.RELEASE} (${Build.MODEL})"); put("language", java.util.Locale.getDefault().toLanguageTag()) }
            }
            perform { val ref = withContext(Dispatchers.IO) { gateway.report(title, body, fields) }; context.getString(R.string.help_problem_sent, ref) }
        }
        HelpDialog.DELETE -> DeleteDialog(gateway, onDismiss = { dialog = null }, onDeleted = { due ->
            dialog = null
            android.widget.Toast.makeText(context, context.getString(R.string.help_delete_done, DateFormat.getDateInstance().format(Date(due))), android.widget.Toast.LENGTH_LONG).show()
            onSignedOut()
        })
        null -> Unit
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(Modifier.fillMaxHeight().widthIn(max = 640.dp).fillMaxWidth().windowInsetsPadding(WindowInsets.safeDrawing).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 24.dp)) {
        WorldsBackButton(onBack, enabled = !busy)
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.help_title), style = MaterialTheme.typography.headlineLarge)
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.help_note), color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 26.sp)
        Spacer(Modifier.height(16.dp))

        dueAt?.let { due ->
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Text(stringResource(R.string.help_delete_pending, DateFormat.getDateInstance().format(Date(due))), color = MaterialTheme.colorScheme.onErrorContainer, lineHeight = 24.sp)
                    TextButton(enabled = !busy, onClick = { perform { withContext(Dispatchers.IO) { gateway.cancelDeletion() }; dueAt = null; context.getString(R.string.help_delete_cancelled) } }) {
                        Text(stringResource(R.string.help_delete_cancel))
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        TextButton(enabled = !busy, onClick = { dialog = HelpDialog.IDEA }, modifier = Modifier.testTag("help_idea")) { WorldsActionLabel(R.drawable.ic_lightbulb, stringResource(R.string.help_idea)) }
        TextButton(enabled = !busy, onClick = { dialog = HelpDialog.PROBLEM }, modifier = Modifier.testTag("help_problem")) { WorldsActionLabel(R.drawable.ic_message_circle, stringResource(R.string.help_problem)) }
        TextButton(onClick = { open(SUPPORT_SITE) }) { WorldsActionLabel(R.drawable.ic_arrow_up_right, stringResource(R.string.help_center)) }
        TextButton(onClick = { open("$SUPPORT_SITE/roadmap") }) { WorldsActionLabel(R.drawable.ic_arrow_up_right, stringResource(R.string.help_roadmap)) }

        Spacer(Modifier.height(16.dp)); HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant); Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.help_messages), style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        val list = threads
        if (list == null) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        else if (list.isEmpty()) Text(stringResource(R.string.help_messages_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 26.sp)
        else list.forEach { thread ->
            var draft by remember(thread.id) { mutableStateOf("") }
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(thread.subject, style = MaterialTheme.typography.titleSmall)
                    thread.messages.forEach { m ->
                        Text((if (m.author == "team") stringResource(R.string.help_team) else stringResource(R.string.help_you)) + ": " + m.body, lineHeight = 24.sp,
                            color = if (m.author == "team") MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (thread.status != "closed") {
                        OutlinedTextField(value = draft, onValueChange = { draft = it.take(4000) }, label = { Text(stringResource(R.string.help_reply)) }, enabled = !busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp))
                        TextButton(enabled = !busy && draft.isNotBlank(), onClick = {
                            val text = draft
                            perform { val fresh = withContext(Dispatchers.IO) { gateway.reply(thread.id, text); gateway.messages() }; threads = fresh; draft = ""; null }
                        }) { WorldsActionLabel(R.drawable.ic_send_horizontal, stringResource(R.string.help_send)) }
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp)); HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant); Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.help_data), style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.help_data_note), color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 26.sp)
        TextButton(enabled = !busy, onClick = { saveData.launch("worlds-account-${java.time.LocalDate.now()}.json") }) { WorldsActionLabel(R.drawable.ic_download, stringResource(R.string.help_data_download)) }
        TextButton(enabled = !busy && dueAt == null, onClick = { dialog = HelpDialog.DELETE }, modifier = Modifier.testTag("help_delete")) {
            WorldsActionLabel(R.drawable.ic_trash_2, stringResource(R.string.help_delete))
        }

        if (busy) { Spacer(Modifier.height(16.dp)); CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) }
        message?.let { Spacer(Modifier.height(16.dp)); Text(it, color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface, lineHeight = 26.sp) }
    }
    }
    }
}

@Composable private fun TextDialog(title: String, firstLabel: String, secondLabel: String, withDetails: Boolean, onDismiss: () -> Unit, onSend: (String, String, Boolean) -> Unit) {
    var first by remember { mutableStateOf("") }
    var second by remember { mutableStateOf("") }
    var details by remember { mutableStateOf(true) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(value = first, onValueChange = { first = it.take(140) }, label = { Text(firstLabel) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = second, onValueChange = { second = it.take(4000) }, label = { Text(secondLabel) }, minLines = 3, modifier = Modifier.fillMaxWidth())
                if (withDetails) Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = details, onCheckedChange = { details = it })
                    Text(stringResource(R.string.help_problem_details), style = MaterialTheme.typography.bodySmall, lineHeight = 20.sp)
                }
            }
        },
        confirmButton = { TextButton(enabled = first.isNotBlank() && (!withDetails || second.isNotBlank()), onClick = { onSend(first, second, details) }) { Text(stringResource(R.string.help_send)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable private fun DeleteDialog(gateway: HelpGateway, onDismiss: () -> Unit, onDeleted: (Long) -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var challenge by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun attempt(action: suspend () -> Unit) {
        busy = true; error = null
        scope.launch {
            runCatching { action() }.onFailure { e ->
                error = context.getString(when {
                    e is IdentityApiException && e.code == "owns_shared_workspaces" -> R.string.help_delete_shared
                    e is IdentityApiException && e.status == 400 -> R.string.account_invalid_code
                    else -> R.string.help_error
                })
            }
            busy = false
        }
    }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(stringResource(R.string.help_delete_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(if (challenge == null) R.string.help_delete_explain else R.string.help_delete_code), lineHeight = 24.sp)
                if (challenge != null) OutlinedTextField(value = code, onValueChange = { v -> code = v.filter(Char::isDigit).take(6) }, label = { Text(stringResource(R.string.account_code)) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), textStyle = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr), modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            if (challenge == null) TextButton(enabled = !busy, onClick = { attempt { challenge = withContext(Dispatchers.IO) { gateway.sendDeletionCode() }.id } }) { Text(stringResource(R.string.help_delete_send_code)) }
            else TextButton(enabled = !busy && code.length == 6, onClick = { attempt { val due = withContext(Dispatchers.IO) { gateway.delete(challenge!!, code) }; onDeleted(due) } }) {
                Text(stringResource(R.string.help_delete_confirm), color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}
