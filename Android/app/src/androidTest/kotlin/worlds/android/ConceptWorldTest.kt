package worlds.android

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.geometry.Offset
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

/** The concept map template opens as a world on a real device, and the world moves. */
class ConceptWorldTest {
    @get:Rule val compose = createComposeRule()

    private val template = "flowchart TD\n  C0([\"المفهوم الأساسي\"])\n  C1[\"المفهوم الأول\"]\n  C2[\"المفهوم الثاني\"]\n  C3[\"المفهوم الثالث\"]\n  C4[\"النتيجة / الأثر\"]\n" +
        "  C0 -->|يتكون من| C1\n  C0 -->|يعتمد على| C2\n  C1 -->|يؤدي إلى| C3\n  C2 -->|يتفاعل مع| C3\n  C3 -->|ينتج عنه| C4"

    private fun save(name: String) {
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        val dir = InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null)!!
        File(dir, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun conceptMapOpensAsAWorldThatMoves() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        compose.setContent { MaterialTheme { Column { MermaidBlock(template) } } }
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.concept_map_title)).assertExists()
        val world = compose.onNodeWithContentDescription(context.getString(R.string.concept_map_description))
        world.assertExists()
        Thread.sleep(800)
        val before = world.captureToImage().asAndroidBitmap()
        save("concept-world")
        world.performTouchInput { swipe(Offset(centerX, centerY), Offset(centerX - 160f, centerY + 90f), 300) }
        compose.waitForIdle()
        Thread.sleep(400)
        val after = world.captureToImage().asAndroidBitmap()
        save("concept-world-moved")
        var changed = 0
        for (x in 0 until before.width step 8) for (y in 0 until before.height step 8) if (before.getPixel(x, y) != after.getPixel(x, y)) changed++
        assertTrue("Dragging must move the world", changed > 20)
        compose.onNodeWithText(context.getString(R.string.diagram_title)).performClick()
        compose.waitForIdle()
        save("concept-diagram")
    }
}
