package worlds.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.os.Build
import android.widget.ImageView
import android.media.ExifInterface
import androidx.compose.foundation.Image
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import worlds.content.ContentStore
import java.io.ByteArrayInputStream

private data class ImageState(val loaded: Boolean = false, val bitmap: Bitmap? = null, val animation: android.graphics.drawable.Drawable? = null)

@androidx.annotation.RequiresApi(28)
internal object AnimatedGif {
    fun decode(bytes: ByteArray): android.graphics.drawable.Drawable? = ImageDecoder.decodeDrawable(ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes))) { decoder, info, _ ->
        var sample = 1
        while (maxOf(info.size.width, info.size.height) / sample > 1600) sample *= 2
        decoder.setTargetSampleSize(sample)
    } as? AnimatedImageDrawable
    fun decode(file: java.io.File): android.graphics.drawable.Drawable? = ImageDecoder.decodeDrawable(ImageDecoder.createSource(file)) { decoder, info, _ ->
        var sample = 1
        while (maxOf(info.size.width, info.size.height) / sample > 1600) sample *= 2
        decoder.setTargetSampleSize(sample)
    } as? AnimatedImageDrawable
    fun start(drawable: android.graphics.drawable.Drawable) { (drawable as AnimatedImageDrawable).start() }
    fun stop(drawable: android.graphics.drawable.Drawable) { (drawable as AnimatedImageDrawable).stop() }
}

internal fun decodePageImage(bytes: ByteArray, maxDimension: Int = 1600): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth.toLong() * bounds.outHeight > 64_000_000L) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxDimension.coerceAtLeast(1)) sample *= 2
    val image = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val orientation = runCatching { ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    return orientImage(image, orientation)
}

internal fun decodeFileImage(file: java.io.File, maxDimension: Int = 1600): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth.toLong() * bounds.outHeight > 64_000_000L) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxDimension.coerceAtLeast(1)) sample *= 2
    val image = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val orientation = runCatching { ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    return orientImage(image, orientation)
}

private fun orientImage(image: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
    }
    if (matrix.isIdentity) return image
    val rotated = Bitmap.createBitmap(image, 0, 0, image.width, image.height, matrix, true)
    if (rotated !== image) image.recycle()
    return rotated
}

