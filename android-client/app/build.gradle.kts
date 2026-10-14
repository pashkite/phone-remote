plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Keep the working bootstrap until the custom domain has passed DNS/TLS checks.
// Existing registrations keep their stored base URL on an in-place update.
val signalingBaseUrl = providers.gradleProperty("signalingBaseUrl")
    .orElse("https://galaxy-remote-control.ashkite.chatgpt.site").get()
require(signalingBaseUrl in setOf(
    "https://galaxy-remote-control.ashkite.chatgpt.site",
    "https://remote.ashkite.kro.kr",
)) { "Use a verified Galaxy Remote HTTPS origin." }

android {
    namespace = "com.galaxyremote.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.galaxyremote.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 16
        versionName = "0.5.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField(
            "String",
            "SIGNALING_BASE_URL",
            "\"$signalingBaseUrl\"",
        )
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources.excludes += "commonMain/**"
        resources.excludes += "META-INF/kotlin-project-structure-metadata.json"
    }

    buildTypes {
        debug {
            // GitHub's Android 16 emulator is x86_64. Debug binaries are only
            // used by the automated projection smoke test.
            ndk {
                abiFilters += "x86_64"
            }
        }
        release {
            // Galaxy S26 Ultra and modern Galaxy flagships use 64-bit ARM.
            ndk {
                abiFilters += "arm64-v8a"
            }
            // Keep WebRTC/JNI class names and bytecode untouched while the
            // sideload build is validated across recent Galaxy firmware.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

configurations.configureEach {
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-jdk7")
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-jdk8")
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("io.github.webrtc-sdk:android:144.7559.09")

    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
