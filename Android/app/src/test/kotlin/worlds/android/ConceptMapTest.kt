package worlds.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConceptMapTest {
    private val template = """flowchart TD
  C0(["المفهوم الأساسي"])
  C1["المفهوم الأول"]
  C2["المفهوم الثاني"]
  C3["المفهوم الثالث"]
  C4["النتيجة / الأثر"]
  C0 -->|يتكون من| C1
  C0 -->|يعتمد على| C2
  C1 -->|يؤدي إلى| C3
  C2 -->|يتفاعل مع| C3
  C3 -->|ينتج عنه| C4"""

    @Test fun readsTheConceptMapTemplate() {
        val g = ConceptMap.parse(template)!!
        assertTrue(g.simple)
        assertEquals(listOf("C0", "C1", "C2", "C3", "C4"), g.nodes.map { it.id })
        assertEquals("المفهوم الأساسي", g.nodes[0].label)
        assertEquals("stadium", g.nodes[0].shape)
        assertEquals(MapEdge("C0", "C1", "يتكون من", "arrow"), g.edges[0])
        assertEquals(MapView.WORLD, g.shownView)
    }

    @Test fun readsChainsAndPlainFlowcharts() {
        val g = ConceptMap.parse("graph LR\n  A[Idea] --> B[Plan] --> C[Ship]; C -- feeds --> A\n  D-->E")!!
        assertEquals("LR", g.direction)
        assertEquals(listOf("A>B:", "B>C:", "C>A:feeds", "D>E:"), g.edges.map { "${it.from}>${it.to}:${it.label}" })
        assertEquals(MapView.DIAGRAM, g.shownView)
    }

    @Test fun keepsTheLayoutInComments() {
        val g = ConceptMap.parse(template)!!
        val code = ConceptMap.withLayout(template, MapView.WORLD, mapOf("C0" to MapPoint(10.4f, -20.6f)), g.nodes.map { it.id })
        assertTrue(code.startsWith(template))
        val again = ConceptMap.parse(code)!!
        assertEquals(MapView.WORLD, again.view)
        assertEquals(MapPoint(10f, -21f), again.positions["C0"])
    }

    @Test fun marksWhatItCannotRead() {
        assertFalse(ConceptMap.parse("flowchart TD\n  subgraph S\n  A --> B\n  end")!!.simple)
        assertNull(ConceptMap.parse("sequenceDiagram\n  A->>B: hi"))
    }
}
