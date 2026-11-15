package worlds.content

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sqrt
import kotlin.math.truncate

/**
 * The workbook lives in `metadata.sheet`, in the same shape the desktop writes
 * (`src/spreadsheet/engine.ts`). Edits touch only the fields they change, so
 * styles, merges and rules set on the desktop survive a round trip.
 */
object SpreadsheetEditing {
    const val DEFAULT_ROWS = 60
    const val DEFAULT_COLS = 26

    fun colToName(col: Int): String {
        var n = col + 1
        val name = StringBuilder()
        while (n > 0) { val rem = (n - 1) % 26; name.insert(0, ('A' + rem)); n = (n - 1) / 26 }
        return name.toString()
    }

    fun nameToCol(name: String): Int = name.uppercase(Locale.ROOT).filter { it in 'A'..'Z' }.fold(0) { acc, c -> acc * 26 + (c - 'A' + 1) } - 1

    fun cellKey(row: Int, col: Int): String = "${colToName(col)}${row + 1}"

    fun newSheet(name: String): JSONObject = JSONObject()
        .put("id", "sh_" + UUID.randomUUID().toString().replace("-", "").take(8))
        .put("name", name).put("rows", DEFAULT_ROWS).put("cols", DEFAULT_COLS)
        .put("cells", JSONObject()).put("colWidths", JSONObject()).put("rowHeights", JSONObject())
        .put("frozenRows", 0).put("frozenCols", 0).put("merges", JSONArray()).put("conditionalRules", JSONArray())

    fun newWorkbook(): JSONObject {
        val first = newSheet("Sheet 1")
        return JSONObject().put("sheets", JSONArray().put(first)).put("activeSheetId", first.getString("id"))
    }

    /** Reads a workbook from resource metadata, with the desktop's defaults and limits. */
    fun workbook(metadata: String): JSONObject {
        val raw = runCatching { JSONObject(metadata).optJSONObject("sheet") }.getOrNull() ?: return newWorkbook()
        val sheets = raw.optJSONArray("sheets")
        if (sheets == null || sheets.length() == 0) return newWorkbook()
        val copy = JSONObject(raw.toString())
        val list = copy.getJSONArray("sheets")
        for (index in 0 until list.length()) {
            val sheet = list.optJSONObject(index) ?: JSONObject().also { list.put(index, it) }
            if (sheet.optString("id").isEmpty()) sheet.put("id", "sh_${index + 1}")
            if (sheet.optString("name").isBlank()) sheet.put("name", "Sheet ${index + 1}")
            val rows = sheet.optInt("rows", 0); sheet.put("rows", if (rows >= 10) min(500, rows) else DEFAULT_ROWS)
            val cols = sheet.optInt("cols", 0); sheet.put("cols", if (cols >= 5) min(100, cols) else DEFAULT_COLS)
            if (sheet.optJSONObject("cells") == null) sheet.put("cells", JSONObject())
            if (sheet.optJSONObject("colWidths") == null) sheet.put("colWidths", JSONObject())
            if (sheet.optJSONObject("rowHeights") == null) sheet.put("rowHeights", JSONObject())
            sheet.put("frozenRows", max(0, sheet.optInt("frozenRows", 0)))
            sheet.put("frozenCols", max(0, sheet.optInt("frozenCols", 0)))
            if (sheet.optJSONArray("merges") == null) sheet.put("merges", JSONArray())
            if (sheet.optJSONArray("conditionalRules") == null) sheet.put("conditionalRules", JSONArray())
        }
        val active = copy.optString("activeSheetId")
        if ((0 until list.length()).none { list.getJSONObject(it).getString("id") == active }) copy.put("activeSheetId", list.getJSONObject(0).getString("id"))
        return copy
    }

    fun sheets(workbook: JSONObject): List<JSONObject> = workbook.getJSONArray("sheets").let { array -> (0 until array.length()).map { array.getJSONObject(it) } }

    fun activeSheet(workbook: JSONObject): JSONObject = sheets(workbook).first { it.getString("id") == workbook.getString("activeSheetId") }

    fun rawValue(sheet: JSONObject, key: String): String = sheet.getJSONObject("cells").optJSONObject(key)?.optString("v").orEmpty()

    /** Sets a cell's input. An emptied cell with no style or note is removed, as on the desktop. */
    fun setCell(sheet: JSONObject, key: String, raw: String) {
        val cells = sheet.getJSONObject("cells")
        val cell = cells.optJSONObject(key)
        if (raw.isEmpty() && (cell == null || (cell.opt("s") == null && cell.opt("note") == null))) { cells.remove(key); return }
        cells.put(key, (cell ?: JSONObject()).put("v", raw))
    }

    fun addSheet(workbook: JSONObject): JSONObject {
        val existing = sheets(workbook).map { it.getString("name").lowercase(Locale.ROOT) }.toSet()
        var number = existing.size + 1
        while ("sheet $number" in existing) number++
        val sheet = newSheet("Sheet $number")
        workbook.getJSONArray("sheets").put(sheet)
        workbook.put("activeSheetId", sheet.getString("id"))
        return sheet
    }

    /** Puts the workbook back into metadata, leaving every other key alone. */
    fun merge(metadata: String, workbook: String): String = JSONObject(metadata).put("sheet", JSONObject(workbook)).toString()
}

data class SpreadsheetCell(val raw: String, val display: String, val isNumber: Boolean, val error: String?)

