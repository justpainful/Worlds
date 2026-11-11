package worlds.android.planning

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import worlds.android.OutlinedTextField
import worlds.android.R
import worlds.android.WorldsBackButton
import worlds.android.WorldsCard
import worlds.android.WorldsGlyph
import worlds.android.WorldsTile
import java.time.DayOfWeek
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale

/* Pieces shared by Tasks, Calendar and Study, after the desktop's src/planning/ui.tsx. */

@Composable internal fun currentLocale(): Locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()

/** "Today", "Tomorrow", "Yesterday", a weekday within the week, or a short date. */
@Composable internal fun dayName(date: String, now: String): String {
    val locale = currentLocale()
    return when (val label = dayLabel(date, now)) {
        DayLabel.Today -> stringResource(R.string.plan_today)
        DayLabel.Tomorrow -> stringResource(R.string.plan_tomorrow)
        DayLabel.Yesterday -> stringResource(R.string.plan_yesterday)
        is DayLabel.Weekday -> weekdayName(label.day, TextStyle.FULL, locale)
        is DayLabel.Date -> shortDate(label.date, label.withYear, locale)
    }
}

internal fun weekdayName(day: Int, style: TextStyle, locale: Locale): String = DayOfWeek.of(if (day == 0) 7 else day).getDisplayName(style, locale)

internal fun shortDate(date: String, withYear: Boolean, locale: Locale): String =
    DateTimeFormatter.ofPattern(if (withYear) "d MMM yyyy" else "d MMM", locale).format(PlanDates.parse(date))

/** "HH:MM" in the reader's own clock style. */
@Composable internal fun clockName(time: String): String {
    val parts = time.split(":")
    val t = LocalTime.of((parts.getOrNull(0)?.toIntOrNull() ?: 0).coerceIn(0, 23), (parts.getOrNull(1)?.toIntOrNull() ?: 0).coerceIn(0, 59))
    return DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(currentLocale()).format(t)
}

@Composable internal fun dueText(due: String, time: String?, now: String): String {
    val day = dayName(due, now)
    return if (time != null) stringResource(R.string.plan_day_time, day, clockName(time)) else day
}

internal fun subjectColor(name: String?): Color? = subjectColorRgb(name)?.let { Color(0xFF000000 or it.toLong()) }

@Composable internal fun priorityColor(priority: Int): Color? = when (priority) {
    3 -> subjectColor("red")
    2 -> subjectColor("yellow")
    1 -> subjectColor("blue")
    else -> null
}

@Composable internal fun priorityName(priority: Int): String = stringResource(when (priority) {
    3 -> R.string.plan_priority_high
    2 -> R.string.plan_priority_medium
    1 -> R.string.plan_priority_low
    else -> R.string.plan_priority_none
})

/** A pushed planning screen: back, a large title with its tile, then scrolling content at a readable width. */
@Composable internal fun PlanScaffold(
    tile: Int, title: String, subtitle: String?, onBack: () -> Unit,
    trailing: (@Composable () -> Unit)? = null,
    content: LazyListScope.() -> Unit,
) {
    BackHandler(onBack = onBack)
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).windowInsetsPadding(WindowInsets.safeDrawing), contentAlignment = Alignment.TopCenter) {
        LazyColumn(Modifier.widthIn(max = 760.dp).fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 48.dp)) {
            item(key = "plan-top") {
                Row(Modifier.fillMaxWidth().padding(bottom = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    WorldsBackButton(onBack)
                    if (trailing != null) trailing()
                }
            }
            item(key = "plan-title") {
                Row(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    WorldsTile(tile, 44.dp)
                    Column(Modifier.weight(1f)) {
                        Text(title, modifier = Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onBackground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            content()
        }
    }
}

/** Load and save problems, shown above the content. */
internal fun LazyListScope.planStatus(repo: PlanningRepository) {
    if (repo.writeFailed) item(key = "plan-write-error") {
        Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.plan_save_error), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = repo::dismissError) { Text(stringResource(R.string.close)) }
        }
    }
    if (repo.loadFailed) item(key = "plan-load-error") {
        Column(Modifier.padding(bottom = 12.dp)) {
            Text(stringResource(R.string.plan_load_error), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = repo::load) { Text(stringResource(R.string.retry)) }
        }
    } else if (repo.loading) item(key = "plan-loading") { CircularProgressIndicator(Modifier.padding(16.dp)) }
}

/** Choices as capsules, like the Library filters. */
@Composable internal fun <T> PlanPills(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { (value, label) ->
            val active = value == selected
            Text(label, modifier = Modifier.clip(CircleShape).background(if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)
                .toggleable(value = active, role = Role.Tab, onValueChange = { onSelect(value) }).padding(horizontal = 14.dp, vertical = 9.dp),
                style = MaterialTheme.typography.labelLarge, color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, maxLines = 1)
        }
    }
}

