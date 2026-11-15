package worlds.android.planning

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The packs the app ships (assets/packs.json, exported by the desktop) and where their fields live. */
class PacksTest {
    private val catalog = PackCatalog.parse(File("src/main/assets/packs.json").readText())

    @Test fun readsEveryPackWithBothLanguages() {
        assertEquals(39, catalog.packs.size)
        assertEquals(7, catalog.families.size)
        val shop = requireNotNull(catalog.pack("shop"))
        assertEquals("المشروع الصغير", shop.label.ar)
        assertEquals("Small business", shop.label.text(arabic = false))
        val order = requireNotNull(shop.kind("order"))
        assertEquals("shop.order", order.kind)
        val status = order.fields.first { it.id == "status" }
        assertEquals("stage", status.type)
        assertEquals("new", status.options.first().id)
        assertTrue(shop.sidebarViews.isNotEmpty())
        // Study keeps its own kinds.
        assertEquals("assignment", catalog.pack("study")?.kind("assignment")?.kind)
        assertNotNull(catalog.kindOf("teacher.class"))
    }

    @Test fun keepsPackFieldsUnderItemLikeTheDesktop() {
        assertTrue(isPackKind("teacher.class"))
        assertFalse(isPackKind("assignment"))
        assertFalse(isPackKind("Teacher.class"))
        assertEquals("item", dataKeyOf("shop.order"))
        assertEquals("task", dataKeyOf("task"))
        val made = JSONObject(newKindMetadata("shop.order", mapOf("status" to "new", "total" to 170)))
        assertEquals("new", made.getJSONObject("item").getString("status"))
        val merged = mergeKindData(made.put("look", JSONObject().put("font", "serif")).toString(), "shop.order", mapOf("status" to "shipped"))
        assertEquals("shipped", kindData(merged, "shop.order").getString("status"))
        assertEquals(170, kindData(merged, "shop.order").getInt("total"))
        assertEquals("serif", JSONObject(merged).getJSONObject("look").getString("font"))
        assertTrue(hasOwnView("shop.order"))
    }

    @Test fun showsFieldValuesForLists() {
        val order = requireNotNull(catalog.pack("shop")?.kind("order"))
        val data = JSONObject().put("status", "shipped").put("total", 170).put("customer", "c1")
        assertEquals("شُحن", packValue(order.fields.first { it.id == "status" }, data, arabic = true) { "" })
        assertEquals("170 SAR", packValue(order.fields.first { it.id == "total" }, data, arabic = false) { "" })
        assertEquals("Hessa", packValue(order.fields.first { it.id == "customer" }, data, arabic = false) { if (it == "c1") "Hessa" else "" })
    }

    private fun row(kind: String, data: JSONObject, id: String = kind + data.hashCode()) = PlanRow(id, id, kind, null, 0.0, 0L, data)
    private val today = "2026-11-13" // a Friday

    @Test fun conditionsMatchTheDesktop() {
        fun c(json: String) = PackCondition.parse(JSONObject(json))
        assertTrue(PackRules.matches(c("{\"field\":\"s\",\"in\":[\"a\"]}"), JSONObject().put("s", "a"), today))
        assertTrue(PackRules.matches(c("{\"field\":\"done\",\"in\":[false]}"), JSONObject(), today))
        assertTrue(PackRules.matches(c("{\"field\":\"d\",\"overdue\":true}"), JSONObject().put("d", "2026-11-12"), today))
        assertFalse(PackRules.matches(c("{\"field\":\"d\",\"overdue\":true}"), JSONObject().put("d", today), today))
        assertTrue(PackRules.matches(c("{\"field\":\"d\",\"within\":0}"), JSONObject().put("d", today), today))
        // The week runs Saturday to Friday.
        assertTrue(PackRules.matches(c("{\"field\":\"d\",\"period\":\"week\"}"), JSONObject().put("d", "2026-11-07"), today))
        assertFalse(PackRules.matches(c("{\"field\":\"d\",\"period\":\"week\"}"), JSONObject().put("d", "2026-11-06"), today))
        assertTrue(PackRules.matches(c("{\"field\":\"stock\",\"atMost\":\"reorderAt\"}"), JSONObject().put("stock", 3).put("reorderAt", 5), today))
        assertFalse(PackRules.matches(c("{\"field\":\"stock\",\"atMost\":\"reorderAt\"}"), JSONObject().put("stock", 9).put("reorderAt", 5), today))
    }

