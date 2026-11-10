plugins { id("com.android.library") }

val nativeOutput = layout.buildDirectory.dir("generated/yrsJni")
val yrsNdkVersion = "28.2.13676358"
val buildYrs = tasks.register("buildYrs") {
    inputs.files(fileTree("native") { exclude("target/**") })
    inputs.property("ndkVersion", yrsNdkVersion)
    outputs.dir(nativeOutput)
    doLast {
        val sdk = System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT")
            ?: error("ANDROID_HOME or ANDROID_SDK_ROOT is required for Yrs")
        val ndk = file("$sdk/ndk/$yrsNdkVersion")
        check(ndk.isDirectory) { "Android NDK $yrsNdkVersion is required for Yrs" }
        val windows = System.getProperty("os.name").startsWith("Windows")
        val host = if (windows) "windows-x86_64" else if (System.getProperty("os.name").startsWith("Mac")) "darwin-x86_64" else "linux-x86_64"
        val bin = ndk.resolve("toolchains/llvm/prebuilt/$host/bin")
        val configs = listOf(
            Triple("aarch64-linux-android", "arm64-v8a", "aarch64-linux-android26-clang"),
            Triple("armv7-linux-androideabi", "armeabi-v7a", "armv7a-linux-androideabi26-clang"),
            Triple("x86_64-linux-android", "x86_64", "x86_64-linux-android26-clang"),
            Triple("i686-linux-android", "x86", "i686-linux-android26-clang"),
        )
        configs.forEach { (target, abi, linker) ->
            val process = ProcessBuilder("cargo", "build", "--locked", "--release", "--target", target)
                .directory(file("native")).inheritIO()
            process.environment()["CARGO_TARGET_${target.uppercase().replace('-', '_')}_LINKER"] = bin.resolve(linker + if (windows) ".cmd" else "").absolutePath
            check(process.start().waitFor() == 0) { "Yrs build failed for $target" }
            val dest = nativeOutput.get().asFile.resolve(abi)
            dest.mkdirs()
            file("native/target/$target/release/libworlds_sync_native.so").copyTo(dest.resolve("libworlds_sync_native.so"), overwrite = true)
        }
    }
}

android {
    namespace = "worlds.sync"
    compileSdk = 37
    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    sourceSets.getByName("main").jniLibs.srcDir(nativeOutput.get().asFile)
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
tasks.named("preBuild").configure { dependsOn(buildYrs) }

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
}
