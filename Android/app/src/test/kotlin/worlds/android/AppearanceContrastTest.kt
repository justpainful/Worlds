package worlds.android

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertTrue
import org.junit.Test

class AppearanceContrastTest {
    private fun contrast(a: Color, b: Color): Float {
        val x = a.luminance(); val y = b.luminance()
        return (maxOf(x, y) + 0.05f) / (minOf(x, y) + 0.05f)
    }
    @Test fun allAccentsRemainReadableOnSurfacesAndContainers() {
        appearanceAccents.forEach { accent ->
            val darkSurface = Color(0xff1c1c1e)
            val darkContainer = lerp(accent.dark, darkSurface, .88f)
            val lightContainer = lerp(accent.light, Color.White, .88f)
            assertTrue("${accent.id} dark surface", contrast(accent.dark, darkSurface) >= 4.5f)
            assertTrue("${accent.id} dark container", contrast(accent.dark, darkContainer) >= 4.5f)
            assertTrue("${accent.id} light surface", contrast(accent.light, Color.White) >= 4.5f)
            assertTrue("${accent.id} light container", contrast(accent.light, lightContainer) >= 4.5f)
        }
    }
}
