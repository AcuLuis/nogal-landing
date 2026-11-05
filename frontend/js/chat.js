/* =============================================================================
   NOGAL — Lógica del asistente de inventario
   ---------------------------------------------------------------------------
   Una sola conversación compartida por la ventana de la sección "Asistente" y
   el widget flotante: lo que escribes en una aparece en la otra, y el
   historial sobrevive a recargas de la pestaña (sessionStorage).

   Si NOGAL_CONFIG.chatWebhookUrl está definido, la pregunta va al webhook de
   n8n; si no, responde un mock local construido con NOGAL_DATA (modo demo).
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.NOGAL_CONFIG || {};
  var DATA = window.NOGAL_DATA || { products: [] };
  var STORE_KEY = "nogal-chat-v1";
  var MAX_STORED = 60;          // mensajes guardados como máximo
  var MAX_QUESTION = 500;       // caracteres por pregunta
  var TIMEOUT_MS = CFG.chatTimeoutMs || 20000;

  /* ---------- Utilidades -------------------------------------------------- */
  var HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return HTML_ESC[c]; });
  }

  // Texto que llega del webhook: se escapa SIEMPRE y solo se permite un
  // formato mínimo (**negrita** y saltos de línea).
  function formatRemote(text) {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  // Minúsculas y sin tildes: "Cómoda" y "comoda" son la misma búsqueda.
  function normalize(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function fmt(n) { return Number(n).toLocaleString("es-PE"); }

  function newSessionId() {
    return "nogal-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  /* ---------- Estado persistente ------------------------------------------ */
  function loadState() {
    try {
      var s = JSON.parse(sessionStorage.getItem(STORE_KEY));
      if (s && s.sessionId && Array.isArray(s.messages)) return s;
    } catch (e) { /* storage no disponible o corrupto */ }
    return { sessionId: newSessionId(), messages: [] };
  }
  function saveState() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* modo privado */ }
  }
  var state = loadState();

  /* ---------- Respuestas simuladas (modo demo) ---------------------------- */
  function productLine(p) {
    return escapeHtml(p.name) + " (" + escapeHtml(p.sku) + "): <strong>" +
      fmt(p.stock) + " " + escapeHtml(p.unit) + "</strong> disponibles." +
      (p.note ? " " + escapeHtml(p.note) : "");
  }

  function lowStock() {
    var limit = DATA.lowStockThreshold || 40;
    return DATA.products.filter(function (p) { return p.stock < limit; });
  }

  var INTENTS = [
    { rx: /pedido|orden|despach/, reply: function () {
        return "Hoy hay <strong>7 pedidos</strong>: 4 listos para despacho, 2 en producción y 1 pendiente de material (nogal).";
      } },
    { rx: /rota|mas vend|vende mas|top|popular/, reply: function () {
        return "Mayor rotación de los últimos 30 días: 1) Sillas de roble, 2) Mesas de nogal, 3) Escritorios de roble.";
      } },
    { rx: /acabado|barniz|aceite|laca/, reply: function () {
        return "Stock combinado por acabado: aceite natural 46%, barniz mate 31%, laca 15%, otros 8%.";
      } },
    { rx: /reposi|reponer|stock bajo|alerta|falta|agotad/, reply: function () {
        var low = lowStock();
        if (!low.length) return "Ningún producto está por debajo del umbral de reposición. Todo en orden.";
        return "Productos por debajo del umbral de reposición:<br>" + low.map(productLine).join("<br>");
      } }
  ];

  function mockAnswer(question) {
    var q = normalize(question);

    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].rx.test(q)) return INTENTS[i].reply();
    }

    // Uno o varios productos mencionados ("mesas y sillas").
    var hits = DATA.products.filter(function (p) {
      return (p.keywords || []).some(function (k) { return q.indexOf(normalize(k)) !== -1; });
    });
    if (hits.length) return hits.map(productLine).join("<br>");

    if (/stock|inventario|resumen|todo/.test(q)) {
      return "Resumen de inventario:<br>" + DATA.products.map(function (p) {
        return escapeHtml(p.name) + ": <strong>" + fmt(p.stock) + " " + escapeHtml(p.unit) + "</strong>";
      }).join("<br>");
    }

    if (/^(hola|buen[oa]s|hey|saludos)/.test(q)) {
      return "¡Hola! Puedo darte stock por producto, pedidos del día, productos con más rotación o alertas de reposición.";
    }

    return "En modo demo solo tengo datos de ejemplo. Prueba con <em>“¿cuántos tablones quedan?”</em>, " +
      "<em>“pedidos de hoy”</em> o <em>“¿qué hay que reponer?”</em>.";
  }

  /* ---------- Llamada al agente (n8n) o mock ------------------------------ */
  function extractReply(data) {
    if (data == null) return null;
    if (typeof data === "string") return data.trim() ? data : null;
    if (Array.isArray(data)) return data.length ? extractReply(data[0].json || data[0]) : null;
    var paths = CFG.chatResponsePaths || ["reply", "output", "text"];
    for (var i = 0; i < paths.length; i++) {
      var v = data[paths[i]];
      if (typeof v === "string" && v.trim()) return v;
    }
    if (data.data) return extractReply(data.data);
    return null;
  }

  function ask(question) {
    var url = CFG.chatWebhookUrl;
    if (!url) {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve({ html: mockAnswer(question) }); }, 450 + Math.random() * 400);
      });
    }

    var body = { sessionId: state.sessionId };
    body[CFG.chatMessageKey || "message"] = question;

    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        var ct = r.headers.get("content-type") || "";
        return ct.indexOf("application/json") !== -1 ? r.json() : r.text();
      })
      .then(function (data) {
        var text = extractReply(data);
        if (!text) {
          return { html: "Recibí una respuesta que no pude interpretar. Revisa el formato de salida del webhook.", error: true };
        }
        return { html: formatRemote(text) };
      })
      .catch(function (err) {
        console.error("[NOGAL chat]", err);
        var msg = err && err.name === "AbortError"
          ? "El asistente está tardando demasiado. Inténtalo de nuevo en unos segundos."
          : "No pude contactar al asistente en este momento. Inténtalo más tarde.";
        return { html: msg, error: true };
      })
      .then(function (res) { if (timer) clearTimeout(timer); return res; });
  }

  /* ---------- Vistas (ventana de sección + widget flotante) --------------- */
  var views = [];
  var pending = false;

  function msgNode(m) {
    var div = document.createElement("div");
    div.className = "msg " + m.who + (m.error ? " error" : "");
    div.innerHTML = m.html; // html ya escapado/saneado al construirlo
    return div;
  }

  function scrollDown(v) { v.log.scrollTop = v.log.scrollHeight; }

  function renderAll(v) {
    state.messages.forEach(function (m) { v.log.appendChild(msgNode(m)); });
    scrollDown(v);
  }

  function push(m) {
    state.messages.push(m);
    if (state.messages.length > MAX_STORED) state.messages = state.messages.slice(-MAX_STORED);
    saveState();
    views.forEach(function (v) { v.log.appendChild(msgNode(m)); scrollDown(v); });
  }

  function setPending(on) {
    pending = on;
    views.forEach(function (v) {
      v.log.setAttribute("aria-busy", String(on));
      v.button.disabled = on;
      if (v.chips) v.chips.querySelectorAll(".chip").forEach(function (c) { c.disabled = on; });
      var t = v.log.querySelector(".typing");
      if (on && !t) {
        t = document.createElement("div");
        t.className = "msg bot typing";
        t.innerHTML = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
          '<span class="sr-only">El asistente está escribiendo…</span>';
        v.log.appendChild(t);
        scrollDown(v);
      } else if (!on && t) {
        t.remove();
      }
    });
  }

  function send(text, origin) {
    var q = String(text || "").trim().slice(0, MAX_QUESTION);
    if (!q || pending) return false;

    // Solo la vista que originó la pregunta anuncia por lector de pantalla.
    views.forEach(function (v) { v.log.setAttribute("aria-live", !origin || v === origin ? "polite" : "off"); });

    push({ who: "user", html: escapeHtml(q) });
    if (origin) origin.input.value = "";
    setPending(true);

    ask(q).then(function (res) {
      setPending(false);
      push({ who: "bot", html: res.html, error: !!res.error });
    });
    return true;
  }

  function reset() {
    if (pending) return;
    state = { sessionId: newSessionId(), messages: [] };
    saveState();
    views.forEach(function (v) {
      v.log.querySelectorAll(".msg:not([data-greeting])").forEach(function (n) { n.remove(); });
      v.input.focus();
    });
  }

  function wireChat(ids) {
    var form = document.getElementById(ids.form);
    var input = document.getElementById(ids.input);
    var log = document.getElementById(ids.log);
    if (!form || !input || !log) return null;

    var v = {
      form: form,
      input: input,
      log: log,
      chips: document.getElementById(ids.chips),
      button: form.querySelector("button[type=submit]")
    };
    input.setAttribute("maxlength", String(MAX_QUESTION));
    views.push(v);
    renderAll(v);

    form.addEventListener("submit", function (e) { e.preventDefault(); send(input.value, v); });

    if (v.chips) {
      v.chips.addEventListener("click", function (e) {
        var chip = e.target.closest(".chip");
        if (chip) send(chip.textContent, v);
      });
    }

    var resetBtn = ids.reset && document.getElementById(ids.reset);
    if (resetBtn) resetBtn.addEventListener("click", reset);
    return v;
  }

  /* ---------- Init (script con defer: el DOM ya está listo) --------------- */
  wireChat({ form: "demoForm", input: "demoInput", log: "demoLog", chips: "demoChips", reset: "demoReset" });
  var fabView = wireChat({ form: "fabForm", input: "fabInput", log: "fabLog", chips: "fabChips", reset: "fabReset" });

  if (!CFG.chatWebhookUrl) {
    console.info("%c[NOGAL] Chat en modo demo. Define NOGAL_CONFIG.chatWebhookUrl en js/config.js para conectar n8n.", "color:#B4532E");
  }

  // API usada por main.js (botones "Consultar" del catálogo y widget flotante).
  window.NOGAL_CHAT = {
    send: function (text) { return send(text, fabView); },
    reset: reset,
    hasHistory: function () { return state.messages.length > 0; },
    escapeHtml: escapeHtml
  };
})();
