package worlds.android.discord

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import worlds.android.R
import worlds.android.WorldsGlyph
import java.text.DateFormat
import java.util.Date

private val DiscordBg = Color(0xFF313338)
private val DiscordEmbedBg = Color(0xFF2B2D31)
private val DiscordPrimaryText = Color(0xFFDBDEE1)
private val DiscordSecondaryText = Color(0xFF949BA4)
private val DiscordBlurple = Color(0xFF5865F2)

@Composable
fun DiscordPreview(
    content: String?,
    embeds: List<DiscordEmbed>,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = DiscordBg,
        modifier = modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Discord user / bot header
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Surface(
                    shape = CircleShape,
                    color = DiscordBlurple,
                    modifier = Modifier.size(36.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        WorldsGlyph(R.drawable.ic_message_circle, tint = Color.White)
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        "Worlds",
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp
                    )
                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = DiscordBlurple,
                        modifier = Modifier.padding(horizontal = 2.dp)
                    ) {
                        Text(
                            "BOT",
                            color = Color.White,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
                        )
                    }
                    Text(
                        "Today at " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date()),
                        color = DiscordSecondaryText,
                        fontSize = 12.sp
                    )
                }
            }

            // Raw message content if any
            if (!content.isNullOrBlank()) {
                Text(
                    content,
                    color = DiscordPrimaryText,
                    fontSize = 14.sp,
                    lineHeight = 20.sp
                )
            }

            // Embeds
            for (embed in embeds) {
                EmbedCard(embed)
            }
        }
    }
}

@Composable
private fun EmbedCard(embed: DiscordEmbed) {
    val embedColor = Color(embed.color or 0xFF000000.toInt())

    Surface(
        shape = RoundedCornerShape(6.dp),
        color = DiscordEmbedBg,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            // Left color stripe
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(embedColor)
            )

            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (!embed.title.isNullOrBlank()) {
                    Text(
                        embed.title,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp
                    )
                }

                if (!embed.description.isNullOrBlank()) {
                    Text(
                        embed.description,
                        color = DiscordPrimaryText,
                        fontSize = 13.sp,
                        lineHeight = 18.sp
                    )
                }

                if (embed.fields.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (field in embed.fields) {
                            Text(
                                field.name,
                                color = DiscordPrimaryText,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp
                            )
                            Text(
                                field.value,
                                color = DiscordSecondaryText,
                                fontSize = 12.sp
                            )
                        }
                    }
                }

                if (!embed.footerText.isNullOrBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        embed.footerText,
                        color = DiscordSecondaryText,
                        fontSize = 11.sp
                    )
                }
            }
        }
    }
}
