'use strict';

// Open-Meteo's public, non-commercial APIs require no API key.
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 15000;

const form = document.querySelector('#search-form');
const cityInput = document.querySelector('#city-input');
const searchButton = document.querySelector('#search-button');
const results = document.querySelector('#results');
const loading = document.querySelector('#loading');
const errorBox = document.querySelector('#error');
const emptyState = document.querySelector('#empty-state');
const weatherCard = document.querySelector('#weather-card');
const announcement = document.querySelector('#announcement');
let isLoading = false;

// WMO weather codes: each description and icon comes from the returned code.
const CONDITIONS = {
  0: ['Clear sky', 'clear'],
  1: ['Mainly clear', 'partly-cloudy'],
  2: ['Partly cloudy', 'partly-cloudy'],
  3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'],
  48: ['Depositing rime fog', 'fog'],
  51: ['Light drizzle', 'rain'],
  53: ['Moderate drizzle', 'rain'],
  55: ['Dense drizzle', 'rain'],
  56: ['Light freezing drizzle', 'rain'],
  57: ['Dense freezing drizzle', 'rain'],
  61: ['Slight rain', 'rain'],
  63: ['Moderate rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Light freezing rain', 'rain'],
  67: ['Heavy freezing rain', 'rain'],
  71: ['Slight snowfall', 'snow'],
  73: ['Moderate snowfall', 'snow'],
  75: ['Heavy snowfall', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Slight rain showers', 'rain'],
  81: ['Moderate rain showers', 'rain'],
  82: ['Violent rain showers', 'rain'],
  85: ['Slight snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'],
  96: ['Thunderstorm with slight hail', 'storm'],
  99: ['Thunderstorm with heavy hail', 'storm']
};

function setLoading(busy) {
  isLoading = busy;
  loading.hidden = !busy;
  searchButton.disabled = busy;
  cityInput.disabled = busy;
  searchButton.firstChild.textContent = busy ? 'Searching… ' : 'Check weather ';
  results.setAttribute('aria-busy', String(busy));
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
  cityInput.removeAttribute('aria-invalid');
  cityInput.setAttribute('aria-describedby', 'search-hint');
}

function showError(message, invalidInput = false) {
  // Hide old results so an earlier city's data never looks like the new result.
  weatherCard.hidden = true;
  emptyState.hidden = true;
  errorBox.textContent = message;
  errorBox.hidden = false;
  if (invalidInput) {
    cityInput.setAttribute('aria-invalid', 'true');
    cityInput.setAttribute('aria-describedby', 'search-hint error');
  }
}

function validateCity(value) {
  const city = value.trim().replace(/\s+/g, ' ');
  if (!city) throw new Error('Please enter a city name before searching.');
  if (city.length < 2) throw new Error('Please enter at least two characters for the city name.');
  if (city.length > 80) throw new Error('Please keep the city name to 80 characters or fewer.');
  if (!/\p{L}/u.test(city)) throw new Error('Please enter a city name, such as Beirut or Paris.');
  return city;
}

async function fetchJSON(url, signal) {
  try {
    const response = await fetch(url, { signal });
    if (response.status === 429) {
      throw new Error('Too many requests. Please wait a minute before searching again.');
    }
    // Explicitly handle all non-200 responses before trying to parse JSON.
    if (response.status !== 200) {
      if (response.status >= 500) {
        throw new Error('The weather service is temporarily unavailable. Please try again later.');
      }
      throw new Error(`The weather service could not complete the request (HTTP ${response.status}). Please try again.`);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('The weather service returned unreadable data. Please try again.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) {
      throw new Error('The weather service returned an unexpected response. Please try again.');
    }
    return data;
  } catch (error) {
    if (signal.aborted) {
      throw new Error('The request took too long. Check your internet connection and try again.');
    }
    if (error instanceof TypeError) {
      throw new Error('Could not connect to the weather service. Check your internet connection and try again.');
    }
    throw error;
  }
}

async function getWeather(city, signal) {
  const locationURL = new URL(GEOCODING_URL);
  locationURL.search = new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' });
  const locations = await fetchJSON(locationURL, signal);
  if (locations.results !== undefined && !Array.isArray(locations.results)) {
    throw new Error('The location service returned unexpected data. Please try again.');
  }
  if (!locations.results?.length) {
    throw new Error(`No city found for “${city}”. Check the spelling and try again.`);
  }
  const place = locations.results[0];
  if (!place || typeof place.name !== 'string' || !place.name.trim() ||
      !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) ||
      Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) {
    throw new Error('The location service returned incomplete data. Please try again.');
  }

  const weatherURL = new URL(WEATHER_URL);
  weatherURL.search = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
    forecast_days: '1'
  });
  const data = await fetchJSON(weatherURL, signal);
  const current = data.current;
  const numericFields = ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'weather_code', 'wind_speed_10m', 'is_day'];
  if (!current || !numericFields.every(field => Number.isFinite(current[field])) ||
      !Number.isInteger(current.weather_code) ||
      current.relative_humidity_2m < 0 || current.relative_humidity_2m > 100 ||
      current.wind_speed_10m < 0 || ![0, 1].includes(current.is_day) ||
      typeof current.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(current.time)) {
    throw new Error('The weather service returned incomplete data. Please try again.');
  }
  return { place, current };
}

