(() => {
  'use strict';

  const WA_NUMBER = '33652807488';
  const WA_DEFAULT =
    'Bonjour AJ-VTC, je souhaite réserver un trajet.\n' +
    'Date : \nHeure : \nLieu de prise en charge : \nDestination : \nNombre de passagers : ';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;

  /* ---------- WhatsApp links ---------- */
  document.querySelectorAll('[data-wa]').forEach((el) => {
    const custom = el.getAttribute('data-wa');
    const message = custom ? `${custom}\nDate : \nHeure : \nNombre de passagers : ` : WA_DEFAULT;
    el.href = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;
    el.target = '_blank';
    el.rel = 'noopener';
  });

  /* ---------- Year ---------- */
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  /* ---------- Entrance sequence ---------- */
  const firstImg = document.querySelector('.slide.is-active img');
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    requestAnimationFrame(() => root.classList.add('is-loaded'));
  };
  if (!firstImg || firstImg.complete) start();
  else {
    firstImg.addEventListener('load', start, { once: true });
    firstImg.addEventListener('error', start, { once: true });
    setTimeout(start, 1800); // never hold the page hostage to a slow image
  }

  /* ---------- Navigation ---------- */
  const nav = document.getElementById('nav');
  const toggle = nav.querySelector('.nav__toggle');
  const menu = document.getElementById('nav-menu');

  const fab = document.querySelector('.fab');
  const onScroll = () => {
    nav.classList.toggle('is-solid', window.scrollY > 40);
    fab.classList.toggle('is-shown', window.scrollY > window.innerHeight * 0.6);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const setMenu = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    document.body.classList.toggle('no-scroll', open);
    if (open) menu.querySelector('a')?.focus();
  };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setMenu(false);
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 1140px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

  /* ---------- Hero carousel ---------- */
  const hero = document.querySelector('.hero');
  const slides = [...hero.querySelectorAll('.slide')];
  const segs = [...hero.querySelectorAll('.seg')];
  const pauseBtn = document.getElementById('hero-pause');
  const indexEl = document.getElementById('hero-index');
  const titleEl = document.getElementById('hero-title');
  const subEl = document.getElementById('hero-sub');
  const FADE_MS = 1600;
  let current = 0;
  let userPaused = reducedMotion.matches;

  const syncPaused = () => {
    // Pause while keyboard focus is inside the hero (not after a mouse/touch tap on a control).
    const engaged = !!hero.querySelector(':focus-visible');
    const paused = userPaused || engaged || document.hidden;
    hero.classList.toggle('is-paused', paused);
    pauseBtn.setAttribute('aria-pressed', String(userPaused));
    pauseBtn.setAttribute('aria-label', userPaused ? 'Reprendre le diaporama' : 'Mettre le diaporama en pause');
  };

  const goTo = (next) => {
    next = (next + slides.length) % slides.length;
    if (next === current) return;

    const prev = slides[current];
    prev.classList.remove('is-active');
    prev.classList.add('is-leaving');
    setTimeout(() => prev.classList.remove('is-leaving'), FADE_MS);

    slides[next].classList.add('is-active');

    segs.forEach((seg, i) => {
      seg.classList.toggle('is-done', i < next);
      seg.classList.remove('is-active');
      seg.removeAttribute('aria-current');
    });
    // Restart the progress animation on the newly active segment.
    void segs[next].offsetWidth;
    segs[next].classList.add('is-active');
    segs[next].setAttribute('aria-current', 'true');

    indexEl.textContent = String(next + 1).padStart(2, '0');
    titleEl.textContent = slides[next].dataset.title;
    subEl.textContent = slides[next].dataset.sub;
    hero.classList.remove('caption-in');
    void hero.offsetWidth;
    hero.classList.add('caption-in');

    current = next;
  };

  // The progress fill's animation drives autoplay, so pause state is a pure CSS concern.
  segs.forEach((seg, i) => {
    seg.addEventListener('click', () => goTo(i));
    seg.querySelector('.seg__fill').addEventListener('animationend', () => {
      if (i === current && !userPaused) goTo(current + 1);
    });
  });
  document.getElementById('hero-prev').addEventListener('click', () => goTo(current - 1));
  document.getElementById('hero-next').addEventListener('click', () => goTo(current + 1));
  pauseBtn.addEventListener('click', () => {
    userPaused = !userPaused;
    syncPaused();
  });

  hero.addEventListener('keydown', (e) => {
    if (e.target.closest('a')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
  });
  ['focusin', 'focusout'].forEach((ev) =>
    hero.addEventListener(ev, () => setTimeout(syncPaused, 0))
  );
  document.addEventListener('visibilitychange', syncPaused);
  reducedMotion.addEventListener('change', (e) => { userPaused = e.matches; syncPaused(); });

  // Touch swipe
  let touchX = null;
  hero.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) goTo(current + (dx < 0 ? 1 : -1));
    touchX = null;
  });

  syncPaused();

  /* ---------- Scroll reveal (section heads + circuit images only) ---------- */
  const revealEls = document.querySelectorAll('.reveal, .reveal-media');
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }
})();
