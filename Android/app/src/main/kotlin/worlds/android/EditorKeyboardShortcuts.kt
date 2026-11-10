package worlds.android

import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type

internal fun Modifier.editorSaveShortcut(enabled: Boolean, save: () -> Unit): Modifier = onPreviewKeyEvent { event ->
    if (enabled && event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 0 &&
        event.key == Key.S && event.isCtrlPressed && !event.isShiftPressed && !event.isAltPressed && !event.isMetaPressed) {
        save(); true
    } else false
}

@Composable
internal fun EditorShortcutRegistration(enabled: Boolean) {
    val activity = LocalActivity.current as? MainActivity
    DisposableEffect(activity, enabled) {
        val owner = Any()
        if (enabled) activity?.editorShortcutOwner = owner
        onDispose { if (activity?.editorShortcutOwner === owner) activity.editorShortcutOwner = null }
    }
}
