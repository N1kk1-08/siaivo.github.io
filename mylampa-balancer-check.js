(function () {
  'use strict';

  // This script deliberately stays separate from Lampac's generated online.js.
  // It observes the source list that online.js already receives, then checks the
  // listed providers in the background without changing normal playback flow.
  var CACHE_KEY = 'mylampa_balanser_availability_v1';
  var SUCCESS_CACHE_TTL = 60 * 60 * 1000;
  var FAILURE_CACHE_TTL = 3 * 60 * 1000;
  var MAX_PARALLEL_REQUESTS = 2;
  var initialized = false;
  var activeSession = null;

  var statusLabels = {
    checking: 'Перевіряємо…',
    available: 'Є в наявності',
    matches: 'Є схожі варіанти',
    missing: 'Не знайдено',
    unavailable: 'Недоступне'
  };

  var statusColors = {
    checking: '#aebbd0',
    available: '#61df94',
    matches: '#ffd56a',
    missing: '#8992a0',
    unavailable: '#ff8799'
  };

  function asObject(value) {
    if (!value) return {};
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (error) { return {}; }
    }
    return typeof value === 'object' ? value : {};
  }

  function readCache() {
    try {
      return asObject(Lampa.Storage.get(CACHE_KEY, {}));
    } catch (error) {
      return {};
    }
  }

  function writeCache(cache) {
    var now = Date.now();
    var cleaned = {};

    Object.keys(cache).forEach(function (key) {
      var entry = cache[key];
      if (entry && entry.at && now - entry.at < 24 * 60 * 60 * 1000) cleaned[key] = entry;
    });

    try { Lampa.Storage.set(CACHE_KEY, cleaned); } catch (error) {}
  }

  function getParam(url, name) {
    var match = new RegExp('(?:[?&])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^&]*)').exec(url || '');
    if (!match) return '';
    try { return decodeURIComponent(match[1].replace(/\+/g, ' ')); } catch (error) { return match[1]; }
  }

  function movieKey(url) {
    return [
      getParam(url, 'source'),
      getParam(url, 'id') || getParam(url, 'tmdb_id') || getParam(url, 'imdb_id'),
      getParam(url, 'serial'),
      getParam(url, 'year')
    ].join(':');
  }

  function sourceKey(source) {
    var name = source && (source.balanser || source.name) ? String(source.balanser || source.name) : '';
    return name.split(' ')[0].toLowerCase();
  }

  function sourceLabel(source) {
    return source && source.name ? String(source.name) : sourceKey(source);
  }

  function cleanQuery(url) {
    var index = url.indexOf('?');
    if (index < 0) return '';

    return url.slice(index + 1).split('&').filter(function (part) {
      return part && part !== 'life=true' && part.indexOf('memkey=') !== 0;
    }).join('&');
  }

  function appendQuery(url, query) {
    if (!query) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + query;
  }

  function cacheEntryKey(session, source) {
    return session.movie + '|' + sourceKey(source);
  }

  function cacheIsFresh(entry) {
    if (!entry || !entry.at || !entry.status) return false;
    var ttl = entry.status === 'unavailable' ? FAILURE_CACHE_TTL : SUCCESS_CACHE_TTL;
    return Date.now() - entry.at < ttl;
  }

  function isDiscoveryRequest(url) {
    var path = String(url || '').split('?')[0];
    return (path.indexOf('/lite/events') >= 0 && /(?:[?&])life=true(?:&|$)/.test(url)) || path.indexOf('/lifeevents') >= 0;
  }

  function extractSources(data) {
    var list = Array.isArray(data) ? data : data && Array.isArray(data.online) ? data.online : null;
    if (!list) return [];

    return list.filter(function (source) {
      return source && source.url && source.name && source.show !== false;
    });
  }

  function safeJson(value) {
    try { return JSON.parse(value); } catch (error) { return null; }
  }

  function classifyResponse(data) {
    if (data && typeof data === 'object' && (data.rch || data.accsdb)) return 'unavailable';

    var text = typeof data === 'string' ? data : data ? JSON.stringify(data) : '';
    if (!text || !text.trim()) return 'missing';

    var root = document.createElement('div');
    root.innerHTML = text;
    var items = root.querySelectorAll('.videos__item, .videos__button');
    var hasVideo = false;
    var hasSimilar = false;

    for (var i = 0; i < items.length; i++) {
      var item = safeJson(items[i].getAttribute('data-json') || '');
      if (!item) continue;
      if (item.similar) hasSimilar = true;
      else if (item.method === 'play' || item.method === 'call' || item.method === 'link' || items[i].classList.contains('videos__button')) hasVideo = true;
    }

    if (hasVideo) return 'available';
    if (hasSimilar) return 'matches';

    if (/(не найден|не знайден|not found|no results|поиск не дал результатов|нічого не знайдено)/i.test(text)) return 'missing';
    return 'unavailable';
  }

  function selectSourceKey(item) {
    return String(item && (item.source || item.balanser || item.name) || '').split(' ')[0].toLowerCase();
  }

  function isBalancerSelect(active, session) {
    if (!active || !session || !Array.isArray(active.items) || !active.items.length) return false;
    if (active.title !== Lampa.Lang.translate('filter_sorted')) return false;

    return active.items.some(function (item) {
      return session.statuses.hasOwnProperty(selectSourceKey(item));
    });
  }

  function selectItem(item, status) {
    var row = $('<div class="selectbox-item selector" style="display:flex;align-items:center;justify-content:space-between;gap:1em"></div>');
    var title = $('<div class="selectbox-item__title" style="min-width:0"></div>').text(item.title || '');
    var label = $('<div class="mylampa-balanser-status" style="display:inline-flex;align-items:center;gap:.35em;flex:0 0 auto;font-size:.58em;white-space:nowrap"></div>');
    var dot = $('<i style="display:inline-block;width:.62em;height:.62em;border-radius:50%"></i>');

    dot.css('background', statusColors[status] || statusColors.checking);
    label.append(dot);
    label.append($('<span></span>').text(statusLabels[status] || statusLabels.checking));
    row.attr('data-mylampa-balanser-key', selectSourceKey(item));
    row.append(title);
    row.append(label);
    return row;
  }

  function decorateSelect(active, session) {
    if (!isBalancerSelect(active, session)) return;

    active.items.forEach(function (item) {
      var key = selectSourceKey(item);
      if (!session.statuses.hasOwnProperty(key)) return;
      item.html = selectItem(item, session.statuses[key] || 'checking');
    });
  }

  function refreshOpenSelect(session) {
    if (!session || activeSession !== session) return;

    $('[data-mylampa-balanser-key]').each(function () {
      var key = String($(this).attr('data-mylampa-balanser-key') || '');
      var status = session.statuses[key] || 'checking';
      var label = $(this).find('.mylampa-balanser-status');

      label.find('i').css('background', statusColors[status] || statusColors.checking);
      label.find('span').text(statusLabels[status] || statusLabels.checking);
    });
  }

  function render(session) {
    refreshOpenSelect(session);
  }

  function cacheStatus(session, source, status) {
    var cache = readCache();
    cache[cacheEntryKey(session, source)] = { status: status, at: Date.now() };
    writeCache(cache);
  }

  function requestSource(session, source, done) {
    var request = new Lampa.Reguest();
    request.timeout(9000);
    request.native(
      appendQuery(source.url, session.query),
      function (data) { done(classifyResponse(data)); },
      function () { done('unavailable'); },
      false,
      { dataType: 'text' }
    );
  }

  function runQueue(session, queue) {
    var inFlight = 0;

    function next() {
      if (activeSession !== session) return;
      while (inFlight < MAX_PARALLEL_REQUESTS && queue.length) {
        (function (source) {
          inFlight++;
          requestSource(session, source, function (status) {
            inFlight--;
            if (activeSession !== session) return;
            session.statuses[sourceKey(source)] = status;
            cacheStatus(session, source, status);
            render(session);
            next();
          });
        })(queue.shift());
      }
    }

    next();
  }

  function startChecks(url, sources) {
    var movie = movieKey(url);
    if (!movie || movie === ':::') return;

    var signature = movie + '|' + sources.map(sourceKey).join(',');
    // lifeevents can report the same list more than once while the Online
    // screen is open. Repaint the existing result instead of duplicating its
    // background requests.
    if (activeSession && activeSession.signature === signature) {
      render(activeSession);
      return;
    }

    var session = {
      signature: signature,
      movie: movie,
      query: cleanQuery(url),
      sources: sources,
      statuses: {}
    };
    activeSession = session;

    var cache = readCache();
    var queue = [];
    sources.forEach(function (source) {
      var entry = cache[cacheEntryKey(session, source)];
      if (cacheIsFresh(entry)) session.statuses[sourceKey(source)] = entry.status;
      else {
        session.statuses[sourceKey(source)] = 'checking';
        queue.push(source);
      }
    });

    render(session);
    runQueue(session, queue);
  }

  function init() {
    if (initialized) return true;
    if (!window.Lampa || !Lampa.Listener || !Lampa.Reguest || !Lampa.Storage || !Lampa.Select || !Lampa.Select.listener || !window.jQuery) return false;

    initialized = true;
    Lampa.Select.listener.follow('preshow', function (event) {
      decorateSelect(event && event.active, activeSession);
    });

    Lampa.Listener.follow('request_secuses', function (event) {
      var url = event && event.params && event.params.url ? String(event.params.url) : '';
      if (!isDiscoveryRequest(url)) return;

      var sources = extractSources(event.data);
      if (sources.length) startChecks(url, sources);
    });

    return true;
  }

  function waitForLampa() {
    if (init()) return;
    setTimeout(waitForLampa, 250);
  }

  waitForLampa();
})();
