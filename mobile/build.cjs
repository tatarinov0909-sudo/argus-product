/* Build the app from the maintained web screens. Never copy credentials or the whole repository. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'www');
const native = process.argv.includes('--android');
const api = new URL(process.env.ARGUS_API_BASE || (native ? 'http://10.0.2.2:3110' : 'http://127.0.0.1:3110'));
if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
  throw new Error('ARGUS_API_BASE должен быть адресом API без ключей, пути и параметров');
}
if (api.hostname === 'api.argus-ai.online' && api.protocol !== 'https:') throw new Error('Рабочий API требует HTTPS');
const required = ['runtime.js', 'worker.css', 'login.html', 'login.js', 'manifest.webmanifest', 'sw.js', 'cell-labels.html', 'cell-labels.js', 'cell-labels.css', 'compat.js', 'unsupported.html'];
for (const file of required) {
  if (!fs.existsSync(path.join(root, 'worker', file))) throw new Error('Не готов исходник worker/' + file);
}
fs.mkdirSync(out, { recursive: true });
if (fs.lstatSync(out).isSymbolicLink()) throw new Error('Каталог сборки не должен быть ссылкой');
const copy = (from, to) => fs.copyFileSync(path.join(root, from), path.join(out, to));
for (const file of ['auth.js', 'back.js', 'fonts.css', 'seller-fonts.css', 'qrcode.min.js']) copy(file, file);
fs.cpSync(path.join(root, 'fonts'), path.join(out, 'fonts'), { recursive: true });
for (const file of required) copy('worker/' + file, file === 'runtime.js' ? 'worker-runtime.js' : file);
const loginPath = path.join(out, 'login.html');
fs.writeFileSync(loginPath, fs.readFileSync(loginPath, 'utf8').replace('<script src="worker-config.js">', '<script src="compat.js"></script><script src="worker-config.js">'));
fs.copyFileSync(path.join(__dirname, 'node_modules/jsqr/dist/jsQR.js'), path.join(out, 'jsqr.js'));
fs.copyFileSync(path.join(__dirname, 'native-bridge.js'), path.join(out, 'native-bridge.js'));
fs.copyFileSync(path.join(__dirname, 'native-print.js'), path.join(out, 'native-print.js'));
for (const file of fs.readdirSync(path.join(root, 'worker')).filter(f => /\.(svg|png)$/.test(f))) copy('worker/' + file, file);
let html = fs.readFileSync(path.join(root, 'loader.html'), 'utf8');
// SystemBars applies native safe-area padding; content must not opt into drawing under bars.
html = html.replace('initial-scale=1, maximum-scale=1', 'initial-scale=1');
html = html.replace('</head>', '<meta name="theme-color" content="#111315">\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="stylesheet" href="worker.css">\n</head>');
const marker = /<script src="auth\.js[^\"]*"><\/script>/;
if (!marker.test(html)) throw new Error('Не найдено место подключения среды приложения');
html = html.replace(marker, '<script src="compat.js"></script>\n<script src="worker-config.js"></script>\n$&\n<script src="worker-runtime.js"></script>\n<script src="native-bridge.js"></script>');
const digest = crypto.createHash('sha256').update(JSON.stringify({ apiBase: api.origin, native })).update(html);
for (const file of required) digest.update(fs.readFileSync(path.join(root, 'worker', file)));
for (const file of ['auth.js', 'back.js', 'fonts.css', 'seller-fonts.css', 'qrcode.min.js', 'native-bridge.js', 'native-print.js']) digest.update(fs.readFileSync(path.join(out, file)));
const buildId = digest.digest('hex').slice(0, 12);
const config = { apiBase: api.origin, native, buildId, environment: api.hostname === 'api.argus-ai.online' ? 'production' : 'stand' };
fs.writeFileSync(path.join(out, 'worker-config.js'), 'window.ARGUS_WORKER_CONFIG = ' + JSON.stringify(config) + ';\n');
let print = fs.readFileSync(path.join(root, 'pick_print.html'), 'utf8');
if (!print.includes("const API_BASE = 'https://api.argus-ai.online';")) throw new Error('Изменился контракт страницы печати');
print = print.replace("const API_BASE = 'https://api.argus-ai.online';", 'const API_BASE = window.ARGUS_WORKER_CONFIG.apiBase;');
print = print.replace(/<script src="auth\.js[^\"]*"><\/script>/, '<script src="worker-config.js"></script>\n<script src="native-print.js"></script>\n$&');
fs.writeFileSync(path.join(out, 'pick_print.html'), print);
fs.writeFileSync(path.join(out, 'loader.html'), html);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'build-info.json'), JSON.stringify({ buildId, native, environment: config.environment }, null, 2));
console.log('Собрано: ' + (native ? 'Android' : 'web') + ', ' + config.environment + ', версия ' + buildId);
