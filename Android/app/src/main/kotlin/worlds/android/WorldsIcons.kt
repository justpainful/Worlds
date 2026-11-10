package worlds.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp

/** The same icon vocabulary used by the desktop Worlds interface. */
@Composable internal fun WorldsActionLabel(icon: Int, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(18.dp))
        Text(label)
    }
}

@Composable internal fun WorldsGlyph(icon: Int, modifier: Modifier = Modifier, tint: Color = LocalContentColor.current) {
    Icon(painterResource(icon), contentDescription = null, modifier = modifier.size(20.dp), tint = tint)
}
