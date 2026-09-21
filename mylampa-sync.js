(function () {
  'use strict';

  var COMPONENT = 'mylampa_account';
  var ID_KEY = 'mylampa_sync_id';
  var JOIN_KEY = 'mylampa_sync_join_id';
  var LOADED_KEY = 'mylampa_sync_loaded_id';
  var ENABLED_KEY = 'mylampa_sync_enabled';
  var LAST_SYNC_KEY = 'mylampa_last_sync_at';
  var cabinetOpen = false;
  var ignoreBackdropClickUntil = 0;
  var timelineRefreshTimer = 0;

  function normalizeId(value) {
    value = String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    return value.length >= 6 && value.length <= 32 ? value : '';
  }

  function makeId() {
    var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    var values = '';
    var i;

    if (window.crypto && window.crypto.getRandomValues) {
      var bytes = new Uint8Array(6);
      window.crypto.getRandomValues(bytes);
      for (i = 0; i < bytes.length; i++) values += alphabet.charAt(bytes[i] & 31);
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
    return window.location.protocol + '//' + window.location.host;
  }

  function syncEnabled() {
    return String(Lampa.Storage.get(ENABLED_KEY, 'true')) === 'true';
  }

  function lastSyncText() {
    var timestamp = Number(Lampa.Storage.get(LAST_SYNC_KEY, 0));
    var date;

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

  function showLastSync() {
    $('.mylampa-sync-last').text(lastSyncText());
  }

  function markSynced() {
    Lampa.Storage.set(LAST_SYNC_KEY, Date.now(), true);
    showLastSync();
  }

  function reloadSilently() {
    setTimeout(function () { window.location.reload(); }, 80);
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

    Lampa.Storage.set = function (name, value, nolisten) {
      var result = originalSet.apply(Lampa.Storage, arguments);

      // sync.js writes this marker only after a successful import or export.
      if (name === 'lampac_sync_favorite' || name === 'lampac_sync_view') markSynced();

      // The server Sync plugin imports file_view with nolisten=true.  Lampa's
      // Timeline has already read its in-memory copy by then, so refresh it.
      if (nolisten && (name === 'file_view' || String(name).indexOf('file_view_') === 0)) {
        refreshTimelineAfterSyncImport();
      }

      return result;
    };
  }

  function removeLegacyFlatSync() {
    if (!Lampa.Plugins || typeof Lampa.Plugins.get !== 'function' || typeof Lampa.Plugins.remove !== 'function') return false;

    var flatUrl = serverUrl() + '/sync.js';
    var removed = false;

    Lampa.Plugins.get().forEach(function (plugin) {
      if (!plugin || !plugin.url) return;
      if (String(plugin.url).split('?')[0] !== flatUrl) return;

      Lampa.Plugins.remove(plugin.url);
      removed = true;
    });

    if (removed && typeof Lampa.Plugins.save === 'function') Lampa.Plugins.save();
    return removed;
  }

  function loadSync() {
    var id = currentId();

    if (window[LOADED_KEY] === id) return;

    window[LOADED_KEY] = id;
    Lampa.Utils.putScriptAsync([serverUrl() + '/sync/js/' + encodeURIComponent(id)], function () {});
  }

  function applyJoinedId() {
    var id = normalizeId(Lampa.Storage.get(JOIN_KEY, ''));

    // The input can be opened and closed without entering anything.  In that
    // case leave the cabinet untouched instead of showing a distracting toast.
    if (!id) return;

    Lampa.Storage.set(ID_KEY, id);
    Lampa.Storage.set(JOIN_KEY, '');
    Lampa.Storage.set(ENABLED_KEY, true);
    reloadSilently();
  }

  function regenerateId() {
    Lampa.Storage.set(ID_KEY, makeId());
    Lampa.Storage.set(JOIN_KEY, '');
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
        description: 'Увімкніть, щоб синхронізувати закладки та час перегляду між підключеними пристроями.'
      },
      onChange: reloadSilently
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
    if (!window.Lampa || !Lampa.SettingsApi || !Lampa.Utils) return false;

    if (removeLegacyFlatSync()) {
      Lampa.Noty.show('Оновлюємо синхронізацію MyLampa…');
      setTimeout(function () { window.location.reload(); }, 700);
      return true;
    }

    watchSyncTimecodes();
    if (syncEnabled()) loadSync();
    addSettings();
    enableBackdropClose();
    return true;
  }

  var wait = setInterval(function () {
    if (start()) clearInterval(wait);
  }, 100);
}());
