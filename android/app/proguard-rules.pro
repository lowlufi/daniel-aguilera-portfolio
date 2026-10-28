# The page calls these through window.AppAndroid; R8 must keep their names.
-keepclassmembers class cl.danieleduardo.escuadrondui.** {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