/** A faithful port of the desktop `evaluateWorkbook`, so a formula gives the same answer on every device. */
class SpreadsheetEvaluator(private val workbook: JSONObject) {
    private class FormulaError(val code: String) : Exception(code, null, false, false)
    private class Matrix(val rows: List<List<Any?>>)
    private sealed interface Token
    private data class Num(val value: Double) : Token
    private data class Str(val value: String) : Token
    private data class Ident(val value: String) : Token
    private data class Op(val value: String) : Token
    private data class Paren(val value: Char) : Token
    private object Comma : Token
    private class Ref(val sheet: String?, val row: Int, val col: Int)
    private class Value(val raw: String, val scalar: Any?, val cell: SpreadsheetCell)

    private val sheets = SpreadsheetEditing.sheets(workbook)
    private val results = HashMap<String, HashMap<String, Value>>()
    private val visiting = HashSet<String>()

    /** Evaluates every stored cell. Result maps sheet id to cell key to its display. */
    fun evaluate(): Map<String, Map<String, SpreadsheetCell>> {
        for (sheet in sheets) {
            val keys = sheet.getJSONObject("cells").keys()
            while (keys.hasNext()) {
                val ref = parseRef(keys.next()) ?: continue
                try { evalCell(sheet, ref.row, ref.col) } catch (_: StackOverflowError) { visiting.clear() }
            }
        }
        return sheets.associate { sheet -> sheet.getString("id") to results[sheet.getString("id")].orEmpty().mapValues { it.value.cell } }
    }

    private fun findSheet(name: String): JSONObject? = sheets.firstOrNull { it.getString("id") == name || it.getString("name").equals(name, ignoreCase = true) }

    private fun parseRef(token: String): Ref? {
        val match = CELL_REF.matchEntire(token.trim()) ?: return null
        val sheet = match.groupValues[1].ifEmpty { match.groupValues[2] }.ifEmpty { null }
        val col = SpreadsheetEditing.nameToCol(match.groupValues[4])
        val row = match.groupValues[6].toInt() - 1
        if (row < 0 || col < 0 || row > 99999 || col > 16384) return null
        return Ref(sheet, row, col)
    }

    private fun store(sheet: JSONObject, key: String, value: Value): Value { results.getOrPut(sheet.getString("id")) { HashMap() }[key] = value; return value }

    private fun evalCell(sheet: JSONObject, row: Int, col: Int): Value {
        val key = SpreadsheetEditing.cellKey(row, col)
        results[sheet.getString("id")]?.get(key)?.let { return it }
        val visit = "${sheet.getString("id")}:$key"
        if (visit in visiting) throw FormulaError("#CYCLE!")
        val cell = sheet.getJSONObject("cells").optJSONObject(key)
        val raw = cell?.optString("v").orEmpty()
        val style = cell?.optJSONObject("s")
        if (!raw.startsWith("=")) {
            val scalar = parseRawScalar(raw)
            return store(sheet, key, Value(raw, scalar, SpreadsheetCell(raw, format(scalar, style), scalar is Double, null)))
        }
        visiting.add(visit)
        try {
            val result = Parser(raw.drop(1).trim(), sheet, row, col).run()
            val scalar = if (result is Matrix) result.rows.firstOrNull()?.firstOrNull() else result
            if (scalar is String && scalar.startsWith("#") && scalar.last() in "!/?") return store(sheet, key, Value(raw, scalar, SpreadsheetCell(raw, scalar, false, scalar)))
            return store(sheet, key, Value(raw, scalar, SpreadsheetCell(raw, format(scalar, style), scalar is Double && scalar.isFinite(), null)))
        } catch (error: FormulaError) {
            return store(sheet, key, Value(raw, error.code, SpreadsheetCell(raw, error.code, false, error.code)))
        } catch (_: RuntimeException) {
            return store(sheet, key, Value(raw, "#ERROR!", SpreadsheetCell(raw, "#ERROR!", false, "#ERROR!")))
        } finally { visiting.remove(visit) }
    }

    private fun tokenize(expr: String): List<Token> {
        val tokens = ArrayList<Token>()
        var i = 0
        while (i < expr.length) {
            val ch = expr[i]
            when {
                ch.isWhitespace() -> i++
                ch == '"' -> {
                    val text = StringBuilder(); i++
                    while (i < expr.length) {
                        if (expr[i] == '"' && expr.getOrNull(i + 1) == '"') { text.append('"'); i += 2 }
                        else if (expr[i] == '"') { i++; break }
                        else text.append(expr[i++])
                    }
                    tokens.add(Str(text.toString()))
                }
                ch == '(' || ch == ')' -> { tokens.add(Paren(ch)); i++ }
                // The Arabic keyboard's comma and semicolon separate arguments too.
                ch == ',' || ch == ';' || ch == '،' || ch == '؛' -> { tokens.add(Comma); i++ }
                ch == '٪' -> { tokens.add(Op("%")); i++ }
                expr.startsWith("<=", i) || expr.startsWith(">=", i) || expr.startsWith("<>", i) || expr.startsWith("!=", i) -> { tokens.add(Op(expr.substring(i, i + 2))); i += 2 }
                ch in "+-*/^&=<>:%" -> { tokens.add(Op(ch.toString())); i++ }
                ch.isAnyDigit() || ((ch == '.' || ch == '٫') && expr.getOrNull(i + 1)?.isAnyDigit() == true) -> {
                    val number = StringBuilder()
                    while (i < expr.length && (expr[i].isAnyDigit() || expr[i] in ".٫eE+-")) {
                        if ((expr[i] == '+' || expr[i] == '-') && number.lastOrNull()?.let { it == 'e' || it == 'E' } != true) break
                        number.append(westernDigits(expr[i++].toString()))
                    }
                    tokens.add(Num(number.toString().toDoubleOrNull() ?: throw FormulaError("#VALUE!")))
                }
                ch == '\'' || ch.isIdentStart() -> {
                    val ident = StringBuilder()
                    if (ch == '\'') {
                        ident.append(expr[i++])
                        while (i < expr.length && expr[i] != '\'') ident.append(expr[i++])
                        if (i < expr.length) ident.append(expr[i++])
                    }
                    while (i < expr.length && expr[i].isIdentPart()) ident.append(expr[i++])
                    tokens.add(Ident(ident.toString()))
                }
                else -> throw FormulaError("#VALUE!")
            }
        }
        return tokens
    }

