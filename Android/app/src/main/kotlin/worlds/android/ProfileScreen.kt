package worlds.android

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

private val Context.profileDataStore by preferencesDataStore(name = "worlds_profile")

private val KEY_DISPLAY_NAME = stringPreferencesKey("profile_name")
private val KEY_HANDLE = stringPreferencesKey("profile_handle")
private val KEY_AVATAR_COLOR = stringPreferencesKey("profile_avatar_color")
private val KEY_BIO = stringPreferencesKey("profile_bio")

private val AVATAR_COLORS = listOf(
    Color(0xff0a84ff), // Blue
    Color(0xff8db39a), // Sage
    Color(0xff7fa7d9), // Sky
    Color(0xffd98c9a), // Rose
    Color(0xffd08560), // Copper
    Color(0xffa1a1aa), // Graphite
    Color(0xff9b59b6), // Purple
    Color(0xff3498db)  // Blue
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ProfileScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    var displayName by remember { mutableStateOf("User") }
    var handle by remember { mutableStateOf("@user") }
    var bio by remember { mutableStateOf("") }
    var selectedColorIndex by remember { mutableIntStateOf(0) }
    var savedMessage by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val prefs = context.profileDataStore.data.first()
        displayName = prefs[KEY_DISPLAY_NAME] ?: ""
        handle = prefs[KEY_HANDLE] ?: ""
        bio = prefs[KEY_BIO] ?: ""
        val savedColor = prefs[KEY_AVATAR_COLOR]
        if (savedColor != null) {
            val idx = AVATAR_COLORS.indexOfFirst {
                it.value.toString() == savedColor
            }
            if (idx >= 0) selectedColorIndex = idx
        }
    }

    BackHandler(onBack = onBack)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding()
            .verticalScroll(scrollState)
            .padding(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        WorldsBackButton(onBack)

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            WorldsTile(R.drawable.pi_profile, 44.dp)
            Text(
                stringResource(R.string.profile_title),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground
            )
        }

        // Avatar Preview Card
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                val currentColor = AVATAR_COLORS.getOrElse(selectedColorIndex) { AVATAR_COLORS[0] }
                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .clip(CircleShape)
                        .background(currentColor),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = displayName.take(1).uppercase().ifBlank { "W" },
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold
                        ),
                        color = Color.White
                    )
                }

                Spacer(Modifier.height(12.dp))
                Text(displayName.ifBlank { "User" }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(handle.ifBlank { "@user" }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.profile_avatar), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AVATAR_COLORS.forEachIndexed { i, color ->
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(color)
                                .clickable { selectedColorIndex = i }
                                .then(
                                    if (selectedColorIndex == i) Modifier.border(3.dp, MaterialTheme.colorScheme.primary, CircleShape)
                                    else Modifier
                                )
                        )
                    }
                }
            }
        }

        // Profile Details Form
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it.take(64); savedMessage = false },
                    label = { Text(stringResource(R.string.profile_display_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = handle,
                    onValueChange = { handle = it.take(32); savedMessage = false },
                    label = { Text(stringResource(R.string.profile_handle)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = bio,
                    onValueChange = { bio = it.take(240); savedMessage = false },
                    label = { Text(stringResource(R.string.profile_about)) },
                    maxLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )

                if (savedMessage) {
                    Text(
                        stringResource(R.string.profile_saved),
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                Button(
                    onClick = {
                        scope.launch {
                            context.profileDataStore.edit { prefs ->
                                prefs[KEY_DISPLAY_NAME] = displayName.trim()
                                prefs[KEY_HANDLE] = handle.trim()
                                prefs[KEY_BIO] = bio.trim()
                                prefs[KEY_AVATAR_COLOR] = AVATAR_COLORS[selectedColorIndex].value.toString()
                            }
                            savedMessage = true
                        }
                    },
                    modifier = Modifier.align(Alignment.End)
                ) {
                    WorldsActionLabel(R.drawable.ic_check, stringResource(R.string.save))
                }
            }
        }
    }
}
