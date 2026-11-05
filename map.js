/* Llwynygorras site map. Plain Leaflet 1.9.4, no build step.
 * Source lives in the private repo natm/llwyngorras-home (map/site/);
 * published to github.com/natm/map by scripts/publish-map.sh. */
(function () {
  'use strict';

  var UPDATED = '2026-11-05';
  var CENTRE = [51.938686, -5.067480];
  var DOC_BASE = 'https://github.com/natm/llwyngorras-home/blob/main/';

  var map = L.map('map', { center: CENTRE, zoom: 17, maxZoom: 21, zoomControl: true });

  // ---- Base layers ----
  var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 21,
    maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });
  var aerial = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 21,
    maxNativeZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Vantor/Maxar, Earthstar Geographics, and the GIS User Community'
  });
  aerial.addTo(map);

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

  // Solid = surveyed on the ground; dashed = assumed or traced from imagery.
  function isAssumed(p) {
    var m = (p.method || '').toLowerCase();
    return m === 'assumed' || m === 'aerial-trace' || m === 'description' || !m;
  }

  function lineStyle(layer, p) {
    var s = { color: COLOURS[layer], weight: 3, opacity: 0.9 };
    var t = p.type;
    if (layer === 'buildings') {
      s = { color: '#444', weight: 1.5, fillColor: '#888', fillOpacity: 0.45 };
    } else if (layer === 'fibre' && t === 'duct') {
      s.color = '#999'; s.weight = 7; s.opacity = 0.7;
    } else if (layer === 'openreach') {
      if (t === 'overhead') s.weight = 2;
      if (t === 'fttp_drop') s.weight = 4;
      if (t === 'underground') s.dashArray = '6 6';
    }
    if (isAssumed(p) && layer !== 'buildings') s.dashArray = '6 6';
    if (isAssumed(p) && layer === 'buildings') s.dashArray = '4 4';
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
        m = L.marker(latlng, { icon: icon('square', c, '', 14) });
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
        m = L.circleMarker(latlng, { radius: t === 'pole' ? 5 : 6, color: '#fff', weight: 1.5, fillColor: c, fillOpacity: 1 });
        break;
      case 'fibre':
        // Lettered box for what the cable ends or is spliced in (property 'enclosure').
        m = L.marker(latlng, { icon: icon('square', t === 'splice' ? '#c0392b' : '#2c3e50', ENCLOSURE[p.enclosure] || (t === 'splice' ? 'S' : 'P'), 18) });
        break;
      case 'electric':
        m = L.marker(latlng, { icon: icon('square', c, t === 'consumer_unit' ? 'CU' : '', 18) });
        break;
      case 'cctv':
        m = L.circleMarker(latlng, { radius: 6, color: '#fff', weight: 1.5, fillColor: c, fillOpacity: 1 });
        break;
      default:
        m = L.circleMarker(latlng, { radius: 5, fillColor: c, fillOpacity: 1 });
    }
    var label = p.id || '';
    if (label && (layer === 'chambers' || layer === 'buildings')) {
      m.bindTooltip(label === 'B00' ? (p.name || label) : label, { permanent: true, direction: 'right', offset: [8, 0], className: 'pt-label' });
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

  function thumbsHtml(p) {
    // Photos: a row of small thumbnails; tapping one opens the photo viewer.
    var list = Array.isArray(p.photos) ? p.photos : [];
    var pics = list.map(function (f, i) {
      var src = 'photos/' + encodeURIComponent(f);
      return '<img class="thumb" src="' + src + '" alt="' + esc((p.name || f) + ' photo ' + (i + 1)) + '" data-photos="' + esc(list.join('|')) + '" data-i="' + i + '" loading="lazy">';
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
      return '<div class="also-item"><a href="#feature=' + esc(q.id) + '" class="also-name">' + esc(q.name || q.id) + '</a>' +
        (q.type ? ' <span class="also-type">' + esc(q.type) + '</span>' : '') + thumbsHtml(q) +
        (window.FibreNet ? window.FibreNet.popupExtras(q) : '') + '</div>';
    }).join('') + '</div>';
  }

  function popupHtml(p, latlng) {
    var pics = thumbsHtml(p);
    var rows = Object.keys(p).filter(function (k) { return k !== 'photos'; }).map(function (k) {
      var v = p[k];
      if (v === null || v === undefined) v = '';
      if (typeof v === 'object') v = JSON.stringify(v);
      var cell = esc(v);
      if (k === 'doc' && v) {
        cell = '<a href="' + esc(DOC_BASE + v) + '" target="_blank" rel="noopener">' + esc(v) + '</a>';
      }
      return '<tr><th>' + esc(k) + '</th><td>' + cell + '</td></tr>';
    });
    var title = p.name ? '<strong>' + esc(p.name) + '</strong>' : '';
    var extras = window.FibreNet ? window.FibreNet.popupExtras(p) : '';
    return title + pics + extras + alsoHere(p, latlng) + '<table class="props">' + rows.join('') + '</table>';
  }

  // ---- #feature=<id>: open that item's popup (shareable links) ----
  function openFeatureFromHash() {
    var mm = /^#feature=([\w-]+)$/.exec(location.hash || '');
    var l = mm && featureById[mm[1]];
    if (!l || l._fromHash) return;
    l._fromHash = true;
    var ll = l.getLatLng ? l.getLatLng() : l.getBounds().getCenter();
    map.setView(ll, Math.max(map.getZoom(), 19));
    l.openPopup(ll);
  }
  window.addEventListener('hashchange', function () { Object.keys(featureById).forEach(function (k) { featureById[k]._fromHash = false; }); openFeatureFromHash(); });

  // ---- Photo viewer (lightbox) ----
  var viewer = null, vList = [], vI = 0;
  function showPhoto() {
    viewer.querySelector('img').src = 'photos/' + encodeURIComponent(vList[vI]);
    viewer.querySelector('.pv-count').textContent = (vI + 1) + ' / ' + vList.length;
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

  // Keep the highlight while a fibre diagram panel is open.
  map.on('popupclose', function () { if (!(window.FibreNet && window.FibreNet.isOpen())) clearHighlight(); });

  // API for fibre.js (splice and trace diagrams).
  window.SiteMap = {
    map: map,
    clearHighlight: clearHighlight,
    closePopup: function () { map.closePopup(); },
    refreshPopup: function () { var pp = map._popup; if (pp && map.hasLayer(pp)) pp.update(); },
    highlightIds: function (ids, fit) {
      clearHighlight();
      var b = null;
      ids.forEach(function (id) {
        var l = lineById[id];
        if (!l) return;
        highlightLine(l);
        b = b ? b.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast());
      });
      if (fit && b) map.fitBounds(b, { padding: [40, 40], maxZoom: 19 });
    }
  };

  var overlays = {};
  LAYERS.forEach(function (l) {
    var name = l[0];
    var group = L.featureGroup().addTo(map);
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
        L.geoJSON(data, {
          style: function (f) { return lineStyle(name, f.properties || {}); },
          pointToLayer: function (f, latlng) { return pointMarker(name, f, latlng); },
          onEachFeature: function (f, layer) {
            var p = f.properties || {};
            if (p.id) featureById[p.id] = layer;
            if (layer.getLatLng) points.push({ p: p, latlng: layer.getLatLng() });
            layer.bindPopup(function () {
              return popupHtml(p, layer.getLatLng ? layer.getLatLng() : null);
            }, { maxWidth: 320, minWidth: 50, maxHeight: Math.max(220, Math.round(window.innerHeight * 0.55)), autoPanPadding: [20, 20] });
            var gt = f.geometry && f.geometry.type;
            if (gt === 'LineString' || gt === 'MultiLineString') {
              if (p.id) lineById[p.id] = layer;
              layer.on('popupopen', function () {
                clearHighlight(); highlightLine(layer);
                if (name === 'fibre' && window.FibreNet) window.FibreNet.cableOpened(p.id);
              });
            } else if (p.cables) {
              // A junction: highlight every cable that ends or is spliced here.
              layer.on('popupopen', function () {
                clearHighlight();
                String(p.cables).split(/[,\s]+/).forEach(function (id) { if (lineById[id]) highlightLine(lineById[id]); });
              });
            }
          }
        }).addTo(group);
        openFeatureFromHash();
      })
      .catch(function (e) { console.warn('Could not load layer ' + name + ': ' + e); });
  });

  L.control.layers({ 'Aerial (Esri)': aerial, 'Map (OpenStreetMap)': osm }, overlays, { collapsed: true }).addTo(map);
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

  // ---- Title and legend ----
  var Info = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      var div = L.DomUtil.create('div', 'info-box collapsed');
      var items = [
        ['#1f78d1', 'Water'], ['#8b5a2b', 'Openreach'], ['#f39c12', 'Fibre'],
        ['#999999', 'Duct'], ['#d62728', 'Electric'], ['#8e44ad', 'CCTV view']
      ].map(function (i) {
        return '<li><span class="swatch" style="border-color:' + i[0] + '"></span>' + i[1] + '</li>';
      }).join('');
      div.innerHTML =
        '<h1 title="Tap for legend">Llwynygorras site map</h1>' +
        '<div class="updated">Last updated ' + UPDATED + '</div>' +
        '<ul>' + items +
        '<li><span class="swatch" style="border-color:#333"></span>Surveyed</li>' +
        '<li><span class="swatch dashed" style="border-color:#333"></span>Assumed / traced</li>' +
        '<li class="ends">Fibre ends: <b>P</b> patch panel, <b>S</b> splice closure, <b>W</b> wall box, <b>C</b> cabinet, <b>B</b> pedestal, <b>O</b> ONT</li></ul>' +
        '<div class="note">Tap a cable to highlight its whole route.</div>' +
        '<div class="note">Positions are approximate; check popups for method and accuracy.</div>';
      L.DomEvent.disableClickPropagation(div);
      div.querySelector('h1').addEventListener('click', function () {
        div.classList.toggle('collapsed');
      });
      return div;
    }
  });
  map.addControl(new Info());
})();
