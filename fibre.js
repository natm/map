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

  var net = null;
  var adj = {};
  var traces = {};   // circuit id -> sequence

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
    (net.circuits || []).forEach(function (c) { traces[c.id] = trace(startKey(c.start)); });
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
  }
  function closePanel() {
    if (panel) panel.classList.remove('open');
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
        return '<li class="duct">duct <a href="#" data-fx="feature" data-id="' + esc(String(id).split('/')[0]) + '">' + esc(id) + '</a>' +
          (inf.od_mm ? ' <span class="fx-sub">' + esc(inf.od_mm) + ' mm ' + esc([inf.colour, inf.type].filter(Boolean).join(' ')) + '</span>' : '') + '</li>';
      }
      return '<li class="chamber"><a href="#" data-fx="feature" data-id="' + esc(id) + '">' + esc(id) + '</a>' + (inf.name && inf.name !== id ? ' <span class="fx-sub">' + esc(inf.name) + '</span>' : '') + '</li>';
    });
    return '<ol class="fx-route">' + steps.join('') + '</ol>';
  }

  function traceHtml(seq) {
    var html = '', i = 0;
    while (i < seq.length) {
      if (seq[i].edge) {   // a cable between nodes
        var e = seq[i].edge, c = net.cables[e.cable];
        var fromNode = i > 0 && seq[i - 1].key ? parseKey(seq[i - 1].key).node : null;
        html += '<div class="fx-cable"><div class="fx-line" style="border-color:' + fibreColour(c, e.fibre).hex + '"></div><div class="fx-clabel"><a href="#" data-fx="cable" data-id="' + esc(e.cable) + '"><b>' +
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
        (onMap ? '<a href="#" data-fx="feature" data-id="' + esc(nid) + '">' + esc(node.name || nid) + '</a>' : esc(node.name || nid)) +
        (node.where ? '<span class="fx-sub">' + esc(node.where) + '</span>' : '') +
        '<span class="fx-nbtns">' +
        (onMap ? '<button class="fx-btn small" data-fx="feature" data-id="' + esc(nid) + '">📍 Details and photos</button>' : '') +
        (node.documented ? '<button class="fx-btn small" data-fx="splice" data-node="' + esc(nid) + '">🔀 Splice diagram</button>' : '') +
        '</span></div>' + inner + '</div>';
    }
    return '<div class="fx-trace">' + html + '</div>';
  }

  function showTrace(name, seq) {
    window.SiteMap.closePopup();
    var showRoutes = false;
    try { showRoutes = localStorage.getItem('fx-show-routes') === '1'; } catch (e) {}
    openPanel(name, '<label class="fx-toggle"><input type="checkbox" class="fx-routes-toggle"' + (showRoutes ? ' checked' : '') + '> Show chambers and ducts along each cable</label>' +
      '<div class="fx-trace-wrap' + (showRoutes ? ' show-routes' : '') + '">' + traceHtml(seq) + '</div>' +
      '<p class="fx-note">Cables on this path are highlighted on the map. Dashed joints are assumed, not checked on site.</p>');
    var cb = body.querySelector('.fx-routes-toggle');
    cb.addEventListener('change', function () {
      body.querySelector('.fx-trace-wrap').classList.toggle('show-routes', cb.checked);
      try { localStorage.setItem('fx-show-routes', cb.checked ? '1' : '0'); } catch (e) {}
    });
    window.SiteMap.highlightIds(seqCables(seq), true);
  }

  // ---- Splice diagram (SVG) ----
  var RH = 16, HH = 22, GAP = 14;

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
    var cablesHere = Object.keys(net.cables).filter(function (id) { return net.cables[id].a === nid || net.cables[id].b === nid; });
    var lay = node.layout || {};
    var left = (lay.left || []).filter(function (id) { return cablesHere.indexOf(id) >= 0; });
    var right = (lay.right || []).filter(function (id) { return cablesHere.indexOf(id) >= 0; });
    cablesHere.forEach(function (id) { if (left.indexOf(id) < 0 && right.indexOf(id) < 0) (left.length <= right.length ? left : right).push(id); });
    var panels = node.panels || [], devices = node.devices || [];
    var hasMid = panels.length || devices.length;
    var TW = 120, MW = 250, LANE = 46, GX = 80;
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
      out.push(svgText(side === 'L' ? x : x + TW, y + 14, id + ' · ' + c.fibres + 'F → ' + ((net.nodes[other] || {}).name || other),
        { anchor: side === 'L' ? 'start' : 'end', bold: true, size: 10 }));
      // Sheath: one rounded block per tube, in the tube colour (grey for a single-tube cable)
      var sx = side === 'L' ? x : x + TW - 22;
      for (var t = 0; t * ts < c.fibres; t++) {
        var n0 = t * ts, n1 = Math.min(c.fibres, n0 + ts);
        var tc = c.fibres > ts ? COLOURS[t % 12][1] : '#b0bec5';
        out.push('<rect x="' + sx + '" y="' + (y + HH + n0 * RH - 2) + '" width="22" height="' + ((n1 - n0) * RH + 4) + '" rx="8" fill="' + tc + '" stroke="#455a64"/>');
      }
      // Fibre pills
      var px = side === 'L' ? x + 24 : x, pw = TW - 24;
      for (var i = 1; i <= c.fibres; i++) {
        var fc = fibreColour(c, i), ry = y + HH + (i - 1) * RH;
        var k = key(nid, 'C', id, i), isUsed = !!u[k];
        out.push('<rect x="' + px + '" y="' + (ry + 1) + '" width="' + pw + '" height="' + (RH - 2) + '" rx="4" fill="' + fc.hex + '" stroke="#333" stroke-width="0.6"' +
          (isUsed ? '' : ' fill-opacity="0.35"') + '/>');
        out.push(svgText(px + pw / 2, ry + 12, i + '  ' + fc.name + (isUsed ? '' : ' (spare)'), { anchor: 'middle', fill: LIGHT[fc.name] || !isUsed ? '#222' : '#fff', size: 10 }));
        anchor[k] = { x: side === 'L' ? x + TW : x, y: ry + RH / 2, side: side };
      }
      return h;
    }

    function midBox(label, rows, x, y, kindKey) {   // panel or device: rows = [{n, text, keyRear, keyFront}]
      var h = HH + rows.length * RH;
      out.push('<rect x="' + x + '" y="' + y + '" width="' + MW + '" height="' + h + '" fill="#fff" stroke="#555"/>');
      out.push('<rect x="' + x + '" y="' + y + '" width="' + MW + '" height="' + HH + '" fill="' + (kindKey === 'D' ? '#e8eaf6' : '#eceff1') + '" stroke="#555"/>');
      out.push(svgText(x + MW / 2, y + 15, label.length > 44 ? label.slice(0, 42) + '…' : label, { anchor: 'middle', bold: true, size: 10 }));
      rows.forEach(function (r, i) {
        var ry = y + HH + i * RH;
        out.push('<rect x="' + x + '" y="' + ry + '" width="26" height="' + RH + '" fill="#fafafa" stroke="#555" stroke-width="0.5"/>');
        out.push(svgText(x + 13, ry + 12, r.n, { anchor: 'middle', size: 10 }));
        out.push('<rect x="' + (x + 26) + '" y="' + ry + '" width="' + LANE + '" height="' + RH + '" fill="#fffdf2" stroke="#ddd" stroke-width="0.5"/>');
        out.push(svgText(x + 26 + LANE + 6, ry + 12, r.text || '', { size: 10, fill: '#333' }));
        if (r.keyRear) anchor[r.keyRear] = { x: x, xr: x + MW, y: ry + RH / 2, side: 'M' };
        if (r.keyFront) anchor[r.keyFront] = { x: x + 26 + 6, y: ry + RH / 2, side: 'F' };
      });
      return h;
    }

    // Layout columns
    var yl = 30, yr = 30, ym = 30;
    left.forEach(function (id) { yl += cableTable(id, xL, yl, 'L') + GAP; });
    right.forEach(function (id) { yr += cableTable(id, xR, yr, 'R') + GAP; });
    panels.forEach(function (p) {
      var labels = {};
      Object.keys(p.labels || {}).forEach(function (r) { parseRef('x:' + r).list.forEach(function (n) { labels[n] = p.labels[r]; }); });
      var rows = [];
      for (var i = 1; i <= p.ports; i++) rows.push({ n: i, text: labels[i] || '', keyRear: key(nid, 'R', p.id, i), keyFront: key(nid, 'T', p.id, i) });
      ym += midBox(p.name, rows, xM, ym, 'P') + GAP;
    });
    devices.forEach(function (d) {
      var rows = (d.ports || []).map(function (pt) { return { n: '', text: pt, keyRear: key(nid, 'D', d.id, pt), keyFront: key(nid, 'D', d.id, pt) }; });
      ym += midBox(d.name, rows, xM, ym, 'D') + GAP;
    });
    var H = Math.max(yl, yr, ym, 60) + 30;

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
          var lx = Math.min(a.x, b.x), bulge = 8 + (patchNo++ % 5) * 7;
          arcs.push('<path d="M' + lx + ',' + a.y + ' C' + (lx + bulge) + ',' + a.y + ' ' + (lx + bulge) + ',' + b.y + ' ' + lx + ',' + b.y +
            '" fill="none" stroke="' + PATCH + '" stroke-width="3"' + dash + '/>');
          arcs.push('<circle cx="' + lx + '" cy="' + a.y + '" r="2.5" fill="#8a6d00"/><circle cx="' + lx + '" cy="' + b.y + '" r="2.5" fill="#8a6d00"/>');
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
        if (LIGHT[col.name] || e.t === 'through') lines.push('<path d="' + d + '" fill="none" stroke="#555" stroke-width="' + (e.t === 'through' ? 5 : 3.6) + '"' + dash + '/>');
        lines.push('<path d="' + d + '" fill="none" stroke="' + col.hex + '" stroke-width="' + (e.t === 'through' ? 3 : 2.2) + '"' + dash + '/>');
        if (e.t === 'splice') {   // splice mark (and tray number) at the midpoint
          var my = (pa.y + pb.y) / 2;
          lines.push('<rect x="' + (mx - 4) + '" y="' + (my - 4) + '" width="8" height="8" rx="1.5" fill="#fff" stroke="#333"/>');
          if (e.tray) lines.push(svgText(mx + 7, my + 3, 'T' + e.tray, { size: 8, fill: '#555' }));
        }
      });
    });

    var head = svgText(8, 18, node.name || nid, { bold: true, size: 12 });
    var legend = svgText(8, H - 10, 'Coloured lines: fusion splices (□ = splice, T = tray) · thick lines: express fibres, not cut · yellow loops: LC patch leads · dashed: assumed', { size: 10, fill: '#666' });
    return '<svg class="fx-svg" xmlns="http://www.w3.org/2000/svg" style="max-width:' + W + 'px" viewBox="0 0 ' + W + ' ' + H +
      '" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">' + '<rect width="100%" height="100%" fill="#fff"/>' + head + lines.join('') + out.join('') + arcs.join('') + legend + '</svg>';
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

  function showSplices(nid) {
    var node = net.nodes[nid];
    window.SiteMap.closePopup();
    var html;
    if (!node.documented) {
      html = '<p class="fx-note">❓ What happens inside ' + esc(node.name || nid) + ' isn\'t documented yet.' + (node.notes ? ' ' + esc(node.notes) : '') + '</p>';
    } else {
      html = '<div class="fx-scroll">' + spliceSvg(nid) + '</div>' +
        '<p class="fx-note">Scroll sideways on a phone. Use a trace below to follow one link end to end.</p>';
    }
    var cs = circuitsAt(nid);
    if (cs.length) html += '<div class="fx-btns"><div class="fx-sub">Trace a link through here:</div>' + traceButtons(cs) + '</div>';
    openPanel('Splices: ' + (node.name || nid), html);
    var ids = Object.keys(net.cables).filter(function (id) { return net.cables[id].a === nid || net.cables[id].b === nid; });
    window.SiteMap.highlightIds(ids, false);
  }

  // ---- Cable view: every fibre, what it joins at each end, and the link it carries ----
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
      '<div class="fx-scroll"><table class="fx-table"><tr><th>#</th><th>Colour</th><th>At ' + esc(an) + '</th><th>At ' + esc(bn) + '</th><th>Link</th></tr>' + rows + '</table></div>' +
      '<p class="fx-note">Tap a link to trace it end to end; its whole path lights up on the map.</p>';
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
    isOpen: function () { return !!(panel && panel.classList.contains('open')); },
    cableOpened: function (id) {
      if (!net || !net.cables[id]) return;
      openPanel('Cable ' + id + ': ' + net.cables[id].name, cableHtml(id));
    },
    popupExtras: function (p) {
      if (!net || !p || !p.id) return '';
      var html = '';
      // Chambers and structures: the cables routed through them, and the ducts in and out.
      var through = Object.keys(net.cables).filter(function (id) { return (net.cables[id].route || []).indexOf(p.id) >= 0; });
      var dr = p.type === 'duct' ? [] : window.SiteMap.ductRoutesAt(p.id);
      if (through.length || dr.length) {
        var rows = through.map(function (id) {
          var r = net.cables[id].route, i = r.indexOf(p.id);
          var prev = i > 0 ? r[i - 1] : null, next = i < r.length - 1 ? r[i + 1] : null;
          var how = i === 0 || i === r.length - 1 ? 'ends here' : 'from ' + esc(prev) + ' to ' + esc(next);
          return '<li><a href="#" data-fx="cable" data-id="' + esc(id) + '"><b>' + esc(id) + '</b></a> <span class="fx-sub">' + net.cables[id].fibres + 'F · ' + how + '</span></li>';
        }).join('');
        html += '<div class="also"><div class="also-h">Cables through here</div>' + (rows ? '<ul class="fx-through">' + rows + '</ul>' : '<div class="fx-sub">None recorded</div>') +
          (dr.length ? '<div class="fx-sub" style="margin:2px 0 0">Ducts: ' + dr.map(function (k) { return '<a href="#feature=' + esc(k) + '">' + esc(k) + '</a>'; }).join(', ') + '</div>' : '') + '</div>';
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
    if (b.getAttribute('data-fx') === 'feature') { closePanel(); window.SiteMap.openFeature(b.getAttribute('data-id')); }
    if (b.getAttribute('data-fx') === 'cable') {
      var cid = b.getAttribute('data-id');
      window.SiteMap.highlightIds([cid], true);
      window.FibreNet.cableOpened(cid);
    }
    if (b.getAttribute('data-fx') === 'trace') {
      var c = (net.circuits || []).filter(function (x) { return x.id === b.getAttribute('data-circuit'); })[0];
      if (c) showTrace(c.name, traces[c.id]);
    }
  });

  fetch('data/fibre-network.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) { net = d; build(); drawAssumed(); window.SiteMap.refreshPopup(); })
    .catch(function (e) { console.warn('Could not load the fibre network: ' + e); });

  // Deep links: #splice=C2-ENC, #trace=tdr, #cable=F05 (shareable, and used for tests).
  function openFromHash() {
    var m = /^#(splice|trace|cable)=([\w-]+)$/.exec(location.hash || '');
    if (!m) return;
    if (m[1] === 'splice' && net.nodes[m[2]]) showSplices(m[2]);
    if (m[1] === 'trace' && traces[m[2]]) showTrace((net.circuits.filter(function (c) { return c.id === m[2]; })[0] || {}).name, traces[m[2]]);
    if (m[1] === 'cable' && net.cables[m[2]]) { window.SiteMap.highlightIds([m[2]], true); window.FibreNet.cableOpened(m[2]); }
  }
  window.addEventListener('hashchange', openFromHash);

  // For scripts/tests: expose the trace engine.
  window.FibreNet._trace = function (s) { return trace(startKey(s)); };
})();