function renderWeather({ place, current }) {
  let [description, icon] = CONDITIONS[current.weather_code] || ['Unknown conditions', 'unknown'];
  if (current.weather_code === 0 && current.is_day === 0) icon = 'night';
  const details = [...new Set([place.admin1, place.country].filter(value => typeof value === 'string' && value && value !== place.name))];

  document.querySelector('#city-name').textContent = place.name;
  document.querySelector('#location').textContent = details.join(', ');
  document.querySelector('#temperature').textContent = Math.round(current.temperature_2m);
  document.querySelector('#description').textContent = description;
  document.querySelector('#feels-like').textContent = Math.round(current.apparent_temperature);
  document.querySelector('#humidity').textContent = Math.round(current.relative_humidity_2m);
  document.querySelector('#wind').textContent = current.wind_speed_10m.toFixed(1);
  const image = document.querySelector('#weather-icon');
  image.src = `assets/icons/${icon}.svg`;
  image.alt = description;

  // The API's ISO timestamp is already local to the city. Format its components
  // as UTC so the viewer's own timezone does not shift the displayed city time.
  const localDate = new Date(`${current.time}Z`);
  if (Number.isNaN(localDate.getTime())) {
    throw new Error('The weather service returned an invalid update time. Please try again.');
  }
  const displayTime = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC'
  }).format(localDate);
  document.querySelector('#updated').textContent = `Updated ${displayTime} · Local time in ${place.name}`;
  weatherCard.hidden = false;
  emptyState.hidden = true;
  announcement.textContent = `Weather for ${place.name}: ${Math.round(current.temperature_2m)} degrees Celsius, ${description}.`;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (isLoading) return; // Prevent overlapping requests and stale results.
  clearError();
  announcement.textContent = '';
  let city;
  try {
    city = validateCity(cityInput.value);
  } catch (error) {
    showError(error.message, true);
    cityInput.focus();
    return;
  }

  cityInput.value = city;
  weatherCard.hidden = true;
  emptyState.hidden = true;
  setLoading(true);
  const controller = new AbortController();
  // One deadline covers both the city lookup and the weather request.
  const timeoutID = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const weather = await getWeather(city, controller.signal);
    renderWeather(weather);
  } catch (error) {
    showError(error.message || 'Something went wrong. Please try again.');
  } finally {
    clearTimeout(timeoutID);
    setLoading(false);
    if (!errorBox.hidden) cityInput.focus();
  }
});
