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
)) { "Use an already approved HTTPS signaling origin; new QA origins require review." }

android {
    namespace = "com.galaxyremote.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.galaxyremote.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 23
        versionName = "0.5.6"
        buildConfigField("String", "DEVICE_TEST_BUILD_ID", "\"linro-reference-ui-stage7-5\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField(
            "String",
            "SIGNALING_BASE_URL",
            "\"$signalingBaseUrl\"",
        )
    }

    buildFeatures {
        buildConfig = true
        aidl = true
    }

    packaging {
        resources.excludes += "commonMain/**"
        resources.excludes += "META-INF/kotlin-project-structure-metadata.json"
    }

    buildTypes {
        configureEach {
            buildConfigField("boolean", "DISPLAY_CONTROL_EXPERIMENTAL", "false")
        }
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
        create("panelTest") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".paneltest"
            versionNameSuffix = "-panel-experiment"
            matchingFallbacks += "debug"
            ndk.abiFilters.clear()
            ndk.abiFilters += "arm64-v8a"
            buildConfigField("boolean", "DISPLAY_CONTROL_EXPERIMENTAL", "true")
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
    implementation("dev.rikka.shizuku:api:13.1.5")
    implementation("dev.rikka.shizuku:provider:13.1.5")
    testImplementation("junit:junit:4.13.2")

    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
