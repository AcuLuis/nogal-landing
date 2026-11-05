/* =============================================================================
   NOGAL — Datos del catálogo (fuente única)
   ---------------------------------------------------------------------------
   El catálogo de la página y las respuestas del asistente en modo demo leen
   de aquí, así el stock mostrado nunca se contradice entre secciones.
   Si NOGAL_CONFIG.catalogEndpoint está definido, main.js reemplaza esta lista
   por la que devuelva ese endpoint (mismo formato).
   ========================================================================== */

window.NOGAL_DATA = {
  /* Por debajo de este número se muestra el aviso de "stock bajo". */
  lowStockThreshold: 40,

  products: [
    {
      sku: "MES-NOG",
      name: "Mesa de comedor · Nogal",
      category: "Producto terminado",
      description: "Tablero macizo de nogal, acabado al aceite. Para 6 comensales.",
      image: "assets/prod-mesa.svg",
      alt: "Mesa de comedor en madera de nogal",
      stock: 42,
      unit: "unidades",
      keywords: ["mesa"],
      note: "3 en producción y 5 reservadas para despacho."
    },
    {
      sku: "SIL-ROB",
      name: "Silla de comedor · Roble",
      category: "Producto terminado",
      description: "Estructura de roble ensamblada a espiga, asiento tapizado. Producción por lote.",
      image: "assets/prod-silla.svg",
      alt: "Silla de comedor en roble",
      stock: 260,
      unit: "unidades",
      keywords: ["silla"],
      note: "Es el producto de mayor rotación este mes."
    },
    {
      sku: "COM-CED",
      name: "Cómoda · Cedro",
      category: "Producto terminado",
      description: "Cuatro cajones con correderas metálicas y tiradores de latón. Cedro nacional.",
      image: "assets/prod-comoda.svg",
      alt: "Cómoda de cedro con cajones",
      stock: 38,
      unit: "unidades",
      keywords: ["comoda", "cajonera"],
      note: "Stock bajo: conviene programar un lote si se esperan pedidos grandes."
    },
    {
      sku: "EST-NOG",
      name: "Estantería · Nogal",
      category: "Producto terminado",
      description: "Librero de cinco niveles, estructura reforzada. Para hogar u oficina.",
      image: "assets/prod-estanteria.svg",
      alt: "Estantería de nogal",
      stock: 54,
      unit: "unidades",
      keywords: ["estanteria", "librero"],
      note: "Demanda al alza por temporada escolar y de oficina."
    },
    {
      sku: "ESC-ROB",
      name: "Escritorio · Roble",
      category: "Producto terminado",
      description: "Superficie amplia con cajonera integrada y pasacables. Línea workspace.",
      image: "assets/prod-escritorio.svg",
      alt: "Escritorio de roble",
      stock: 71,
      unit: "unidades",
      keywords: ["escritorio"],
      note: "Próxima reposición programada para la quincena."
    },
    {
      sku: "TAB-STD",
      name: "Tablón de madera",
      category: "Materia prima",
      description: "Madera seca y cepillada, lista para producción. Base de casi toda nuestra línea.",
      image: "assets/prod-tablon.svg",
      alt: "Tablones de madera, materia prima",
      stock: 1240,
      unit: "pies tabla",
      keywords: ["tablon", "madera", "materia prima"],
      note: "Reposición estimada en 6 días."
    }
  ]
};
