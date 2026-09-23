(function () {
  'use strict';

  var COMPONENT = 'mylampa_account';
  var ID_KEY = 'mylampa_sync_id';
  var JOIN_KEY = 'mylampa_sync_join_id';
  var LOADED_KEY = 'mylampa_sync_loaded_id';
  var ENABLED_KEY = 'mylampa_sync_enabled';
  var LAST_SYNC_KEY = 'mylampa_last_sync_at';
  var OFFLINE_BASE_PREFIX = 'mylampa_sync_offline_base_';
  var TIMECODE_QUEUE_PREFIX = 'mylampa_sync_timecode_queue_';
  var RECONCILED_KEY = 'mylampa_sync_reconciled_id';
  var BOOKMARK_CATEGORIES = ['history', 'like', 'watch', 'wath', 'book', 'look', 'viewed', 'scheduled', 'continued', 'thrown'];
  var cabinetOpen = false;
  var ignoreBackdropClickUntil = 0;
  var timelineRefreshTimer = 0;
  var activeSyncId = '';
  var syncLoadInFlight = false;
  var syncRetryTimer = 0;
  var syncRetryDelay = 2000;
  var syncLoadErrorShown = false;
  var reconcileInFlight = false;
  var reconcileTimer = 0;
  var reconcileDelay = 2000;
  var reconcileErrorShown = false;

  function normalizeId(value) {
    value = String(value || '').trim().toLowerCase();
    return /^[a-z0-9-]{6}$/.test(value) ? value : '';
  }

  function makeId() {
    var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    var values = '';
    var i;

    if (window.crypto && window.crypto.getRandomValues) {
      var bytes = new Uint8Array(1);
      var limit = 256 - (256 % alphabet.length);
      for (i = 0; i < 6; i++) {
        do {
          window.crypto.getRandomValues(bytes);
        } while (bytes[0] >= limit);
        values += alphabet.charAt(bytes[0] % alphabet.length);
      }
    } else {
      for (i = 0; i < 6; i++) values += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }

    return values;
  }

  function currentId() {
    var id = normalizeId(Lampa.Storage.get(ID_KEY, ''));

    if (!id) {
      id = makeId();
      Lampa.Storage.set(ID_KEY, id);
    }

    return id;
  }

  function serverUrl() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      return window.location.protocol + '//' + window.location.host;
    }

    // Android may run the page from file:// while loading Lampa from lampa_url.
    var remote = String(window.lampa_url || '');
    var match = remote.match(/^https?:\/\/[^/]+/i);
    return match ? match[0] : '';
  }

  function syncEnabled() {
    return String(Lampa.Storage.get(ENABLED_KEY, 'true')) === 'true';
  }

  function lastSyncText() {
    var timestamp = Number(Lampa.Storage.get(LAST_SYNC_KEY, 0));
    var date;

    if (syncEnabled() && (reconcileInFlight || reconcileTimer ||
        storageGet(OFFLINE_BASE_PREFIX + currentId()) ||
        Object.keys(readJson(timecodeQueueKey(currentId()), {}) || {}).length)) {
      return 'Офлайн-зміни очікують синхронізації';
    }
    if (!timestamp) return 'Ще не синхронізовано';
    date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Ще не синхронізовано';

    try {
      return date.toLocaleString('uk-UA', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (error) {
      return date.toLocaleString();
    }
  }

  function showLastSync(item) {
    (item && item.find ? item.find('.mylampa-sync-last') : $('.mylampa-sync-last')).text(lastSyncText());
  }

  function markSynced() {
    if (!syncEnabled() || !activeSyncId || currentId() !== activeSyncId) return;
    Lampa.Storage.set(LAST_SYNC_KEY, Date.now(), true);
    showLastSync();
  }

  function reloadSilently() {
    setTimeout(function () { window.location.reload(); }, 80);
  }

  function readJson(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); }
    catch (error) { return null; }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      Lampa.Noty.show('Не вдалося зберегти офлайн-зміни на цьому пристрої.');
      return false;
    }
  }

  function favoriteSnapshot() {
    var value = Lampa.Storage.get('favorite', {});
    try {
      return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : {};
    } catch (error) {
      return {};
    }
  }

  function cloneObject(value) {
    try { return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : {}; }
    catch (error) { return {}; }
  }

  function bookmarkMembershipSnapshot() {
    var favorite = favoriteSnapshot();
    var snapshot = {};
    BOOKMARK_CATEGORIES.forEach(function (where) {
      snapshot[where] = Array.isArray(favorite[where]) ? favorite[where].slice() : [];
    });
    return snapshot;
  }

  function rememberOfflineBase() {
    var key = OFFLINE_BASE_PREFIX + currentId();
    return !!storageGet(key) || writeJson(key, bookmarkMembershipSnapshot());
  }

  function timecodeQueueKey(id) {
    return TIMECODE_QUEUE_PREFIX + id;
  }

  function queueTimecode(id, cardId, hash, road) {
    var key = timecodeQueueKey(id);
    var queue = readJson(key, {});
    if (!queue || typeof queue !== 'object' || Array.isArray(queue)) queue = {};
    queue[cardId + '|' + hash] = { cardId: cardId, hash: String(hash), road: cloneObject(road) };
    return writeJson(key, queue);
  }

  function rememberOfflineTimecodes() {
    if (window.mylampaSyncOfflineTimelineBound) return;
    if (!Lampa.Timeline || !Lampa.Timeline.listener || !Lampa.Timeline.listener.follow) {
      setTimeout(rememberOfflineTimecodes, 500);
      return;
    }

    window.mylampaSyncOfflineTimelineBound = true;
    Lampa.Timeline.listener.follow('update', function (event) {
      if (syncEnabled() && !reconcileInFlight) return;
      if (!event || !event.data || !event.data.road || !event.data.hash) return;

      var activity = Lampa.Storage.get('activity', {});
      var card = activity && (activity.movie || activity.card);
      if (!card || !card.id) return;

      var cardId = String(card.id) + '_' + (card.name ? 'tv' : 'movie');
      queueTimecode(currentId(), cardId, event.data.hash, event.data.road);
    });
  }

  function apiUrl(path, id, extra) {
    var url = serverUrl() + path;
    var params = {
      token: id,
      account_email: Lampa.Storage.get('account_email', ''),
      uid: Lampa.Storage.get('lampac_unic_id', ''),
      profile_id: Lampa.Storage.get('lampac_profile_id', ''),
      connectionId: window.lwsEvent && window.lwsEvent.connectionId || ''
    };
    var name;
    if (extra) for (name in extra) if (Object.prototype.hasOwnProperty.call(extra, name)) params[name] = extra[name];
    for (name in params) {
      if (Object.prototype.hasOwnProperty.call(params, name) && params[name] !== '' && params[name] !== null && typeof params[name] !== 'undefined') {
        url = Lampa.Utils.addUrlComponent(url, encodeURIComponent(name) + '=' + encodeURIComponent(params[name]));
      }
    }
    return url;
  }

  function apiRequest(method, url, body, contentType, callback) {
    var request = new XMLHttpRequest();
    var finished = false;
    function finish(error, data) {
      if (finished) return;
      finished = true;
      callback(error, data);
    }
    try {
      request.open(method, url, true);
      request.timeout = 15000;
      if (contentType) request.setRequestHeader('Content-Type', contentType);
      request.onreadystatechange = function () {
        if (request.readyState !== 4) return;
        if (request.status < 200 || request.status >= 300) return finish('HTTP ' + request.status);
        try { finish(null, JSON.parse(request.responseText)); }
        catch (error) { finish('Некоректна відповідь сервера'); }
      };
      request.onerror = function () { finish('Немає з’єднання із сервером'); };
      request.ontimeout = function () { finish('Сервер не відповідає'); };
      request.send(body || null);
    } catch (error) {
      finish('Не вдалося виконати запит');
    }
  }

  function getBookmarks(id, callback) {
    apiRequest('GET', apiUrl('/bookmark/list', id), null, '', function (error, data) {
      if (error) return callback(error);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return callback('Некоректний список закладок');
      if (data.dbInNotInitialization === true) data = { card: [] };
      if (!Array.isArray(data.card)) return callback('Некоректний список закладок');
      callback(null, data);
    });
  }

  function cardMap(favorite) {
    var map = {};
    var cards = favorite && Array.isArray(favorite.card) ? favorite.card : [];
    cards.forEach(function (card) {
      if (card && card.id !== null && typeof card.id !== 'undefined') map[String(card.id)] = card;
    });
    return map;
  }

  function idSet(items) {
    var set = {};
    if (Array.isArray(items)) items.forEach(function (item) { set[String(item)] = true; });
    return set;
  }

  function bookmarkChanges(base, local, remote) {
    var additions = [];
    var removals = [];
    var cards = cardMap(local);
    var missingCard = false;

    BOOKMARK_CATEGORIES.forEach(function (where) {
      var before = base ? idSet(base[where]) : null;
      var onServer = idSet(remote[where]);
      var now = Array.isArray(local[where]) ? local[where] : [];
      var current = idSet(now);

      // The first run has no baseline: preserve local-only entries, but never
      // infer deletions from an old snapshot.
      now.slice().reverse().forEach(function (item) {
        var id = String(item);
        if ((before && before[id]) || onServer[id]) return;
        var card = cards[id];
        if (!card) { missingCard = true; return; }
        additions.push({ where: where, card: card, card_id: id, id: id });
      });

      if (before) Object.keys(before).forEach(function (id) {
        if (!current[id] && onServer[id]) removals.push({ where: where, method: 'category', card_id: id, id: id });
      });
    });

    return missingCard ? null : { additions: additions, removals: removals };
  }

  function postBookmarks(id, path, payload, callback) {
    if (!payload.length) return callback(null);
    apiRequest('POST', apiUrl('/bookmark/' + path, id), JSON.stringify(payload), 'application/json;charset=UTF-8', function (error, data) {
      callback(error || !data || data.success !== true ? error || 'Сервер не зберіг закладки' : null);
    });
  }

  function postTimecodes(id, callback) {
    var key = timecodeQueueKey(id);
    var queue = readJson(key, {});
    var names = queue && typeof queue === 'object' && !Array.isArray(queue) ? Object.keys(queue) : [];
    var index = 0;
    var serverCards = {};

    function forget(name, entry, done) {
      var latest = readJson(key, {});
      if (latest && JSON.stringify(latest[name]) === JSON.stringify(entry)) {
        delete latest[name];
        if (!writeJson(key, latest)) return callback('Не вдалося оновити чергу офлайн-змін');
      }
      setTimeout(done, 250);
    }

    function sendEntry(name, entry, serverRoad) {
      if (typeof serverRoad === 'string') {
        try { serverRoad = JSON.parse(serverRoad); }
        catch (parseError) { return callback('Некоректний час перегляду на сервері'); }
      }
      var localUpdated = Number(entry.road.updated) || 0;
      var serverUpdated = Number(serverRoad && serverRoad.updated) || 0;
      var serverIsNewer = serverUpdated > localUpdated ||
        (!serverUpdated && !localUpdated && Number(serverRoad && serverRoad.percent) >= Number(entry.road.percent));
      if (serverRoad && serverIsNewer) return forget(name, entry, next);

      var url = apiUrl('/timecode/add', id, { card_id: entry.cardId });
      var body = 'id=' + encodeURIComponent(entry.hash) + '&data=' + encodeURIComponent(JSON.stringify(entry.road));
      apiRequest('POST', url, body, 'application/x-www-form-urlencoded;charset=UTF-8', function (error, data) {
        if (error || !data || data.success !== true) return callback(error || 'Сервер не зберіг час перегляду');
        forget(name, entry, next);
      });
    }

    function next() {
      if (index >= names.length) return callback(null);
      var name = names[index++];
      var entry = queue[name];
      if (!entry || !entry.cardId || !entry.hash || !entry.road) return callback('Некоректна черга часу перегляду');
      if (Object.prototype.hasOwnProperty.call(serverCards, entry.cardId)) {
        return sendEntry(name, entry, serverCards[entry.cardId][entry.hash]);
      }

      apiRequest('GET', apiUrl('/timecode/all', id, { card_id: entry.cardId }), null, '', function (error, data) {
        if (error || !data || typeof data !== 'object' || Array.isArray(data)) return callback(error || 'Сервер не віддав час перегляду');
        serverCards[entry.cardId] = data;
        sendEntry(name, entry, data[entry.hash]);
      });
    }
    next();
  }

  function retryReconcile(message) {
    reconcileInFlight = false;
    if (!syncEnabled()) return;
    if (!reconcileErrorShown) Lampa.Noty.show(message + ' Повторюємо спробу…');
    reconcileErrorShown = true;
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(function () {
      reconcileTimer = 0;
      reconcileBeforeLoad();
    }, reconcileDelay);
    reconcileDelay = Math.min(reconcileDelay * 2, 60000);
    showLastSync();
  }

  function reconcileBeforeLoad() {
    var id = currentId();
    var base = readJson(OFFLINE_BASE_PREFIX + id, null);
    var queue = readJson(timecodeQueueKey(id), {});
    var local = favoriteSnapshot();
    var localJson = JSON.stringify(local);
    var hasLocalBookmarks = BOOKMARK_CATEGORIES.some(function (where) { return Array.isArray(local[where]) && local[where].length; });
    var hasTimecodes = queue && typeof queue === 'object' && Object.keys(queue).length;

    if (reconcileInFlight || !syncEnabled()) return;
    if (!base && !hasTimecodes && (storageGet(RECONCILED_KEY) === id || !hasLocalBookmarks)) {
      loadSync();
      return;
    }
    if (!serverUrl()) return retryReconcile('Не вдалося визначити сервер синхронізації.');

    reconcileInFlight = true;
    showLastSync();
    getBookmarks(id, function (error, remote) {
      if (!syncEnabled() || currentId() !== id) { reconcileInFlight = false; return; }
      if (error) return retryReconcile(error);
      var changes = bookmarkChanges(base, local, remote);
      if (!changes) return retryReconcile('У локальній історії бракує даних картки.');

      postBookmarks(id, 'remove', changes.removals, function (removeError) {
        if (!syncEnabled() || currentId() !== id) { reconcileInFlight = false; return; }
        if (removeError) return retryReconcile(removeError);
        postBookmarks(id, 'add', changes.additions, function (addError) {
          if (!syncEnabled() || currentId() !== id) { reconcileInFlight = false; return; }
          if (addError) return retryReconcile(addError);
          postTimecodes(id, function (timecodeError) {
            if (!syncEnabled() || currentId() !== id) { reconcileInFlight = false; return; }
            if (timecodeError) return retryReconcile(timecodeError);
            getBookmarks(id, function (verifyError, result) {
              if (!syncEnabled() || currentId() !== id) { reconcileInFlight = false; return; }
              if (verifyError) return retryReconcile(verifyError);
              var complete = changes.additions.every(function (item) { return !!idSet(result[item.where])[item.id]; }) &&
                changes.removals.every(function (item) { return !idSet(result[item.where])[item.id]; });
              if (!complete) return retryReconcile('Сервер ще не підтвердив офлайн-зміни.');
              var pendingTimecodes = readJson(timecodeQueueKey(id), {});
              if (JSON.stringify(favoriteSnapshot()) !== localJson ||
                  (pendingTimecodes && typeof pendingTimecodes === 'object' && Object.keys(pendingTimecodes).length)) {
                reconcileInFlight = false;
                return reconcileBeforeLoad();
              }
              try {
                window.localStorage.setItem(RECONCILED_KEY, id);
                window.localStorage.removeItem(OFFLINE_BASE_PREFIX + id);
              } catch (storageError) {
                return retryReconcile('Не вдалося завершити збереження офлайн-змін.');
              }
              reconcileInFlight = false;
              reconcileDelay = 2000;
              reconcileErrorShown = false;
              showLastSync();
              loadSync();
            });
          });
        });
      });
    });
  }

  function closeCabinetFromBackdrop(event) {
    var controller = Lampa.Controller && Lampa.Controller.enabled ? Lampa.Controller.enabled() : null;
    var content = document.querySelector('.settings__content');

    if (event.type === 'click' && Date.now() < ignoreBackdropClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (!cabinetOpen || !document.body.classList.contains('settings--open')) return;
    if (!controller || controller.name !== 'settings_component') return;
    if (content && content.contains(event.target)) return;

    // The stock click handler is unreliable on some mobile browsers.  Preserve
    // Lampa's usual navigation: one tap outside equals one "Back" step.
    ignoreBackdropClickUntil = Date.now() + 500;
    event.preventDefault();
    event.stopImmediatePropagation();
    Lampa.Controller.back();
  }

  function enableBackdropClose() {
    if (window.mylampaAccountBackdropCloseBound) return;
    window.mylampaAccountBackdropCloseBound = true;

    document.addEventListener(window.PointerEvent ? 'pointerup' : 'touchend', closeCabinetFromBackdrop, true);
    document.addEventListener('click', closeCabinetFromBackdrop, true);

    Lampa.Settings.listener.follow('open', function (event) {
      cabinetOpen = !!event && event.name === COMPONENT;
    });
    Lampa.Settings.listener.follow('close', function () {
      cabinetOpen = false;
    });
  }

  function refreshTimelineAfterSyncImport() {
    clearTimeout(timelineRefreshTimer);
    timelineRefreshTimer = setTimeout(function () {
      if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') Lampa.Timeline.read();
    }, 0);
  }

  function watchSyncTimecodes() {
    if (window.mylampaSyncTimecodeWatchBound) return;
    if (!Lampa.Storage || typeof Lampa.Storage.set !== 'function') return;

    window.mylampaSyncTimecodeWatchBound = true;
    var originalSet = Lampa.Storage.set;
    var localTimecodes = {};

    function isTimecodeName(name) {
      return name === 'file_view' || String(name).indexOf('file_view_') === 0;
    }

    function rememberTimecodes(name) {
      localTimecodes[name] = cloneObject(Lampa.Storage.get(name, {}));
    }

    rememberTimecodes('file_view');
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i);
        if (isTimecodeName(key)) rememberTimecodes(key);
      }
    } catch (error) {}

    Lampa.Storage.set = function (name, value, nolisten) {
      if (isTimecodeName(name) && nolisten && value && typeof value === 'object') {
        var previous = localTimecodes[name] || {};
        var activity = Lampa.Storage.get('activity', {});
        var card = activity && (activity.movie || activity.card);
        var cardId = card && card.id ? String(card.id) + '_' + (card.name ? 'tv' : 'movie') : '';

        Object.keys(previous).forEach(function (hash) {
          var oldRoad = previous[hash];
          var newRoad = value[hash];
          if (typeof oldRoad === 'number') oldRoad = { percent: oldRoad, time: 0, duration: 0, updated: 0 };
          if (typeof newRoad === 'number') newRoad = { percent: newRoad, time: 0, duration: 0, updated: 0 };
          if (!oldRoad || typeof oldRoad !== 'object' || !newRoad || typeof newRoad !== 'object') return;
          var oldUpdated = Number(oldRoad.updated) || 0;
          var newUpdated = Number(newRoad.updated) || 0;
          var localIsNewer = oldUpdated > newUpdated ||
            (!oldUpdated && !newUpdated && Number(oldRoad.percent) > Number(newRoad.percent));
          if (!localIsNewer) return;

          value[hash] = cloneObject(oldRoad);
          if (cardId && queueTimecode(currentId(), cardId, hash, oldRoad)) {
            setTimeout(reconcileBeforeLoad, 1000);
          }
        });
      }

      var result = originalSet.apply(Lampa.Storage, arguments);

      // sync.js writes this marker only after a successful import or export.
      if (name === 'lampac_sync_favorite' || name === 'lampac_sync_view') markSynced();

      if (isTimecodeName(name)) {
        localTimecodes[name] = cloneObject(value);
        // The TimeCode plugin writes file_view with nolisten=true. Lampa's
        // Timeline may still hold its earlier in-memory copy.
        if (syncEnabled() && activeSyncId === currentId() && nolisten) refreshTimelineAfterSyncImport();
      }

      return result;
    };

    // A successful /storage/get can legitimately contain no newer data.  It is
    // still a completed synchronization check and deserves an updated status.
    if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
      Lampa.Listener.follow('request_secuses', function (event) {
        var url = event && event.params && event.params.url ? String(event.params.url) : '';
        var storageGet = serverUrl() + '/storage/get';

        if (url.split('?')[0] === storageGet && event.data && event.data.success) markSynced();
      });
    }
  }

  function removeLegacyFlatSync() {
    if (!Lampa.Plugins || typeof Lampa.Plugins.get !== 'function' || typeof Lampa.Plugins.remove !== 'function') return false;
    if (!serverUrl()) return false;

    var flatUrl = serverUrl() + '/sync.js';
    var removed = false;

    Lampa.Plugins.get().forEach(function (plugin) {
      var url = typeof plugin === 'string' ? plugin : plugin && plugin.url;
      if (!url || String(url).split('?')[0] !== flatUrl) return;

      Lampa.Plugins.remove(plugin);
      removed = true;
    });

    if (removed && typeof Lampa.Plugins.save === 'function') Lampa.Plugins.save();
    return removed;
  }

  function loadSync() {
    var id = currentId();
    var base = serverUrl();

    if (window[LOADED_KEY] === id || syncLoadInFlight) return;
    if (!base) {
      if (!syncLoadErrorShown) Lampa.Noty.show('Не вдалося визначити сервер синхронізації.');
      syncLoadErrorShown = true;
      return;
    }

    activeSyncId = id;
    syncLoadInFlight = true;
    Lampa.Utils.putScriptAsync([base + '/sync/js/' + encodeURIComponent(id)], null, function () {
      syncLoadInFlight = false;
      if (!syncEnabled() || currentId() !== id) return;

      // Keep a baseline while the server plugin is unavailable so edits made
      // during its retry window are also sent before a later import.
      rememberOfflineBase();

      if (!syncLoadErrorShown) Lampa.Noty.show('Не вдалося завантажити синхронізацію. Повторюємо спробу…');
      syncLoadErrorShown = true;
      clearTimeout(syncRetryTimer);
      syncRetryTimer = setTimeout(function () {
        syncRetryTimer = 0;
        reconcileBeforeLoad();
      }, syncRetryDelay);
      syncRetryDelay = Math.min(syncRetryDelay * 2, 60000);
    }, function () {
      syncLoadInFlight = false;
      if (!syncEnabled() || currentId() !== id) return;

      window[LOADED_KEY] = id;
      syncRetryDelay = 2000;
      syncLoadErrorShown = false;
      clearTimeout(syncRetryTimer);
      syncRetryTimer = 0;
    });
  }

  function applyJoinedId() {
    var id = normalizeId(Lampa.Storage.get(JOIN_KEY, ''));

    // The input can be opened and closed without entering anything.  In that
    // case leave the cabinet untouched instead of showing a distracting toast.
    if (!id) {
      if (String(Lampa.Storage.get(JOIN_KEY, '')).trim()) Lampa.Noty.show('ID має містити рівно 6 символів: літери, цифри або дефіс.');
      return;
    }

    if (id === currentId()) {
      Lampa.Storage.set(JOIN_KEY, '');
      return;
    }

    Lampa.Storage.set(ID_KEY, id);
    Lampa.Storage.set(JOIN_KEY, '');
    Lampa.Storage.set(LAST_SYNC_KEY, 0, true);
    Lampa.Storage.set(ENABLED_KEY, true);
    reloadSilently();
  }

  function regenerateId() {
    Lampa.Storage.set(ID_KEY, makeId());
    Lampa.Storage.set(JOIN_KEY, '');
    Lampa.Storage.set(LAST_SYNC_KEY, 0, true);
    Lampa.Storage.set(ENABLED_KEY, true);
    reloadSilently();
  }

  function confirmRegenerateId() {
    Lampa.Modal.open({
      title: 'Створити новий ID?',
      html: $('<div class="about"><div>Поточний ID перестане синхронізувати дані. На інших пристроях потрібно буде ввести новий ID.</div></div>'),
      size: 'small',
      buttons: [
        {
          name: 'Створити новий ID',
          onSelect: function () {
            Lampa.Modal.close();
            regenerateId();
          }
        },
        {
          name: 'Скасувати',
          onSelect: function () { Lampa.Modal.close(); }
        }
      ],
      onBack: function () { Lampa.Modal.close(); }
    });
  }

  function addSettings() {
    if (window.mylampaAccountSettingsAdded) return;
    window.mylampaAccountSettingsAdded = true;

    Lampa.SettingsApi.addComponent({
      component: COMPONENT,
      name: 'Кабінет користувача',
      before: 'account',
      icon: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="3.3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 20c.7-4 3-5.9 6.5-5.9s5.8 1.9 6.5 5.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="2.2" y="2.2" width="19.6" height="19.6" rx="3.2" stroke="currentColor" stroke-width="1.5"/></svg>'
    });

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: { name: 'mylampa_sync_last_status', type: 'static' },
      field: {
        name: 'Синхронізовано станом на<br><span class="mylampa-sync-last" style="display:inline-block;margin-top:.28em;color:#71dfff">' + lastSyncText() + '</span>'
      },
      onRender: showLastSync
    });

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: { name: 'mylampa_sync_id_display', type: 'static' },
      field: {
        name: 'Ваш ID для синхронізації<br><span style="display:inline-block;margin-top:.28em;font-family:monospace;letter-spacing:.08em;color:#71dfff">' + currentId() + '</span>',
        description: 'Щоб синхронізувати дані між пристроями, введіть цей ID на іншому вашому пристрої.'
      }
    });

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: {
        name: JOIN_KEY,
        type: 'input',
        values: '',
        placeholder: 'Введіть ID з іншого пристрою',
        default: ''
      },
      field: {
        name: 'Підключити інший пристрій',
        description: 'Введіть ID, показаний на вашому телевізорі або телефоні.'
      },
      onChange: applyJoinedId
    });

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: { name: ENABLED_KEY, type: 'trigger', default: true },
      field: {
        name: 'Синхронізація між пристроями',
        description: 'Після повторного ввімкнення офлайн-зміни спочатку передаються на сервер, а потім завантажуються дані інших пристроїв.'
      },
      onChange: function () {
        if (!syncEnabled() && !rememberOfflineBase()) {
          Lampa.Storage.set(ENABLED_KEY, true);
          reloadSilently();
          return;
        }
        reloadSilently();
      }
    });

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: { name: 'mylampa_sync_regenerate', type: 'button' },
      field: {
        name: 'Створити новий короткий ID',
        description: 'Скидає поточний ID. Підключені пристрої потрібно буде підключити знову.'
      },
      onChange: confirmRegenerateId
    });
  }

  function start() {
    if (!window.Lampa || !Lampa.SettingsApi || !Lampa.Utils || !Lampa.Storage || !Lampa.Settings || !Lampa.Settings.listener) return false;

    if (removeLegacyFlatSync()) {
      Lampa.Noty.show('Оновлюємо синхронізацію MyLampa…');
      setTimeout(function () { window.location.reload(); }, 700);
      return true;
    }

    rememberOfflineTimecodes();
    if (syncEnabled()) {
      watchSyncTimecodes();
      reconcileBeforeLoad();
    }
    addSettings();
    enableBackdropClose();
    return true;
  }

  var wait = setInterval(function () {
    if (start()) clearInterval(wait);
  }, 100);
}());