@Composable internal fun PlanGroupTitle(title: String, count: Int? = null, color: Color = MaterialTheme.colorScheme.onBackground, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp).semantics(mergeDescendants = true) { heading() }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        if (count != null) Text(count.toString(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable internal fun PlanEmpty(tile: Int, title: String, body: String, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(vertical = 26.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        WorldsTile(tile, 64.dp)
        Text(title, modifier = Modifier.padding(top = 6.dp), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground, textAlign = TextAlign.Center)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (action != null) Box(Modifier.padding(top = 8.dp)) { action() }
    }
}

@Composable internal fun PlanHint(text: String) {
    Text(text, modifier = Modifier.padding(bottom = 10.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** A round check, coloured by subject or priority. */
@Composable internal fun PlanCheck(done: Boolean, tint: Color?, onToggle: () -> Unit) {
    val color = tint ?: MaterialTheme.colorScheme.onSurfaceVariant
    val label = stringResource(if (done) R.string.plan_mark_not_done else R.string.plan_mark_done)
    Box(Modifier.size(44.dp).clip(CircleShape).toggleable(value = done, role = Role.Checkbox, onValueChange = { onToggle() }).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Box(Modifier.size(22.dp).clip(CircleShape).background(if (done) color else Color.Transparent).border(1.6.dp, color, CircleShape), contentAlignment = Alignment.Center) {
            if (done) Icon(painterResource(R.drawable.ic_check), contentDescription = null, modifier = Modifier.size(14.dp), tint = Color.White)
        }
    }
}

/** A leading mark for rows that are not ticked: an event bar or a glyph. */
@Composable internal fun PlanMark(icon: Int?, tint: Color?) {
    Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
        if (icon != null) WorldsGlyph(icon, tint = tint ?: MaterialTheme.colorScheme.onSurfaceVariant)
        else Box(Modifier.size(width = 4.dp, height = 24.dp).clip(RoundedCornerShape(2.dp)).background(tint ?: MaterialTheme.colorScheme.primary))
    }
}

/** One row in a rounded group: a leading control, the title and a quiet meta line. */
@Composable internal fun PlanRowItem(title: String, done: Boolean, divider: Boolean, onClick: () -> Unit, leading: @Composable () -> Unit, meta: List<Pair<String, Color?>> = emptyList()) {
    Column {
        Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 4.dp, end = 14.dp, top = 4.dp, bottom = 4.dp).heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            leading()
            Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                Text(title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = if (done || title.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    textDecoration = if (done) TextDecoration.LineThrough else null)
                if (meta.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    meta.forEach { (text, color) -> Text(text, style = MaterialTheme.typography.bodySmall, color = color ?: MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false)) }
                }
            }
        }
        if (divider) HorizontalDivider(Modifier.padding(start = 54.dp), color = MaterialTheme.colorScheme.outlineVariant)
    }
}

/** Rows in one rounded group with inset hairlines. */
@Composable internal fun <T> PlanGroup(items: List<T>, modifier: Modifier = Modifier, row: @Composable (item: T, divider: Boolean) -> Unit) {
    WorldsCard(modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        items.forEachIndexed { index, item -> row(item, index < items.lastIndex) }
    }
}

/** The due line for a row, coloured red when overdue and in the accent today. */
@Composable internal fun dueMeta(due: String?, time: String?, done: Boolean, now: String): Pair<String, Color?>? {
    if (due == null || !PlanDates.isIso(due)) return null
    val diff = PlanDates.daysBetween(now, due)
    val color = when {
        done -> null
        diff < 0 -> MaterialTheme.colorScheme.error
        diff == 0 -> MaterialTheme.colorScheme.primary
        else -> null
    }
    return dueText(due, time, now) to color
}

/**
 * The quick add field: "Send invoice friday 10am !!" is read with the desktop's
 * parser, and what it understood shows under the field before adding.
 */
@Composable internal fun QuickAddField(placeholder: String, now: String, onAdd: (QuickAddResult) -> Unit) {
    var value by rememberSaveable { mutableStateOf("") }
    val parsed = if (value.isBlank()) null else QuickAdd.parse(value, LocalDateTime.now())
    fun submit() {
        val p = parsed ?: return
        val title = p.title.ifEmpty { value.trim() }
        if (title.isEmpty()) return
        onAdd(p.copy(title = title))
        value = ""
    }
    Column(Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        OutlinedTextField(value = value, onValueChange = { value = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
            placeholder = { Text(placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            leadingIcon = { WorldsGlyph(R.drawable.ic_plus) },
            trailingIcon = {
                if (parsed != null) {
                    val label = stringResource(R.string.plan_add)
                    IconButton(onClick = { submit() }, modifier = Modifier.semantics { contentDescription = label }) { WorldsGlyph(R.drawable.ic_check, tint = MaterialTheme.colorScheme.primary) }
                }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { submit() }))
        if (parsed != null && (parsed.due != null || parsed.priority > 0)) {
            val parts = listOfNotNull(parsed.due?.let { dueText(it, parsed.time, now) }, if (parsed.priority > 0) priorityName(parsed.priority) else null)
            Text(parts.joinToString(" · "), modifier = Modifier.padding(start = 14.dp, top = 6.dp).clearAndSetSemantics { contentDescription = parts.joinToString(", ") },
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
    }
}
