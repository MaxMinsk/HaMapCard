const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS_ID = "people-map-plus-leaflet-css";
const LEAFLET_SCRIPT_ID = "people-map-plus-leaflet-js";
const DEFAULT_TRACKS_API_ENDPOINT = "people_map_plus/tracks";
const DEFAULT_PHOTOS_API_ENDPOINT = "people_map_plus/photos";

let leafletPromise;

function ensureLeafletLoaded() {
  if (window.L) {
    return Promise.resolve(window.L);
  }

  if (leafletPromise) {
    return leafletPromise;
  }

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.getElementById(LEAFLET_CSS_ID)) {
      const css = document.createElement("link");
      css.id = LEAFLET_CSS_ID;
      css.rel = "stylesheet";
      css.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
      document.head.appendChild(css);
    }

    const existingScript = document.getElementById(LEAFLET_SCRIPT_ID);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.L));
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Leaflet script.")));
      return;
    }

    const script = document.createElement("script");
    script.id = LEAFLET_SCRIPT_ID;
    script.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Failed to load Leaflet script."));
    document.head.appendChild(script);
  });

  return leafletPromise;
}

class PeopleMapPlusCard extends HTMLElement {
  constructor() {
    super();
    this._config = undefined;
    this._hass = undefined;
    this._map = undefined;
    this._photos = undefined;
    this._tracks = undefined;
    this._markers = undefined;
    this._mapEl = undefined;
    this._statusEl = undefined;
    this._photoViewerEl = undefined;
    this._photoViewerImgEl = undefined;
    this._photoViewerMetaEl = undefined;
    this._initialized = false;
    this._fitDone = false;
    this._lastTracksFetchKey = "";
    this._lastTracksFetchAt = 0;
    this._lastPhotosFetchKey = "";
    this._lastPhotosFetchAt = 0;
    this._photoItemsCache = [];
    this._photoViewerState = {
      step: 0,
      itemKey: ""
    };
    this._resizeHandler = () => {
      this.updateMapHeight();
      this.invalidateMapSize();
    };
  }

  setConfig(config) {
    if (!config || config.type !== "custom:people-map-plus") {
      throw new Error("Card type must be custom:people-map-plus");
    }

    this._config = {
      default_zoom: 12,
      default_center: [53.9, 27.5667],
      fit_entities: true,
      persons: [],
      panel_mode: true,
      panel_top_offset_px: 112,
      min_height: 360,
      height: 420,
      show_status: false,
      show_tracks: true,
      tracks_api_endpoint: DEFAULT_TRACKS_API_ENDPOINT,
      track_days: 1,
      tracks_max_points: 500,
      tracks_min_distance_m: 0,
      tracks_refresh_seconds: 30,
      show_photos: true,
      photos_api_endpoint: DEFAULT_PHOTOS_API_ENDPOINT,
      photo_days: 5,
      photo_limit: 200,
      photos_refresh_seconds: 60,
      photo_marker_size: 40,
      ...config
    };

    this._fitDone = false;
    this.updateMapHeight();
    this.applyStatusVisibility();
    this.refreshMarkers();
  }

  set hass(hass) {
    this._hass = hass;
    this.ensureInitialized();
    this.refreshMarkers();
  }

