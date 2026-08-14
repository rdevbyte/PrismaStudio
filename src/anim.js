/* ============================================================
   PrismaStudio — Animation layer (GSAP 3)
   Charts animate in when scrolled into view, and re-animate when
   their data changes. Honours prefers-reduced-motion.
   ============================================================ */
(function (global) {
  'use strict';
  const gsap = global.gsap;
  const REDUCED = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const EASE_OUT = 'power3.out';
  const EASE_BACK = 'back.out(1.6)';

  if (gsap && !REDUCED) {
    // overwrite:'auto' kills conflicting tweens on the same property, so
    // re-rendering a chart mid-animation can't leave a stale tween fighting
    // the new one (which would freeze bars at their old width).
    gsap.defaults({ ease: EASE_OUT, duration: 0.6, overwrite: 'auto' });
  }

  /* ---------- per-chart-type entrance timelines ---------- */
  function animateSvg(svg) {
    if (!gsap || REDUCED || svg.dataset.animated === '1') return;
    svg.dataset.animated = '1';
    const kind = svg.dataset.anim || guessKind(svg);
    // clear any in-flight tweens on this chart's elements before restarting
    gsap.killTweensOf(svg.querySelectorAll('*'));
    const tl = gsap.timeline();

    switch (kind) {
      case 'barH': {
        const bars = svg.querySelectorAll('rect[data-bar]');
        const vals = svg.querySelectorAll('text[data-val]');
        if (bars.length) {
          // Collapse every bar to zero-width at its baseline, then grow outward.
          // Uses an explicit stagger (never relative offsets, which can push
          // tween start times negative and render bars already complete).
          bars.forEach((b) => gsap.set(b, { attr: { width: 0, x: +b.dataset.zero } }));
          tl.to(bars, {
            attr: {
              width: (i, t) => +t.dataset.w,
              x: (i, t) => +t.dataset.x,
            },
            duration: 0.62,
            stagger: Math.min(0.05, 1.2 / bars.length),
          }, 0);
        }
        if (vals.length) tl.from(vals, { opacity: 0, x: -8, duration: 0.35, stagger: Math.min(0.03, 0.8 / vals.length) }, 0.18);
        break;
      }
      case 'bars': { // vertical bars (histogram, pareto)
        const bars = svg.querySelectorAll('rect[data-bar]');
        if (bars.length) {
          bars.forEach((b) => gsap.set(b, { attr: { height: 0, y: +b.dataset.base } }));
          tl.to(bars, {
            attr: {
              height: (i, t) => +t.dataset.h,
              y: (i, t) => +t.dataset.y,
            },
            duration: 0.55,
            stagger: Math.min(0.035, 1.0 / bars.length),
          }, 0);
        }
        break;
      }
      case 'line': {
        const paths = svg.querySelectorAll('polyline[data-line]');
        paths.forEach((p, i) => {
          const len = p.getTotalLength ? p.getTotalLength() : 1000;
          gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
          tl.to(p, { strokeDashoffset: 0, duration: 1.15, ease: 'none' }, i * 0.18);
        });
        const band = svg.querySelector('[data-band]');
        if (band) tl.from(band, { opacity: 0, duration: 0.7 }, 0.5);
        const dots = svg.querySelectorAll('[data-dot]');
        if (dots.length) tl.from(dots, { scale: 0, transformOrigin: '50% 50%', duration: 0.4, ease: EASE_BACK, stagger: 0.05 }, '-=0.5');
        break;
      }
      case 'scatter': {
        // One path holds every point, so this is a single tween rather than
        // one per marker — keeps the Explore tab responsive on large files.
        const cloud = svg.querySelector('path[data-pts]');
        if (cloud) tl.from(cloud, { opacity: 0, scale: 0.94, transformOrigin: '50% 50%', duration: 0.55 });
        const pts = svg.querySelectorAll('circle[data-pt]');
        if (pts.length) tl.from(pts, { scale: 0, opacity: 0, transformOrigin: '50% 50%', duration: 0.5, stagger: { each: 0.004, from: 'random' } }, 0);
        const fit = svg.querySelector('[data-fit]');
        if (fit) {
          const len = fit.getTotalLength ? fit.getTotalLength() : 600;
          gsap.set(fit, { strokeDasharray: len, strokeDashoffset: len });
          tl.to(fit, { strokeDashoffset: 0, duration: 0.7 }, '-=0.3');
        }
        break;
      }
      case 'heatmap': {
        const cells = svg.querySelectorAll('rect[data-cell]');
        tl.from(cells, {
          opacity: 0, scale: 0.72, transformOrigin: '50% 50%',
          duration: 0.42, stagger: { each: 0.012, from: 'start' },
        });
        tl.from(svg.querySelectorAll('.cellv'), { opacity: 0, duration: 0.3, stagger: 0.008 }, '-=0.35');
        break;
      }
      case 'donut': {
        const slices = svg.querySelectorAll('path[data-slice]');
        tl.from(slices, { opacity: 0, scale: 0.6, transformOrigin: '50% 50%', duration: 0.55, stagger: 0.06, ease: EASE_BACK });
        break;
      }
      case 'box': {
        const boxes = svg.querySelectorAll('[data-box]');
        const whisks = svg.querySelectorAll('[data-whisk]');
        tl.from(whisks, { scaleX: 0, transformOrigin: '50% 50%', duration: 0.5, stagger: 0.04 });
        tl.from(boxes, { scaleX: 0, transformOrigin: '50% 50%', duration: 0.5, stagger: 0.04 }, '-=0.4');
        break;
      }
      default:
        tl.from(svg, { opacity: 0, y: 12, duration: 0.5 });
    }
    return tl;
  }

  function guessKind(svg) {
    if (svg.querySelector('[data-slice]')) return 'donut';
    if (svg.querySelector('[data-cell]')) return 'heatmap';
    if (svg.querySelector('[data-line]')) return 'line';
    if (svg.querySelector('[data-pt],[data-pts]')) return 'scatter';
    if (svg.querySelector('[data-bar]')) return 'barH';
    return 'fade';
  }

  /* ---------- scroll-triggered reveal (IntersectionObserver) ----------
     Elements re-animate every time they re-enter the viewport, so scrolling
     away and coming back replays the motion. Observers are kept (never
     unobserved) and elements are re-armed once they leave the viewport.   */

  let observer = null;
  function ensureObserver() {
    if (observer || !('IntersectionObserver' in global)) return observer;
    observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const t = e.target;
        if (e.isIntersecting) {
          if (t.tagName.toLowerCase() === 'svg') animateSvg(t);
          else revealCard(t);
        } else {
          // Left the viewport — re-arm so it plays again on the way back.
          rearm(t);
        }
      });
    }, { rootMargin: '0px 0px -5% 0px', threshold: 0.05 });
    return observer;
  }

  // Re-arm only when fully outside the viewport, so a partially visible
  // element is never yanked back to opacity:0 while the user is looking at it.
  function rearm(node) {
    const r = node.getBoundingClientRect();
    const fullyOut = r.bottom < -20 || r.top > innerHeight + 20;
    if (!fullyOut) return;
    if (node.tagName.toLowerCase() === 'svg') {
      node.dataset.animated = '';
    } else if (node.dataset.revealed === '1') {
      node.dataset.revealed = '';
    }
  }

  // Safety net: anything registered must be visible if it is on screen.
  // Guarantees content can never be stranded at opacity:0.
  function sweep() {
    if (!gsap || REDUCED) return;
    document.querySelectorAll('[data-reveal-armed="1"]').forEach((node) => {
      if (!isLaidOut(node)) return;
      const r = node.getBoundingClientRect();
      const onScreen = r.top < innerHeight && r.bottom > 0;
      if (onScreen && node.dataset.revealed !== '1') revealCard(node);
    });
    document.querySelectorAll('svg.chart[data-anim-armed="1"]').forEach((svg) => {
      if (!isLaidOut(svg)) return;
      const r = svg.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0 && svg.dataset.animated !== '1') animateSvg(svg);
    });
  }
  let sweepTimer = null;
  function scheduleSweep() {
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(sweep, 100);
  }
  if (typeof addEventListener === 'function') {
    addEventListener('scroll', scheduleSweep, { passive: true });
    addEventListener('resize', scheduleSweep, { passive: true });
  }

  function revealCard(node) {
    if (!gsap || REDUCED || node.dataset.revealed === '1') return;
    node.dataset.revealed = '1';
    gsap.killTweensOf(node);
    gsap.fromTo(node, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: EASE_OUT, overwrite: 'auto' });
  }

  /* ---------- public API ---------- */
  // Register everything inside a container for scroll-reveal.
  // True only when the element actually occupies space. Elements inside a
  // display:none tab pane have zero dimensions, and IntersectionObserver will
  // never report them as intersecting — so we must not hand them to the
  // observer or prime them to opacity:0, or they stay invisible/static forever.
  function isLaidOut(node) {
    return !!(node.getClientRects().length && node.getBoundingClientRect().width > 0);
  }

  function observe(root) {
    if (!gsap || REDUCED || !root) return;
    // A hidden pane has no layout yet; retry once it is displayed.
    if (root !== document && root.nodeType === 1 && !isLaidOut(root)) {
      root.dataset.animPending = '1';
      return;
    }
    delete root.dataset.animPending;
    const obs = ensureObserver();
    const svgs = [...root.querySelectorAll('svg.chart')];
    const cards = [...root.querySelectorAll('.card, .finding, .subcard, .kpi')];

    if (!obs) { // no IntersectionObserver: show everything, animate immediately
      cards.forEach((c) => { c.dataset.revealed = '1'; gsap.set(c, { opacity: 1 }); });
      svgs.forEach(animateSvg);
      return;
    }

    cards.forEach((c) => {
      if (!isLaidOut(c)) return;
      const r = c.getBoundingClientRect();
      const onScreen = r.top < innerHeight && r.bottom > 0;
      if (c.dataset.revealArmed !== '1') {
        c.dataset.revealArmed = '1';
        obs.observe(c);
      }
      if (onScreen) revealCard(c);
      else if (c.dataset.revealed !== '1') gsap.set(c, { opacity: 0 });
    });

    svgs.forEach((sv) => {
      if (!isLaidOut(sv)) { animateSvg(sv); return; }
      if (sv.dataset.animArmed !== '1') {
        sv.dataset.animArmed = '1';
        obs.observe(sv);
      }
      const r = sv.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) animateSvg(sv);
    });
    scheduleSweep();
  }

  // Force-animate a freshly rendered container (e.g. after a control change).
  // Waits one frame so the new markup has been laid out before we measure it.
  function play(root) {
    if (!gsap || REDUCED || !root) return;
    requestAnimationFrame(() => {
      root.querySelectorAll('svg.chart').forEach((s) => {
        s.dataset.animated = '';
        animateSvg(s);
      });
    });
  }

  // Count-up for KPI numbers.
  function countUp(node, to, format) {
    if (!gsap || REDUCED) { node.textContent = format(to); return; }
    const o = { v: 0 };
    gsap.to(o, {
      v: to, duration: 1.1, ease: 'power2.out',
      onUpdate: () => { node.textContent = format(o.v); },
    });
  }

  // Tab switch transition. The pane has only just become visible, so wait one
  // frame for layout before measuring anything for the reveal.
  function swapTab(pane) {
    if (!gsap || REDUCED) return;
    gsap.fromTo(pane, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: EASE_OUT });
    requestAnimationFrame(() => observe(pane));
  }

  // Dashboard entrance.
  function enterDashboard(root) {
    if (!gsap || REDUCED) return;
    const tl = gsap.timeline();
    tl.from(root.querySelector('.filebar'), { opacity: 0, y: -10, duration: 0.4 })
      .from(root.querySelector('.summary'), { opacity: 0, y: 14, duration: 0.5 }, '-=0.2')
      .from(root.querySelectorAll('.kpi'), { opacity: 0, y: 16, scale: 0.96, duration: 0.45, stagger: 0.05 }, '-=0.25')
      .from(root.querySelector('.tabs'), { opacity: 0, duration: 0.35 }, '-=0.2');
    return tl;
  }

  function modalIn(node) {
    if (!gsap || REDUCED) return;
    gsap.from(node, { opacity: 0, scale: 0.96, y: 10, duration: 0.32, ease: EASE_OUT });
  }

  global.PrismaAnim = { observe, play, countUp, swapTab, enterDashboard, modalIn, animateSvg, REDUCED, enabled: !!gsap && !REDUCED };
})(typeof window !== 'undefined' ? window : globalThis);
