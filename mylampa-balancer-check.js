(function () {
  'use strict';

  // Passive UI only. Never probes a provider, polls, or reads/writes Storage.
  // Supports the generated Online plugin in Lampac 1.84.2 and 1.86.0.
  var VERSION = '5.0.0';
  var initialized = false;
  var activeSession = null;
  var sessionNumber = 0;
  var requests = [];
  var own = Object.prototype.hasOwnProperty;
  var labels = {
    checking: 'Перевіряємо…',
    found: 'Знайдено у джерелі',
    available: 'Є в наявності',
    matches: 'Є схожі варіанти',
    missing: 'Не знайдено',
    unconfirmed: 'Не підтверджено',
    unverified: 'Не перевірено',
    requires_access: 'Потрібна перевірка',
    unavailable: 'Не вдалося перевірити'
  };
  var colors = {
    checking: '#aebbd0', found: '#8ed9f0', available: '#61df94',
    matches: '#ffd56a', missing: '#8992a0', unconfirmed: '#8992a0',
    unverified: '#8992a0', requires_access: '#ffd56a', unavailable: '#ff8799'
  };

  function dictionary() { return Object.create(null); }
  function has(object, key) { return own.call(object, key); }
  function decode(value) {
    try { return decodeURIComponent(value.replace(/\+/g, ' ')); }
    catch (error) { return value; }
  }
  function urlInfo(url) {
    if (typeof url !== 'string' || !url) return null;
    var anchor = document.createElement('a');
    anchor.href = url;
    if (!/^https?:$/.test(anchor.protocol)) return null;
    var query = dictionary();
    (anchor.search || '').replace(/^\?/, '').split('&').forEach(function (part) {
      if (!part) return;
      var split = part.indexOf('=');
      var name = decode(split < 0 ? part : part.slice(0, split));
      query[name] = decode(split < 0 ? '' : part.slice(split + 1));
    });
    return {
      origin: anchor.protocol + '//' + anchor.host,
      path: ('/' + anchor.pathname.replace(/^\//, '')).replace(/\/+$/, ''),
      query: query
    };
  }
  function endpoint(info, name) {
    return info && info.path.slice(-name.length) === name;
  }
  function movieIdentity(query) {
    var id = query.id || query.tmdb_id || query.imdb_id || query.kinopoisk_id;
    return id ? [(query.source || 'tmdb').toLowerCase(), String(id), query.serial || '0'].join('|') : '';
  }
  function activity() {
    try { return Lampa.Activity && Lampa.Activity.active ? Lampa.Activity.active() : null; }
    catch (error) { return null; }
  }
  function isCurrent(session) {
    if (!session || session !== activeSession) return false;
    var current = activity();
    if (!current) return true;
    if (current.component && current.component !== 'lampac') return false;
    if (current.movie && current.movie.id != null) {
      var query = {
        id: String(current.movie.id), source: current.movie.source || 'tmdb',
        serial: current.movie.name ? '1' : '0'
      };
      if (movieIdentity(query) !== session.movie) return false;
    }
    return true;
  }
  function sourceKey(source) {
    return String(source && (source.source || source.balanser || source.name) || '').split(' ')[0].toLowerCase();
  }
  function sameScope(session, info) {
    if (session.origin !== info.origin) return false;
    var identity = movieIdentity(info.query);
    if (identity && identity !== session.movie) return false;
    return ['account_email', 'uid', 'token', 'box_mac', 'cub_id'].every(function (name) {
      return !has(info.query, name) || info.query[name] === session.query[name];
    });
  }
  function sourceForRequest(session, info) {
    var best = null;
    var bestScore = -1;
    var ambiguous = false;
    Object.keys(session.sources).forEach(function (key) {
      var base = session.sources[key].info;
      if (!base || base.origin !== info.origin) return;
      if (base.path !== info.path && info.path.indexOf(base.path + '/') !== 0) return;
      var names = Object.keys(base.query);
      if (!names.every(function (name) { return info.query[name] === base.query[name]; })) return;
      var score = base.path.length + names.length * 10000;
      if (score > bestScore) { best = key; bestScore = score; ambiguous = false; }
      else if (score === bestScore && best !== key) ambiguous = true;
    });
    return ambiguous ? null : best;
  }
  function remember(params, context) {
    // Bounded references, no credentials or results are persisted or exported.
    requests = requests.filter(function (entry) { return entry.params !== params; });
    requests.push({ params: params, context: context });
    if (requests.length > 128) requests.shift();
  }
  function take(params) {
    for (var i = requests.length - 1; i >= 0; i--) {
      if (requests[i].params === params) return requests.splice(i, 1)[0].context;
    }
    return null;
  }
  function before(event) {
    var params = event && event.params;
    var info = params && urlInfo(params.url);
    if (!info || info.query.mylampa_probe === '1' || info.query.checksearch === 'true') return;
    if (endpoint(info, '/lite/events')) {
      var movie = movieIdentity(info.query);
      if (!movie) return;
      var session = {
        number: ++sessionNumber, movie: movie, origin: info.origin, query: info.query, memkey: '',
        sources: dictionary(), pending: dictionary(), observed: dictionary(),
        revisions: dictionary()
      };
      var previous = activeSession;
      activeSession = session;
      if (!isCurrent(session)) { activeSession = previous; return; }
      remember(params, { session: session, kind: 'events', info: info });
      return;
    }
    var current = activeSession;
    if (!isCurrent(current) || !sameScope(current, info)) return;
    if (endpoint(info, '/lifeevents')) {
      if (!current.memkey || info.query.memkey !== current.memkey) return;
      remember(params, { session: current, kind: 'poll', info: info });
      return;
    }
    var key = sourceForRequest(current, info);
    if (!key) return;
    var revision = (current.revisions[key] || 0) + 1;
    current.revisions[key] = revision;
    remember(params, { session: current, kind: 'provider', key: key, revision: revision });
  }
  function json(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (error) { return null; }
  }
  function inspectResponse(value) {
    var data = json(value);
    if (data && data.rch) return 'requires_access';
    if (data && data.accsdb) return 'requires_access';
    // A selected provider may return structured player JSON instead of HTML.
    if (data && !Array.isArray(data) && (data.method === 'play' || data.method === 'call') && data.url) return 'available';
    if (typeof value !== 'string') return null;
    if (!value.trim()) return 'missing';
    // Parse inertly: provider markup is never inserted into the live document.
    var template = document.createElement('template');
    if (!template.content) return null;
    template.innerHTML = value;
    var parsed = template.content;
    var items = parsed.querySelectorAll('.videos__item');
    var playable = false;
    var similar = false;
    var intermediate = false;
    for (var i = 0; i < items.length; i++) {
      var item = json(items[i].getAttribute('data-json') || '');
      if (!item || typeof item !== 'object') continue;
      if (item.similar) similar = true;
      else if ((item.method === 'play' || item.method === 'call') && item.url) playable = true;
      else if (item.method === 'link' && item.url) intermediate = true;
    }
    if (playable) return 'available';
    if (intermediate) return 'found';
    if (similar) return 'matches';
    if (/(не найден|не знайден|not found|no results|поиск не дал результатов|пошук не дав результатів|нічого не знайдено)/i.test(parsed.textContent || '')) return 'missing';
    // Unknown/denied/malformed pages are not evidence that a title is absent.
    return 'unavailable';
  }
  function status(session, key) {
    if (has(session.observed, key)) return session.observed[key];
    if (has(session.pending, key)) return 'checking';
    var source = session.sources[key];
    if (!source) return 'unverified';
    if (source.rch) return 'requires_access';
    if (source.show === true) return 'found';
    if (source.show === false) return 'unconfirmed';
    return 'unverified';
  }
  function discovery(session, data) {
    data = json(data);
    if (!data || typeof data !== 'object') return;
    if (data.life && typeof data.memkey === 'string') session.memkey = data.memkey;
    var list = Array.isArray(data) ? data : Array.isArray(data.online) ? data.online : [];
    list.forEach(function (source) {
      if (!source || !source.url || !source.name) return;
      var key = sourceKey(source);
      if (!key) return;
      session.sources[key] = {
        info: urlInfo(source.url), show: source.show, rch: source.rch === true
      };
    });
    if (Array.isArray(data.pending)) {
      session.pending = dictionary();
      data.pending.forEach(function (key) {
        if (typeof key === 'string' && key) session.pending[key.toLowerCase()] = true;
      });
    }
    if (data.ready === true) session.pending = dictionary();
    render(session);
  }
  function succeeded(event) {
    var context = event && take(event.params);
    if (!context || !isCurrent(context.session)) return;
    var session = context.session;
    if (context.kind !== 'provider') { discovery(session, event.data); return; }
    if (session.revisions[context.key] !== context.revision) return;
    var observed = inspectResponse(event.data);
    if (observed) session.observed[context.key] = observed;
    render(session);
  }
  function failed(event) {
    var context = event && take(event.params);
    if (!context || !isCurrent(context.session)) return;
    if (event.exception === 'abort' || event.error && event.error.statusText === 'abort') return;
    var session = context.session;
    if (context.kind === 'provider' && session.revisions[context.key] === context.revision) {
      session.observed[context.key] = 'unavailable';
    }
    render(session);
  }
  function selectMatches(active, session) {
    return isCurrent(session) && active && active.title === Lampa.Lang.translate('filter_sorted') &&
      Array.isArray(active.items) && active.items.some(function (item) {
        var key = sourceKey(item);
        return has(session.sources, key) || has(session.pending, key);
      });
  }
  function row(item, key, value, sessionNumber) {
    var element = document.createElement('div');
    element.className = 'selectbox-item selector';
    element.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:1em';
    element.setAttribute('data-mylampa-balanser-key', key);
    element.setAttribute('data-mylampa-status-version', VERSION);
    element.setAttribute('data-mylampa-status-session', String(sessionNumber));
    var title = document.createElement('div');
    title.className = 'selectbox-item__title';
    title.style.minWidth = '0';
    title.textContent = item.title || '';
    var label = document.createElement('div');
    label.className = 'mylampa-balanser-status';
    label.style.cssText = 'display:inline-flex;align-items:center;gap:.35em;flex:0 0 auto;font-size:.58em;white-space:nowrap';
    var dot = document.createElement('i');
    dot.style.cssText = 'display:inline-block;width:.62em;height:.62em;border-radius:50%';
    var text = document.createElement('span');
    label.appendChild(dot);
    label.appendChild(text);
    element.appendChild(title);
    element.appendChild(label);
    paint(label, value);
    return window.jQuery(element);
  }
  function paint(label, value) {
    label.setAttribute('data-status', value);
    label.querySelector('i').style.backgroundColor = colors[value] || colors.unverified;
    label.querySelector('span').textContent = labels[value] || labels.unverified;
  }
  function decorate(event) {
    var active = event && event.active;
    var session = activeSession;
    if (!selectMatches(active, session)) return;
    active.items.forEach(function (item) {
      var key = sourceKey(item);
      if (has(session.sources, key) || has(session.pending, key)) item.html = row(item, key, status(session, key), session.number);
    });
  }
  function render(session) {
    if (!isCurrent(session)) return;
    var rows = document.querySelectorAll('[data-mylampa-status-version="' + VERSION + '"][data-mylampa-status-session="' + session.number + '"]');
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].getAttribute('data-mylampa-balanser-key');
      var label = rows[i].querySelector('.mylampa-balanser-status');
      if (label) paint(label, status(session, key));
    }
  }
  function init() {
    if (initialized || window.mylampaBalancerStatusPassive) return true;
    if (!window.Lampa || !Lampa.Listener || !Lampa.Select || !Lampa.Select.listener || !window.jQuery) return false;
    initialized = true;
    window.mylampaBalancerStatusPassive = { version: VERSION, mode: 'passive' };
    Lampa.Listener.follow('request_before', before);
    Lampa.Listener.follow('request_secuses', succeeded);
    Lampa.Listener.follow('request_error', failed);
    Lampa.Select.listener.follow('preshow', decorate);
    return true;
  }
  function waitForLampa() {
    if (!init()) setTimeout(waitForLampa, 250);
  }
  waitForLampa();
})();
