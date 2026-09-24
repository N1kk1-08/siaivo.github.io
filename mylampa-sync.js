(function () {
  'use strict';

  var COMPONENT = 'mylampa_account';
  var SESSION_KEY = 'mylampa_account_session_v1';
  var OWNER_PREFIX = 'mylampa_account_owner_';
  var ACTIVE_KEY = 'mylampa_account_active_v1';
  var GUEST_KEY = 'mylampa_account_guest_v1';
  var BASE_PREFIX = 'mylampa_account_base_';
  var LOCAL_PREFIX = 'mylampa_account_local_';
  var LAST_PREFIX = 'mylampa_account_last_';
  var ARCHIVE_PREFIX = 'mylampa_account_archive_';
  var ENABLED_KEY = 'mylampa_account_enabled';
  var NOTICE_KEY = 'mylampa_account_notice';
  var CATEGORIES = ['history', 'like', 'watch', 'wath', 'book', 'look', 'viewed', 'scheduled', 'continued', 'thrown'];
  var session = null;
  var online = false;
  var remoteDirty = false;
  var syncInFlight = false;
  var retryDelay = 2000;
  var syncErrorShown = false;
  var syncTimer = 0;
  var timecodeTimer = 0;
  var statusTimer = 0;
  var cabinetOpen = false;
  var ignoreBackdropClickUntil = 0;
  var watching = false;
  var timelineBound = false;
  var playerEventsBound = false;
  var importing = false;

  var WORDS = {
    uk: {
      cabinet: 'Кабінет користувача', account: 'Акаунт', guest: 'Ви не увійшли в акаунт',
      owner: 'Власник', register: 'Створити акаунт', login: 'Увійти в акаунт',
      username: 'Ім’я акаунта', password: 'Пароль', repeatPassword: 'Повторіть пароль',
      registerHelp: 'Створіть акаунт власника, а потім увійдіть у нього на інших пристроях.',
      loginHelp: 'Увійдіть з тим самим ім’ям і паролем на іншому пристрої.',
      sync: 'Синхронізація між пристроями', syncHelp: 'Після повторного ввімкнення зміни, зроблені офлайн, будуть об’єднані з даними акаунта.',
      last: 'Остання синхронізація', never: 'Ще не синхронізовано', pending: 'Синхронізація…',
      disabled: 'Синхронізацію вимкнено', logout: 'Вийти з акаунта',
      logoutOthers: 'Вийти з акаунта на інших пристроях',
      logoutOthersHelp: 'Усі інші пристрої втратять доступ до цього акаунта.',
      deleteAccount: 'Видалити акаунт', deleteHelp: 'Видаляє вхід і зупиняє синхронізацію. Історія, закладки й таймкоди залишаться.',
      deleteTitle: 'Видалити акаунт?', deleteText: 'Усі пристрої вийдуть з акаунта. Їхні локальні дані залишаться, а серверна копія збережеться в архіві.',
      confirm: 'Продовжити', cancel: 'Скасувати',
      ownerLogoutNotice: 'Власник акаунта вийшов з акаунта на інших пристроях',
      deletedNotice: 'Акаунт видалено власником',
      nameInvalid: 'Ім’я: 3–32 латинські літери, цифри, крапка, дефіс або підкреслення.',
      passwordInvalid: 'Пароль має містити від 8 до 128 символів.',
      passwordsDiffer: 'Паролі не збігаються.',
      badCredentials: 'Неправильне ім’я акаунта або пароль.',
      nameTaken: 'Це ім’я акаунта вже зайняте.',
      rateLimited: 'Забагато спроб. Спробуйте пізніше.',
      ownerOnly: 'Ця дія доступна лише власнику акаунта.',
      networkError: 'Немає з’єднання із сервером акаунтів.',
      serverError: 'Помилка сервера акаунтів.',
      storageError: 'Не вдалося зберегти дані на пристрої. Перевірте вільне місце та налаштування сховища.',
      syncError: 'Не вдалося синхронізувати дані. Повторимо спробу.',
      syncRejected: 'Сервер відхилив частину даних. Локальна копія збережена; синхронізацію буде повторено.',
      noCard: 'У локальних закладках бракує даних фільму. Синхронізацію відкладено.',
      othersLoggedOut: 'Інші пристрої вийшли з акаунта',
      accountDeleted: 'Акаунт видалено. Дані збережено',
      accountCreated: 'Акаунт створено', accountEntered: 'Вхід виконано'
    },
    ru: {
      cabinet: 'Кабинет пользователя', account: 'Аккаунт', guest: 'Вы не вошли в аккаунт',
      owner: 'Владелец', register: 'Создать аккаунт', login: 'Войти в аккаунт',
      username: 'Имя аккаунта', password: 'Пароль', repeatPassword: 'Повторите пароль',
      registerHelp: 'Создайте аккаунт владельца, затем войдите в него на других устройствах.',
      loginHelp: 'Войдите с тем же именем и паролем на другом устройстве.',
      sync: 'Синхронизация между устройствами', syncHelp: 'После повторного включения изменения, сделанные офлайн, объединятся с данными аккаунта.',
      last: 'Последняя синхронизация', never: 'Ещё не синхронизировано', pending: 'Синхронизация…',
      disabled: 'Синхронизация выключена', logout: 'Выйти из аккаунта',
      logoutOthers: 'Выйти из аккаунта на других устройствах',
      logoutOthersHelp: 'Все остальные устройства потеряют доступ к этому аккаунту.',
      deleteAccount: 'Удалить аккаунт', deleteHelp: 'Удаляет вход и останавливает синхронизацию. История, закладки и таймкоды останутся.',
      deleteTitle: 'Удалить аккаунт?', deleteText: 'Все устройства выйдут из аккаунта. Локальные данные останутся, а серверная копия сохранится в архиве.',
      confirm: 'Продолжить', cancel: 'Отмена',
      ownerLogoutNotice: 'Владелец аккаунта вышел из аккаунта на других устройствах',
      deletedNotice: 'Аккаунт удалён владельцем',
      nameInvalid: 'Имя: 3–32 латинские буквы, цифры, точка, дефис или подчёркивание.',
      passwordInvalid: 'Пароль должен содержать от 8 до 128 символов.',
      passwordsDiffer: 'Пароли не совпадают.',
      badCredentials: 'Неверное имя аккаунта или пароль.',
      nameTaken: 'Это имя аккаунта уже занято.',
      rateLimited: 'Слишком много попыток. Повторите позже.',
      ownerOnly: 'Это действие доступно только владельцу аккаунта.',
      networkError: 'Нет соединения с сервером аккаунтов.',
      serverError: 'Ошибка сервера аккаунтов.',
      storageError: 'Не удалось сохранить данные на устройстве. Проверьте свободное место и настройки хранилища.',
      syncError: 'Не удалось синхронизировать данные. Повторим попытку.',
      syncRejected: 'Сервер отклонил часть данных. Локальная копия сохранена; синхронизация повторится.',
      noCard: 'В локальных закладках не хватает данных фильма. Синхронизация отложена.',
      othersLoggedOut: 'Другие устройства вышли из аккаунта',
      accountDeleted: 'Аккаунт удалён. Данные сохранены',
      accountCreated: 'Аккаунт создан', accountEntered: 'Вход выполнен'
    },
    en: {
      cabinet: 'User account', account: 'Account', guest: 'You are not signed in',
      owner: 'Owner', register: 'Create account', login: 'Sign in',
      username: 'Account name', password: 'Password', repeatPassword: 'Repeat password',
      registerHelp: 'Create the owner account, then sign in on your other devices.',
      loginHelp: 'Use the same account name and password on another device.',
      sync: 'Sync between devices', syncHelp: 'Changes made while sync is off are merged when you turn it back on.',
      last: 'Last synchronization', never: 'Not synchronized yet', pending: 'Synchronizing…',
      disabled: 'Synchronization is off', logout: 'Sign out',
      logoutOthers: 'Sign out on other devices',
      logoutOthersHelp: 'All other devices will lose access to this account.',
      deleteAccount: 'Delete account', deleteHelp: 'Removes sign-in and stops syncing. History, bookmarks and timecodes remain.',
      deleteTitle: 'Delete account?', deleteText: 'All devices will sign out. Local data remains, and the server copy is archived.',
      confirm: 'Continue', cancel: 'Cancel',
      ownerLogoutNotice: 'The account owner signed out on other devices',
      deletedNotice: 'The account was deleted by its owner',
      nameInvalid: 'Name: 3–32 Latin letters, digits, dots, hyphens or underscores.',
      passwordInvalid: 'The password must be 8–128 characters long.',
      passwordsDiffer: 'Passwords do not match.',
      badCredentials: 'Wrong account name or password.',
      nameTaken: 'This account name is already taken.',
      rateLimited: 'Too many attempts. Try again later.',
      ownerOnly: 'Only the account owner can do this.',
      networkError: 'Cannot reach the account server.',
      serverError: 'Account server error.',
      storageError: 'Could not save data on this device. Check free space and storage settings.',
      syncError: 'Could not sync data. Retrying.',
      syncRejected: 'The server rejected some data. The local copy is kept; sync will retry.',
      noCard: 'A local bookmark is missing its movie details. Sync is postponed.',
      othersLoggedOut: 'Other devices signed out',
      accountDeleted: 'Account deleted. Data kept',
      accountCreated: 'Account created', accountEntered: 'Signed in'
    }
  };

  function lang() {
    var code = String(Lampa.Storage.get('language', 'uk')).toLowerCase().split(/[-_]/)[0];
    return WORDS[code] ? code : 'uk';
  }
  function t(key) { return WORDS[lang()][key] || WORDS.uk[key] || key; }
  function notify(message) { if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message); }
  function clone(value, fallback) {
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return fallback; }
  }
  function readJson(key, fallback) {
    try { var value = window.localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
    catch (error) { return fallback; }
  }
  function writeJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { notify(t('storageError')); return false; }
  }
  function storageAvailable() {
    var key = 'mylampa_account_storage_probe';
    try { window.localStorage.setItem(key, 'ok'); window.localStorage.removeItem(key); return true; }
    catch (error) { notify(t('storageError')); return false; }
  }
  function removeLocal(key) { try { window.localStorage.removeItem(key); } catch (error) {} }
  function readLocal(key) { try { return window.localStorage.getItem(key) || ''; } catch (error) { return ''; } }
  function enabled() { return String(Lampa.Storage.get(ENABLED_KEY, true)) !== 'false'; }
  function apiBase() {
    if (window.mylampaAccountApiBase) return String(window.mylampaAccountApiBase).replace(/\/$/, '');
    var source = window.location.protocol === 'http:' || window.location.protocol === 'https:' ?
      window.location.href : String(window.lampa_url || '');
    var match = source.match(/^(https?):\/\/(\[[^\]]+\]|[^/:]+)/i);
    return match ? match[1].toLowerCase() + '://' + match[2] + ':9120' : '';
  }
  function request(method, endpoint, body, callback, token) {
    var base = apiBase();
    if (!base) return callback({ code: 'network_error' });
    var xhr = new XMLHttpRequest();
    var done = false;
    function finish(error, data) {
      if (done) return;
      done = true;
      callback(error, data);
    }
    try {
      xhr.open(method, base + '/account/' + endpoint, true);
      xhr.timeout = 15000;
      xhr.setRequestHeader('Accept', 'application/json');
      if (body !== null) xhr.setRequestHeader('Content-Type', 'application/json');
      if (token || (session && session.token)) xhr.setRequestHeader('Authorization', 'Bearer ' + (token || session.token));
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var data = null;
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
        if (xhr.status >= 200 && xhr.status < 300 && data) finish(null, data);
        else finish({ code: data && data.error || 'server_error', status: xhr.status });
      };
      xhr.onerror = function () { finish({ code: 'network_error' }); };
      xhr.ontimeout = function () { finish({ code: 'network_error' }); };
      xhr.send(body === null ? null : JSON.stringify(body));
    } catch (error) { finish({ code: 'network_error' }); }
  }
  function errorText(error) {
    switch (error && error.code) {
      case 'bad_credentials': return t('badCredentials');
      case 'name_taken': return t('nameTaken');
      case 'rate_limited': return t('rateLimited');
      case 'owner_only': return t('ownerOnly');
      case 'network_error': return t('networkError');
      default: return t('serverError');
    }
  }
  function viewName() {
    return Lampa.Timeline && Lampa.Timeline.filename ? Lampa.Timeline.filename() : 'file_view';
  }
  function localState() {
    var favorite = Lampa.Storage.get('favorite', {});
    var view = Lampa.Storage.get(viewName(), {});
    return {
      favorite: favorite && typeof favorite === 'object' ? clone(favorite, {}) : {},
      timecodes: view && typeof view === 'object' ? clone(view, {}) : {}
    };
  }
  function applyState(state) {
    importing = true;
    try {
      Lampa.Storage.set('favorite', clone(state.favorite || {}, {}), true);
      Lampa.Storage.set(viewName(), clone(state.timecodes || {}, {}), true);
      if (Lampa.Favorite && Lampa.Favorite.init) Lampa.Favorite.init();
      if (Lampa.Timeline && Lampa.Timeline.read) Lampa.Timeline.read();
    } finally { importing = false; }
  }
  function accountKey(prefix) { return prefix + (session && session.user ? session.user.id : ''); }
  function dateText(timestamp) {
    if (!timestamp) return t('never');
    var date = new Date(Number(timestamp));
    if (isNaN(date.getTime())) return t('never');
    try { return date.toLocaleString(lang() === 'uk' ? 'uk-UA' : lang() === 'ru' ? 'ru-RU' : 'en-US'); }
    catch (error) { return date.toLocaleString(); }
  }
  function markLastSync(accountId) {
    try { window.localStorage.setItem(LAST_PREFIX + accountId, String(Date.now())); }
    catch (storageError) {}
  }
  function refreshStatus(item) {
    var root = item && item.find ? item : $(document);
    root.find('.mylampa-account-user').text(session && session.user ?
      session.user.username + (session.user.owner ? ' (' + t('owner') + ')' : '') : t('guest'));
    root.find('.mylampa-account-last').text(syncInFlight ? t('pending') :
      session && !enabled() ? t('disabled') : dateText(readLocal(accountKey(LAST_PREFIX))));
  }
  function refreshVisibility(item) {
    var root = item && item.attr ? item : null;
    if (!root) return;
    var name = root.attr('data-name');
    var logged = !!(session && session.user);
    var owner = logged && session.user.owner;
    if (name === 'mylampa_account_register' || name === 'mylampa_account_login') root.toggle(!logged);
    if (name === ENABLED_KEY || name === 'mylampa_account_logout') root.toggle(logged);
    if (name === 'mylampa_account_logout_others' || name === 'mylampa_account_delete') root.toggle(owner);
    refreshStatus(root);
  }
  function saveCurrentAccountState() {
    if (session && session.user) writeJson(accountKey(LOCAL_PREFIX), localState());
  }
  function leaveAccount(reason, preserveLocal) {
    clearTimeout(syncTimer);
    syncTimer = 0;
    clearTimeout(timecodeTimer);
    timecodeTimer = 0;
    if (session && session.user) saveCurrentAccountState();
    session = null;
    online = false;
    remoteDirty = false;
    removeLocal(SESSION_KEY);
    removeLocal(ACTIVE_KEY);
    var guest = readJson(GUEST_KEY, null);
    if (!preserveLocal && guest) applyState(guest);
    if (reason) writeJson(NOTICE_KEY, reason);
    window.location.reload();
  }
  function onUnauthorized(error) {
    if (!error || error.status !== 401) return false;
    leaveAccount(error.code === 'owner_logout' ? 'ownerLogoutNotice' :
      error.code === 'account_deleted' ? 'deletedNotice' : '', true);
    return true;
  }
  function edit(title, password, callback) {
    Lampa.Input.edit({ title: title, value: '', free: true, nosave: true, nomic: true,
      password: !!password }, function (value) {
      if (typeof value === 'string' && value.length) callback(value);
    });
  }
  function createAccount() {
    if (!storageAvailable()) return;
    edit(t('username'), false, function (rawName) {
      var username = rawName.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username) ||
          username === '__proto__' || username === 'constructor' || username === 'prototype') return notify(t('nameInvalid'));
      edit(t('password'), true, function (password) {
        if (password.length < 8 || password.length > 128) return notify(t('passwordInvalid'));
        edit(t('repeatPassword'), true, function (repeat) {
          if (password !== repeat) return notify(t('passwordsDiffer'));
          request('POST', 'register', { username: username, password: password }, function (error, data) {
            if (error) return notify(errorText(error));
            if (!writeJson(OWNER_PREFIX + username, data.ownerProof)) return;
            if (!writeJson(SESSION_KEY, { token: data.token, user: data.user })) return;
            notify(t('accountCreated'));
            window.location.reload();
          });
        });
      });
    });
  }
  function login() {
    if (!storageAvailable()) return;
    edit(t('username'), false, function (rawName) {
      var username = rawName.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username) ||
          username === '__proto__' || username === 'constructor' || username === 'prototype') return notify(t('nameInvalid'));
      edit(t('password'), true, function (password) {
        var ownerProof = readJson(OWNER_PREFIX + username, '');
        request('POST', 'login', { username: username, password: password, ownerProof: ownerProof }, function (error, data) {
          if (error) return notify(errorText(error));
          if (!writeJson(SESSION_KEY, { token: data.token, user: data.user })) return;
          notify(t('accountEntered'));
          window.location.reload();
        });
      });
    });
  }
  function logout() {
    if (!session) return;
    request('POST', 'logout', {}, function () { leaveAccount('', true); });
  }
  function logoutOthers() {
    if (!session || !session.user.owner) return;
    request('POST', 'logout-others', {}, function (error) {
      if (error) return notify(errorText(error));
      notify(t('othersLoggedOut'));
    });
  }
  function deleteAccount() {
    if (!session || !session.user.owner) return;
    Lampa.Modal.open({
      title: t('deleteTitle'),
      html: $('<div class="about"></div>').text(t('deleteText')),
      size: 'small',
      buttons: [
        { name: t('confirm'), onSelect: function () {
          Lampa.Modal.close();
          edit(t('password'), true, function (password) {
            var baseline = readJson(accountKey(BASE_PREFIX), null);
            var current = localState();
            var pending = changesBetween(baseline && baseline.favorite, current.favorite);
            if (!pending) return notify(t('noCard'));
            pending.timecodes = timecodeChanges(baseline && baseline.timecodes, current.timecodes);
            request('POST', 'delete', { password: password, changes: pending }, function (error, data) {
              if (error) return notify(errorText(error));
              var name = session.user.username;
              if (data && data.archiveId) writeJson(ARCHIVE_PREFIX + session.user.id, data.archiveId);
              removeLocal(OWNER_PREFIX + name);
              removeLocal(accountKey(BASE_PREFIX));
              leaveAccount('accountDeleted', true);
            });
          });
        } },
        { name: t('cancel'), onSelect: function () { Lampa.Modal.close(); } }
      ],
      onBack: function () { Lampa.Modal.close(); }
    });
  }
  function idSet(items) {
    var set = Object.create(null);
    if (Array.isArray(items)) items.forEach(function (item) { set[String(item)] = true; });
    return set;
  }
  function changesBetween(before, after) {
    var categories = {};
    var cards = {};
    var localCards = Object.create(null);
    var allCards = after && after.card;
    if (Array.isArray(allCards)) allCards.forEach(function (card) {
      if (card && card.id !== null && typeof card.id !== 'undefined') localCards[String(card.id)] = card;
    });
    var missingCard = false;
    CATEGORIES.forEach(function (category) {
      var oldList = before && before[category] || [];
      var newList = after && after[category] || [];
      var oldSet = idSet(oldList);
      var newSet = idSet(newList);
      var added = (Array.isArray(newList) ? newList : []).filter(function (id) { return !oldSet[String(id)]; });
      var removed = (Array.isArray(oldList) ? oldList : []).filter(function (id) { return !newSet[String(id)]; });
      added.forEach(function (id) {
        var card = localCards[String(id)];
        if (!card) missingCard = true;
        else cards[String(id)] = card;
      });
      if (added.length || removed.length) categories[category] = { add: added, remove: removed };
    });
    return missingCard ? null : { categories: categories, cards: cards };
  }
  function timecodeChanges(before, after) {
    var changed = {};
    Object.keys(after || {}).forEach(function (hash) {
      var road = after[hash];
      if (typeof road === 'number') road = { percent: road, time: 0, duration: 0, updated: 0 };
      var previous = before && before[hash];
      if (typeof previous === 'number') previous = { percent: previous, time: 0, duration: 0, updated: 0 };
      if (road && typeof road === 'object' && JSON.stringify(road) !== JSON.stringify(previous)) changed[hash] = road;
    });
    return changed;
  }
  function applyFavoritePatch(favorite, patch) {
    var value = clone(favorite, { card: [] });
    if (!Array.isArray(value.card)) value.card = [];
    var cards = Object.create(null);
    value.card.forEach(function (card) { if (card && card.id != null) cards[String(card.id)] = card; });
    Object.keys(patch.categories || {}).forEach(function (category) {
      var change = patch.categories[category];
      var remove = idSet(change.remove);
      var list = (Array.isArray(value[category]) ? value[category] : []).filter(function (id) { return !remove[String(id)]; });
      var have = idSet(list);
      var additions = [];
      change.add.forEach(function (id) {
        if (!have[String(id)]) { additions.push(id); have[String(id)] = true; }
        if (patch.cards[String(id)]) cards[String(id)] = patch.cards[String(id)];
      });
      value[category] = additions.concat(list);
    });
    value.card = Object.keys(cards).map(function (id) { return cards[id]; });
    return value;
  }
  function mergeTimecodes(remote, recent) {
    var merged = clone(remote || {}, {});
    Object.keys(recent || {}).forEach(function (hash) {
      var local = recent[hash];
      if (typeof local === 'number') local = { percent: local, time: 0, duration: 0, updated: 0 };
      if (!local || typeof local !== 'object') return;
      var server = merged[hash];
      if (!server || Number(local.updated || 0) > Number(server.updated || 0) ||
          Number(local.percent || 0) > Number(server.percent || 0) &&
          Number(local.updated || 0) === Number(server.updated || 0)) merged[hash] = local;
    });
    return merged;
  }
  function mergeFirstSignIn(remote, local) {
    var favorite = clone(remote.favorite || {}, {});
    var localFavorite = local.favorite || {};
    var cards = Object.create(null);
    [favorite.card, localFavorite.card].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (card) {
        if (card && card.id !== null && typeof card.id !== 'undefined') cards[String(card.id)] = card;
      });
    });
    CATEGORIES.forEach(function (category) {
      var ids = [];
      var seen = Object.create(null);
      [localFavorite[category], favorite[category]].forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (id) {
          var key = String(id);
          if (!seen[key] && cards[key]) { seen[key] = true; ids.push(id); }
        });
      });
      favorite[category] = ids;
    });
    favorite.card = Object.keys(cards).map(function (id) { return cards[id]; });
    return { favorite: favorite, timecodes: mergeTimecodes(remote.timecodes, local.timecodes) };
  }
  function scheduleSync(delay) {
    if (!session || !online || !enabled()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, delay || 0);
  }
  function acceptServerSnapshot(user) {
    if (!user || !session || !session.user) return;
    var knownRevision = Number(session.user.revision || 0);
    var receivedRevision = Number(user.revision || 0);
    remoteDirty = receivedRevision < knownRevision;
    if (receivedRevision >= knownRevision) session.user = user;
  }
  function syncNow() {
    syncTimer = 0;
    if (!session || !online || !enabled() || syncInFlight) return;
    var accountId = session.user.id;
    var before = readJson(BASE_PREFIX + accountId, null);
    if (!before) return initializeAccount();
    var start = localState();
    var patch = changesBetween(before.favorite, start.favorite);
    if (!patch) { notify(t('noCard')); return scheduleSync(30000); }
    patch.timecodes = timecodeChanges(before.timecodes, start.timecodes);
    var localDirty = !!(Object.keys(patch.categories).length || Object.keys(patch.timecodes).length);
    if (!localDirty && !remoteDirty) return;
    syncInFlight = true;
    refreshStatus();
    request(localDirty ? 'POST' : 'GET', localDirty ? 'sync' : 'state', localDirty ? patch : null, function (error, data) {
      syncInFlight = false;
      refreshStatus();
      if (!session || session.user.id !== accountId) return;
      if (error) {
        if (onUnauthorized(error)) return;
        if (!syncErrorShown) notify(t(error.status === 400 ? 'syncRejected' : 'syncError'));
        syncErrorShown = true;
        scheduleSync(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60000);
        return;
      }
      if (!enabled()) return;
      retryDelay = 2000;
      syncErrorShown = false;
      acceptServerSnapshot(data.user);
      var current = localState();
      var recent = changesBetween(start.favorite, current.favorite);
      if (!recent) { notify(t('noCard')); return scheduleSync(30000); }
      var codes = timecodeChanges(start.timecodes, current.timecodes);
      var remote = { favorite: data.favorite || {}, timecodes: data.timecodes || {} };
      var merged = {
        favorite: applyFavoritePatch(remote.favorite, recent),
        timecodes: mergeTimecodes(remote.timecodes, codes)
      };
      if (!writeJson(BASE_PREFIX + accountId, remote)) return scheduleSync(30000);
      applyState(merged);
      writeJson(LOCAL_PREFIX + accountId, merged);
      markLastSync(accountId);
      refreshStatus();
      if (Object.keys(recent.categories).length || Object.keys(codes).length || remoteDirty) scheduleSync(500);
    });
  }
  function initializeAccount() {
    if (!session || syncInFlight) return;
    var accountId = session.user.id;
    syncInFlight = true;
    request('GET', 'state', null, function (error, data) {
      syncInFlight = false;
      if (!session || session.user.id !== accountId) return;
      if (error) {
        if (onUnauthorized(error)) return;
        if (!syncErrorShown) notify(errorText(error));
        syncErrorShown = true;
        var delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 60000);
        return setTimeout(initializeAccount, delay);
      }
      retryDelay = 2000;
      syncErrorShown = false;
      online = true;
      acceptServerSnapshot(data.user);
      var remote = { favorite: data.favorite || {}, timecodes: data.timecodes || {} };
      var baseline = readJson(BASE_PREFIX + accountId, null);
      if (baseline && (JSON.stringify(baseline.favorite || {}) !== JSON.stringify(remote.favorite) ||
          JSON.stringify(baseline.timecodes || {}) !== JSON.stringify(remote.timecodes))) remoteDirty = true;
      var active = readLocal(ACTIVE_KEY);
      if (active !== accountId || !baseline) {
        var local = localState();
        if (!active) writeJson(GUEST_KEY, local);
        var stored = readJson(LOCAL_PREFIX + accountId, null);
        applyState(baseline && stored ? stored : mergeFirstSignIn(remote, stored || local));
        try { window.localStorage.setItem(ACTIVE_KEY, accountId); } catch (storageError) {}
      }
      if (!baseline) writeJson(BASE_PREFIX + accountId, remote);
      watchChanges();
      var current = localState();
      var before = baseline || remote;
      var pending = changesBetween(before.favorite, current.favorite);
      if (enabled() && !remoteDirty && pending && !Object.keys(pending.categories).length &&
          !Object.keys(timecodeChanges(before.timecodes, current.timecodes)).length) markLastSync(accountId);
      refreshStatus();
      scheduleSync(100);
    });
  }
  function watchChanges() {
    if (!watching && Lampa.Storage.listener && Lampa.Storage.listener.follow) {
      watching = true;
      Lampa.Storage.listener.follow('change', function (event) {
        if (!session || importing || !event || !event.name) return;
        if (event.name === 'favorite') {
          saveCurrentAccountState();
          scheduleSync(1000);
        } else if (String(event.name).indexOf('file_view') === 0) {
          saveCurrentAccountState();
          scheduleTimecodeSync();
        }
      });
    }
    bindTimeline();
    bindPlayerEvents();
  }
  function scheduleTimecodeSync() {
    clearTimeout(timecodeTimer);
    timecodeTimer = setTimeout(function () {
      timecodeTimer = 0;
      scheduleSync(250);
    }, 30000);
  }
  function flushTimecodes() {
    clearTimeout(timecodeTimer);
    timecodeTimer = 0;
    setTimeout(function () {
      if (!session || importing) return;
      saveCurrentAccountState();
      scheduleSync(500);
    }, 500);
  }
  function bindPlayerEvents() {
    if (playerEventsBound) return;
    if (!Lampa.Player || !Lampa.Player.listener || !Lampa.Player.listener.follow ||
        !Lampa.PlayerVideo || !Lampa.PlayerVideo.listener || !Lampa.PlayerVideo.listener.follow) {
      return setTimeout(bindPlayerEvents, 500);
    }
    playerEventsBound = true;
    Lampa.PlayerVideo.listener.follow('pause', flushTimecodes);
    Lampa.PlayerVideo.listener.follow('ended', flushTimecodes);
    Lampa.Player.listener.follow('destroy', flushTimecodes);
  }
  function bindTimeline() {
    if (timelineBound) return;
    if (Lampa.Timeline && Lampa.Timeline.listener && Lampa.Timeline.listener.follow) {
      timelineBound = true;
      Lampa.Timeline.listener.follow('update', function () {
        if (!session || importing) return;
        setTimeout(function () { saveCurrentAccountState(); scheduleTimecodeSync(); }, 500);
      });
    } else setTimeout(bindTimeline, 500);
  }
  function checkSession() {
    if (!session) return;
    var token = session.token;
    request('GET', 'me', null, function (error, data) {
      if (!session || session.token !== token) return;
      if (error) { onUnauthorized(error); return; }
      online = true;
      var knownRevision = Number(session.user.revision || 0);
      var receivedRevision = Number(data.user.revision || 0);
      if (receivedRevision > knownRevision) remoteDirty = true;
      if (receivedRevision >= knownRevision) session.user = data.user;
      refreshStatus();
      if (enabled() && remoteDirty) scheduleSync(250);
    });
  }
  function removeLegacySync() {
    if (!Lampa.Plugins || !Lampa.Plugins.get || !Lampa.Plugins.remove) return false;
    var source = window.location.protocol === 'http:' || window.location.protocol === 'https:' ?
      window.location.href : String(window.lampa_url || '');
    var match = source.match(/^https?:\/\/[^/]+/i);
    if (!match) return false;
    var base = match[0];
    var changed = false;
    Lampa.Plugins.get().forEach(function (plugin) {
      var url = typeof plugin === 'string' ? plugin : plugin && plugin.url;
      if (!url) return;
      var plain = String(url).split('?')[0];
      if (plain !== base + '/sync.js' && plain.indexOf(base + '/sync/js/') !== 0) return;
      Lampa.Plugins.remove(plugin);
      changed = true;
    });
    if (changed && Lampa.Plugins.save) Lampa.Plugins.save();
    return changed;
  }
  function closeCabinetFromBackdrop(event) {
    var controller = Lampa.Controller && Lampa.Controller.enabled ? Lampa.Controller.enabled() : null;
    var content = document.querySelector('.settings__content');
    if (event.type === 'click' && Date.now() < ignoreBackdropClickUntil) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (!cabinetOpen || !document.body.classList.contains('settings--open')) return;
    if (!controller || controller.name !== 'settings_component') return;
    if (content && content.contains(event.target)) return;
    ignoreBackdropClickUntil = Date.now() + 500;
    event.preventDefault(); event.stopImmediatePropagation();
    Lampa.Controller.back();
  }
  function enableBackdropClose() {
    if (window.mylampaAccountBackdropCloseBound) return;
    window.mylampaAccountBackdropCloseBound = true;
    document.addEventListener(window.PointerEvent ? 'pointerup' : 'touchend', closeCabinetFromBackdrop, true);
    document.addEventListener('click', closeCabinetFromBackdrop, true);
    Lampa.Settings.listener.follow('open', function (event) { cabinetOpen = !!event && event.name === COMPONENT; });
    Lampa.Settings.listener.follow('close', function () { cabinetOpen = false; });
  }
  function addSettings() {
    if (window.mylampaAccountSettingsAdded) return;
    window.mylampaAccountSettingsAdded = true;
    Lampa.SettingsApi.addComponent({
      component: COMPONENT, name: t('cabinet'), before: 'account',
      icon: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="3.3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 20c.7-4 3-5.9 6.5-5.9s5.8 1.9 6.5 5.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="2.2" y="2.2" width="19.6" height="19.6" rx="3.2" stroke="currentColor" stroke-width="1.5"/></svg>'
    });
    Lampa.SettingsApi.addParam({ component: COMPONENT,
      param: { name: 'mylampa_account_user', type: 'static' },
      field: { name: t('account') + '<br><span class="mylampa-account-user" style="color:#71dfff"></span>' },
      onRender: function (item) { refreshStatus(item); }
    });
    Lampa.SettingsApi.addParam({ component: COMPONENT,
      param: { name: 'mylampa_account_register', type: 'button' },
      field: { name: t('register'), description: t('registerHelp') },
      onRender: refreshVisibility, onChange: createAccount
    });
    Lampa.SettingsApi.addParam({ component: COMPONENT,
      param: { name: 'mylampa_account_login', type: 'button' },
      field: { name: t('login'), description: t('loginHelp') },
      onRender: refreshVisibility, onChange: login
    });
    Lampa.SettingsApi.addParam({ component: COMPONENT,
      param: { name: ENABLED_KEY, type: 'trigger', default: true },
      field: { name: t('sync'), description: t('syncHelp') },
      onRender: refreshVisibility,
      onChange: function () { if (enabled()) scheduleSync(100); refreshStatus(); }
    });
    Lampa.SettingsApi.addParam({ component: COMPONENT,
      param: { name: 'mylampa_account_last', type: 'static' },
      field: { name: t('last') + '<br><span class="mylampa-account-last" style="color:#71dfff"></span>' },
      onRender: refreshStatus
    });
    Lampa.SettingsApi.addParam({ component: COMPONENT,
      param: { name: 'mylampa_account_logout', type: 'button' },
      field: { name: t('logout') }, onRender: refreshVisibility, onChange: logout
    });
    Lampa.SettingsApi.addParam({ component: COMPONENT,
      param: { name: 'mylampa_account_logout_others', type: 'button' },
      field: { name: t('logoutOthers'), description: t('logoutOthersHelp') },
      onRender: refreshVisibility, onChange: logoutOthers
    });
    Lampa.SettingsApi.addParam({ component: COMPONENT,
      param: { name: 'mylampa_account_delete', type: 'button' },
      field: { name: t('deleteAccount'), description: t('deleteHelp') },
      onRender: refreshVisibility, onChange: deleteAccount
    });
  }
  function start() {
    if (!window.Lampa || !Lampa.SettingsApi || !Lampa.Storage || !Lampa.Settings || !Lampa.Settings.listener || !Lampa.Input) return false;
    if (removeLegacySync()) { setTimeout(function () { window.location.reload(); }, 500); return true; }
    var notice = readJson(NOTICE_KEY, '');
    if (notice) { removeLocal(NOTICE_KEY); setTimeout(function () { notify(t(notice)); }, 700); }
    session = readJson(SESSION_KEY, null);
    addSettings();
    enableBackdropClose();
    if (session && session.token && session.user && session.user.id && session.user.username) {
      initializeAccount();
      statusTimer = setInterval(checkSession, 15000);
    } else session = null;
    refreshStatus();
    return true;
  }
  var wait = setInterval(function () { if (start()) clearInterval(wait); }, 100);
}());
