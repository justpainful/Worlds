# Worlds packs: tools for every sector

Planned 2026-11-13 with the owner. Worlds stays general; a pack adds what one kind of person or team needs, so nobody leaves Worlds to find their tools elsewhere. Today there is one pack, Study. This plan adds 38.

## How packs work today

`src/packs/registry.ts` holds the list. A pack:

- adds **kinds** (stored as pages with kind data in `metadata.<kind>`), such as `subject`, `lesson`, `assignment`;
- adds sidebar entries, a Home section and commands;
- is off until the person turns it on in Settings. While off, nothing of it shows anywhere, and anything made with it is kept, hidden, and comes back when it is turned on again.

Planning kinds (`task`, `event`, `inbox`, `goal`) belong to everyone, not to a pack.

## Decisions

| Topic | Decision |
| --- | --- |
| Scope | 38 new packs in 7 families (below). Regulated sectors wait: clinics, law, official accounting |
| First wave | Teacher, Freelance, Small business, Writing and worldbuilding |
| Audience | Teams from the start. Every pack defines its roles on top of workspace roles (Owner, Admin, Member, Guest) and groups |
| Platforms | Desktop (Windows and web) first. Android and Apple get a pack once it has settled on desktop |
| Languages | Every pack ships in Arabic and English: names, templates, Claude commands and sample data |
| Approach | A pack engine and shared blocks first, then packs written as definitions. No one-off code per sector |

## The pack engine

Forty packs cannot each be a hand-built feature. A pack becomes a **definition**, a data file the engine reads:

- **Kinds**: name in both languages, icon, fields (text, number, money, date, person, contact, choice, stage, link to another kind, file), which field is the title, which is the date shown in Calendar.
- **Views**: built from the shared blocks: list, table, stages board, calendar, timeline, map of links, form. Each view says which kind it shows, its filters and its sort.
- **Home section**: what the person sees first (for a teacher: today's classes, who is absent, work waiting to be marked).
- **Sidebar entries and commands**.
- **Roles**: names in both languages and what each sees and changes (see Roles).
- **Templates**: pages and sample data in Arabic and English.
- **Claude**: commands and instructions specific to the pack ("prepare an invoice for this client").
- **Automations**: ready rules the person can switch on ("remind me of late invoices").

Study moves onto the engine first, so the engine is proven on a pack we already know before any new pack is written.

## Shared blocks

Built once, used by many packs. Some exist in part today (tables and collections with properties, boards, Calendar, the focus timer, automations, Claude).

| Block | What it gives | Used by |
| --- | --- | --- |
| Contacts | People and organisations with fields and a history of contact | Teacher (students, parents), Freelance, Small business, Sales, Recruiting, Real estate, Consulting, Events |
| Money | Amounts in SAR and other currencies, 15% VAT, invoices, payments, expenses, budgets | Freelance, Small business, Personal finance, Property management, Events, Restaurants |
| Stages | A board where items move between stages | Sales, Recruiting, orders, quotes, content, Job seeker, Dev teams |
| Time tracking | Hours against a project or client; builds on the focus timer | Freelance, Consulting, Dev teams |
| Habits and recurrence | Things that repeat, with streaks | Health, Home, Personal finance, Quran circles |
| Forms | A form someone fills in that becomes an item | Client requests, bookings, event sign-ups, inspections |
| Pack roles | Roles per pack on top of workspace roles | Every pack, since teams come first |
| Mine only | A person sees only items assigned to them | Teacher (student sees own grades), Small business (staff do not see profit), Consulting (client portal) |
| Bookings with resources | Time slots on a room, chair or person | Hotels, Salons, Consulting, clinics later |
| Assets and equipment | Things owned, with periodic maintenance | Contracting, Transport, Farming, My car, Photo and video |
| Sites | Places work happens, with a map pin | Contracting, Farming, Property management, Safety |
| Checklists | Repeatable lists ticked on each visit | Safety and inspection, maintenance, hotel cleaning |
| Numbered registers | Items with a running reference number | Administrative correspondence, invoices, orders |
| Expiring dates | Dates that run out and must be renewed, with reminders | My car (registration, insurance), Hajj and Umrah (passports), leases, scholarships |

## Roles

Pack roles map onto what already exists: workspace roles, groups and page permissions (Full access, Can edit, Can comment, Can view). Two additions are needed:

1. **Per item access by assignment**: an item can be visible only to the people it is assigned to, as well as to the roles that see everything.
2. **Hidden fields by role**: a role can be denied a field (for example profit or cost) while seeing the rest of the item.

Examples:

| Pack | Roles |
| --- | --- |
| Teacher | Teacher, assistant teacher, student (own work only), parent (own child only) |
| Freelance | Owner, partner, client (own project and invoices only) |
| Small business | Owner, manager, staff (orders, no profit), accountant (money, read only) |
| Writing | Writer, co-writer, editor (comments only), beta reader |

## First wave

### Teacher

For school teachers and university lecturers.

- **Kinds**: class, student, lesson plan, period, assessment, grade, attendance.
- **Views**: gradebook (a spreadsheet with averages), daily attendance with one tap per student, question bank, student file, week plan.
- **Home**: today's periods, absences, assessments waiting to be marked.
- **Claude**: write a lesson plan, draft questions from a lesson, summarise a class's results, write to a parent.
- **Automations**: tell a parent about an absence, remind students of due dates.
- **Links**: what a teacher publishes appears in the Study pack of the student as an assignment or exam.

### Freelance

For designers, developers, translators and consultants who work alone or in a small studio.

- **Kinds**: client, quote, invoice, payment, time entry, contract (projects already exist).
- **Views**: clients board, quotes by stage (sent, accepted, declined), money owed, hours report.
- **Home**: what is owed, hours this week, upcoming meetings.
- **Claude**: a quote from a short description, an invoice from tracked hours, a kind reminder about a late payment.
- **Note**: invoices in SAR with VAT. Saudi e-invoicing (ZATCA) integration is a later step.

### Small business

For shops and home businesses.

- **Kinds**: product, stock movement, order, customer, supplier, expense.
- **Views**: orders by stage (new, preparing, shipped, delivered), stock with low-stock warnings, monthly profit.
- **Home**: today's orders, low stock, this month's takings.
- **Claude**: write a product description, explain sales, answer a customer.
- **Automations**: low stock alert, a daily summary to the owner.

### Writing and worldbuilding

For novelists, screenwriters and game makers. The name Worlds makes this the natural pack to show first.

- **Kinds**: character, place, chapter and scene, event, group, system (magic or technology), object.
- **Views**: timeline, map of how characters relate, a map of places drawn in the drawing app with links, scene board, daily word goal.
- **Claude**: check consistency (an age or name that changes between chapters), summarise a chapter, suggest names.

## All packs

| Family | Pack | Main tools |
| --- | --- | --- |
| Education and training | Teacher | See first wave |
| | Quran memorisation circles | Circles and students, memorisation and revision by surah and ayah, attendance |
| | Training centres | Courses, trainees, sessions, certificates |
| | Research | References and citations, reading notes, thesis chapters, experiment log, supervisor meetings |
| | University admission and scholarships | Universities, requirements, documents, deadlines |
| Work and business | Freelance | See first wave |
| | Small business | See first wave |
| | Sales | Deals by stage, scheduled follow-ups, call log, monthly targets |
| | Recruiting | Candidates by stage, interviews, scorecards |
| | Real estate brokerage | Listings, clients, viewings, contracts |
| | Restaurants and cafes | Menu, stock, shifts, suppliers |
| | Consulting and coaching | Clients, sessions, plans and goals, notes (not medical) |
| | Administrative correspondence | Incoming and outgoing letters with reference numbers, letters, minutes, circulars |
| Field work | Contracting and maintenance | Sites, work orders, technicians, equipment, daily report with photos, bills of quantities |
| | Transport and delivery | Trips, drivers, vehicles and their maintenance, shipments and their status |
| | Farming and livestock | Fields and crops by season, irrigation, livestock with vaccinations and births |
| | Safety and inspection | Checklists, site visits, incidents, corrective actions |
| Services and hospitality | Hotels and short rentals | Units, bookings, cleaning rota, guests |
| | Salons | Appointments, services and prices, staff, regular clients |
| | Property management | Units, tenants, leases and rent payments, maintenance requests |
| | Hajj, Umrah and travel companies | Groups, travellers and their documents, housing, buses, programmes |
| Creative, tech and media | Writing and worldbuilding | See first wave |
| | Dev teams | Bugs and tasks in sprints, releases, design decisions, API notes |
| | Content and marketing | Publishing calendar, idea bank, campaigns, drafts per platform, results |
| | Photo and video | Shoots, clients, deliveries, gear |
| | Design | References, mood boards, deliveries to the client |
| | Podcast and media | Episodes, guests, outlines, scripts, publishing schedule |
| | Game making | Design document, levels, art assets, balance tables, bugs |
| Community | Nonprofits and volunteering | Members, subscriptions, volunteers, events |
| | Sports clubs | Players, training, matches |
| | Events | Guests and invitations, programme, budget, suppliers |
| Individuals | Personal finance | Budget, expenses, subscriptions, savings goals |
| | Health and fitness | Habits, workouts, meals, medicine and doctor reminders (personal use only) |
| | Home and family | Chores, shopping list, meal plan, family dates |
| | Travel | Trips, bookings, documents, packing lists |
| | Job seeker | Applications by stage, interviews, CV versions |
| | Reading | Books, quotes, reading goals, notes per book |
| | My car | Maintenance, costs, registration and insurance renewals |
| Later, with care | Clinics, law, official accounting | Sensitive data and legal requirements; not before the rest is mature |

## Phases

1. **Engine and shared blocks.** The largest part of the work; everything else depends on it. Study moves onto the engine.
2. **First wave on desktop.** Teacher, Freelance, Small business, Writing and worldbuilding, each tried with real people from its sector.
3. **The rest in batches by family.** Each batch is mostly definitions and templates once the blocks exist.
4. **Android and Apple.** A pack moves to mobile after it has settled on desktop.

## Choosing packs

- On first run, after the language choice, Worlds asks what the person uses it for and suggests packs. Nothing is forced; Settings lists every pack with what it adds.
- In a team workspace, the owner turns packs on for the whole team and gives people pack roles.
- Turning a pack off hides everything it made and keeps it.

## Open questions

- Which family follows the first wave.
- Whether a pack can be shared or published by people outside the Worlds team (a pack store), or packs stay built in.
- Pricing: whether some packs are free and some paid, and whether teams pay per person.
- How deep money goes: invoices and VAT only, or Saudi e-invoicing (ZATCA) as well.