    private inner class Parser(expr: String, private val sheet: JSONObject, private val row: Int, private val col: Int) {
        private val tokens = tokenize(expr)
        private var pos = 0
        private fun peek() = tokens.getOrNull(pos)
        private fun consume(): Token? = tokens.getOrNull(pos++)
        private fun peekOp(vararg values: String) = (peek() as? Op)?.value?.takeIf { it in values }

        fun run(): Any? { val out = comparison(); if (pos < tokens.size) throw FormulaError("#VALUE!"); return out }

        private fun comparison(): Any? {
            var left = concat()
            while (peekOp("=", "<>", "!=", "<", "<=", ">", ">=") != null) {
                val op = (consume() as Op).value
                left = compare(unwrap(left), unwrap(concat()), op)
            }
            return left
        }
        private fun concat(): Any? {
            var left = additive()
            while (peekOp("&") != null) { consume(); val right = additive(); left = jsString(unwrap(left)) + jsString(unwrap(right)) }
            return left
        }
        private fun additive(): Any? {
            var left = multiplicative()
            while (peekOp("+", "-") != null) {
                val op = (consume() as Op).value
                val right = multiplicative()
                val a = number(unwrap(left), true); val b = number(unwrap(right), true)
                left = if (op == "+") a + b else a - b
            }
            return left
        }
        private fun multiplicative(): Any? {
            var left = power()
            while (peekOp("*", "/") != null) {
                val op = (consume() as Op).value
                val right = power()
                val a = number(unwrap(left), true); val b = number(unwrap(right), true)
                if (op == "/" && b == 0.0) throw FormulaError("#DIV/0!")
                left = if (op == "/") a / b else a * b
            }
            return left
        }
        private fun power(): Any? {
            var left = unary()
            while (peekOp("^") != null) { consume(); val right = unary(); left = number(unwrap(left), true).pow(number(unwrap(right), true)) }
            return left
        }
        private fun unary(): Any? {
            if (peekOp("+", "-") != null) {
                val op = (consume() as Op).value
                val value = number(unwrap(unary()), true)
                return if (op == "-") -value else value
            }
            var atom = rangeOrPrimary()
            while (peekOp("%") != null) { consume(); atom = number(unwrap(atom), true) / 100 }
            return atom
        }
        private fun rangeOrPrimary(): Any? {
            val next = tokens.getOrNull(pos + 1)
            if (peek() is Ident && next is Op && next.value == ":") {
                val start = (consume() as Ident).value
                consume()
                val end = (consume() as? Ident)?.value ?: throw FormulaError("#REF!")
                val a = parseRef(start) ?: throw FormulaError("#REF!")
                val b = parseRef(end) ?: throw FormulaError("#REF!")
                val target = if (a.sheet != null) findSheet(a.sheet) ?: throw FormulaError("#REF!") else sheet
                return Matrix((min(a.row, b.row)..max(a.row, b.row)).map { r ->
                    (min(a.col, b.col)..max(a.col, b.col)).map { c ->
                        val value = evalCell(target, r, c)
                        value.cell.error?.let { throw FormulaError(it) }
                        value.scalar
                    }
                })
            }
            return primary()
        }
        private fun primary(): Any? {
            when (val token = peek() ?: throw FormulaError("#VALUE!")) {
                is Num -> { consume(); return token.value }
                is Str -> { consume(); return token.value }
                is Paren -> if (token.value == '(') {
                    consume(); val inner = comparison(); closeParen(); return inner
                }
                is Ident -> {
                    consume()
                    val upper = token.value.uppercase(Locale.ROOT)
                    if ((peek() as? Paren)?.value == '(') {
                        consume()
                        if (upper == "IF") return ifCall()
                        if (upper == "IFERROR" || upper == "IFNA") return ifErrorCall(upper)
                        val args = ArrayList<Any?>()
                        if ((peek() as? Paren)?.value != ')') while (true) { args.add(comparison()); if (peek() === Comma) consume() else break }
                        closeParen()
                        return call(upper, args, row, col)
                    }
                    if (upper == "TRUE") return true
                    if (upper == "FALSE") return false
                    if (upper.startsWith("#")) throw FormulaError(upper)
                    val ref = parseRef(token.value) ?: throw FormulaError("#NAME?")
                    val target = if (ref.sheet != null) findSheet(ref.sheet) ?: throw FormulaError("#REF!") else sheet
                    val value = evalCell(target, ref.row, ref.col)
                    value.cell.error?.let { throw FormulaError(it) }
                    return value.scalar
                }
                else -> {}
            }
            throw FormulaError("#VALUE!")
        }
        private fun ifCall(): Any? {
            val condition = comparison()
            if (peek() !== Comma) throw FormulaError("#VALUE!")
            consume()
            if (truthy(unwrap(condition))) {
                val value = comparison()
                if (peek() === Comma) { consume(); skip() }
                closeParen()
                return value
            }
            skip()
            var value: Any? = false
            if (peek() === Comma) { consume(); value = comparison() }
            closeParen()
            return value
        }
        private fun ifErrorCall(name: String): Any? {
            var primary: Any? = null
            var caught: String? = null
            try { primary = comparison() } catch (error: FormulaError) { caught = error.code }
            if (peek() !== Comma) throw FormulaError("#VALUE!")
            consume()
            val fallback = comparison()
            closeParen()
            if (caught != null) { if (name == "IFNA" && caught != "#N/A") throw FormulaError(caught); return fallback }
            return primary
        }
        private fun skip() {
            var depth = 0
            while (pos < tokens.size) {
                val token = tokens[pos]
                if (token is Paren && token.value == '(') depth++
                else if (token is Paren && token.value == ')') { if (depth == 0) break; depth-- }
                else if (token === Comma && depth == 0) break
                pos++
            }
        }
        private fun closeParen() { if ((consume() as? Paren)?.value != ')') throw FormulaError("#VALUE!") }
    }

