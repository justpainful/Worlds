package worlds.android.planning

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import worlds.android.AlertDialog
import worlds.android.R

/*
 * Messages to people outside Worlds about a pack item (docs/PACKS.md), as on
 * desktop (src/packs/messages.ts): a note to a parent about an absence, a
 * payment reminder. Worlds fills it in and opens it in the person's own
 * WhatsApp or mail app, where they send it themselves.
 */

internal data class MessageDraft(val channel: String, val to: String, val name: String, val text: String)

internal object PackMessages {
    /** Digits with the country code, as WhatsApp wants them; a local Saudi mobile gets 966. "" when not a number. */
    fun whatsappNumber(raw: String): String {
        val western = raw.map { c -> if (c in '\u0660'..'\u0669' || c in '\u06F0'..'\u06F9') ('0' + (c.code and 0xf) % 10) else c }.joinToString("")
        var digits = western.filter { it.isDigit() && it.code < 128 }
        if (digits.startsWith("00")) digits = digits.drop(2)
        if (Regex("^05\\d{8}$").matches(digits)) digits = "966" + digits.drop(1)
        return if (digits.length in 8..15) digits else ""
    }

    fun url(d: MessageDraft, subject: String = ""): String =
        if (d.channel == "whatsapp") "https://wa.me/${d.to}?text=${Uri.encode(d.text)}"
        else "mailto:${d.to}?" + listOfNotNull(subject.takeIf { it.isNotBlank() }?.let { "subject=${Uri.encode(it)}" }, "body=${Uri.encode(d.text)}").joinToString("&")

    fun offered(m: PackMessage, data: JSONObject, today: String): Boolean = m.conditions.all { PackRules.matches(it, data, today) }

    /** The message filled in for one item, or null when there is no one to send it to. */
    fun draft(m: PackMessage, pack: PackDef, kind: PackKind, title: String, data: JSONObject, rowOf: (String) -> PlanRow?, arabic: Boolean): MessageDraft? {
        val titleOf = { id: String -> rowOf(id)?.title.orEmpty() }
        val viaField = m.via?.let { v -> kind.fields.firstOrNull { it.id == v } }
        val viaRow = viaField?.let { data.optString(it.id).takeIf { s -> s.isNotBlank() } }?.let(rowOf)
        val viaKind = viaField?.to?.let { pack.kind(it) }
        if (m.via != null && (viaRow == null || viaKind == null)) return null
        val targetKind = viaKind ?: kind
        val targetData = viaRow?.data ?: data
        var channel: String? = null
        var to = ""
        for (id in m.fields) {
            val f = targetKind.fields.firstOrNull { it.id == id } ?: continue
            val v = targetData.optString(id).trim()
            if (v.isEmpty() || targetData.isNull(id)) continue
            if (f.type == "phone") { to = whatsappNumber(v); if (to.isNotEmpty()) channel = "whatsapp" }
            else if (f.type == "email" && Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(v)) { to = v; channel = "email" }
            if (channel != null) break
        }
        if (channel == null) return null
        fun show(k: PackKind, d: JSONObject, id: String) = k.fields.firstOrNull { it.id == id }?.let { packValue(it, d, arabic, titleOf) }.orEmpty()
        val text = Regex("\\{([a-zA-Z]+)(?:\\.([a-zA-Z]+))?\\}").replace(m.text.text(arabic)) { r ->
            val a = r.groupValues[1]
            val b = r.groupValues[2]
            when {
                a == "title" && b.isEmpty() -> title
                m.via != null && a == m.via -> if (b.isEmpty()) viaRow?.title.orEmpty() else show(viaKind!!, viaRow!!.data, b)
                b.isEmpty() && kind.fields.any { it.id == a } -> show(kind, data, a)
                else -> r.value
            }
        }
        val name = m.name?.let { targetData.optString(it) }.orEmpty()
        return MessageDraft(channel, to, name, text)
    }
}

/** Shows the filled message, opens it in WhatsApp or mail, then records that it was sent. */
@Composable internal fun PackMessageDialog(m: PackMessage, draft: MessageDraft?, subject: String, arabic: Boolean, onSent: (JSONObject) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    var text by remember(draft) { mutableStateOf(draft?.text.orEmpty()) }
    var opened by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val email = draft?.channel == "email"
    AlertDialog(onDismissRequest = onClose,
        title = { Text(m.label.text(arabic)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (draft == null) Text(stringResource(R.string.packs_message_nobody), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else {
                    Text(listOf(draft.name, if (email) draft.to else "+${draft.to}").filter { it.isNotBlank() }.joinToString("  "), style = MaterialTheme.typography.labelLarge)
                    PlanTextField(text, { text = it }, stringResource(R.string.packs_message_text), multiline = true)
                    Text(stringResource(if (email) R.string.packs_message_note_mail else R.string.packs_message_note_whatsapp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (failed) Text(stringResource(R.string.packs_message_no_app), color = MaterialTheme.colorScheme.error)
                }
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.cancel)) } },
        confirmButton = {
            if (draft != null) {
                if (opened && m.done != null) TextButton(onClick = { onSent(m.done); onClose() }) { Text(stringResource(R.string.packs_message_sent)) }
                else TextButton(enabled = text.isNotBlank(), onClick = {
                    try {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PackMessages.url(draft.copy(text = text), subject))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        opened = true; failed = false
                    } catch (_: ActivityNotFoundException) { failed = true }
                }) { Text(stringResource(if (email) R.string.packs_message_open_mail else R.string.packs_message_open_whatsapp)) }
            }
        })
}