  connectedCallback() {
    this.ensureInitialized();
    window.addEventListener("resize", this._resizeHandler);
    this.updateMapHeight();
    this.refreshMarkers();
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this._resizeHandler);
    this.closePhotoViewer();
    if (this._map) {
      this._map.remove();
      this._map = undefined;
      this._photos = undefined;
      this._tracks = undefined;
      this._markers = undefined;
      this._fitDone = false;
      this._photoItemsCache = [];
    }
  }

  getCardSize() {
    return 6;
  }

  ensureInitialized() {
    if (this._initialized) {
      return;
    }

    this.innerHTML = `
      <style>
        ha-card {
          height: 100%;
          overflow: hidden;
        }
        .people-map-plus-card {
          display: flex;
          flex-direction: column;
          padding: 0;
          height: 100%;
          position: relative;
        }
        .people-map-plus-map {
          width: 100%;
          height: 420px;
          min-height: 200px;
          border-radius: var(--ha-card-border-radius, 12px);
          overflow: hidden;
          background: var(--secondary-background-color);
        }
        .people-map-plus-status {
          padding: 8px 12px;
          font-size: 0.85rem;
          color: var(--secondary-text-color);
          background: var(--ha-card-background, var(--card-background-color));
        }
        .people-map-plus-map .leaflet-container {
          position: relative;
          overflow: hidden;
          width: 100%;
          height: 100%;
          background: #ddd;
          outline: 0;
          -webkit-tap-highlight-color: transparent;
        }
        .people-map-plus-map .leaflet-pane,
        .people-map-plus-map .leaflet-tile,
        .people-map-plus-map .leaflet-marker-icon,
        .people-map-plus-map .leaflet-marker-shadow,
        .people-map-plus-map .leaflet-tile-container,
        .people-map-plus-map .leaflet-pane > svg,
        .people-map-plus-map .leaflet-pane > canvas {
          position: absolute;
          left: 0;
          top: 0;
        }
        .people-map-plus-map .leaflet-zoom-box,
        .people-map-plus-map .leaflet-image-layer,
        .people-map-plus-map .leaflet-layer {
          position: absolute;
          left: 0;
          top: 0;
        }
        .people-map-plus-map .leaflet-zoom-animated {
          transform-origin: 0 0;
          -webkit-transform-origin: 0 0;
          -ms-transform-origin: 0 0;
        }
        .people-map-plus-map svg.leaflet-zoom-animated {
          will-change: transform;
        }
        .people-map-plus-map .leaflet-zoom-anim .leaflet-zoom-animated {
          transition: transform 0.25s cubic-bezier(0, 0, 0.25, 1);
        }
        .people-map-plus-map .leaflet-zoom-anim .leaflet-zoom-hide {
          visibility: hidden;
        }
        .people-map-plus-map .leaflet-pane {
          z-index: 400;
        }
        .people-map-plus-map .leaflet-tile-pane {
          z-index: 200;
        }
        .people-map-plus-map .leaflet-overlay-pane {
          z-index: 400;
        }
        .people-map-plus-map .leaflet-shadow-pane {
          z-index: 500;
        }
        .people-map-plus-map .leaflet-marker-pane {
          z-index: 600;
        }
        .people-map-plus-map .leaflet-tooltip-pane {
          z-index: 650;
        }
        .people-map-plus-map .leaflet-popup-pane {
          z-index: 700;
        }
        .people-map-plus-map .leaflet-map-pane canvas {
          z-index: 100;
        }
        .people-map-plus-map .leaflet-map-pane svg {
          z-index: 200;
        }
        .people-map-plus-map .leaflet-tile,
        .people-map-plus-map .leaflet-marker-icon,
        .people-map-plus-map .leaflet-marker-shadow {
          user-select: none;
          -webkit-user-drag: none;
        }
        .people-map-plus-map .leaflet-tile {
          visibility: hidden;
          filter: inherit;
        }
        .people-map-plus-map .leaflet-tile-loaded {
          visibility: inherit;
        }
        .people-map-plus-map .leaflet-zoom-box {
          width: 0;
          height: 0;
          box-sizing: border-box;
          z-index: 800;
        }
        .people-map-plus-map .leaflet-control {
          position: relative;
          z-index: 800;
          pointer-events: auto;
          float: left;
          clear: both;
        }
        .people-map-plus-map .leaflet-top,
        .people-map-plus-map .leaflet-bottom {
          position: absolute;
          z-index: 1000;
          pointer-events: none;
        }
        .people-map-plus-map .leaflet-top {
          top: 0;
        }
        .people-map-plus-map .leaflet-right {
          right: 0;
        }
        .people-map-plus-map .leaflet-right .leaflet-control {
          float: right;
        }
        .people-map-plus-map .leaflet-bottom {
          bottom: 0;
        }
        .people-map-plus-map .leaflet-left {
          left: 0;
        }
        .people-map-plus-map .leaflet-top .leaflet-control {
          margin-top: 10px;
        }
        .people-map-plus-map .leaflet-right .leaflet-control {
          margin-right: 10px;
        }
        .people-map-plus-map .leaflet-bottom .leaflet-control {
          margin-bottom: 10px;
        }
        .people-map-plus-map .leaflet-left .leaflet-control {
          margin-left: 10px;
        }
        .people-map-plus-map .leaflet-control-zoom {
          border: 2px solid rgba(0, 0, 0, 0.2);
          border-radius: 4px;
          background-clip: padding-box;
          box-shadow: 0 1px 5px rgba(0, 0, 0, 0.65);
        }
        .people-map-plus-map .leaflet-control-zoom a {
          width: 26px;
          height: 26px;
          line-height: 26px;
          display: block;
          text-align: center;
          text-decoration: none;
          background: #fff;
          color: #000;
          font-weight: 700;
          font-size: 18px;
        }
        .people-map-plus-map .leaflet-control-attribution {
          background: rgba(255, 255, 255, 0.8);
          margin: 0;
          padding: 0 5px;
          color: #333;
          font-size: 11px;
        }
        .people-map-plus-map .leaflet-container img,
        .people-map-plus-map .leaflet-container img.leaflet-tile {
          max-width: none !important;
          max-height: none !important;
        }
        .people-map-plus-photo-marker {
          border: 2px solid rgba(255, 255, 255, 0.95);
          border-radius: 50%;
          background-size: cover;
          background-position: center;
          box-shadow: 0 2px 7px rgba(0, 0, 0, 0.5);
        }
        .people-map-plus-photo-viewer {
          position: absolute;
          inset: 0;
          background: rgba(5, 10, 16, 0.88);
          z-index: 1100;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 16px;
          cursor: zoom-in;
        }
        .people-map-plus-photo-viewer.active {
          display: flex;
        }
        .people-map-plus-photo-viewer.full {
          cursor: zoom-out;
        }
        .people-map-plus-photo-viewer-content {
          width: min(96%, 1100px);
          max-height: 96%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .people-map-plus-photo-viewer img {
          width: auto;
          max-width: 100%;
          max-height: calc(100vh - 220px);
          border-radius: 10px;
          box-shadow: 0 6px 30px rgba(0, 0, 0, 0.5);
          object-fit: contain;
        }
        .people-map-plus-photo-viewer-meta {
          color: #f1f1f1;
          font-size: 0.9rem;
          text-align: center;
        }
        @media (max-width: 800px) {
          .people-map-plus-map {
            height: 320px;
          }
          .people-map-plus-photo-viewer img {
            max-height: calc(100vh - 180px);
          }
        }
      </style>
      <ha-card>
        <div class="people-map-plus-card">
          <div class="people-map-plus-map"></div>
          <div class="people-map-plus-photo-viewer">
            <div class="people-map-plus-photo-viewer-content">
              <img src="" alt="photo-view"/>
              <div class="people-map-plus-photo-viewer-meta"></div>
            </div>
          </div>
          <div class="people-map-plus-status"></div>
        </div>
      </ha-card>
    `;

    this._mapEl = this.querySelector(".people-map-plus-map");
    this._statusEl = this.querySelector(".people-map-plus-status");
    this._photoViewerEl = this.querySelector(".people-map-plus-photo-viewer");
    this._photoViewerImgEl = this.querySelector(".people-map-plus-photo-viewer img");
    this._photoViewerMetaEl = this.querySelector(".people-map-plus-photo-viewer-meta");
    if (this._photoViewerEl) {
      this._photoViewerEl.addEventListener("click", () => this.onPhotoViewerClick());
    }
    this._initialized = true;
    this.applyStatusVisibility();
    this.updateMapHeight();

    this.initMap();
  }

  async initMap() {
    if (this._map || !this._mapEl) {
      return;
    }

    try {
      const L = await ensureLeafletLoaded();
      const center = this._config?.default_center || [53.9, 27.5667];
      const zoom = this._config?.default_zoom || 12;

      this._map = L.map(this._mapEl, {
        zoomControl: true,
        attributionControl: true
      }).setView(center, zoom);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(this._map);

      this._photos = L.layerGroup().addTo(this._map);
      this._tracks = L.layerGroup().addTo(this._map);
      this._markers = L.layerGroup().addTo(this._map);
      this._map.on("zoomend moveend", () => {
        if (this._config?.show_photos && this._photoItemsCache.length > 0) {
          this.renderPhotos(this._photoItemsCache);
        }
      });
      this.updateMapHeight();
      this.invalidateMapSize();
      this.setStatus("Map ready");
      this.refreshMarkers();
    } catch (error) {
      console.error("[people-map-plus] Failed to initialize map", error);
      this.setStatus("Map failed to load Leaflet.");
    }
  }

  refreshMarkers() {
    if (!this._map || !this._markers || !this._hass || !this._config || !window.L) {
      return;
    }

    this._markers.clearLayers();
    const persons = this.resolvePersons();
    const points = [];

    for (const person of persons) {
      const state = this._hass.states[person.entity];
      if (!state) {
        continue;
      }

      const coords = resolveEntityCoordinates(this._hass, state);
      const lat = coords?.lat ?? null;
      const lon = coords?.lon ?? null;
      if (lat === null || lon === null) {
        continue;
      }

      const labelMode = person.label || "name";
      const label =
        labelMode === "entity_id"
          ? state.entity_id
          : labelMode === "state"
            ? state.state
            : (state.attributes.friendly_name || state.entity_id);

      const color = person.color || "#1e88e5";
      const radius = person.radius || 7;
      points.push([lat, lon]);

      window.L.circleMarker([lat, lon], {
        radius,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.6
      })
        .bindPopup(`${label}<br/>${lat.toFixed(5)}, ${lon.toFixed(5)}`)
        .addTo(this._markers);
    }

    this.refreshTracks(persons);
    this.refreshPhotos();

    if (points.length === 0) {
      this.setStatus("No person coordinates found.");
      this.invalidateMapSize();
      return;
    }

    this.setStatus(`Markers: ${points.length}`);
    this.invalidateMapSize();

    if (this._config.fit_entities && !this._fitDone) {
      this._map.fitBounds(window.L.latLngBounds(points), {
        padding: [24, 24],
        maxZoom: 15
      });
      this._fitDone = true;
    }
  }

  async refreshTracks(persons) {
    if (!this._map || !this._tracks || !this._config) {
      return;
    }

    if (!this._config.show_tracks) {
      this._tracks.clearLayers();
      return;
    }

    const entities = this.resolveTrackEntities(persons);
    if (entities.length === 0) {
      this._tracks.clearLayers();
      return;
    }

    const days = clampInt(this._config.track_days, 1, 30, 1);
    const maxPoints = clampInt(this._config.tracks_max_points, 50, 5000, 500);
    const minDistance = clampInt(this._config.tracks_min_distance_m, 0, 2000, 0);
    const refreshSeconds = clampInt(this._config.tracks_refresh_seconds, 5, 300, 30);
    const endpoint = String(this._config.tracks_api_endpoint || DEFAULT_TRACKS_API_ENDPOINT).trim().replace(/^\/+/, "");
    if (!endpoint || !this._hass || typeof this._hass.callApi !== "function") {
      return;
    }

    const now = Date.now();
    const fetchKey = `${endpoint}|${entities.join(",")}|${days}|${maxPoints}|${minDistance}`;
    if (fetchKey === this._lastTracksFetchKey && now - this._lastTracksFetchAt < refreshSeconds * 1000) {
      return;
    }
    this._lastTracksFetchKey = fetchKey;
    this._lastTracksFetchAt = now;

    try {
      const query = new URLSearchParams({
        entities: entities.join(","),
        days: String(days),
        maxPoints: String(maxPoints),
        minDistanceMeters: String(minDistance)
      });

      const parsed = await this._hass.callApi("GET", `${endpoint}?${query.toString()}`);
      if (!parsed || parsed.success === false) {
        return;
      }

      const tracks = Array.isArray(parsed?.tracks) ? parsed.tracks : [];
      this.renderTracks(tracks, persons);
    } catch (error) {
      console.warn("[people-map-plus] Tracks fetch failed", error);
    }
  }

  async refreshPhotos() {
    if (!this._map || !this._photos || !this._config) {
      return;
    }

    if (!this._config.show_photos) {
      this._photos.clearLayers();
      this._photoItemsCache = [];
      this.closePhotoViewer();
      return;
    }

    const endpoint = String(this._config.photos_api_endpoint || DEFAULT_PHOTOS_API_ENDPOINT).trim().replace(/^\/+/, "");
    if (!endpoint || !this._hass || typeof this._hass.callApi !== "function") {
      return;
    }

    const days = clampInt(this._config.photo_days, 1, 365, 5);
    const limit = parsePhotoLimit(this._config.photo_limit, 200);
    const refreshSeconds = clampInt(this._config.photos_refresh_seconds, 5, 600, 60);
    const fetchKey = `${endpoint}|${days}|${limit}`;
    const now = Date.now();
    if (fetchKey === this._lastPhotosFetchKey && now - this._lastPhotosFetchAt < refreshSeconds * 1000) {
      return;
    }
    this._lastPhotosFetchKey = fetchKey;
    this._lastPhotosFetchAt = now;

    try {
      const query = new URLSearchParams({
        days: String(days),
        withGps: "true"
      });
      query.set("limit", String(limit));
      const parsed = await this._hass.callApi("GET", `${endpoint}?${query.toString()}`);
      if (!parsed || parsed.success === false) {
        return;
      }

      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      this._photoItemsCache = items;
      this.renderPhotos(items);
    } catch (error) {
      console.warn("[people-map-plus] Photos fetch failed", error);
    }
  }

  renderPhotos(items) {
    if (!this._photos || !this._map || !window.L || !Array.isArray(items)) {
      return;
    }

    this._photos.clearLayers();
    const markerSize = clampInt(this._config?.photo_marker_size, 24, 96, 40);
    const markerRadiusPx = markerSize / 2;
    const candidates = [];
    for (const item of items) {
      const lat = toNumber(item?.lat);
      const lon = toNumber(item?.lon);
      if (lat === null || lon === null) {
        continue;
      }

      const previewUrl = normalizeMediaUrl(item?.previewUrl || item?.thumbUrl || item?.mediaUrl);
      const mediaUrl = normalizeMediaUrl(item?.mediaUrl || previewUrl);
      if (!previewUrl || !mediaUrl) {
        continue;
      }

      candidates.push({
        lat,
        lon,
        previewUrl,
        mediaUrl,
        capturedMs: parseIsoTimestampToMs(item?.capturedAtUtc) ?? 0,
        capturedText: formatCapturedAt(item?.capturedAtUtc),
        itemKey: String(item?.mediaRelPath || mediaUrl)
      });
    }

    const selected = selectVisiblePhotosByOverlap(this._map, candidates, markerRadiusPx);
    const iconSize = [markerSize, markerSize];
    const iconAnchor = [Math.round(markerSize / 2), Math.round(markerSize / 2)];
    for (const item of selected) {
      const markerHtml = `<div class="people-map-plus-photo-marker" style="width:${markerSize}px;height:${markerSize}px;background-image:url('${escapeHtmlAttr(item.previewUrl)}');"></div>`;
      const icon = window.L.divIcon({
        className: "",
        html: markerHtml,
        iconSize,
        iconAnchor
      });

      const marker = window.L.marker([item.lat, item.lon], { icon }).addTo(this._photos);
      marker.on("click", () => this.onPhotoMarkerClick(item));
    }
  }

  onPhotoMarkerClick(item) {
    if (!item || !item.itemKey) {
      return;
    }

    if (this._photoViewerState.itemKey !== item.itemKey || this._photoViewerState.step === 0) {
      this._photoViewerState = { step: 1, itemKey: item.itemKey };
      this.renderPhotoViewer(item);
      return;
    }

    if (this._photoViewerState.step === 1) {
      this._photoViewerState = { step: 2, itemKey: item.itemKey };
      this.renderPhotoViewer(item);
      return;
    }

    this.closePhotoViewer();
  }

  onPhotoViewerClick() {
    if (!this._photoViewerState.itemKey || this._photoViewerState.step === 0) {
      return;
    }

    const item = this.findPhotoItemByKey(this._photoViewerState.itemKey);
    if (!item) {
      this.closePhotoViewer();
      return;
    }

    if (this._photoViewerState.step === 1) {
      this._photoViewerState = { step: 2, itemKey: item.itemKey };
      this.renderPhotoViewer(item);
      return;
    }

    this.closePhotoViewer();
  }

  findPhotoItemByKey(itemKey) {
    if (!itemKey || !Array.isArray(this._photoItemsCache)) {
      return null;
    }

    for (const rawItem of this._photoItemsCache) {
      const previewUrl = normalizeMediaUrl(rawItem?.previewUrl || rawItem?.thumbUrl || rawItem?.mediaUrl);
      const mediaUrl = normalizeMediaUrl(rawItem?.mediaUrl || previewUrl);
      const currentKey = String(rawItem?.mediaRelPath || mediaUrl);
      if (currentKey !== itemKey) {
        continue;
      }

      return {
        previewUrl,
        mediaUrl,
        capturedText: formatCapturedAt(rawItem?.capturedAtUtc),
        itemKey: currentKey
      };
    }

    return null;
  }

  renderPhotoViewer(item) {
    if (!this._photoViewerEl || !this._photoViewerImgEl || !this._photoViewerMetaEl) {
      return;
    }

    const step = this._photoViewerState.step;
    if (step !== 1 && step !== 2) {
      this.closePhotoViewer();
      return;
    }

    const imageUrl = step === 1 ? item.previewUrl : item.mediaUrl;
    this._photoViewerImgEl.src = imageUrl;
    this._photoViewerMetaEl.textContent = step === 1
      ? `${item.capturedText} • thumbnail`
      : `${item.capturedText} • full`;
    this._photoViewerEl.classList.add("active");
    this._photoViewerEl.classList.toggle("full", step === 2);
  }

  closePhotoViewer() {
    this._photoViewerState = { step: 0, itemKey: "" };
    if (!this._photoViewerEl || !this._photoViewerImgEl || !this._photoViewerMetaEl) {
      return;
    }

    this._photoViewerEl.classList.remove("active", "full");
    this._photoViewerImgEl.src = "";
    this._photoViewerMetaEl.textContent = "";
  }

  renderTracks(tracks, persons) {
    if (!this._tracks || !window.L) {
      return;
    }

    this._tracks.clearLayers();
    const dayWindow = clampInt(this._config?.track_days, 1, 30, 1);
    const nowMs = Date.now();
    const colorByEntity = new Map();
    for (const person of persons) {
      colorByEntity.set(person.entity, person.color || "#00b0ff");
    }

    for (const track of tracks) {
      const entityId = typeof track?.entityId === "string" ? track.entityId : "";
      const points = Array.isArray(track?.points) ? track.points : [];
      const normalizedPoints = points
        .map((point) => {
          const lat = toNumber(point?.lat);
          const lon = toNumber(point?.lon);
          const tsMs = parseIsoTimestampToMs(point?.ts);
          return lat === null || lon === null ? null : { lat, lon, tsMs };
        })
        .filter(Boolean);

      if (normalizedPoints.length < 2) {
        continue;
      }

      const color = colorByEntity.get(entityId) || "#00b0ff";
      for (let index = 1; index < normalizedPoints.length; index += 1) {
        const previous = normalizedPoints[index - 1];
        const current = normalizedPoints[index];
        const dayIndex = resolveSegmentDayIndex(previous.tsMs, current.tsMs, nowMs, dayWindow);
        const opacity = opacityForTrackDay(dayIndex, dayWindow);

        window.L.polyline([
          [previous.lat, previous.lon],
          [current.lat, current.lon]
        ], {
          color,
          weight: 3,
          opacity
        }).addTo(this._tracks);
      }

      const start = [normalizedPoints[0].lat, normalizedPoints[0].lon];
      const endPoint = normalizedPoints[normalizedPoints.length - 1];
      const end = [endPoint.lat, endPoint.lon];
      window.L.circleMarker(start, {
        radius: 4,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.7
      }).bindTooltip(`${entityId} start`).addTo(this._tracks);
      window.L.circleMarker(end, {
        radius: 4,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 1
      }).bindTooltip(`${entityId} end`).addTo(this._tracks);
    }
  }

  resolveTrackEntities(persons) {
    const explicit = Array.isArray(this._config?.track_entities) ? this._config.track_entities : [];
    if (explicit.length > 0 && this._hass) {
      const normalized = explicit
        .map((entity) => normalizePersonEntityId(this._hass, entity))
        .filter(Boolean);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    return persons
      .map((person) => person.entity)
      .filter(Boolean);
  }

  resolvePersons() {
    const explicit = (this._config.persons || []).map((item) => {
      if (typeof item === "string") {
        return { entity: item };
      }

      return item;
    });

    if (!this._hass) {
      return explicit;
    }

    const explicitResolved = explicit
      .map((item) => ({
        ...item,
        entity: normalizePersonEntityId(this._hass, item.entity)
      }))
      .filter((item) => Boolean(item.entity));

    if (explicitResolved.length > 0) {
      return explicitResolved;
    }

    return Object.keys(this._hass.states)
      .filter((entityId) => entityId.startsWith("person."))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 5)
      .map((entity) => ({ entity }));
  }

  setStatus(message) {
    if (this._statusEl) {
      this._statusEl.textContent = message;
    }
  }

  applyStatusVisibility() {
    if (!this._statusEl) {
      return;
    }

    const showStatus = Boolean(this._config?.show_status);
    this._statusEl.style.display = showStatus ? "block" : "none";
  }

  updateMapHeight() {
    if (!this._mapEl || !this._config) {
      return;
    }

    const minHeight = clampInt(this._config.min_height, 200, 2000, 360);
    const panelTopOffset = clampInt(this._config.panel_top_offset_px, 0, 500, 112);
    const fixedHeight = clampInt(this._config.height, 200, 2000, 420);
    const targetHeight = this._config.panel_mode
      ? Math.max(minHeight, window.innerHeight - panelTopOffset)
      : fixedHeight;

    this._mapEl.style.height = `${targetHeight}px`;
  }

  invalidateMapSize() {
    if (!this._map) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (this._map) {
        this._map.invalidateSize(false);
      }
    });
  }

  static getStubConfig() {
    return {
      type: "custom:people-map-plus",
      title: "People Map Plus",
      default_zoom: 12,
      fit_entities: true,
      persons: [],
      panel_mode: true,
      show_tracks: true,
      tracks_api_endpoint: DEFAULT_TRACKS_API_ENDPOINT,
      track_days: 1,
      show_photos: true,
      photos_api_endpoint: DEFAULT_PHOTOS_API_ENDPOINT,
      photo_days: 5
    };
  }
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function resolveEntityCoordinates(hass, state) {
  const direct = readCoordsFromAttributes(state?.attributes);
  if (direct) {
    return direct;
  }

  if (!state || !state.entity_id || !state.entity_id.startsWith("person.")) {
    return null;
  }

  const sourceEntityId =
    (typeof state.attributes?.source === "string" && state.attributes.source) ||
    (typeof state.attributes?.entity_id === "string" && state.attributes.entity_id);

  if (sourceEntityId && hass.states[sourceEntityId]) {
    const fromSource = readCoordsFromAttributes(hass.states[sourceEntityId].attributes);
    if (fromSource) {
      return fromSource;
    }
  }

  const fromZone = resolveZoneCoordinates(hass, state);
  if (fromZone) {
    return fromZone;
  }

  return null;
}