    private fun unwrap(arg: Any?): Any? = if (arg is Matrix) arg.rows.firstOrNull()?.firstOrNull() else arg
    private fun flatten(args: List<Any?>): List<Any?> = args.flatMap { if (it is Matrix) it.rows.flatten() else listOf(it) }
    private fun truthy(value: Any?): Boolean = when (value) { null -> false; is Boolean -> value; is Double -> value != 0.0 && !value.isNaN(); is String -> value.isNotEmpty(); else -> true }

    private fun jsNumber(text: String): Double {
        val trimmed = text.trim()
        return if (trimmed.isEmpty()) 0.0 else if (NUMERIC.matches(trimmed)) trimmed.toDouble() else Double.NaN
    }
    private fun number(value: Any?, strict: Boolean = false): Double {
        when (value) { is Double -> return value; is Boolean -> return if (value) 1.0 else 0.0; null, "" -> return 0.0 }
        val cleaned = westernDigits(value.toString()).replace(",", "").trim()
        if (cleaned.endsWith("%")) { val n = jsNumber(cleaned.dropLast(1)); if (!n.isNaN()) return n / 100 }
        val n = jsNumber(cleaned)
        if (n.isNaN()) { if (strict) throw FormulaError("#VALUE!"); return 0.0 }
        return n
    }
    private fun numbers(args: List<Any?>): List<Double> {
        val out = ArrayList<Double>()
        fun text(value: String) { if (value.isNotBlank()) { val n = jsNumber(value.replace(",", "")); if (!n.isNaN()) out.add(n) } }
        for (arg in args) when (arg) {
            is Matrix -> for (r in arg.rows) for (v in r) { if (v is Double && v.isFinite()) out.add(v) else if (v is String) text(v) }
            is Double -> if (arg.isFinite()) out.add(arg)
            is Boolean -> out.add(if (arg) 1.0 else 0.0)
            is String -> text(arg)
        }
        return out
    }
    private fun jsString(value: Any?): String = when (value) {
        null -> ""
        is Double -> if (value.isFinite() && value == floor(value) && abs(value) < 1e21) BigDecimal(value).toPlainString() else value.toString()
        else -> value.toString()
    }
    private fun numericOrNaN(value: Any?): Double = when { value is Double -> value; value != null && value.toString().isNotBlank() -> jsNumber(value.toString().replace(",", "")); else -> Double.NaN }
    private fun compare(a: Any?, b: Any?, op: String): Boolean {
        val an = numericOrNaN(a); val bn = numericOrNaN(b)
        if (!an.isNaN() && !bn.isNaN()) return when (op) { "=" -> an == bn; "<>", "!=" -> an != bn; "<" -> an < bn; "<=" -> an <= bn; ">" -> an > bn; ">=" -> an >= bn; else -> false }
        val x = jsString(a).lowercase(Locale.ROOT); val y = jsString(b).lowercase(Locale.ROOT)
        return when (op) { "=" -> x == y; "<>", "!=" -> x != y; "<" -> x < y; "<=" -> x <= y; ">" -> x > y; ">=" -> x >= y; else -> false }
    }
    private fun matcher(criteria: Any?): (Any?) -> Boolean {
        if (criteria is Double) return { v -> val n = if (v is Double) v else jsNumber(jsString(v).replace(",", "")); !n.isNaN() && n == criteria }
        if (criteria is Boolean) return { v -> truthy(v) == criteria }
        val text = jsString(criteria).trim()
        CRITERIA.matchEntire(text)?.let { match ->
            val op = match.groupValues[1]; val rhs = match.groupValues[2].trim()
            val rhsNumber = if (rhs.isNotEmpty()) jsNumber(rhs.replace(",", "")) else Double.NaN
            return { v ->
                val vn = numericOrNaN(v)
                if (!rhsNumber.isNaN() && !vn.isNaN()) compare(vn, rhsNumber, op)
                else { val l = jsString(v).lowercase(Locale.ROOT); val r = rhs.lowercase(Locale.ROOT); when (op) { "=" -> l == r; "<>", "!=" -> l != r; ">" -> l > r; ">=" -> l >= r; "<" -> l < r; "<=" -> l <= r; else -> false } }
            }
        }
        if ('*' in text || '?' in text) {
            val pattern = Regex(text.map { c -> when (c) { '*' -> ".*"; '?' -> "."; else -> Regex.escape(c.toString()) } }.joinToString(""), RegexOption.IGNORE_CASE)
            return { v -> pattern.matches(jsString(v)) }
        }
        val maybe = if (text.isNotEmpty()) jsNumber(text.replace(",", "")) else Double.NaN
        if (!maybe.isNaN()) return { v -> val n = if (v is Double) v else jsNumber(jsString(v).replace(",", "")); (!n.isNaN() && n == maybe) || jsString(v).equals(text, ignoreCase = true) }
        return { v -> jsString(v).equals(text, ignoreCase = true) }
    }
    private fun date(value: Any?): LocalDateTime {
        if (value is Double) {
            if (value > 1e10) return LocalDateTime.ofEpochSecond((value / 1000).toLong(), 0, ZoneOffset.UTC)
            return LocalDate.of(1899, 12, 30).atStartOfDay().plusSeconds((value * 86400).toLong())
        }
        val text = jsString(value).trim()
        return runCatching { LocalDate.parse(text).atStartOfDay() }.recoverCatching { LocalDateTime.parse(text.replace(' ', 'T')) }.getOrElse { throw FormulaError("#VALUE!") }
    }
    private fun jsRound(value: Double) = floor(value + 0.5)
    private fun arg(args: List<Any?>, index: Int, default: Any? = null): Any? = if (index < args.size) unwrap(args[index]) else default
    private fun present(args: List<Any?>, index: Int): Boolean = index < args.size && truthyArg(args[index])
    /** JavaScript `args[i] ? ...`: a range is truthy, a scalar follows truthiness. */
    private fun truthyArg(value: Any?): Boolean = if (value is Matrix) true else truthy(value)
    private fun need(args: List<Any?>, count: Int) { if (args.size < count) throw FormulaError("#VALUE!") }
    private fun table(value: Any?): List<List<Any?>> = if (value is Matrix) value.rows else listOf(listOf(value))
    private fun text(args: List<Any?>, index: Int): String = jsString(arg(args, index))
    private fun integer(args: List<Any?>, index: Int, default: Double = 0.0): Int = floor(number(arg(args, index, default), true)).toInt()
    private fun digits(args: List<Any?>): Double = 10.0.pow(if (present(args, 1)) floor(number(arg(args, 1), true)) else 0.0)

