/* Fibre splice and trace diagrams for the Llwynygorras site map.
 * Reads data/fibre-network.json (format: map/README.md#fibre-network) and draws:
 *   - a splice diagram per enclosure (cables, fibre colours, panels, devices, splices, patches), as SVG
 *   - an end-to-end trace of a circuit or port, as stacked cards, highlighting its cables on the map
 * Plain ES5, no build step. Needs map.js loaded first (window.SiteMap). */
(function () {
  'use strict';

  // TIA-598 fibre / tube colour order.
  var COLOURS = [
    ['Blue', '#1565c0'], ['Orange', '#f57c00'], ['Green', '#2e7d32'], ['Brown', '#795548'],
    ['Slate', '#78909c'], ['White', '#ffffff'], ['Red', '#d32f2f'], ['Black', '#212121'],
    ['Yellow', '#fdd835'], ['Violet', '#7b1fa2'], ['Rose', '#f48fb1'], ['Aqua', '#26c6da']
  ];
  var LIGHT = { White: 1, Yellow: 1, Rose: 1, Aqua: 1 };
  var PATCH = '#e6b800';

  // One icon per kind of thing, used on every link and button: 🧵 cable · ⭕ duct · 🕳️ chamber · 📦 box/enclosure on the map ·
  // 🔀 splice diagram · 🧭 circuit trace · 📍 details and photos.
  var ICON = { cable: '🧵', duct: '⭕', chamber: '🕳️', box: '📦', splice: '🔀', trace: '🧭', details: '📍' };
  function iconFor(id) {
    if (net && net.cables && net.cables[id]) return ICON.cable;
    if (String(id).indexOf('/') > 0) return ICON.duct;
    var inf = window.SiteMap && window.SiteMap.featureInfo(id);
    if (!inf) return '';
    if (inf.type === 'duct') return ICON.duct;
    if (['manhole', 'chamber', 'valve_box', 'draw_pit'].indexOf(inf.type) >= 0) return ICON.chamber;
    return ICON.box;
  }
  window.FibreIcons = { ICON: ICON, iconFor: iconFor };

  var net = null;
  var adj = {};
  var traces = {};   // circuit id -> sequence (all its fibres joined, for lookups)
  var traceSets = {}; // circuit id -> one sequence per fibre
  var gpath = {};    // graph key -> global path id

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fibreColour(cable, n) {
    var ts = cable.tube_size || 12;
    var i = ((n - 1) % ts) % 12;
    var t = Math.floor((n - 1) / ts) % 12;
    return { name: COLOURS[i][0], hex: COLOURS[i][1], tube: t + 1, tubeName: COLOURS[t][0], tubeHex: COLOURS[t][1] };
  }

  // ---- Model: a graph of fibre ends, panel ports (rear = splice side, front = patch side) and device ports ----
  function key() { return Array.prototype.join.call(arguments, '|'); }
  function parseKey(k) { var p = k.split('|'); return { node: p[0], t: p[1], el: p[2], n: isNaN(+p[3]) ? p[3] : +p[3] }; }

  function addEdge(a, b, e) {
    (adj[a] = adj[a] || []).push({ to: b, e: e });
    (adj[b] = adj[b] || []).push({ to: a, e: e });
  }

  function parseRef(s) {
    var i = s.lastIndexOf(':');
    var el = s.slice(0, i), r = s.slice(i + 1);
    var m = /^(\d+)-(\d+)$/.exec(r), list = [];
    if (m) { for (var k = +m[1]; k <= +m[2]; k++) list.push(k); } else list.push(/^\d+$/.test(r) ? +r : r);
    return { el: el, list: list };
  }

  function elKind(node, el) {
    if (net.cables[el]) return 'C';
    var i;
    for (i = 0; i < (node.panels || []).length; i++) if (node.panels[i].id === el) return 'P';
    for (i = 0; i < (node.devices || []).length; i++) if (node.devices[i].id === el) return 'D';
    return null;
  }

  function endKey(nid, node, el, n, kind) {
    var k = elKind(node, el);
    if (k === 'C') return key(nid, 'C', el, n);
    if (k === 'P') return key(nid, kind === 'patch' ? 'T' : 'R', el, n);
    if (k === 'D') return key(nid, 'D', el, n);
    return null;
  }

  function build() {
    Object.keys(net.cables).forEach(function (id) {
      var c = net.cables[id];
      for (var i = 1; i <= c.fibres; i++) addEdge(key(c.a, 'C', id, i), key(c.b, 'C', id, i), { t: 'cable', cable: id, fibre: i });
    });
    Object.keys(net.nodes).forEach(function (nid) {
      var node = net.nodes[nid];
      (node.panels || []).forEach(function (p) {
        for (var i = 1; i <= p.ports; i++) addEdge(key(nid, 'R', p.id, i), key(nid, 'T', p.id, i), { t: 'port' });
      });
      (node.joints || []).forEach(function (j) {
        var a = parseRef(j.a), b = parseRef(j.b);
        for (var i = 0; i < a.list.length && i < b.list.length; i++) {
          var ka = endKey(nid, node, a.el, a.list[i], j.kind), kb = endKey(nid, node, b.el, b.list[i], j.kind);
          if (ka && kb) addEdge(ka, kb, { t: j.kind, assumed: !!j.assumed, note: j.note || '', tray: j.tray || null });
        }
      });
    });
    // A circuit uses 1 fibre (BiDi optics) or 2 (one each way); 'start' is one point, or a list with one point per fibre.
    (net.circuits || []).forEach(function (c) {
      var starts = Array.isArray(c.start) ? c.start : [c.start];
      traceSets[c.id] = starts.map(function (s0) { return trace(startKey(s0)); });
      traces[c.id] = [].concat.apply([], traceSets[c.id]);
    });
    // Global path ids: everything joined by splices, patches, ports and cable fibres. Used to highlight one optical
    // path across every open splice diagram.
    var g = 0;
    Object.keys(adj).forEach(function (k0) {
      if (gpath[k0] !== undefined) return;
      var st = [k0], id = 'p' + (g++);
      while (st.length) {
        var kk = st.pop();
        if (gpath[kk] !== undefined) continue;
        gpath[kk] = id;
        (adj[kk] || []).forEach(function (x) { if (gpath[x.to] === undefined) st.push(x.to); });
      }
    });
  }

  function startKey(s) {   // "NODE/EL:n" -> graph key (panel ports start on the patch side)
    var i = s.indexOf('/');
    var nid = s.slice(0, i), r = parseRef(s.slice(i + 1));
    return endKey(nid, net.nodes[nid], r.el, r.list[0], 'patch');
  }

  function trace(start) {
    var seen = {}; seen[start] = 1;
    function walk(edge) {
      var steps = [];
      while (edge && !seen[edge.to]) {
        steps.push(edge); seen[edge.to] = 1;
        var next = (adj[edge.to] || []).filter(function (x) { return !seen[x.to]; });
        edge = next[0];
      }
      return steps;
    }
    var es = adj[start] || [];
    var d1 = es[0] ? walk(es[0]) : [];
    var d2 = es[1] && !seen[es[1].to] ? walk(es[1]) : [];
    var seq = [], i;
    for (i = d2.length - 1; i >= 0; i--) { seq.push({ key: d2[i].to }); seq.push({ edge: d2[i].e }); }
    seq.push({ key: start });
    d1.forEach(function (s) { seq.push({ edge: s.e }); seq.push({ key: s.to }); });
    // Orient upstream first: follow the first cable from its 'a' end to its 'b' end.
    for (i = 1; i < seq.length - 1; i++) {
      if (seq[i].edge && seq[i].edge.t === 'cable') {
        var from = parseKey(seq[i - 1].key).node;
        if (from === net.cables[seq[i].edge.cable].b) seq.reverse();
        break;
      }
    }
    return seq;
  }

  function seqCables(seq) {
    var ids = [];
    seq.forEach(function (s) { if (s.edge && s.edge.t === 'cable' && ids.indexOf(s.edge.cable) < 0) ids.push(s.edge.cable); });
    return ids;
  }

  // ---- Panel (overlay) ----
  var panel, body, title;
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'fx-panel';
    panel.innerHTML = '<div class="fx-head"><span class="fx-title"></span><button class="fx-close" title="Close">&times;</button></div><div class="fx-body"></div>';
    document.body.appendChild(panel);
    title = panel.querySelector('.fx-title');
    body = panel.querySelector('.fx-body');
    panel.querySelector('.fx-close').addEventListener('click', closePanel);
    L.DomEvent.disableClickPropagation(panel);
    L.DomEvent.disableScrollPropagation(panel);
  }
  function openPanel(t, html) {
    ensurePanel();
    title.textContent = t;
    body.innerHTML = html;
    body.scrollTop = 0; body.scrollLeft = 0;
    panel.classList.add('open');
    document.body.classList.add('panel-open');
  }
  function closePanel() {
    if (panel) panel.classList.remove('open');
    document.body.classList.remove('panel-open');
    window.SiteMap.clearHighlight();
  }

  // ---- Trace view ----
  function chip(cable, n) {
    var c = fibreColour(net.cables[cable], n);
    return '<span class="fx-chip' + (LIGHT[c.name] ? ' light' : '') + '" style="background:' + c.hex + '">' + c.name + '</span>';
  }

  function itemHtml(k) {
    var p = parseKey(k), node = net.nodes[p.node] || {};
    if (p.t === 'C') return '<div class="fx-item">' + esc(p.el) + ' fibre ' + p.n + ' ' + chip(p.el, p.n) + '</div>';
    if (p.t === 'R' || p.t === 'T') {
      var pn = (node.panels || []).filter(function (x) { return x.id === p.el; })[0] || {};
      return '<div class="fx-item port">' + esc(pn.connector ? pn.connector.split('/')[0] : 'Port') + ' ' + p.n +
        ' <span class="fx-sub">' + esc(pn.name || p.el) + '</span></div>';
    }
    var d = (node.devices || []).filter(function (x) { return x.id === p.el; })[0] || {};
    return '<div class="fx-item dev">' + esc(d.name || p.el) + ' <span class="fx-sub">port ' + esc(p.n) + '</span></div>';
  }

  function joinHtml(e) {
    var label = e.t === 'splice' ? 'fusion splice' + (e.tray ? ' (tray ' + esc(e.tray) + ')' : '') : e.t === 'patch' ? 'patch lead' : e.t === 'through' ? 'passes through, not cut' : '';
    if (!label) return '';
    return '<div class="fx-join ' + e.t + (e.assumed ? ' assumed' : '') + '">' + label + (e.assumed ? ' (assumed' + (e.note ? ': ' + esc(e.note) : '') + ')' : '') + '</div>';
  }

  function endNote(k, atStart) {
    var p = parseKey(k), node = net.nodes[p.node] || {};
    if (p.t === 'C') return node.documented ? '<div class="fx-end">Fibre not joined to anything here (spare)</div>'
      : '<div class="fx-end unknown">❓ ' + esc(node.name || p.node) + ' isn\'t documented yet, so the trace stops here</div>';
    if (p.t === 'T') return node.patching_documented === false
      ? '<div class="fx-end unknown">❓ Patching at ' + esc(node.name || p.node) + ' isn\'t recorded yet, so the trace stops here</div>'
      : '<div class="fx-end">Port not patched</div>';
    if (p.t === 'R') return '<div class="fx-end">Nothing spliced to this port</div>';
    return '<div class="fx-end">' + (atStart ? 'Starts' : 'Ends') + ' at this device</div>';
  }

  // The chambers and ducts a cable passes through, in the direction of travel (shown when 'Show chambers and ducts' is ticked).
  function routeHtml(c, fromNode) {
    var r = (c.route || []).slice();
    if (r.length < 3) return '<div class="fx-route"><span class="fx-sub">' + (c.route ? 'Direct, no chambers or ducts.' : '❓ Route through chambers and ducts not recorded.') + '</span></div>';
    if (fromNode && r[r.length - 1] === fromNode) r.reverse();
    var steps = r.slice(1, -1).map(function (id) {
      var inf = window.SiteMap.featureInfo(id) || {};
      if (String(id).indexOf('/') > 0) {
        return '<li class="duct"><a href="#" data-fx="feature" data-id="' + esc(String(id).split('/')[0]) + '">' + ICON.duct + ' ' + esc(id) + '</a>' +
          (inf.od_mm ? ' <span class="fx-sub">' + esc(inf.od_mm) + ' mm ' + esc([inf.colour, inf.type].filter(Boolean).join(' ')) + '</span>' : '') + '</li>';
      }
      return '<li class="chamber"><a href="#" data-fx="feature" data-id="' + esc(id) + '">' + iconFor(id) + ' ' + esc(id) + '</a>' + (inf.name && inf.name !== id ? ' <span class="fx-sub">' + esc(inf.name) + '</span>' : '') + '</li>';
    });
    return '<ol class="fx-route">' + steps.join('') + '</ol>';
  }

  function traceHtml(seq) {
    var html = '', i = 0;
    while (i < seq.length) {
      if (seq[i].edge) {   // a cable between nodes
        var e = seq[i].edge, c = net.cables[e.cable];
        var fromNode = i > 0 && seq[i - 1].key ? parseKey(seq[i - 1].key).node : null;
        html += '<div class="fx-cable"><div class="fx-line" style="border-color:' + fibreColour(c, e.fibre).hex + '"></div><div class="fx-clabel"><a href="#" data-fx="cable" data-id="' + esc(e.cable) + '">' + ICON.cable + ' <b>' +
          esc(e.cable) + '</b></a> fibre ' + e.fibre + ' ' + chip(e.cable, e.fibre) + '<br><span class="fx-sub">' + esc(c.name) + ', ' + c.fibres + 'F</span>' +
          routeHtml(c, fromNode) + '</div></div>';
        i++; continue;
      }
      var nid = parseKey(seq[i].key).node, node = net.nodes[nid] || { name: nid };
      var inner = '', first = i;
      if (i === 0) inner += endNote(seq[i].key, true);
      while (i < seq.length) {
        if (seq[i].key) {
          var pk = parseKey(seq[i].key);
          if (pk.node !== nid) break;
          // Merge rear+front of the same port into one line.
          var prev = i >= 2 && seq[i - 2].key ? parseKey(seq[i - 2].key) : null;
          if (!(prev && seq[i - 1].edge.t === 'port' && prev.el === pk.el && prev.n === pk.n)) inner += itemHtml(seq[i].key);
          i++;
        } else if (seq[i].edge.t !== 'cable') { inner += joinHtml(seq[i].edge); i++; } else break;
      }
      if (i >= seq.length && i - 1 !== first) inner += endNote(seq[i - 1].key, false);
      else if (i >= seq.length) inner += endNote(seq[i - 1].key, false);
      var onMap = window.SiteMap.hasFeature(nid);
      html += '<div class="fx-node"><div class="fx-nname">' +
        (onMap ? '<a href="#" data-fx="feature" data-id="' + esc(nid) + '">' + iconFor(nid) + ' ' + esc(node.name || nid) + '</a>' : esc(node.name || nid)) +
        (node.where ? '<span class="fx-sub">' + esc(node.where) + '</span>' : '') +
        '<span class="fx-nbtns">' +
        (onMap ? '<button class="fx-btn small" data-fx="feature" data-id="' + esc(nid) + '">📍 Details and photos</button>' : '') +
        (node.documented ? '<button class="fx-btn small" data-fx="splice" data-node="' + esc(nid) + '">🔀 Splice diagram</button>' : '') +
        '</span></div>' + inner + '</div>';
    }
    return '<div class="fx-trace">' + html + '</div>';
  }

  function wireTabs(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.fx-tab'), function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(root.querySelectorAll('.fx-tab'), function (x) { x.classList.toggle('on', x === t); });
        Array.prototype.forEach.call(root.querySelectorAll('.fx-pane'), function (p) { p.hidden = p.getAttribute('data-pane') !== t.getAttribute('data-tab'); });
      });
    });
  }
  function circuitInfo(c) {
    var n = c.fibres || (Array.isArray(c.start) ? c.start.length : 1);
    return n + (n === 1 ? ' fibre' : ' fibres') + (c.optics ? ' · ' + c.optics : '');
  }
  function traceBody(seq, cid) {
    var c = (net.circuits || []).filter(function (x) { return x.id === cid; })[0];
    var sets = (cid && traceSets[cid]) || [seq];
    var head = c ? '<p class="fx-note">' + esc(circuitInfo(c)) + '</p>' : '';
    var want = c && c.fibres ? c.fibres : sets.length;
    if (sets.length === 1 && want < 2) return head + traceHtml(sets[0]);
    return head + sets.map(function (s1, i) { return '<div class="fx-h">Fibre ' + (i + 1) + '</div>' + traceHtml(s1); }).join('') +
      (want > sets.length ? '<p class="fx-note">❓ ' + (want - sets.length) + ' more fibre' + (want - sets.length > 1 ? 's' : '') + ' not documented yet.</p>' : '');
  }
  window.FibreCircuitInfo = function (c) { return circuitInfo(c); };
  function showTrace(name, seq, cid) {
    var showRoutes = false;
    try { showRoutes = localStorage.getItem('fx-show-routes') === '1'; } catch (e) {}
    var tabs = cid ? '<div class="fx-tabs"><button class="fx-tab on" data-tab="optical">Optical path</button><button class="fx-tab" data-tab="schematic">📐 Schematic</button></div>' : '';
    var body = showView('trace:' + (cid || name), ICON.trace + ' ' + name, tabs + '<div class="fx-pane" data-pane="optical"><label class="fx-toggle"><input type="checkbox" class="fx-routes-toggle"' + (showRoutes ? ' checked' : '') + '> Show chambers and ducts along each cable</label>' +
      '<div class="fx-trace-wrap' + (showRoutes ? ' show-routes' : '') + '">' + traceBody(seq, cid) + '</div>' +
      '<p class="fx-note">Cables on this path are highlighted on the map. Dashed joints are assumed, not checked on site.</p></div>' +
      (cid ? '<div class="fx-pane" data-pane="schematic" hidden>' + circuitSchematic(cid) + '</div>' : ''));
    wireTabs(body);
    var cb = body.querySelector('.fx-routes-toggle');
    cb.addEventListener('change', function () {
      body.querySelector('.fx-trace-wrap').classList.toggle('show-routes', cb.checked);
      try { localStorage.setItem('fx-show-routes', cb.checked ? '1' : '0'); } catch (e) {}
    });
    window.SiteMap.highlightIds(seqCables(seq), true);
  }


  // ---- Schematic views (Nat, 2026-11-06: build all three to evaluate) ----
  // 1. Circuit schematic: the circuit's cables laid out in a straight line, with every chamber and duct on the way.
  // 2. Cable schematic: one cable's route the same way.
  // 3. Duct network: every chamber and duct as a clean node-and-line diagram, placed roughly where they are.
  function short(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function legsFromSeq(seq) {
    var legs = [];
    seq.forEach(function (st, i) {
      if (!st.edge || st.edge.t !== 'cable') return;
      var from = seq[i - 1] && seq[i - 1].key ? parseKey(seq[i - 1].key).node : null;
      var to = seq[i + 1] && seq[i + 1].key ? parseKey(seq[i + 1].key).node : null;
      var c = net.cables[st.edge.cable], r = (c.route || [from, to]).slice();
      if (r[0] !== from && r[r.length - 1] === from) r.reverse();
      legs.push({ cable: st.edge.cable, fibre: st.edge.fibre, route: r, known: !!c.route });
    });
    return legs;
  }
  function stripSvg(legs) {
    // Flatten the legs into nodes, with the duct (if any) on the link after each node.
    var nodes = [], links = [], bands = [];
    legs.forEach(function (lg) {
      var startIdx = null;
      lg.route.forEach(function (it) {
        if (String(it).indexOf('/') > 0) { links[nodes.length - 1] = { duct: it, known: lg.known }; return; }
        if (!nodes.length || nodes[nodes.length - 1] !== it) {
          if (nodes.length && !links[nodes.length - 1]) links[nodes.length - 1] = { duct: null, known: lg.known };
          nodes.push(it);
        }
        if (startIdx === null) startIdx = nodes.length - 1;
      });
      bands.push({ lg: lg, a: startIdx, b: nodes.length - 1 });
    });
    // Vertical: cables as bars on the left, the boxes down the middle, ducts named beside the links.
    var STEP = 62, BX = 130, BW = 170, BH = 36, W = 420, H = 16 + nodes.length * STEP, out = [];
    function cy(i) { return 14 + i * STEP + BH / 2; }
    links.forEach(function (l, i) {
      if (!l || i >= nodes.length - 1) return;
      var x = BX + BW / 2, y1 = cy(i) + BH / 2, y2 = cy(i + 1) - BH / 2;
      out.push('<line x1="' + x + '" y1="' + y1 + '" x2="' + x + '" y2="' + y2 + '" stroke="' + (l.duct ? '#90a4ae' : '#607d8b') + '" stroke-width="' + (l.duct ? 7 : 2) + '"' +
        (l.known ? '' : ' stroke-dasharray="4 3"') + '/>');
      var lbl = l.duct ? '⭕ ' + l.duct : l.known ? 'direct' : '❓ route not recorded';
      var inf = l.duct ? window.SiteMap.featureInfo(l.duct) || {} : {};
      out.push('<g' + (l.duct ? ' class="sc-link" data-fx="feature" data-id="' + esc(l.duct) + '"' : '') + '><text x="' + (x + 10) + '" y="' + ((y1 + y2) / 2 + 3) + '" font-size="10" fill="' + (l.duct ? '#cfd8dc' : '#90a4ae') + '">' + esc(lbl) +
        (inf.od_mm ? '<tspan fill="#90a4ae" font-size="9"> ' + esc(inf.od_mm + ' mm ' + [inf.colour, inf.type].filter(Boolean).join(' ')) + '</tspan>' : '') + '</text></g>');
    });
    bands.forEach(function (bd) {
      var lg = bd.lg, c = net.cables[lg.cable], col = lg.fibre ? fibreColour(c, lg.fibre).hex : '#ff9800';
      var y1 = cy(bd.a) - BH / 2 + 2, y2 = cy(bd.b) + BH / 2 - 2, my = (y1 + y2) / 2;
      out.push('<g class="sc-link" data-fx="cable" data-id="' + esc(lg.cable) + '"><rect x="12" y="' + y1 + '" width="12" height="' + (y2 - y1) + '" rx="6" fill="' + col + '" stroke="#90a4ae" stroke-width="1"/>' +
        '<text x="32" y="' + (my - 3) + '" font-size="11" font-weight="bold" fill="#eceff1">🧵 ' + esc(lg.cable) + '</text>' +
        '<text x="32" y="' + (my + 10) + '" font-size="9.5" fill="#b0bec5">' + esc(lg.fibre ? 'fibre ' + lg.fibre + ' ' + fibreColour(c, lg.fibre).name : c.fibres + ' fibres') + '</text></g>');
    });
    nodes.forEach(function (id, i) {
      var inf = window.SiteMap.featureInfo(id) || {}, nd = net.nodes[id], y = cy(i) - BH / 2;
      var isCh = ['manhole', 'chamber', 'valve_box', 'draw_pit'].indexOf(inf.type) >= 0;
      var act = nd && nd.documented ? 'data-fx="splice" data-node="' + esc(id) + '"' : window.SiteMap.hasFeature(id) ? 'data-fx="feature" data-id="' + esc(id) + '"' : '';
      out.push('<g class="sc-node' + (act ? ' sc-link' : '') + '" ' + act + '><rect x="' + BX + '" y="' + y + '" width="' + BW + '" height="' + BH + '" rx="' + (isCh ? 2 : 9) + '" fill="' + (isCh ? '#263238' : '#1e3a5f') +
        '" stroke="' + (isCh ? '#90a4ae' : '#64b5f6') + '" stroke-width="1.5"/>' +
        '<text x="' + (BX + 8) + '" y="' + (y + 15) + '" font-size="11" font-weight="bold" fill="#eceff1">' + esc((iconFor(id) || (nd ? ICON.box : '❓')) + ' ' + id) + '</text>' +
        '<text x="' + (BX + 8) + '" y="' + (y + 28) + '" font-size="9.5" fill="#b0bec5">' + esc(short(inf.name || (nd && nd.name) || '', 30)) + '</text></g>');
    });
    return '<div class="fx-schem-wrap"><svg class="fx-schem" xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">' + out.join('') + '</svg></div>';
  }
  function circuitSchematic(cid) {
    var sets = traceSets[cid] || [];
    return sets.map(function (sq, i) {
      return (sets.length > 1 ? '<div class="fx-h">Fibre ' + (i + 1) + '</div>' : '') + stripSvg(legsFromSeq(sq));
    }).join('') + '<p class="fx-note">Rounded blue boxes are enclosures and buildings; square grey boxes are chambers. Thick grey lines are ducts, thin lines direct runs; dashed means the route isn\'t recorded. Tap anything to open it.</p>';
  }
  function cableSchematic(id) {
    var c = net.cables[id];
    return stripSvg([{ cable: id, fibre: null, route: (c.route || [c.a, c.b]).slice(), known: !!c.route }]);
  }

  function networkSchematic() {
    var feats = window.SiteMap.allFeatures();
    var CH = ['manhole', 'chamber', 'valve_box', 'draw_pit'];
    var pos = {}, used = {};
    feats.forEach(function (f) { pos[f.id] = f; });
    var edges = [];
    feats.forEach(function (f) {
      if (f.props.type !== 'duct') return;
      var ends = f.id.split('-');
      if (ends.length !== 2 || !pos[ends[0]] || !pos[ends[1]]) return;
      var cs = [];
      (f.props.ducts || []).forEach(function (d) {
        Object.keys(net.cables).forEach(function (cid) { if ((net.cables[cid].route || []).indexOf(d.id) >= 0 && cs.indexOf(cid) < 0) cs.push(cid); });
      });
      edges.push({ a: ends[0], b: ends[1], id: f.id, n: (f.props.ducts || []).length, cables: cs, duct: true });
      used[ends[0]] = used[ends[1]] = 1;
    });
    // Direct runs in cable routes (no duct between two points), e.g. a chamber into a building or enclosure.
    Object.keys(net.cables).forEach(function (cid) {
      var r = net.cables[cid].route || [];
      for (var i = 0; i < r.length - 1; i++) {
        if (String(r[i]).indexOf('/') > 0 || String(r[i + 1]).indexOf('/') > 0) continue;
        if (!pos[r[i]] || !pos[r[i + 1]]) continue;
        var ex = edges.filter(function (e) { return !e.duct && ((e.a === r[i] && e.b === r[i + 1]) || (e.a === r[i + 1] && e.b === r[i])); })[0];
        if (ex) { if (ex.cables.indexOf(cid) < 0) ex.cables.push(cid); continue; }
        edges.push({ a: r[i], b: r[i + 1], cables: [cid], duct: false });
        used[r[i]] = used[r[i + 1]] = 1;
      }
    });
    feats.forEach(function (f) { if (CH.indexOf(f.props.type) >= 0) used[f.id] = 1; });
    var ids = Object.keys(used);
    if (!ids.length) return '<p class="fx-note">No chambers or ducts on the map yet.</p>';
    // Project to a flat plane, fit to the canvas, then push apart anything closer than a box.
    var lat0 = ids.reduce(function (t, k) { return t + pos[k].lat; }, 0) / ids.length, k0 = Math.cos(lat0 * Math.PI / 180);
    var P = {}, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    ids.forEach(function (k) { var x = pos[k].lng * k0, y = -pos[k].lat; P[k] = { x: x, y: y }; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    var W = 760, H = 560, M = 60, sc = Math.min((W - 2 * M) / ((maxX - minX) || 1), (H - 2 * M) / ((maxY - minY) || 1));
    ids.forEach(function (k) { P[k].x = M + (P[k].x - minX) * sc; P[k].y = M + (P[k].y - minY) * sc; });
    for (var it = 0; it < 200; it++) {
      ids.forEach(function (a) {
        ids.forEach(function (b) {
          if (a >= b) return;
          var dx = P[b].x - P[a].x, dy = P[b].y - P[a].y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, need = 105;
          if (d < need) {
            var push = (need - d) / 2 / d;
            P[a].x -= dx * push; P[a].y -= dy * push; P[b].x += dx * push; P[b].y += dy * push;
          }
        });
      });
    }
    minX = 1e9; maxX = -1e9; minY = 1e9; maxY = -1e9;
    ids.forEach(function (k) { minX = Math.min(minX, P[k].x); maxX = Math.max(maxX, P[k].x); minY = Math.min(minY, P[k].y); maxY = Math.max(maxY, P[k].y); });
    ids.forEach(function (k) { P[k].x += 50 - minX; P[k].y += 30 - minY; });
    W = Math.ceil(maxX - minX + 100); H = Math.ceil(maxY - minY + 70);
    var out = [];
    edges.forEach(function (e) {
      var a = P[e.a], b = P[e.b], col = e.cables.length ? '#ffb300' : '#78909c';
      out.push('<g class="sc-link" ' + (e.duct ? 'data-fx="feature" data-id="' + esc(e.id) + '"' : 'data-fx="cable" data-id="' + esc(e.cables[0]) + '"') + '>' +
        '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="transparent" stroke-width="14"/>' +
        '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + col + '" stroke-width="' + (e.duct ? 5 : 2) + '" stroke-linecap="round"' + (e.duct ? '' : ' stroke-dasharray="5 4"') + '/>');
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var lbl = (e.duct ? '⭕' + (e.n > 1 ? '×' + e.n : '') + ' ' : '') + (e.cables.length ? e.cables.join(' ') : 'empty');
      out.push('<rect x="' + (mx - lbl.length * 2.9 - 4) + '" y="' + (my - 8) + '" width="' + (lbl.length * 5.8 + 8) + '" height="15" rx="7" fill="#111a22" opacity="0.9"/>' +
        '<text x="' + mx + '" y="' + (my + 3) + '" text-anchor="middle" font-size="9.5" fill="' + (e.cables.length ? '#ffe082' : '#90a4ae') + '">' + esc(lbl) + '</text></g>');
    });
    ids.forEach(function (k) {
      var f = pos[k], p = P[k], isCh = CH.indexOf(f.props.type) >= 0, nd = net.nodes[k];
      var act = nd && nd.documented ? 'data-fx="splice" data-node="' + esc(k) + '"' : 'data-fx="feature" data-id="' + esc(k) + '"';
      out.push('<g class="sc-node sc-link" ' + act + '><rect x="' + (p.x - 34) + '" y="' + (p.y - 13) + '" width="68" height="26" rx="' + (isCh ? 2 : 8) + '" fill="' + (isCh ? '#263238' : '#1e3a5f') +
        '" stroke="' + (isCh ? '#90a4ae' : '#64b5f6') + '" stroke-width="1.5"/>' +
        '<text x="' + p.x + '" y="' + (p.y - 1) + '" text-anchor="middle" font-size="10" font-weight="bold" fill="#eceff1">' + esc(short(k, 10)) + '</text>' +
        '<text x="' + p.x + '" y="' + (p.y + 9) + '" text-anchor="middle" font-size="7.5" fill="#b0bec5">' + esc(short(f.props.name, 16)) + '</text></g>');
    });
    return '<div class="fx-schem-wrap"><svg class="fx-schem fit" xmlns="http://www.w3.org/2000/svg" style="max-width:' + W + 'px" viewBox="0 0 ' + W + ' ' + H + '" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">' + out.join('') + '</svg></div>' +
      '<p class="fx-note">Every chamber and duct, placed roughly where it is and spread out to read. Square grey boxes are chambers, rounded blue boxes enclosures and buildings. Thick lines are duct routes (⭕×2 = two ducts), dashed lines direct runs; amber lines carry the cables named on them, grey ones are empty. Tap anything to open it.</p>';
  }
  function showNetworkSchematic() {
    showView('schematic:network', '📐 Duct network schematic', networkSchematic(), { cls: 'huge' });
  }

  // ---- Splice diagram (SVG) ----
  var RH = 13, HH = 17, GAP = 8;   // compact: row height, header height, gap between blocks

  function svgText(x, y, s, opt) {
    opt = opt || {};
    return '<text x="' + x + '" y="' + y + '"' + (opt.anchor ? ' text-anchor="' + opt.anchor + '"' : '') +
      ' fill="' + (opt.fill || '#222') + '"' + (opt.bold ? ' font-weight="bold"' : '') + (opt.size ? ' font-size="' + opt.size + '"' : '') + '>' + esc(s) + '</text>';
  }

  function used(nid) {   // set of element ends used inside this node
    var u = {};
    (adj ? Object.keys(adj) : []).forEach(function (k) {
      if (k.indexOf(nid + '|') !== 0) return;
      adj[k].forEach(function (x) { if (x.e.t === 'splice' || x.e.t === 'patch' || x.e.t === 'through') u[k] = x; });
    });
    return u;
  }

  function spliceSvg(nid) {
    var node = net.nodes[nid];
    // Connected paths inside this enclosure (splices, port pass-through, patches), so hovering any part
    // of a path can highlight all of it: fibre, splice, socket, port label, patch lead, device port.
    var comp = {}, nextComp = 0;
    Object.keys(adj).forEach(function (k0) {
      if (k0.indexOf(nid + '|') !== 0 || comp[k0] !== undefined) return;
      var stack = [k0], c0 = nextComp++;
      while (stack.length) {
        var kk = stack.pop();
        if (comp[kk] !== undefined) continue;
        comp[kk] = c0;
        (adj[kk] || []).forEach(function (x) { if (x.e.t !== 'cable' && comp[x.to] === undefined) stack.push(x.to); });
      }
    });
    function cOf(k) { return gpath[k] !== undefined ? gpath[k] : nid + '-' + (comp[k] !== undefined ? comp[k] : (comp[k] = nextComp++)); }
    var cablesHere = Object.keys(net.cables).filter(function (id) { return net.cables[id].a === nid || net.cables[id].b === nid; });
    var lay = node.layout || {};
    var left = (lay.left || []).filter(function (id) { return cablesHere.indexOf(id) >= 0; });
    var right = (lay.right || []).filter(function (id) { return cablesHere.indexOf(id) >= 0; });
    if ((node.panels || []).length || (node.devices || []).length) {
      // Cables landing on a panel all enter from the left (in layout order), so patch leads have the right-hand side to themselves.
      left = left.concat(right); right = [];
      cablesHere.forEach(function (id) { if (left.indexOf(id) < 0) left.push(id); });
      // Order cables by the first panel row they land on, so splice lines cross as little as possible.
      var firstRow = function (id) {
        var best = 1e9, row = 0;
        (node.panels || []).forEach(function (p) {
          for (var n = 1; n <= p.ports; n++, row++) {
            var k = key(nid, 'R', p.id, n);
            if ((adj[k] || []).some(function (x) { return x.e.t === 'splice' && parseKey(x.to).el === id; })) best = Math.min(best, row);
          }
        });
        return best;
      };
      left.sort(function (a, b) { return firstRow(a) - firstRow(b); });
    } else {
      cablesHere.forEach(function (id) { if (left.indexOf(id) < 0 && right.indexOf(id) < 0) (left.length <= right.length ? left : right).push(id); });
    }
    var panels = node.panels || [], devices = node.devices || [];
    var hasMid = panels.length || devices.length;
    var TW = 96, MW = 190, LANE = 32, GX = 64, NW = 22;
    var xL = 8, xM = xL + TW + GX, xR = hasMid ? xM + MW + GX : xL + TW + 200;
    if (!right.length) xR = xM + MW;
    var W = (right.length ? xR + TW : xM + (hasMid ? MW : 0)) + 8;
    var anchor = {};   // graph key -> {x, y, side}
    var out = [], lines = [], arcs = [];
    var u = used(nid);

    function cableTable(id, x, y, side) {
      var c = net.cables[id], other = c.a === nid ? c.b : c.a;
      var ts = c.tube_size || 12;
      var h = HH + c.fibres * RH;
      // Header: cable ID, size and where its other end goes
      var on = (net.nodes[other] || {}).name || other;
      if (on.length > 15) on = on.slice(0, 14) + '…';
      // The far end is a link: its splice diagram if documented, otherwise its place on the map.
      var od = (net.nodes[other] || {}).documented, onMap = window.SiteMap.hasFeature(other);
      var act = od ? 'data-fx="splice" data-node="' + esc(other) + '"' : onMap ? 'data-fx="feature" data-id="' + esc(other) + '"' : '';
      var anc = side === 'L' ? 'start' : 'end', tx = side === 'L' ? x : x + TW;
      out.push('<text x="' + tx + '" y="' + (y + 12) + '" text-anchor="' + anc + '" font-size="9" font-weight="bold" fill="#222">' + esc(id + ' · ' + c.fibres + 'F → ') +
        (act ? '<tspan class="fx-svglink" ' + act + '>' + esc(on) + (od ? ' 🔀' : ' 📍') + '</tspan>' : '<tspan>' + esc(on) + '</tspan>') + '</text>');
      // Sheath: one rounded block per tube, in the tube colour (grey for a single-tube cable)
      var sx = side === 'L' ? x : x + TW - 16;
      for (var t = 0; t * ts < c.fibres; t++) {
        var n0 = t * ts, n1 = Math.min(c.fibres, n0 + ts);
        var tc = c.fibres > ts ? COLOURS[t % 12][1] : '#b0bec5';
        out.push('<rect x="' + sx + '" y="' + (y + HH + n0 * RH - 2) + '" width="16" height="' + ((n1 - n0) * RH + 4) + '" rx="6" fill="' + tc + '" stroke="#455a64"/>');
      }
      // Fibre pills
      var px = side === 'L' ? x + 18 : x, pw = TW - 18;
      for (var i = 1; i <= c.fibres; i++) {
        var fc = fibreColour(c, i), ry = y + HH + (i - 1) * RH;
        var k = key(nid, 'C', id, i), isUsed = !!u[k];
        out.push('<g class="fxe" data-c="' + cOf(k) + '"><rect class="pill" x="' + px + '" y="' + (ry + 1) + '" width="' + pw + '" height="' + (RH - 2) + '" rx="4" fill="' + fc.hex + '" stroke="#333" stroke-width="0.6"' +
          (isUsed ? '' : ' fill-opacity="0.35"') + '/>' +
          svgText(px + pw / 2, ry + 10, i + ' ' + fc.name + (isUsed ? '' : ' (spare)'), { anchor: 'middle', fill: LIGHT[fc.name] || !isUsed ? '#222' : '#fff', size: 9 }) + '</g>');
        anchor[k] = { x: side === 'L' ? x + TW : x, y: ry + RH / 2, side: side };
      }
      return h;
    }

    function midBox(label, rows, x, y, kindKey) {   // panel or device: rows = [{n, text, keyRear, keyFront}]
      var h = HH + rows.length * RH;
      out.push('<rect x="' + x + '" y="' + y + '" width="' + MW + '" height="' + h + '" fill="#fff" stroke="#555"/>');
      out.push('<rect x="' + x + '" y="' + y + '" width="' + MW + '" height="' + HH + '" fill="' + (kindKey === 'D' ? '#e8eaf6' : '#eceff1') + '" stroke="#555"/>');
      out.push(svgText(x + MW / 2, y + 12, label.length > 38 ? label.slice(0, 36) + '…' : label, { anchor: 'middle', bold: true, size: 9 }));
      rows.forEach(function (r, i) {
        var ry = y + HH + i * RH;
        if (r.gap) {
          out.push('<rect x="' + x + '" y="' + ry + '" width="' + MW + '" height="' + RH + '" fill="#f3f3f3" stroke="#ccc" stroke-width="0.5"/>' +
            svgText(x + NW / 2, ry + 10, '⋮', { anchor: 'middle', size: 10, fill: '#888' }) + svgText(x + NW + 5, ry + 10, r.text.replace(/^⋮\s*/, ''), { size: 9, fill: '#888' }));
          return;
        }
        // [socket n][port description ........][patch lane]: splices arrive on the left edge, patch leads loop on the right.
        out.push('<g class="fxe row" data-c="' + cOf(r.keyRear || r.keyFront) + '">' +
          '<rect class="rowbg" x="' + (x + NW) + '" y="' + ry + '" width="' + (MW - NW - LANE) + '" height="' + RH + '" fill="#fff"/>' +
          '<rect class="sock" x="' + x + '" y="' + ry + '" width="' + NW + '" height="' + RH + '" fill="#fafafa" stroke="#555" stroke-width="0.5"/>' +
          svgText(x + NW / 2, ry + 10, r.n, { anchor: 'middle', size: 9 }) +
          '<rect x="' + (x + MW - LANE) + '" y="' + ry + '" width="' + LANE + '" height="' + RH + '" fill="#fffdf2" stroke="#ddd" stroke-width="0.5"/>' +
          svgText(x + NW + 5, ry + 10, r.text || '', { size: 9, fill: '#333' }) + '</g>');
        if (r.keyRear) anchor[r.keyRear] = { x: x, xr: x + MW, y: ry + RH / 2, side: 'M' };
        if (r.keyFront) anchor[r.keyFront] = { x: x + MW - LANE + 6, y: ry + RH / 2, side: 'F' };
      });
      return h;
    }

    // Layout columns
    var yl = 24, yr = 24, ym = 24;
    left.forEach(function (id) { yl += cableTable(id, xL, yl, 'L') + GAP; });
    right.forEach(function (id) { yr += cableTable(id, xR, yr, 'R') + GAP; });
    panels.forEach(function (p) {
      var labels = {};
      Object.keys(p.labels || {}).forEach(function (r) { parseRef('x:' + r).list.forEach(function (n) { labels[n] = p.labels[r]; }); });
      var rows = [];
      // A port is in use if something is spliced or patched to it, or it has a label.
      var usedPort = function (n) {
        if (labels[n]) return true;
        return [key(nid, 'R', p.id, n), key(nid, 'T', p.id, n)].some(function (kk) {
          return (adj[kk] || []).some(function (x) { return x.e.t !== 'port'; });
        });
      };
      // Runs of more than 4 unused ports collapse to: first 2, a "⋮" row, last 2.
      var n0 = 1;
      while (n0 <= p.ports) {
        if (usedPort(n0)) { rows.push({ n: n0, text: labels[n0] || '', keyRear: key(nid, 'R', p.id, n0), keyFront: key(nid, 'T', p.id, n0) }); n0++; continue; }
        var n1 = n0; while (n1 + 1 <= p.ports && !usedPort(n1 + 1)) n1++;
        var run = n1 - n0 + 1;
        for (var q = n0; q <= n1; q++) {
          if (run > 4 && q === n0 + 2) { rows.push({ gap: true, text: '⋮  ' + (n0 + 2) + '–' + (n1 - 2) + ' not used (' + (run - 4) + ')' }); q = n1 - 1; }
          rows.push({ n: q, text: '', keyRear: key(nid, 'R', p.id, q), keyFront: key(nid, 'T', p.id, q) });
        }
        n0 = n1 + 1;
      }
      ym += midBox(p.name, rows, xM, ym, 'P') + GAP;
    });
    devices.forEach(function (d) {
      var rows = (d.ports || []).map(function (pt) { return { n: '', text: pt, keyRear: key(nid, 'D', d.id, pt), keyFront: key(nid, 'D', d.id, pt) }; });
      ym += midBox(d.name, rows, xM, ym, 'D') + GAP;
    });
    var H = Math.max(yl, yr, ym, 60) + 14;

    // Joints
    var done = {}, patchNo = 0;
    Object.keys(anchor).forEach(function (k) {
      (adj[k] || []).forEach(function (x) {
        var e = x.e;
        if (e.t !== 'splice' && e.t !== 'patch' && e.t !== 'through') return;
        var id = [k, x.to].sort().join('~');
        if (done[id]) return; done[id] = 1;
        var a = anchor[k], b = anchor[x.to];
        if (!a || !b) return;
        var dash = e.assumed ? ' stroke-dasharray="5 4"' : e.t === 'through' ? ' stroke-dasharray="1 0"' : '';
        if (e.t === 'patch') {
          var lx = Math.min(a.x, b.x), bulge = 6 + (patchNo++ % 5) * 4.5;
          var pd = 'M' + lx + ',' + a.y + ' C' + (lx + bulge) + ',' + a.y + ' ' + (lx + bulge) + ',' + b.y + ' ' + lx + ',' + b.y;
          var nameOf = function (kk) {
            var q = parseKey(kk);
            if (q.t === 'D') { var dv = (node.devices || []).filter(function (x) { return x.id === q.el; })[0] || {}; return (dv.name || q.el) + ' ' + q.n; }
            var pn = (node.panels || []).filter(function (x) { return x.id === q.el; })[0] || {};
            return (pn.connector || 'port').split('/')[0] + ' ' + q.n;
          };
          // One group per patch lead: a wide invisible hit area, the lead itself and its two plugs. Hover (or tap) highlights it.
          arcs.push('<g class="fx-patch fxe" data-c="' + cOf(k) + '"><title>Patch lead: ' + esc(nameOf(k)) + ' ↔ ' + esc(nameOf(x.to)) + (e.assumed ? ' (assumed)' : '') + '</title>' +
            '<path class="hit" d="' + pd + '" fill="none" stroke="transparent" stroke-width="12"/>' +
            '<path class="vis" d="' + pd + '" fill="none" stroke="' + PATCH + '" stroke-width="3"' + dash + '/>' +
            '<circle cx="' + lx + '" cy="' + a.y + '" r="2.5" fill="#8a6d00"/><circle cx="' + lx + '" cy="' + b.y + '" r="2.5" fill="#8a6d00"/></g>');
          return;
        }
        // splice: colour of the fibre end involved
        var fk = parseKey(k).t === 'C' ? k : x.to, fp = parseKey(fk);
        var col = parseKey(fk).t === 'C' ? fibreColour(net.cables[fp.el], fp.n) : { hex: '#555', name: '' };
        function pt(p, other) {
          if (p.side === 'M') return { x: other.x < p.x ? p.x : p.xr, y: p.y };
          return { x: p.x, y: p.y };
        }
        var pa = pt(a, b), pb = pt(b, a);
        var mx = (pa.x + pb.x) / 2;
        var d = 'M' + pa.x + ',' + pa.y + ' C' + mx + ',' + pa.y + ' ' + mx + ',' + pb.y + ' ' + pb.x + ',' + pb.y;
        // Layers of one splice line: an orange halo (only shown when highlighted), a dark casing for light colours
        // (white, yellow, rose, aqua) so they show on white, then the fibre colour itself.
        lines.push('<g class="fxe" data-c="' + cOf(k) + '"><path class="hit" d="' + d + '" fill="none" stroke="transparent" stroke-width="10"/>' +
          '<path class="halo" d="' + d + '" fill="none" stroke="transparent" stroke-width="8" stroke-linecap="round"/>');
        if (LIGHT[col.name] || e.t === 'through') lines.push('<path class="ln-case" d="' + d + '" fill="none" stroke="#555" stroke-width="' + (e.t === 'through' ? 5 : 3.6) + '"' + dash + '/>');
        lines.push('<path class="ln" d="' + d + '" fill="none" stroke="' + col.hex + '" stroke-width="' + (e.t === 'through' ? 3 : 2.2) + '"' + dash + '/>');
        if (e.t === 'splice') {   // splice mark (and tray number) at the midpoint
          var my = (pa.y + pb.y) / 2;
          lines.push('<rect x="' + (mx - 4) + '" y="' + (my - 4) + '" width="8" height="8" rx="1.5" fill="#fff" stroke="#333"/>');
          if (e.tray) lines.push(svgText(mx + 7, my + 3, 'T' + e.tray, { size: 8, fill: '#555' }));
        }
        lines.push('</g>');
      });
    });

    var head = svgText(8, 14, node.name || nid, { bold: true, size: 11 });
    var legend = svgText(8, H - 8, 'Coloured lines: fusion splices (□ = splice, T = tray) · thick lines: express fibres, not cut · yellow loops: LC patch leads · dashed: assumed', { size: 8, fill: '#666' });
    return '<svg class="fx-svg" xmlns="http://www.w3.org/2000/svg" style="max-width:' + W + 'px" viewBox="0 0 ' + W + ' ' + H +
      '" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">' + '<rect width="100%" height="100%" fill="#fff"/>' + head + '<g class="L-lines">' + lines.join('') + '</g><g class="L-boxes">' + out.join('') + '</g><g class="L-patches">' + arcs.join('') + '</g>' + legend + '</svg>';
  }

  function circuitsAt(nid) {
    return (net.circuits || []).filter(function (c) { return traces[c.id].some(function (s) { return s.key && parseKey(s.key).node === nid; }); });
  }
  function circuitsOn(cable) {
    return (net.circuits || []).filter(function (c) { return seqCables(traces[c.id]).indexOf(cable) >= 0; });
  }
  function traceButtons(list) {
    return list.map(function (c) { return '<button class="fx-btn" data-fx="trace" data-circuit="' + esc(c.id) + '">🧭 ' + esc(c.name) + '</button>'; }).join('');
  }

  // Highlighting is shared by every splice diagram on screen: hovering a path in one lights it up in all of them.
  var hlLocked = null;
  function markAll(c) {
    Array.prototype.forEach.call(document.querySelectorAll('.fx-svg .fxe'), function (g) {
      var on = c !== null && g.getAttribute('data-c') === c;
      g.classList.toggle('hl', on);
      // Bring highlighted parts to the front of their own layer only (splice lines < fibres and ports < patch leads).
      if (on && g.parentNode && !g.classList.contains('row')) g.parentNode.appendChild(g);
    });
  }
  function wirePatchHover(container) {
    var svg = container && container.querySelector('.fx-svg');
    if (!svg || svg._wired) return;
    svg._wired = true;
    Array.prototype.forEach.call(svg.querySelectorAll('.fxe'), function (g) {
      g.addEventListener('mouseenter', function () { if (hlLocked === null) markAll(g.getAttribute('data-c')); });
      g.addEventListener('mouseleave', function () { if (hlLocked === null) markAll(null); });
      g.addEventListener('click', function (ev) {   // tap (phones) or click locks the highlight; again to clear
        ev.stopPropagation();
        var c = g.getAttribute('data-c');
        hlLocked = hlLocked === c ? null : c;
        markAll(hlLocked);
      });
    });
    if (hlLocked !== null) markAll(hlLocked);
  }

  // ---- Floating windows for splice diagrams (wide screens): one per enclosure, draggable, resizable, stay open ----
  var wins = {}, zTop = 1100, winCount = 0;
  function frontWin(w) { w.style.zIndex = ++zTop; }
  function openWin(id, title, html, opt) {
    opt = opt || {};
    if (wins[id]) {
      var ow = wins[id];
      if (opt.update) { ow.querySelector('.fx-win-title').textContent = title; ow.querySelector('.fx-win-body').innerHTML = html; }
      if (opt.render) ow._render = opt.render;
      frontWin(ow);
      ow.classList.remove('flash'); void ow.offsetWidth; ow.classList.add('flash');
      return ow;
    }
    var w = document.createElement('div');
    w.className = 'fx-win' + (opt.cls ? ' ' + opt.cls : '');
    if (opt.render) w._render = opt.render;
    w.innerHTML = '<div class="fx-win-head"><span class="fx-win-title"></span><button class="fx-close" title="Close">&times;</button></div><div class="fx-win-body"></div>';
    w.querySelector('.fx-win-title').textContent = title;
    w.querySelector('.fx-win-body').innerHTML = html;
    // Place new windows side by side from the right, then cascade down.
    document.body.appendChild(w);
    var ww = w.offsetWidth, n = winCount++ % 6, cols = Math.max(1, Math.floor((window.innerWidth - 60) / (ww + 10)));
    w.style.left = Math.max(10, window.innerWidth - ww - 20 - (n % cols) * (ww + 10)) + 'px';
    w.style.top = (54 + Math.floor(n / cols) * 40) + 'px';
    frontWin(w);
    wins[id] = w;
    L.DomEvent.disableClickPropagation(w);
    L.DomEvent.disableScrollPropagation(w);
    w.addEventListener('mousedown', function () { frontWin(w); });
    w.querySelector('.fx-close').addEventListener('click', function () {
      w.parentNode.removeChild(w); delete wins[id];
      if (!Object.keys(wins).length && !(panel && panel.classList.contains('open'))) window.SiteMap.clearHighlight();
    });
    w.addEventListener('keydown', function (e) { if (e.key === 'Escape') w.querySelector('.fx-close').click(); });
    // Drag by the title bar.
    var head = w.querySelector('.fx-win-head');
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      var sx = e.clientX, sy = e.clientY, ox = w.offsetLeft, oy = w.offsetTop;
      head.setPointerCapture(e.pointerId);
      function mv(ev) {
        w.style.left = Math.min(window.innerWidth - 60, Math.max(-w.offsetWidth + 80, ox + ev.clientX - sx)) + 'px';
        w.style.top = Math.min(window.innerHeight - 30, Math.max(0, oy + ev.clientY - sy)) + 'px';
      }
      function up() { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); }
      head.addEventListener('pointermove', mv);
      head.addEventListener('pointerup', up);
    });
    return w;
  }

  // Every view (feature details, cables, circuits, splices) opens in a window that stays open until closed:
  // floating, draggable and resizable on wide screens; the bottom panel on phones.
  function showView(key, t, html, opt) {
    if (window.innerWidth > 700) return openWin(key, t, html, L.extend({ update: true }, opt || {})).querySelector('.fx-win-body');
    openPanel(t, html);
    if (opt && opt.render) panel._render = opt.render; else if (panel) panel._render = null;
    return body;
  }
  function refreshViews() {
    Object.keys(wins).forEach(function (k) { var w = wins[k]; if (w._render) w.querySelector('.fx-win-body').innerHTML = w._render(); });
    if (panel && panel.classList.contains('open') && panel._render) body.innerHTML = panel._render();
  }
  window.FxWin = { show: showView, refresh: refreshViews };

  function showSplices(nid) {
    var node = net.nodes[nid];
    var html;
    if (!node.documented) {
      html = '<p class="fx-note">❓ What happens inside ' + esc(node.name || nid) + ' isn\'t documented yet.' + (node.notes ? ' ' + esc(node.notes) : '') + '</p>';
    } else {
      html = '<div class="fx-scroll">' + spliceSvg(nid) + '</div>' +
        '<p class="fx-note">Scroll sideways on a phone. Use a trace below to follow one circuit end to end.</p>';
    }
    // Jump buttons: this enclosure on the map, and the splice diagrams at the other end of each cable.
    var others = [];
    Object.keys(net.cables).forEach(function (id) {
      var c = net.cables[id];
      if (c.a === nid && others.indexOf(c.b) < 0) others.push(c.b);
      if (c.b === nid && others.indexOf(c.a) < 0) others.push(c.a);
    });
    var jump = (window.SiteMap.hasFeature(nid) ? '<button class="fx-btn small" data-fx="feature" data-id="' + esc(nid) + '">📍 Details and photos</button>' : '') +
      others.map(function (o) {
        var on2 = net.nodes[o] || {}, nm = on2.name || o;
        if (on2.documented) return '<button class="fx-btn small" data-fx="splice" data-node="' + esc(o) + '">🔀 ' + esc(nm) + '</button>';
        if (window.SiteMap.hasFeature(o)) return '<button class="fx-btn small" data-fx="feature" data-id="' + esc(o) + '">📍 ' + esc(nm) + ' (not documented)</button>';
        return '<span class="fx-sub">' + esc(nm) + ' (not documented)</span>';
      }).join('');
    html = '<div class="fx-btns" style="margin:0 0 8px">' + jump + '</div>' + html;
    var cs = circuitsAt(nid);
    if (cs.length) html += '<div class="fx-btns"><div class="fx-sub">Trace a circuit through here:</div>' + traceButtons(cs) + '</div>';
    var sb = showView('splice:' + nid, ICON.splice + ' Splices: ' + (node.name || nid), html, { cls: 'big', update: false });
    wirePatchHover(sb.parentNode);
    var ids = Object.keys(net.cables).filter(function (id) { return net.cables[id].a === nid || net.cables[id].b === nid; });
    window.SiteMap.highlightIds(ids, false);
  }

  // ---- Cable view: every fibre, what it joins at each end, and the circuit it carries ----
  function endDesc(nid, cable, n) {
    var node = net.nodes[nid] || { name: nid };
    var k = key(nid, 'C', cable, n);
    var j = (adj[k] || []).filter(function (x) { return x.e.t !== 'cable'; })[0];
    if (!j) return node.documented ? '<span class="fx-sub">spare</span>' : '<span class="fx-sub">❓ not documented</span>';
    var p = parseKey(j.to), txt;
    if (p.t === 'C') txt = (j.e.t === 'through' ? 'continues as ' : 'spliced to ') + p.el + ' fibre ' + p.n + ' ' + chip(p.el, p.n);
    else if (p.t === 'R') {
      var pn = (node.panels || []).filter(function (x) { return x.id === p.el; })[0] || {};
      txt = 'spliced to ' + esc((pn.connector || 'port').split('/')[0]) + ' ' + p.n;
    } else txt = 'joined to ' + esc(p.el) + ' ' + esc(p.n);
    return txt + (j.e.assumed ? ' <span class="fx-sub">(assumed)</span>' : '');
  }

  function fibreCircuit(cable, n) {
    return (net.circuits || []).filter(function (c) {
      return traces[c.id].some(function (s) { return s.edge && s.edge.t === 'cable' && s.edge.cable === cable && s.edge.fibre === n; });
    })[0];
  }

  function cableHtml(id) {
    var c = net.cables[id];
    var an = (net.nodes[c.a] || {}).name || c.a, bn = (net.nodes[c.b] || {}).name || c.b;
    var rows = '';
    for (var i = 1; i <= c.fibres; i++) {
      var ci = fibreCircuit(id, i);
      rows += '<tr' + (ci ? '' : ' class="spare"') + '><td>' + i + '</td><td>' + chip(id, i) + '</td><td>' + endDesc(c.a, id, i) + '</td><td>' + endDesc(c.b, id, i) + '</td><td>' +
        (ci ? '<button class="fx-btn small" data-fx="trace" data-circuit="' + esc(ci.id) + '">🧭 ' + esc(ci.name) + '</button>' : '<span class="fx-sub">—</span>') + '</td></tr>';
    }
    var ends = function (nid, nm) {
      var nd = net.nodes[nid] || {};
      return nd.documented ? '<button class="fx-btn small" data-fx="splice" data-node="' + esc(nid) + '">🔀 ' + esc(nm) + '</button>' : '<span class="fx-sub">' + esc(nm) + ' (❓ not documented)</span>';
    };
    return window.SiteMap.lineAccuracy(id) + '<p class="fx-sub">' + c.fibres + ' fibres · ' + esc(an) + ' → ' + esc(bn) + '</p>' +
      '<div class="fx-btns">' + ends(c.a, an) + ends(c.b, bn) + '</div>' +
      '<div class="fx-h">📐 Route</div>' + cableSchematic(id) +
      '<div class="fx-scroll"><table class="fx-table"><tr><th>#</th><th>Colour</th><th>At ' + esc(an) + '</th><th>At ' + esc(bn) + '</th><th>Circuit</th></tr>' + rows + '</table></div>' +
      '<p class="fx-note">Tap a circuit to trace it end to end; its whole path lights up on the map.</p>';
  }

  // ---- Assumed straight lines for cables that aren't drawn yet but have both ends on the map ----
  var mapIsReady = false, assumedDone = false;
  function drawAssumed() {
    if (!net || !mapIsReady || assumedDone) return;
    assumedDone = true;
    Object.keys(net.cables).forEach(function (id) {
      var c = net.cables[id];
      if (window.SiteMap.hasLine(id)) return;
      var an = (net.nodes[c.a] || {}).name || c.a, bn = (net.nodes[c.b] || {}).name || c.b;
      if (c.route && window.SiteMap.addRouteLine(id, c.route, {
        id: id, name: id + ': ' + c.name, type: 'cable',
        notes: c.fibres + '-fibre cable from ' + an + ' to ' + bn + '. Route: ' + c.route.join(' → ') + '. Drawn through its chambers and ducts; the exact line between them is not surveyed.',
        source: 'Route from the fibre model' + (c.route_source ? ' (' + c.route_source + ')' : ''), method: 'description', accuracy_m: 3
      })) return;
      window.SiteMap.addAssumedLine(id, c.a, c.b, {
        id: id, name: id + ': ' + c.name, type: 'cable',
        notes: c.fibres + '-fibre cable from ' + an + ' to ' + bn + '. ⚠️ Drawn as a straight line between its two ends: the real route is not known and needs surveying.',
        source: 'Drawn automatically from the fibre model', method: 'assumed', accuracy_m: null
      });
    });
    setTimeout(function () { openFromHash(); window.SiteMap.openHash(); }, 100);   // deep links once everything is drawn
  }

  // ---- Hooks for map.js popups ----
  window.FibreNet = {
    mapReady: function () { mapIsReady = true; drawAssumed(); },
    cablesInDuct: function (ductId) {
      if (!net) return '';
      return Object.keys(net.cables).filter(function (id) { return (net.cables[id].route || []).indexOf(ductId) >= 0; }).join(', ');
    },
    // Lists for the toolbar's drop-downs.
    lists: function () {
      if (!net) return null;
      return {
        circuits: net.circuits || [],
        cables: Object.keys(net.cables).sort().map(function (id) { return { id: id, name: net.cables[id].name, fibres: net.cables[id].fibres }; }),
        nodes: Object.keys(net.nodes).map(function (id) { var n = net.nodes[id]; return { id: id, name: n.name || id, documented: !!n.documented }; })
          .sort(function (a, b) { return (b.documented - a.documented) || a.name.localeCompare(b.name); })
      };
    },
    showNetworkSchematic: function () { if (net) showNetworkSchematic(); },
    hasCable: function (id) { return !!(net && net.cables[id]); },
    isOpen: function () { return !!(panel && panel.classList.contains('open')) || Object.keys(wins).length > 0; },
    cableOpened: function (id) {
      if (!net || !net.cables[id]) return;
      var extra = window.SiteMap.lineDetails ? window.SiteMap.lineDetails(id) : '';
      showView('cable:' + id, ICON.cable + ' Cable ' + id + ': ' + net.cables[id].name, cableHtml(id) + extra, { cls: 'big' });
    },
    popupExtras: function (p) {
      if (!net || !p || !p.id) return '';
      var html = '';
      // Duct routes: the chambers at each end, the cables in each duct, and the circuits carried.
      if (p.type === 'duct') {
        var ends = String(p.id).split('-');
        var endLinks = ends.map(function (e2) {
          return window.SiteMap.hasFeature(e2) ? '<a href="#feature=' + esc(e2) + '">' + iconFor(e2) + ' ' + esc(e2) + '</a>' + ((window.SiteMap.featureInfo(e2) || {}).name ? ' <span class="fx-sub">' + esc(window.SiteMap.featureInfo(e2).name) + '</span>' : '') : esc(e2);
        }).join(' ↔ ');
        var allCables = [];
        var ductRows = (p.ducts || []).map(function (du) {
          var cs = Object.keys(net.cables).filter(function (id) { return (net.cables[id].route || []).indexOf(du.id) >= 0; });
          cs.forEach(function (c2) { if (allCables.indexOf(c2) < 0) allCables.push(c2); });
          return '<li>' + ICON.duct + ' <b>' + esc(du.id) + '</b> <span class="fx-sub">' + esc(du.od_mm) + ' mm ' + esc([du.colour, du.type].filter(Boolean).join(' ')) + '</span>: ' +
            (cs.length ? cs.map(function (c2) { return '<a href="#" data-fx="cable" data-id="' + esc(c2) + '">' + ICON.cable + ' <b>' + esc(c2) + '</b></a> <span class="fx-sub">' + net.cables[c2].fibres + 'F</span>'; }).join(', ') : '<span class="fx-sub">no cables recorded</span>') + '</li>';
        }).join('');
        var links = [];
        allCables.forEach(function (c2) { circuitsOn(c2).forEach(function (ci) { if (links.indexOf(ci) < 0) links.push(ci); }); });
        html += '<div class="also"><div class="also-h">Ends</div><div style="font-size:12px">' + endLinks + '</div>' +
          '<div class="also-h" style="margin-top:4px">Ducts and cables</div><ul class="fx-through">' + ductRows + '</ul>' +
          (links.length ? '<div class="also-h" style="margin-top:4px">Circuits through it</div>' + traceButtons(links) : '') + '</div>';
        return html;
      }
      // Chambers and structures: the cables routed through them, and the ducts in and out.
      var through = Object.keys(net.cables).filter(function (id) { return (net.cables[id].route || []).indexOf(p.id) >= 0; });
      var dr = p.type === 'duct' ? [] : window.SiteMap.ductRoutesAt(p.id);
      if (through.length || dr.length) {
        var rows = through.map(function (id) {
          var r = net.cables[id].route, i = r.indexOf(p.id);
          var prev = i > 0 ? r[i - 1] : null, next = i < r.length - 1 ? r[i + 1] : null;
          var how = i === 0 || i === r.length - 1 ? 'ends here' : 'from ' + esc(prev) + ' to ' + esc(next);
          return '<li><a href="#" data-fx="cable" data-id="' + esc(id) + '">' + ICON.cable + ' <b>' + esc(id) + '</b></a> <span class="fx-sub">' + net.cables[id].fibres + 'F · ' + how + '</span></li>';
        }).join('');
        html += '<div class="also"><div class="also-h">Cables through here</div>' + (rows ? '<ul class="fx-through">' + rows + '</ul>' : '<div class="fx-sub">None recorded</div>') +
          (dr.length ? '<div class="fx-sub" style="margin:2px 0 0">Ducts: ' + dr.map(function (k) { return '<a href="#feature=' + esc(k) + '">' + ICON.duct + ' ' + esc(k) + '</a>'; }).join(', ') + '</div>' : '') + '</div>';
      }
      if (net.nodes[p.id]) {
        html += '<button class="fx-btn" data-fx="splice" data-node="' + esc(p.id) + '">🔀 Splice diagram</button>';
        html += traceButtons(circuitsAt(p.id));
      } else if (net.cables[p.id]) {
        html += traceButtons(circuitsOn(p.id));
      }
      return html ? '<div class="fx-btns">' + html + '</div>' : '';
    }
  };

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-fx]');
    if (!b || !net) return;
    ev.preventDefault();
    if (b.getAttribute('data-fx') === 'splice') showSplices(b.getAttribute('data-node'));
    if (b.getAttribute('data-fx') === 'feature') window.SiteMap.openFeature(b.getAttribute('data-id'));
    if (b.getAttribute('data-fx') === 'cable') {
      var cid = b.getAttribute('data-id');
      window.SiteMap.highlightIds([cid], true);
      window.FibreNet.cableOpened(cid);
    }
    if (b.getAttribute('data-fx') === 'trace') {
      var c = (net.circuits || []).filter(function (x) { return x.id === b.getAttribute('data-circuit'); })[0];
      if (c) showTrace(c.name, traces[c.id], c.id);
    }
  });

  fetch('data/fibre-network.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) { net = d; build(); drawAssumed(); refreshViews(); })
    .catch(function (e) { console.warn('Could not load the fibre network: ' + e); });

  // Deep links: #splice=C2-ENC, #trace=tdr, #cable=F05 (shareable, and used for tests).
  function openFromHash() {
    var m = /^#(splice|trace|cable)=([\w-]+)$/.exec(location.hash || '');
    if (!m) return;
    if (m[1] === 'splice' && net.nodes[m[2]]) showSplices(m[2]);
    if (m[1] === 'trace' && traces[m[2]]) showTrace((net.circuits.filter(function (c) { return c.id === m[2]; })[0] || {}).name, traces[m[2]], m[2]);
    if (m[1] === 'cable' && net.cables[m[2]]) { window.SiteMap.highlightIds([m[2]], true); window.FibreNet.cableOpened(m[2]); }
  }
  window.addEventListener('hashchange', openFromHash);

  // For scripts/tests: expose the trace engine.
  window.FibreNet._trace = function (s) { return trace(startKey(s)); };
})();