    @Test fun figuresAndAlertsMatchTheDesktop() {
        val freelance = requireNotNull(catalog.pack("freelance"))
        val rows = listOf(
            row("freelance.invoice", JSONObject().put("total", 1150).put("status", "sent").put("due", "2026-11-01"), "a"),
            row("freelance.invoice", JSONObject().put("total", 2300).put("status", "late").put("due", "2026-11-20"), "b"),
            row("freelance.invoice", JSONObject().put("total", 500).put("status", "paid").put("due", "2026-10-01"), "c"),
        )
        val owed = freelance.stats.first { it.label.en == "Owed to you" }
        assertEquals(3450.0, PackRules.stat(rows, owed, today)!!, 0.001)
        val late = freelance.alerts.first { it.label.en == "Late invoices" }
        assertEquals(1, PackRules.filter(rows, late.where, today).size)
        assertTrue(freelance.prompts.first().prompt.ar.isNotBlank())
        assertEquals("teacher.attendance", catalog.pack("teacher")?.screens?.first()?.component)
    }

    @Test fun findsDoubleBookings() {
        fun b(staff: String?, time: String) = JSONObject().put("date", "2026-11-14").put("time", time).also { if (staff != null) it.put("staff", staff) }
        val rows = listOf(row("salon.booking", b("a", "10:00"), "1"), row("salon.booking", b("a", "10:00"), "2"), row("salon.booking", b("a", "11:00"), "3"), row("salon.booking", b("b", "10:00"), "4"), row("salon.booking", b(null, "10:00"), "5"))
        val clash = PackCondition.parse(JSONObject("{\"field\":\"staff\",\"clashesOn\":[\"date\",\"time\"]}"))
        assertEquals(listOf("1", "2"), PackRules.filter(rows, listOf(clash), today).map { it.id })
    }

    @Test fun fillsANoteToAParentFromTheAbsenceAndTheStudent() {
        assertEquals("966551234567", PackMessages.whatsappNumber("0551234567"))
        assertEquals("966551234567", PackMessages.whatsappNumber("+966 55 123 4567"))
        assertEquals("", PackMessages.whatsappNumber("call me"))
        val teacher = requireNotNull(catalog.pack("teacher"))
        val attendance = requireNotNull(teacher.kind("attendance"))
        val m = attendance.messages.single { it.id == "parent" }
        val student = PlanRow("s1", "Sara Ali", "teacher.student", null, 0.0, 0L, JSONObject().put("guardian", "Mr Ali").put("guardianPhone", "0551234567"))
        val absence = JSONObject().put("student", "s1").put("date", "2026-11-12").put("status", "absent").put("parentTold", false)
        assertTrue(PackMessages.offered(m, absence, "2026-11-13"))
        assertFalse(PackMessages.offered(m, JSONObject(absence.toString()).put("parentTold", true), "2026-11-13"))
        val draft = requireNotNull(PackMessages.draft(m, teacher, attendance, "Sara Ali, 2026-11-12", absence, { id -> student.takeIf { it.id == id } }, arabic = false))
        assertEquals("whatsapp", draft.channel)
        assertEquals("966551234567", draft.to)
        assertEquals("Mr Ali", draft.name)
        assertTrue(draft.text, draft.text.startsWith("Hello, Mr Ali. Sara Ali was absent from class on"))
        assertFalse(draft.text.contains("{"))
        assertEquals(true, m.done?.getBoolean("parentTold"))
        // No student linked: no one to send it to.
        assertEquals(null, PackMessages.draft(m, teacher, attendance, "x", JSONObject().put("status", "absent"), { null }, arabic = false))
    }
}
