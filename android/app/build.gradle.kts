import java.util.Properties

plugins {
    id("com.android.application")
}

/*
 * Release signing lives outside the repo. The properties file holds storeFile,
 * storePassword, keyAlias and keyPassword; its path can be overridden with the
 * ESCUADRON_KEYSTORE_PROPERTIES environment variable.
 */
val firmaFile = file(
    System.getenv("ESCUADRON_KEYSTORE_PROPERTIES")
        ?: "${System.getProperty("user.home")}/.android/escuadron-dui-keystore.properties"
)
val firma = Properties().apply { if (firmaFile.isFile) firmaFile.inputStream().use { load(it) } }

android {
    namespace = "cl.danieleduardo.escuadrondui"
    compileSdk = 36

    defaultConfig {
        applicationId = "cl.danieleduardo.escuadrondui"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        if (firma.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(firma.getProperty("storeFile"))
                storePassword = firma.getProperty("storePassword")
                keyAlias = firma.getProperty("keyAlias")
                keyPassword = firma.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    androidResources {
        // Already-compressed game files are stored as-is so they can be read without inflating.
        noCompress += listOf("mp3", "woff2", "png", "webp")
    }

    packaging {
        resources.excludes += listOf("META-INF/*.version", "kotlin/**", "DebugProbesKt.bin")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity:1.11.0")
    implementation("androidx.webkit:webkit:1.15.0")
}
