package worlds.android.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import worlds.android.LaunchPrompt
import worlds.android.MainActivity
import worlds.android.R
import worlds.android.planning.PlanRow
import worlds.content.ContentStore
import java.time.LocalDate

/**
 * Today in Worlds on the home screen: the day's events and the tasks due
 * today or overdue, up to five. Tapping opens Worlds; the + asks Claude to
 * add a task. It refreshes every 30 minutes and when Worlds asks it to.
 */
class TodayWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val lines = today(context)
                ids.forEach { manager.updateAppWidget(it, views(context, lines)) }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        private const val DATABASE = "worlds-content.db"

        /** Ask every placed widget to redraw, after Worlds changed something. */
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
            if (ids.isNotEmpty()) {
                context.sendBroadcast(
                    Intent(context, TodayWidget::class.java)
                        .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids),
                )
            }
        }

        private fun today(context: Context): List<String> = runCatching {
            val day = LocalDate.now().toString()
            val rows = ContentStore(context.applicationContext, DATABASE).list().filter { it.deletedAt == null }.map { PlanRow.of(it) }
            val events = rows.filter { it.kind == "event" && it.event.date == day }
                .sortedBy { it.event.start ?: "" }
                .map { listOfNotNull(it.event.start, it.title).joinToString("  ") }
            val tasks = rows.filter { it.kind == "task" && !it.task.done && (it.task.due ?: "9999") <= day }.map { "- ${it.title}" }
            (events + tasks).take(5)
        }.getOrDefault(emptyList())

        private fun views(context: Context, lines: List<String>): RemoteViews {
            val v = RemoteViews(context.packageName, R.layout.widget_today)
            val rows = listOf(R.id.widget_line1, R.id.widget_line2, R.id.widget_line3, R.id.widget_line4, R.id.widget_line5)
            rows.forEachIndexed { i, id ->
                if (i < lines.size) {
                    v.setTextViewText(id, lines[i])
                    v.setViewVisibility(id, View.VISIBLE)
                } else {
                    v.setViewVisibility(id, View.GONE)
                }
            }
            v.setViewVisibility(R.id.widget_empty, if (lines.isEmpty()) View.VISIBLE else View.GONE)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), flags)
            v.setOnClickPendingIntent(R.id.widget_root, open)
            val add = Intent(context, MainActivity::class.java)
                .putExtra(LaunchPrompt.EXTRA, context.getString(R.string.widget_add_prompt))
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            v.setOnClickPendingIntent(R.id.widget_add, PendingIntent.getActivity(context, 1, add, flags))
            return v
        }
    }
}
