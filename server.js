const express = require('express');
const cheerio = require('cheerio');
const cors = require('cors');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory cache for fast responses (10 minutes TTL)
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

const DAY_MAP = {
    'ПОНЕДЕЛЬНИК': 1,
    'ВТОРНИК': 2,
    'СРЕДА': 3,
    'ЧЕТВЕРГ': 4,
    'ПЯТНИЦА': 5,
    'СУББОТА': 6
};

const IRKUTSK_IP = '95.167.142.68';

// Fallback preset schedule for II-26-1 (idg 33344)
const PRESET_II26_1 = {
    groupId: '33344',
    groupName: 'ИИ-26-1',
    semesterDates: '1 семестр 01.09.2026 - 08.12.2026',
    currentWeekInfo: '1 неделя (нечетная)',
    lastUpdatedMillis: Date.now(),
    lessons: [
        // Понедельник
        { id: 101, dayOfWeekIndex: 1, dayName: 'ПОНЕДЕЛЬНИК', timeStart: '14:00', timeEnd: '15:30', parity: 'EVEN', lessonType: 'практическое занятие', subject: 'Управление личной эффективностью', auditorium: '3-403', teacher: 'Арбатская Елена Анатольевна' },
        { id: 102, dayOfWeekIndex: 1, dayName: 'ПОНЕДЕЛЬНИК', timeStart: '15:45', timeEnd: '17:15', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'Основы российской государственности', auditorium: '3-403', teacher: 'Михеева Вера Геннадьевна' },
        { id: 103, dayOfWeekIndex: 1, dayName: 'ПОНЕДЕЛЬНИК', timeStart: '17:25', timeEnd: '18:55', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'Информатика и основы программирования', auditorium: '3-403', teacher: 'Балахчи Анна Геннадьевна' },
        
        // Вторник
        { id: 201, dayOfWeekIndex: 2, dayName: 'ВТОРНИК', timeStart: '14:00', timeEnd: '15:30', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'Иностранный язык', auditorium: '1-211', teacher: 'Глухова Елена Сергеевна' },
        { id: 202, dayOfWeekIndex: 2, dayName: 'ВТОРНИК', timeStart: '15:45', timeEnd: '17:15', parity: 'ODD', lessonType: 'лекция', subject: 'Дискретная математика', auditorium: '3-403', teacher: 'Белых Татьяна Ивановна' },
        { id: 203, dayOfWeekIndex: 2, dayName: 'ВТОРНИК', timeStart: '17:25', timeEnd: '18:55', parity: 'ODD', lessonType: 'практическое занятие', subject: 'Дискретная математика', auditorium: '3-403', teacher: 'Белых Татьяна Ивановна' },

        // Среда
        { id: 301, dayOfWeekIndex: 3, dayName: 'СРЕДА', timeStart: '14:00', timeEnd: '15:30', parity: 'ODD', lessonType: 'практическое занятие', subject: 'История России', auditorium: '3-403', teacher: 'Кузнецов Сергей Геннадьевич' },
        { id: 302, dayOfWeekIndex: 3, dayName: 'СРЕДА', timeStart: '14:00', timeEnd: '15:30', parity: 'EVEN', lessonType: 'практическое занятие', subject: 'Управление личной эффективностью', auditorium: '3-403', teacher: 'Арбатская Елена Анатольевна' },
        { id: 303, dayOfWeekIndex: 3, dayName: 'СРЕДА', timeStart: '15:45', timeEnd: '17:15', parity: 'WEEKLY', lessonType: 'лекция', subject: 'История России', auditorium: '3-403', teacher: 'Кузнецов Сергей Геннадьевич' },
        { id: 304, dayOfWeekIndex: 3, dayName: 'СРЕДА', timeStart: '17:25', timeEnd: '18:55', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'История России', auditorium: '3-403', teacher: 'Кузнецов Сергей Геннадьевич' },

        // Четверг
        { id: 401, dayOfWeekIndex: 4, dayName: 'ЧЕТВЕРГ', timeStart: '14:00', timeEnd: '15:30', parity: 'WEEKLY', lessonType: 'лекция', subject: 'Основы российской государственности', auditorium: '3-403', teacher: 'Михеева Вера Геннадьевна' },
        { id: 402, dayOfWeekIndex: 4, dayName: 'ЧЕТВЕРГ', timeStart: '15:45', timeEnd: '17:15', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'Основы российской государственности', auditorium: '3-403', teacher: 'Михеева Вера Геннадьевна' },
        { id: 403, dayOfWeekIndex: 4, dayName: 'ЧЕТВЕРГ', timeStart: '17:25', timeEnd: '18:55', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'Физическая культура и спорт', auditorium: 'СК', teacher: 'Кафедра ФКиС' },

        // Пятница
        { id: 501, dayOfWeekIndex: 5, dayName: 'ПЯТНИЦА', timeStart: '14:00', timeEnd: '15:30', parity: 'WEEKLY', lessonType: 'лекция', subject: 'Высшая математика', auditorium: '3-403', teacher: 'Белых Татьяна Ивановна' },
        { id: 502, dayOfWeekIndex: 5, dayName: 'ПЯТНИЦА', timeStart: '15:45', timeEnd: '17:15', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'Высшая математика', auditorium: '3-403', teacher: 'Белых Татьяна Ивановна' },
        { id: 503, dayOfWeekIndex: 5, dayName: 'ПЯТНИЦА', timeStart: '17:25', timeEnd: '18:55', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'Информатика и основы программирования', auditorium: '3-403', teacher: 'Балахчи Анна Геннадьевна' },

        // Суббота
        { id: 601, dayOfWeekIndex: 6, dayName: 'СУББОТА', timeStart: '14:00', timeEnd: '15:30', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'Физическая культура и спорт', auditorium: 'СК', teacher: 'Кафедра ФКиС' },
        { id: 602, dayOfWeekIndex: 6, dayName: 'СУББОТА', timeStart: '15:45', timeEnd: '17:15', parity: 'WEEKLY', lessonType: 'практическое занятие', subject: 'Иностранный язык', auditorium: '1-211', teacher: 'Глухова Елена Сергеевна' }
    ]
};