internal data class ImageSettingsTarget(val pageId: String, val blockId: String, val revision: Long, val raw: String)

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun ImageSettingsDialog(target: ImageSettingsTarget, busy: Boolean, onDismiss: () -> Unit, onSave: (String, Int, String) -> Unit) {
    val attrs = remember(target.raw) { JSONObject(target.raw).getJSONObject("attrs") }
    var caption by rememberSaveable(target.blockId) { mutableStateOf(attrs.optString("caption").take(2000)) }
    var width by rememberSaveable(target.blockId) { mutableFloatStateOf(attrs.optInt("display", 100).takeIf { it in 20..100 }?.toFloat() ?: 100f) }
    var full by rememberSaveable(target.blockId) { mutableStateOf(attrs.optInt("display", 100) == 0) }
    var alignment by rememberSaveable(target.blockId) { mutableStateOf(attrs.optString("align").takeIf { it in setOf("left", "center", "right") } ?: "center") }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { WorldsActionLabel(R.drawable.ic_image, stringResource(R.string.image_settings)) },
        text = {
            Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
                OutlinedTextField(value = caption, onValueChange = { caption = it.take(2000) }, label = { Text(stringResource(R.string.image_caption)) }, modifier = Modifier.fillMaxWidth(), maxLines = 3)
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(stringResource(R.string.image_full_width))
                    val label = stringResource(R.string.image_full_width)
                    Switch(checked = full, onCheckedChange = { full = it }, modifier = Modifier.semantics { contentDescription = label })
                }
                val widthLabel = stringResource(R.string.image_width_label)
                Text(stringResource(R.string.image_width_value, width.toInt()), style = MaterialTheme.typography.bodySmall)
                Slider(value = width, onValueChange = { width = it }, enabled = !full, valueRange = 20f..100f, steps = 15, modifier = Modifier.semantics { contentDescription = widthLabel })
                Text(stringResource(R.string.image_alignment), style = MaterialTheme.typography.bodySmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf(Triple("left", R.string.image_align_left, R.drawable.ic_align_left), Triple("center", R.string.image_align_center, R.drawable.ic_align_center), Triple("right", R.string.image_align_right, R.drawable.ic_align_right)).forEach { (key, label, icon) ->
                        FilterChip(selected = alignment == key, onClick = { alignment = key }, label = { Text(stringResource(label)) }, leadingIcon = { WorldsGlyph(icon) })
                    }
                }
            }
        }, confirmButton = { TextButton(enabled = !busy, onClick = { onSave(caption, if (full) 0 else width.toInt(), alignment) }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable internal fun ImageBlock(raw: String, databaseName: String) {
    val attrs = remember(raw) { JSONObject(raw).optJSONObject("attrs") }
    val id = attrs?.optString("attachmentId").orEmpty()
    val name = attrs?.optString("name").orEmpty()
    val mime = attrs?.optString("mime").orEmpty()
    val caption = attrs?.optString("caption").orEmpty()
    val display = attrs?.optInt("display", 100) ?: 100
    val width = if (display == 0) 1f else display.coerceIn(20, 100) / 100f
    val alignment = when (attrs?.optString("align")) { "left" -> AbsoluteAlignment.TopLeft; "right" -> AbsoluteAlignment.TopRight; else -> Alignment.TopCenter }
    val context = LocalContext.current.applicationContext
    val state by produceState(ImageState(), id, databaseName, mime) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                val (file, bytes) = ContentStore(context, databaseName).use { store ->
                    val source = store.privateFile(id); source to if (source == null) store.imageBytes(id) else null
                }
                val animation = if (Build.VERSION.SDK_INT >= 28 && mime == "image/gif") runCatching { if (file != null) AnimatedGif.decode(file) else bytes?.let { AnimatedGif.decode(it) } }.getOrNull() else null
                ImageState(true, if (animation == null) { if (file != null) decodeFileImage(file) else bytes?.let { decodePageImage(it) } } else null, animation)
            }.getOrElse { ImageState(true) }
        }
    }
    val animation = state.animation
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(animation, lifecycle) {
        val observer = LifecycleEventObserver { _, _ ->
            if (Build.VERSION.SDK_INT >= 28 && animation != null) {
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) AnimatedGif.start(animation) else AnimatedGif.stop(animation)
            }
        }
        lifecycle.addObserver(observer)
        if (Build.VERSION.SDK_INT >= 28 && animation != null && lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) AnimatedGif.start(animation)
        onDispose { lifecycle.removeObserver(observer); if (Build.VERSION.SDK_INT >= 28 && animation != null) AnimatedGif.stop(animation) }
    }
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = alignment) {
    Column(Modifier.fillMaxWidth(width)) {
        val image = state.bitmap
        val description = caption.ifBlank { name.ifBlank { stringResource(R.string.image_description) } }
        if (animation != null && Build.VERSION.SDK_INT >= 28) AndroidView(factory = { ctx -> ImageView(ctx).apply { scaleType = ImageView.ScaleType.FIT_CENTER; setImageDrawable(animation) } },
            update = { it.setImageDrawable(animation) },
            modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp).aspectRatio(animation.intrinsicWidth.toFloat() / animation.intrinsicHeight).semantics { contentDescription = description })
        else if (image != null) Image(bitmap = image.asImageBitmap(), contentDescription = description,
            modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp).aspectRatio(image.width.toFloat() / image.height), contentScale = ContentScale.Fit)
        else Text(stringResource(if (state.loaded) R.string.image_unavailable else R.string.image_loading), color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (caption.isNotBlank()) Text(caption, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    }
}