    private fun call(name: String, args: List<Any?>, row: Int, col: Int): Any? {
        when (name) {
            "SUM" -> return numbers(args).sum()
            "AVERAGE", "AVG" -> { val n = numbers(args); if (n.isEmpty()) throw FormulaError("#DIV/0!"); return n.sum() / n.size }
            "MIN" -> return numbers(args).minOrNull() ?: 0.0
            "MAX" -> return numbers(args).maxOrNull() ?: 0.0
            "COUNT" -> return numbers(args).size.toDouble()
            "COUNTA" -> return flatten(args).count { it != null && jsString(it).isNotBlank() }.toDouble()
            "COUNTBLANK" -> return flatten(args).count { it == null || jsString(it).isBlank() }.toDouble()
            "PRODUCT" -> { val n = numbers(args); return if (n.isEmpty()) 0.0 else n.fold(1.0) { a, b -> a * b } }
            "SUMPRODUCT" -> {
                if (args.isEmpty()) return 0.0
                val lists = args.map { a -> flatten(listOf(a)).map { number(it) } }
                if (lists.any { it.size != lists[0].size }) throw FormulaError("#VALUE!")
                return lists[0].indices.sumOf { i -> lists.fold(1.0) { p, l -> p * l[i] } }
            }
            "MEDIAN" -> { val n = numbers(args).sorted(); if (n.isEmpty()) throw FormulaError("#NUM!"); val m = n.size / 2; return if (n.size % 2 != 0) n[m] else (n[m - 1] + n[m]) / 2 }
            "MODE" -> { val n = numbers(args); if (n.isEmpty()) throw FormulaError("#N/A"); val counts = HashMap<Double, Int>(); var best = n[0]; var top = 0; for (v in n) { val c = (counts[v] ?: 0) + 1; counts[v] = c; if (c > top) { top = c; best = v } }; return best }
            "STDEV", "STDEVP", "VAR", "VARP" -> {
                val n = numbers(args); val denominator = if (name == "STDEV" || name == "VAR") n.size - 1 else n.size
                if (denominator <= 0) throw FormulaError("#DIV/0!")
                val mean = n.sum() / n.size; val variance = n.sumOf { (it - mean).pow(2) } / denominator
                return if (name.startsWith("STDEV")) sqrt(variance) else variance
            }
            "PERCENTILE" -> { need(args, 2); val n = numbers(listOf(args[0])).sorted(); val k = number(arg(args, 1), true); if (n.isEmpty() || k < 0 || k > 1) throw FormulaError("#NUM!"); val i = k * (n.size - 1); val lo = floor(i).toInt(); val hi = ceil(i).toInt(); return n[lo] + (n[hi] - n[lo]) * (i - lo) }
            "LARGE", "SMALL" -> { need(args, 2); val n = numbers(listOf(args[0])).let { if (name == "LARGE") it.sortedDescending() else it.sorted() }; val k = integer(args, 1); if (k < 1 || k > n.size) throw FormulaError("#NUM!"); return n[k - 1] }
            "RANK" -> { need(args, 2); val target = number(arg(args, 0), true); val ascending = present(args, 2) && number(arg(args, 2)) != 0.0; val n = numbers(listOf(args[1])).let { if (ascending) it.sorted() else it.sortedDescending() }; val i = n.indexOf(target); if (i == -1) throw FormulaError("#N/A"); return (i + 1).toDouble() }
            "SUMIF" -> { need(args, 2); val range = flatten(listOf(args[0])); val test = matcher(arg(args, 1)); val sums = if (present(args, 2)) flatten(listOf(args[2])) else range; return range.indices.filter { test(range[it]) }.sumOf { number(sums.getOrNull(it) ?: 0.0) } }
            "COUNTIF" -> { need(args, 2); val test = matcher(arg(args, 1)); return flatten(listOf(args[0])).count(test).toDouble() }
            "AVERAGEIF" -> { need(args, 2); val range = flatten(listOf(args[0])); val test = matcher(arg(args, 1)); val values = if (present(args, 2)) flatten(listOf(args[2])) else range; val hits = range.indices.filter { test(range[it]) }; if (hits.isEmpty()) throw FormulaError("#DIV/0!"); return hits.sumOf { number(values.getOrNull(it) ?: 0.0) } / hits.size }
            "IFS" -> { var i = 0; while (i + 1 < args.size) { if (truthy(unwrap(args[i]))) return args[i + 1]; i += 2 }; throw FormulaError("#N/A") }
            "SWITCH" -> { need(args, 3); val expr = arg(args, 0); var i = 1; while (i + 1 < args.size) { if (compare(expr, unwrap(args[i]), "=")) return args[i + 1]; i += 2 }; if (args.size % 2 == 0) return args.last(); throw FormulaError("#N/A") }
            "CHOOSE" -> { need(args, 2); val i = integer(args, 0); if (i < 1 || i >= args.size) throw FormulaError("#VALUE!"); return args[i] }
            "AND" -> return flatten(args).all(::truthy)
            "OR" -> return flatten(args).any(::truthy)
            "XOR" -> return flatten(args).count(::truthy) % 2 == 1
            "NOT" -> return !truthy(arg(args, 0, false))
            "ISBLANK" -> { val v = arg(args, 0); return v == null || v == "" }
            "ISNUMBER" -> { val v = arg(args, 0); return v is Double && v.isFinite() }
            "ISTEXT" -> return arg(args, 0) is String
            "ABS" -> return abs(number(arg(args, 0, 0.0), true))
            "SIGN" -> return sign(number(arg(args, 0, 0.0), true))
            "SQRT" -> { val n = number(arg(args, 0, 0.0), true); if (n < 0) throw FormulaError("#NUM!"); return sqrt(n) }
            "POWER" -> return number(arg(args, 0, 0.0), true).pow(number(arg(args, 1, 1.0), true))
            "EXP" -> return exp(number(arg(args, 0, 0.0), true))
            "LN" -> { val n = number(arg(args, 0, 0.0), true); if (n <= 0) throw FormulaError("#NUM!"); return ln(n) }
            "LOG", "LOG10" -> { val n = number(arg(args, 0, 0.0), true); val base = if (name == "LOG10") 10.0 else if (present(args, 1)) number(arg(args, 1), true) else 10.0; if (n <= 0 || base <= 0 || base == 1.0) throw FormulaError("#NUM!"); return ln(n) / ln(base) }
            "MOD" -> { val n = number(arg(args, 0, 0.0), true); val d = number(arg(args, 1, 0.0), true); if (d == 0.0) throw FormulaError("#DIV/0!"); return n - d * floor(n / d) }
            "INT", "FLOOR" -> return floor(number(arg(args, 0, 0.0), true))
            "CEILING" -> return ceil(number(arg(args, 0, 0.0), true))
            "TRUNC" -> return truncate(number(arg(args, 0, 0.0), true))
            "ROUND" -> { val n = number(arg(args, 0, 0.0), true); val f = digits(args); return jsRound(n * f) / f }
            "ROUNDUP" -> { val n = number(arg(args, 0, 0.0), true); val f = digits(args); return (if (n >= 0) ceil(n * f) else floor(n * f)) / f }
            "ROUNDDOWN" -> { val n = number(arg(args, 0, 0.0), true); val f = digits(args); return truncate(n * f) / f }
            "PI" -> return Math.PI
            "RAND" -> return Math.random()
            "RANDBETWEEN" -> { val lo = ceil(number(arg(args, 0, 0.0), true)); val hi = floor(number(arg(args, 1, 1.0), true)); if (lo > hi) throw FormulaError("#NUM!"); return floor(Math.random() * (hi - lo + 1)) + lo }
            "VLOOKUP" -> {
                need(args, 3); val needle = arg(args, 0); val rows = table(args[1]); val index = integer(args, 2) - 1
                val approximate = args.size > 3 && truthy(unwrap(args[3]))
                if (index < 0 || (rows.isNotEmpty() && index >= rows[0].size)) throw FormulaError("#REF!")
                rows.firstOrNull { compare(it[0], needle, "=") }?.let { return it.getOrNull(index) }
                if (approximate) rows.lastOrNull { compare(it[0], needle, "<=") }?.let { return it.getOrNull(index) }
                throw FormulaError("#N/A")
            }
            "HLOOKUP" -> { need(args, 3); val needle = arg(args, 0); val rows = table(args[1]); val index = integer(args, 2) - 1; if (index < 0 || index >= rows.size) throw FormulaError("#REF!"); val c = rows.firstOrNull().orEmpty().indexOfFirst { compare(it, needle, "=") }; if (c >= 0) return rows[index].getOrNull(c); throw FormulaError("#N/A") }
            "XLOOKUP" -> { need(args, 3); val needle = arg(args, 0); val keys = flatten(listOf(args[1])); val values = flatten(listOf(args[2])); val i = keys.indexOfFirst { compare(it, needle, "=") }; if (i >= 0) return values.getOrNull(i); if (args.size > 3) return unwrap(args[3]); throw FormulaError("#N/A") }
            "INDEX" -> { need(args, 2); val rows = table(args[0]); val r = integer(args, 1) - 1; val c = if (args.size > 2) integer(args, 2) - 1 else 0; if (r < 0 || c < 0 || r >= rows.size || c >= (rows.firstOrNull()?.size ?: 0)) throw FormulaError("#REF!"); return rows[r][c] }
            "MATCH" -> { need(args, 2); val needle = arg(args, 0); val i = flatten(listOf(args[1])).indexOfFirst { compare(it, needle, "=") }; if (i >= 0) return (i + 1).toDouble(); throw FormulaError("#N/A") }
            "ROW" -> return (row + 1).toDouble()
            "COLUMN" -> return (col + 1).toDouble()
            "ROWS" -> return (args.getOrNull(0) as? Matrix)?.rows?.size?.toDouble() ?: 1.0
            "COLUMNS" -> return (args.getOrNull(0) as? Matrix)?.rows?.firstOrNull()?.size?.toDouble() ?: 1.0
            "PMT" -> { need(args, 3); val rate = number(arg(args, 0), true); val n = number(arg(args, 1), true); val pv = number(arg(args, 2), true); val fv = if (present(args, 3)) number(arg(args, 3), true) else 0.0; val type = paymentType(args); if (n == 0.0) throw FormulaError("#DIV/0!"); if (rate == 0.0) return -(pv + fv) / n; val f = (1 + rate).pow(n); return (-rate * (pv * f + fv)) / ((1 + rate * type) * (f - 1)) }
            "FV" -> { need(args, 3); val rate = number(arg(args, 0), true); val n = number(arg(args, 1), true); val pmt = number(arg(args, 2), true); val pv = if (present(args, 3)) number(arg(args, 3), true) else 0.0; val type = paymentType(args); if (rate == 0.0) return -(pv + pmt * n); val f = (1 + rate).pow(n); return -(pv * f + (pmt * (1 + rate * type) * (f - 1)) / rate) }
            "PV" -> { need(args, 3); val rate = number(arg(args, 0), true); val n = number(arg(args, 1), true); val pmt = number(arg(args, 2), true); val fv = if (present(args, 3)) number(arg(args, 3), true) else 0.0; val type = paymentType(args); if (rate == 0.0) return -(fv + pmt * n); val f = (1 + rate).pow(n); return -(fv + (pmt * (1 + rate * type) * (f - 1)) / rate) / f }
            "NPV" -> { need(args, 2); val rate = number(arg(args, 0), true); return numbers(args.drop(1)).withIndex().sumOf { (i, cf) -> cf / (1 + rate).pow(i + 1) } }
            "LEN" -> return text(args, 0).length.toDouble()
            "TRIM" -> return text(args, 0).trim().replace(Regex("\\s+"), " ")
            "UPPER" -> return text(args, 0).uppercase(Locale.ROOT)
            "LOWER" -> return text(args, 0).lowercase(Locale.ROOT)
            "PROPER" -> return Regex("\\b\\w").replace(text(args, 0)) { it.value.uppercase(Locale.ROOT) }
            "CONCAT", "CONCATENATE" -> return flatten(args).joinToString("") { jsString(it) }
            "TEXTJOIN" -> { need(args, 3); val items = flatten(args.drop(2)).map { jsString(it) }; return (if (truthy(arg(args, 1))) items.filter { it.isNotEmpty() } else items).joinToString(text(args, 0)) }
            "LEFT" -> return text(args, 0).take(if (args.size > 1) max(0, integer(args, 1)) else 1)
            "RIGHT" -> return text(args, 0).takeLast(if (args.size > 1) max(0, integer(args, 1)) else 1)
            "MID" -> { need(args, 3); val s = text(args, 0); val start = max(1, integer(args, 1)) - 1; val length = max(0, integer(args, 2)); return if (start >= s.length) "" else s.substring(start, min(s.length, start + length)) }
            "SUBSTITUTE" -> { need(args, 3); val old = text(args, 1); return if (old.isEmpty()) text(args, 0) else text(args, 0).replace(old, text(args, 2)) }
            "REPT" -> return text(args, 0).repeat(max(0, min(1000, integer(args, 1, 1.0))))
            "VALUE" -> return number(arg(args, 0, 0.0), true)
            "TEXT" -> return jsString(arg(args, 0, ""))
            "EXACT" -> return text(args, 0) == text(args, 1)
            "TODAY" -> return LocalDate.now().toString()
            "NOW" -> return LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
            "DATE" -> return LocalDate.of(integer(args, 0, 2026.0), 1, 1).plusMonths(integer(args, 1, 1.0).toLong() - 1).plusDays(integer(args, 2, 1.0).toLong() - 1).toString()
            "YEAR" -> return date(arg(args, 0)).year.toDouble()
            "MONTH" -> return date(arg(args, 0)).monthValue.toDouble()
            "DAY" -> return date(arg(args, 0)).dayOfMonth.toDouble()
            "DAYS" -> return ChronoUnit.DAYS.between(date(arg(args, 1)), date(arg(args, 0))).toDouble()
            "DATEDIF" -> {
                val start = date(arg(args, 0)); val end = date(arg(args, 1)); val unit = jsString(arg(args, 2, "D")).uppercase(Locale.ROOT)
                val days = ChronoUnit.DAYS.between(start, end).toDouble()
                return when (unit) { "Y" -> floor(days / 365.25); "M" -> ((end.year - start.year) * 12 + (end.monthValue - start.monthValue)).toDouble(); else -> days }
            }
            else -> throw FormulaError("#NAME?")
        }
    }
    private fun paymentType(args: List<Any?>): Double = if (present(args, 4) && number(arg(args, 4), true) != 0.0) 1.0 else 0.0

