# Puesta en producción

Pasos para llevar la landing de modo demo a servicios reales. El código ya está preparado; lo que sigue
requiere acceso a la cuenta de AWS, al DNS de `theartificialmachine.com` y a la administración de ERPNext.

Orden recomendado: **1 → 2 → 3 → 4 → 5**. Cada paso indica qué archivo de configuración cambia al terminar.

---

## 1. HTTPS en el ERP y en n8n

Una página servida por HTTPS (CloudFront) no puede llamar a servicios `http://`: el navegador bloquea el
chat, el catálogo en vivo y el formulario. Es el requisito previo de todo lo demás.

1. Solicitar un certificado en **AWS Certificate Manager** para `*.theartificialmachine.com` (validación por DNS).
2. En el **Application Load Balancer** de ECS, agregar un listener **HTTPS :443** con ese certificado y
   reglas por host hacia los target groups de ERPNext y n8n.
3. Cambiar el listener **HTTP :80** para que redirija a HTTPS (301).
4. En ERPNext, indicar la URL pública con HTTPS:
   ```bash
   bench --site <sitio> set-config host_name "https://erp.theartificialmachine.com"
   ```
5. En n8n, definir `WEBHOOK_URL=https://n8n.theartificialmachine.com/` y `N8N_PROTOCOL=https`.

**Al terminar:** en `frontend/js/config.js` cambia `erpUrl` a `https://erp.theartificialmachine.com`.

---

## 2. Funciones Lambda

Las tres funciones usan Node.js 20, no tienen dependencias que empaquetar y se prueban en local con
`npm run test:backend`. Las variables de cada una están en `backend/.env.example`.

```bash
cd backend/<funcion>
zip -r function.zip index.mjs package.json
aws lambda create-function --function-name nogal-<funcion> \
  --runtime nodejs20.x --handler index.handler --zip-file fileb://function.zip \
  --role arn:aws:iam::<CUENTA>:role/<ROL_LAMBDA> \
  --environment "Variables={...}"
aws lambda create-function-url-config --function-name nogal-<funcion> --auth-type NONE
```

> No actives CORS en la configuración de la Function URL: el propio código responde las cabeceras CORS y
> la doble configuración produce cabeceras duplicadas que el navegador rechaza.

### 2.1 `catalog-stock` — stock en vivo

1. En ERPNext, crear un usuario técnico con un rol de **solo lectura** sobre *Bin* (por ejemplo
   *Stock User* sin permisos de escritura).
2. En ese usuario: **API Access → Generate Keys**. Guardar `ERP_API_KEY` y `ERP_API_SECRET` como
   variables de entorno de la Lambda.
3. Definir `SKUS` con los códigos del catálogo y, si aplica, `WAREHOUSE`.

**Al terminar:** `catalogEndpoint` en `config.js` = URL de la función.

### 2.2 `contact` — formulario

1. En **Amazon SES**, verificar el dominio `nogal-muebles.com` (o al menos el correo remitente).
2. Si la cuenta de SES está en *sandbox*, verificar también el destinatario o solicitar acceso de producción.
3. Dar al rol de la Lambda el permiso `ses:SendEmail`.
4. Variables: `CONTACT_TO`, `CONTACT_FROM`, `ALLOW_ORIGIN`.

**Al terminar:** `contactEndpoint` en `config.js` = URL de la función.

### 2.3 `erp-login` — auto-login de demo

La cookie de sesión solo llega al ERP si la función responde desde un subdominio del mismo dominio:

1. Crear una distribución de CloudFront con origen en la Function URL y nombre alternativo
   `login.theartificialmachine.com` (con el certificado del paso 1).
2. Crear el registro DNS `login` apuntando a esa distribución.
3. Variables: `ERP_URL`, `ERP_USERNAME`, `ERP_PASSWORD`, `COOKIE_DOMAIN=.theartificialmachine.com`,
   `ALLOW_ORIGIN`.

