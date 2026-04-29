/* We Link — i18n engine */

const I18N_KEY = 'wl_lang';

function getLang() {
  return localStorage.getItem(I18N_KEY) || 'en';
}

function setLang(lang) {
  localStorage.setItem(I18N_KEY, lang);
  applyLang(lang);
}

function t(key) {
  const lang = getLang();
  return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS['en'][key] || key;
}

function applyLang(lang) {
  const strings = TRANSLATIONS[lang] || TRANSLATIONS['en'];

  /* Direction + html lang */
  document.documentElement.lang = lang;
  document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';

  /* Plain-text elements */
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (strings[key] !== undefined) el.textContent = strings[key];
  });

  /* HTML elements (contain <br/>, <em> etc.) */
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (strings[key] !== undefined) el.innerHTML = strings[key];
  });

  /* Input placeholders */
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (strings[key] !== undefined) el.placeholder = strings[key];
  });

  /* Update switcher button state */
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  /* Arabic font — load on demand to keep initial load fast */
  if (lang === 'ar' && !document.getElementById('arabic-font')) {
    const link = document.createElement('link');
    link.id   = 'arabic-font';
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600&display=swap';
    document.head.appendChild(link);
  }

  /* Font override for Arabic */
  document.body.style.fontFamily = lang === 'ar'
    ? "'Cairo', 'Assemblage', 'Cormorant Garamond', serif"
    : '';
}

function initI18n() {
  applyLang(getLang());
}

/* Run on DOM ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initI18n);
} else {
  initI18n();
}
