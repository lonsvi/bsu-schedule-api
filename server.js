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
                console.log('[Browser] Browser disconnected, resetting reference.');
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
        service: 'BSU Schedule Live Scraper API',
        location_spoof: 'Irkutsk, Russia (GMT+8)',
        endpoints: {
            schedule: '/api/schedule?idg=33344',
            groups: '/api/groups'
        }
    });
});

// GET Live Schedule for group idg
app.get('/api/schedule', async (req, res) => {
    const idg = req.query.idg || '33344';
    const cacheKey = `schedule_${idg}`;

    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL) && cached.data.lessons.length > 0) {
        return res.json({ ...cached.data, cached: true });
    }

    let page = null;
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

        console.log(`[Browser] Loading main page to initialize session...`);
        await page.goto('https://bgu.ru/student/timetable.aspx', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        console.log(`[Browser] Navigating to group idg=${idg}...`);
        
        // Execute direct click or URL switch
        await page.evaluate((targetIdg) => {
            const link = document.querySelector(`a[href*="idg=${targetIdg}"]`);
            if (link) {
                link.click();
            } else {
                window.location.href = `https://bgu.ru/student/timetable.aspx?idg=${targetIdg}`;
            }
        }, idg);

        // Wait for table to render or notice
        await page.waitForFunction(() => {
            const div = document.getElementById('MainContent_divTT');
            if (!div) return false;
            const text = div.innerText || '';
            const tables = div.querySelectorAll('table tr');
            return tables.length > 2 || text.includes('недоступно');
        }, { timeout: 10000 }).catch(() => {});

        const html = await page.content();
        await page.close();
        page = null;

        const $ = cheerio.load(html);
        const divText = $('#MainContent_divTT').text().trim().replace(/\s+/g, ' ');
        console.log(`[Browser] divTT text: ${divText.substring(0, 150)}`);

        if (divText.includes('временно недоступно')) {
            return res.status(503).json({
                error: 'BSU timetable temporarily unavailable',
                message: 'Сайт БГУ вернул сообщение: Расписание временно недоступно'
            });
        }

        const groupName = $('#MainContent_divTT h1, #MainContent_divTT h2, .container h1').first().text().trim() || `Группа ${idg}`;
        
        let semesterDates = '';
        let currentWeekInfo = '';

        const headerInfoText = $('#MainContent_divTT .alert, #MainContent_divTT p, .container .alert').text().trim();
        const semMatch = headerInfoText.match(/(\d+\s*семестр[^)]*?\d{4})/i) || html.match(/(\d+\s*семестр[^\n<]+)/i);
        if (semMatch) semesterDates = semMatch[1].trim();

        const weekMatch = headerInfoText.match(/(\d+\s*неделя[^\n<]*)/i) || html.match(/(\d+\s*неделя[^\n<]*)/i);
        if (weekMatch) currentWeekInfo = weekMatch[1].trim();

        const rows = $('table tr');
        let currentDayName = 'ПОНЕДЕЛЬНИК';
        let currentDayIndex = 1;
        const lessons = [];

        rows.each((i, el) => {
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

        if (lessons.length === 0) {
            return res.status(502).json({
                error: 'No lessons found in live table',
                message: 'Таблица занятий не была получена от сайта БГУ'
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

        cache.set(cacheKey, { timestamp: Date.now(), data: resultData });
        res.json(resultData);

    } catch (err) {
        if (page) {
            try { await page.close(); } catch (_) {}
        }
        console.error('[Browser] Scrape error:', err.message);
        res.status(502).json({
            error: 'Failed to scrape timetable with cloud browser',
            message: err.message
        });
    }
});

// GET All Groups (Pure live scraper)
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

        if (groups.length === 0) {
            return res.status(502).json({ error: 'Failed to load live groups list' });
        }

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
    console.log(`BSU Schedule Live Scraper API running on port ${PORT}`);
});