**Al terminar:** `erpLoginEndpoint` en `config.js` = `https://login.theartificialmachine.com/`.

---

## 3. Chat con el agente de n8n

1. Activar el workflow y copiar la URL del webhook de **producción**.
2. En el nodo *Webhook*, habilitar CORS para el dominio de CloudFront.
3. Revisar que *Respond to Webhook* devuelva `{ "reply": "..." }` (ver README).

**Al terminar:** `chatWebhookUrl` en `config.js` = URL del webhook.

---

## 4. Frontend y cabeceras de seguridad

1. Crear la política de cabeceras (CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`):
   ```bash
   aws cloudfront create-response-headers-policy \
     --response-headers-policy-config file://infra/cloudfront-security-headers.json
   ```
2. Asociar la política al comportamiento por defecto de la distribución de la landing
   (consola: *Behaviors → Edit → Response headers policy*).
3. Si los endpoints usan otro dominio, agregarlo a `connect-src` en ese mismo archivo.
   `npm run test:e2e` comprueba que la página funciona con esa CSP.
4. Desplegar:
   ```bash
   BUCKET=nogal-landing DISTRIBUTION_ID=<ID> SITE_URL=https://<dominio> ./scripts/deploy.sh
   ```

> HSTS se configura sin `includeSubDomains` a propósito: si la landing comparte dominio con un servicio
> que todavía no tiene HTTPS, ese servicio quedaría inaccesible.

---

## 5. Protección y monitoreo

**Límite de concurrencia** (evita que un abuso dispare costos):

```bash
aws lambda put-function-concurrency --function-name nogal-contact --reserved-concurrent-executions 5
aws lambda put-function-concurrency --function-name nogal-erp-login --reserved-concurrent-executions 5
```

**Límite por IP global** (opcional, tiene costo en AWS): una Web ACL de **AWS WAF** asociada a las
distribuciones de CloudFront con una regla *rate-based* (por ejemplo, 100 peticiones cada 5 minutos por IP).
La función `contact` ya limita por IP dentro de cada contenedor, pero WAF lo hace de forma global.

**Alarmas** (aviso por correo cuando una función falla):

```bash
aws sns create-topic --name nogal-alertas
aws sns subscribe --topic-arn <ARN_TOPIC> --protocol email --notification-endpoint <tu-correo>

for f in nogal-contact nogal-catalog-stock nogal-erp-login; do
  aws cloudwatch put-metric-alarm --alarm-name "$f-errores" \
    --namespace AWS/Lambda --metric-name Errors --dimensions Name=FunctionName,Value=$f \
    --statistic Sum --period 300 --evaluation-periods 1 --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold --alarm-actions <ARN_TOPIC>
done
```

---

## 6. SSO por usuario (reemplazo del auto-login)

El auto-login con credenciales compartidas sirve para la demo, pero en producción cada persona debe
entrar con su propia cuenta. ERPNext lo resuelve con **Social Login Keys**:

1. Crear la aplicación OAuth en el proveedor de identidad (Google Workspace, Microsoft Entra ID,
   Amazon Cognito o Keycloak).
2. En ERPNext: **Social Login Key → Nuevo**, elegir el proveedor (o *Custom* para Cognito/Keycloak) y
   cargar *Client ID*, *Client Secret* y las URLs de autorización, token y perfil.
3. Registrar en el proveedor la *Redirect URI* que muestra ERPNext en ese formulario.
4. Probar el ingreso desde `https://erp.theartificialmachine.com/login`: aparecerá el botón del proveedor.
5. Retirar la demo: vaciar `erpLoginEndpoint` en `config.js`, eliminar la función `nogal-erp-login` y
   desactivar el usuario compartido en ERPNext.

Desde ese momento, el botón "Iniciar sesión en ERPNext" lleva al login del ERP con SSO, sin credenciales
compartidas.
