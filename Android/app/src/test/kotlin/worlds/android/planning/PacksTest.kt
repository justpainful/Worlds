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
}