function normalizePersonEntityId(hass, rawEntityId) {
  if (typeof rawEntityId !== "string") {
    return "";
  }

  const trimmed = rawEntityId.trim();
  if (!trimmed) {
    return "";
  }

  if (hass.states[trimmed]) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (hass.states[lower]) {
    return lower;
  }

  if (!trimmed.includes(".")) {
    const prefixed = `person.${lower}`;
    if (hass.states[prefixed]) {
      return prefixed;
    }
  }

  return "";
}

function readCoordsFromAttributes(attributes) {
  if (!attributes) {
    return null;
  }

  const lat = toNumber(attributes.latitude);
  const lon = toNumber(attributes.longitude);
  if (lat === null || lon === null) {
    return null;
  }

  return { lat, lon };
}

function resolveZoneCoordinates(hass, state) {
  const zoneHints = [];
  if (typeof state.state === "string" && state.state) {
    zoneHints.push(state.state);
  }
  if (typeof state.attributes?.zone === "string" && state.attributes.zone) {
    zoneHints.push(state.attributes.zone);
  }

  for (const hint of zoneHints) {
    const normalized = normalizeZoneName(hint);
    if (!normalized) {
      continue;
    }

    const zones = Object.values(hass.states).filter((entity) => entity.entity_id.startsWith("zone."));
    for (const zoneEntity of zones) {
      const zoneId = zoneEntity.entity_id.startsWith("zone.") ? zoneEntity.entity_id.slice(5) : zoneEntity.entity_id;
      const candidates = [
        zoneId,
        typeof zoneEntity.attributes?.friendly_name === "string" ? zoneEntity.attributes.friendly_name : "",
        typeof zoneEntity.attributes?.name === "string" ? zoneEntity.attributes.name : ""
      ];
      const match = candidates.some((name) => normalizeZoneName(name) === normalized);
      if (!match) {
        continue;
      }

      const coords = readCoordsFromAttributes(zoneEntity.attributes);
      if (coords) {
        return coords;
      }
    }
  }

  return null;
}