    companion object {
        private val CELL_REF = Regex("^(?:(?:'([^']+)'|([A-Za-z0-9_\\u0600-\\u06FF]+))!)?(\\$?)([A-Za-z]{1,3})(\\$?)(\\d{1,5})$")
        private val NUMERIC = Regex("^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?$")
        private val CRITERIA = Regex("^(<=|>=|<>|!=|<|>|=)(.*)$")
        private val PLAIN = Regex("^-?\\d+(?:\\.\\d+)?$")
        private val GROUPED = Regex("^-?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?$")
        private val PERCENT = Regex("^-?\\d+(?:\\.\\d+)?%$")
        private fun Char.isAsciiDigit() = this in '0'..'9'
        private fun Char.isArabic() = this in '؀'..'ۿ'
        private fun Char.isIdentStart() = this in 'A'..'Z' || this in 'a'..'z' || this == '_' || this == '$' || this == '#' || isArabic()
        /** Arabic and Persian digits count as digits in numbers. */
        private fun Char.isAnyDigit() = isAsciiDigit() || this in '٠'..'٩' || this in '۰'..'۹'
        // Arabic letters and digits belong to names; the Arabic comma, semicolon,
        // percent and decimal marks end them, as their Western twins do.
        private fun Char.isIdentPart() = this in 'A'..'Z' || this in 'a'..'z' || isAsciiDigit() || this in "_$!.?" ||
            (isArabic() && this != '،' && this != '؛' && this !in '٪'..'٬')

        /**
         * Arabic and Persian digits as Western ones, with the Arabic decimal point,
         * thousands separator and percent sign, so "٩٥" and "٣٫٥٪" count as numbers.
         */
        fun westernDigits(s: String): String = buildString(s.length) {
            for (c in s) append(
                when (c) {
                    in '٠'..'٩' -> '0' + (c - '٠')
                    in '۰'..'۹' -> '0' + (c - '۰')
                    '٫' -> '.'
                    '٬' -> ','
                    '٪' -> '%'
                    else -> c
                },
            )
        }

        fun parseRawScalar(raw: String): Any? {
            val trimmed = westernDigits(raw.trim())
            if (trimmed.isEmpty()) return null
            if (trimmed.equals("TRUE", ignoreCase = true)) return true
            if (trimmed.equals("FALSE", ignoreCase = true)) return false
            if (PLAIN.matches(trimmed)) return trimmed.toDouble()
            if (GROUPED.matches(trimmed)) return trimmed.replace(",", "").toDouble()
            if (PERCENT.matches(trimmed)) return trimmed.dropLast(1).toDouble() / 100
            return raw
        }

        private fun grouped(value: Double, minDigits: Int, maxDigits: Int): String {
            val format = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US))
            format.minimumFractionDigits = minDigits
            format.maximumFractionDigits = maxDigits
            format.roundingMode = RoundingMode.HALF_EVEN
            return format.format(value)
        }

        /** Mirrors the desktop `formatScalar`. */
        fun format(value: Any?, style: JSONObject?): String {
            if (value == null || value == "") return ""
            if (value is Boolean) return if (value) "TRUE" else "FALSE"
            if (value is Double && value.isFinite()) {
                val decimals = style?.optInt("decimals", 2) ?: 2
                return when (style?.optString("format").orEmpty()) {
                    "integer" -> grouped(floor(value + 0.5), 0, 0)
                    "number" -> grouped(value, decimals, decimals)
                    "currency_sar" -> (if (value < 0) "-" else "") + "SAR " + grouped(abs(value), decimals, decimals)
                    "currency_usd" -> (if (value < 0) "-" else "") + "$" + grouped(abs(value), decimals, decimals)
                    "accounting" -> if (value < 0) "(" + grouped(abs(value), decimals, decimals) + ")" else if (value == 0.0) "—" else grouped(value, decimals, decimals)
                    "percent" -> BigDecimal(value * 100).setScale(decimals, RoundingMode.HALF_UP).toPlainString() + "%"
                    "scientific" -> String.format(Locale.US, "%.${decimals}e", value).replace(Regex("e([+-])0*(\\d)"), "e$1$2")
                    else -> if (value == floor(value)) grouped(value, 0, 0) else grouped(BigDecimal(value).setScale(6, RoundingMode.HALF_UP).toDouble(), 0, 4)
                }
            }
            if (value is Double) return if (value.isNaN()) "NaN" else if (value > 0) "Infinity" else "-Infinity"
            return value.toString()
        }
    }
}
