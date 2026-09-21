#!/usr/bin/env node
// Отпечаток файла в ссылке на него: cabinet_main.js?v=<хэш содержимого>.
//
// Зачем. Хостинг отдаёт css и js с Cache-Control: max-age=3888000 — сорок пять
// дней. Пока адрес файла не меняется, браузер новую версию не спрашивает
// вовсе: 21.09.2026 владелец выдал ключ менеджера и получил работника, потому
// что кабинет у него в браузере был старый, хотя на сервере лежал новый.
//
// Номер версии руками («?v=78») эту задачу не решает: его забывают. Здесь он
// считается из самого файла, поэтому меняется ровно тогда, когда меняется
// файл, и не меняется, когда правок нет (иначе кэш терял бы смысл).
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

// Ссылки на СВОИ css и js. Внешние адреса (cdnjs) не трогаем: их версия
// уже в пути, и переписывать чужой адрес нельзя.
const LINK = /((?:href|src)=")([^"?:]+\.(?:css|js))(\?v=[^"]*)?(")/g;

const changed = [];
for (const name of fs.readdirSync(root)) {
  if (!name.endsWith('.html')) continue;
  const htmlPath = path.join(root, name);
  const before = fs.readFileSync(htmlPath, 'utf8');
  const after = before.replace(LINK, (whole, open, file, _old, close) => {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) return whole;   // чужой или отсутствующий файл
    return `${open}${file}?v=${stampOf(target)}${close}`;
  });
  if (after !== before) {
    changed.push(name);
    if (!checkOnly) fs.writeFileSync(htmlPath, after);
  }
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
