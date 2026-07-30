/**
 * Handler for find_weather_window
 *
 * Scans the hourly forecast for stretches of time that satisfy weather constraints,
 * so a caller can pick *when* to do something rather than only ask what the weather
 * will be. Pairs with a calendar free/busy search: find the open slots first, then
 * ask this which of them are actually pleasant.
 */

import { OpenMeteoService } from '../services/openmeteo.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, formatLocationLine } from '../utils/locationResolver.js';
import { resolveUnitPreferences, UnitArgs } from '../utils/unitPreferences.js';
import { temperatureLabel, windSpeedLabel } from '../utils/unitFormat.js';
import { formatInTimezone } from '../utils/timezone.js';
import { logger } from '../utils/logger.js';
import { DataNotFoundError } from '../errors/ApiError.js';

interface WeatherWindowArgs extends UnitArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  days?: number;
  duration_hours?: number;
  max_precipitation_probability?: number;
  min_temperature?: number;
  max_temperature?: number;
  max_wind_speed?: number;
  earliest_hour?: number;
  latest_hour?: number;
  daylight_only?: boolean;
  max_results?: number;
}

/** One hour of forecast, reduced to the fields the constraints care about. */
interface HourSample {
  time: string;
  hour: number;
  temperature?: number;
  precipitationProbability?: number;
  windSpeed?: number;
  isDay?: boolean;
}

interface Window {
  startIndex: number;
  endIndex: number;
  hours: HourSample[];
}

/** Reasons an hour was rejected, tallied so a no-results answer is actionable. */
interface RejectionTally {
  precipitation: number;
  temperatureLow: number;
  temperatureHigh: number;
  wind: number;
  timeOfDay: number;
  darkness: number;
}

