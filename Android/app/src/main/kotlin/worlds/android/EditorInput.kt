package worlds.android

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextDirection

internal fun editorDirection(value: String): TextDirection = when (value) {
    "ltr" -> TextDirection.Ltr
    "rtl" -> TextDirection.Rtl
    else -> TextDirection.Content
}

internal fun editorKeyboardOptions(suggestions: Boolean): KeyboardOptions = KeyboardOptions(autoCorrectEnabled = suggestions)
