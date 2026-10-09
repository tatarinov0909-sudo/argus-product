(function () {
  'use strict';
  var supported = !!(window.fetch && window.indexedDB && window.crypto && typeof window.crypto.randomUUID === 'function');
  try { supported = supported && new Function('return ({value:1})?.value === 1;')(); }
  catch (error) { supported = false; }
  if (!supported) window.location.replace('unsupported.html');
})();
