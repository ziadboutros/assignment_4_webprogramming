/* Optional browser checks. All test data below is synthetic; the app does not
   import fixtures. The submitted screenshots are captured with live API data. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const place = { name: 'Beirut', latitude: 33.89, longitude: 35.5, admin1: 'Beirut', country: 'Lebanon' };
const current = { temperature_2m: 22.4, relative_humidity_2m: 68, apparent_temperature: 23.7, weather_code: 0, wind_speed_10m: 8.2, is_day: 0, time: '2026-10-12T22:45' };
const reply = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
let browser;
let count = 0;
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const content = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404).end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: 'chromium',
    executablePath: process.env.TEST_BROWSER_PATH || undefined });

  async function check(name, run) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(error.message));
    try {
      await page.route('**/geocoding-api.open-meteo.com/**', route => reply(route, { results: [place] }));
      await page.route('**/api.open-meteo.com/**', route => reply(route, { current }));
      await page.goto(url);
      await run(page);
      assert.deepEqual(uncaught, [], 'No uncaught JavaScript errors');
      console.log(`PASS ${++count}: ${name}`);
    } finally { await context.close(); }
  }
  const search = async (page, city = 'Beirut') => {
    await page.locator('#city-input').fill(city);
    await page.locator('#city-input').press('Enter');
    await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
  };
  const expectError = async (page, text) => {
    assert.equal(await page.locator('#error').isVisible(), true);
    assert.match(await page.locator('#error').textContent(), text);
    assert.equal(await page.locator('#weather-card').isHidden(), true);
    assert.equal(await page.locator('#search-button').isEnabled(), true);
  };

  await check('Clean initial state, no request before submission', async page => {
    assert.equal(await page.locator('#empty-state').isVisible(), true);
    assert.equal(await page.locator('#weather-card').isHidden(), true);
    assert.equal(await page.locator('#error').isHidden(), true);
  });
  await check('Blank, short and numeric input validation', async page => {
    await search(page, '   '); await expectError(page, /enter a city/i);
    await search(page, 'A'); await expectError(page, /two characters/i);
    await search(page, '123'); await expectError(page, /city name/i);
  });
  await check('Loading state, disabled controls and recovered controls', async page => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/geocoding-api.open-meteo.com/**', async route => {
      await gate; await reply(route, { results: [place] });
    });
    await page.locator('#city-input').fill('Beirut');
    await page.locator('#search-button').click();
    assert.equal(await page.locator('#loading').isVisible(), true);
    assert.equal(await page.locator('#search-button').isDisabled(), true);
    assert.equal(await page.locator('#city-input').isDisabled(), true);
    assert.equal(await page.locator('#results').getAttribute('aria-busy'), 'true');
    release();
    await page.waitForFunction(() => !document.querySelector('#weather-card').hidden);
    assert.equal(await page.locator('#loading').isHidden(), true);
    assert.equal(await page.locator('#search-button').isEnabled(), true);
    assert.equal(await page.locator('#results').getAttribute('aria-busy'), 'false');
  });
  await check('All weather fields, night icon and city-local time', async page => {
    await search(page);
    assert.equal(await page.locator('#city-name').textContent(), 'Beirut');
    assert.equal(await page.locator('#temperature').textContent(), '22');
    assert.equal(await page.locator('#feels-like').textContent(), '24');
    assert.equal(await page.locator('#humidity').textContent(), '68');
    assert.equal(await page.locator('#wind').textContent(), '8.2');
    assert.equal(await page.locator('#description').textContent(), 'Clear sky');
    assert.equal(await page.locator('#weather-icon').getAttribute('src'), 'assets/icons/night.svg');
    assert.match(await page.locator('#updated').textContent(), /22:45/);
  });
  await check('New search replaces every result dynamically', async page => {
    await search(page);
    await page.route('**/geocoding-api.open-meteo.com/**', route => reply(route, { results: [{ ...place, name: 'Paris', admin1: 'Île-de-France', country: 'France' }] }));
    await page.route('**/api.open-meteo.com/**', route => reply(route, { current: { ...current, temperature_2m: 10.2, apparent_temperature: 8.1, relative_humidity_2m: 80, wind_speed_10m: 19.3, weather_code: 63, is_day: 1 } }));
    await search(page, 'Paris');
    assert.equal(await page.locator('#city-name').textContent(), 'Paris');
    assert.equal(await page.locator('#temperature').textContent(), '10');
    assert.equal(await page.locator('#humidity').textContent(), '80');
    assert.equal(await page.locator('#wind').textContent(), '19.3');
    assert.equal(await page.locator('#feels-like').textContent(), '8');
    assert.equal(await page.locator('#description').textContent(), 'Moderate rain');
    assert.match(await page.locator('#weather-icon').getAttribute('src'), /rain.svg/);
  });
  await check('Invalid city and recovery with a valid search', async page => {
    await page.route('**/geocoding-api.open-meteo.com/**', route => reply(route, {}));
    await search(page, 'zzzzinvalidcity'); await expectError(page, /No city found/);
    await page.route('**/geocoding-api.open-meteo.com/**', route => reply(route, { results: [place] }));
    await search(page); assert.equal(await page.locator('#weather-card').isVisible(), true);
    assert.equal(await page.locator('#error').isHidden(), true);
  });
  for (const stage of ['geocoding-api', 'api']) {
    for (const [status, message] of [[429, /Too many requests/], [503, /temporarily unavailable/], [400, /HTTP 400/]]) {
      await check(`${stage}: HTTP ${status} handled`, async page => {
        await page.route(`**/${stage}.open-meteo.com/**`, route => reply(route, {}, status));
        await search(page); await expectError(page, message);
      });
    }
  }
  await check('Network failure is handled', async page => {
    await page.route('**/api.open-meteo.com/**', route => route.abort('failed'));
    await search(page); await expectError(page, /internet connection/);
  });
  await check('Malformed JSON is handled', async page => {
    await page.route('**/api.open-meteo.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{bad json' }));
    await search(page); await expectError(page, /unreadable data/);
  });
  await check('Incomplete weather data is rejected', async page => {
    await page.route('**/api.open-meteo.com/**', route => reply(route, { current: { ...current, temperature_2m: null } }));
    await search(page); await expectError(page, /incomplete data/);
  });
  await check('Unsafe city text is rendered as text', async page => {
    const name = '<img src=x onerror="alert(1)">';
    await page.route('**/geocoding-api.open-meteo.com/**', route => reply(route, { results: [{ ...place, name }] }));
    await search(page);
    assert.equal(await page.locator('#city-name').textContent(), name);
    assert.equal(await page.locator('#city-name img').count(), 0);
  });
  await check('Timeout exits loading and allows retry', async page => {
    await page.clock.install();
    await page.route('**/geocoding-api.open-meteo.com/**', () => {});
    await page.locator('#city-input').fill('Beirut');
    await page.locator('#search-button').click();
    await page.clock.runFor(15001);
    await page.waitForFunction(() => !document.querySelector('#search-button').disabled);
    await expectError(page, /took too long/);
  });
  await check('Mobile, tablet and desktop widths have no horizontal overflow', async page => {
    await search(page);
    for (const width of [320, 390, 600, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
      assert.equal(await page.locator('#search-button').isVisible(), true);
    }
  });
  console.log(`\n${count} browser checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
