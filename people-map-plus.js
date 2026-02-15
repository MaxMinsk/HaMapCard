const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS_ID = "people-map-plus-leaflet-css";
const LEAFLET_SCRIPT_ID = "people-map-plus-leaflet-js";

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
    this._markers = undefined;
    this._mapEl = undefined;
    this._titleEl = undefined;
    this._initialized = false;
    this._fitDone = false;
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
      ...config
    };

    this.renderTitle();
    this.refreshMarkers();
  }

  set hass(hass) {
    this._hass = hass;
    this.ensureInitialized();
    this.refreshMarkers();
  }

  connectedCallback() {
    this.ensureInitialized();
    this.renderTitle();
    this.refreshMarkers();
  }

  disconnectedCallback() {
    if (this._map) {
      this._map.remove();
      this._map = undefined;
      this._markers = undefined;
      this._fitDone = false;
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
        .people-map-plus-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
        }
        .people-map-plus-title {
          font-size: 1rem;
          font-weight: 600;
          line-height: 1.3;
          color: var(--primary-text-color);
        }
        .people-map-plus-map {
          width: 100%;
          height: 420px;
          border-radius: 10px;
          overflow: hidden;
          background: var(--secondary-background-color);
        }
        .people-map-plus-status {
          font-size: 0.85rem;
          color: var(--secondary-text-color);
        }
        @media (max-width: 800px) {
          .people-map-plus-map {
            height: 320px;
          }
        }
      </style>
      <ha-card>
        <div class="people-map-plus-card">
          <div class="people-map-plus-title"></div>
          <div class="people-map-plus-map"></div>
          <div class="people-map-plus-status"></div>
        </div>
      </ha-card>
    `;

    this._titleEl = this.querySelector(".people-map-plus-title");
    this._mapEl = this.querySelector(".people-map-plus-map");
    this._statusEl = this.querySelector(".people-map-plus-status");
    this._initialized = true;

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

      this._markers = L.layerGroup().addTo(this._map);
      this.setStatus("Map ready.");
      this.refreshMarkers();
    } catch (error) {
      console.error("[people-map-plus] Failed to initialize map", error);
      this.setStatus("Map failed to load Leaflet.");
    }
  }

  renderTitle() {
    if (!this._titleEl) {
      return;
    }

    const title = this._config?.title?.trim() || "People Map Plus";
    this._titleEl.textContent = title;
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

      const lat = toNumber(state.attributes.latitude);
      const lon = toNumber(state.attributes.longitude);
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

    if (points.length === 0) {
      this.setStatus("No person coordinates found.");
      return;
    }

    this.setStatus(`Markers: ${points.length}`);

    if (this._config.fit_entities && !this._fitDone) {
      this._map.fitBounds(window.L.latLngBounds(points), {
        padding: [24, 24],
        maxZoom: 15
      });
      this._fitDone = true;
    }
  }

  resolvePersons() {
    const explicit = (this._config.persons || []).map((item) => {
      if (typeof item === "string") {
        return { entity: item };
      }

      return item;
    });

    if (explicit.length > 0) {
      return explicit;
    }

    if (!this._hass) {
      return [];
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

  static getStubConfig() {
    return {
      type: "custom:people-map-plus",
      title: "People Map Plus",
      default_zoom: 12,
      fit_entities: true,
      persons: []
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

if (!customElements.get("people-map-plus")) {
  customElements.define("people-map-plus", PeopleMapPlusCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "people-map-plus",
  name: "People Map Plus",
  description: "Minimal map card for person entities"
});
