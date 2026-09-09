// Круговая проверка: сгенерировали QR своей библиотекой — прочитали ЧУЖОЙ.
// QR, который сканируется в мусор, хуже отсутствия QR: человек поверит
// бумаге и возьмёт не то.
const fs = require('fs');
function load(file, name){
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = { module: { exports: {} }, exports: {}, window: {}, self: {}, navigator: {} };
  sandbox.window.document = { createElement: () => ({ getContext: () => null }) };
  const fn = new Function('module', 'exports', 'window', 'self', 'navigator', 'document',
    src + '\n;return typeof ' + name + ' !== "undefined" ? ' + name + ' : (module.exports || exports);');
  return fn(sandbox.module, sandbox.exports, sandbox.window, sandbox.self, sandbox.navigator, sandbox.window.document);
}
const qrcode = load(require('path').join(__dirname, '..', 'qrcode.min.js'), 'qrcode');
// jsQR ставится разово: npm i --no-save jsqr
const jsQR = require('jsqr').default || require('jsqr');

// В коде на листе лежит только артикул номенклатуры — латиницей и цифрами.
// Кириллица здесь однажды уже сломалась: библиотека по умолчанию кодирует
// байты однобайтно, и «ПС» вернулось как «!». Первый случай оставлен нарочно,
// чтобы это не забылось.
const CASES = [
  'PB000023477',
  'PB000021779',
  '1201010210',
  'ARG|ПС-0909-01|PB000023477',
];
let bad = 0;
for (const text of CASES) {
  if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4, scale = 4;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!qr.isDark(r, c)) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const y = (r + quiet) * scale + dy, x = (c + quiet) * scale + dx;
          const i = (y * size + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  const out = jsQR(data, size, size);
  const got = out && out.data;
  const ok = got === text;
  if (!ok) bad += 1;
  console.log((ok ? 'OK  ' : 'FAIL') + '  модулей ' + n + '  «' + text + '»' + (ok ? '' : ' → «' + got + '»'));
}
process.exit(bad ? 1 : 0);
