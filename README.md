# HaMapCard

Minimal Home Assistant Lovelace card with map.

Card type: `custom:people-map-plus`

## Features (minimal)

1. OpenStreetMap base layer (Leaflet).
2. Markers for configured `person.*` entities.
3. If `persons` is empty, auto-picks up to 5 `person.*` entities.

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

## Notes

1. Leaflet is loaded from CDN (`unpkg.com`) at runtime.
2. This is a minimal starter card for further integration with People Map Plus backend API.