const clampNumber = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  label: string
): number => {
  if (value === undefined || value === null) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a number`);
  }
  if (numeric < min || numeric > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return numeric;
};

const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Groups consecutive passing hours into windows of at least `durationHours`.
 * Hour indices must be contiguous in the source series for a window to form, so a
 * single failing hour correctly splits a run in two.
 */
function collectWindows(
  samples: HourSample[],
  passing: boolean[],
  durationHours: number
): Window[] {
  const windows: Window[] = [];
  let runStart = -1;

  for (let i = 0; i <= samples.length; i++) {
    const ok = i < samples.length && passing[i];
    if (ok && runStart === -1) {
      runStart = i;
      continue;
    }
    if (!ok && runStart !== -1) {
      const length = i - runStart;
      if (length >= durationHours) {
        windows.push({
          startIndex: runStart,
          endIndex: i - 1,
          hours: samples.slice(runStart, i),
        });
      }
      runStart = -1;
    }
  }

  return windows;
}

export async function handleFindWeatherWindow(
  args: unknown,
  openMeteoService: OpenMeteoService,
  locationStore: LocationStore,
  geocodingService: GeocodingService
) {
  const typedArgs = (args ?? {}) as WeatherWindowArgs;
  const prefs = resolveUnitPreferences(typedArgs);

  const days = clampNumber(typedArgs.days, 1, 16, 3, 'days');
  const durationHours = clampNumber(
    typedArgs.duration_hours,
    1,
    24,
    2,
    'duration_hours'
  );
  const maxPrecipProbability = clampNumber(
    typedArgs.max_precipitation_probability,
    0,
    100,
    25,
    'max_precipitation_probability'
  );
  const earliestHour = clampNumber(typedArgs.earliest_hour, 0, 23, 7, 'earliest_hour');
  const latestHour = clampNumber(typedArgs.latest_hour, 1, 24, 21, 'latest_hour');
  const maxResults = clampNumber(typedArgs.max_results, 1, 50, 10, 'max_results');

  if (latestHour <= earliestHour) {
    throw new Error('latest_hour must be greater than earliest_hour');
  }

  const minTemperature =
    typedArgs.min_temperature === undefined
      ? undefined
      : Number(typedArgs.min_temperature);
  const maxTemperature =
    typedArgs.max_temperature === undefined
      ? undefined
      : Number(typedArgs.max_temperature);
  if (
    minTemperature !== undefined &&
    maxTemperature !== undefined &&
    minTemperature > maxTemperature
  ) {
    throw new Error('min_temperature cannot be greater than max_temperature');
  }
  const maxWindSpeed =
    typedArgs.max_wind_speed === undefined
      ? undefined
      : Number(typedArgs.max_wind_speed);
  const daylightOnly = typedArgs.daylight_only === true;

  const location = await resolveLocationAsync(
    typedArgs,
    locationStore,
    geocodingService
  );

  logger.debug('find_weather_window', {
    latitude: location.latitude,
    longitude: location.longitude,
    days,
    durationHours,
  });

  // Open-Meteo is used unconditionally: it is global and returns a uniform hourly
  // series, which is what the window scan needs. NOAA's period model is coarser.
  const forecast = await openMeteoService.getForecast(
    location.latitude,
    location.longitude,
    days,
    true,
    prefs
  );

  const hourly = forecast.hourly;
  if (!hourly?.time || hourly.time.length === 0) {
    throw new DataNotFoundError(
      'OpenMeteo',
      'No hourly forecast data available for this location.'
    );
  }

  const timezone = forecast.timezone ?? 'UTC';
  const samples: HourSample[] = hourly.time.map((time: string, i: number) => ({
    time,
    // Open-Meteo returns local-to-location timestamps, so the hour is read directly.
    hour: Number(time.slice(11, 13)),
    temperature: hourly.temperature_2m?.[i],
    precipitationProbability: hourly.precipitation_probability?.[i],
    windSpeed: hourly.wind_speed_10m?.[i],
    isDay: hourly.is_day?.[i] === undefined ? undefined : hourly.is_day[i] === 1,
  }));

  const rejections: RejectionTally = {
    precipitation: 0,
    temperatureLow: 0,
    temperatureHigh: 0,
    wind: 0,
    timeOfDay: 0,
    darkness: 0,
  };

  const passing = samples.map((sample) => {
    if (sample.hour < earliestHour || sample.hour >= latestHour) {
      rejections.timeOfDay++;
      return false;
    }
    if (daylightOnly && sample.isDay === false) {
      rejections.darkness++;
      return false;
    }
    if (
      sample.precipitationProbability !== undefined &&
      sample.precipitationProbability > maxPrecipProbability
    ) {
      rejections.precipitation++;
      return false;
    }
    if (
      minTemperature !== undefined &&
      sample.temperature !== undefined &&
      sample.temperature < minTemperature
    ) {
      rejections.temperatureLow++;
      return false;
    }
    if (
      maxTemperature !== undefined &&
      sample.temperature !== undefined &&
      sample.temperature > maxTemperature
    ) {
      rejections.temperatureHigh++;
      return false;
    }
    if (
      maxWindSpeed !== undefined &&
      sample.windSpeed !== undefined &&
      sample.windSpeed > maxWindSpeed
    ) {
      rejections.wind++;
      return false;
    }
    return true;
  });

  const windows = collectWindows(samples, passing, durationHours).slice(
    0,
    maxResults
  );

  const tempUnit = temperatureLabel(prefs);
  const windUnit = windSpeedLabel(prefs);

  const constraintLines = [
    `- At least ${durationHours}h long`,
    `- Precipitation chance ≤ ${maxPrecipProbability}%`,
    `- Between ${String(earliestHour).padStart(2, '0')}:00 and ${String(latestHour).padStart(2, '0')}:00 local time`,
  ];
  if (minTemperature !== undefined)
    constraintLines.push(`- Temperature ≥ ${minTemperature}${tempUnit}`);
  if (maxTemperature !== undefined)
    constraintLines.push(`- Temperature ≤ ${maxTemperature}${tempUnit}`);
  if (maxWindSpeed !== undefined)
    constraintLines.push(`- Wind ≤ ${maxWindSpeed} ${windUnit}`);
  if (daylightOnly) constraintLines.push('- Daylight only');

  let output = '# Suitable Weather Windows\n\n';
  output += `${formatLocationLine(location)}\n`;
  output += `**Searched:** next ${days} day(s) of hourly forecast (${samples.length} hours)\n\n`;
  output += `**Constraints**\n${constraintLines.join('\n')}\n\n`;

  if (windows.length === 0) {
    output += '## No matching window found\n\n';
    // Naming the binding constraint turns a dead end into a next step.
    const blockers = (
      [
        ['precipitation chance', rejections.precipitation],
        ['temperature below minimum', rejections.temperatureLow],
        ['temperature above maximum', rejections.temperatureHigh],
        ['wind', rejections.wind],
        ['outside the requested hours', rejections.timeOfDay],
        ['darkness', rejections.darkness],
      ] as Array<[string, number]>
    )
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    if (blockers.length > 0) {
      output += 'Hours were ruled out by:\n';
      blockers.forEach(([reason, count]) => {
        output += `- ${reason}: ${count} hour(s)\n`;
      });
      output += '\n';
      output += `Loosen the dominant constraint (${blockers[0][0]}), shorten duration_hours, widen earliest_hour/latest_hour, or extend days.\n`;
    } else {
      output +=
        'No hours passed the filter. Try increasing days or relaxing the constraints.\n';
    }
    return { content: [{ type: 'text' as const, text: output }] };
  }

  output += `## ${windows.length} window(s) found\n\n`;

  windows.forEach((window, index) => {
    const first = window.hours[0];
    const last = window.hours[window.hours.length - 1];
    const startLabel = formatInTimezone(first.time, timezone, 'short', prefs.timeFormat);
    // The window covers the last sampled hour in full, hence the +1h end label.
    const endTime = new Date(new Date(last.time).getTime() + 60 * 60 * 1000);
    const endLabel = formatInTimezone(
      endTime.toISOString(),
      timezone,
      'short',
      prefs.timeFormat
    );

    output += `### ${index + 1}. ${startLabel} → ${endLabel} (${window.hours.length}h)\n`;

    const temps = window.hours
      .map((hour) => hour.temperature)
      .filter((value): value is number => value !== undefined);
    if (temps.length > 0) {
      output += `- Temperature: ${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))}${tempUnit}\n`;
    }

    const precip = window.hours
      .map((hour) => hour.precipitationProbability)
      .filter((value): value is number => value !== undefined);
    if (precip.length > 0) {
      output += `- Precipitation chance: max ${Math.max(...precip)}%, avg ${Math.round(average(precip))}%\n`;
    }

    const winds = window.hours
      .map((hour) => hour.windSpeed)
      .filter((value): value is number => value !== undefined);
    if (winds.length > 0) {
      output += `- Wind: up to ${Math.round(Math.max(...winds))} ${windUnit}\n`;
    }

    output += `- Start time for scheduling: \`${first.time.slice(0, 16).replace('T', ' ')}\`\n\n`;
  });

  output +=
    '*The `Start time for scheduling` values are local to the location and can be passed straight to a calendar tool.*\n';

  return { content: [{ type: 'text' as const, text: output }] };
}
