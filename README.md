# Plan Cero Deudas

Planificador financiero para salir de deudas. Registras tus ingresos, gastos fijos, deudas y
las ofertas de crédito que te hacen, y el plan busca la ruta que te deja libre de deudas con
el menor costo y el mayor flujo de caja posible, incluido si conviene tomar un crédito nuevo.

## Cómo usarlo

Abre `index.html` en el navegador. No necesita instalación ni servidor. Los datos se guardan
solo en tu navegador (`localStorage`). Con **Copiar mis datos** y **Pegar datos** puedes
moverlos a otro equipo.

1. **Ingresos**: el neto de tu colilla de pago, al mes, por quincena o por semana.
2. **Gastos fijos**: arriendo, mercado, servicios, transporte… sin contar las deudas.
   El **colchón mensual** es lo que quieres seguir ahorrando mientras pagas.
3. **Deudas**: saldo actual, tasa (% E.A., % mensual o N.A.M.V.), cuota o pago mínimo, tipo
   (cuota fija o rotativo como tarjetas) y seguros o cuota de manejo. Si la cuota te la
   descuentan por nómina (libranza, fondo de empleados), marca **Me la descuentan por nómina**:
   el plan la suma de vuelta al ingreso para no contarla dos veces, porque el neto de la
   colilla ya la restó.
4. **Ofertas de crédito**: compras de cartera o libre inversión con monto máximo, tasa,
   plazo, comisión de apertura y seguro mensual.
5. Elige qué te importa más: **pagar menos intereses**, **equilibrio** o **más flujo de caja**.

## Qué calcula

- Simula mes a mes: suma intereses, paga todas las cuotas obligatorias y lleva el excedente
  (ingresos − gastos − colchón − cuotas) a la deuda objetivo. Cuando una deuda termina, su
  cuota pasa a la siguiente (efecto bola de nieve).
- Compara tres estrategias de abono:
  - **Avalancha**: primero la tasa más alta (menos intereses).
  - **Bola de nieve**: primero el saldo más pequeño.
  - **Flujo de caja**: primero la deuda con menor saldo/cuota, la que libera más cuota por
    peso pagado.
- Para cada oferta de crédito prueba varias combinaciones de deudas a consolidar (por tasa,
  por peso de la cuota, por saldo y cada deuda sola), descuenta la comisión del desembolso,
  suma seguros y calcula el costo efectivo real (% E.A.).
- Ordena todas las rutas según tu prioridad, usando costo total, flujo libre promedio del
  primer año y meses hasta quedar libre.
- Si tus ingresos no cubren las cuotas, lo avisa y sugiere un crédito de consolidación
  (monto y plazo) con una tasa de referencia que puedes ajustar.

**Flujo libre** = ingresos − gastos − cuotas obligatorias. Es el dinero que podrías dejar de
abonar ante un imprevisto sin caer en mora.

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/engine.js` | Motor de cálculo puro (sin DOM). Funciona en navegador y en Node. |
| `src/app.js` | Interfaz: formularios, recomendación, gráficas, cronograma. |
| `src/styles.css` | Estilos con tema claro y oscuro. |
| `tests/engine.test.js` | Pruebas del motor. |

## Pruebas

```sh
npm test
```

Requiere Node 18 o superior.

> Es una herramienta de planeación, no una asesoría financiera. Antes de tomar un crédito,
> confirma que la tasa no supere la tasa de usura vigente y pide la tabla de amortización.

## Publicar en Cloudflare Pages

El flujo `.github/workflows/pages.yml` corre las pruebas, arma la carpeta `dist/` y la publica
en Cloudflare Pages (proyecto `plan-cero-deudas`) en cada push. Necesita dos secretos del
repositorio (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN`: token con permiso *Account → Cloudflare Pages → Edit*.
- `CLOUDFLARE_ACCOUNT_ID`: el ID de tu cuenta de Cloudflare.

Sin esos secretos el flujo corre las pruebas y omite la publicación.

A mano: `npm run build && npx wrangler pages deploy dist --project-name=plan-cero-deudas`.
