#!/usr/bin/env node
// Отпечаток файла в ссылке на него: cabinet_main.js?v=<хэш содержимого>.
//
// Зачем. Хостинг отдаёт css, js и шрифты с Cache-Control: max-age=3888000 —
// сорок пять дней. Пока адрес файла не меняется, браузер новую версию не
// спрашивает вовсе: 21.09.2026 владелец трижды выдал ключ менеджера и трижды
// получил работника, потому что кабинет у него в браузере был старый, хотя на
// сервере лежал новый.
//
// Номер версии руками («?v=78», «?v=20260912-ink») эту задачу не решает: его
// забывают. Здесь он считается из самого файла, поэтому меняется ровно тогда,
// когда меняется файл, и не меняется, когда правок нет (иначе кэш терял бы
// смысл).
//
// Порядок важен: сначала ссылки на шрифты внутри css (от этого меняется сам
// css), потом ссылки на css и js внутри страниц.
//
// Запуск:
//   node tools/stamp-assets.js          — проставить отпечатки
//   node tools/stamp-assets.js --check  — только проверить (для выкладки)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');

const stampOf = (file) => crypto.createHash('md5')
  .update(fs.readFileSync(file)).digest('hex').slice(0, 8);

// Ссылки на СВОИ css и js в страницах. Внешние адреса (cdnjs) не трогаем:
// их версия уже в пути, и переписывать чужой адрес нельзя.
const HTML_LINK = /((?:href|src)=")([^"?:]+\.(?:css|js))(\?v=[^"]*)?(")/g;
// Ссылки внутри css: шрифты и картинки. Кавычки бывают любые или никаких.
const CSS_URL = /(url\(\s*['"]?)([^'")?:]+\.(?:woff2|woff|ttf|otf|eot|png|jpg|svg|gif))(\?v=[^'")]*)?(['"]?\s*\))/g;

const changed = [];

function rewrite(file, pattern, baseDir) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(pattern, (whole, open, ref, _old, close) => {
    const target = path.join(baseDir, ref);
    if (!fs.existsSync(target)) return whole;   // чужой или отсутствующий файл
    return `${open}${ref}?v=${stampOf(target)}${close}`;
  });
  if (after === before) return;
  changed.push(path.basename(file));
  if (!checkOnly) fs.writeFileSync(file, after);
}

for (const name of fs.readdirSync(root)) {
  if (name.endsWith('.css')) rewrite(path.join(root, name), CSS_URL, root);
}
for (const name of fs.readdirSync(root)) {
  if (name.endsWith('.html')) rewrite(path.join(root, name), HTML_LINK, root);
}

if (changed.length === 0) {
  console.log('отпечатки на месте');
  process.exit(0);
}
if (checkOnly) {
  console.error('Отпечатки устарели: ' + changed.join(', ')
    + '\nЗапустите: node tools/stamp-assets.js — и закоммитьте изменения.');
  process.exit(1);
}
console.log('обновлены отпечатки: ' + changed.join(', '));
