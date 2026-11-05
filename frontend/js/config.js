/* =============================================================================
   NOGAL — Configuración de integración (frontend)
   ---------------------------------------------------------------------------
   Este es el ÚNICO archivo que necesitas editar para conectar la landing con
   los servicios reales. No contiene secretos: solo URLs públicas de endpoints.
   Los secretos (usuario/clave del ERP) viven en el backend (variables de
   entorno de la Lambda), nunca aquí.
   ========================================================================== */

window.NOGAL_CONFIG = {
  /* ------------------------------------------------------------------
     1) CHAT — Webhook del agente de IA (n8n en AWS ECS)
     Pega aquí la URL del webhook de PRODUCCIÓN de n8n. Mientras esté
     vacío (""), el chat funciona en MODO DEMO con respuestas simuladas
     a partir de js/data.js.

     n8n corre en ECS Fargate detrás del ALB, con host
     n8n.theartificialmachine.com. El webhook tendrá la forma:
       https://n8n.theartificialmachine.com/webhook/<ruta-del-workflow>

     OJO MIXED-CONTENT: si la landing se sirve por HTTPS (CloudFront) y el
     webhook es HTTP, el navegador bloqueará la petición. Usa HTTPS en n8n.
     ------------------------------------------------------------------ */
  chatWebhookUrl: "",

  /* Nombre del campo que n8n espera recibir con la pregunta del usuario.
     El body enviado será: { [chatMessageKey]: "texto", sessionId: "..." } */
  chatMessageKey: "message",

  /* Claves del JSON de respuesta donde puede venir el texto a mostrar.
     Se prueban en orden; la primera que exista se usa. */
  chatResponsePaths: ["reply", "output", "text", "answer", "message"],

  /* Tiempo máximo de espera de la respuesta del agente (ms). */
  chatTimeoutMs: 20000,

  /* ------------------------------------------------------------------
     2) ERP — URL base y auto-login (opcional)
     erpUrl: URL base de ERPNext, sin barra final. El botón de acceso
     lleva a <erpUrl>/login.
     erpLoginEndpoint: si despliegas la Lambda de backend/erp-login,
     pega aquí su URL pública. Vacío => login normal del ERP.
     ------------------------------------------------------------------ */
  // Cambiar a https:// en cuanto el ERP tenga certificado (docs/produccion.md).
  erpUrl: "http://erp.theartificialmachine.com",
  erpLoginEndpoint: "",

  /* ------------------------------------------------------------------
     3) CATÁLOGO — Stock en vivo (opcional)
     Endpoint GET (Lambda backend/catalog-stock) que devuelve
     { "products": [{ "sku": "MES-NOG", "stock": 42 }, ...] }. El stock se
     fusiona por SKU con js/data.js; también acepta fichas completas.
     Si falla o está vacío, se muestran los datos locales.
     ------------------------------------------------------------------ */
  catalogEndpoint: "",

  /* ------------------------------------------------------------------
     4) CONTACTO — Endpoint del formulario (opcional)
     Recibe un POST JSON { name, email, interest, message }.
     Vacío => el formulario solo valida y muestra confirmación local.
     ------------------------------------------------------------------ */
  contactEndpoint: ""
};
