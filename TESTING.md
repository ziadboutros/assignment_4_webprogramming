# Verification

## Automated browser checks

18 checks passed in Chromium using Playwright. The test script uses synthetic API responses only for deterministic verification. Every check also verifies there are no uncaught JavaScript errors.

- Initial empty state loads correctly.
- Blank, one-character and numeric-only input show useful errors.
- Loading is visible, controls are disabled during a request, and controls recover afterward.
- Temperature, conditions, night icon, feels-like temperature, humidity, wind and city-local time render correctly.
- A second city's response replaces all displayed data.
- An invalid city shows an error, then a valid search succeeds.
- HTTP 429, 503 and 400 are handled for both the geocoding and weather endpoints (six checks).
- A failed network request is handled.
- Malformed JSON is handled.
- Incomplete weather data is rejected.
- Returned city names render safely as text.
- A 15-second timeout exits loading and allows retry.
- No horizontal overflow at 320, 390, 600, 768 and 1440 pixel widths.

Run these checks with the optional commands in the README. Test fixtures are confined to `tests/` and are never loaded by the app.

## Live API and screenshot verification

The real geocoding and weather endpoints returned HTTP 200 and usable current data for both Beirut and Paris on 12 October 2026. The dashboard rendered both cities and replaced their results correctly.

The screenshots show freshly fetched Beirut data: 23 °C, partly cloudy, feels like 25 °C, humidity 81%, and wind 9.3 km/h. The API timestamp was 12 October 2026 at 23:15, local to Beirut.

The test environment's network proxy blocks Chromium's direct HTTPS requests. For these live-data captures, the actual API responses were retrieved over HTTPS with Python and forwarded to the browser's requests, rather than using synthetic test values. Direct end-to-end browser-to-public-API connectivity could not be verified here. The production app still fetches the public APIs directly and contains no forwarding code or recorded responses. Verify direct connectivity on your computer using the manual steps below.

Opening the actual `index.html` as a local file also showed the correct initial state without uncaught JavaScript errors.

## Manual checks before submission

1. Extract the ZIP and open `index.html`, or start Live Server.
2. Search for a city such as Beirut; verify every displayed field and the selected country.
3. Search for Paris; verify that the city and results change.
4. Search for `zzzzinvalidcity`; verify that a clear message replaces old weather data.
5. Submit a blank input; verify that the form requests a city name.
6. Disable the network in browser developer tools, search again, and verify an error with enabled controls.
7. Restore the network and search again; verify that the app recovers.
8. Try a narrow mobile viewport, then use Tab and Enter to operate the form.
9. Run `git log --oneline --reverse`; verify that the three build commits are present.
10. Push the extracted repository to your GitHub account and submit its URL together with the ZIP.
