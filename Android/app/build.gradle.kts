plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "worlds.android"
    compileSdk = 37
    defaultConfig {
        applicationId = "worlds.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 8
        versionName = "1.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    splits {
        abi {
            isEnable = providers.gradleProperty("worlds.abiSplits").orNull == "true"
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
            isUniversalApk = false
        }
    }
    // Release builds are signed with the Worlds release key when CI provides it
    // (GitHub secrets, see docs/android-native/RELEASE_SIGNING.md). One fixed key is
    // what lets a new version install over the last one. Without it they stay unsigned.
    val releaseKey = System.getenv("WORLDS_RELEASE_KEYSTORE")?.takeIf { file(it).isFile }
    signingConfigs {
        if (releaseKey != null) {
            create("release") {
                storeFile = file(releaseKey)
                storePassword = System.getenv("WORLDS_RELEASE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("WORLDS_RELEASE_KEY_ALIAS")
                keyPassword = System.getenv("WORLDS_RELEASE_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("release") {
            if (releaseKey != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { compose = true }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

/**
 * HTML pages (docs/HTML_PAGES.md) use the desktop's base styles, runtime and
 * fonts unchanged: they are copied from src/htmlpage and src-tauri at build time.
 */
abstract class HtmlPageAssets : DefaultTask() {
    @get:InputFiles @get:PathSensitive(PathSensitivity.NAME_ONLY) abstract val sources: ConfigurableFileCollection
    @get:OutputDirectory abstract val outputDir: DirectoryProperty
    @TaskAction fun copy() {
        val target = outputDir.get().asFile.resolve("htmlpage")
        target.deleteRecursively(); target.mkdirs()
        sources.files.forEach { it.copyTo(target.resolve(it.name), overwrite = true) }
    }
}
val htmlPageAssets = tasks.register<HtmlPageAssets>("htmlPageAssets") {
    val repo = rootProject.layout.projectDirectory.dir("..")
    sources.from(repo.file("src/htmlpage/base.css"), repo.file("src/htmlpage/runtime.js"),
        repo.dir("src-tauri/assets/htmlpage-fonts").asFileTree.matching { include("*.woff2") })
    outputDir.set(layout.buildDirectory.dir("generated/htmlpage-assets"))
}

/**
 * "What's new" (WhatsNew.kt) reads this version's notes from the same changelog
 * file the desktop app bundles: web/changelog/releases/<versionName>.txt.
 */
abstract class ReleaseNotesAssets : DefaultTask() {
    @get:InputFiles @get:PathSensitive(PathSensitivity.NAME_ONLY) abstract val sources: ConfigurableFileCollection
    @get:OutputDirectory abstract val outputDir: DirectoryProperty
    @TaskAction fun copy() {
        val target = outputDir.get().asFile.resolve("release-notes")
        target.deleteRecursively(); target.mkdirs()
        sources.files.filter { it.isFile }.forEach { it.copyTo(target.resolve(it.name), overwrite = true) }
    }
}
val releaseNotesAssets = tasks.register<ReleaseNotesAssets>("releaseNotesAssets") {
    val repo = rootProject.layout.projectDirectory.dir("..")
    val version = android.defaultConfig.versionName
    sources.from(repo.dir("web/changelog/releases").asFileTree.matching { include("$version.txt") })
    outputDir.set(layout.buildDirectory.dir("generated/release-notes-assets"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(htmlPageAssets, HtmlPageAssets::outputDir)
        variant.sources.assets?.addGeneratedSourceDirectory(releaseNotesAssets, ReleaseNotesAssets::outputDir)
    }
    beforeVariants { variantBuilder ->
        try {
            variantBuilder::class.java.getMethod("setEnableUnitTest", Boolean::class.javaPrimitiveType).invoke(variantBuilder, true)
        } catch (_: Throwable) {}
        try {
            variantBuilder::class.java.getMethod("setUnitTestEnabled", Boolean::class.javaPrimitiveType).invoke(variantBuilder, true)
        } catch (_: Throwable) {}
    }
}

dependencies {
    implementation(project(":core:content"))
    implementation(project(":core:identity"))
    implementation(project(":core:sync"))
    implementation(project(":core:stylus"))
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
    implementation("androidx.work:work-runtime:2.12.0")
    implementation("androidx.datastore:datastore-preferences:1.2.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    // Real org.json for JVM unit tests; android.jar only ships stubs.
    testImplementation("org.json:json:20240303")
    androidTestImplementation(platform("androidx.compose:compose-bom:2026.09.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.work:work-testing:2.12.0")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
