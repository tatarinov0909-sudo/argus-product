# Проверка предупреждения Play Protect: «Аргус — грузчик»

Проверено 08.10.2026. Владелец предоставил контакт и подтвердил отправку,
условия VirusTotal и прохождение CAPTCHA. APK 0.1.1 принят VirusTotal;
апелляция Google отправлена через официальный сайт. Google показал
«Your email has been sent». Решение о снятии блокировки пока не получено.
Аккаунты не создавались и оплаты не выполнялись. Контакт владельца в Git
не сохраняется. Подтверждение отправки — локально в
`test-results/play-protect-sent.jpg`, вне Git.

## Вывод и правильный следующий шаг

Переданная формулировка — Play Protect ранее не проверял приложение этого
разработчика; диалог блокирует установку и предлагает «Установить всё равно».
Она сама по себе не доказывает конкретную вредоносную функцию. Точная внутренняя
причина Google нам недоступна; новое приложение/неизвестная история подписи —
объяснение по смыслу сообщения, а не подтверждённый результат анализа Google.

Google различает несколько диалогов. Если предлагается штатная **проверка
приложения**, использовать её и дождаться результата. Для отдельного диалога
«Send App for Security Check» Google прямо указывает, что апелляция не убирает
сообщение: нужен анализ APK. Если после проверки остаётся ошибочная блокировка
или классификация, предусмотрена **Play Protect appeal**. Не подменять это
советом отключить защиту или нажать обход предупреждения.
Источник: [руководство Google по предупреждениям](https://developers.google.com/android/play-protect/warning-dev-guidance).

Для текущего сообщения отправлена апелляция ниже. В форме нет поля вложения;
формулировки исходного скриншота переданы текстом. Решение и срок проверки
Google не обещаем. Новый APK, смена сертификата или регистрация разработчика
сами по себе не гарантируют исчезновения предупреждения.

## Проверенная опубликованная сборка

Скачан именно [публичный APK 0.1.0](https://argus-ai.online/downloads/argus-worker-0.1.0.apk).
Его хеш совпал с `downloads/release.json`. Выполнены `apksigner verify --verbose
--print-certs`, `aapt dump badging`; отдельно прочитаны merged release manifest,
manifest-merger report, Gradle dependency declarations и release lint dependency
model. Локальная копия для проверки находится вне репозитория.

| Параметр | Проверенное значение |
| --- | --- |
| Название | Аргус — грузчик |
| Package | `online.argus.worker` |
| Version / versionCode | `0.1.0` / `1` |
| Min / target / compile SDK | `24` / `36` / `36` |
| Размер APK | `3766059` байт |
| SHA-256 **файла APK** | `f28c9cb4261dbccbab25a0378d88bc0ef123da49b39fe58de8af2feaafc0cfda` |
| SHA-256 **сертификата подписи** | `3981f1a257a744accf587beabaa2f2d880427a4ed674bc0406d31daf37091e6f` |
| Подпись | Один подписант; RSA 3072; v2 и v3 прошли проверку |
| Certificate DN | `CN=Argus Worker, OU=Mobile, O=Argus` |
| Debuggable | В release manifest не включён; в `aapt badging` debug-флаг отсутствует |
| Build / source commit из release metadata | `7986a908a5a6` / `f460bb88a488766fc3c11d085625f2d1e09cee5a` |

**Хеш APK и отпечаток сертификата — разные значения.** Для поля апелляции
нужен хеш APK; для регистрации package в Android Developer Console — сертификат.

В результирующем APK ровно эти запрашиваемые разрешения:

| Разрешение | Назначение в приложении |
| --- | --- |
| `android.permission.INTERNET` | Запросы к серверу Аргуса |
| `android.permission.CAMERA` | Сканирование QR/штрихкодов по действию работника |
| `android.permission.WAKE_LOCK` | Короткое завершение отправки сохранённых действий и паузы |
| `android.permission.FOREGROUND_SERVICE` | `WorkerPauseService`, тип `shortService`, уведомление и собственный предел 90 секунд |
| `online.argus.worker.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Собственное signature-разрешение, добавленное AndroidX Core 1.17.0 для защиты внутренних receiver |

Нет `READ_SMS`, `RECEIVE_SMS`, Accessibility service, NotificationListenerService,
установки чужих APK, контактов, геолокации или микрофона. В manifest есть
`android.permission.DUMP` **как ограничение доступа к** AndroidX
`ProfileInstallReceiver`; приложение не запрашивает DUMP через `uses-permission`.
`FileProvider`, AndroidX startup provider и сервис паузы не экспортированы.
Экспортированы launcher activity и защищённый DUMP receiver AndroidX.

Таким образом, в этой сборке отсутствует набор чувствительных разрешений,
который Google отдельно перечисляет для защиты от финансового мошенничества
при установке из интернета. Это узкий вывод по manifest, не заключение
антивируса. Target SDK 36 также не соответствует причине «слишком старый target»
на Android 16/17. [Классы предупреждений Google](https://developers.google.com/android/play-protect/warning-dev-guidance).

Основные зависимости: Capacitor Android/Core 8.5.3, jsQR 1.4.0, AndroidX;
Cordova bridge module объявляет framework 14.0.1. В просмотренных декларациях
и release dependency model нет рекламного или аналитического SDK. Playwright
и Capacitor CLI — инструменты разработки. Это не полный аудит исходников всех
транзитивных библиотек и не результат сканирования Google.

Проверка подписи подтверждает целостность APK и совпадение с нашим опубликованным
сертификатом, а не прохождение проверки Google. Сохранять текущий ключ для
совместимых обновлений; не менять package/подпись ради обхода предупреждения.
[Документация Android о подписи и обновлениях](https://developer.android.com/studio/publish/app-signing).

## Проверенное обновление 0.1.1

После исправления входа и сканера подготовлен отдельный release APK 0.1.1.
08.10.2026 повторно выполнены `apksigner verify --verbose --print-certs`,
`aapt dump badging` и проверка содержимого архива. Подписи v2/v3 действительны,
сертификат прежний, debug-флаг отсутствует, набор разрешений тот же, что выше.
Встроенный API — `https://api.argus-ai.online`; тестовых адресов и приватных
материалов сборки в APK не обнаружено. Это не результат проверки Google.

| Параметр | Значение |
| --- | --- |
| Version / versionCode | `0.1.1` / `2` |
| Размер APK | `3770155` байт |
| SHA-256 файла APK | `0fcc5f23c786e0af58fac3855f8d872d036bb93b89d713a3f0bf7353218a4b94` |
| Build | `8ba05516f3da` |
| Source commit | `d3a4009ab7ba08ca6fb6b1edc1be05c35f049c62` |
| URL | https://argus-ai.online/downloads/argus-worker-0.1.1.apk |

Исходный скриншот относится к установке 0.1.0. Отдельного результата
Play Protect для 0.1.1 пока нет. Обращение ниже сообщает об этом явно.

## Результат VirusTotal

08.10.2026 анализ завершился: **0/65** — проверившие файл движки не отметили
его как вредоносный. [Отчёт точного APK 0.1.1](https://www.virustotal.com/gui/file/0fcc5f23c786e0af58fac3855f8d872d036bb93b89d713a3f0bf7353218a4b94).
У движка **Google — Timeout**; часть других движков не поддержала тип файла
или завершилась ошибкой. Поэтому это не положительный вердикт Google и не
доказательство снятия Play Protect. Скриншот —
`test-results/virustotal-011-result.jpg`, вне Git.

## Апелляция Play Protect: форма и данные владельца

Официальная форма: [Play Protect Appeals Submission Form](https://support.google.com/googleplay/android-developer/contact/protectappeals).
На момент проверки обязательны email, package name, **SHA-256 APK, загруженного
на VirusTotal**, и пояснение; developer name — необязательное поле. Вход в
Google Account рекомендуется для поддержки, но прочитанная форма не требует
сначала купить аккаунт Play Console. Форма предупреждает, что ответа по
решению может не быть, и не предназначена для консультаций о будущей версии.

Отправлено с контактом владельца, package `online.argus.worker` и SHA256
APK 0.1.1 из таблицы выше. Необязательное имя разработчика оставлено пустым:
юридическое лицо не выводилось из Certificate DN. Модель устройства,
версия Android/Play Protect, страна и результат штатной проверки владельцем
не предоставлены и не выдумывались. Секреты, ключи работников и сведения
складов не передавались. Google предупреждает, что ответа на апелляцию не будет.

Фактически отправленный текст Additional information — 970 символов
при ограничении формы 1000:

```text
Please review Argus Worker, our warehouse app, currently published as 0.1.1 (code 2):
https://argus-ai.online/downloads/argus-worker-0.1.1.apk
This exact APK was uploaded to VirusTotal (hash above).
The owner's screenshot for preceding 0.1.0 says "App blocked to protect your device" and "Play Protect has never checked an app from this developer. It may be unsafe." 0.1.1 uses the same package and signing certificate; it fixes login/camera issues. We have no Play Protect verdict yet for 0.1.1.
Workers use warehouse-issued keys for receiving/picking/placement. Camera use is user-initiated QR scanning. Permissions: INTERNET, CAMERA, WAKE_LOCK, FOREGROUND_SERVICE and AndroidX's internal signature permission. Pause-sync service has a 90s limit. No SMS, contacts, location, microphone, accessibility or package-install permissions. Non-debuggable; target SDK 36; APK v2/v3 signature verified. Please review the current APK/classification, not a future implementation.
```

## Developer verification 2026 — отдельная задача

По актуальным [overview](https://developer.android.com/developer-verification)
и [FAQ Google](https://developer.android.com/developer-verification/guides/faq),
первый этап с 30.09.2026 касается участвующих магазинов в Бразилии, Индонезии,
Сингапуре и Таиланде. FAQ отдельно исключает прямую установку APK с сайта из
этого начального этапа; более широкий rollout заявлен на 2027 год. Некоторые
старые/смежные страницы формулируют срок шире: для нашего канала применён
конкретный ответ FAQ о direct sideloading. Поэтому нынешний диалог нельзя
объяснять только отсутствием этой регистрации.

Для масштабного коммерческого распространения с сайта предусмотрен
[Android Developer Console](https://developer.android.com/developer-verification/guides/android-developer-console).
Если уже есть Play Console, Google позволяет использовать его для регистрации
внешних приложений. Зарегистрировать package `online.argus.worker`, добавить
приведённый SHA-256 сертификата; для доказательства владения консоль может
потребовать подписанный тем же ключом challenge APK с выданным asset-фрагментом.
Не загружать приватный ключ как обычное вложение.

Для [full distribution](https://developer.android.com/developer-verification/guides/full-distribution)
нужны аккаунт владельца, юридические имя/адрес, контактные email/телефон и
документы, зависящие от страны; для организации также D-U-N-S, документы
организации и подтверждение сайта через Search Console. FAQ указывает сбор
25 USD за full distribution; регистрацию/платёж выполняет владелец отдельно.
Бесплатный [limited distribution](https://developer.android.com/developer-verification/guides/limited-distribution)
ограничен 20 устройствами и не подходит как основа универсального коммерческого
продукта для многих складов. Регистрация личности не заменяет анализ APK
Play Protect и не является обещанием снять конкретное предупреждение.

## Границы выполненной проверки

Проверены опубликованные байты, публичная подпись, manifest и перечисленные
артефакты сборки. Закрытая классификация Google и статус регистрации владельца
не доступны. APK загружен в VirusTotal и форма Google отправлена с разрешения
владельца. Покупка аккаунта и изменение защиты устройства не выполнялись.
Выпуск 0.1.1 и серверное продление входа описаны отдельно в отчёте обновления;
они не считаются снятием предупреждения. Интеграции 1С/WB не менялись.
