# Apple Weather MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server providing **weather data** from public NOAA and Open‑Meteo APIs — forecasts, current conditions, alerts, air quality, and more. No API keys required.

Part of the [Apple MCP Servers](../README.md) collection.

## Capabilities

- **Forecasts** — multi‑day forecasts (NOAA in the US, Open‑Meteo globally, auto‑selected).
- **Weather windows** — `find_weather_window` answers *when* to do something rather than what the weather will be: it scans the hourly forecast for contiguous stretches that satisfy a duration, a precipitation‑chance ceiling, optional temperature/wind limits, a daily time range, and daylight, then returns each window with a copy‑paste start time. When nothing matches, it names the constraint that eliminated the most hours.
- **Current conditions** — station observations in the US, model data elsewhere.
- **Alerts** — severe‑weather alerts and warnings (NOAA, US).
- **Summary** — one‑call overview combining current conditions, forecast, and alerts.
- **Air quality & marine** — AQI/pollutants and wave/swell/current data (Open‑Meteo, global).
- **Historical** — historical weather back to 1940 (Open‑Meteo, global).
- **Location** — search/geocode place names and save frequently used locations.
- **Service status** — health check across the upstream APIs.

Additional specialized tools (radar imagery, lightning, wildfire, river conditions) are available depending on the configured tool preset.

## Coordination

`find_weather_window` is designed to pair with a calendar free/busy search: find the open slots with [`apple-events`](../apple-events/) `calendar_schedule` `free-slots`, then use this to pick which of those slots is actually dry and warm enough, and create the event there. The `Start time for scheduling` values it returns are local to the location and can be passed straight to a calendar tool.

## Requirements

- Node.js. `start.sh` installs dependencies with `npm` and builds on first run.
- Network access to the public NOAA and Open‑Meteo endpoints. No account or key needed.

## Running

```bash
bash start.sh
```

`start.sh` installs dependencies and rebuilds when the source changes, then runs `dist/index.js`.

## Configuration

Optional environment variables (units, caching, logging) are documented in [`.env.example`](.env.example).

## License

[MIT](LICENSE) © 2026 Harsh
