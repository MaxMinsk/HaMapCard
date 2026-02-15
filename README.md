# HaMapCard

Minimal Home Assistant Lovelace card with map.

Card type: `custom:people-map-plus`

## Features (minimal)

1. OpenStreetMap base layer (Leaflet).
2. Markers for configured `person.*` entities.
3. If `persons` is empty, auto-picks up to 5 `person.*` entities.
4. Panel-friendly height mode for full-width/full-height map.
5. Coordinate fallback for `person.*`: direct `latitude/longitude`, then `source` tracker, then matching `zone.*`.
6. `persons` list is normalized (`max` -> `person.max` if such entity exists); if explicit list is invalid/empty, card falls back to auto-detected `person.*`.
7. Photo layer from integration API with circular thumbnail markers and popup to open full-size photo.
8. If photo circles overlap, only the newest photo is shown.

## Files

1. `people-map-plus.js` - ready-to-use card module.
2. `hacs.json` - HACS metadata.

## Install (manual)

1. Copy `people-map-plus.js` to `/config/www/people-map-plus.js`.
2. Add resource in Home Assistant:
   - URL: `/local/people-map-plus.js`
   - Type: `JavaScript Module`
3. Add card to dashboard:

```yaml
type: custom:people-map-plus
title: People Map Plus
persons:
  - person.alex
  - person.maria
default_zoom: 12
fit_entities: true
panel_mode: true
panel_top_offset_px: 112
min_height: 500
show_tracks: true
track_days: 3
show_photos: true
photo_days: 5
```

## Config

1. `title` (string)
2. `default_zoom` (number)
3. `default_center` ([lat, lon])
4. `fit_entities` (bool, default `true`)
5. `persons` (array):
   - string: `person.alex`
   - object:

```yaml
persons:
  - entity: person.alex
    color: "#4caf50"
    label: name
    radius: 8
```

`label`: `name | entity_id | state`

Additional layout options:

1. `panel_mode` (bool, default `true`) - uses viewport height.
2. `panel_top_offset_px` (number, default `112`) - top UI offset for panel mode.
3. `min_height` (number, default `360`) - minimum map height in panel mode.
4. `height` (number, default `420`) - fixed height when `panel_mode: false`.
5. `show_status` (bool, default `false`) - show/hide status text under map.

Tracks options:

1. `show_tracks` (bool, default `true`) - render movement lines.
2. `tracks_api_endpoint` (string, default `people_map_plus/tracks`) - Home Assistant API endpoint path used via `hass.callApi`.
3. `track_days` (number, `1..30`, default `1`) - how many days back to load.
4. `track_entities` (array, optional) - explicit entities for tracks.
5. `tracks_max_points` (number, default `500`) - max points per entity.
6. `tracks_min_distance_m` (number, default `0`) - distance dedupe on backend request.
7. `tracks_refresh_seconds` (number, default `30`) - fetch throttle window.

Photos options:

1. `show_photos` (bool, default `true`) - render photo markers layer.
2. `photos_api_endpoint` (string, default `people_map_plus/photos`) - Home Assistant API endpoint path used via `hass.callApi`.
3. `photo_days` (number, `1..30`, default `5`) - how many days back to request photos.
4. `photo_limit` (number, default `200`) - max photos returned by API, `0` means unlimited.
5. `photos_refresh_seconds` (number, default `60`) - fetch throttle window for photos.
6. `photo_marker_size` (number, `24..96`, default `40`) - thumbnail marker size in px.

## Notes

1. Leaflet is loaded from CDN (`unpkg.com`) at runtime.
2. Tracks layer uses integration API endpoint `/api/people_map_plus/tracks` (called as `people_map_plus/tracks` from `hass.callApi`).
3. Photos layer uses integration API endpoint `/api/people_map_plus/photos` (called as `people_map_plus/photos` from `hass.callApi`).
4. This is a minimal starter card for further integration with People Map Plus backend API.
