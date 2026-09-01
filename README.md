# Инструкция по бесплатному деплою на Render.com

## Шаг 1. Нажмите на плитку **Web Services** в Render.com
(Вторая плитка на вашем экране: *«Web Services — Dynamic web app. Ideal for full-stack apps, API servers, and mobile backends»*).

## Шаг 2. Подключите ваш GitHub репозиторий
- Выберите опцию **«Build and deploy from a Git repository»**.
- Выберите ваш репозиторий с проектом расписания.

## Шаг 3. Настройки сервиса в Render:
* **Name:** `bsu-schedule-api` (любое имя)
* **Region:** Frankfurt (EU) или любой
* **Branch:** `main` (или ваша ветка)
* **Root Directory:** `server` *(если сервер лежит в папке server вашего репозитория)*
* **Runtime:** `Node`
* **Build Command:** `npm install`
* **Start Command:** `node server.js`
* **Instance Type:** Выберите **Free ($0/month)**

## Шаг 4. Нажмите кнопку **Create Web Service**
Через 1-2 минуты Render выдаст вам бесплатную рабочую ссылку вида:
`https://bsu-schedule-api.onrender.com`

---

## Тестирование готового API:
1. `https://ваша-ссылка.onrender.com/api/schedule?idg=33344` — возвращает JSON расписания группы ИИ-26-1.
2. `https://ваша-ссылка.onrender.com/api/groups` — возвращает список всех ~500 групп БГУ.
