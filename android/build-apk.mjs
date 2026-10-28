// npm run android:apk — builds the web game, bundles it into the Android app's
// assets and produces the signed release APK.
//
//   ESCUADRON_KEYSTORE_PROPERTIES  signing properties (default ~/.android/escuadron-dui-keystore.properties)
//   JAVA_HOME / ANDROID_HOME       default to the Homebrew JDK 21 and Android command-line tools
//   --sin-web                      skip `vite build` and reuse the current dist/
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const android = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.dirname(android);
const dist = path.join(raiz, 'dist');
const www = path.join(android, 'app/src/main/assets/www');

// Not needed by the game: portfolio videos, hosting config, SEO files, and the
// service worker (the app already has every file offline).
const EXCLUIR = new Set([
  'videos', '_headers', '_redirects', '404.html', 'robots.txt', 'sitemap.xml',
  'og-image.png', 'og-image.svg', 'aviones-sw.js',
]);

const env = { ...process.env };
env.JAVA_HOME ??= '/opt/homebrew/opt/openjdk@21';
env.ANDROID_HOME ??= env.ANDROID_SDK_ROOT ?? '/opt/homebrew/share/android-commandlinetools';

const correr = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });

if (!process.argv.includes('--sin-web')) correr('npx', ['vite', 'build'], raiz);
if (!existsSync(path.join(dist, 'index.html'))) throw new Error('dist/index.html no existe: falta el build web');

rmSync(www, { recursive: true, force: true });
cpSync(dist, www, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(dist, src);
    return !rel || !EXCLUIR.has(rel.split(path.sep)[0]);
  },
});

correr(path.join(android, 'gradlew'), ['--no-daemon', 'assembleRelease'], android);

const apk = path.join(android, 'app/build/outputs/apk/release/app-release.apk');
if (!existsSync(apk)) throw new Error('No se generó el APK firmado (¿falta el archivo de firma?)');
console.log(`\nAPK: ${apk} (${(statSync(apk).size / 1024 / 1024).toFixed(2)} MB)`);
