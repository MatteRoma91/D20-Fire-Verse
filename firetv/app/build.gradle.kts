plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** A table address baked into the build, e.g. `-Pfireverse.tableUrl=http://192.168.1.20:3100`. Empty means "find it". */
val tableUrl = (findProperty("fireverse.tableUrl") as String?).orEmpty()

/** Release signing comes from the environment; without it the release build is signed with the debug key. */
val keystorePath: String? = System.getenv("FIREVERSE_KEYSTORE")

android {
    namespace = "com.d20fireverse.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.d20fireverse.tv"
        minSdk = 22
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "DEFAULT_TABLE_URL", "\"$tableUrl\"")
    }

    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("FIREVERSE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("FIREVERSE_KEY_ALIAS")
                keyPassword = System.getenv("FIREVERSE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
