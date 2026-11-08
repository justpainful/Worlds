package worlds.android

import android.graphics.Bitmap
import android.graphics.Color
import android.media.ExifInterface
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class ImageBlockTest {
    @Test fun animatedGifUsesAnimatedDecoderAndStaticFallbackCanDecode() {
        val bytes = android.util.Base64.decode("R0lGODlhEAAMAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAHgAAACwAAAAAEAAMAAAIGQABCBxIsKDBgwgTKlzIsKHDhxAjSpwoMCAAIfkEAR4AAQAsAAAAABAADACBAAD/AAAAAAAAAAAACBkAAQgcSLCgwYMIEypcyLChw4cQI0qcKDAgADs=", android.util.Base64.DEFAULT)
        val still = decodePageImage(bytes)!!
        assertEquals(16, still.width); assertEquals(12, still.height); still.recycle()
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            val drawable = AnimatedGif.decode(bytes)
            assertTrue(drawable is android.graphics.drawable.AnimatedImageDrawable)
            assertEquals(16, drawable!!.intrinsicWidth); assertEquals(12, drawable.intrinsicHeight)
        }
    }
    @Test fun jpegOrientationIsAppliedToPreview() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = context.cacheDir.resolve("oriented-${UUID.randomUUID()}.jpg")
        val image = Bitmap.createBitmap(40, 20, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }
        try {
            file.outputStream().use { image.compress(Bitmap.CompressFormat.JPEG, 95, it) }
            ExifInterface(file.absolutePath).apply { setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString()); saveAttributes() }
            val decoded = decodePageImage(file.readBytes())!!
            assertEquals(20, decoded.width); assertEquals(40, decoded.height)
            decoded.recycle()
        } finally { image.recycle(); file.delete() }
    }
}
