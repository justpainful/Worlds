package worlds.android

import android.content.Context
import android.net.ConnectivityManager

/** Local identity servers may work on networks without an internet capability. */
internal fun networkAvailable(context: Context): Boolean {
    return try {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        manager.activeNetwork != null || manager.allNetworks.isNotEmpty()
    } catch (_: SecurityException) { true }
}
