/* =============================================================================
   NOGAL — Interacciones de la página
   Navbar (scroll, menú móvil, sección activa), reveal on scroll, catálogo,
   widget flotante, botón de acceso al ERP y formulario de contacto.
   ========================================================================== */
(function () {
  "use strict";
  var CFG = window.NOGAL_CONFIG || {};
  var DATA = window.NOGAL_DATA || { products: [] };
  var CHAT = window.NOGAL_CHAT || null;
  var esc = CHAT ? CHAT.escapeHtml : function (s) { return String(s); };
  var hasIO = "IntersectionObserver" in window;

  /* ---------- Navbar: sombra al hacer scroll ------------------------------ */
  var nav = document.getElementById("nav");
  function onScroll() { nav.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Menú móvil --------------------------------------------------- */
  var toggle = document.getElementById("navToggle");
  var menu = document.getElementById("mobileMenu");

  function setMenu(open) {
    menu.classList.toggle("open", open);
    toggle.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
  }
  toggle.addEventListener("click", function (e) {
    e.stopPropagation();
    setMenu(!menu.classList.contains("open"));
  });
  menu.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("click", function (e) {
    if (menu.classList.contains("open") && !menu.contains(e.target)) setMenu(false);
  });
  // Al pasar a escritorio el menú móvil deja de tener sentido.
  var desktopMq = window.matchMedia("(min-width: 900px)");
  function onDesktop(mq) { if (mq.matches) setMenu(false); }
  if (desktopMq.addEventListener) desktopMq.addEventListener("change", onDesktop);
  else desktopMq.addListener(onDesktop);

  /* ---------- Reveal on scroll -------------------------------------------- */
  var revealIO = hasIO ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add("in"); revealIO.unobserve(en.target); }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }) : null;

  function reveal(nodes) {
    Array.prototype.forEach.call(nodes, function (n) {
      if (revealIO) revealIO.observe(n); else n.classList.add("in");
    });
  }

  /* ---------- Sección activa en la navegación ----------------------------- */
  var navLinks = document.querySelectorAll('.nav-links a[href^="#"], .mobile-menu a[href^="#"]');
  function setActive(id) {
    navLinks.forEach(function (a) {
      if (a.getAttribute("href") === "#" + id) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  }
  if (hasIO) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) setActive(en.target.id); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main > section").forEach(function (s) { spy.observe(s); });
  }

  /* ---------- Catálogo ---------------------------------------------------- */
  var grid = document.getElementById("catalogGrid");
  var catalogNote = document.getElementById("catalogNote");

  function cardHtml(p) {
    var low = p.stock < (DATA.lowStockThreshold || 40);
    var stock = Number(p.stock).toLocaleString("es-PE") + " " + esc(p.unit);
    return '<article class="card reveal">' +
      '<img class="thumb" src="' + esc(p.image) + '" alt="' + esc(p.alt || p.name) + '" loading="lazy" width="400" height="300" />' +
      '<div class="card-body">' +
        '<span class="tag">' + esc(p.category) + "</span>" +
        "<h3>" + esc(p.name) + "</h3>" +
        "<p>" + esc(p.description) + "</p>" +
        '<div class="meta">' +
          '<span class="stock' + (low ? " low" : "") + '"><i class="dot" aria-hidden="true"></i> ' +
            (low ? "Stock bajo · " + stock : stock + " disponibles") + "</span>" +
          '<span class="sku">SKU · ' + esc(p.sku) + "</span>" +
        "</div>" +
        '<button class="card-ask" type="button" data-question="¿Cuánto stock hay de ' + esc(p.name) + '?">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
          "Consultar al asistente" +
        "</button>" +
      "</div>" +
    "</article>";
  }

  function renderCatalog(products) {
    if (!grid) return;
    grid.innerHTML = products.map(cardHtml).join("");
    reveal(grid.querySelectorAll(".reveal"));
  }

  function hasStock(p) {
    return p && typeof p.sku === "string" && p.stock !== null && p.stock !== "" && isFinite(p.stock);
  }
  function isFullProduct(p) {
    return hasStock(p) && typeof p.name === "string" && typeof p.unit === "string";
  }

  /* El endpoint puede devolver productos completos o solo el stock
     ([{ sku, stock }]). Lo recibido se fusiona por SKU con los datos locales;
     los SKU desconocidos solo se agregan si traen la ficha completa. */
  function mergeProducts(local, remote) {
    var bySku = {};
    remote.forEach(function (it) { if (hasStock(it)) bySku[it.sku] = it; });
    var matched = 0;
    var merged = local.map(function (p) {
      var it = bySku[p.sku];
      if (!it) return p;
      matched++;
      delete bySku[p.sku];
      var copy = {}, k;
      for (k in p) copy[k] = p[k];
      for (k in it) copy[k] = it[k];
      copy.stock = Number(it.stock);
      return copy;
    });
    Object.keys(bySku).forEach(function (sku) {
      if (isFullProduct(bySku[sku])) { merged.push(bySku[sku]); matched++; }
    });
    return matched ? merged : null;
  }

  renderCatalog(DATA.products);

  if (CFG.catalogEndpoint && window.fetch) {
    fetch(CFG.catalogEndpoint, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (json) {
        var list = Array.isArray(json) ? json : json && json.products;
        var merged = Array.isArray(list) && mergeProducts(DATA.products, list);
        if (!merged) throw new Error("respuesta sin productos reconocibles");
        DATA.products = merged; // el asistente demo también pasa a usar estos datos
        renderCatalog(merged);
        if (catalogNote) {
          catalogNote.textContent = "Stock sincronizado a las " +
            new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) + ".";
        }
      })
      .catch(function (err) {
        console.warn("[NOGAL catálogo] se usan datos locales:", err);
      });
  }

  /* ---------- Widget flotante de chat ------------------------------------- */
  var fab = document.getElementById("fab");
  var panel = document.getElementById("fabPanel");
  var fabClose = document.getElementById("fabClose");
  var fabInput = document.getElementById("fabInput");
  var badge = fab.querySelector(".badge");
  var demoInView = false;

  if (badge && CHAT && CHAT.hasHistory()) badge.hidden = true;

  function isOpen() { return panel.classList.contains("open"); }
  function syncFab() { fab.classList.toggle("is-hidden", demoInView && !isOpen()); }

  function setPanel(open) {
    panel.classList.toggle("open", open);
    panel.inert = !open; // cerrado: fuera del orden de tabulación
    fab.setAttribute("aria-expanded", String(open));
    fab.setAttribute("aria-label", open ? "Cerrar asistente de inventario" : "Abrir asistente de inventario");
    if (open) {
      if (badge) badge.hidden = true;
      setTimeout(function () { fabInput.focus(); }, 150);
    } else if (panel.contains(document.activeElement)) {
      fab.focus();
    }
    syncFab();
  }
  panel.inert = true;

  fab.addEventListener("click", function () { setPanel(!isOpen()); });
  fabClose.addEventListener("click", function () { setPanel(false); });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (isOpen()) setPanel(false);
    else if (menu.classList.contains("open")) { setMenu(false); toggle.focus(); }
  });

  // Mientras la ventana de chat de la sección está a la vista, el botón
  // flotante sobra: se oculta para no mostrar dos chats a la vez.
  var demo = document.getElementById("chatDemo");
  if (demo && hasIO) {
    new IntersectionObserver(function (entries) {
      demoInView = entries[0].isIntersecting;
      syncFab();
    }, { threshold: 0.35 }).observe(demo);
  }

  // "Consultar al asistente" desde cada tarjeta del catálogo.
  if (grid) {
    grid.addEventListener("click", function (e) {
      var btn = e.target.closest(".card-ask");
      if (!btn || !CHAT) return;
      setPanel(true);
      CHAT.send(btn.getAttribute("data-question"));
    });
  }

  /* ---------- Botón de acceso al ERP -------------------------------------- */
  /* Con erpLoginEndpoint, la Lambda inicia sesión con credenciales guardadas
     en variables de entorno y redirige al ERP. Sin él, se va al login normal. */
  var erpBtn = document.getElementById("erpLoginBtn");
  var erpHost = document.getElementById("erpHost");
  var erpUrl = (CFG.erpUrl || "").replace(/\/+$/, "");
  if (erpBtn && erpUrl) {
    erpBtn.href = erpUrl + "/login";
    try { if (erpHost) erpHost.textContent = new URL(erpUrl).host; } catch (e) { /* URL inválida */ }
  }
  if (erpBtn && CFG.erpLoginEndpoint) {
    erpBtn.href = CFG.erpLoginEndpoint;
    erpBtn.removeAttribute("target"); // navegación directa para recibir la cookie de sesión
  }

  /* ---------- Formulario de contacto -------------------------------------- */
  var form = document.getElementById("contactForm");
  if (form) {
    var status = document.getElementById("contactStatus");
    var submitBtn = form.querySelector("button[type=submit]");
    var fields = {
      name: document.getElementById("cName"),
      email: document.getElementById("cEmail")
    };
    var EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var attempted = false;

    function setStatus(kind, text) {
      status.className = "form-note" + (kind ? " is-" + kind : "");
      status.textContent = text;
    }

    function setError(input, msg) {
      input.setAttribute("aria-invalid", msg ? "true" : "false");
      var slot = document.getElementById(input.id + "Error");
      if (slot) slot.textContent = msg || "";
    }

    function validate() {
      var errors = [];
      var name = fields.name.value.trim();
      var email = fields.email.value.trim();
      setError(fields.name, name.length < 3 ? "Escribe tu nombre y empresa." : "");
      setError(fields.email, !email ? "Necesitamos un correo para responderte." :
        !EMAIL_RX.test(email) ? "Revisa el formato del correo (ej. nombre@empresa.com)." : "");
      [fields.name, fields.email].forEach(function (f) {
        if (f.getAttribute("aria-invalid") === "true") errors.push(f);
      });
      return errors;
    }

    // Tras el primer intento, los errores se corrigen mientras escribes.
    form.addEventListener("input", function () { if (attempted) validate(); });

    function postJson(url, payload) {
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        if (timer) clearTimeout(timer);
        if (r.ok) return;
        // Se adjunta la respuesta del servidor (errores por campo, 429…).
        return r.json().catch(function () { return {}; }).then(function (body) {
          var err = new Error("HTTP " + r.status);
          err.status = r.status;
          err.body = body || {};
          throw err;
        });
      }, function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      attempted = true;
      var errors = validate();
      if (errors.length) {
        setStatus("error", "Revisa los campos marcados.");
        errors[0].focus();
        return;
      }

      var payload = {
        name: fields.name.value.trim(),
        email: fields.email.value.trim(),
        interest: document.getElementById("cInterest").value,
        message: document.getElementById("cMsg").value.trim()
      };
      var firstName = payload.name.split(/[\s—-]+/)[0];

      function done() {
        form.reset();
        attempted = false;
        setStatus("success", "¡Gracias, " + firstName + "! Recibimos tu solicitud y te contactaremos en menos de 24 h hábiles.");
      }

      // Campo trampa: los bots lo rellenan, las personas no lo ven.
      if (form.elements.website && form.elements.website.value) { done(); return; }

      if (!CFG.contactEndpoint) { done(); return; } // modo demo estático

      submitBtn.disabled = true;
      submitBtn.textContent = "Enviando…";
      setStatus("", "");
      postJson(CFG.contactEndpoint, payload)
        .then(done)
        .catch(function (err) {
          var fieldErrors = err && err.body && err.body.fields;
          if (err && err.status === 400 && fieldErrors && (fieldErrors.name || fieldErrors.email)) {
            if (fieldErrors.name) setError(fields.name, "Revisa tu nombre y empresa.");
            if (fieldErrors.email) setError(fields.email, "Revisa el formato del correo.");
            setStatus("error", "Revisa los campos marcados.");
            (fieldErrors.name ? fields.name : fields.email).focus();
          } else if (err && err.status === 429) {
            setStatus("error", "Recibimos varias solicitudes seguidas. Espera unos minutos e inténtalo de nuevo.");
          } else {
            setStatus("error", "No se pudo enviar. Inténtalo de nuevo o escríbenos a ventas@nogal-muebles.com.");
          }
        })
        .then(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = "Enviar solicitud";
        });
    });
  }

  /* ---------- Varios ------------------------------------------------------ */
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  reveal(document.querySelectorAll(".reveal:not(.in)"));
})();
