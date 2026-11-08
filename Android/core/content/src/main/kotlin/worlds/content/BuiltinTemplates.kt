package worlds.content

/** Built-in definitions copied from the desktop Worlds template catalog. */
data class BuiltinTemplate(val key: String, val title: String, val icon: String, val category: String, val description: String, val markdown: String)

object BuiltinTemplates {
    val all = listOf(
        BuiltinTemplate("todo", "To-do List", "✅", "Personal", "Today, this week, and someday.", "\n## Today\n- [ ]\n## This week\n- [ ]\n## Someday\n- [ ]\n---\n> [!note] Move finished items down as you go. Keep the top of the page about what is next.\n"),
        BuiltinTemplate("project", "Project Tracker", "🧭", "Work", "Goal, milestones, owners and status in one place.", "\n> [!note] **Goal**: one sentence that says what done looks like.\n\n## Milestones\n| Milestone | Owner | Due | Status |\n|---|---|---|---|\n| Scope agreed |  | {{date}} | Not started |\n|  |  |  |  |\n\n## Open questions\n-\n\n## Decisions\n-\n\n## Tasks\n- [ ]\n"),
        BuiltinTemplate("weekly", "Weekly Update {{date}}", "🗓️", "Work", "What shipped, what is next, what is blocked.", "\n## Shipped\n-\n\n## Next\n-\n\n## Blocked\n-\n\n## Notes\n"),
        BuiltinTemplate("feedback", "Feedback Tracker", "💬", "Work", "Collect feedback and decide what to act on.", "\n| From | Feedback | Area | Priority | Action |\n|---|---|---|---|---|\n|  |  |  |  |  |\n\n## Themes\n-\n\n## Acting on\n- [ ]\n"),
        BuiltinTemplate("release", "Release Notes", "🚀", "Product", "Version, highlights, fixes and known issues.", "\n**Version** v1.0.0 · **Date** {{date}}\n\n## Highlights\n-\n\n## Improvements\n-\n\n## Fixes\n-\n\n## Known issues\n-\n"),
        BuiltinTemplate("meeting", "Meeting Notes", "🪑", "Work", "Agenda, decisions and action items.", "\n**Date** {{date}} · **Time**\n\n## Attendees\n-\n\n## Agenda\n1.\n\n## Decisions\n-\n\n## Action items\n- [ ]\n"),
        BuiltinTemplate("roadmap", "Roadmap", "🗺️", "Product", "Now, next, later.", "\n## Now\n| Item | Why | Owner |\n|---|---|---|\n|  |  |  |\n\n## Next\n| Item | Why | Owner |\n|---|---|---|\n|  |  |  |\n\n## Later\n-\n\n> [!note] Re-rank this page every two weeks. Anything that has not moved in a month goes to Later.\n"),
        BuiltinTemplate("bugs", "Bug Tracker", "🐞", "Product", "Reproduce, prioritise, fix.", "\n| Bug | Steps | Severity | Status | Owner |\n|---|---|---|---|---|\n|  |  | High | Open |  |\n\n## Triage rules\n- **High**: data loss, crash, or blocks a core flow.\n- **Medium**: wrong behaviour with a workaround.\n- **Low**: cosmetic.\n"),
        BuiltinTemplate("discord", "Discord Announcement", "📣", "Discord", "Structured message for Discord, previewed before it is sent.", "\n# الاجتماع الإداري\n\n**الوقت** 8:00 PM\n\n---\n\n## المواضيع\n- المتجر\n- السيرفر\n- الطاقم\n\n> [!note] يرجى تأكيد الحضور قبل الموعد.\n"),
    )
}
