package worlds.sync

import org.junit.Test
import java.io.File

class SyncWireJUnitTest {
    @Test fun lib0FixturesAndMalformedFrames() {
        val resource = requireNotNull(javaClass.getResource("/lib0-fixtures.txt"))
        main(arrayOf(File(resource.toURI()).absolutePath))
    }
}
