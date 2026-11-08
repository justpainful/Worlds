package worlds.content

import java.security.SecureRandom

private val random = SecureRandom()

fun newBlockId(): String = newResourceId(System.currentTimeMillis())

/** Desktop db::new_id uses a simple, lowercase UUIDv7. */
internal fun newResourceId(timestampMillis: Long): String {
    require(timestampMillis in 0..0xFFFFFFFFFFFFL)
    val bytes = ByteArray(16)
    random.nextBytes(bytes)
    for (index in 0..5) bytes[index] = (timestampMillis ushr (40 - index * 8)).toByte()
    bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x70).toByte()
    bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
    val digits = "0123456789abcdef"
    return buildString(32) {
        for (byte in bytes) { val n = byte.toInt() and 255; append(digits[n ushr 4]); append(digits[n and 15]) }
    }
}
