//! Built-in templates. Authored in the constrained Markdown dialect and
//! parsed into real structured blocks when seeded; after seeding they are
//! ordinary editable template pages.

pub struct Template {
    pub key: &'static str,
    pub title: &'static str,
    pub icon: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub markdown: &'static str,
}

pub const BUILTIN: &[Template] = &[
    Template {
        key: "todo",
        title: "To-do List",
        icon: "✅",
        category: "Personal",
        description: "Today, this week, and someday.",
        markdown: r#"
## Today
- [ ]
## This week
- [ ]
## Someday
- [ ]
---
> [!note] Move finished items down as you go. Keep the top of the page about what is next.
"#,
    },
    Template {
        key: "project",
        title: "Project Tracker",
        icon: "🧭",
        category: "Work",
        description: "Goal, milestones, owners and status in one place.",
        markdown: r#"
> [!note] **Goal**: one sentence that says what done looks like.

## Milestones
| Milestone | Owner | Due | Status |
|---|---|---|---|
| Scope agreed |  | {{date}} | Not started |
|  |  |  |  |

## Open questions
-

## Decisions
-

## Tasks
- [ ]
"#,
    },
    Template {
        key: "weekly",
        title: "Weekly Update {{date}}",
        icon: "🗓️",
        category: "Work",
        description: "What shipped, what is next, what is blocked.",
        markdown: r#"
## Shipped
-

## Next
-

## Blocked
-

## Notes
"#,
    },
    Template {
        key: "feedback",
        title: "Feedback Tracker",
        icon: "💬",
        category: "Work",
        description: "Collect feedback and decide what to act on.",
        markdown: r#"
| From | Feedback | Area | Priority | Action |
|---|---|---|---|---|
|  |  |  |  |  |

## Themes
-

## Acting on
- [ ]
"#,
    },
    Template {
        key: "release",
        title: "Release Notes",
        icon: "🚀",
        category: "Product",
        description: "Version, highlights, fixes and known issues.",
        markdown: r#"
**Version** v1.0.0 · **Date** {{date}}

## Highlights
-

## Improvements
-

## Fixes
-

## Known issues
-
"#,
    },
    Template {
        key: "meeting",
        title: "Meeting Notes",
        icon: "🪑",
        category: "Work",
        description: "Agenda, decisions and action items.",
        markdown: r#"
**Date** {{date}} · **Time**

## Attendees
-

## Agenda
1.

## Decisions
-

## Action items
- [ ]
"#,
    },
    Template {
        key: "roadmap",
        title: "Roadmap",
        icon: "🗺️",
        category: "Product",
        description: "Now, next, later.",
        markdown: r#"
## Now
| Item | Why | Owner |
|---|---|---|
|  |  |  |

## Next
| Item | Why | Owner |
|---|---|---|
|  |  |  |

## Later
-

> [!note] Re-rank this page every two weeks. Anything that has not moved in a month goes to Later.
"#,
    },
    Template {
        key: "bugs",
        title: "Bug Tracker",
        icon: "🐞",
        category: "Product",
        description: "Reproduce, prioritise, fix.",
        markdown: r#"
| Bug | Steps | Severity | Status | Owner |
|---|---|---|---|---|
|  |  | High | Open |  |

## Triage rules
- **High**: data loss, crash, or blocks a core flow.
- **Medium**: wrong behaviour with a workaround.
- **Low**: cosmetic.
"#,
    },
    Template {
        key: "discord",
        title: "Discord Announcement",
        icon: "📣",
        category: "Discord",
        description: "Structured message for Discord, previewed before it is sent.",
        markdown: r#"
# الاجتماع الإداري

**الوقت** 8:00 PM

---

## المواضيع
- المتجر
- السيرفر
- الطاقم

> [!note] يرجى تأكيد الحضور قبل الموعد.
"#,
    },
];
