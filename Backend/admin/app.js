/**
 * Back-office Aston La Scala : démarrage (Alpine.js, sans étape de build).
 * Les écrans sont dans views/ : un fragment HTML + son composant (views/<nom>.js).
 */
import Alpine from '/admin/vendor/alpine.js';
import './lib/stores.js';
import * as format from './lib/format.js';
import { counterClass, snippet } from './lib/components.js';
import { navigation, isActive, icon, startRouter, rerender } from './lib/router.js';
import './views/home.js';
import './views/pages.js';
import './views/texts.js';
import './views/collections.js';
import './views/media.js';
import './views/banners.js';
import './views/popups.js';
import './views/languages.js';
import './views/builds.js';
import './views/stats.js';
import './views/admin.js';

Alpine.magic('fmt', () => ({ ...format, counterClass, snippet }));
Alpine.magic('icon', () => icon);

Alpine.data('shell', () => ({
  get nav() { return navigation(); },
  isActive(href) { return isActive(href, this.$store.route.path); },
}));

Alpine.data('loginForm', () => ({
  email: '',
  password: '',
  error: '',
  busy: false,
  async submit() {
    this.error = '';
    this.busy = true;
    try {
      await this.$store.session.login(this.email.trim(), this.password);
      this.password = '';
      // Venu de la prévisualisation : on y retourne (jamais vers un autre site)
      const next = new URLSearchParams(location.search).get('next');
      if (next && next.startsWith('/preview/')) location.assign(next);
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = false;
    }
  },
}));

let routerStarted = false;
window.addEventListener('admin:ready', () => {
  if (routerStarted) rerender();
  else {
    routerStarted = true;
    startRouter();
  }
});
window.addEventListener('admin:expired', () => {
  if (Alpine.store('session').state !== 'ready') return;
  Alpine.store('session').reset();
  Alpine.store('toast').push('Votre session a expiré : reconnectez-vous.', 'error');
});

window.Alpine = Alpine;
Alpine.start();
Alpine.store('session').load();
