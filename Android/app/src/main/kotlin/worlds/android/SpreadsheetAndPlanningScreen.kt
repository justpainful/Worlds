package worlds.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import worlds.content.Resource

@Composable
internal fun SpreadsheetScreen(resource: Resource, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val cols = remember { listOf("A", "B", "C", "D", "E", "F", "G", "H") }
    val rows = remember { (1..25).toList() }
    val cells = remember {
        mutableStateMapOf(
            "A1" to "البند / Item", "B1" to "Planned", "C1" to "Actual", "D1" to "Variance",
            "A2" to "Sales Revenue", "B2" to "85000", "C2" to "92400", "D2" to "=C2-B2",
            "A3" to "Subscriptions", "B3" to "35000", "C3" to "38200", "D3" to "=C3-B3",
            "A4" to "Operating Expenses", "B4" to "-48000", "C4" to "-46500", "D4" to "=C4-B4",
            "A5" to "Net Profit", "B5" to "=SUM(B2:B4)", "C5" to "=SUM(C2:C4)", "D5" to "=C5-B5"
        )
    }
    var activeCell by remember { mutableStateOf("A1") }
    var draft by remember { mutableStateOf(cells["A1"] ?: "") }
    var activeSheet by remember { mutableStateOf(0) }
    val sheetNames = remember { mutableStateListOf("Sheet 1", "Summary") }

    fun evaluate(key: String, visited: Set<String> = emptySet()): String {
        val raw = cells[key]?.trim().orEmpty()
        if (raw.isEmpty() || !raw.startsWith("=")) return raw
        if (key in visited) return "#CYCLE!"
        val nextVisited = visited + key
        val expr = raw.drop(1).trim()
        val upper = expr.uppercase()

        fun expandNumbers(range: String): List<Double> {
            val parts = range.split(":").map { it.trim().uppercase() }
            if (parts.size != 2) return emptyList()
            val c1 = cols.indexOf(parts[0].take(1))
            val r1 = parts[0].drop(1).toIntOrNull() ?: return emptyList()
            val c2 = cols.indexOf(parts[1].take(1))
            val r2 = parts[1].drop(1).toIntOrNull() ?: return emptyList()
            if (c1 < 0 || c2 < 0) return emptyList()
            val out = mutableListOf<Double>()
            for (c in minOf(c1, c2)..maxOf(c1, c2)) {
                for (r in minOf(r1, r2)..maxOf(r1, r2)) {
                    evaluate("${cols[c]}$r", nextVisited).toDoubleOrNull()?.let { out.add(it) }
                }
            }
            return out
        }

        if (upper.startsWith("SUM(") && upper.endsWith(")")) {
            val nums = expandNumbers(expr.drop(4).dropLast(1))
            return nums.sum().toLong().toString()
        }
        if (upper.startsWith("AVERAGE(") && upper.endsWith(")")) {
            val nums = expandNumbers(expr.drop(8).dropLast(1))
            return if (nums.isEmpty()) "#DIV/0!" else "%.1f".format(nums.average())
        }
        if ("-" in expr) {
            val parts = expr.split("-", limit = 2).map { it.trim() }
            val a = parts[0].toDoubleOrNull() ?: evaluate(parts[0].uppercase(), nextVisited).toDoubleOrNull() ?: 0.0
            val b = parts[1].toDoubleOrNull() ?: evaluate(parts[1].uppercase(), nextVisited).toDoubleOrNull() ?: 0.0
            return (a - b).toLong().toString()
        }
        if ("+" in expr) {
            val parts = expr.split("+", limit = 2).map { it.trim() }
            val a = parts[0].toDoubleOrNull() ?: evaluate(parts[0].uppercase(), nextVisited).toDoubleOrNull() ?: 0.0
            val b = parts[1].toDoubleOrNull() ?: evaluate(parts[1].uppercase(), nextVisited).toDoubleOrNull() ?: 0.0
            return (a + b).toLong().toString()
        }
        return raw
    }

    Column(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onBack) { Text("Back") }
            Text(
                resource.title.ifBlank { "Spreadsheet" },
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground
            )
        }

        // Formula Bar (Name Box + fx)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Surface(shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Text(
                    activeCell,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold
                )
            }
            Text("fx", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                modifier = Modifier.weight(1f),
                singleLine = true,
                placeholder = { Text("=SUM(B2:B4), =AVERAGE(...), value") }
            )
            Button(onClick = { cells[activeCell] = draft }) {
                Text("Apply")
            }
        }

        // Grid
        Box(
            Modifier
                .weight(1f)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
                .verticalScroll(rememberScrollState())
                .horizontalScroll(rememberScrollState())
        ) {
            Column {
                Row {
                    Box(
                        Modifier
                            .size(44.dp, 30.dp)
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("◢", fontSize = 11.sp)
                    }
                    cols.forEach { col ->
                        Box(
                            Modifier
                                .size(116.dp, 30.dp)
                                .background(MaterialTheme.colorScheme.surfaceVariant)
                                .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(col, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                        }
                    }
                }
                rows.forEach { row ->
                    Row {
                        Box(
                            Modifier
                                .size(44.dp, 30.dp)
                                .background(MaterialTheme.colorScheme.surfaceVariant)
                                .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("$row", fontSize = 11.sp)
                        }
                        cols.forEach { col ->
                            val key = "$col$row"
                            val selected = activeCell == key
                            Box(
                                Modifier
                                    .size(116.dp, 30.dp)
                                    .background(
                                        if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
                                        else Color.Transparent
                                    )
                                    .border(
                                        if (selected) 1.5.dp else 0.5.dp,
                                        if (selected) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.outlineVariant
                                    )
                                    .clickable {
                                        activeCell = key
                                        draft = cells[key].orEmpty()
                                    }
                                    .padding(horizontal = 6.dp),
                                contentAlignment = Alignment.CenterStart
                            ) {
                                Text(evaluate(key), fontSize = 12.sp, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }

        // Multi-sheet tabs
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            sheetNames.forEachIndexed { idx, name ->
                FilterChip(
                    selected = activeSheet == idx,
                    onClick = { activeSheet = idx },
                    label = { Text(name) }
                )
            }
            OutlinedButton(onClick = { sheetNames.add("Sheet ${sheetNames.size + 1}") }) {
                Text("+")
            }
        }
    }
}
