(function () {
  'use strict';

  var COMPONENT = 'mylampa_account';
  var ID_KEY = 'mylampa_sync_id';
  var JOIN_KEY = 'mylampa_sync_join_id';
  var LOADED_KEY = 'mylampa_sync_loaded_id';

  function normalizeId(value) {
    value = String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    return value.length >= 12 && value.length <= 96 ? value : '';
  }

  function makeId() {
    var values = [];
    var i;

    if (window.crypto && window.crypto.getRandomValues) {
      var bytes = new Uint32Array(4);
      window.crypto.getRandomValues(bytes);
      for (i = 0; i < bytes.length; i++) values.push(bytes[i].toString(36));
    } else {
      for (i = 0; i < 4; i++) values.push(Math.floor(Math.random() * 0xFFFFFFFF).toString(36));
    }

    return 'ml-' + values.join('-');
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

    if (!id) {
      Lampa.Noty.show('Введіть коректний ID користувача');
      return;
    }

    Lampa.Storage.set(ID_KEY, id);
    Lampa.Storage.set(JOIN_KEY, '');
    Lampa.Noty.show('ID підключено. Lampa перезапускається…');
    setTimeout(function () { window.location.reload(); }, 700);
  }

  function addSettings() {
    if (window.mylampaAccountSettingsAdded) return;
    window.mylampaAccountSettingsAdded = true;

    Lampa.SettingsApi.addComponent({
      component: COMPONENT,
      name: 'Кабінет користувача',
      icon: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="3.3" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 20c.7-4 3-5.9 6.5-5.9s5.8 1.9 6.5 5.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="2.2" y="2.2" width="19.6" height="19.6" rx="3.2" stroke="currentColor" stroke-width="1.5"/></svg>'
    });

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: { name: ID_KEY, type: 'input', values: '', default: currentId() },
      field: {
        name: 'Ваш ID для синхронізації',
        description: 'Щоб синхронізувати дані між пристроями, введіть цей ID на іншому вашому пристрої.'
      },
      onChange: function (value) {
        var id = normalizeId(value);
        if (id && id !== currentId()) {
          Lampa.Storage.set(ID_KEY, id);
          Lampa.Noty.show('ID змінено. Перезапустіть Lampa для синхронізації.');
        }
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
      }
    });

    Lampa.SettingsApi.addParam({
      component: COMPONENT,
      param: { name: 'mylampa_sync_join_apply', type: 'trigger', default: false },
      field: {
        name: 'Підключити синхронізацію',
        description: 'Після підтвердження Lampa автоматично перезапуститься.'
      },
      onChange: applyJoinedId
    });
  }

  function start() {
    if (!window.Lampa || !Lampa.SettingsApi || !Lampa.Utils) return false;

    if (removeLegacyFlatSync()) {
      Lampa.Noty.show('Оновлюємо синхронізацію MyLampa…');
      setTimeout(function () { window.location.reload(); }, 700);
      return true;
    }

    loadSync();
    addSettings();
    return true;
  }

  var wait = setInterval(function () {
    if (start()) clearInterval(wait);
  }, 100);
}());