function normalizeZoneName(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase().replace(/^zone\./, "");
  return normalized
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_")
    .replace(/_+/g, "_")
    .replace(/[^a-z0-9_\u0400-\u04ff]/g, "");
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  if (rounded < min) {
    return min;
  }

  if (rounded > max) {
    return max;
  }

  return rounded;
}

function parseIsoTimestampToMs(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveSegmentDayIndex(tsMsA, tsMsB, nowMs, dayWindow) {
  const indexA = resolvePointDayIndex(tsMsA, nowMs, dayWindow);
  const indexB = resolvePointDayIndex(tsMsB, nowMs, dayWindow);
  return Math.max(indexA, indexB);
}

function resolvePointDayIndex(tsMs, nowMs, dayWindow) {
  if (!Number.isFinite(tsMs)) {
    return 0;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const deltaMs = Math.max(0, nowMs - tsMs);
  const rawIndex = Math.floor(deltaMs / dayMs);
  return clampInt(rawIndex, 0, Math.max(0, dayWindow - 1), 0);
}

function opacityForTrackDay(dayIndex, dayWindow) {
  if (dayWindow <= 1) {
    return 1;
  }

  const normalized = clampNumber(dayIndex / (dayWindow - 1), 0, 1, 0);
  const opacity = 1 - (normalized * 0.9);
  return Number(opacity.toFixed(3));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed < min) {
    return min;
  }

  if (parsed > max) {
    return max;
  }

  return parsed;
}

function normalizeMediaUrl(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }

  return "";
}

function parsePhotoLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  if (rounded <= 0) {
    return 0;
  }

  return Math.min(rounded, 200000);
}

function selectVisiblePhotosByOverlap(map, candidates, markerRadiusPx) {
  const selected = [];
  const sorted = [...candidates].sort((a, b) => b.capturedMs - a.capturedMs);
  for (const candidate of sorted) {
    const point = map.latLngToLayerPoint([candidate.lat, candidate.lon]);
    const overlaps = selected.some((existing) => {
      const dx = point.x - existing.point.x;
      const dy = point.y - existing.point.y;
      const distance = Math.sqrt((dx * dx) + (dy * dy));
      return distance <= (markerRadiusPx + existing.radiusPx);
    });
    if (overlaps) {
      continue;
    }

    selected.push({
      ...candidate,
      point,
      radiusPx: markerRadiusPx
    });
  }

  return selected;
}

function formatCapturedAt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "Photo";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Photo";
  }

  return new Date(timestamp).toLocaleString();
}

function escapeHtml(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

if (!customElements.get("people-map-plus")) {
  customElements.define("people-map-plus", PeopleMapPlusCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "people-map-plus",
  name: "People Map Plus",
  description: "Minimal map card for person entities"
});
