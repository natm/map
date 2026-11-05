# Llwynygorras site map

A web map of Llwynygorras, Castlemorris, Pembrokeshire, Wales: buildings,
chambers, the private water main, Openreach, private fibre, electric runs and
CCTV, so services above and below ground can be found on site with a phone.

**Live site:** https://natm.github.io/map/

- Plain [Leaflet](https://leafletjs.com) 1.9.4 (vendored in `vendor/leaflet/`), no build step.
- One GeoJSON file per layer in `data/` (RFC 7946, WGS84).
- Lines: solid = surveyed on the ground; dashed = assumed or traced from imagery.
  Positions are approximate; each feature's popup gives its method and accuracy.

This repo is **published output only**. The source (data, page, validation)
lives in a private repo and is copied here by a script; changes made directly
here will be overwritten.

## Licences and attribution

- **Map data** (`data/*.geojson`): © Nat Morris, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See `LICENSE`.
- **Leaflet**: © 2010-2023 Volodymyr Agafonkin, © 2010-2011 CloudMade,
  BSD 2-Clause licence (`vendor/leaflet/LICENSE`).
- **Map tiles** (loaded by your browser, not stored here):
  - © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
    used under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
  - Aerial imagery: Tiles © Esri. Source: Esri, Vantor/Maxar, Earthstar
    Geographics, and the GIS User Community.