let browserPromise = null;

async function getBrowser() {
    if (!browserPromise) {
        browserPromise = (async () => {
            console.log('[Browser] Launching Chromium instance...');
            const executablePath = await chromium.executablePath();

            const browser = await puppeteer.launch({
                args: [
                    ...chromium.args,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-blink-features=AutomationControlled',
                    '--window-size=1366,768',
                    '--lang=ru-RU,ru'
                ],
                defaultViewport: { width: 1366, height: 768 },
                executablePath: executablePath,
                headless: chromium.headless
            });

            browser.on('disconnected', () => {
                console.log('[Browser] Browser disconnected, clearing reference.');
                browserPromise = null;
            });

            return browser;
        })().catch(err => {
            browserPromise = null;
            throw err;
        });
    }
    return browserPromise;
}

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'BSU Schedule Cloud Browser API',
        location_spoof: 'Irkutsk, Russia (GMT+8)',
        endpoints: {
            schedule: '/api/schedule?idg=33344',
            groups: '/api/groups'
        }
    });
});

// GET Schedule for group idg with full stealth & Russian geo emulation
app.get('/api/schedule', async (req, res) => {
    const idg = req.query.idg || '33344';
    const cacheKey = `schedule_${idg}`;

    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL) && cached.data.lessons.length > 0) {
        return res.json({ ...cached.data, cached: true });
    }

    let page = null;
    let lessons = [];
    let groupName = `Группа ${idg}`;
    let semesterDates = '1 семестр 01.09.2026 - 08.12.2026';
    let currentWeekInfo = '1 неделя (нечетная)';

    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // 1. Emulate Russian Timezone & Geolocation (Irkutsk, BSU)
        await page.emulateTimezone('Asia/Irkutsk');
        await page.setGeolocation({ latitude: 52.2833, longitude: 104.2833 });

        // 2. Set Realistic Viewport and User-Agent
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

        // 3. Inject Spoofed Russian Residential Headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'X-Forwarded-For': IRKUTSK_IP,
            'X-Real-IP': IRKUTSK_IP,
            'Client-IP': IRKUTSK_IP,
            'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"'
        });

        // 4. Anti-detection script
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
            Object.defineProperty(navigator, 'language', { get: () => 'ru-RU' });
            window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        });

        console.log(`[Browser] Loading main timetable page...`);
        await page.goto('https://bgu.ru/student/timetable.aspx', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        for (let attempt = 1; attempt <= 2; attempt++) {
            console.log(`[Browser] Attempt ${attempt}: Selecting group idg=${idg}...`);
            
            await page.evaluate((targetIdg) => {
                const link = document.querySelector(`a[href*="idg=${targetIdg}"]`);
                if (link) link.click();
            }, idg);

            await page.waitForFunction(() => {
                const div = document.getElementById('MainContent_divTT');
                if (!div) return false;
                const text = div.innerText || '';
                const tables = div.querySelectorAll('table tr');
                return tables.length > 2 || text.includes('недоступно');
            }, { timeout: 8000 }).catch(() => {});

            const html = await page.content();
            const $ = cheerio.load(html);
            const divText = $('#MainContent_divTT').text().trim().replace(/\s+/g, ' ');
            console.log(`[Browser] divTT text: ${divText.substring(0, 150)}`);

            if ($('table tr').length > 2 && !divText.includes('временно недоступно')) {
                // Parse rows
                const hName = $('#MainContent_divTT h1, #MainContent_divTT h2, .container h1').first().text().trim();
                if (hName) groupName = hName;

                const headerInfoText = $('#MainContent_divTT .alert, #MainContent_divTT p, .container .alert').text().trim();
                const semMatch = headerInfoText.match(/(\d+\s*семестр[^)]*?\d{4})/i) || html.match(/(\d+\s*семестр[^\n<]+)/i);
                if (semMatch) semesterDates = semMatch[1].trim();

                const weekMatch = headerInfoText.match(/(\d+\s*неделя[^\n<]*)/i) || html.match(/(\d+\s*неделя[^\n<]*)/i);
                if (weekMatch) currentWeekInfo = weekMatch[1].trim();

                let currentDayName = 'ПОНЕДЕЛЬНИК';
                let currentDayIndex = 1;

                $('table tr').each((i, el) => {
                    const colspan = $(el).find('td[colspan], th[colspan]').text().trim();
                    if (colspan) {
                        for (const [dName, dIdx] of Object.entries(DAY_MAP)) {
                            if (colspan.toUpperCase().includes(dName)) {
                                currentDayName = dName;
                                currentDayIndex = dIdx;
                                return;
                            }
                        }
                    }

                    const tds = $(el).find('td');
                    if (tds.length >= 2) {
                        const timeCell = $(tds[0]).text().trim();
                        const timeMatch = timeCell.match(/(\d{1,2}[:.]\d{2})/);
                        if (!timeMatch) return;

                        let timeStart = timeMatch[1].replace('.', ':');
                        if (timeStart.length === 4 && timeStart[1] === ':') timeStart = '0' + timeStart;

                        const iTag = $(tds[0]).find('i').attr('class') || '';
                        const cell0Html = $(tds[0]).html() || '';

                        let parity = 'WEEKLY';
                        if (iTag.includes('text-danger') || iTag.includes('text-warning') || cell0Html.includes('text-danger') || cell0Html.includes('text-warning')) {
                            parity = 'ODD';
                        } else if (iTag.includes('text-primary') || iTag.includes('text-info') || cell0Html.includes('text-primary')) {
                            parity = 'EVEN';
                        } else if (iTag.includes('fa-circle-o') || cell0Html.includes('fa-circle-o')) {
                            parity = 'WEEKLY';
                        }

                        const typeSpan = $(tds[1]).find('span.px-3, span.bg-light, small, .badge').text().trim();
                        const cloneSubj = $(tds[1]).clone();
                        cloneSubj.find('span.px-3, span.bg-light, small, .badge').remove();
                        const subject = cloneSubj.text().trim().replace(/\s+/g, ' ');

                        const aud = tds.length > 2 ? $(tds[2]).text().trim().replace(/\s+/g, ' ') : '';
                        const teacher = tds.length > 3 ? $(tds[3]).text().trim().replace(/\s+/g, ' ') : '';

                        if (subject.length > 0) {
                            lessons.push({
                                id: Date.now() + i,
                                dayOfWeekIndex: currentDayIndex,
                                dayName: currentDayName,
                                timeStart,
                                timeEnd: '',
                                parity,
                                lessonType: typeSpan || 'занятие',
                                subject,
                                auditorium: aud,
                                teacher
                            });
                        }
                    }
                });

                if (lessons.length > 0) break;
            }

            // Short pause before retry
            await new Promise(r => setTimeout(r, 1200));
        }

        await page.close();
        page = null;

    } catch (err) {
        if (page) {
            try { await page.close(); } catch (_) {}
        }
        console.error('[Browser] Scrape error:', err.message);
    }

    // If live scraping was blocked by BSU GeoIP / server outage, serve preset copy
    if (lessons.length === 0 && (idg === '33344' || idg === '33343')) {
        console.log(`[Browser] Serving verified preset schedule for group ${idg}`);
        return res.json({
            ...PRESET_II26_1,
            isPresetFallback: true,
            serverNotice: 'Сайт БГУ временно недоступен — отдана эталонная копия'
        });
    }

    const resultData = {
        groupId: idg,
        groupName,
        semesterDates,
        currentWeekInfo,
        lastUpdatedMillis: Date.now(),
        lessons
    };

    if (lessons.length > 0) {
        cache.set(cacheKey, { timestamp: Date.now(), data: resultData });
    }

    res.json(resultData);
});

// GET All Groups
app.get('/api/groups', async (req, res) => {
    const cacheKey = 'all_groups';
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL * 3)) {
        return res.json(cached.data);
    }

    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        await page.emulateTimezone('Asia/Irkutsk');
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
        
        await page.goto('https://bgu.ru/student/timetable.aspx', {
            waitUntil: 'domcontentloaded',
            timeout: 25000
        });

        const html = await page.content();
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const groups = [];

        $('a[href*="idg="]').each((i, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(/idg=([a-zA-Z0-9_-]+)/);
            if (match) {
                const idg = match[1];
                const name = $(el).text().trim();
                if (name && !groups.some(g => g.idg === idg)) {
                    groups.push({ idg, name });
                }
            }
        });

        cache.set(cacheKey, { timestamp: Date.now(), data: groups });
        res.json(groups);
    } catch (err) {
        if (page) {
            try { await page.close(); } catch (_) {}
        }
        res.status(502).json({ error: 'Failed to load groups list', message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`BSU Schedule Cloud Browser API running on port ${PORT}`);
});
