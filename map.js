/* Llwynygorras site map. Plain Leaflet 1.9.4, no build step.
 * Source lives in the private repo natm/llwyngorras-home (map/site/);
 * published to github.com/natm/map by scripts/publish-map.sh. */
(function () {
  'use strict';

  var UPDATED = '2026-11-06';
  var CENTRE = [51.938686, -5.067480];
  var DOC_BASE = 'https://github.com/natm/llwyngorras-home/blob/main/';

  var map = L.map('map', { center: CENTRE, zoom: 19, maxZoom: 24, zoomControl: true });
  // Remember where the map was (centre and zoom) in this browser, so a reload comes back to the same view.
  // A #feature= / #splice= / #trace= link still moves the map to what it points at.
  try {
    var savedView = JSON.parse(localStorage.getItem('map-view') || 'null');
    if (savedView && isFinite(savedView.lat) && isFinite(savedView.lng) && isFinite(savedView.z)) map.setView([savedView.lat, savedView.lng], savedView.z);
  } catch (e) {}
  map.on('moveend', function () {
    var c = map.getCenter();
    try { localStorage.setItem('map-view', JSON.stringify({ lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), z: map.getZoom() })); } catch (e) {}
  });

  // ---- Base layers ----
  var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 24,
    maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });
  var aerial = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 24,
    maxNativeZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Vantor/Maxar, Earthstar Geographics, and the GIS User Community'
  });
  // Ordnance Survey maps, served by Pembrokeshire County Council's mapping service (WMTS, web Mercator).
  // Used with attribution while we ask PCC whether that's OK (Nat, 2026-11-06); see map/README.md.
  function pccOs(layer) {
    return L.tileLayer('https://osmaps.pembrokeshire.gov.uk/maps/osmaps/wms/?pcc=true&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' + layer +
      '&STYLE=default&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', {
      minZoom: 7, maxZoom: 24, maxNativeZoom: 20,
      attribution: 'Contains OS data &copy; Crown copyright and database rights ' + new Date().getFullYear() + ' Ordnance Survey, via <a href="https://osmaps.pembrokeshire.gov.uk/" target="_blank" rel="noopener">Pembrokeshire County Council</a>'
    });
  }
  var BASES = [
    ['aerial', '🛰️ Aerial (Esri)', aerial],
    ['os-road', '🗺️ OS Road (via Pembrokeshire CC)', pccOs('Road_3857')],
    ['os-outdoor', '🥾 OS Outdoor (via Pembrokeshire CC)', pccOs('Outdoor_3857')],
    ['os-light', '🗺️ OS Light (via Pembrokeshire CC)', pccOs('Light_3857')],
    ['osm', '🗺️ OpenStreetMap', osm]
  ];
  function setBase(key) {
    BASES.forEach(function (b) { if (b[0] !== key && map.hasLayer(b[2])) map.removeLayer(b[2]); });
    var b = BASES.filter(function (x) { return x[0] === key; })[0] || BASES[0];
    if (!map.hasLayer(b[2])) b[2].addTo(map);
    try { localStorage.setItem('map-base', b[0]); } catch (e) {}
  }
  var savedBase = null;
  try { savedBase = localStorage.getItem('map-base'); } catch (e) {}
  setBase(savedBase || 'aerial');

  // ---- Styles ----
  var COLOURS = {
    buildings: '#555555',
    chambers: '#333333',
    water: '#1f78d1',
    openreach: '#8b5a2b',
    fibre: '#f39c12',
    electric: '#d62728',
    cctv: '#8e44ad'
  };

  // Fibre end markers: letter per enclosure.
  var ENCLOSURE = { patch_panel: 'P', splice_closure: 'S', wall_box: 'W', cabinet: 'C', pedestal: 'B', ont: 'O', other: '?' };

  // How accurately a line or point is known, from its 'method':
  //   surveyed: GPS or measured on the ground       -> solid, layer colour
  //   approx:   traced from the aerial or described -> dashed, layer colour
  //   assumed:  a guess, e.g. a straight line        -> dotted magenta
  var ASSUMED = '#e040fb';
  function tier(p) {
    var m = (p.method || '').toLowerCase();
    if (m === 'gps-phone' || m === 'gps-rtk' || m === 'measured' || m === 'confirmed') return 'surveyed';
    if (m === 'aerial-trace' || m === 'description') return 'approx';
    return 'assumed';
  }
  function isAssumed(p) { return tier(p) !== 'surveyed'; }

  // A clear badge saying how accurate a feature's position or route is.
  function accuracyBadge(p, isLine) {
    var t = tier(p), what = isLine ? 'Route' : 'Position';
    var acc = p.accuracy_m ? ' (about ±' + p.accuracy_m + ' m)' : '';
    var how = { 'gps-phone': 'phone GPS', 'gps-rtk': 'RTK GPS', 'measured': 'measured', 'confirmed': 'confirmed on site', 'aerial-trace': 'traced from the aerial photo', 'description': 'from a description' }[(p.method || '').toLowerCase()] || '';
    if (t === 'surveyed') return '<div class="acc acc-ok">✅ ' + what + ' surveyed: ' + how + acc + '</div>';
    if (t === 'approx') return '<div class="acc acc-approx">〰️ ' + what + ' approximate: ' + how + acc + '. Survey on the ground to confirm.</div>';
    return '<div class="acc acc-assumed">⚠️ ' + what + ' assumed' + (isLine ? ': drawn with straight lines, not the real path' : '') + '. Needs surveying.</div>';
  }

  function lineStyle(layer, p) {
    var s = { color: COLOURS[layer], weight: 3, opacity: 0.9 };
    var t = p.type;
    if (layer === 'buildings') {
      s = { color: '#444', weight: 1.5, fillColor: '#888', fillOpacity: 0.45 };
    } else if (layer === 'fibre' && t === 'duct') {
      var nd = Array.isArray(p.ducts) ? p.ducts.length : 1;
      s.color = '#999'; s.weight = 5 + 2 * Math.min(nd, 4); s.opacity = 0.7;
    } else if (layer === 'openreach') {
      if (t === 'overhead') s.weight = 2;
      if (t === 'fttp_drop') s.weight = 4;
      if (t === 'underground') s.dashArray = '6 6';
    }
    var tr = tier(p);
    if (layer === 'buildings') { if (tr !== 'surveyed') s.dashArray = '4 4'; return s; }
    if (tr === 'approx') s.dashArray = '9 6';
    if (tr === 'assumed') { s.color = ASSUMED; s.dashArray = '1 7'; s.lineCap = 'round'; s.weight = 4; s.opacity = 1; }
    return s;
  }

  function icon(shape, colour, text, size) {
    size = size || 16;
    var style = shape === 'triangle' ? '' : 'width:' + size + 'px;height:' + size + 'px;background:' + colour + ';';
    return L.divIcon({
      className: '',
      html: '<div class="pt ' + shape + '" style="' + style + '">' + (text || '') + '</div>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });
  }

  function pointMarker(layer, f, latlng) {
    var p = f.properties || {};
    var t = p.type;
    var c = COLOURS[layer];
    var m;
    switch (layer) {
      case 'buildings':
        m = L.marker(latlng, { icon: t === 'postbox' ? icon('square', '#c0392b', '✉', 16) : icon('square', c, '', 14) });
        break;
      case 'chambers':
        m = L.marker(latlng, { icon: icon('square', c, '', 14) });
        break;
      case 'water':
        if (t === 'meter') m = L.marker(latlng, { icon: icon('circle', c, 'M', 18) });
        else if (t === 'submeter') m = L.marker(latlng, { icon: icon('circle', c, 'm', 16) });
        else if (t === 'stopcock') m = L.marker(latlng, { icon: icon('triangle', c, '', 16) });
        else m = L.circleMarker(latlng, { radius: 5, color: '#fff', weight: 1.5, fillColor: c, fillOpacity: 1 });
        break;
      case 'openreach':
        // Poles as a lettered circle so they read as assets, like the fibre ends.
        m = t === 'pole' ? L.marker(latlng, { icon: icon('circle', c, 'T', 18) })
          : L.circleMarker(latlng, { radius: 6, color: '#fff', weight: 1.5, fillColor: c, fillOpacity: 1 });
        break;
      case 'fibre':
        if (t === 'duct_end') { m = L.marker(latlng, { icon: icon('circle', '#607d8b', 'D', 16) }); break; }
        // Lettered box for what the cable ends or is spliced in (property 'enclosure').
        m = L.marker(latlng, { icon: icon('square', t === 'splice' ? '#c0392b' : '#2c3e50', ENCLOSURE[p.enclosure] || (t === 'splice' ? 'S' : 'P'), 18) });
        break;
      case 'electric':
        m = L.marker(latlng, { icon: t === 'supply_point' ? icon('circle', c, '⚡', 20) : icon('square', c, t === 'consumer_unit' ? 'CU' : '', 18) });
        break;
      case 'cctv':
        m = L.circleMarker(latlng, { radius: 6, color: '#fff', weight: 1.5, fillColor: c, fillOpacity: 1 });
        break;
      default:
        m = L.circleMarker(latlng, { radius: 5, fillColor: c, fillOpacity: 1 });
    }
    var label = p.id || '';
    if (label && (layer === 'chambers' || layer === 'buildings' || layer === 'openreach' && t === 'pole' || layer === 'electric' || t === 'duct_end')) {
      m.bindTooltip(label === 'B00' || t === 'postbox' ? (p.name || label) : label, { permanent: true, direction: 'right', offset: [8, 0], className: 'pt-label' });
    }
    return m;
  }

  // ---- CCTV view cone: polygon from bearing, field of view and range ----
  function destination(latlng, bearingDeg, distM) {
    var R = 6371008.8;
    var d = distM / R;
    var b = bearingDeg * Math.PI / 180;
    var lat1 = latlng.lat * Math.PI / 180;
    var lon1 = latlng.lng * Math.PI / 180;
    var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
    var lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return L.latLng(lat2 * 180 / Math.PI, lon2 * 180 / Math.PI);
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  function viewCone(f) {
    var p = f.properties || {};
    var g = f.geometry;
    if (!g || g.type !== 'Point') return null;
    var bearing = num(p.bearing_deg != null ? p.bearing_deg : p.bearing);
    var fov = num(p.fov_deg != null ? p.fov_deg : p.fov);
    var range = num(p.range_m);
    if (bearing === null || fov === null || range === null || range <= 0) return null;
    var origin = L.latLng(g.coordinates[1], g.coordinates[0]);
    var pts = [origin];
    var steps = Math.max(4, Math.round(fov / 5));
    for (var i = 0; i <= steps; i++) {
      pts.push(destination(origin, bearing - fov / 2 + (fov * i / steps), range));
    }
    return L.polygon(pts, { color: COLOURS.cctv, weight: 1, opacity: 0.6, fillColor: COLOURS.cctv, fillOpacity: 0.18, interactive: false });
  }

  // ---- Popups: every property ----
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // When each photo was taken (data/photos.json, from scripts/photo-meta.py): EXIF time, or about when it was sent.
  var PHOTO_META = {};
  fetch('data/photos.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (d) { PHOTO_META = d || {}; if (window.FxWin) window.FxWin.refresh(); }).catch(function () {});
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function photoWhen(f, long) {
    var m = PHOTO_META[f];
    if (!m || !m.taken) return '';
    var d = m.taken.split(' ')[0].split('-'), t = m.taken.split(' ')[1] || '';
    var txt = (+d[2]) + ' ' + MONTHS[+d[1] - 1] + (long ? ' ' + d[0] : '') + (t ? ' ' + t : '');
    if (!long) return (m.how === 'exif' ? '' : '~') + txt;
    return (m.how === 'exif' ? 'Taken ' + txt + (m.camera ? ' · ' + m.camera : '') : 'Sent about ' + txt + ' (no EXIF; time it reached the repo)');
  }
  window.PhotoWhen = photoWhen;

  function thumbsHtml(p) {
    // Photos: a row of small thumbnails; tapping one opens the photo viewer.
    var list = Array.isArray(p.photos) ? p.photos : [];
    var pics = list.map(function (f, i) {
      var src = 'photos/' + encodeURIComponent(f);
      var when = photoWhen(f, false);
      return '<figure class="thumb-fig"><img class="thumb" src="' + src + '" alt="' + esc((p.name || f) + ' photo ' + (i + 1)) + '" title="' + esc(photoWhen(f, true)) + '" data-photos="' + esc(list.join('|')) + '" data-i="' + i + '" loading="lazy">' +
        (when ? '<figcaption>' + esc(when) + '</figcaption>' : '') + '</figure>';
    }).join('');
    return pics ? '<div class="thumbs">' + pics + '</div>' : '';
  }

  // Other point features within a couple of metres (e.g. a manhole and the splice closure inside it).
  var points = [];   // {p, latlng}
  function alsoHere(p, latlng) {
    if (!latlng) return '';
    var near = points.filter(function (x) { return x.p !== p && x.latlng.distanceTo(latlng) < 2; });
    if (!near.length) return '';
    return '<div class="also"><div class="also-h">Also here</div>' + near.map(function (x) {
      var q = x.p;
      var ic = window.FibreIcons ? window.FibreIcons.iconFor(q.id) : '';
      return '<div class="also-item"><a href="#feature=' + esc(q.id) + '" class="also-name">' + (ic ? ic + ' ' : '') + esc(q.name || q.id) + '</a>' +
        (q.type ? ' <span class="also-type">' + esc(q.type) + '</span>' : '') + thumbsHtml(q) +
        (window.FibreNet ? window.FibreNet.popupExtras(q) : '') + '</div>';
    }).join('') + '</div>';
  }

  function popupHtml(p, latlng, isLine, noTitle) {
    var pics = thumbsHtml(p);
    var rows = Object.keys(p).filter(function (k) { return k !== 'photos'; }).map(function (k) {
      var v = p[k];
      if (v === null || v === undefined) v = '';
      if (k === 'ducts' && Array.isArray(v)) {
        var dl = v.map(function (du, i) {
          return '<b>' + esc(du.id || (i + 1)) + '</b>: ' + esc(du.od_mm) + ' mm ' + esc([du.colour, du.type].filter(Boolean).join(' ')) + (function () {
            var cs = du.cables || (window.FibreNet && window.FibreNet.cablesInDuct ? window.FibreNet.cablesInDuct(du.id) : '');
            return cs ? ' · cables: ' + esc(cs) : ' · no cables recorded';
          })();
        }).join('<br>');
        return '<tr><th>ducts</th><td><b>' + v.length + (v.length === 1 ? ' duct' : ' ducts') + '</b><br>' + dl + '</td></tr>';
      }
      if (typeof v === 'object') v = JSON.stringify(v);
      var cell = esc(v);
      if (k === 'doc' && v) {
        cell = '<a href="' + esc(DOC_BASE + v) + '" target="_blank" rel="noopener">' + esc(v) + '</a>';
      }
      return '<tr><th>' + esc(k) + '</th><td>' + cell + '</td></tr>';
    });
    var tic = window.FibreIcons && p.id ? window.FibreIcons.iconFor(p.id) : '';
    var title = p.name && !noTitle ? '<strong>' + (tic ? tic + ' ' : '') + esc(p.name) + '</strong>' : '';
    var extras = window.FibreNet ? window.FibreNet.popupExtras(p) : '';
    return title + accuracyBadge(p, isLine) + pics + extras + alsoHere(p, latlng) + '<table class="props">' + rows.join('') + '</table>';
  }

  // ---- Feature windows: clicking anything opens its details in a window that stays open (fibre.js FxWin) ----
  function openFeatureWin(layer) {
    var f = layer.feature || {}, p = f.properties || {}, gt = f.geometry && f.geometry.type;
    var isLine = gt === 'LineString' || gt === 'MultiLineString';
    if (isLine) { clearHighlight(); highlightLine(layer); }
    else if (p.cables) {
      clearHighlight();
      String(p.cables).split(/[,\s]+/).forEach(function (id) { if (lineById[id]) highlightLine(lineById[id]); });
    }
    // A fibre cable in the fibre model opens its cable view (which includes these details).
    if (isLine && p.id && window.FibreNet && window.FibreNet.hasCable && window.FibreNet.hasCable(p.id)) { window.FibreNet.cableOpened(p.id); return; }
    if (!window.FxWin) return;
    var ll = layer.getLatLng ? layer.getLatLng() : null;
    var tic = window.FibreIcons && p.id ? window.FibreIcons.iconFor(p.id) : '';
    var render = function () { return popupHtml(p, ll, isLine, true); };
    window.FxWin.show('feature:' + (p.id || L.stamp(layer)), { icon: tic || '📍', id: p.id || '', name: p.name || (p.id ? '' : 'Details') }, render(), { render: render, cls: 'small' });
  }

  // ---- #feature=<id>: open that item's popup (shareable links) ----
  function openFeatureFromHash() {
    var mm = /^#feature=([\w-]+)$/.exec(location.hash || '');
    var l = mm && featureById[mm[1]];
    if (!l || l._fromHash) return;
    l._fromHash = true;
    var ll = l.getLatLng ? l.getLatLng() : l.getBounds().getCenter();
    map.setView(ll, Math.max(map.getZoom(), 19));
    openFeatureWin(l);
  }
  window.addEventListener('hashchange', function () { Object.keys(featureById).forEach(function (k) { featureById[k]._fromHash = false; }); openFeatureFromHash(); });

  // ---- New version check: poll version.json and offer a reload when the published site has changed ----
  (function () {
    var meta = document.querySelector('meta[name="map-version"]');
    var mine = meta && meta.getAttribute('content');
    if (!mine || mine === 'dev') return;   // local preview: nothing to compare against
    var shown = false;
    function check() {
      if (shown) return;
      fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (v) {
          if (!v || !v.version || v.version === mine || shown) return;
          shown = true;
          var bar = document.createElement('div');
          bar.className = 'update-bar';
          bar.innerHTML = 'A new version of the map is available. <button>Reload</button>';
          bar.querySelector('button').addEventListener('click', function () {
            // A new query string makes the browser fetch a fresh page instead of its cached copy; keep the #view.
            location.replace(location.pathname + '?v=' + encodeURIComponent(v.version) + location.hash);
          });
          document.body.appendChild(bar);
        })
        .catch(function () {});
    }
    setInterval(check, 120000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    setTimeout(check, 5000);
  })();

  // ---- Photo viewer (lightbox) ----
  var viewer = null, vList = [], vI = 0;
  function showPhoto() {
    viewer.querySelector('img').src = 'photos/' + encodeURIComponent(vList[vI]);
    viewer.querySelector('.pv-count').textContent = (vI + 1) + ' / ' + vList.length + (photoWhen(vList[vI], true) ? ' · ' + photoWhen(vList[vI], true) : '');
    viewer.querySelector('.pv-full').href = 'photos/' + encodeURIComponent(vList[vI]);
    viewer.classList.toggle('single', vList.length < 2);
  }
  function openViewer(list, i) {
    if (!viewer) {
      viewer = document.createElement('div');
      viewer.className = 'pv';
      viewer.innerHTML = '<button class="pv-close" title="Close">&times;</button><button class="pv-prev" title="Previous">&#8249;</button>' +
        '<img alt=""><button class="pv-next" title="Next">&#8250;</button><div class="pv-bar"><span class="pv-count"></span> · <a class="pv-full" target="_blank" rel="noopener">full size</a></div>';
      document.body.appendChild(viewer);
      viewer.addEventListener('click', function (e) {
        var c = e.target.className;
        if (c === 'pv-prev') { vI = (vI + vList.length - 1) % vList.length; showPhoto(); }
        else if (c === 'pv-next') { vI = (vI + 1) % vList.length; showPhoto(); }
        else if (c === 'pv-close' || e.target === viewer) viewer.classList.remove('open');
      });
      document.addEventListener('keydown', function (e) {
        if (!viewer.classList.contains('open')) return;
        if (e.key === 'Escape') viewer.classList.remove('open');
        if (e.key === 'ArrowLeft') { vI = (vI + vList.length - 1) % vList.length; showPhoto(); }
        if (e.key === 'ArrowRight') { vI = (vI + 1) % vList.length; showPhoto(); }
      });
    }
    vList = list; vI = i; showPhoto();
    viewer.classList.add('open');
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains('thumb')) openViewer(t.getAttribute('data-photos').split('|'), +t.getAttribute('data-i'));
  });

  // ---- Overlays ----
  var LAYERS = [
    ['buildings', '🏠 Buildings'],
    ['chambers', '🕳️ Chambers'],
    ['water', '💧 Water'],
    ['openreach', '☎️ Openreach'],
    ['fibre', '🧵 Fibre'],
    ['electric', '⚡ Electric'],
    ['cctv', '📹 CCTV']
  ];

  // ---- Highlight: click a line to see its whole route and both ends ----
  var lineById = {};
  var featureById = {};       // feature id -> Leaflet layer (for #feature= links)          // feature id -> Leaflet line layer (for junction markers' 'cables')
  var hl = L.layerGroup().addTo(map);
  var hlLines = [];

  function clearHighlight() {
    hlLines.forEach(function (x) { x.layer.setStyle(x.style); });
    hlLines = [];
    hl.clearLayers();
  }

  function highlightLine(layer) {
    var f = layer.feature;
    hlLines.push({ layer: layer, style: L.extend({}, layer.options) });
    layer.setStyle({ color: '#00e5ff', weight: 7, opacity: 1 });
    layer.bringToFront();
    // A white casing underneath, so it stands out on the aerial.
    L.geoJSON(f, { style: { color: '#fff', weight: 11, opacity: 0.8 }, interactive: false }).addTo(hl).bringToBack();
    var g = f.geometry;
    var parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    parts.forEach(function (c) {
      [c[0], c[c.length - 1]].forEach(function (pt) {
        L.circleMarker([pt[1], pt[0]], { radius: 6, color: '#fff', weight: 2, fillColor: '#00e5ff', fillOpacity: 1, interactive: false }).addTo(hl);
      });
    });
  }


  // ---- Preview: hovering a menu or search row outlines that item on the map (amber), without moving the map ----
  var pv = L.layerGroup().addTo(map);
  function previewIds(ids) {
    pv.clearLayers();
    ids.forEach(function (id) {
      var l = lineById[id] || featureById[id] || featureById[String(id).split('/')[0]];
      if (!l) return;
      if (l.getLatLng) {
        var ll = l.getLatLng();
        L.circleMarker(ll, { radius: 18, color: '#0f1a20', weight: 7, fill: false, interactive: false }).addTo(pv);
        L.circleMarker(ll, { radius: 18, color: '#ffb300', weight: 4, fill: false, interactive: false }).addTo(pv);
      } else if (l.feature) {
        L.geoJSON(l.feature, { style: { color: '#0f1a20', weight: 12, opacity: 0.7 }, interactive: false, pointToLayer: function (f, ll) { return L.circleMarker(ll, { radius: 14 }); } }).addTo(pv);
        L.geoJSON(l.feature, { style: { color: '#ffb300', weight: 6, opacity: 1 }, interactive: false, pointToLayer: function (f, ll) { return L.circleMarker(ll, { radius: 14 }); } }).addTo(pv);
      }
    });
  }
  function clearPreview() { pv.clearLayers(); }

  // API for fibre.js (splice and trace diagrams).
  window.SiteMap = {
    map: map,
    clearHighlight: clearHighlight,
    closePopup: function () {},
    // A cable's map properties, folded away under its cable view.
    lineDetails: function (id) {
      var l = lineById[id];
      return l ? '<details class="fx-details"><summary>Map details</summary>' + popupHtml(l.feature.properties || {}, null, true, true) + '</details>' : '';
    },
    hasFeature: function (id) { return !!featureById[id]; },
    // Every map item with an id: its properties and a representative position (point, or centre of a line/area).
    allFeatures: function () {
      return Object.keys(featureById).map(function (k) {
        var l = featureById[k], ll = l.getLatLng ? l.getLatLng() : l.getBounds().getCenter();
        return { id: k, props: l.feature.properties || {}, lat: ll.lat, lng: ll.lng };
      });
    },
    // Duct routes (IDs '<end>-<end>') that start or finish at this chamber or structure.
    ductRoutesAt: function (id) {
      return Object.keys(featureById).filter(function (k) {
        var p = featureById[k].feature.properties || {};
        return p.type === 'duct' && k.split('-').indexOf(id) >= 0;
      });
    },
    // Properties of a map item, or of one duct ('<route>/<n>') merged with its route's.
    featureInfo: function (id) {
      var l = featureById[id];
      if (l) return l.feature.properties || {};
      var r = featureById[String(id).split('/')[0]];
      if (!r) return null;
      var rp = r.feature.properties || {};
      var du = (rp.ducts || []).filter(function (d) { return d.id === id; })[0];
      return du ? L.extend({ route: rp }, du) : null;
    },
    hasLine: function (id) { return !!lineById[id]; },
    openHash: function () { openFeatureFromHash(); },
    lineAccuracy: function (id) {
      var l = lineById[id];
      return l ? accuracyBadge(l.feature.properties || {}, true) : '<div class="acc acc-assumed">⚠️ Not on the map yet: the route needs drawing or surveying.</div>';
    },
    // Draw an assumed straight line for a cable whose two ends are on the map but whose route isn't drawn.
    // Build a cable's line from its route: points (chambers, boxes) and duct IDs ('<route>/<n>'), in order.
    addRouteLine: function (id, route, props) {
      if (lineById[id]) return false;
      var pts = [];
      function last() { return pts.length ? pts[pts.length - 1] : null; }
      function push(ll) { var l = last(); if (!l || l.distanceTo(ll) > 0.3) pts.push(ll); }
      // Ends not on the map yet (e.g. an enclosure still to be placed) are skipped; anything missing in the middle stops the drawing.
      while (route.length && !featureById[route[0]] && !featureById[String(route[0]).split('/')[0]]) route = route.slice(1);
      while (route.length && !featureById[route[route.length - 1]] && !featureById[String(route[route.length - 1]).split('/')[0]]) route = route.slice(0, -1);
      for (var i = 0; i < route.length; i++) {
        var r = route[i], rid = String(r).split('/')[0];
        var f = featureById[r] || featureById[rid];
        if (!f) return false;
        if (f.getLatLng) { push(f.getLatLng()); continue; }
        if (f instanceof L.Polygon) {
          // A building or structure: enter at the point of its outline nearest the previous step
          // (or nearest the next step if the route starts here).
          var ring = f.getLatLngs(); while (Array.isArray(ring[0])) ring = ring[0];
          var ref = last(), nxt = route[i + 1] && (featureById[route[i + 1]] || featureById[String(route[i + 1]).split('/')[0]]);
          if (!ref && nxt) ref = nxt.getLatLng ? nxt.getLatLng() : nxt.getBounds().getCenter();
          var best = ring[0];
          if (ref) ring.forEach(function (q) { if (q.distanceTo(ref) < best.distanceTo(ref)) best = q; });
          push(best); continue;
        }
        var ll = f.getLatLngs();
        if (ll.length && Array.isArray(ll[0])) ll = [].concat.apply([], ll);
        var l = last();
        if (l && ll.length && l.distanceTo(ll[ll.length - 1]) < l.distanceTo(ll[0])) ll = ll.slice().reverse();
        ll.forEach(push);
      }
      if (pts.length < 2) return false;
      // The line is only as certain as its least certain part: any assumed duct, or any gap of more than
      // 5 m between steps with no duct (a guessed straight join), makes the whole cable 'assumed'.
      var worst = 'surveyed', rank = { surveyed: 0, approx: 1, assumed: 2 };
      for (var j = 0; j < route.length; j++) {
        var rf = featureById[route[j]] || featureById[String(route[j]).split('/')[0]];
        if (rf && !rf.getLatLng && !(rf instanceof L.Polygon)) {
          var t2 = tier(rf.feature.properties || {});
          if (rank[t2] > rank[worst]) worst = t2;
        } else if (j > 0) {
          var pf = featureById[route[j - 1]];
          if (pf && pf.getLatLng && rf && rf.getLatLng && pf.getLatLng().distanceTo(rf.getLatLng()) > 5) worst = 'assumed';
        }
      }
      props = L.extend({}, props);
      if (worst === 'assumed') { props.method = 'assumed'; delete props.accuracy_m; props.notes += ' ⚠️ Part of the route (a duct or a join) is assumed, so the cable\'s line is too.'; }
      else if (worst === 'surveyed') { props.method = 'measured'; }
      var f2 = { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts.map(function (p) { return [p.lng, p.lat]; }) } };
      f2._route = route.slice();   // drawn from its ducts: edit mode reshapes the duct, not this line
      L.geoJSON(f2, geoOptions('fibre')).addTo(groups.fibre);
      return true;
    },
    addAssumedLine: function (id, fromId, toId, props) {
      var a = featureById[fromId], b = featureById[toId];
      if (!a || !b || !a.getLatLng || !b.getLatLng || lineById[id]) return false;
      var pa = a.getLatLng(), pb = b.getLatLng();
      var f = { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: [[pa.lng, pa.lat], [pb.lng, pb.lat]] } };
      f._derived = true;   // a straight line drawn from the fibre model: nothing to reshape
      L.geoJSON(f, geoOptions('fibre')).addTo(groups.fibre);
      return true;
    },
    openFeature: function (id) {
      var l = featureById[id];
      if (!l) return false;
      var ll = l.getLatLng ? l.getLatLng() : l.getBounds().getCenter();
      map.setView(ll, Math.max(map.getZoom(), 19));
      openFeatureWin(l);
      return true;
    },
    refreshPopup: function () { if (window.FxWin) window.FxWin.refresh(); },
    highlightIds: function (ids, fit) {
      clearHighlight();
      var b = null;
      ids.forEach(function (id) {
        var l = lineById[id];
        if (!l) return;
        highlightLine(l);
        b = b ? b.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast());
      });
      if (fit && b) {
        // Keep the route clear of the diagram panel (right side on wide screens, bottom on phones).
        var wide = window.innerWidth > 700;
        map.fitBounds(b, { paddingTopLeft: [40, 40], paddingBottomRight: wide ? [Math.min(640, window.innerWidth) + 40, 40] : [40, Math.round(window.innerHeight * 0.62) + 20], maxZoom: 19 });
      }
    }
  };

  var overlays = {}, groups = {}, loaded = 0, layerCounts = {};

  function geoOptions(name) {
    return {
          style: function (f) { return lineStyle(name, f.properties || {}); },
          pointToLayer: function (f, latlng) { return pointMarker(name, f, latlng); },
          onEachFeature: function (f, layer) {
            var p = f.properties || {};
            if (p.id) featureById[p.id] = layer;
            if (layer.getLatLng) points.push({ p: p, latlng: layer.getLatLng() });
            layer.on('click', function (e) {
              L.DomEvent.stop(e);
              if (editing) { var pl = pathTarget(layer, e.latlng); if (pl) { pathEdit(pl); return; } }
              openFeatureWin(layer);
            });
            var gt = f.geometry && f.geometry.type;
            if ((gt === 'LineString' || gt === 'MultiLineString') && p.id) lineById[p.id] = layer;
          }
        };
  }

  LAYERS.forEach(function (l) {
    var name = l[0];
    var group = L.featureGroup().addTo(map);
    groups[name] = group;
    overlays[l[1]] = group;
    fetch('data/' + name + '.geojson', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        if (name === 'cctv') {
          (data.features || []).forEach(function (f) {
            var cone = viewCone(f);
            if (cone) cone.addTo(group);
          });
        }
        L.geoJSON(data, geoOptions(name)).addTo(group);
        layerCounts[name] = (data.features || []).length;
        loaded++;
        if (loaded === LAYERS.length && window.FibreNet) window.FibreNet.mapReady();
        openFeatureFromHash();
      })
      .catch(function (e) {
        console.warn('Could not load layer ' + name + ': ' + e);
        loaded++;
        if (loaded === LAYERS.length && window.FibreNet) window.FibreNet.mapReady();
      });
  });


  L.control.scale({ metric: true, imperial: true }).addTo(map);

  // ---- Locate me ----
  var Locate = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      var div = L.DomUtil.create('div', 'leaflet-bar locate-btn');
      var a = L.DomUtil.create('a', '', div);
      a.href = '#';
      a.title = 'Show my location';
      a.setAttribute('role', 'button');
      a.innerHTML = '&#9678;';
      L.DomEvent.on(a, 'click', function (e) {
        L.DomEvent.stop(e);
        map.locate({ setView: true, maxZoom: 19, enableHighAccuracy: true });
      });
      return div;
    }
  });
  map.addControl(new Locate());

  var me = null;
  map.on('locationfound', function (e) {
    if (me) map.removeLayer(me);
    me = L.layerGroup([
      L.circle(e.latlng, { radius: e.accuracy, color: '#136aec', weight: 1, fillOpacity: 0.12 }),
      L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#136aec', fillOpacity: 1 })
    ]).addTo(map);
  });
  map.on('locationerror', function (e) { alert('Location unavailable: ' + e.message); });

  // ---- Toolbar and drop-down panels ----
  // A floating bar across the top: the site name, then buttons that open one dark panel at a time
  // (layers, links, cables, enclosures, chambers, legend). Lists come from the map and the fibre model.
  function legendHtml() {
    var items = [
      ['#1f78d1', 'Water'], ['#8b5a2b', 'Openreach'], ['#f39c12', 'Fibre'],
      ['#999999', 'Duct'], ['#d62728', 'Electric'], ['#8e44ad', 'CCTV view']
    ].map(function (i) { return '<li><span class="swatch" style="border-color:' + i[0] + '"></span>' + i[1] + '</li>'; }).join('');
    return '<ul class="tb-legend">' + items +
      '<li><span class="swatch" style="border-color:#eceff1"></span>Surveyed (GPS / measured)</li>' +
      '<li><span class="swatch dashed" style="border-color:#eceff1"></span>Approximate (traced from aerial)</li>' +
      '<li><span class="swatch dotted" style="border-color:' + ASSUMED + '"></span>Assumed: needs surveying</li></ul>' +
      '<div class="tb-sub">Points: <b style="color:#8b5a2b">T</b> Openreach pole · <b style="color:#d62728">⚡</b> electricity pole / transformer · <b>D</b> duct end · <b style="color:#c0392b">✉</b> postbox · ▪ chamber</div>' +
      '<div class="tb-sub">Fibre ends: <b>P</b> patch panel · <b>S</b> splice closure · <b>W</b> wall box · <b>C</b> cabinet · <b>B</b> pedestal · <b>O</b> ONT</div>' +
      '<div class="tb-sub">Icons: 🧵 cable · ⭕ duct · 🕳️ chamber · 📦 box · 🔀 splices · 🧭 circuit · 📍 details</div>' +
      '<div class="tb-sub">Positions are approximate unless surveyed; each popup says how accurate it is.</div>' +
      '<div class="tb-sub">Last updated ' + UPDATED + '</div>' +
      '<div class="tb-sub tb-build-l">' + esc(buildTip).replace(/\n/g, '<br>') + '</div>';
  }

  function layersHtml() {
    var base = '<div class="tb-h">Base map</div>' +
      BASES.map(function (b) {
        return '<label class="tb-row"><input type="radio" name="tb-base" value="' + b[0] + '"' + (map.hasLayer(b[2]) ? ' checked' : '') + '> ' + b[1] + '</label>';
      }).join('');
    var ov = '<div class="tb-h">Layers</div>' + LAYERS.map(function (l) {
      return '<label class="tb-row"><input type="checkbox" data-layer="' + l[0] + '"' + (map.hasLayer(groups[l[0]]) ? ' checked' : '') + '> ' + l[1] +
        ' <span class="tb-count">' + (layerCounts[l[0]] || 0) + '</span></label>';
    }).join('');
    return base + ov;
  }

  function listHtml(kind) {
    var F = window.FibreNet && window.FibreNet.lists ? window.FibreNet.lists() : null;
    if (kind === 'chambers') {
      var ch = Object.keys(featureById).filter(function (k) { var p = featureById[k].feature.properties || {}; return ['manhole', 'chamber', 'valve_box', 'draw_pit'].indexOf(p.type) >= 0; }).sort();
      return ch.map(function (k) {
        var p = featureById[k].feature.properties;
        return '<a href="#feature=' + esc(k) + '" class="tb-item tb-line"><b>🕳️ ' + esc(k) + '</b><span class="tb-name">' + esc(p.name || '') + '</span><span class="tb-meta">' + esc([p.owner, p.size_mm ? p.size_mm + ' mm' : ''].filter(Boolean).join(' · ')) + '</span></a>';
      }).join('') || '<div class="tb-sub">No chambers yet.</div>';
    }
    if (kind === 'ducts') {
      // Every duct, grouped by route: size, colour and type, and the cables recorded in it.
      var rows = [];
      Object.keys(featureById).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).forEach(function (k) {
        var p = featureById[k].feature.properties || {};
        (p.ducts || []).forEach(function (d) {
          var cs = window.FibreNet && window.FibreNet.cablesInDuct ? window.FibreNet.cablesInDuct(d.id) : '';
          rows.push('<a href="#" class="tb-item tb-line" data-fx="feature" data-id="' + esc(d.id) + '"><b>⭕ ' + esc(d.id) + '</b><span class="tb-name">' +
            esc([d.od_mm ? d.od_mm + ' mm' : '', d.colour, d.type].filter(Boolean).join(' ')) + '</span><span class="tb-meta">' + esc(cs ? '🧵 ' + cs : 'empty') + '</span></a>');
        });
      });
      return rows.join('') || '<div class="tb-sub">No ducts yet.</div>';
    }
    if (!F) return '<div class="tb-sub">Loading…</div>';
    if (kind === 'schematic') {
      // Schematic views: the whole duct network, all splices (in use only), each circuit, and each cable's route.
      return '<div class="tb-h">Duct network</div>' +
        '<a href="#" class="tb-item tb-line" data-fx="schem-net"><b>📐 Duct network</b><span class="tb-name">every chamber, enclosure and duct</span></a>' +
        '<div class="tb-h">Splices</div>' +
        '<a href="#" class="tb-item tb-line" data-fx="schem-splices"><b>🔀 All splices</b><span class="tb-name">every enclosure on one screen, in-use fibres only</span></a>' +
        '<div class="tb-h">Circuits</div>' + F.circuits.map(function (c) {
          return '<a href="#" class="tb-item tb-line" data-fx="schem-circuit" data-circuit="' + esc(c.id) + '"><b class="tb-name">🧭 ' + esc(c.name) + '</b><span class="tb-meta">' + esc(window.FibreCircuitInfo ? window.FibreCircuitInfo(c) : '') + '</span></a>';
        }).join('') +
        '<div class="tb-h">Cable routes</div>' + F.cables.map(function (c) {
          return '<a href="#" class="tb-item tb-line" data-fx="schem-cable" data-id="' + esc(c.id) + '"><b>🧵 ' + esc(c.id) + '</b><span class="tb-name">' + esc(c.name) + '</span><span class="tb-meta">' + c.fibres + 'F</span></a>';
        }).join('');
    }
    if (kind === 'links') return F.circuits.map(function (c) {
      return '<a href="#" class="tb-item tb-line" data-fx="trace" data-circuit="' + esc(c.id) + '"><b class="tb-name">🧭 ' + esc(c.name) + '</b><span class="tb-meta">' + esc(window.FibreCircuitInfo ? window.FibreCircuitInfo(c) : '') + '</span></a>';
    }).join('') || '<div class="tb-sub">No circuits recorded.</div>';
    if (kind === 'cables') return F.cables.map(function (c) {
      var l = lineById[c.id], t = l ? tier(l.feature.properties || {}) : 'none';
      var badge = { surveyed: '<span class="tb-chip ok">surveyed</span>', approx: '<span class="tb-chip approx">approx</span>', assumed: '<span class="tb-chip assumed">assumed</span>', none: '<span class="tb-chip">not on map</span>' }[t];
      return '<a href="#" class="tb-item tb-line" data-fx="cable" data-id="' + esc(c.id) + '"><b>🧵 ' + esc(c.id) + '</b><span class="tb-name">' + esc(c.name) + '</span><span class="tb-meta">' + c.fibres + 'F ' + badge + '</span></a>';
    }).join('');
    if (kind === 'enclosures') return F.nodes.map(function (n) {
      return '<div class="tb-item tb-line"><b class="tb-name">' + (n.documented ? '🔀' : '❓') + ' ' + esc(n.name) + '</b><span class="tb-meta">' +
        (n.documented ? '<a href="#" data-fx="splice" data-node="' + esc(n.id) + '">splices</a>' : 'not documented') +
        (featureById[n.id] ? ' · <a href="#feature=' + esc(n.id) + '">📍 on map</a>' : '') + '</span></div>';
    }).join('');
    return '';
  }

  // ---- Search: finds any asset (map features, ducts, cables, enclosures, circuits) by id, name or type ----
  var CHAMBER_TYPES = ['manhole', 'chamber', 'valve_box', 'draw_pit'];
  function featureIcon(p) {
    var t = p.type || '';
    if (t === 'cable') return '🧵';
    if (t === 'duct' || t === 'twinwall') return '⭕';
    if (CHAMBER_TYPES.indexOf(t) >= 0) return '🕳️';
    if (t === 'building') return '🏠';
    if (t === 'pole') return '🪵';
    if (t === 'supply_point') return '⚡';
    if (t === 'postbox') return '📮';
    if (t === 'duct_end') return '⭕';
    if (t === 'patch_point' || t === 'splice' || p.enclosure) return '📦';
    return '📍';
  }
  function searchIndex() {
    var out = [], seen = {};
    function add(r) { if (seen[r.key]) return; seen[r.key] = 1; r.text = (r.id + ' ' + r.name + ' ' + r.kind + ' ' + (r.extra || '')).toLowerCase(); out.push(r); }
    var F = window.FibreNet && window.FibreNet.lists ? window.FibreNet.lists() : null;
    if (F) {
      F.cables.forEach(function (c) { add({ key: c.id, id: c.id, name: c.name, kind: 'cable', icon: '🧵', meta: c.fibres + 'F', act: 'data-fx="cable" data-id="' + esc(c.id) + '"' }); });
      F.circuits.forEach(function (c) { add({ key: 'circuit:' + c.id, id: '', name: c.name, kind: 'circuit', icon: '🧭', act: 'data-fx="trace" data-circuit="' + esc(c.id) + '"' }); });
    }
    Object.keys(featureById).forEach(function (k) {
      var p = featureById[k].feature.properties || {};
      var node = F && F.nodes.filter(function (n) { return n.id === k; })[0];
      add({ key: k, id: k, name: p.name || (node && node.name) || '', kind: node ? 'enclosure' : (p.type || 'feature').replace(/_/g, ' '),
        icon: featureIcon(p), extra: [p.owner, p.notes, p.description].filter(Boolean).join(' '), act: 'data-fx="feature" data-id="' + esc(k) + '"' });
      (p.ducts || []).forEach(function (d) {
        add({ key: d.id, id: d.id, name: (d.od_mm ? d.od_mm + ' mm ' : '') + [d.colour, d.type].filter(Boolean).join(' '), kind: 'duct', icon: '⭕', act: 'data-fx="feature" data-id="' + esc(d.id) + '"' });
      });
    });
    if (F) F.nodes.forEach(function (n) {
      if (featureById[n.id]) return;
      add({ key: n.id, id: '', name: n.name, kind: 'enclosure', icon: n.documented ? '🔀' : '❓', meta: n.documented ? '' : 'not on map',
        act: n.documented ? 'data-fx="splice" data-node="' + esc(n.id) + '"' : '' });
    });
    return out;
  }
  function searchHtml(q) {
    q = q.trim().toLowerCase();
    if (!q) return '<div class="tb-sub">Type an id, name or type, e.g. MH12, F04, duct, cottage.</div>';
    var words = q.split(/\s+/);
    var hits = searchIndex().filter(function (r) { return words.every(function (w) { return r.text.indexOf(w) >= 0; }); });
    function rank(r) { var id = r.id.toLowerCase(); return id === q ? 0 : id.indexOf(q) === 0 ? 1 : id.indexOf(q) >= 0 ? 2 : r.name.toLowerCase().indexOf(q) >= 0 ? 3 : 4; }
    hits.sort(function (a, b) { return rank(a) - rank(b) || a.id.localeCompare(b.id, undefined, { numeric: true }) || a.name.localeCompare(b.name); });
    if (!hits.length) return '<div class="tb-sub">Nothing matches “' + esc(q) + '”.</div>';
    return '<div class="tb-list">' + hits.slice(0, 60).map(function (r) {
      var inner = '<b>' + r.icon + (r.id ? ' ' + esc(r.id) : '') + '</b><span class="tb-name">' + esc(r.name) + '</span><span class="tb-meta tb-kind">' + esc(r.meta ? r.meta + ' · ' + r.kind : r.kind) + '</span>';
      return r.act ? '<a href="#" class="tb-item tb-line" ' + r.act + '>' + inner + '</a>' : '<div class="tb-item tb-line">' + inner + '</div>';
    }).join('') + '</div>' + (hits.length > 60 ? '<div class="tb-sub">' + (hits.length - 60) + ' more; keep typing to narrow it down.</div>' : '');
  }

  var TB = [
    ['layers', '🗂️', 'Layers'], ['chambers', '🕳️', 'Chambers'], ['ducts', '⭕', 'Ducts'],
    ['enclosures', '🔀', 'Enclosures'], ['cables', '🧵', 'Cables'], ['links', '🧭', 'Circuits'], ['schematic', '📐', 'Schematic'], ['edit', '✏️', 'Edit'], ['legend', '🔑', 'Legend']
  ];
  var bar = L.DomUtil.create('div', 'tb', document.body);
  // Build info under the name: the source commits of the app code and the data (stamped by scripts/publish-map.sh).
  function metaOf(n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.getAttribute('content') : 'dev'; }
  var bApp = metaOf('map-build-app'), bData = metaOf('map-build-data'), bPub = metaOf('map-published');
  var buildShort = bApp === 'dev' ? 'dev build' : bApp.split(' ').slice(0, 2).join(' ') + ' · ' + bData.split(' ').slice(0, 2).join(' ');
  var buildTip = bApp === 'dev' ? 'Local preview (not published)' : 'App code: commit ' + bApp.split(' ').slice(1).join(', ') + '\nData: commit ' + bData.split(' ').slice(1).join(', ') + '\nPublished: ' + bPub + ' (UK time)';
  bar.innerHTML = '<span class="tb-brand">Llwynygorras<span class="tb-build" title="' + esc(buildTip) + '">' + esc(buildShort) + '</span></span>' + TB.map(function (b) {
    return '<button class="tb-btn" data-tb="' + b[0] + '" title="' + b[2] + '"><span class="tb-ic">' + b[1] + '</span><span class="tb-lbl">' + b[2] + '</span></button>';
  }).join('') + '<input type="search" class="tb-search" placeholder="🔍 Search assets" aria-label="Search assets" autocomplete="off" spellcheck="false">';
  var dd = L.DomUtil.create('div', 'tb-dd', document.body);
  L.DomEvent.disableClickPropagation(bar); L.DomEvent.disableClickPropagation(dd);
  L.DomEvent.disableScrollPropagation(dd);
  var ddOpen = null;
  function openDd(kind) {
    if (ddOpen === kind) { closeDd(); return; }
    ddOpen = kind;
    var b = kind === 'search' ? ['search', '🔍', 'Search'] : TB.filter(function (x) { return x[0] === kind; })[0];
    var body = kind === 'search' ? searchHtml(sbox.value) : kind === 'legend' ? legendHtml() : kind === 'layers' ? layersHtml() : '<div class="tb-list">' + listHtml(kind) + '</div>';
    dd.innerHTML = '<div class="tb-dd-head">' + b[1] + ' ' + b[2] + '<button class="tb-x" title="Close">&times;</button></div><div class="tb-dd-body">' + body + '</div>';
    dd.classList.add('open');
    // Drop down under the button (or the search box), like a normal menu, kept on screen.
    var anchor = kind === 'search' ? sbox : bar.querySelector('[data-tb="' + kind + '"]');
    if (anchor) {
      var r = anchor.getBoundingClientRect(), w = dd.offsetWidth;
      var left = kind === 'search' ? r.right - w : r.left;
      dd.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, left)) + 'px';
    }
    // List menus get a filter box: type to narrow the list; arrows and Enter pick, Esc closes.
    if (['links', 'cables', 'enclosures', 'chambers', 'ducts', 'schematic'].indexOf(kind) >= 0) {
      var fb = document.createElement('input');
      fb.type = 'search'; fb.className = 'tb-filter'; fb.placeholder = 'Type to filter…'; fb.setAttribute('aria-label', 'Filter ' + b[2]);
      dd.querySelector('.tb-dd-body').insertBefore(fb, dd.querySelector('.tb-dd-body').firstChild);
      fb.addEventListener('input', function () {
        var words = fb.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        Array.prototype.forEach.call(dd.querySelectorAll('.tb-list > .tb-item'), function (row) {
          var t = row.textContent.toLowerCase();
          row.style.display = words.every(function (w2) { return t.indexOf(w2) >= 0; }) ? '' : 'none';
        });
        sSel = 0; markSel();
      });
      fb.addEventListener('keydown', listKeys);
      if (window.innerWidth > 700) fb.focus();   // not on phones, where it would pop up the keyboard
      sSel = 0; markSel();
    }
    Array.prototype.forEach.call(bar.querySelectorAll('.tb-btn'), function (x) { if (x.getAttribute('data-tb') !== 'legend') x.classList.toggle('on', x.getAttribute('data-tb') === kind); });
    dd.querySelector('.tb-x').addEventListener('click', closeDd);
    if (kind === 'layers') {
      Array.prototype.forEach.call(dd.querySelectorAll('input[name="tb-base"]'), function (r) {
        r.addEventListener('change', function () { setBase(r.value); });
      });
      Array.prototype.forEach.call(dd.querySelectorAll('input[data-layer]'), function (c) {
        c.addEventListener('change', function () { var g = groups[c.getAttribute('data-layer')]; if (c.checked) g.addTo(map); else map.removeLayer(g); });
      });
    }
  }
  function closeDd() {
    ddOpen = null; dd.classList.remove('open');
    clearPreview(); pvRow = null;
    Array.prototype.forEach.call(bar.querySelectorAll('.tb-btn'), function (x) { if (x.getAttribute('data-tb') !== 'legend') x.classList.remove('on'); });
  }
  // The legend is its own docked panel (bottom left) that stays open while other menus and the map are used.
  // ---- Edit mode (Nat, 2026-11-06): drag point items to new positions, or tap the map to drop a new point, then copy
  // the list and paste it into Claude, who updates the data files. Nothing is saved to the site itself; the list
  // is kept in this browser until cleared.
  var editing = false, edits = {}, newPts = [], paths = {}, newLayer = L.layerGroup();
  try { var sv = JSON.parse(localStorage.getItem('map-edits') || '{}'); edits = sv.edits || {}; newPts = sv.newPts || []; paths = sv.paths || {}; } catch (e) {}
  function saveEdits() { try { localStorage.setItem('map-edits', JSON.stringify({ edits: edits, newPts: newPts, paths: paths })); } catch (e) {} }

  // ---- Path editing (Nat, 2026-11-06): tap a duct route (or other line) in edit mode to reshape it. Its two ends stay
  // fixed (they belong to the chambers); drag a white dot to move a bend, tap one to remove it, and drag or tap a
  // "+" between dots to add a bend there. Tap empty map to finish with that line.
  var pathLayer = L.layerGroup(), pathSel = null;
  function llArr(pts) { return pts.map(function (p) { return [p.lat, p.lng]; }); }
  function pathEditable(l) {
    var f = l.feature, ll = l.getLatLngs ? l.getLatLngs() : null;
    return !!(f && f.properties && f.properties.id && f.geometry && f.geometry.type === 'LineString' && ll && ll.length >= 2 && !Array.isArray(ll[0]));
  }
  // What a tap on a line edits: the line itself, or, for a cable drawn along its ducts, the duct nearest the tap.
  function pathTarget(l, ll) {
    var f = l.feature || {};
    if (f._derived) return null;
    if (!f._route) return pathEditable(l) ? l : null;
    var p = map.latLngToLayerPoint(ll), best = null, bd = Infinity;
    f._route.forEach(function (r) {
      var d = featureById[r] || featureById[String(r).split('/')[0]];
      if (!d || d.getLatLng || d instanceof L.Polygon || !pathEditable(d)) return;
      var q = d.getLatLngs().map(function (x) { return map.latLngToLayerPoint(x); });
      for (var i = 1; i < q.length; i++) { var dd = L.LineUtil.pointToSegmentDistance(p, q[i - 1], q[i]); if (dd < bd) { bd = dd; best = d; } }
    });
    return best;
  }
  function pathLen(a) { var m = 0; for (var i = 1; i < a.length; i++) m += L.latLng(a[i - 1]).distanceTo(L.latLng(a[i])); return Math.round(m * 10) / 10; }
  function pathCommit(id, pts) {
    var l = featureById[id] || lineById[id];
    if (!paths[id]) paths[id] = { old: l._pathOrig || llArr(pts) };
    paths[id].new = llArr(pts);
    if (JSON.stringify(paths[id].new) === JSON.stringify(paths[id].old)) delete paths[id];
    saveEdits(); renderEdit();
  }
  function pathEdit(l) {
    if (!l._pathOrig) l._pathOrig = paths[l.feature.properties.id] ? paths[l.feature.properties.id].old : llArr(l.getLatLngs());
    pathSel = l; drawHandles(); renderEdit();
  }
  function pathDone() { pathSel = null; pathLayer.clearLayers(); renderEdit(); }
  function drawHandles() {
    pathLayer.clearLayers();
    if (!pathSel) return;
    var l = pathSel, id = l.feature.properties.id;
    var pts = l.getLatLngs().map(function (p) { return L.latLng(p.lat, p.lng); });
    function redraw() { l.setLatLngs(pts.slice()); casing.setLatLngs(pts.slice()); }
    var casing = L.polyline(pts.slice(), { color: '#e91e63', weight: 10, opacity: 0.35, interactive: false }).addTo(pathLayer);
    pts.forEach(function (p, i) {
      var end = i === 0 || i === pts.length - 1;
      var m = L.marker(p, { draggable: !end, zIndexOffset: 2000, icon: L.divIcon({ className: end ? 'pe-end' : 'pe-vtx', iconSize: end ? [12, 12] : [16, 16] }) }).addTo(pathLayer);
      if (end) { m.bindTooltip('Fixed end: it moves with its chamber', { direction: 'top' }); return; }
      m.bindTooltip('Drag to move this bend · tap to remove it', { direction: 'top' });
      m.on('drag', function () { pts[i] = m.getLatLng(); redraw(); });
      m.on('dragend', function () { pathCommit(id, pts); drawHandles(); });
      m.on('click', function (e) { L.DomEvent.stop(e); pts.splice(i, 1); redraw(); pathCommit(id, pts); drawHandles(); });
    });
    for (var i = 0; i < pts.length - 1; i++) (function (i) {
      var a = pts[i], b = pts[i + 1], mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2), added = false;
      var m = L.marker(mid, { draggable: true, zIndexOffset: 1500, icon: L.divIcon({ className: 'pe-mid', html: '+', iconSize: [16, 16] }) }).addTo(pathLayer);
      m.bindTooltip('Drag (or tap) to add a bend here', { direction: 'top' });
      m.on('dragstart', function () { pts.splice(i + 1, 0, m.getLatLng()); added = true; });
      m.on('drag', function () { if (added) { pts[i + 1] = m.getLatLng(); redraw(); } });
      m.on('dragend', function () { pathCommit(id, pts); drawHandles(); });
      m.on('click', function (e) { L.DomEvent.stop(e); pts.splice(i + 1, 0, mid); redraw(); pathCommit(id, pts); drawHandles(); });
    })(i);
  }
  function applyPaths(on) {
    Object.keys(paths).forEach(function (id) {
      var l = featureById[id] || lineById[id];
      if (!l || !l.setLatLngs) return;
      if (!l._pathOrig) l._pathOrig = paths[id].old;
      l.setLatLngs(on ? paths[id].new : paths[id].old);
    });
  }
  function f6(x) { return (Math.round(x * 1e6) / 1e6).toFixed(6); }
  function copyText(t, el) {
    function done() { if (el) { el.classList.add('copied'); setTimeout(function () { el.classList.remove('copied'); }, 900); } }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(ta); }
  }
  // The batch to paste into Claude: what moved (old and new positions) and any new points.
  function exportJson() {
    var r6 = function (x) { return Math.round(x * 1e6) / 1e6; };
    return JSON.stringify({
      map_edits: new Date().toISOString().slice(0, 16) + 'Z',
      moved: Object.keys(edits).sort().map(function (id) {
        var e = edits[id], f = featureById[id], p = (f && f.feature && f.feature.properties) || {};
        return { id: id, name: p.name || '', old: [r6(e.lat0), r6(e.lng0)], new: [r6(e.lat), r6(e.lng)], moved_m: Math.round(L.latLng(e.lat, e.lng).distanceTo(L.latLng(e.lat0, e.lng0)) * 10) / 10 };
      }),
      new: newPts.map(function (p, i) { return { name: p.name || ('point ' + (i + 1)), at: [r6(p.lat), r6(p.lng)] }; }),
      paths: Object.keys(paths).sort().map(function (id) {
        var e = paths[id], f = featureById[id] || lineById[id], p = (f && f.feature && f.feature.properties) || {};
        var rr = function (a) { return a.map(function (q) { return [r6(q[0]), r6(q[1])]; }); };
        return { id: id, name: p.name || '', old: rr(e.old), new: rr(e.new), length_m: [pathLen(e.old), pathLen(e.new)] };
      })
    }, null, 1).replace(/\[\n\s*([-\d.]+),\n\s*([-\d.]+)\n\s*\]/g, '[$1, $2]');
  }
  function editLines() {
    var out = [];
    Object.keys(edits).sort().forEach(function (id) {
      var e = edits[id], d = L.latLng(e.lat, e.lng).distanceTo(L.latLng(e.lat0, e.lng0));
      out.push('MOVE ' + id + ' ' + f6(e.lat) + ', ' + f6(e.lng) + '  (was ' + f6(e.lat0) + ', ' + f6(e.lng0) + '; moved ' + d.toFixed(1) + ' m)');
    });
    newPts.forEach(function (p, i) { out.push('NEW ' + (p.name || ('point ' + (i + 1))) + ' ' + f6(p.lat) + ', ' + f6(p.lng)); });
    Object.keys(paths).forEach(function (id) { out.push('PATH ' + id); });
    return out;
  }
  var ep = L.DomUtil.create('div', 'edit-panel', document.body);
  L.DomEvent.disableClickPropagation(ep); L.DomEvent.disableScrollPropagation(ep);
  function renderEdit() {
    var lines = editLines();
    ep.innerHTML = '<div class="tb-dd-head">✏️ Edit mode<button class="tb-x" title="Leave edit mode">&times;</button></div><div class="tb-dd-body">' +
      '<div class="tb-sub">Drag chambers, boxes, poles or other points to move them; tap empty map to drop a new point (name it below). <b>Tap a duct</b> to reshape its path: drag the dots, tap a dot to remove it, drag or tap a <b>+</b> to add a bend; its ends stay on the chambers. When done, <b>Export</b> copies a JSON batch to paste into Claude. Kept in this browser until cleared.</div>' +
      (pathSel ? '<div class="edit-sel">〰️ Editing <b>' + esc(pathSel.feature.properties.id) + '</b> · ' + (pathSel.getLatLngs().length - 2) + ' bend(s) · ' + pathLen(llArr(pathSel.getLatLngs())) + ' m <button class="fx-btn small edit-done">Done</button></div>' : '') +
      (lines.length ? '<div class="edit-list">' + Object.keys(edits).sort().map(function (id) {
          var e = edits[id];
          return '<div class="edit-row"><code class="edit-copy" data-t="MOVE ' + esc(id) + ' ' + f6(e.lat) + ', ' + f6(e.lng) + '">MOVE <b>' + esc(id) + '</b> ' + f6(e.lat) + ', ' + f6(e.lng) + '</code><button class="edit-undo" data-id="' + esc(id) + '" title="Put it back">↺</button></div>';
        }).join('') + newPts.map(function (p, i) {
          return '<div class="edit-row"><input class="edit-name" data-i="' + i + '" value="' + esc(p.name || '') + '" placeholder="name (e.g. MH21)"><code class="edit-copy" data-t="NEW ' + esc(p.name || ('point ' + (i + 1))) + ' ' + f6(p.lat) + ', ' + f6(p.lng) + '">' + f6(p.lat) + ', ' + f6(p.lng) + '</code><button class="edit-del" data-i="' + i + '" title="Remove">✕</button></div>';
        }).join('') + Object.keys(paths).sort().map(function (id) {
          var e = paths[id];
          return '<div class="edit-row"><code class="edit-copy edit-pick" data-id="' + esc(id) + '" data-t="PATH ' + esc(id) + '">PATH <b>' + esc(id) + '</b> ' + (e.new.length - 2) + ' bend(s), ' + pathLen(e.new) + ' m (was ' + pathLen(e.old) + ' m)</code><button class="edit-unpath" data-id="' + esc(id) + '" title="Put the path back">↺</button></div>';
        }).join('') + '</div>' : '<div class="tb-sub"><i>No changes yet.</i></div>') +
      '<div class="fx-btns"><button class="fx-btn edit-all"' + (lines.length ? '' : ' disabled') + '>📤 Export</button><button class="fx-btn edit-clear"' + (lines.length ? '' : ' disabled') + '>Clear</button></div></div>';
    ep.querySelector('.tb-x').onclick = function () { setEdit(false); };
    var dn = ep.querySelector('.edit-done'); if (dn) dn.onclick = pathDone;
    Array.prototype.forEach.call(ep.querySelectorAll('.edit-unpath'), function (b) { b.onclick = function () {
      var id = b.getAttribute('data-id'), l = featureById[id] || lineById[id];
      if (l && l.setLatLngs) l.setLatLngs(paths[id].old);
      delete paths[id]; saveEdits();
      if (pathSel === l) drawHandles();
      renderEdit();
    }; });
    Array.prototype.forEach.call(ep.querySelectorAll('.edit-copy'), function (c) { c.onclick = function () {
      var pid = c.getAttribute('data-id'), pl = pid && (featureById[pid] || lineById[pid]);
      if (pl && c.classList.contains('edit-pick')) { pathEdit(pl); map.fitBounds(pl.getBounds(), { maxZoom: 20, padding: [60, 60] }); return; }
      copyText(c.getAttribute('data-t'), c);
    }; });
    Array.prototype.forEach.call(ep.querySelectorAll('.edit-undo'), function (b) { b.onclick = function () {
      var id = b.getAttribute('data-id'), e = edits[id], l = featureById[id];
      if (l && l.setLatLng) l.setLatLng([e.lat0, e.lng0]);
      delete edits[id]; saveEdits(); renderEdit();
    }; });
    Array.prototype.forEach.call(ep.querySelectorAll('.edit-del'), function (b) { b.onclick = function () { newPts.splice(+b.getAttribute('data-i'), 1); saveEdits(); drawNew(); renderEdit(); }; });
    Array.prototype.forEach.call(ep.querySelectorAll('.edit-name'), function (inp) { inp.onchange = function () { newPts[+inp.getAttribute('data-i')].name = inp.value.trim(); saveEdits(); renderEdit(); }; });
    var all = ep.querySelector('.edit-all'); if (all) all.onclick = function () {
      var j = exportJson();
      copyText(j, all);
      var ta = ep.querySelector('.edit-json') || L.DomUtil.create('textarea', 'edit-json', ep.querySelector('.tb-dd-body'));
      ta.readOnly = true; ta.value = j; ta.select();
      all.textContent = '✅ Copied: paste into Claude';
    };
    var clr = ep.querySelector('.edit-clear'); if (clr) clr.onclick = function () {
      if (!confirm('Clear all edits? Moved items go back.')) return;
      Object.keys(edits).forEach(function (id) { var l = featureById[id], e = edits[id]; if (l && l.setLatLng) l.setLatLng([e.lat0, e.lng0]); });
      applyPaths(false); pathDone();
      edits = {}; newPts = []; paths = {}; saveEdits(); drawNew(); renderEdit();
    };
  }
  function drawNew() {
    newLayer.clearLayers();
    newPts.forEach(function (p, i) {
      var m = L.marker([p.lat, p.lng], { draggable: true, icon: icon('circle', '#e91e63', '+', 18) }).addTo(newLayer);
      m.bindTooltip(p.name || ('new ' + (i + 1)), { permanent: true, direction: 'right', offset: [8, 0], className: 'pt-label' });
      m.on('dragend', function () { var ll = m.getLatLng(); p.lat = ll.lat; p.lng = ll.lng; saveEdits(); renderEdit(); });
    });
  }
  function onMapClick(e) { if (!editing) return; if (pathSel) { pathDone(); return; } newPts.push({ lat: e.latlng.lat, lng: e.latlng.lng, name: '' }); saveEdits(); drawNew(); renderEdit(); }
  map.on('click', onMapClick);
  function setEdit(on) {
    editing = on;
    document.body.classList.toggle('editing', on);
    var eb = bar.querySelector('[data-tb="edit"]'); if (eb) eb.classList.toggle('on', on);
    ep.classList.toggle('open', on);
    Object.keys(featureById).forEach(function (id) {
      var l = featureById[id];
      if (!l.dragging || !l.getLatLng || !(l instanceof L.Marker)) return;
      if (on) {
        l.dragging.enable();
        if (!l._editWired) {
          l._editWired = true;
          l.on('dragstart', function () { if (!edits[id]) { var o = l.getLatLng(); edits[id] = { lat0: o.lat, lng0: o.lng, lat: o.lat, lng: o.lng }; } });
          l.on('dragend', function () { var ll = l.getLatLng(); edits[id].lat = ll.lat; edits[id].lng = ll.lng; saveEdits(); renderEdit(); });
        }
      } else l.dragging.disable();
      if (edits[id] && on) l.setLatLng([edits[id].lat, edits[id].lng]);
    });
    if (on) { newLayer.addTo(map); pathLayer.addTo(map); applyPaths(true); drawNew(); renderEdit(); }
    else { pathDone(); map.removeLayer(newLayer); map.removeLayer(pathLayer); }
  }
  var leg = L.DomUtil.create('div', 'tb-legend-panel', document.body);
  L.DomEvent.disableClickPropagation(leg); L.DomEvent.disableScrollPropagation(leg);
  function setLegend(on) {
    leg.innerHTML = on ? '<div class="tb-dd-head">🔑 Legend<button class="tb-x" title="Close">&times;</button></div><div class="tb-dd-body">' + legendHtml() + '</div>' : '';
    leg.classList.toggle('open', on);
    var lb = bar.querySelector('[data-tb="legend"]'); if (lb) lb.classList.toggle('on', on);
    if (on) leg.querySelector('.tb-x').addEventListener('click', function () { setLegend(false); });
    try { localStorage.setItem('map-legend', on ? '1' : '0'); } catch (e) {}
  }
  try { if (localStorage.getItem('map-legend') === '1') setTimeout(function () { setLegend(true); }, 0); } catch (e) {}
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tb]');
    if (!b) return;
    if (b.getAttribute('data-tb') === 'legend') setLegend(!leg.classList.contains('open'));
    else if (b.getAttribute('data-tb') === 'edit') setEdit(!editing);
    else openDd(b.getAttribute('data-tb'));
  });
  // Search: results update as you type; arrow keys move, Enter opens, Escape closes.
  var sbox = bar.querySelector('.tb-search'), sSel = 0;
  function showSearch() {
    ddOpen = null; openDd('search'); sSel = 0; markSel();
  }
  function visRows() {
    return Array.prototype.filter.call(dd.querySelectorAll('.tb-list > .tb-item'), function (r) { return r.style.display !== 'none'; });
  }
  function markSel() {
    Array.prototype.forEach.call(dd.querySelectorAll('.tb-list > .tb-item'), function (r) { r.classList.remove('sel'); });
    var rows = visRows();
    if (rows[sSel]) { rows[sSel].classList.add('sel'); rows[sSel].scrollIntoView({ block: 'nearest' }); }
  }
  function listKeys(e) {
    var rows = visRows();
    if (e.key === 'ArrowDown') { sSel = Math.min(rows.length - 1, sSel + 1); markSel(); previewRow(visRows()[sSel] || null); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sSel = Math.max(0, sSel - 1); markSel(); previewRow(visRows()[sSel] || null); e.preventDefault(); }
    else if (e.key === 'Enter') {
      var r = rows[sSel];
      if (r) { var t = r.matches('a, [data-fx]') ? r : r.querySelector('a, [data-fx]'); if (t) t.click(); e.target.blur(); }
      e.preventDefault();
    } else if (e.key === 'Escape') { closeDd(); e.target.blur(); }
  }
  sbox.addEventListener('input', showSearch);
  sbox.addEventListener('focus', function () { if (ddOpen !== 'search') showSearch(); });
  sbox.addEventListener('keydown', listKeys);
  // Choosing something in a list closes the drop-down (the trace, cable view or popup then opens).
  dd.addEventListener('click', function (e) { if (e.target.closest('.tb-item a, a.tb-item, .tb-item[data-fx]')) setTimeout(closeDd, 0); });
  // Hovering (or arrow-keying to) a row outlines its item on the map: chambers and other features, duct routes,
  // cables, the cables of a circuit, and an enclosure's splice point.
  function rowIds(row) {
    if (!row) return [];
    var t = row.matches('[data-fx], a[href^="#feature="]') ? row : row.querySelector('[data-fx], a[href^="#feature="]');
    if (!t) return [];
    var href = t.getAttribute('href') || '', m = href.match(/^#feature=(.+)$/);
    if (m) return [decodeURIComponent(m[1])];
    var fx = t.getAttribute('data-fx');
    if (fx === 'feature' || fx === 'cable' || fx === 'schem-cable') return [t.getAttribute('data-id')];
    if (fx === 'splice') return [t.getAttribute('data-node')];
    if (fx === 'trace' || fx === 'schem-circuit') return window.FibreCircuitCables ? window.FibreCircuitCables(t.getAttribute('data-circuit')) : [];
    return [];
  }
  var pvRow = null;
  function previewRow(row) { if (row === pvRow) return; pvRow = row; if (row) previewIds(rowIds(row)); else clearPreview(); }
  dd.addEventListener('mouseover', function (e) { previewRow(e.target.closest('.tb-item')); });
  dd.addEventListener('mouseleave', function () { previewRow(null); });
})();
