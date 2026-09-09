// ══════════════════════════════════════
//  MODO DEMO
//  Version publica de portfolio: corre sobre datos de muestra y sin el
//  backend Flask, asi que las funciones que dependen del servidor
//  (comentarios, descarga del .mpp, resumen ejecutivo) quedan desactivadas.
// ══════════════════════════════════════
const MODO_DEMO = true;

let proyectos = [];
let proyectoActual = null;
let tareas = [];
let tareasFiltradas = [];

// Cantidad de comentarios por tarea ("idProyecto::id" -> cantidad), se
// carga una sola vez al iniciar y se actualiza localmente al guardar uno
// nuevo, para poder mostrar el badge sin pedirle al backend por cada fila.
let comentariosConteo = {};
let comentarioTareaActual = null;
// Proyecto/Grupo/Subgrupo de la tarea del panel abierto, para darle contexto
// a la persona notificada por mail (ver obtenerContextoTarea).
let comentarioContextoActual = null;
// Comentarios de la tarea actualmente abierta en el panel, por id, para
// poder editarlos/cancelarlos sin volver a pedirlos al backend.
let comentariosPorId = {};

// Padrón de gente a la que se le puede asignar un comentario, para el
// desplegable "Asignar a" y la notificación por mail.
const EQUIPO_DEMO = [
  { nombre: "A. Rivas", email: "arivas@example.com" },
  { nombre: "M. Duarte", email: "mduarte@example.com" },
  { nombre: "L. Ferrero", email: "lferrero@example.com" },
  { nombre: "S. Ocampo", email: "socampo@example.com" },
  { nombre: "J. Beltran", email: "jbeltran@example.com" },
  { nombre: "C. Iriarte", email: "ciriarte@example.com" },
];

const OWA_BASE_URL = "https://webmail.example.com/owa/";

const COLORES_ESTADO = {
  noIniciada: {
    borde:   "#6B7280",
    fondo:   "rgba(107, 114, 128, 0.18)",
    progreso:"rgba(107, 114, 128, 0.65)",
    radial:  ["rgba(107, 114, 128, 0.02)", "rgba(107, 114, 128, 0.55)"]
  },
  enProgreso: {
    borde:   "#00B095",
    fondo:   "rgba(0, 176, 149, 0.18)",
    progreso:"rgba(0, 176, 149, 0.65)",
    radial:  ["rgba(0, 176, 149, 0.02)", "rgba(0, 176, 149, 0.55)"]
  },
  finalizada: {
    borde:   "#DDE3E0",
    fondo:   "rgba(221, 227, 224, 0.18)",
    progreso:"rgba(221, 227, 224, 0.65)",
    radial:  ["rgba(221, 227, 224, 0.02)", "rgba(221, 227, 224, 0.55)"]
  }
};

function colorEstado(porcentaje) {
  if (porcentaje >= 100) return COLORES_ESTADO.finalizada;
  if (porcentaje > 0)    return COLORES_ESTADO.enProgreso;
  return                        COLORES_ESTADO.noIniciada;
}

let tipIcono = null;
let chartBarras = null;
let chartTorta = null;
let chartLineaComparacion = null;

let estadosTortaSeleccionados = {
  "No iniciadas": true,
  "En progreso": true,
  "Finalizadas": true
};

let estadosBarrasSeleccionados = {
  "Tareas Atrasadas": true,
  "Tareas No Atrasadas": true
};

let estadoTortaClickSeleccionado = null;
let curvaDinamicaActual          = [];
let tareasParaBarrasActual        = [];
let gruposColapsados             = new Set();
let ganttFilaSeleccionada        = false;

// Orden manual aplicado al clickear el título de una columna en las
// tablas "Detalles de Tareas por Grupo" / "Tareas Críticas". col === null
// significa orden por defecto (sin ordenamiento manual del usuario).
let ordenTablaGrupo    = { col: null, dir: "asc" };
let ordenTablaCriticas = { col: null, dir: "asc" };

// ══════════════════════════════════════
//  VISTA DE PRESENTACIÓN (rotación automática de grupos)
// ══════════════════════════════════════
const PRESENTACION_INTERVALO_MS = 8000;
let presentacionActiva           = false;
let presentacionTimer            = null;
let presentacionIndice           = 0;
let presentacionIndiceProyecto   = 0;

  // ══════════════════════════════════════
//  MEMORIA DE SESIÓN (localStorage)
// ══════════════════════════════════════
const STORAGE_KEY = "pmdash_filtros_v1";

function guardarFiltros() {
  try {
    const selResponsable = document.getElementById("selectorResponsable");
    const estado = {
      proyecto:    document.getElementById("selectorProyecto").value,
      grupo:       document.getElementById("selectorGrupo").value,
      responsable: selResponsable ? selResponsable.value : "Todos",
      busqueda:    document.getElementById("buscadorTareas").value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
  } catch (e) { /* Silencioso: storage deshabilitado o privado */ }
}

function restaurarFiltros() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const { proyecto, grupo, responsable, busqueda } = JSON.parse(raw);
    const selProy        = document.getElementById("selectorProyecto");
    const selGrupo       = document.getElementById("selectorGrupo");
    const selResponsable = document.getElementById("selectorResponsable");
    const buscador       = document.getElementById("buscadorTareas");
    const btnX           = document.getElementById("btnLimpiarFiltros");

    if (proyecto && [...selProy.options].some(o => o.value === proyecto)) {
      selProy.value = proyecto;
      inicializarSelectorGrupo();
      inicializarSelectorResponsable();
    }

    if (grupo && [...selGrupo.options].some(o => o.value === grupo)) {
      selGrupo.value = grupo;
    }

    if (responsable && selResponsable && [...selResponsable.options].some(o => o.value === responsable)) {
      selResponsable.value = responsable;
    }

    if (busqueda && buscador) {
      buscador.value = busqueda;
      if (btnX) btnX.classList.add("visible");
    }
  } catch (e) {
    console.warn("No se pudo restaurar estado de filtros:", e);
  }
}

// ══════════════════════════════════════
//  DELTA KPI (cambio entre actualizaciones)
// ══════════════════════════════════════


function activarLoadingPaneles() {
  document.querySelectorAll(".panel, .bloque-kpis, .bloque-analitica").forEach(el => {
    el.classList.add("panel-loading");
  });

  // Spinner único centrado en pantalla
  const overlay = document.createElement("div");
  overlay.id = "loadingOverlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 99998;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  `;

  overlay.innerHTML = `
    <div style="
      width: 64px;
      height: 64px;
      border: 5px solid rgba(245, 158, 11, 0.2);
      border-top-color: #f59e0b;
      border-right-color: #f59e0b;
      border-radius: 50%;
      animation: spinLoader 0.75s linear infinite;
    "></div>
  `;

  document.body.appendChild(overlay);
}

function desactivarLoadingPaneles() {
  document.querySelectorAll(".panel-loading").forEach(el => {
    el.classList.remove("panel-loading");
  });

  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.remove();
}

async function cargarDashboard() {
  try {
    const responseJson = await fetch(`Proyectos_Unificados.json?v=${Date.now()}`);
    if (!responseJson.ok) throw new Error(`No se pudo cargar el JSON: ${responseJson.status}`);
    proyectos = await responseJson.json();

    const responseCsv = await fetch(`Proyectos_Unificados.csv?v=${Date.now()}`);
    if (!responseCsv.ok) throw new Error(`No se pudo cargar el CSV: ${responseCsv.status}`);
    const textoCsv = await responseCsv.text();
    const resultado = Papa.parse(textoCsv, { header: true, skipEmptyLines: true });

    // Mantenemos la carga pura original
    tareas = resultado.data;

    await cargarConteoComentarios();

    inicializarSelectorProyecto();
    inicializarSelectorGrupo();
    inicializarSelectorResponsable();
    restaurarFiltros();
    sincronizarCascadaGrupoResponsable();
    aplicarFiltros();
    actualizarBadgeFecha();

  } catch (error) {
    console.error("Error al cargar dashboard:", error);
  }
}

function inicializarSelectorProyecto() {
  const selectorProyecto = document.getElementById("selectorProyecto");
  selectorProyecto.innerHTML = "";

  const idsProyecto = [...new Set(
    tareas
      .map(t => limpiarTexto(t["ID Proyecto"]))
      .filter(v => v !== "")
  )].sort((a, b) => a.localeCompare(b, "es"));

  idsProyecto.forEach(id => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    selectorProyecto.appendChild(option);
  });

  selectorProyecto.addEventListener("change", () => {
    if (presentacionActiva) detenerPresentacion();
    inicializarSelectorGrupo();
    inicializarSelectorResponsable();
    sincronizarCascadaGrupoResponsable();
    aplicarFiltros();
  });

  poblarMenuTituloProyecto(idsProyecto);
}

// ── Título del header como selector de proyecto ──
// El <select id="selectorProyecto"> sigue existiendo (oculto) porque el
// resto del código lee/escribe su .value y .options; el título solo lo
// refleja y lo maneja.

let tituloIndiceResaltado = -1;

function poblarMenuTituloProyecto(idsProyecto) {
  const menu = document.getElementById("tituloMenu");
  if (!menu) return;
  menu.innerHTML = "";
  idsProyecto.forEach((id, i) => {
    const li = document.createElement("li");
    li.textContent = id;
    li.setAttribute("role", "option");
    li.dataset.proyecto = id;
    li.addEventListener("mouseenter", () => resaltarItemTitulo(i));
    menu.appendChild(li);
  });
  sincronizarMenuTituloProyecto();
}

function sincronizarMenuTituloProyecto() {
  const menu = document.getElementById("tituloMenu");
  const selectorProyecto = document.getElementById("selectorProyecto");
  if (!menu || !selectorProyecto) return;
  const actual = selectorProyecto.value;
  menu.querySelectorAll("li").forEach(li => {
    const esActivo = li.dataset.proyecto === actual;
    li.classList.toggle("activo", esActivo);
    li.setAttribute("aria-selected", esActivo ? "true" : "false");
  });
}

function resaltarItemTitulo(i) {
  const menu = document.getElementById("tituloMenu");
  if (!menu) return;
  menu.querySelectorAll("li").forEach(li => li.classList.remove("resaltado"));
  const li = menu.children[i];
  if (li) {
    li.classList.add("resaltado");
    li.scrollIntoView({ block: "nearest" });
  }
  tituloIndiceResaltado = i;
}

function moverResaltadoTitulo(delta) {
  const menu = document.getElementById("tituloMenu");
  if (!menu) return;
  const total = menu.children.length;
  if (!total) return;
  resaltarItemTitulo((tituloIndiceResaltado + delta + total) % total);
}

function abrirMenuTituloProyecto() {
  const menu = document.getElementById("tituloMenu");
  const trigger = document.getElementById("tituloTrigger");
  if (!menu || !trigger || trigger.disabled) return;
  cerrarOtrosMenusEstilizados();
  sincronizarMenuTituloProyecto();
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  const indiceActivo = Array.from(menu.children).findIndex(li => li.classList.contains("activo"));
  resaltarItemTitulo(indiceActivo >= 0 ? indiceActivo : 0);
}

function cerrarMenuTituloProyecto() {
  const menu = document.getElementById("tituloMenu");
  const trigger = document.getElementById("tituloTrigger");
  if (!menu || !trigger) return;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  tituloIndiceResaltado = -1;
}

function toggleMenuTituloProyecto() {
  const menu = document.getElementById("tituloMenu");
  if (!menu) return;
  if (menu.hidden) abrirMenuTituloProyecto();
  else cerrarMenuTituloProyecto();
}

function elegirResaltadoTitulo() {
  const menu = document.getElementById("tituloMenu");
  const li = menu?.children[tituloIndiceResaltado];
  if (li) seleccionarProyectoDesdeTitulo(li.dataset.proyecto);
}

function seleccionarProyectoDesdeTitulo(idProyecto) {
  const selectorProyecto = document.getElementById("selectorProyecto");
  if (!selectorProyecto) return;
  cerrarMenuTituloProyecto();
  document.getElementById("tituloTrigger")?.focus();
  if (selectorProyecto.value === idProyecto) return;
  if (presentacionActiva) detenerPresentacion();
  selectorProyecto.value = idProyecto;
  inicializarSelectorGrupo();
  inicializarSelectorResponsable();
  sincronizarCascadaGrupoResponsable();
  aplicarFiltros();
}

// ── Selects de Grupo/Responsable (principal + clones de pantalla completa)
// como botón + lista propia, mismo look y navegación por teclado que el
// selector de proyecto del título. El <select> original sigue existiendo
// (oculto) como fuente de la verdad: todo el resto del código (cascada,
// bloqueos, sincronización con las vistas de pantalla completa) sigue
// leyendo/escribiendo su .value sin enterarse de este reemplazo visual.
const selectoresEstilizadosRefrescar = [];

// Registro de la función "cerrar" de cada dropdown propio del dashboard
// (título + estos) para poder cerrar todos los demás apenas se abre uno,
// sin depender de que el click "burbujee" hasta document (cada trigger le
// hace stopPropagation a su propio click, así que ese burbujeo no le llega
// a los otros).
const registroCerrarMenusEstilizados = [];

function cerrarOtrosMenusEstilizados() {
  registroCerrarMenusEstilizados.forEach(fn => fn());
}

function crearSelectorEstilizado(select) {
  if (!select || select.dataset.selectorEstilizado) return;
  const filtroBox = select.closest(".filtroBox");
  if (!filtroBox) return;
  select.dataset.selectorEstilizado = "1";
  select.style.display = "none";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "filtro-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML =
    '<span class="filtro-trigger-val"></span>' +
    '<svg class="filtro-trigger-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  const menu = document.createElement("ul");
  menu.className = "filtro-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  filtroBox.appendChild(trigger);
  filtroBox.appendChild(menu);

  const valorSpan = trigger.querySelector(".filtro-trigger-val");
  let indiceResaltado = -1;

  function refrescar() {
    valorSpan.textContent = select.options[select.selectedIndex]?.text ?? "";
    trigger.disabled = select.disabled;
  }

  function construirMenu() {
    menu.innerHTML = "";
    Array.from(select.options).forEach((opt, i) => {
      const li = document.createElement("li");
      li.textContent = opt.text;
      li.dataset.index = String(i);
      li.setAttribute("role", "option");
      if (opt.disabled) li.classList.add("deshabilitado");
      if (i === select.selectedIndex) {
        li.classList.add("activo");
        li.setAttribute("aria-selected", "true");
      }
      li.addEventListener("mouseenter", () => resaltar(i));
      menu.appendChild(li);
    });
  }

  function resaltar(i) {
    menu.querySelectorAll("li").forEach(li => li.classList.remove("resaltado"));
    const li = menu.children[i];
    if (li) {
      li.classList.add("resaltado");
      li.scrollIntoView({ block: "nearest" });
    }
    indiceResaltado = i;
  }

  function moverResaltado(delta) {
    const items = menu.querySelectorAll("li");
    if (!items.length) return;
    let i = indiceResaltado;
    for (let paso = 0; paso < items.length; paso++) {
      i = (i + delta + items.length) % items.length;
      if (!items[i].classList.contains("deshabilitado")) break;
    }
    resaltar(i);
  }

  function abrir() {
    if (select.disabled) return;
    cerrarOtrosMenusEstilizados();
    construirMenu();
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    resaltar(select.selectedIndex >= 0 ? select.selectedIndex : 0);
  }

  function cerrar() {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    indiceResaltado = -1;
  }

  function elegir(i) {
    const opt = select.options[i];
    cerrar();
    trigger.focus();
    if (!opt || opt.disabled) return;
    if (select.selectedIndex === i) return;
    select.selectedIndex = i;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) abrir(); else cerrar();
  });

  trigger.addEventListener("keydown", (e) => {
    if (menu.hidden) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        abrir();
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); moverResaltado(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moverResaltado(-1); }
    else if (e.key === "Home") { e.preventDefault(); resaltar(0); }
    else if (e.key === "End") { e.preventDefault(); resaltar(menu.children.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (indiceResaltado >= 0) elegir(indiceResaltado); }
    else if (e.key === "Escape") { e.preventDefault(); cerrar(); }
    else if (e.key === "Tab") { cerrar(); }
  });

  menu.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-index]");
    if (li) elegir(Number(li.dataset.index));
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !filtroBox.contains(e.target)) cerrar();
  });

  new MutationObserver(refrescar).observe(select, { attributes: true, attributeFilter: ["disabled"] });

  refrescar();
  selectoresEstilizadosRefrescar.push(refrescar);
  registroCerrarMenusEstilizados.push(cerrar);
}

function refrescarSelectoresEstilizados() {
  selectoresEstilizadosRefrescar.forEach(fn => fn());
}

// Los Grupo_ID vacíos solo aparecen en filas Resumen (auto-generadas por MS Project),
// nunca en tareas reales: "Sin Grupo" no debe habilitarse salvo que exista una tarea real así.
function haySinGrupoReal(idProyecto) {
  return tareas.some(t =>
    limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyecto) &&
    String(t["Resumen"]).trim().toLowerCase() !== "true" &&
    normalizarGrupoId(t["Grupo_ID"]) === "Sin Grupo"
  );
}

// Mismo criterio que "Sin Grupo": "Sin Asignar" no debe habilitarse
// salvo que exista una tarea real sin Responsable cargado.
function normalizarResponsable(valor) {
  const texto = limpiarTexto(valor);
  return texto === "" ? "Sin Asignar" : texto;
}

// El campo "Responsable" puede traer varias personas en una sola tarea
// ("Matías / Joaquín / Mateo"): para filtrar/listar por persona hay que
// mirar cada nombre individual, no la combinación completa como string.
function listaResponsablesDeCampo(valor) {
  const texto = limpiarTexto(valor);
  return texto === "" ? ["Sin Asignar"] : texto.split("/").map(n => n.trim()).filter(Boolean);
}

function campoIncluyeResponsable(valorCampo, responsableBuscado) {
  return listaResponsablesDeCampo(valorCampo).includes(responsableBuscado);
}

// Devuelve, para cada Id de una lista de filas de UN proyecto (en su orden
// original), la lista de Id de todos sus ancestros resumen — mismo algoritmo
// de pila por Nivel_de_esquema que usa el Gantt para armar el árbol. Hace
// falta para saber qué encabezados de grupo conservar al filtrar por
// Responsable/búsqueda: no alcanza con comparar Grupo_ID, porque proyectos
// con varios niveles de resumen anidados (ej. Grupo → Subgrupo → Equipo →
// tarea) pueden compartir el mismo Grupo_ID en todos esos niveles, y ahí
// comparar por Grupo_ID trae de arrastre encabezados de ramas hermanas que
// no tienen ninguna tarea visible debajo.
function calcularAncestrosPorId(filasProyecto) {
  const pila = [];
  const ancestrosPorId = {};
  filasProyecto.forEach(fila => {
    const nivel = Number(fila["Nivel_de_esquema"]);
    const id = String(fila["Id"]);
    while (pila.length && pila[pila.length - 1].nivel >= nivel) pila.pop();
    ancestrosPorId[id] = pila.map(p => p.id);
    pila.push({ id, nivel });
  });
  return ancestrosPorId;
}

// Convención del equipo para nombrar un grupo real: "N - Nombre" (ej. "2 - Hardware").
const PATRON_NOMBRE_GRUPO = /^\d+\s*-\s*\S/;

// Proyecto + Grupo + Subgrupo de una tarea puntual, reutilizando el mismo
// algoritmo de ancestros (calcularAncestrosPorId) que arma el árbol del Gantt.
// El Id 0 no siempre es un simple wrapper del proyecto completo: en algunos
// proyectos ya ES el primer grupo real. Por eso no se descarta por nivel o
// por Id — se busca, de afuera hacia adentro, el primer ancestro cuyo nombre
// respeta el patrón "N - Nombre"; todo lo que esté por encima de ese (wrappers
// tipo "Proyecto X" o "Analizador de red") se ignora. El ancestro más cercano
// a la tarea, si lo hay, es el Subgrupo.
function obtenerContextoTarea(idProyecto, idTarea) {
  const filasProyecto = tareas.filter(t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyecto));
  const ancestrosPorId = calcularAncestrosPorId(filasProyecto);
  const idsAncestros = ancestrosPorId[String(idTarea)] || [];
  const nombresAncestros = idsAncestros
    .map(idAnc => filasProyecto.find(t => String(t["Id"]) === idAnc))
    .filter(Boolean)
    .map(fila => capitalizarPrimeraLetra(limpiarTexto(fila["Nombre de tarea"] || fila["Nombre"])));

  const idxGrupo = nombresAncestros.findIndex(nombre => PATRON_NOMBRE_GRUPO.test(nombre));
  const restantes = idxGrupo !== -1 ? nombresAncestros.slice(idxGrupo + 1) : [];

  return {
    proyecto: limpiarTexto(idProyecto) || null,
    grupo: idxGrupo !== -1 ? nombresAncestros[idxGrupo] : null,
    subgrupo: restantes.length ? restantes[restantes.length - 1] : null,
  };
}

function haySinAsignarReal(idProyecto) {
  return tareas.some(t =>
    limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyecto) &&
    String(t["Resumen"]).trim().toLowerCase() !== "true" &&
    normalizarResponsable(t["Responsable"]) === "Sin Asignar"
  );
}

function inicializarSelectorGrupo() {
  const selectorGrupo = document.getElementById("selectorGrupo");
  const selectorProyecto = document.getElementById("selectorProyecto");
  const idProyectoSeleccionado = selectorProyecto.value;

  selectorGrupo.innerHTML = "";

  const optionTodos = document.createElement("option");
  optionTodos.value = "Todos";
  optionTodos.textContent = "Todos";
  selectorGrupo.appendChild(optionTodos);

  const grupos = [...new Set(
    tareas
      .filter(t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyectoSeleccionado))
      .map(t => normalizarGrupoId(t["Grupo_ID"]))
      .filter(v => v !== "")
  )];

  if (!grupos.includes("Sin Grupo")) grupos.push("Sin Grupo");

  grupos.sort((a, b) => {
    if (a === "Sin Grupo") return 1;
    if (b === "Sin Grupo") return -1;

    const na = obtenerNumeroGrupo(a);
    const nb = obtenerNumeroGrupo(b);

    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  });

  const puedeSinGrupo = haySinGrupoReal(idProyectoSeleccionado);

  grupos.forEach(grupo => {
    const option = document.createElement("option");
    option.value = grupo;
    option.textContent = grupo;
    if (grupo === "Sin Grupo") option.disabled = !puedeSinGrupo;
    selectorGrupo.appendChild(option);
  });

  selectorGrupo.onchange = () => {
    if (presentacionActiva) detenerPresentacion();
    sincronizarCascadaGrupoResponsable();
    aplicarFiltros();
  };
}

function inicializarSelectorResponsable() {
  const selectorResponsable = document.getElementById("selectorResponsable");
  const selectorProyecto = document.getElementById("selectorProyecto");
  const idProyectoSeleccionado = selectorProyecto.value;

  selectorResponsable.innerHTML = "";

  const optionTodos = document.createElement("option");
  optionTodos.value = "Todos";
  optionTodos.textContent = "Todos";
  selectorResponsable.appendChild(optionTodos);

  const responsables = [...new Set(
    tareas
      .filter(t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyectoSeleccionado))
      .flatMap(t => listaResponsablesDeCampo(t["Responsable"]))
  )];

  if (!responsables.includes("Sin Asignar")) responsables.push("Sin Asignar");

  responsables.sort((a, b) => {
    if (a === "Sin Asignar") return 1;
    if (b === "Sin Asignar") return -1;
    return a.localeCompare(b, "es");
  });

  const puedeSinAsignar = haySinAsignarReal(idProyectoSeleccionado);

  responsables.forEach(resp => {
    const option = document.createElement("option");
    option.value = resp;
    option.textContent = resp;
    if (resp === "Sin Asignar") option.disabled = !puedeSinAsignar;
    selectorResponsable.appendChild(option);
  });

  selectorResponsable.onchange = () => {
    if (presentacionActiva) detenerPresentacion();
    sincronizarCascadaGrupoResponsable();
    aplicarFiltros();
  };
}

// ══════════════════════════════════════
//  CASCADA CRUZADA: Grupo ↔ Responsable
// ══════════════════════════════════════
function obtenerResponsablesDeGrupo(idProyecto, grupoId) {
  return new Set(
    tareas
      .filter(t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyecto))
      .filter(t => String(t["Resumen"]).trim().toLowerCase() !== "true")
      .filter(t => normalizarGrupoId(t["Grupo_ID"]) === grupoId)
      .flatMap(t => listaResponsablesDeCampo(t["Responsable"]))
  );
}

function obtenerGruposDeResponsable(idProyecto, responsable) {
  return new Set(
    tareas
      .filter(t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyecto))
      .filter(t => String(t["Resumen"]).trim().toLowerCase() !== "true")
      .filter(t => campoIncluyeResponsable(t["Responsable"], responsable))
      .map(t => normalizarGrupoId(t["Grupo_ID"]))
  );
}

function sincronizarCascadaGrupoResponsable() {
  const selectorProyecto    = document.getElementById("selectorProyecto");
  const selectorGrupo       = document.getElementById("selectorGrupo");
  const selectorResponsable = document.getElementById("selectorResponsable");
  if (!selectorGrupo || !selectorResponsable || !selectorProyecto) return;

  const idProyecto = selectorProyecto.value;
  const grupoActivo = selectorGrupo.value;
  const puedeSinAsignar = haySinAsignarReal(idProyecto);

  // ── Grupo seleccionado → despintar Responsables que no tienen tareas ahí ──
  if (grupoActivo !== "Todos") {
    const responsablesValidos = obtenerResponsablesDeGrupo(idProyecto, grupoActivo);
    Array.from(selectorResponsable.options).forEach(opt => {
      opt.disabled = opt.value === "Sin Asignar"
        ? !puedeSinAsignar || !responsablesValidos.has(opt.value)
        : opt.value !== "Todos" && !responsablesValidos.has(opt.value);
    });
    if (selectorResponsable.value !== "Todos" && !responsablesValidos.has(selectorResponsable.value)) {
      selectorResponsable.value = "Todos";
    }
  } else {
    Array.from(selectorResponsable.options).forEach(opt => {
      opt.disabled = opt.value === "Sin Asignar" ? !puedeSinAsignar : false;
    });
  }

  // ── Responsable seleccionado → despintar Grupos que no tienen tareas suyas ──
  const puedeSinGrupo = haySinGrupoReal(idProyecto);
  const responsableActivo = selectorResponsable.value;
  if (responsableActivo !== "Todos") {
    const gruposValidos = obtenerGruposDeResponsable(idProyecto, responsableActivo);
    Array.from(selectorGrupo.options).forEach(opt => {
      opt.disabled = opt.value === "Sin Grupo"
        ? !puedeSinGrupo || !gruposValidos.has(opt.value)
        : opt.value !== "Todos" && !gruposValidos.has(opt.value);
    });
    if (selectorGrupo.value !== "Todos" && !gruposValidos.has(selectorGrupo.value)) {
      selectorGrupo.value = "Todos";
    }
  } else {
    Array.from(selectorGrupo.options).forEach(opt => {
      opt.disabled = opt.value === "Sin Grupo" ? !puedeSinGrupo : false;
    });
  }
}

function resaltarTexto(nombre, textoOriginal) {
  if (!textoOriginal) return nombre;
  try {
    const normalizar = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const nombreNorm  = normalizar(nombre);
    const busquedaNorm = normalizar(textoOriginal);
    const escaped = busquedaNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');

    let resultado = '';
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(nombreNorm)) !== null) {
      resultado += nombre.slice(lastIndex, match.index);
      resultado += `<mark class="sugerencia-highlight">${nombre.slice(match.index, match.index + match[0].length)}</mark>`;
      lastIndex = match.index + match[0].length;
    }
    resultado += nombre.slice(lastIndex);
    return resultado || nombre;
  } catch { return nombre; }
}

function colorPorDesvio(desvio) {
  if (desvio > 0)        return { ini: "#006D59", fin: "#00B095", borde: "#00B095", texto: "#00B095", clase: "semaforo-adelantado", label: "Adelantado",  rgb: "0,176,149"   };
  if (desvio === 0)      return { ini: "#006D59", fin: "#00B095", borde: "#00B095", texto: "#00B095", clase: "semaforo-en-tiempo",   label: "En tiempo",   rgb: "0,176,149"   };
  if (desvio >= -15)     return { ini: "#b45309", fin: "#f59e0b", borde: "#d97706", texto: "#f59e0b", clase: "semaforo-leve",        label: "Atraso leve", rgb: "245,158,11"  };
  return                        { ini: "#991b1b", fin: "#ef4444", borde: "#dc2626", texto: "#ef4444", clase: "semaforo-atrasado",    label: "Atrasado",    rgb: "239,68,68"   };
}

function sincronizarTogglesFiltroGantt() {
  const tareasNoResumen = tareasFiltradas.filter(
    t => String(t["Resumen"]).trim().toLowerCase() !== "true"
  );

  const estadosPresentes = new Set();
  tareasNoResumen.forEach(t => {
    const pct = Number(t["% completado"] || 0);
    if (pct === 0)        estadosPresentes.add("No iniciadas");
    else if (pct < 100)   estadosPresentes.add("En progreso");
    else                  estadosPresentes.add("Finalizadas");
  });

  document.querySelectorAll("#ganttFiltroEstados .gantt-toggle-estado, #ganttFiltroEstadosFs .gantt-toggle-estado").forEach(t => {
    const estado = t.dataset.estado;
    const existe = estadosPresentes.has(estado);
    const activoPorLeyenda = estadosTortaSeleccionados[estado] !== false;
    const activoPorClick = !estadoTortaClickSeleccionado || estadoTortaClickSeleccionado === estado;

    if (!existe) {
      t.style.opacity = "0.2";
      t.style.cursor = "not-allowed";
      t.style.pointerEvents = "none";
    } else if (!activoPorLeyenda || !activoPorClick) {
      t.style.opacity = "0.25";
      t.style.cursor = "pointer";
      t.style.pointerEvents = "all";
    } else {
      t.style.opacity = "1";
      t.style.cursor = "pointer";
      t.style.pointerEvents = "all";
    }
  });
}

// Delegación global — un solo listener que sobrevive cualquier re-render del Gantt
if (!window._ganttToggleListenerActivo) {
  window._ganttToggleListenerActivo = true;
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest("#ganttFiltroEstados .gantt-toggle-estado, #ganttFiltroEstadosFs .gantt-toggle-estado");
    if (!toggle) return;
    if (presentacionActiva) detenerPresentacion();
    const estadoClickeado = toggle.dataset.estado;
    estadoTortaClickSeleccionado =
      estadoTortaClickSeleccionado === estadoClickeado ? null : estadoClickeado;
    sincronizarTogglesFiltroGantt();
    renderGraficoTortaConTareasFiltradas(tareasFiltradas);
    renderTablasYGraficosConEstado(tareasFiltradas);
  });
}

if (!window._ganttColapsarListenerActivo) {
  window._ganttColapsarListenerActivo = true;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-colapsar]");
    if (!btn) return;
    e.stopPropagation();
    const nodoId = btn.dataset.colapsar;
    if (gruposColapsados.has(nodoId)) {
      gruposColapsados.delete(nodoId);
    } else {
      gruposColapsados.add(nodoId);
    }
    window._ganttSkipScroll = true;
    renderGantt(tareasFiltradas);
    actualizarBotonLimpiarFiltros();
  });
}

if (!window._crossFilterClickActivo) {
  window._crossFilterClickActivo = true;
  document.addEventListener("click", (e) => {
    // El Gantt ya NO filtra el dashboard al hacer click (antes achicaba el
    // rango de fechas a una sola tarea y eso disparaba un "re-zoom" feo).
    // Ahora clickear una fila del Gantt solo la resalta — ver el listener
    // de selección de fila dentro de renderGantt.

    // Tablas: click en fila
    const filaTabla = e.target.closest("#tablaTareasGrupo tbody tr, #tablaTareasCriticas tbody tr");
    if (filaTabla) {
      const nombreInner = filaTabla.querySelector(".col-nombre-inner");
      if (nombreInner) {
        if (presentacionActiva) detenerPresentacion();
        filtrarPorTareaClick(nombreInner.textContent.trim());
        return;
      }
    }
  });
}

function aplicarFiltros() {
    estadoTortaClickSeleccionado = null;
    estadosTortaSeleccionados = {
      "No iniciadas": true,
      "En progreso": true,
      "Finalizadas": true
    };
    gruposColapsados.clear();
    ganttFilaSeleccionada = false;
    guardarFiltros();
    
    const idProyectoSeleccionado = document.getElementById("selectorProyecto").value;
    const grupoSeleccionado = document.getElementById("selectorGrupo").value;
    const responsableSeleccionado = document.getElementById("selectorResponsable") ? document.getElementById("selectorResponsable").value : "Todos";
    const textoInput = document.getElementById("buscadorTareas") ? document.getElementById("buscadorTareas").value : "";
    const buscadorTexto = normalizarTextoBusqueda(textoInput);
    
    proyectoActual = proyectos.find(
     p => limpiarTexto(p["ID Proyecto"]) === limpiarTexto(idProyectoSeleccionado)
    ) || null;
    
    document.getElementById("tituloDashboard").textContent =
     `${idProyectoSeleccionado || "-"}`;
    sincronizarMenuTituloProyecto();

    // Las filas resumen (encabezados de grupo/subgrupo) nunca se filtran
    // directamente por Responsable ni por búsqueda: se conservan solo las
    // que son ancestro real de alguna tarea hoja visible (ver
    // calcularAncestrosPorId) — así el árbol mantiene la cadena exacta de
    // encabezados de las tareas que matchean, sin arrastrar de yapa ramas
    // hermanas sin ninguna tarea del responsable/búsqueda actual.
    const filasProyecto = tareas.filter(
      t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyectoSeleccionado)
    );
    const ancestrosPorId = calcularAncestrosPorId(filasProyecto);

    const hojasVisibles = filasProyecto.filter(t => {
      if (String(t["Resumen"]).trim().toLowerCase() === "true") return false;
      const grupoNormalizado = normalizarGrupoId(t["Grupo_ID"]);
      const coincideGrupo = grupoSeleccionado === "Todos" || grupoNormalizado === grupoSeleccionado;
      const coincideResponsable = responsableSeleccionado === "Todos" || campoIncluyeResponsable(t["Responsable"], responsableSeleccionado);
      const nombreTarea = normalizarTextoBusqueda(t["Nombre de tarea"] || t["Nombre"]);
      const coincideBusqueda = buscadorTexto === "" || nombreTarea.includes(buscadorTexto);
      return coincideGrupo && coincideResponsable && coincideBusqueda;
    });

    const idsHojasVisibles = new Set(hojasVisibles.map(t => String(t["Id"])));
    const idsAncestrosNecesarios = new Set();
    hojasVisibles.forEach(t => {
      (ancestrosPorId[String(t["Id"])] || []).forEach(idAnc => idsAncestrosNecesarios.add(idAnc));
    });

    tareasFiltradas = filasProyecto.filter(t => {
      const esResumen = String(t["Resumen"]).trim().toLowerCase() === "true";
      return esResumen
        ? idsAncestrosNecesarios.has(String(t["Id"]))
        : idsHojasVisibles.has(String(t["Id"]));
    });

      // ── NUEVO: Tareas exclusivas para barras (ignora el filtro de Grupo) ──
    const tareasParaBarras = tareas.filter(t => {
     const coincideProyecto = limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyectoSeleccionado);
     const coincideResponsable = responsableSeleccionado === "Todos" || campoIncluyeResponsable(t["Responsable"], responsableSeleccionado);
     const nombreTarea = normalizarTextoBusqueda(t["Nombre de tarea"] || t["Nombre"]);
     const coincideBusqueda = buscadorTexto === "" || nombreTarea.includes(buscadorTexto);
     return coincideProyecto && coincideResponsable && coincideBusqueda;
    });
    tareasParaBarrasActual = tareasParaBarras;
    
    let curvaDinamica = generarCurvaSDesdeTareas(tareasFiltradas);
    
    if ((!curvaDinamica || curvaDinamica.length < 2) && buscadorTexto === "") {
     const tareasProyecto = tareas.filter(
      t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyectoSeleccionado)
     );
     curvaDinamica = generarCurvaSDesdeTareas(tareasProyecto);
    }
    curvaDinamicaActual = curvaDinamica;
    
    
  
    renderTarjetasDinamicas(tareasFiltradas, curvaDinamica);
    renderGraficoTortaConTareasFiltradas(tareasFiltradas);
      
      // ── ACÁ PASAMOS LA NUEVA LISTA ──
    renderGraficoBarras(tareasParaBarras); 
    renderGraficoLineaComparacion(curvaDinamica);
    renderTablasYGraficosConEstado(tareasFiltradas);
    sincronizarTogglesFiltroGantt();
    refrescarSelectoresEstilizados();
  }



function obtenerDesvioHoyDesdeCurva(curvaDinamica) {
  if (!curvaDinamica || curvaDinamica.length === 0) return 0;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let puntoHoy = curvaDinamica.find(item => {
    const f = new Date(item.fecha);
    f.setHours(0, 0, 0, 0);
    return f.getTime() === hoy.getTime();
  });

  if (!puntoHoy) {
    const puntosAnteriores = curvaDinamica.filter(item => {
      const f = new Date(item.fecha);
      f.setHours(0, 0, 0, 0);
      return f <= hoy;
    });

    puntoHoy = puntosAnteriores.length > 0
      ? puntosAnteriores[puntosAnteriores.length - 1]
      : curvaDinamica[0];
  }

  return Number(puntoHoy.real || 0) - Number(puntoHoy.teorico || 0);
}

function generarCurvaSDesdeTareas(listaTareas) {
  const tareasValidas = listaTareas.filter(
    t => String(t["Resumen"]).trim().toLowerCase() !== "true"
  );

  if (tareasValidas.length === 0) return [];

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const tareasPreparadas = [];
  const fechas = [];
  let sumaDuraciones = 0;

  tareasValidas.forEach(t => {
    const inicio = parseFechaLocal(t["Comienzo"]);
    const fin = parseFechaLocal(t["Fin"]);
    const porcentaje = Number(t["% completado"] || 0);

    if (!inicio || !fin) return;

    inicio.setHours(0, 0, 0, 0);
    fin.setHours(0, 0, 0, 0);

    const duracion = Math.max(1, Math.round((fin - inicio) / (1000 * 60 * 60 * 24)) + 1);
    const duracionHabil = contarDiasHabilesEntre(inicio, fin);

    let finReal = parseFechaLocal(t["Fin Real Efectivo"]) || null;
    if (finReal) {
      finReal.setHours(0, 0, 0, 0);
      // Un "Fin Real Efectivo" no puede ser posterior a HOY: si el dato de origen
      // trae una fecha futura (típicamente un error de carga, ej. año equivocado),
      // no es un dato real utilizable. Lo descartamos (como si no existiera) para
      // que la tarea caiga en la rama "sin Fin Real Efectivo", que reparte el %
      // completado hasta su Fin planificado u HOY (lo que ocurra antes) en vez de
      // rampear artificialmente hacia una fecha inventada.
      if (finReal > hoy) finReal = null;
    }

    tareasPreparadas.push({
      inicio,
      fin,
      finReal,
      duracion,
      duracionHabil,
      porcentaje
    });

    fechas.push(inicio);
    fechas.push(fin);
    // Si la tarea se completó realmente después de su Fin planificado,
    // el rango de la curva tiene que estirarse hasta esa fecha real,
    // sino la curva se corta antes de que la tarea llegue a su 100%.
    if (finReal) fechas.push(finReal);

    sumaDuraciones += duracionHabil;
  });

  if (tareasPreparadas.length === 0 || sumaDuraciones === 0) return [];

  const fechaMin = new Date(Math.min(...fechas.map(f => f.getTime())));
  const fechaMax = new Date(Math.max(...fechas.map(f => f.getTime())));

  // Si el proyecto ya venció según el plan (fechaMax quedó antes que HOY),
  // "hoy" nunca cae dentro del rango de la curva. Usamos fechaMax como
  // "hoy efectivo" para que las tareas sin Fin Real Efectivo sigan
  // reflejando su % completado en el tramo final de la curva.
  const hoyEfectivo = hoy > fechaMax ? new Date(fechaMax) : hoy;

  const curva = [];

  for (let d = new Date(fechaMin); d <= fechaMax; d.setDate(d.getDate() + 1)) {
    let avanceRealPonderado = 0;
    let avanceTeoricoPonderado = 0;

    tareasPreparadas.forEach(t => {
      const { inicio, fin, duracion, duracionHabil, porcentaje } = t;

      let porcentajeRealHastaFecha = 0;

      if (t.finReal) {
        if (d < t.inicio) {
          porcentajeRealHastaFecha = 0;
        } else if (d >= t.finReal) {
          porcentajeRealHastaFecha = t.porcentaje;
        } else {
          const duracionRealHabil = contarDiasHabilesEntre(t.inicio, t.finReal);
          const diasTranscurridos = contarDiasHabilesEntre(t.inicio, d);
          porcentajeRealHastaFecha = (diasTranscurridos / duracionRealHabil) * t.porcentaje;
        }
      } else {
        // Sin Fin Real Efectivo: no sabemos el día exacto en que la tarea llegó
        // a su % completado actual, así que lo distribuimos proporcionalmente
        // entre su Comienzo y el primero de estos dos hitos: el Fin planificado
        // de la tarea, o HOY-efectivo (lo que ocurra antes). Después de ese
        // punto la curva queda plana en el % completado conocido, evitando el
        // escalón abrupto al final en proyectos ya vencidos.
        const limiteConocido = t.fin < hoyEfectivo ? t.fin : hoyEfectivo;

        if (d < t.inicio) {
          porcentajeRealHastaFecha = 0;
        } else if (d >= limiteConocido) {
          porcentajeRealHastaFecha = t.porcentaje;
        } else {
          const duracionHastaLimite = contarDiasHabilesEntre(t.inicio, limiteConocido);
          const diasTranscurridos = contarDiasHabilesEntre(t.inicio, d);
          porcentajeRealHastaFecha = (diasTranscurridos / duracionHastaLimite) * t.porcentaje;
        }
      }

      avanceRealPonderado += duracionHabil * (porcentajeRealHastaFecha / 100);

      let porcentajeTeoricoHastaFecha = 0;

      if (d < inicio) {
        porcentajeTeoricoHastaFecha = 0;
      } else if (d >= fin) {
        porcentajeTeoricoHastaFecha = 100;
      } else {
        const diasHabilesTranscurridos = contarDiasHabilesEntre(inicio, d);
        porcentajeTeoricoHastaFecha = (diasHabilesTranscurridos / duracionHabil) * 100;
      }

      avanceTeoricoPonderado += duracionHabil * (porcentajeTeoricoHastaFecha / 100);
    });

    // Carga de tareas: serie temporal por superposición de fechas. Una tarea
    // está "activa" en el Día X si el Día X cae entre su Comienzo y su Fin
    // real (el Fin Real Efectivo si existe, o el Fin planificado si la tarea
    // no terminó o no tiene fecha real registrada) — sin importar el %
    // completado actual, así el histórico no se borra cuando la tarea termina
    // siendo marcada 100% completada, y si se atrasó respecto del plan, la
    // carga refleja los días extra que realmente insumió. El peso de cada
    // tarea se sigue calculando sobre sus días hábiles planificados, como %
    // de los días hábiles totales del proyecto, igual que en Real/Teórico.
    let duracionHabilActiva = 0;
    tareasPreparadas.forEach(t => {
      const finActividad = t.finReal || t.fin;
      if (d >= t.inicio && d <= finActividad) {
        duracionHabilActiva += t.duracionHabil;
      }
    });
    const cargaNormalizada = (duracionHabilActiva / sumaDuraciones) * 100;

    curva.push({
      fecha: new Date(d),
      real: (avanceRealPonderado / sumaDuraciones) * 100,
      teorico: (avanceTeoricoPonderado / sumaDuraciones) * 100,
      carga: cargaNormalizada
    });
  }

  if (curva.length === 1) {
    curva.push({
      fecha: new Date(curva[0].fecha.getTime() + 86400000),
      real: curva[0].real,
      teorico: curva[0].teorico,
      carga: curva[0].carga
    });
  }

  return curva;
}

function flipCard(frontHTML, explicacion) {
  return `
    <div class="card-inner">
      <div class="card-front">
        <button class="flip-btn" data-tooltip="Más información" onclick="this.closest('.card').classList.toggle('flipped')">▾</button>
        ${frontHTML}
      </div>
      <div class="card-back">
        <button class="flip-btn" data-tooltip="Cerrar" onclick="this.closest('.card').classList.toggle('flipped')">✕</button>
        <p style="font-size:1.3vh; line-height:1.3;">${explicacion}</p>
      </div>
    </div>
  `;
}

function renderTarjetasDinamicas(tareasFiltradas,curvaDinamica) {
  const grupoSeleccionado = document.getElementById("selectorGrupo").value;

  const tareasNoResumen = tareasFiltradas.filter(
    t => String(t["Resumen"]).trim().toLowerCase() !== "true"
  );

  if (tareasNoResumen.length === 0) {
    ["cardSemaforo", "cardAvance", "cardDesvio"].forEach(id => {
      const el = document.getElementById(id);
      el.style.background = "";
      el.style.border = "";
    });

    document.getElementById("cardDuracion").innerHTML = `<h3>Duración</h3><p>-</p>`;
    document.getElementById("cardFin").innerHTML = `<h3>Fecha Fin</h3><p>-</p>`;
    document.getElementById("cardDias").innerHTML = `<h3>Tiempo Restante</h3><p>-</p>`;
    document.getElementById("cardSemaforo").classList.remove(
      "semaforo-atrasado", "semaforo-adelantado", "semaforo-en-tiempo", "semaforo-leve"
    );
    document.getElementById("cardSemaforo").innerHTML = `<h3>Semáforo Proyecto</h3><p class="semaforo-texto">-</p>`;
    document.getElementById("cardDesvio").innerHTML = `<h3>Desvío HOY</h3><p>-</p>`;
    document.getElementById("cardAvance").innerHTML = `<h3>Avance Total</h3><p>-</p>`;
    document.getElementById("cardCantidad").innerHTML = `<h3>Cantidad de Tareas</h3><p>0</p>`;
    return;
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let duracionProyecto;
  let fechaFin;
  let diasRestantes;
  let avanceTotal;
  let desvioHoy = 0;
  let semaforo = "En tiempo";

  if (grupoSeleccionado === "Todos" && proyectoActual) {
    duracionProyecto = proyectoActual["Duración Proyecto"] ?? "-";
  
    const fechasFin = tareasNoResumen
      .map(t => parseFechaLocal(t["Fin"]))
      .filter(f => f && !isNaN(f.getTime()));
  
    const fechaFinCalc = new Date(Math.max(...fechasFin));
  
    fechaFin = formatearFechaISO(fechaFinCalc);
  
    const fechaFinSinHora = new Date(fechaFinCalc);
    fechaFinSinHora.setHours(0, 0, 0, 0);
  
    diasRestantes = Math.round((fechaFinSinHora - hoy) / (1000 * 60 * 60 * 24));
  
    avanceTotal = convertirPorcentajeANumero(proyectoActual["% Avance Total"]);
    desvioHoy = obtenerDesvioHoyDesdeCurva(curvaDinamica);
  
    if (desvioHoy < 0) semaforo = "Atrasado";
    else if (desvioHoy > 0) semaforo = "Adelantado";
    else semaforo = "En tiempo";
 
  } else {
    const fechasInicio = tareasNoResumen
      .map(t => parseFechaLocal(t["Comienzo"]))
      .filter(f => f && !isNaN(f.getTime()));

    const fechasFin = tareasNoResumen
      .map(t => parseFechaLocal(t["Fin"]))
      .filter(f => f && !isNaN(f.getTime()));

    const fechaInicioCalc = new Date(Math.min(...fechasInicio));
    const fechaFinCalc = new Date(Math.max(...fechasFin));

    duracionProyecto = contarDiasHabilesEntre(fechaInicioCalc, fechaFinCalc);
    fechaFin = formatearFechaISO(fechaFinCalc);

    const fechaFinSinHora = new Date(fechaFinCalc);
    fechaFinSinHora.setHours(0, 0, 0, 0);
    diasRestantes = Math.round((fechaFinSinHora - hoy) / (1000 * 60 * 60 * 24));

    let sumaPonderada = 0;
    let sumaDuraciones = 0;
    
    tareasNoResumen.forEach(t => {
      const porcentaje = Number(t["% completado"] || 0);
    
      const inicio = parseFechaLocal(t["Comienzo"]);
      const fin = parseFechaLocal(t["Fin"]);
    
      if (!inicio || !fin) return;
    
      const duracionHabil = contarDiasHabilesEntre(inicio, fin);
    
      sumaPonderada += duracionHabil * porcentaje;
      sumaDuraciones += duracionHabil;
    });
    
    avanceTotal = sumaDuraciones > 0 ? (sumaPonderada / sumaDuraciones) : 0;

    desvioHoy = obtenerDesvioHoyDesdeCurva(curvaDinamica);
    
    if (desvioHoy < 0) semaforo = "Atrasado";
    else if (desvioHoy > 0) semaforo = "Adelantado";
    else semaforo = "En tiempo";
  }

  

  document.getElementById("cardDuracion").innerHTML = flipCard(
    `<h3>Duración</h3><p>${duracionProyecto} días</p>`,
    "Días hábiles entre inicio y fin (no cuenta Sábados ni Domingos)."
  );

  document.getElementById("cardFin").innerHTML = flipCard(
    `<h3>Fecha Fin</h3><p>${fechaFin}</p>`,
    "Fecha de finalización planificada."
  );

  const tituloDias = diasRestantes < 0 ? "Finalización" : "Tiempo Restante";
  const textoDias = diasRestantes < 0 ? `Hace ${Math.abs(diasRestantes)} días` : `${diasRestantes} días`;

  document.getElementById("cardDias").innerHTML = flipCard(
    `<h3>${tituloDias}</h3><p>${textoDias}</p>`,
    "Días restantes. Si finalizó, días desde el cierre."
  );

  const col = colorPorDesvio(desvioHoy);

  // Aplicar fondo tintado a las tres tarjetas de estado
["cardSemaforo", "cardAvance", "cardDesvio"].forEach(id => {
    const el = document.getElementById(id);
    el.style.background = `linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(${col.rgb}, 0.10) 50%, rgba(${col.rgb}, 0.18) 100%)`;
    el.style.setProperty("--card-rgb", col.rgb);
    el.classList.add("card-coloreada");
  });

  ["cardCantidad", "cardDuracion", "cardDias", "cardFin"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.setProperty("--card-rgb", "0, 176, 149");
      el.classList.add("card-coloreada");
    }
  });

  // Neutralizar el fondo verde del h3 en las tarjetas de estado
  requestAnimationFrame(() => {
    ["cardSemaforo", "cardAvance", "cardDesvio"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const h3 = el.querySelector("h3");
      if (h3) h3.style.background = `rgba(${col.rgb}, 0.25)`;
      const back = el.querySelector(".card-back");
      if (back) back.style.background = `rgba(${col.rgb}, 0.18)`;
    });
  });

  const cardSemaforo = document.getElementById("cardSemaforo");
  cardSemaforo.classList.remove(
    "semaforo-atrasado", "semaforo-adelantado", "semaforo-en-tiempo", "semaforo-leve"
  );
  cardSemaforo.classList.add(col.clase);

  let tituloSemaforo = "Semáforo Proyecto";
  if (diasRestantes < 0) tituloSemaforo = "Resultado Final";

  document.getElementById("cardSemaforo").innerHTML = flipCard(
    `<h3>${tituloSemaforo}</h3><p class="semaforo-texto" style="color:${col.texto};">${col.label}</p>`,
    "Estado del proyecto según el desvío de HOY: Adelantado, En tiempo, Atraso leve o Atrasado."
  );

  let tituloDesvio = "Desvío HOY";
  if (diasRestantes < 0) tituloDesvio = "Desvío Final (cierre)";

  document.getElementById("cardDesvio").innerHTML = flipCard(
    `<h3>${tituloDesvio}</h3><p style="color:${col.texto};">${formatearPorcentaje(desvioHoy)}</p>`,
    "(Avance Real - Avance Teórico) a la fecha de HOY.  Verde (a tiempo), Naranja (atraso ≤15%), Rojo (crítico)."
  );

  const avanceBarra = Math.min(Math.max(avanceTotal, 0), 100);
  const claseCompleto = avanceBarra === 100 ? " completo" : "";

  document.getElementById("cardAvance").innerHTML = flipCard(
    `<h3>Avance Total</h3>
    <div class="contenedor-avance">
      <div class="barra-avance-fondo" style="border-color:${col.borde}; background:rgba(${col.rgb},0.15);">
        <div class="barra-avance-progreso${claseCompleto}" style="width:${avanceBarra}%; background: linear-gradient(90deg, ${col.ini}, ${col.fin});"></div>
        <p class="texto-avance">${formatearPorcentaje(avanceTotal)}</p>
      </div>
    </div>`,
    "Avance ponderado por duración. Se colorea en base a Desvío HOY"
  );

  document.getElementById("cardCantidad").innerHTML = flipCard(
    `<h3>Cantidad de Tareas</h3><p>${tareasNoResumen.length}</p>`,
    "Total de tareas del proyecto o grupo seleccionado, sin contar tareas de resumen."
  );

  
}

function construirSerieTemporal(curva, campo) {
  return curva.map(item => {
    const fecha = item.fecha instanceof Date ? item.fecha : new Date(item.fecha);
    return [fecha, Number(item[campo] || 0)];
  });
}

// ══════════════════════════════════════
//  GANTT — con altura de fila dinámica
// ══════════════════════════════════════

// Ancho del panel izquierdo ("Tarea / Grupo"), ajustable arrastrando
// .gantt-resizer. Vive solo en memoria de la pestaña (nada de localStorage):
// cada recarga de página arranca siempre en el ancho por defecto, y solo
// cambia mientras el usuario arrastra el divisor en la sesión actual.
const GANTT_LEFT_W_MIN = 260;
const GANTT_LEFT_W_MAX = 700;
const GANTT_LEFT_W_DEFAULT = 290;

let ganttLeftWidthActual = GANTT_LEFT_W_DEFAULT;

function getGanttLeftWidth() {
  return ganttLeftWidthActual;
}

function setGanttLeftWidth(px) {
  ganttLeftWidthActual = Math.min(GANTT_LEFT_W_MAX, Math.max(GANTT_LEFT_W_MIN, Math.round(px)));
}

// Escala temporal del Gantt: cada nivel define el piso de px por día.
// Si el ancho disponible da para más (proyecto corto / panel angosto),
// igual se estira para llenar el contenedor — el piso solo garantiza
// legibilidad mínima en proyectos largos, en vez de comprimir siempre
// al mismo valor fijo como antes ("semana" replica ese comportamiento
// previo, por eso es el nivel por defecto).
const GANTT_ZOOM_PISOS = { mes: 6, semana: 18, dia: 32 };
const GANTT_ZOOM_DEFAULT = 'semana';

function getGanttZoom() {
  const guardado = localStorage.getItem('ganttZoom');
  return GANTT_ZOOM_PISOS.hasOwnProperty(guardado) ? guardado : GANTT_ZOOM_DEFAULT;
}

function setGanttZoom(nivel) {
  if (!GANTT_ZOOM_PISOS.hasOwnProperty(nivel)) return;
  localStorage.setItem('ganttZoom', nivel);
}

// Color único para todas las barras del Gantt (ya no varía por % completado).
const COLOR_GANTT_BARRA = { borde: "#00B095", fondo: "rgba(0, 176, 149, 0.18)", progreso: "rgba(0, 176, 149, 0.65)" };
// Resaltados opcionales (toggles de la cabecera): misma paleta que ya usan
// los semáforos del resto del dashboard (rojo = atrasado, ámbar = leve/crítico),
// más violeta para la ruta crítica (no tiene equivalente previo en la app).
const COLOR_GANTT_CRITICA      = { borde: "#F59E0B", fondo: "rgba(245, 158, 11, 0.24)", progreso: "rgba(245, 158, 11, 0.8)" };
const COLOR_GANTT_ATRASADA     = { borde: "#EF4444", fondo: "rgba(239, 68, 68, 0.24)", progreso: "rgba(239, 68, 68, 0.8)" };
const COLOR_GANTT_RUTA_CRITICA = { borde: "#A855F7", fondo: "rgba(168, 85, 247, 0.24)", progreso: "rgba(168, 85, 247, 0.8)" };

// Toggles de resaltado del Gantt (íconos de la cabecera). Solo en memoria
// de la pestaña — no necesitan sobrevivir a un reload.
let ganttResaltarCriticas = false;
let ganttResaltarAtrasadas = false;
let ganttResaltarRutaCritica = false;

function renderGantt(tareasAMostrar) {
  const contenedor = document.getElementById("graficoLineaReal");

  const rpPrevio = document.getElementById("ganttRP");
  const scrollGanttPrevio = rpPrevio
    ? { left: rpPrevio.scrollLeft, top: rpPrevio.scrollTop }
    : null;

  const panelGanttEstado = document.querySelector('.panel-linea-real');
  const ganttEstaFullscreen = panelGanttEstado && panelGanttEstado.classList.contains('gantt-fullscreen');
  const pathIconoFullscreen = ganttEstaFullscreen
    ? "M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"
    : "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3";
  const tituloIconoFullscreen = ganttEstaFullscreen ? "Salir de Pantalla Completa" : "Pantalla Completa";

  // Ya no filtramos las tareas resumen: se muestran como brackets [----]
  // que abarcan a sus tareas hijas, igual que en MS Project.
  const tareasValidas = tareasAMostrar;

  if (!tareasValidas.length) {
    contenedor.innerHTML = `<div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding: 2vh;"><div style="width:64px; height:64px; border-radius:50%; background:rgba(107, 114, 128, 0.08); border:2px dashed #6B7280; display:flex; align-items:center; justify-content:center;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div><span style="color:#6B7280; font-size:1.5vh; font-weight:600; text-align:center;">No se encontraron tareas con los filtros actuales</span></div>`;
    return;
  }

  const allDates = [];
  // Usamos la variable global tareasFiltradas (no el parámetro) para el rango de fechas
  // así el filtro de estado nunca achica el Gantt
  tareasFiltradas
    .filter(t => String(t["Resumen"]).trim().toLowerCase() !== "true")
    .forEach(t => {
      const ini = parseFechaLocal(t["Comienzo"]);
      const fin = parseFechaLocal(t["Fin"]);
      if (ini) allDates.push(ini);
      if (fin) allDates.push(fin);
    });

  if (!allDates.length) {
    contenedor.innerHTML = `<div class="mensajeTabla">No hay fechas válidas.</div>`;
    return;
  }

  const fechaMin = new Date(Math.min(...allDates.map(f => f.getTime())));
  const fechaMax = new Date(Math.max(...allDates.map(f => f.getTime())));
  fechaMax.setDate(fechaMax.getDate() + 7);
  fechaMin.setHours(0, 0, 0, 0);
  fechaMax.setHours(0, 0, 0, 0);

  const dias = [];
  for (let d = new Date(fechaMin); d <= fechaMax; d.setDate(d.getDate() + 1)) {
    dias.push(new Date(d));
  }
  
  // Modo impresión: se recalcula la geometría (ancho de día / alto de fila)
  // para que TODO el proyecto entre en una hoja A4 apaisada, en vez de
  // escalar el render de pantalla (que deformaría el texto). Equivale al
  // "Ajustar a 1x1 páginas" de MS Project.
  const impresion = window._ganttPrintTarget || null;

  const ganttLeftWidth = impresion ? impresion.leftW : getGanttLeftWidth();
  const anchoDisponible = contenedor.clientWidth - ganttLeftWidth;
  const ganttZoom = getGanttZoom();
  const DIA_W = impresion
    ? Math.min(60, Math.max(3, Math.floor((impresion.w - ganttLeftWidth) / dias.length)))
    : Math.max(GANTT_ZOOM_PISOS[ganttZoom], Math.floor(anchoDisponible / dias.length));
  const totalW = dias.length * DIA_W;
  // Con "Mes" las columnas quedan demasiado angostas para que el número
  // del día se lea sin solaparse: se ocultan y queda solo la franja de fin
  // de semana como referencia visual.
  const mostrarNumeroDia = DIA_W >= 14;

  function dateToX(fecha) {
    const d = new Date(fecha);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - fechaMin.getTime()) / 86400000) * DIA_W;
  }

  const MESES_LARGOS = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

  function calcSpans(keyFn, labelFn) {
    const spans = [];
    let curKey = null, count = 0, firstD = null;
    dias.forEach(d => {
      const k = keyFn(d);
      if (k !== curKey) {
        if (curKey !== null) spans.push({ label: labelFn(firstD), count });
        curKey = k; count = 0; firstD = new Date(d);
      }
      count++;
    });
    if (curKey !== null) spans.push({ label: labelFn(firstD), count });
    return spans;
  }

  const mesSpans = calcSpans(
    d => `${d.getFullYear()}-${d.getMonth()}`,
    d => `${MESES_LARGOS[d.getMonth()]} ${d.getFullYear()}`
  );

  function buildSpanRow(spans, cls) {
    return spans.map(s =>
      `<div class="gh-cell ${cls}" style="width:${s.count * DIA_W}px;">${s.label}</div>`
    ).join('');
  }

  const mesHTML = buildSpanRow(mesSpans, 'gh-mes');
  
  const diaHTML = dias.map((d) => {
    const fds = d.getDay() === 0 || d.getDay() === 6;
    return `<div class="gh-cell gh-dia${fds ? ' gh-fds' : ''}" style="width:${DIA_W}px;">${mostrarNumeroDia ? d.getDate() : ''}</div>`;
  }).join('');

  // ── Construir jerarquía dinámica (grupo → subgrupo → actividad → …) ──
  // A partir de Nivel_de_esquema, sin importar la profundidad del árbol.
  // Se arma con una pila: cada tarea cuelga de la última tarea vista con
  // un nivel menor, igual que hace MS Project internamente.
  function construirArbol(filas) {
    const raiz = [];
    const pila = [];
    filas.forEach(fila => {
      const nivel = Number(fila["Nivel_de_esquema"]);
      const nodo = { fila, hijos: [], nivel };
      while (pila.length && pila[pila.length - 1].nivel >= nivel) pila.pop();
      (pila.length ? pila[pila.length - 1].nodo.hijos : raiz).push(nodo);
      pila.push({ nodo, nivel });
    });
    return raiz;
  }

  const grupoSeleccionadoActual = document.getElementById("selectorGrupo")?.value || "Todos";
  let filasArbol = tareasValidas;

  // Cuando se ve "Todos", los niveles superiores con una única tarea son
  // envoltorios de "proyecto/plan completo" (ej. MDM 2026 tiene DOS niveles
  // así antes de llegar a los grupos reales) — se descartan en cadena hasta
  // llegar al primer nivel con más de una tarea, igual que detectar_nivel_grupo
  // del lado Python.
  if (grupoSeleccionadoActual === "Todos") {
    // Los conteos por nivel se calculan sobre TODAS las tareas del proyecto
    // (sin el filtro de Responsable/búsqueda ya aplicado en tareasValidas):
    // es una propiedad estructural del proyecto, no del filtro actual. Si se
    // contara sobre tareasValidas, una persona que solo trabaja en un grupo
    // real dejaría ese nivel con una sola fila y la detección lo confundiría
    // con otro envoltorio a pelar, comiéndose el encabezado de ese grupo.
    const idProyectoActual = tareasValidas.length ? limpiarTexto(tareasValidas[0]["ID Proyecto"]) : null;
    const tareasProyectoCompleto = idProyectoActual
      ? tareas.filter(t => limpiarTexto(t["ID Proyecto"]) === idProyectoActual)
      : tareasValidas;

    const conteoPorNivel = {};
    tareasProyectoCompleto.forEach(t => {
      const n = Number(t["Nivel_de_esquema"]);
      if (!isNaN(n)) conteoPorNivel[n] = (conteoPorNivel[n] || 0) + 1;
    });
    const nivelesPresentes = Object.keys(conteoPorNivel).map(Number).sort((a, b) => a - b);
    if (nivelesPresentes.length) {
      let nivelCorte = nivelesPresentes[0];
      for (const n of nivelesPresentes) {
        nivelCorte = n;
        if (conteoPorNivel[n] > 1) break;
      }
      if (nivelCorte !== nivelesPresentes[0]) {
        filasArbol = tareasValidas.filter(t => Number(t["Nivel_de_esquema"]) >= nivelCorte);
      }
    }
  }

  const bosque = construirArbol(filasArbol);

  // ── Calcular altura de fila dinámica (cuenta todo nodo visible, a cualquier profundidad) ──
  function contarVisibles(nodos) {
    let total = 0;
    nodos.forEach(n => {
      total += 1;
      const colapsado = n.hijos.length > 0 && gruposColapsados.has(String(n.fila["Id"]));
      if (n.hijos.length && !colapsado) total += contarVisibles(n.hijos);
    });
    return total;
  }
  const totalFilas = contarVisibles(bosque);

  const HEADER_H = 32; // altura del header (2 filas de 16px)
  const alturaDisponible = contenedor.clientHeight - HEADER_H;
  const margenSeguridad = totalFilas * 2 + 10;
  // El piso debe ser >= al "min-height: 36px" que fija .gantt-row en CSS:
  // si el valor calculado fuera menor, el navegador renderiza cada fila
  // más alta de lo que este cálculo asume, y ese faltante por fila se
  // acumula (arrastre progresivo) en todo lo que se posiciona por
  // "rowIndex * ROW_H" — en particular, los conectores de dependencias.
  const ROW_H = impresion
    ? Math.min(40, Math.max(11, Math.floor((impresion.h - HEADER_H) / Math.max(1, totalFilas))))
    : (totalFilas > 0
        ? Math.max(36, Math.floor((alturaDisponible - margenSeguridad) / totalFilas))
        : 36);

  // Tamaños proporcionales a la altura de fila
  const BAR_H_GRUPO = Math.min(Math.round(ROW_H * 0.62), 22);
  const BAR_H_TAREA = Math.min(Math.round(ROW_H * 0.50), 16);
  const FONT_BAR    = Math.min(Math.round(ROW_H * 0.34), 10);
  // En pantalla el nombre usa vh (responsive); para impresión conviene un
  // px fijo proporcional a la fila (el vh depende del viewport de la
  // ventana de impresión y sale inconsistente).
  const FONT_NOMBRE = impresion
    ? Math.min(13, Math.max(8, Math.round(ROW_H * 0.42))) + 'px'
    : '1.6vh';

  // ── Franjas de fin de semana y línea de hoy ──
  const fdsStripes = dias.map((d, i) =>
    (d.getDay() === 0 || d.getDay() === 6)
      ? `<div class="gantt-fds-stripe" style="left:${i * DIA_W}px;width:${DIA_W}px;"></div>`
      : ''
  ).join('');

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const hoyLine = (hoy >= fechaMin && hoy <= fechaMax)
    ? `<div class="gantt-hoy-line" style="left:${dateToX(hoy) + Math.floor(DIA_W / 2)}px;"></div>
       <div class="gantt-hoy-col" style="left:${dateToX(hoy)}px;width:${DIA_W}px;"></div>`
    : '';

  let namesHTML = '';
  let barsHTML = '';
  // Registra, en el mismo orden en que se emiten las filas, el rango de
  // fechas de cada una — se usa después para el auto-scroll a "HOY".
  const filasParaScroll = [];
  // Geometría (x/ancho/fila/alto de barra) de cada tarea realmente renderizada,
  // indexada por Id — la usan los conectores de dependencias (Predecesoras)
  // para saber de dónde a dónde trazar cada flecha.
  const barGeom = {};

  // ── Resaltado de tareas críticas/atrasadas + cascada por predecesoras ──
  // Reglas (afinadas para que "crítica" modele riesgo real, no solo fecha):
  //  - Solo tareas HOJA (Resumen = NO) se resaltan; las resumen nunca se
  //    pintan aunque su rango de fechas agregado cumpla la condición.
  //  - Crítica y atrasada son mutuamente excluyentes, sin excepción — ni
  //    siquiera vía cascada: cualquier tarea con fin < hoy queda 100% afuera
  //    de "crítica" (esTareaCriticaGantt ya lo exige, y el propio cascade
  //    vuelve a chequearlo antes de marcar una predecesora).
  //  - No calculamos holgura/ruta crítica real (CPM) porque esa información
  //    no existe en los datos exportados desde el .mpp (no hay campo de
  //    Holgura/Total Slack) — se aproxima con "vence dentro de los próximos
  //    7 días y no está completada", que es la misma idea práctica.
  //  - Atrasada NUNCA cascada hacia predecesoras: solo se pinta la tarea en
  //    sí, nunca la cadena que la alimenta.
  //  - Crítica sí cascada hacia predecesoras, pero SOLO si la predecesora:
  //      a) no está resumen,
  //      b) no está 100% completada (si ya completó, no compromete nada a
  //         futuro, sin importar cuán "atada" esté la sucesora),
  //      c) no está vencida (fin >= hoy — si ya venció es "atrasada", nunca
  //         "crítica", para no romper la exclusión mutua),
  //      d) precede en el tiempo a la tarea que la lista (fecha de inicio
  //         menor o igual) — nunca se cascada hacia una referencia
  //         invertida en los datos.
  function esTareaCriticaGantt(fechaFin, porcentajeCompletado) {
    if (!fechaFin) return false;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const limite = new Date(hoy); limite.setDate(limite.getDate() + 7);
    const fin = parseFechaLocal(fechaFin);
    if (!fin || isNaN(fin.getTime())) return false;
    fin.setHours(0, 0, 0, 0);
    return fin >= hoy && fin < limite && Number(porcentajeCompletado) < 100;
  }

  const esResumenPorClave = {};
  const fechaInicioPorClave = {};
  const fechaFinPorClave = {};
  const pctPorClave = {};
  const predecesorasPorClave = {};
  filasArbol.forEach(t => {
    const clave = claveTareaConector(t["ID Proyecto"], t["Id"]);
    esResumenPorClave[clave] = String(t["Resumen"]).trim().toLowerCase() === "true";
    const ini = parseFechaLocal(t["Comienzo"]);
    if (ini) ini.setHours(0, 0, 0, 0);
    fechaInicioPorClave[clave] = ini || null;
    const fin = parseFechaLocal(t["Fin"]);
    if (fin) fin.setHours(0, 0, 0, 0);
    fechaFinPorClave[clave] = fin || null;
    pctPorClave[clave] = Number(t["% completado"] || 0);
    const predRaw = limpiarTexto(t["Predecesoras"]);
    predecesorasPorClave[clave] = predRaw
      ? predRaw.split(",").map(p => claveTareaConector(t["ID Proyecto"], limpiarTexto(p))).filter(Boolean)
      : [];
  });
  const hoyParaCascada = new Date(); hoyParaCascada.setHours(0, 0, 0, 0);

  function propagarCriticaHaciaPredecesoras(clavesIniciales) {
    const resaltadas = new Set();
    const pila = [...clavesIniciales];
    while (pila.length) {
      const clave = pila.pop();
      if (resaltadas.has(clave)) continue;
      resaltadas.add(clave);
      (predecesorasPorClave[clave] || []).forEach(claveOrigen => {
        if (resaltadas.has(claveOrigen)) return;
        if (esResumenPorClave[claveOrigen]) return; // las resumen nunca se pintan
        if (pctPorClave[claveOrigen] >= 100) return; // ya completó: no compromete el futuro
        const finOrigen = fechaFinPorClave[claveOrigen];
        if (finOrigen && finOrigen < hoyParaCascada) return; // vencida = atrasada, nunca crítica
        const iniOrigen = fechaInicioPorClave[claveOrigen];
        const iniActual = fechaInicioPorClave[clave];
        // Solo avanza hacia una predecesora que de verdad quede antes en el
        // tiempo; nunca hacia una referencia invertida (que "empieza" después).
        if (iniOrigen && iniActual && iniOrigen > iniActual) return;
        pila.push(claveOrigen);
      });
    }
    return resaltadas;
  }

  const clavesCriticasDirectas = filasArbol
    .filter(t => !esResumenPorClave[claveTareaConector(t["ID Proyecto"], t["Id"])])
    .filter(t => esTareaCriticaGantt(t["Fin"], t["% completado"]))
    .map(t => claveTareaConector(t["ID Proyecto"], t["Id"]));
  const clavesAtrasadasDirectas = filasArbol
    .filter(t => !esResumenPorClave[claveTareaConector(t["ID Proyecto"], t["Id"])])
    .filter(t => esTareaAtrasada(t["Fin"], t["% completado"]))
    .map(t => claveTareaConector(t["ID Proyecto"], t["Id"]));

  const clavesCriticasResaltadas = ganttResaltarCriticas
    ? propagarCriticaHaciaPredecesoras(clavesCriticasDirectas)
    : null;
  // Atrasada nunca cascada: el set resaltado es exactamente el directo.
  const clavesAtrasadasResaltadas = ganttResaltarAtrasadas
    ? new Set(clavesAtrasadasDirectas)
    : null;

  // ── Ruta crítica del proyecto (CPM simplificado) ──
  // No hay campo de Holgura/Total Slack en los datos exportados del .mpp,
  // así que se reconstruye con el criterio estándar de CPM: desde la
  // ÚLTIMA actividad del proyecto (mayor fecha de Fin entre las tareas
  // hoja), se traza hacia atrás eligiendo en cada paso la o las
  // predecesoras "dominantes" — la de fin más tardío entre todas las
  // predecesoras de esa tarea, que es la que realmente determina cuándo
  // puede arrancar la sucesora (si esa predecesora se atrasa, atrasa toda
  // la cadena). Las que ya terminaron antes no son dominantes: tienen
  // holgura frente a esa tarea puntual y no forman parte de la ruta.
  function calcularRutaCritica() {
    // Solo tareas HOJA, no resumen, y NO completadas al 100%: una tarea ya
    // terminada no compromete nada a futuro (mismo criterio que la cascada
    // de "Tareas Críticas" más abajo), así que no debe formar parte de la
    // ruta ni servir de punto de partida para trazarla hacia atrás.
    const clavesHoja = filasArbol
      .map(t => claveTareaConector(t["ID Proyecto"], t["Id"]))
      .filter(clave => !esResumenPorClave[clave] && fechaFinPorClave[clave] && pctPorClave[clave] < 100);
    if (!clavesHoja.length) return { nodos: new Set(), aristas: new Set() };

    let maxFin = null;
    clavesHoja.forEach(clave => {
      const fin = fechaFinPorClave[clave];
      if (!maxFin || fin > maxFin) maxFin = fin;
    });

    const nodos = new Set(clavesHoja.filter(clave => fechaFinPorClave[clave].getTime() === maxFin.getTime()));
    const aristas = new Set();
    const pila = [...nodos];

    while (pila.length) {
      const claveActual = pila.pop();
      const iniActual = fechaInicioPorClave[claveActual];
      const predsValidas = (predecesorasPorClave[claveActual] || []).filter(p => {
        if (esResumenPorClave[p] || !fechaFinPorClave[p]) return false;
        if (pctPorClave[p] >= 100) return false; // ya completó: no compromete nada a futuro
        const iniP = fechaInicioPorClave[p];
        // Descarta referencias invertidas (predecesora que en los datos
        // en realidad arranca después que la tarea que la lista).
        return !(iniP && iniActual && iniP > iniActual);
      });
      if (!predsValidas.length) continue;

      let finMaxPred = null;
      predsValidas.forEach(p => {
        const fin = fechaFinPorClave[p];
        if (!finMaxPred || fin > finMaxPred) finMaxPred = fin;
      });

      predsValidas
        .filter(p => fechaFinPorClave[p].getTime() === finMaxPred.getTime())
        .forEach(p => {
          aristas.add(`${p}=>${claveActual}`);
          if (!nodos.has(p)) {
            nodos.add(p);
            pila.push(p);
          }
        });
    }
    return { nodos, aristas };
  }

  const { nodos: clavesRutaCriticaResaltadas, aristas: aristasRutaCritica } = ganttResaltarRutaCritica
    ? calcularRutaCritica()
    : { nodos: new Set(), aristas: new Set() };

  // Prioridad visual cuando una tarea cae en más de una categoría a la vez:
  // atrasada (ya está pasando) > ruta crítica (estructural, afecta a todo
  // el proyecto) > crítica por fecha próxima (informativo).
  function colorResaltadoDe(clave) {
    if (esResumenPorClave[clave]) return null; // las resumen nunca se pintan
    if (clavesAtrasadasResaltadas && clavesAtrasadasResaltadas.has(clave)) return COLOR_GANTT_ATRASADA;
    if (clavesRutaCriticaResaltadas.has(clave)) return COLOR_GANTT_RUTA_CRITICA;
    if (clavesCriticasResaltadas && clavesCriticasResaltadas.has(clave)) return COLOR_GANTT_CRITICA;
    return null;
  }

  // MS Project/MPXJ ya calcula Comienzo/Fin/%/Duración de las tareas
  // resumen a partir de sus hijas, así que cada nodo (hoja o resumen) lee
  // directamente los datos de su propia fila — sin reagregar nada a mano.
  function renderNodo(nodo, profundidad) {
    const t = nodo.fila;
    const esResumen = nodo.hijos.length > 0;
    const id = String(t["Id"]);
    const estaColapsado = esResumen && gruposColapsados.has(id);
    const claveActual = claveTareaConector(t["ID Proyecto"], t["Id"]);

    const ini = parseFechaLocal(t["Comienzo"]);
    const fin = parseFechaLocal(t["Fin"]);

    if (ini && fin) {
      ini.setHours(0, 0, 0, 0); fin.setHours(0, 0, 0, 0);

      const pct = Number(t["% completado"] || 0);
      const nombre = capitalizarPrimeraLetra(limpiarTexto(t["Nombre de tarea"] || t["Nombre"]));
      const responsable = limpiarTexto(t["Responsable"]);
      const finStr = `${String(fin.getDate()).padStart(2,'0')}/${String(fin.getMonth()+1).padStart(2,'0')}/${fin.getFullYear()}`;
      const iniStr = `${String(ini.getDate()).padStart(2,'0')}/${String(ini.getMonth()+1).padStart(2,'0')}/${ini.getFullYear()}`;

      const tX = dateToX(ini);
      const tW = Math.max(DIA_W, dateToX(fin) + DIA_W - tX);
      const durAMostrar = contarDiasHabilesEntre(ini, fin);

      const indent = profundidad * 14;
      const esRaiz = profundidad === 0;
      const dataGrupoAttrs = esRaiz ? ` data-grupo="${normalizarGrupoId(t["Grupo_ID"])}"` : '';

      // ── FILA NOMBRE (panel izquierdo) ──
      const trianguloIcon = esResumen
        ? `<span class="gantt-colapsar" data-colapsar="${id}" style="cursor:pointer;font-size:9px;color:rgba(255,255,255,0.5);margin-right:4px;flex-shrink:0;transition: color 0.2s ease;user-select:none;">${estaColapsado ? '▶' : '▼'}</span>`
        : '';
      const claseNombre = esResumen ? 'g-nombre' : 'g-nombre g-nombre-ind';
      const claseFila = esResumen ? 'gantt-row-grupo' : 'gantt-row-tarea';

      const tieneComentarios = (comentariosConteo[claveActual] || 0) > 0;
      const iconoComentario = MODO_DEMO ? "" : `<span class="gantt-comentario-btn${tieneComentarios ? ' tiene-comentarios' : ''}" data-comentario="${claveActual}" data-nombre="${nombre}" data-tooltip="${tieneComentarios ? 'Ver comentarios' : 'Agregar comentario'}">💬</span>`;

      namesHTML += `<div class="gantt-row ${claseFila}" data-id="${claveActual}" style="height:${ROW_H}px;">
          <span class="${claseNombre}" data-tipo="nombre" data-label="${nombre}"${dataGrupoAttrs} style="font-size:${FONT_NOMBRE};padding-left:${indent}px;">${trianguloIcon}${nombre}</span>
          <span class="g-dur">${durAMostrar}d</span>
          ${iconoComentario}
        </div>`;

      // ── FILA BARRA (panel derecho) ──
      // Alto "visual" de la barra en esta fila, usado sólo para calcular por
      // dónde entran/salen las flechas de dependencias (no afecta el dibujo).
      let alturaBarraConector = BAR_H_TAREA;

      if (esResumen) {
        alturaBarraConector = BAR_H_GRUPO;
        // Tarea resumen: solo bordes laterales + superior (bracket [----]),
        // sin relleno interior de avance — únicamente el número de %. Las
        // resumen nunca se resaltan (ver colorResaltadoDe), siempre verde.
        const colorBordeG = COLOR_GANTT_BARRA.borde;
        const labelInsideG = (tW >= 35 && pct >= 1) ? `<span class="gantt-bar-lbl" style="font-size:${FONT_BAR}px;color:#fff;font-weight:700;">${pct.toFixed(0)}%</span>` : '';
        const labelOutsideG = (tW < 35 && pct >= 1)
          ? `<span style="position:absolute; left:${tX + tW + 6}px; top:0; bottom:0; margin:auto; display:flex; align-items:center; font-size:${FONT_BAR}px; color:#fff; font-weight:700; z-index:2; pointer-events:none;">${pct.toFixed(0)}%</span>`
          : '';

        barsHTML += `<div class="gantt-row ${claseFila}" data-id="${claveActual}" style="height:${ROW_H}px;">
            <div class="gantt-bar gantt-bar-resumen" style="left:${tX}px;width:${tW}px;height:${BAR_H_GRUPO}px;font-size:${FONT_BAR}px;border-color:${colorBordeG};" data-tipo="grupo" data-label="${nombre}"${dataGrupoAttrs} data-inicio="${iniStr}" data-fin="${finStr}" data-pct="${pct.toFixed(1)}">
              <span class="gantt-resumen-cap gantt-resumen-cap-left" style="background:${colorBordeG};"></span>
              <span class="gantt-resumen-cap gantt-resumen-cap-right" style="background:${colorBordeG};"></span>
              ${labelInsideG}
            </div>
            ${labelOutsideG}
          </div>`;
      } else {
        const textoDuracion = String(t["Duración"] || "1").replace(",", ".");
        const duracionNumerica = parseFloat(textoDuracion.replace(/[^\d.-]/g, ''));
        const esHito = duracionNumerica === 0;

        if (esHito) {
          alturaBarraConector = 14;
          const mitadDia = DIA_W / 2;
          const leftRombo = tX + mitadDia - 7;
          const colorRombo = "#FFC107";
          const bordeRombo = "#B38700";

          const responsableHTML = (responsable && responsable !== "Sin Asignar")
            ? `<span class="gantt-bar-responsable" style="left:${leftRombo + 22}px;">${responsable}</span>`
            : '';

          // FILA HITO — altura dinámica
          barsHTML += `<div class="gantt-row gantt-row-tarea" data-id="${claveActual}" style="height:${ROW_H}px;">
              <div style="position:absolute; left:${leftRombo}px; top:50%; margin-top:-7px; width:14px; height:14px; background-color:${colorRombo}; border:2px solid ${bordeRombo}; transform:rotate(45deg); z-index:4; cursor:pointer; box-shadow: 0 0 8px ${colorRombo}80;" data-tipo="tarea" data-label="${nombre} (Hito)" data-inicio="${iniStr}" data-fin="${finStr}" data-pct="${pct}" data-color="${colorRombo}"></div>
              ${responsableHTML}
            </div>`;

        } else {
          const { borde: colorBorde, fondo: colorFondo, progreso: colorProg } = colorResaltadoDe(claveActual) || COLOR_GANTT_BARRA;

          const esBarra1Dia = durAMostrar <= 2;
          const labelColor = pct >= 100 ? "#1a1a1a" : "rgba(255,255,255,0.85)";
          const pctRedondeado = Math.round(pct);
          const labelInsideT = (tW >= 35 && !esBarra1Dia && pctRedondeado >= 1) ? `<span class="gantt-bar-lbl" style="font-size:${FONT_BAR}px;color:${labelColor};font-weight:700;">${pctRedondeado}%</span>` : '';

          let labelOutsideT = '';
          let responsableLeft = tX + tW + 6;
          if ((tW < 35 || esBarra1Dia) && pctRedondeado >= 1) {
            const espacioRestanteT = totalW - (tX + tW);
            if (espacioRestanteT < 30) {
              labelOutsideT = `<span style="position:absolute; left:${tX - 6}px; transform: translateX(-100%); top:0; bottom:0; margin:auto; display:flex; align-items:center; font-size:${FONT_BAR}px; color:rgba(255,255,255,0.85); z-index:2; pointer-events:none; font-family:'DM Sans',Inter,sans-serif;">${pctRedondeado}%</span>`;
            } else {
              labelOutsideT = `<span style="position:absolute; left:${tX + tW + 6}px; top:0; bottom:0; margin:auto; display:flex; align-items:center; font-size:${FONT_BAR}px; color:rgba(255,255,255,0.85); z-index:2; pointer-events:none; font-family:'DM Sans',Inter,sans-serif;">${pctRedondeado}%</span>`;
              responsableLeft = tX + tW + 6 + 30;
            }
          }

          const responsableHTML = (responsable && responsable !== "Sin Asignar")
            ? `<span class="gantt-bar-responsable" style="left:${responsableLeft}px;">${responsable}</span>`
            : '';

          // FILA TAREA barra — altura dinámica
          barsHTML += `<div class="gantt-row gantt-row-tarea" style="height:${ROW_H}px;">
              <div class="gantt-bar gantt-bar-tarea" style="left:${tX}px;width:${tW}px;height:${BAR_H_TAREA}px;font-size:${FONT_BAR}px;background:${colorFondo};border-color:${colorBorde};" data-tipo="tarea" data-label="${nombre}" data-inicio="${iniStr}" data-fin="${finStr}" data-pct="${pct}" data-color="${colorBorde}">
                <div class="gantt-bar-prog gantt-prog-tarea" style="width:${tW * pct / 100}px;background:${colorProg};"></div>
                ${labelInsideT}
              </div>
              ${labelOutsideT}
              ${responsableHTML}
            </div>`;
        }
      }

      barGeom[claveTareaConector(t["ID Proyecto"], t["Id"])] = { left: tX, right: tX + tW, rowIndex: filasParaScroll.length, h: alturaBarraConector };
      filasParaScroll.push({ index: filasParaScroll.length, ini: new Date(ini), fin: new Date(fin) });

      if (esResumen && !estaColapsado) {
        nodo.hijos.forEach(h => renderNodo(h, profundidad + 1));
      }
    } else if (esResumen && !estaColapsado) {
      // Fila sin fechas válidas: no se dibuja, pero sus hijas sí.
      nodo.hijos.forEach(h => renderNodo(h, profundidad));
    }
  }

  bosque.forEach(raiz => renderNodo(raiz, 0));

  // ══════════════════════════════════════
  //  CONECTORES DE DEPENDENCIAS (Predecesoras)
  //  Rutas ortogonales (90°) desde el extremo derecho (Fin) de la tarea
  //  origen hasta la tarea destino:
  //   - Caso A (sin colisión horizontal): baja recto y gira para entrar
  //     perpendicularmente por el borde superior (o inferior, si el
  //     destino está más arriba) de la barra destino.
  //   - Caso B (giro en "U"): cuando el destino queda a la izquierda del
  //     punto de salida, rodea por detrás/debajo (o arriba) de la barra
  //     origen y entra perpendicularmente por su extremo izquierdo.
  // ══════════════════════════════════════
  function construirRutaConector(origen, destino) {
    const JOG = 14;
    const ENTRY = 6; // margen fijo de entrada, para que el "escalón" sea siempre igual
    const exitX = origen.right;
    const exitY = origen.rowIndex * ROW_H + ROW_H / 2;
    const mismaFila = destino.rowIndex === origen.rowIndex;
    const haciaAbajo = destino.rowIndex >= origen.rowIndex;
    const destTop = destino.rowIndex * ROW_H + (ROW_H - destino.h) / 2;
    const destBottom = destTop + destino.h;
    const destCenterY = destino.rowIndex * ROW_H + ROW_H / 2;

    // Caso A: el descenso recto desde "exitX" cae dentro (o antes) del
    // ancho de la barra destino, así que un giro a la derecha alcanza
    // para entrar por su borde superior/inferior. El punto de entrada usa
    // siempre el mismo margen fijo (no depende de "exitX") para que la
    // escalera de conectores quede pareja, sin desfases que se acumulen.
    if (!mismaFila && exitX <= destino.right) {
      const entryX = Math.min(destino.left + ENTRY, destino.right - 2);
      const bordeY = haciaAbajo ? destTop : destBottom;
      // El "codo" horizontal debe quedar dentro del margen libre que ya
      // existe entre el borde de la fila y el borde de la barra destino:
      // si se pasa de ahí, la línea invade visualmente la fila vecina.
      const margenLibre = Math.max(1, (ROW_H - destino.h) / 2 - 1);
      const GAP = Math.min(5, margenLibre);
      const midY = haciaAbajo ? bordeY - GAP : bordeY + GAP;
      return `M ${exitX} ${exitY} L ${exitX} ${midY} L ${entryX} ${midY} L ${entryX} ${bordeY}`;
    }

    // Caso B: el destino queda a la izquierda del punto de salida — hay
    // que rodear por detrás/debajo (o arriba) de la barra origen y entrar
    // centrado verticalmente por el extremo izquierdo de la barra destino.
    // El rodeo se mantiene dentro del margen libre de la propia fila
    // origen (nunca cruza a la fila siguiente), para que no pise otra barra.
    const margenLibreOrigen = Math.max(1, (ROW_H - origen.h) / 2 - 1);
    const GAP_RODEO = Math.min(4, margenLibreOrigen);
    const filaOrigenTop = origen.rowIndex * ROW_H;
    const filaOrigenBottom = filaOrigenTop + ROW_H;
    const yRodeo = haciaAbajo ? filaOrigenBottom - GAP_RODEO : filaOrigenTop + GAP_RODEO;
    const xRodeo = destino.left - JOG;
    return `M ${exitX} ${exitY} L ${exitX} ${yRodeo} L ${xRodeo} ${yRodeo} L ${xRodeo} ${destCenterY} L ${destino.left} ${destCenterY}`;
  }

  let conectoresHTML = '';
  filasArbol.forEach(t => {
    const predRaw = limpiarTexto(t["Predecesoras"]);
    if (!predRaw) return;
    const claveDestino = claveTareaConector(t["ID Proyecto"], t["Id"]);
    const destino = barGeom[claveDestino];
    if (!destino) return;
    predRaw.split(",").forEach(p => {
      const idOrigenRaw = limpiarTexto(p);
      if (!idOrigenRaw) return;
      // Las predecesoras de MPXJ siempre son del mismo archivo .mpp, así
      // que la tarea origen está en el mismo "ID Proyecto" que el destino.
      const claveOrigen = claveTareaConector(t["ID Proyecto"], idOrigenRaw);
      const origen = barGeom[claveOrigen];
      if (!origen || origen === destino) return;
      const ruta = construirRutaConector(origen, destino);
      // Prioridad de color de arista: ruta crítica (solo la arista que la
      // propia CPM eligió como dominante) > crítica por cascada (ambos
      // extremos en el set, ya filtrado por referencias invertidas) > azul
      // por defecto. Atrasada nunca cascada, así que nunca pinta aristas.
      const esAristaRuta = aristasRutaCritica.has(`${claveOrigen}=>${claveDestino}`);
      const esAristaCritica = !esAristaRuta && clavesCriticasResaltadas
        && clavesCriticasResaltadas.has(claveOrigen)
        && clavesCriticasResaltadas.has(claveDestino);
      const claseResaltado = esAristaRuta ? ' gantt-conector-ruta-critica' : (esAristaCritica ? ' gantt-conector-critica' : '');
      const marker = esAristaRuta ? 'flechaConectorRutaCritica' : (esAristaCritica ? 'flechaConectorCritica' : 'flechaConectorDep');
      conectoresHTML += `<path d="${ruta}" class="gantt-conector-linea${claseResaltado}" marker-end="url(#${marker})"></path>`;
    });
  });

  const alturaTotalConectores = totalFilas * ROW_H;
  const conectoresSVG = conectoresHTML
    ? `<svg class="gantt-conectores" width="${totalW}" height="${alturaTotalConectores}" viewBox="0 0 ${totalW} ${alturaTotalConectores}">
        <defs>
          <marker id="flechaConectorDep" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z"></path>
          </marker>
          <marker id="flechaConectorCritica" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="#F59E0B"></path>
          </marker>
          <marker id="flechaConectorRutaCritica" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="#A855F7"></path>
          </marker>
        </defs>
        ${conectoresHTML}
      </svg>`
    : '';

  contenedor.innerHTML = `
    
    <div class="gantt-wrap">
      <div class="gantt-left" style="width:${ganttLeftWidth}px;">
        <div class="gantt-lh" style="height: ${HEADER_H}px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; padding: 0 6px 0 10px; background: #081a14; border-bottom: 2px solid #006D59;">
          <span style="font-size:10px;font-weight:700;">Grupo / Tarea</span>

          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="display: flex; gap: 6px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 10px;">
              <button type="button" class="gantt-highlight-btn${ganttResaltarAtrasadas ? ' activo' : ''}" id="ganttBtnAtrasadas" data-resaltado="atrasada" data-tooltip="Tareas Atrasadas">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </button>
              <button type="button" class="gantt-highlight-btn${ganttResaltarCriticas ? ' activo' : ''}" id="ganttBtnCriticas" data-resaltado="critica" data-tooltip="Tareas Críticas">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </button>
              <button type="button" class="gantt-highlight-btn${ganttResaltarRutaCritica ? ' activo' : ''}" id="ganttBtnRutaCritica" data-resaltado="ruta-critica" data-tooltip="Ruta Crítica">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="6" cy="6" r="2"></circle>
                  <circle cx="18" cy="6" r="2"></circle>
                  <circle cx="12" cy="18" r="2"></circle>
                  <path d="M6 8v3a4 4 0 0 0 4 4h0"></path>
                  <path d="M18 8v3a4 4 0 0 0-4 4h0"></path>
                </svg>
              </button>
            </div>
            <div style="display: flex; gap: 10px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 4px;">

              <svg class="gantt-icon" title="Guardar MPP" data-tooltip="Guardar MPP" onclick="descargarProyecto()" style="${MODO_DEMO ? 'display:none' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>

              <svg class="gantt-icon" title="Print" data-tooltip="Print" onclick="imprimirGantt()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>

              <svg class="gantt-icon" id="btnFullscreenGantt" title="${tituloIconoFullscreen}" data-tooltip="${tituloIconoFullscreen}" onclick="toggleFullscreenGantt()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path class="fs-icon-path" d="${pathIconoFullscreen}"></path>
              </svg>

            </div>
            <span style="font-size:9px;color:#888;padding-right:20px;">Dur.</span>
          </div>
        </div>
        <div class="gantt-lb" id="ganttLB">${namesHTML}</div>
      </div>
      <div class="gantt-resizer" id="ganttResizer" title="Arrastrar para redimensionar"></div>
      <div class="gantt-right" id="ganttRP">
        <div class="gantt-th" style="width:${totalW}px; height:${HEADER_H}px;">
          <div class="gantt-hr">${mesHTML}</div>
          <div class="gantt-hr">${diaHTML}</div>
        </div>
        <div class="gantt-ba" style="width:${totalW}px;">
          ${fdsStripes}
          ${hoyLine}
          ${barsHTML}
          ${conectoresSVG}
        </div>
      </div>
    </div>
  `;

  // Modo impresión: el clon se toma directo de este HTML ya renderizado.
  // Nada de lo que sigue (toggles, scroll, listeners, tooltips, centrado en
  // HOY) tiene sentido sobre el papel, y ejecutarlo movería el scroll del
  // Gantt en pantalla.
  if (impresion) return;

  // El selector Día/Semana/Mes vive en la barra de filtros de pantalla
  // completa (#filtrosFsGantt, junto a "Limpiar Filtros"), no en la
  // cabecera del Gantt — así queda más espacio ahí arriba. Esa barra es
  // markup estático de index.html, así que el toggle se inyecta acá.
  const ganttZoomToggleSlot = document.getElementById("ganttZoomToggleSlot");
  if (ganttZoomToggleSlot) {
    ganttZoomToggleSlot.innerHTML = `
      <div class="gantt-zoom-toggle" id="ganttZoomToggle">
        <button type="button" class="gantt-zoom-btn${ganttZoom === 'dia' ? ' activo' : ''}" data-zoom="dia" data-tooltip="Vista por día">D</button>
        <button type="button" class="gantt-zoom-btn${ganttZoom === 'semana' ? ' activo' : ''}" data-zoom="semana" data-tooltip="Vista por semana">S</button>
        <button type="button" class="gantt-zoom-btn${ganttZoom === 'mes' ? ' activo' : ''}" data-zoom="mes" data-tooltip="Vista por mes">M</button>
      </div>
    `;
  }

  const lb = document.getElementById("ganttLB");
  const rp = document.getElementById("ganttRP");

  // Ancho/zoom cambian DIA_W, así que el scrollLeft en píxeles de ANTES ya
  // no apunta a la misma fecha después de re-renderizar. Guardamos qué
  // fecha está en el centro de la vista actual (con el DIA_W vigente) para
  // volver a centrarla después, en vez de dejar que el scroll salte a un
  // punto arbitrario del timeline.
  function guardarFechaCentroParaScroll() {
    const centroX = rp.scrollLeft + rp.clientWidth / 2;
    window._ganttScrollToDate = new Date(fechaMin.getTime() + (centroX / DIA_W) * 86400000);
  }

  // ── Divisor arrastrable del panel "Tarea / Grupo" ──
  const ganttLeftEl = contenedor.querySelector(".gantt-left");
  const resizer = document.getElementById("ganttResizer");
  if (resizer && ganttLeftEl) {
    resizer.addEventListener("mousedown", (eDown) => {
      eDown.preventDefault();
      const startX = eDown.clientX;
      const startWidth = ganttLeftEl.getBoundingClientRect().width;
      // Un click sin movimiento (como los dos clicks que componen un
      // doble clic) no debe contar como arrastre: si tratáramos cualquier
      // mousedown+mouseup como resize, cada click suelto dispararía un
      // re-render (mismo ancho, sin sentido) y el doble clic terminaría
      // acumulando 3 renders seguidos, con el consiguiente parpadeo/salto
      // del scroll. Solo se activa el resize si el mouse realmente se movió.
      const UMBRAL_ARRASTRE = 3;
      let arrastrando = false;

      function onMove(eMove) {
        const delta = eMove.clientX - startX;
        if (!arrastrando) {
          if (Math.abs(delta) < UMBRAL_ARRASTRE) return;
          arrastrando = true;
          resizer.classList.add("resizing");
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }
        const nuevoAncho = Math.min(GANTT_LEFT_W_MAX, Math.max(GANTT_LEFT_W_MIN, startWidth + delta));
        ganttLeftEl.style.width = nuevoAncho + "px";
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (!arrastrando) return; // fue un click simple: no tocar nada
        resizer.classList.remove("resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setGanttLeftWidth(ganttLeftEl.getBoundingClientRect().width);
        // Re-renderizamos para recalcular el ancho de columnas de días
        // (depende del ancho disponible a la derecha del panel) y mantener
        // los conectores/barras alineados con el nuevo ancho.
        guardarFechaCentroParaScroll();
        window._ganttSkipScroll = true;
        renderGantt(tareasFiltradas);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Doble clic: restaurar el ancho por defecto del panel izquierdo sin
    // tocar la posición del timeline (se recentra en la misma fecha).
    resizer.addEventListener("dblclick", () => {
      setGanttLeftWidth(GANTT_LEFT_W_DEFAULT);
      guardarFechaCentroParaScroll();
      window._ganttSkipScroll = true;
      renderGantt(tareasFiltradas);
    });
  }

  // ── Selector de escala temporal (Día / Semana / Mes) ──
  const zoomToggle = document.getElementById("ganttZoomToggle");
  if (zoomToggle) {
    zoomToggle.querySelectorAll(".gantt-zoom-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const nivel = btn.dataset.zoom;
        if (nivel === getGanttZoom()) return;
        setGanttZoom(nivel);
        guardarFechaCentroParaScroll();
        window._ganttSkipScroll = true;
        renderGantt(tareasFiltradas);
      });
    });
  }

  // ── Toggles de resaltado: Tareas Críticas / Tareas Atrasadas ──
  const btnCriticas = document.getElementById("ganttBtnCriticas");
  if (btnCriticas) {
    btnCriticas.addEventListener("click", () => {
      ganttResaltarCriticas = !ganttResaltarCriticas;
      guardarFechaCentroParaScroll();
      window._ganttSkipScroll = true;
      renderGantt(tareasFiltradas);
    });
  }
  const btnAtrasadas = document.getElementById("ganttBtnAtrasadas");
  if (btnAtrasadas) {
    btnAtrasadas.addEventListener("click", () => {
      ganttResaltarAtrasadas = !ganttResaltarAtrasadas;
      guardarFechaCentroParaScroll();
      window._ganttSkipScroll = true;
      renderGantt(tareasFiltradas);
    });
  }
  const btnRutaCritica = document.getElementById("ganttBtnRutaCritica");
  if (btnRutaCritica) {
    btnRutaCritica.addEventListener("click", () => {
      ganttResaltarRutaCritica = !ganttResaltarRutaCritica;
      guardarFechaCentroParaScroll();
      window._ganttSkipScroll = true;
      renderGantt(tareasFiltradas);
    });
  }

  // Bloquear scroll Y si las filas caben en el panel (con margen de tolerancia).
  // Esto se resuelve ANTES de restaurar el scroll horizontal porque agregar
  // la scrollbar vertical angosta rp.clientWidth: si se decidiera después
  // (como antes, en un requestAnimationFrame diferido), el centrado de abajo
  // usaría un ancho "sin scrollbar" que ya no coincide con el que se leyó al
  // guardar la fecha centro (guardarFechaCentroParaScroll, del render
  // anterior, que sí tenía la scrollbar resuelta) y el Gantt se corría un
  // poco en cada render — visible como un salto de ~1 día por click.
  if (rp && rp.scrollHeight > rp.clientHeight + 5) {
    rp.style.overflowY = "auto";
  }

  // Restaurar el scroll ANTES del primer paint, para que colapsar/expandir
  // un grupo no se vea como un salto al principio seguido de un salto de vuelta.
  if (window._ganttSkipScroll && scrollGanttPrevio) {
    if (window._ganttScrollToDate) {
      // El ancho de columna cambió (resize/zoom): reposicionamos por FECHA,
      // no por el píxel crudo de antes, que ya no corresponde al mismo día.
      const xCentro = dateToX(window._ganttScrollToDate);
      rp.scrollLeft = Math.max(0, xCentro - rp.clientWidth / 2);
    } else {
      rp.scrollLeft = scrollGanttPrevio.left;
    }
    rp.scrollTop  = scrollGanttPrevio.top;
    lb.scrollTop  = scrollGanttPrevio.top;
  }
  window._ganttScrollToDate = null;

  if (lb && rp) {
    let isSyncingLeft = false;
    let isSyncingRight = false;

    rp.addEventListener("scroll", () => {
      if (!isSyncingLeft) {
        isSyncingRight = true;
        lb.scrollTop = rp.scrollTop;
      }
      isSyncingLeft = false;
    });

    lb.addEventListener("scroll", () => {
      if (!isSyncingRight) {
        isSyncingLeft = true;
        rp.scrollTop = lb.scrollTop;
      }
      isSyncingRight = false;
    });

    lb.addEventListener('wheel', (e) => {
      e.preventDefault();
      rp.scrollTop += e.deltaY;
    }, { passive: false });

    const ganttBa = rp.querySelector(".gantt-ba");
    if (ganttBa) {
      // ── Resaltado sincronizado de filas ──
      function clearAllHighlights() {
        contenedor.querySelectorAll('.gantt-row-highlight').forEach(r => r.classList.remove('gantt-row-highlight'));
      }
      function syncHighlight(srcContainer, tgtContainer, e) {
        const row = e.target.closest('.gantt-row');
        clearAllHighlights();
        if (!row) return;
        const idx = Array.from(srcContainer.querySelectorAll('.gantt-row')).indexOf(row);
        if (idx < 0) return;
        row.classList.add('gantt-row-highlight');
        const tgtRows = tgtContainer.querySelectorAll('.gantt-row');
        if (tgtRows[idx]) tgtRows[idx].classList.add('gantt-row-highlight');
      }
      lb.addEventListener('mouseover', (e) => syncHighlight(lb, ganttBa, e));
      lb.addEventListener('mouseleave', clearAllHighlights);
      ganttBa.addEventListener('mouseover', (e) => syncHighlight(ganttBa, lb, e));
      ganttBa.addEventListener('mouseleave', clearAllHighlights);

      // ── Selección de fila por click: SOLO resalta, no filtra el dashboard
      // ni toca el zoom (antes, clickear una tarea/grupo la usaba como
      // filtro de búsqueda y esto achicaba el rango de fechas del Gantt a
      // una sola tarea, lo que se veía como un "re-zoom" feo). ──
      function limpiarSeleccionFila() {
        contenedor.querySelectorAll('.gantt-row-seleccionada').forEach(r => r.classList.remove('gantt-row-seleccionada'));
      }
      function seleccionarFila(srcContainer, tgtContainer, e) {
        // No interferir con el triángulo de colapsar/expandir grupos.
        if (e.target.closest('[data-colapsar]')) return;
        // Ni con el ícono de comentarios (tiene su propio click handler abajo).
        if (e.target.closest('[data-comentario]')) return;
        // En el panel de barras (derecha), la fila ocupa todo el ancho del
        // eje temporal pero la barra real solo cubre un tramo — el resto es
        // espacio vacío. Si cualquier click ahí resaltara, navegar el Gantt
        // prende y apaga el resaltado todo el tiempo sin querer. Por eso acá
        // solo vale click sobre la barra o su texto asociado (responsable);
        // en el panel de nombres (izquierda) toda la fila sigue siendo texto
        // válido.
        if (srcContainer === ganttBa && !e.target.closest('.gantt-bar, .gantt-bar-responsable, [data-tipo]')) return;
        const row = e.target.closest('.gantt-row');
        if (!row) return;
        const idx = Array.from(srcContainer.querySelectorAll('.gantt-row')).indexOf(row);
        if (idx < 0) return;
        const yaSeleccionada = row.classList.contains('gantt-row-seleccionada');
        limpiarSeleccionFila();
        if (yaSeleccionada) {
          // click de nuevo sobre la misma fila = deseleccionar
          ganttFilaSeleccionada = false;
          actualizarBotonLimpiarFiltros();
          return;
        }
        row.classList.add('gantt-row-seleccionada');
        const tgtRows = tgtContainer.querySelectorAll('.gantt-row');
        if (tgtRows[idx]) tgtRows[idx].classList.add('gantt-row-seleccionada');
        ganttFilaSeleccionada = true;
        actualizarBotonLimpiarFiltros();
      }
      lb.addEventListener('click', (e) => seleccionarFila(lb, ganttBa, e));
      ganttBa.addEventListener('click', (e) => seleccionarFila(ganttBa, lb, e));

      // ── Ícono de comentarios (panel izquierdo): abre el panel de
      // comentarios de esa tarea puntual, sin afectar la selección/resaltado.
      lb.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-comentario]');
        if (!btn) return;
        abrirPanelComentarios(btn.dataset.comentario, btn.dataset.nombre);
      });

      // ── Selección programática (ej. desde "Buscar"): resalta y centra la
      // fila verticalmente, igual que un click directo — el eje horizontal
      // ya quedó centrado más arriba vía window._ganttScrollToDate. ──
      if (window._ganttClaveAResaltar) {
        const claveObjetivo = window._ganttClaveAResaltar;
        window._ganttClaveAResaltar = null;
        const filasNombre = Array.from(lb.querySelectorAll('.gantt-row'));
        const idx = filasNombre.findIndex(f => f.dataset.id === claveObjetivo);
        if (idx >= 0) {
          limpiarSeleccionFila();
          filasNombre[idx].classList.add('gantt-row-seleccionada');
          const filasBarra = ganttBa.querySelectorAll('.gantt-row');
          if (filasBarra[idx]) filasBarra[idx].classList.add('gantt-row-seleccionada');
          requestAnimationFrame(() => {
            const scrollY = Math.max(0, filasNombre[idx].offsetTop - rp.clientHeight / 3);
            rp.scrollTop = scrollY;
            lb.scrollTop = scrollY;
          });
        }
      }

      const hoverLine = document.createElement("div");
      hoverLine.style.cssText = `
          position:absolute; top:0; bottom:0; width:0;
          border-left:2px dashed #aaaaaa;
          pointer-events:none; z-index:10; display:none;
      `;
      
      const hoverLabel = document.createElement("div");
      hoverLabel.style.cssText = `
        position:absolute; top:0;
        background:rgba(25,127,102,0.85); color:#fff;
        font-size:13px; font-weight:700;
        font-family: 'DM Sans', Inter, sans-serif;
        padding:3px 8px; border-radius:4px;
        pointer-events:none; z-index:11; display:none;
        white-space:nowrap;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        letter-spacing:0.5px;
      `;

      ganttBa.appendChild(hoverLine);
      ganttBa.appendChild(hoverLabel);

      rp.addEventListener("mousemove", (e) => {
        const x = e.clientX - ganttBa.getBoundingClientRect().left;
        const diaIndex = Math.floor(x / DIA_W);

        if (diaIndex >= 0 && diaIndex < dias.length) {
          const fecha = dias[diaIndex];
          const fechaStr = `${String(fecha.getDate()).padStart(2,'0')}/${String(fecha.getMonth()+1).padStart(2,'0')}/${fecha.getFullYear()}`;
          const lineX = diaIndex * DIA_W + Math.floor(DIA_W / 2);
          const y = e.clientY - ganttBa.getBoundingClientRect().top;

          hoverLine.style.left = `${lineX}px`;
          hoverLine.style.display = "block";
          hoverLabel.textContent = fechaStr;
          hoverLabel.style.left = `${lineX + 8}px`;
          
          let labelTop = y + 10;
          if (labelTop + 30 > ganttBa.offsetHeight) {
             labelTop = y - 30;
          }
          hoverLabel.style.top = `${labelTop}px`;
          hoverLabel.style.display = "block";
        }
      });

      rp.addEventListener("mouseleave", () => {
        hoverLine.style.display = "none";
        hoverLabel.style.display = "none";
      });

      // ── Pan / drag libre en el Gantt ──
      let isPanning = false;
      let panStartX = 0;
      let panStartY = 0;
      let panScrollLeft = 0;
      let panScrollTop = 0;

      rp.addEventListener("mousedown", (e) => {
        if (e.target.closest("[data-tipo]")) return; // no interferir con barras
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panScrollLeft = rp.scrollLeft;
        panScrollTop = rp.scrollTop;
        rp.style.cursor = "grabbing";
        e.preventDefault();
      });

      document.addEventListener("mousemove", (e) => {
        if (!isPanning) return;
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        rp.scrollLeft = panScrollLeft - dx;
        rp.scrollTop = panScrollTop - dy;
        lb.scrollTop = panScrollTop - dy;
      });

      document.addEventListener("mouseup", () => {
        if (!isPanning) return;
        isPanning = false;
        rp.style.cursor = "";
      });

      let ganttTooltip = document.getElementById("ganttTooltip");
      if (!ganttTooltip) {
        ganttTooltip = document.createElement("div");
        ganttTooltip.id = "ganttTooltip";
        ganttTooltip.style.cssText = `
          position: fixed;
          pointer-events: none;
          z-index: 999999;
          display: none;
          font-family: 'DM Sans', Inter, sans-serif;
          font-size: 18px;
          color: #fff;
          line-height: 1.4;
        `;
        document.body.appendChild(ganttTooltip);
      } else {
        ganttTooltip.style.zIndex = "999999";
      }

      function buildTooltipHTML(borderColor, titulo, filas) {
        const tituloHTML = titulo ? `
          <b style="display:block; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.1); max-width:260px; white-space:normal; word-break:break-word; font-size:13px; font-weight:bold; color:#fff;">
            ${titulo}
          </b>` : "";
        
        const filasHTML = filas.map(f => `
          <div style="display:flex; justify-content:space-between; gap:20px; margin-bottom:4px; font-size:13px; color:#fff;">
            <span style="color:#fff;"><span style="color:${borderColor}">●</span> ${f.label}</span>
            <b style="color:#fff;">${f.valor}</b>
          </div>
        `).join("");
        
        return `
          <div style="position:relative; padding:2px; background:${borderColor}; border-radius:8px;">
            <div style="background:rgba(15,15,15,0.95); border-radius:6px; padding:12px; color:#fff; font-size:13px; font-family:'DM Sans',Inter,sans-serif; line-height:1.4;">
              ${tituloHTML}
              ${filasHTML}
            </div>
          </div>
        `;
      }

      function posicionarTooltip(e) {
        if (!ganttTooltip || ganttTooltip.style.display === "none") return;
        let left = e.clientX + 14, top = e.clientY + 14;
        const rect = ganttTooltip.getBoundingClientRect();
        if (left + rect.width > window.innerWidth) left = e.clientX - rect.width - 14;
        if (top + rect.height > window.innerHeight) top = e.clientY - rect.height - 14;
        ganttTooltip.style.left = `${left}px`;
        ganttTooltip.style.top = `${top}px`;
      }

      ganttBa.addEventListener("mouseover", (e) => {
        const el = e.target.closest("[data-tipo]");
        if (!el) return;
        const { tipo, label, inicio, fin, pct } = el.dataset;
        let html = "";
        if (tipo === "grupo") {
          html = buildTooltipHTML("rgba(200,210,205,0.8)", label, [
            { label: "Inicio:", valor: inicio },
            { label: "Fin:", valor: fin },
            { label: "Avance:", valor: `${pct}%` }
          ]);
        } else if (tipo === "tarea") {
          html = buildTooltipHTML(el.dataset.color || "#197F66", null, [
            { label: "Inicio:", valor: inicio },
            { label: "Fin:", valor: fin },
            { label: "Completado:", valor: `${pct}%` }
          ]);
        }
        if (html) { ganttTooltip.innerHTML = html; ganttTooltip.style.display = "block"; posicionarTooltip(e); }
      });

      ganttBa.addEventListener("mousemove", posicionarTooltip);

      ganttBa.addEventListener("mouseout", (e) => {
        if (!e.target.closest("[data-tipo]")) return;
        ganttTooltip.style.display = "none";
      });

      lb.addEventListener('mouseover', (e) => {
        const el = e.target.closest("[data-tipo='nombre']");
        if (!el || !tipIcono) return;
        tipIcono.textContent = el.dataset.label;
        tipIcono.style.display = 'block';
      });

      lb.addEventListener('mouseout', (e) => {
        if (!e.target.closest("[data-tipo='nombre']") || !tipIcono) return;
        tipIcono.style.display = 'none';
      });
    }

    // ── Toggles de estado en Gantt ──
    sincronizarTogglesFiltroGantt();

    setTimeout(() => {
      if (window._ganttSkipScroll) {
        window._ganttSkipScroll = false;
        return;
      }

      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

      // ── EJE X: centrar la línea de HOY ──
      const hoyLineEl = rp.querySelector(".gantt-hoy-line");
      if (hoyLineEl) {
        const scrollPos = hoyLineEl.offsetLeft - (rp.clientWidth / 2);
        rp.scrollLeft = Math.max(0, scrollPos);
      }

      // ── EJE Y: bajar hasta la primera fila que abarque HOY ──
      // filasParaScroll fue completado en el mismo orden en que se
      // emitieron las filas del DOM, así que el índice coincide 1 a 1.
      const todasLasFilas = lb.querySelectorAll(".gantt-row");
      let filaObjetivo = null;
      for (const f of filasParaScroll) {
        if (hoy >= f.ini && hoy <= f.fin) {
          filaObjetivo = todasLasFilas[f.index];
          break;
        }
      }

      if (filaObjetivo) {
        const offsetTop = filaObjetivo.offsetTop;
        const alturaVisible = rp.clientHeight;
        const scrollY = Math.max(0, offsetTop - alturaVisible / 3);
        rp.scrollTop = scrollY;
        lb.scrollTop = scrollY;
      }
    }, 100); 
  }
}

function renderGraficoLineaComparacion(curva) {
  if (!curva || curva.length === 0) {
    if (chartLineaComparacion) { chartLineaComparacion.dispose(); chartLineaComparacion = null; }
    document.getElementById("graficoLineaComparacion").innerHTML = `<div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding: 2vh;"><div style="width:64px; height:64px; border-radius:50%; background:rgba(107, 114, 128, 0.08); border:2px dashed #6B7280; display:flex; align-items:center; justify-content:center;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div><span style="color:#6B7280; font-size:1.5vh; font-weight:600; text-align:center;">No se encontraron tareas con los filtros actuales</span></div>`;
    const labelEl = document.getElementById("desvioLineaLabel");
    if (labelEl) labelEl.style.display = "none";
    return;
  }
  
  // Limpiamos cualquier rastro de la vieja animación por si acaso
  if (window._desvioInterval) { clearInterval(window._desvioInterval); window._desvioInterval = null; }
  if (window._desvioTimeout) { clearTimeout(window._desvioTimeout); window._desvioTimeout = null; }

  const _prevLabel = document.getElementById("desvioLineaLabel");
  if (_prevLabel) _prevLabel.remove();

  if (chartLineaComparacion) {
    chartLineaComparacion.dispose();
  }

  chartLineaComparacion = echarts.init(document.getElementById("graficoLineaComparacion"));

  const dataReal = construirSerieTemporal(curva, "real");
  const dataTeorico = construirSerieTemporal(curva, "teorico");

  // Relleno visual del desvío entre curvas
  const dataGapBase = curva.map(item => {
    const f = item.fecha instanceof Date ? item.fecha : new Date(item.fecha);
    return [f, Number(item.real || 0)];
  });

  const dataGapNeg = curva.map(item => {
    const f = item.fecha instanceof Date ? item.fecha : new Date(item.fecha);
    const real = Number(item.real || 0);
    const teo  = Number(item.teorico || 0);
    return [f, teo > real ? teo - real : 0];
  });

  const hoyMs = new Date().setHours(0, 0, 0, 0);
  const puntoHoy = curva.reduce((prev, curr) =>
    Math.abs(new Date(curr.fecha).getTime() - hoyMs) < Math.abs(new Date(prev.fecha).getTime() - hoyMs)
      ? curr : prev
  , curva[0]);

  const desvioActual = Number(puntoHoy.real || 0) - Number(puntoHoy.teorico || 0);
  const hayNegativo  = curva.some(item => Number(item.teorico || 0) > Number(item.real || 0));

  const option = {
    animation: true,
    tooltip: {
      trigger: "axis",
      backgroundColor: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      padding: 0,
      confine: true,
      axisPointer: {
        lineStyle: {
          color: "rgba(255, 255, 255, 0.3)",
          type: "dashed"
        }
      },
      formatter: function(params) {
        if (!params || !params.length) return "";
        
        const real = params.find(p => p.seriesName === "Avance Real");
        const teorico = params.find(p => p.seriesName === "Avance Teórico");
        const carga = params.find(p => p.seriesName === "Carga de Tareas");
        const fecha = echarts.format.formatTime("dd/MM/yyyy", params[0].value[0]);
    
        const colorReal = "#197F66";
        const colorTeorico = "#94A3B8";
        const colorCarga = "#a78bfa";
    
        return `
          <div style="position: relative; padding: 2px; background: linear-gradient(to bottom right, ${colorReal}, ${colorTeorico}); border-radius: 8px;">
            <div style="background: rgba(15, 15, 15, 0.95); border-radius: 6px; padding: 8px 12px; color: #fff; font-size: 13px; font-family: 'DM Sans', Inter, sans-serif;">
              <b style="font-size: 13px; margin-bottom: 6px; display: block; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">${fecha}</b>
              <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 4px;">
                <span><span style="color:${colorReal}">●</span> Avance Real:</span>
                <b>${real ? Number(real.value[1]).toFixed(2) : "0.00"}%</b>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 4px;">
                <span><span style="color:${colorTeorico}">●</span> Avance Teórico:</span>
                <b>${teorico ? Number(teorico.value[1]).toFixed(2) : "0.00"}%</b>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 20px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1);">
                <span><span style="color:${colorCarga}">●</span> Carga de Tareas:</span>
                <b>${carga ? Number(carga.value[1]).toFixed(0) : "0"}%</b>
              </div>
            </div>
          </div>
        `;
      }
    },
    
    legend: {
      bottom: -5,
      textStyle: { color: "#ffffff", fontSize: 12, fontFamily: "'DM Sans', Inter, sans-serif" },
      data: ["Avance Real", "Avance Teórico", "Carga de Tareas"]
    },
    grid: { left: 45, right: 45, top: 10, bottom: 45 },
    xAxis: {
      type: "time",
      min: curva[0].fecha instanceof Date ? curva[0].fecha : new Date(curva[0].fecha),
      max: curva[curva.length - 1].fecha instanceof Date ? curva[curva.length - 1].fecha : new Date(curva[curva.length - 1].fecha),
      boundaryGap: false,
      minInterval: (function() {
        const contenedor = document.getElementById("graficoLineaComparacion");
        const anchoPx = contenedor ? contenedor.clientWidth : 600;
        const labelWidthEstimado = 58;
        const maxEtiquetas = Math.max(2, Math.floor(anchoPx / labelWidthEstimado));
        const totalMs = new Date(curva[curva.length - 1].fecha) - new Date(curva[0].fecha);
        const diasMinimo = Math.max(1, Math.ceil(totalMs / maxEtiquetas / 86400000));
        return diasMinimo * 86400000;
      })(),
      axisLabel: {
        color: "#ffffff",
        fontSize: 11,
        fontFamily: "'DM Sans', Inter, sans-serif",
        rotate: 30,
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
        formatter: (function() {
          const anioInicio = new Date(curva[0].fecha).getFullYear();
          const aniosVistos = new Set([anioInicio]);
          return function(value) {
            const d   = new Date(value);
            const dd  = String(d.getDate()).padStart(2, "0");
            const mm  = String(d.getMonth() + 1).padStart(2, "0");
            const aaa = d.getFullYear();
            if (!aniosVistos.has(aaa)) {
              aniosVistos.add(aaa);
            }
            const aa = String(aaa).slice(-2);
            const esEnero = d.getMonth() === 0;
            return esEnero ? `${dd}/${mm}/${aa}` : `${dd}/${mm}`;
          };
        })()
      },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.35)", width: 2 } },
      axisPointer: {
        snap: true,
        lineStyle: { color: "#9a9a9a", width: 2 },
        label: { show: false },
        handle: { show: false }
      },
      splitLine: { show: false }
    },
    yAxis: [
      {
        type: "value",
        min: 0,
        max: 100,
        interval: 20,
        axisLabel: {
          color: "#ffffff",
          fontSize: 11,
          fontFamily: "'DM Sans', Inter, sans-serif",
          formatter: (value) => value === 0 ? "" : `${value}%`
        },
        axisLine: { show: true, lineStyle: { color: "rgba(255,255,255,0.35)", width: 2 } },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.18)", type: "dashed" } }
      },
      {
        type: "value",
        min: 0,
        max: 100,
        interval: 20,
        position: "right",
        axisLabel: {
          color: "#a78bfa",
          fontSize: 11,
          fontFamily: "'DM Sans', Inter, sans-serif",
          formatter: (value) => value === 0 ? "" : `${value}%`
        },
        axisLine: { show: true, lineStyle: { color: "rgba(167,139,250,0.35)", width: 2 } },
        splitLine: { show: false }
      }
    ],
    
    series: [
      {
        name: "Carga de Tareas",
        type: "line",
        yAxisIndex: 1,
        data: curva.map(item => {
          const f = item.fecha instanceof Date ? item.fecha : new Date(item.fecha);
          return [f, Number(item.carga || 0)];
        }),
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: false,
        emphasis: { 
          focus: "series", 
          blurScope: "coordinateSystem",
          itemStyle: { color: "#a78bfa", borderColor: "#ffffff", borderWidth: 2 },
          scale: 1.6 
        },
        itemStyle: { color: "#a78bfa", borderColor: "#a78bfa", borderWidth: 2 },
        lineStyle: { width: 2, color: "#a78bfa", type: "dotted" },
        areaStyle: { color: "rgba(167,139,250,0.08)" },
        z: 8
      },
      {
        name: "__gapBase",
        type: "line",
        data: dataGapBase,
        stack: "bandDesvio",
        symbol: "none",
        smooth: true,
        lineStyle: { opacity: 0 },
        areaStyle: { color: "transparent" },
        silent: true,
        legendHoverLink: false,
        z: 1
      },
      {
        name: "__gapNeg",
        type: "line",
        data: dataGapNeg,
        stack: "bandDesvio",
        symbol: "none",
        smooth: true,
        lineStyle: { opacity: 0 },
        // Aquí seteamos el color ESTÁTICO del desvío para que no consuma rendimiento
        areaStyle: { color: hayNegativo ? "rgba(255, 60, 60, 0.15)" : "transparent" },
        silent: true,
        legendHoverLink: false,
        z: 1
      },
      {
        name: "Avance Real",
        type: "line",
        data: dataReal,
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: false,
        emphasis: {
          focus: "series",
          itemStyle: { color: "#197F66", borderColor: "#ffffff", borderWidth: 2 },
          scale: 1.6
        },
        itemStyle: { color: "#197F66", borderColor: "#197F66", borderWidth: 2 },
        lineStyle: { width: 3, color: "#197F66" },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(25,127,102,0.45)" },
            { offset: 1, color: "rgba(25,127,102,0.05)" }
          ])
        },
        markLine: {
          symbol: "none",
          lineStyle: { color: "#aaaaaa", type: "dashed", width: 1.5 },
          label: {
            show: true,
            formatter: "HOY",
            color: "#ffffff",
            backgroundColor: "rgba(25, 127, 102, 0.85)",
            padding: [3, 7],
            borderRadius: 4,
            fontWeight: "bold",
            fontSize: 11,
            position: "end",
            offset: [0, -5]
          },
          data: [[{ xAxis: new Date(new Date().setHours(0,0,0,0)), yAxis: 0 }, { xAxis: new Date(new Date().setHours(0,0,0,0)), yAxis: 85 }]]
        },
        z: 7
      },
      {
        name: "Avance Teórico",
        type: "line",
        data: dataTeorico,
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: false,
        emphasis: {
          focus: "series",
          itemStyle: { color: "#94A3B8", borderColor: "#ffffff", borderWidth: 2 },
          scale: 1.6
        },
        itemStyle: { color: "#94A3B8" },
        lineStyle: { width: 2, color: "#94A3B8", type: "dashed" },
        areaStyle: { opacity: 0 },
        markLine: {
          symbol: "none",
          lineStyle: { color: "#aaaaaa", type: "dashed", width: 1.5 },
          label: {
            show: true,
            formatter: "HOY",
            color: "#ffffff",
            backgroundColor: "rgba(25, 127, 102, 0.85)",
            padding: [3, 7],
            borderRadius: 4,
            fontWeight: "bold",
            fontSize: 11,
            position: "end",
            offset: [0, -5]
          },
          data: [[{ xAxis: new Date(new Date().setHours(0,0,0,0)), yAxis: 0 }, { xAxis: new Date(new Date().setHours(0,0,0,0)), yAxis: 85 }]]
        },
        z: 7
      }
    ]
  };

  chartLineaComparacion.setOption(option);

  // El cartel es dinámico, si apagas una línea, el cartel muere.
  window._actualizarLabelDesvio = function() {
    if (!chartLineaComparacion) return;
    const panel = document.querySelector('.panel-linea-comparacion');
    const esFull = panel && panel.classList.contains('linea-comparacion-fullscreen');
    const h2 = document.getElementById("tituloGraficoComparacion")?.closest(".linea-h2");
    if (!h2) return;

    const opts = chartLineaComparacion.getOption();
    if (!opts || !opts.legend || !opts.legend[0]) return;
    
    const realActivo = opts.legend[0].selected["Avance Real"] !== false;
    const teoricoActivo = opts.legend[0].selected["Avance Teórico"] !== false;
    const ambasActivas = realActivo && teoricoActivo;

    let labelEl = document.getElementById("desvioLineaLabel");

    const esCero = Number(desvioActual.toFixed(2)) === 0;

    if (!ambasActivas || esCero) {
      if (labelEl) labelEl.style.display = "none";
      return; 
    }

    if (!labelEl) {
      labelEl = document.createElement("div");
      labelEl.id = "desvioLineaLabel";
      labelEl.style.cssText = `
        position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
        display: flex; align-items: center; gap: 3px; padding: 1px 5px;
        border-radius: 4px; font-size: 9px; font-weight: 700;
        font-family: 'DM Sans', Inter, sans-serif; pointer-events: none; white-space: nowrap;
      `;
      h2.appendChild(labelEl);
    }

    // Si estamos en fullscreen, moverlo al contenedor correcto
    const fsDesvio = document.getElementById('fsDesvioLinea');
    if (esFull && fsDesvio && !fsDesvio.contains(labelEl)) {
      fsDesvio.appendChild(labelEl);
      labelEl.style.position = 'static';
      labelEl.style.transform = 'none';
      labelEl.style.fontSize = '11px';
      labelEl.style.padding = '2px 8px';
    } else if (!esFull && h2 && !h2.contains(labelEl)) {
      h2.appendChild(labelEl);
      labelEl.style.position = 'absolute';
      labelEl.style.right = '8px';
      labelEl.style.top = '50%';
      labelEl.style.transform = 'translateY(-50%)';
      labelEl.style.fontSize = '11px';
      labelEl.style.padding = '2px 7px';
    }

    const esNeg       = desvioActual < 0;
    const signo       = desvioActual >= 0 ? "+" : "";
    const flecha      = esNeg ? "▼" : "▲";
    const colorFlecha = esNeg ? "#ff7777" : "#00e890";
    const colorFondo  = esNeg ? "rgba(140, 15, 15, 0.92)" : "rgba(8, 85, 55, 0.92)";
    const colorBorde  = esNeg ? "rgba(255, 80, 80, 0.65)" : "rgba(0, 200, 120, 0.65)";

    labelEl.style.background = colorFondo;
    labelEl.style.border     = `1px solid ${colorBorde}`;
    labelEl.style.display    = "flex";
    labelEl.innerHTML = `
      <span style="color:${colorFlecha}; font-size:9px; line-height:1;">${flecha}</span>
      <span style="color:#fff;">Desvío: ${signo}${desvioActual.toFixed(2)}%</span>
    `;
  };

  chartLineaComparacion.off("legendselectchanged");
  chartLineaComparacion.on("legendselectchanged", function(params) {
    const tituloElemento = document.getElementById("tituloGraficoComparacion");
    const cargaActivo   = params.selected["Carga de Tareas"];
    const realActivo    = params.selected["Avance Real"];
    const teoricoActivo = params.selected["Avance Teórico"];
    const ambasActivas  = realActivo && teoricoActivo;

    // Actualizar leyenda explícitamente para que se vea el cambio visual
    chartLineaComparacion.setOption({
      legend: {
          selected: {
              "Avance Real": realActivo,
              "Avance Teórico": teoricoActivo,
              "Carga de Tareas": cargaActivo
          }
      },
      series: [
          { name: "Carga de Tareas", show: cargaActivo }
      ]
    });

    if (tituloElemento) {
      if (ambasActivas) {
        tituloElemento.textContent = "Avance Real VS Avance Teórico";
      } else if (realActivo && !teoricoActivo) {
        tituloElemento.textContent = "Avance Real Acumulado";
      } else if (!realActivo && teoricoActivo) {
        tituloElemento.textContent = "Avance Teórico Acumulado";
      } else {
        tituloElemento.textContent = "Sin datos seleccionados";
      }
    }

    if (window._labelTimeout) { clearTimeout(window._labelTimeout); window._labelTimeout = null; }

    if (ambasActivas) {
      // 1. Ocultamos el cartel
      const labelEl = document.getElementById("desvioLineaLabel");
      if (labelEl) labelEl.style.display = "none";

      // 2. LA MAGIA: Limpiamos el gráfico por completo. 
      // Esto obliga a ECharts a hacer su animación nativa de "barrido" de 0 para todo a la vez.
      chartLineaComparacion.clear();

      // 3. Le confirmamos a la configuración original que ambas leyendas están activas y le pasamos los datos
      option.legend.selected = {
        "Avance Real": true,
        "Avance Teórico": true,
        "Carga de Tareas": cargaActivo
      };
      option.series[1].data = dataGapBase;
      option.series[2].data = dataGapNeg;

      // 4. Volvemos a dibujar. Líneas y mancha viajarán juntas de izquierda a derecha.
      chartLineaComparacion.setOption(option);

      // 5. El cartel aparece justo al segundo, cuando terminan de llegar a la derecha.
      window._labelTimeout = setTimeout(() => {
        window._actualizarLabelDesvio();
      }, 1000);

    } else {
      // Si el usuario apaga una leyenda, solo vaciamos la mancha roja para que desaparezca suavemente
      chartLineaComparacion.setOption({
        series: [
          {},
          { name: "__gapBase", data: [] },
          { name: "__gapNeg",  data: [] }
        ]
      });
      window._actualizarLabelDesvio(); 
    }
  });

  // ── Botones de ventana temporal ──
  const h2Linea = document.getElementById("tituloGraficoComparacion")?.closest(".linea-h2");
  if (h2Linea) {
    h2Linea.querySelectorAll(".grupo-ventana-linea").forEach(el => el.remove());

    const duracionTotal = Math.round(
      ((curvaDinamicaActual[curvaDinamicaActual.length - 1]?.fecha instanceof Date
        ? curvaDinamicaActual[curvaDinamicaActual.length - 1].fecha
        : new Date(curvaDinamicaActual[curvaDinamicaActual.length - 1]?.fecha))
      - (curvaDinamicaActual[0]?.fecha instanceof Date
        ? curvaDinamicaActual[0].fecha
        : new Date(curvaDinamicaActual[0]?.fecha))) / 86400000
    );

    const ventanas = [
      { label: "15d", dias: 15 },
      { label: "30d", dias: 30 },
      { label: "60d", dias: 60 },
      { label: "Todo", dias: null }
    ];

    const iconosDiv = h2Linea.querySelector(".linea-h2-icons");

    // Separador visual entre íconos y botones
    const sep = document.createElement("div");
    sep.className = "grupo-ventana-linea";
    sep.style.cssText = `
      width: 1px; height: 14px; background: rgba(25,127,102,0.35);
      margin: 0 4px; flex-shrink: 0;
    `;
    if (iconosDiv) iconosDiv.appendChild(sep);

    const grupo = document.createElement("div");
    grupo.className = "grupo-ventana-linea";
    grupo.style.cssText = `
      display: flex; gap: 4px; align-items: center; pointer-events: all;
    `;

    ventanas.forEach(({ label, dias }) => {
      if (dias !== null && dias >= duracionTotal) return;
      const btn = document.createElement("button");
      btn.className = "btn-ventana-linea";
      btn.dataset.dias = dias === null ? "null" : String(dias);
      btn.textContent = label;
      btn.setAttribute("data-tooltip", dias === null ? "Ver todo el proyecto" : `Últimos ${label}`);
      btn.style.cssText = `
        padding: 1px 7px; border-radius: 4px;
        border: 1px solid rgba(25,127,102,0.3);
        background: rgba(25,127,102,0.12);
        color: rgba(255,255,255,0.6);
        font-size: 10px; font-weight: 600;
        font-family: 'DM Sans', Inter, sans-serif;
        cursor: pointer; transition: all 0.15s ease;
      `;
      btn.onclick = () => setVentanaLinea(dias);
      grupo.appendChild(btn);
    });

    if (iconosDiv) iconosDiv.appendChild(grupo);
    setVentanaLinea(null); // "Todo" activo por defecto

    // Si estamos en fullscreen, ocultar los botones del título y reclonar en el panel fullscreen
    const panelLineaFs = document.querySelector('.panel-linea-comparacion');
    if (panelLineaFs && panelLineaFs.classList.contains('linea-comparacion-fullscreen')) {
      document.querySelectorAll('.linea-h2 .grupo-ventana-linea').forEach(el => {
        el.style.display = 'none';
      });

      const fsVentana = document.getElementById('fsVentanaLinea');
      if (fsVentana) {
        fsVentana.innerHTML = '';
        document.querySelectorAll('.linea-h2 .btn-ventana-linea').forEach(btn => {
          const clone = btn.cloneNode(true);
          clone.style.fontSize = '13px';
          clone.style.padding = '4px 12px';
          fsVentana.appendChild(clone);
        });
        fsVentana.onclick = (e) => {
          const btn = e.target.closest('.btn-ventana-linea');
          if (!btn) return;
          const dias = btn.dataset.dias === 'null' ? null : Number(btn.dataset.dias);
          setVentanaLinea(dias);
        };
      }
    }
  }

  // === AL CARGAR UN PROYECTO NUEVO ===
  if (window._labelTimeoutInit) { clearTimeout(window._labelTimeoutInit); window._labelTimeoutInit = null; }
  window._labelTimeoutInit = setTimeout(() => {
    window._actualizarLabelDesvio();
  }, 1000);
}

function setVentanaLinea(dias) {
  if (!chartLineaComparacion || !curvaDinamicaActual || curvaDinamicaActual.length === 0) return;

  const fechaInicio = curvaDinamicaActual[0].fecha instanceof Date
    ? curvaDinamicaActual[0].fecha : new Date(curvaDinamicaActual[0].fecha);

  const fechaFin = curvaDinamicaActual[curvaDinamicaActual.length - 1].fecha instanceof Date
    ? curvaDinamicaActual[curvaDinamicaActual.length - 1].fecha
    : new Date(curvaDinamicaActual[curvaDinamicaActual.length - 1].fecha);

  const min = dias === null
    ? fechaInicio
    : new Date(Math.max(fechaInicio.getTime(), fechaFin.getTime() - dias * 86400000));

  chartLineaComparacion.setOption({ xAxis: { min, max: fechaFin } });

  document.querySelectorAll(".btn-ventana-linea").forEach(btn => {
    const activo = btn.dataset.dias === (dias === null ? "null" : String(dias));
    btn.style.background  = activo ? "rgba(25,127,102,0.5)" : "rgba(25,127,102,0.12)";
    btn.style.borderColor = activo ? "#00B095" : "rgba(25,127,102,0.3)";
    btn.style.color       = activo ? "#ffffff" : "rgba(255,255,255,0.6)";
  });
}

function renderGraficoTortaConTareasFiltradas(tareasFiltradas) {
  const tareasNoResumen = tareasFiltradas.filter(
    t => String(t["Resumen"]).trim().toLowerCase() !== "true"
  );

  if (tareasNoResumen.length === 0) {
    if (chartTorta) { chartTorta.dispose(); chartTorta = null; }
    document.getElementById("graficoTorta").innerHTML = `<div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding: 2vh;"><div style="width:64px; height:64px; border-radius:50%; background:rgba(107, 114, 128, 0.08); border:2px dashed #6B7280; display:flex; align-items:center; justify-content:center;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div><span style="color:#6B7280; font-size:1.5vh; font-weight:600; text-align:center;">No se encontraron tareas con los filtros actuales</span></div>`;
    return;
  }

  let noIniciadas = 0;
  let enProgreso = 0;
  let finalizadas = 0;

  tareasNoResumen.forEach(t => {
    const porcentaje = Number(t["% completado"] || 0);
    if (porcentaje === 0) noIniciadas += 1;
    else if (porcentaje > 0 && porcentaje < 100) enProgreso += 1;
    else if (porcentaje >= 100) finalizadas += 1;
  });

  const todasFinalizadas = tareasNoResumen.length > 0 && tareasNoResumen.every(
    t => Number(t["% completado"] || 0) >= 100
  );

  if (todasFinalizadas) {
    if (chartTorta) { chartTorta.dispose(); chartTorta = null; }
    document.getElementById("graficoTorta").innerHTML = `
      <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;">
        <div style="width:80px; height:80px; border-radius:50%; background:rgba(0,176,149,0.10); border:3px solid #00B095; display:flex; align-items:center; justify-content:center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#00B095" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <span style="color:#00B095; font-size:1.8vh; font-weight:700;">¡Proyecto finalizado!</span>
        <span style="color:#888; font-size:1.6vh;">${tareasNoResumen.length} de ${tareasNoResumen.length} tareas completadas (100%)</span>
      </div>
    `;
    return;
  }

  const ningunaIniciada = tareasNoResumen.length > 0 && tareasNoResumen.every(
    t => Number(t["% completado"] || 0) === 0
  );

  if (ningunaIniciada) {
    if (chartTorta) { chartTorta.dispose(); chartTorta = null; }
    document.getElementById("graficoTorta").innerHTML = `
      <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;">
        <div style="width:80px; height:80px; border-radius:50%; background:rgba(107, 114, 128, 0.10); border:3px solid #6B7280; display:flex; align-items:center; justify-content:center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <span style="color:#6B7280; font-size:1.8vh; font-weight:700;">Proyecto por iniciar</span>
        <span style="color:#888; font-size:1.6vh;">0 de ${tareasNoResumen.length} tareas completadas (0%)</span>
      </div>
    `;
    return;
  }

  if (chartTorta) { chartTorta.dispose(); }

  chartTorta = echarts.init(document.getElementById("graficoTorta"));

  const option = {
    tooltip: {
      trigger: "item",
      backgroundColor: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      padding: 0,
      confine: true,
      formatter: function(params) {
        const colorEstado = params.data.itemStyle.borderColor;
        return `
          <div style="position: relative; padding: 2px; background: ${colorEstado}; border-radius: 8px;">
            <div style="background: rgba(15, 15, 15, 0.95); border-radius: 6px; padding: 10px; color: #fff; font-size: 13px; font-family: 'DM Sans', Inter, sans-serif; line-height: 1.4;">
              <b style="font-size: 13px; margin-bottom: 6px; display: block; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">${params.name}</b>
              <div style="display: flex; justify-content: space-between; gap: 16px; margin-bottom: 4px;">
                <span><span style="color:${colorEstado}">●</span> Cantidad:</span>
                <b>${params.value}</b>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 16px;">
                <span><span style="color:${colorEstado}">●</span> Porcentaje:</span>
                <b>${params.percent}%</b>
              </div>
            </div>
          </div>
        `;
      }
    },
    legend: { bottom: 0, textStyle: { color: "#ffffff", fontSize: 11, fontFamily: "'DM Sans', Inter, sans-serif" } },
    series: [
      {
        type: "pie",
        radius: "55%",
        center: ["50%", "45%"],
        padAngle: 1,
        label: { show: true, color: "#ffffff", fontSize: 11, fontFamily: "'DM Sans', Inter, sans-serif", formatter: "{c} ({d}%)" },
        labelLine: { length: 8, length2: 8, smooth: 0.2, lineStyle: { width: 2 } },
        
        data: (function() {
          const op = (nombre) => !estadoTortaClickSeleccionado || estadoTortaClickSeleccionado === nombre ? 1 : 0.2;
          return [
            {
              value: noIniciadas,
              name: "No iniciadas",
              itemStyle: {
                opacity: op("No iniciadas"),
                color: new echarts.graphic.RadialGradient(0.5, 0.5, 1.3, [
                  { offset: 0, color: COLORES_ESTADO.noIniciada.radial[0] },
                  { offset: 1, color: COLORES_ESTADO.noIniciada.radial[1] }
                ]),
                borderColor: COLORES_ESTADO.noIniciada.borde,
                borderWidth: 1.5
              }
            },
            {
              value: enProgreso,
              name: "En progreso",
              itemStyle: {
                opacity: op("En progreso"),
                color: new echarts.graphic.RadialGradient(0.5, 0.5, 1.3, [
                  { offset: 0, color: COLORES_ESTADO.enProgreso.radial[0] },
                  { offset: 1, color: COLORES_ESTADO.enProgreso.radial[1] }
                ]),
                borderColor: COLORES_ESTADO.enProgreso.borde,
                borderWidth: 1.5
              }
            },
            {
              value: finalizadas,
              name: "Finalizadas",
              itemStyle: {
                opacity: op("Finalizadas"),
                color: new echarts.graphic.RadialGradient(0.5, 0.5, 1.3, [
                  { offset: 0, color: COLORES_ESTADO.finalizada.radial[0] },
                  { offset: 1, color: COLORES_ESTADO.finalizada.radial[1] }
                ]),
                borderColor: COLORES_ESTADO.finalizada.borde,
                borderWidth: 1.5
              }
            }
          ].filter(item => item.value > 0);
        })()
      }
    ]
  };

  chartTorta.setOption(option);

  chartTorta.off("legendselectchanged");
  chartTorta.on("legendselectchanged", function(params) {
    estadosTortaSeleccionados = {
      "No iniciadas": params.selected["No iniciadas"] !== false,
      "En progreso": params.selected["En progreso"] !== false,
      "Finalizadas": params.selected["Finalizadas"] !== false,
      "Tareas Atrasadas": true,
      "Tareas No Atrasadas": true
    };

    sincronizarTogglesFiltroGantt();
    renderTablasYGraficosConEstado(tareasFiltradas);
  });

  // ── Cross-filtering por click en porción ──
  setTimeout(() => {
    chartTorta.off("click");
    chartTorta.on("click", function(params) {
      if (params.componentType !== "series") return;
      if (presentacionActiva) detenerPresentacion();

      const nombreClickeado = params.name;
      estadoTortaClickSeleccionado =
        estadoTortaClickSeleccionado === nombreClickeado ? null : nombreClickeado;
      sincronizarTogglesFiltroGantt();
      renderGraficoTortaConTareasFiltradas(tareasFiltradas);
      renderTablasYGraficosConEstado(tareasFiltradas);
    });
  }, 300);
}

function renderGraficoBarras(tareasFiltradas) {
  const tareasNoResumen = tareasFiltradas.filter(
    t => String(t["Resumen"]).trim().toLowerCase() !== "true"
  );

  if (tareasNoResumen.length === 0) {
    if (chartBarras) { chartBarras.dispose(); chartBarras = null; }
    document.getElementById("graficoBarras").innerHTML = `<div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding: 2vh;"><div style="width:64px; height:64px; border-radius:50%; background:rgba(107, 114, 128, 0.08); border:2px dashed #6B7280; display:flex; align-items:center; justify-content:center;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div><span style="color:#6B7280; font-size:1.5vh; font-weight:600; text-align:center;">No se encontraron tareas con los filtros actuales</span></div>`;
    return;
  }
  
  const grupoSeleccionado = document.getElementById("selectorGrupo").value;

  const hayFiltroEstado = estadoTortaClickSeleccionado
    || !estadosTortaSeleccionados["No iniciadas"]
    || !estadosTortaSeleccionados["En progreso"]
    || !estadosTortaSeleccionados["Finalizadas"];

  const gruposConEstadoActivo = hayFiltroEstado
    ? new Set(tareasNoResumen
        .filter(t => {
          const pct = Number(t["% completado"] || 0);
          let nombreEstado;
          if (pct === 0)        nombreEstado = "No iniciadas";
          else if (pct < 100)   nombreEstado = "En progreso";
          else                  nombreEstado = "Finalizadas";

          const pasaLeyenda = estadosTortaSeleccionados[nombreEstado];
          const pasaClick   = !estadoTortaClickSeleccionado || estadoTortaClickSeleccionado === nombreEstado;
          return pasaLeyenda && pasaClick;
        })
        .map(t => normalizarGrupoId(t["Grupo_ID"])))
    : null;

  const grupos = {};

  tareasNoResumen.forEach(t => {
    let grupoId = normalizarGrupoId(t["Grupo_ID"]);
    const fin = t["Fin"];
    const porcentaje = Number(t["% completado"] || 0);

    if (!grupos[grupoId]) {
      grupos[grupoId] = { total: 0, atrasadas: 0 };
      // Guardamos el texto del nombre del grupo si existe en el CSV  
    }

    grupos[grupoId].total += 1;

    if (esTareaAtrasada(fin, porcentaje)) grupos[grupoId].atrasadas += 1;
  });

  const gruposOrdenados = Object.keys(grupos).sort((a, b) => {
    if (a === "Sin Grupo") return 1;
    if (b === "Sin Grupo") return -1;
    const na = obtenerNumeroGrupo(a), nb = obtenerNumeroGrupo(b);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  });

  const cantidadAtrasadas = gruposOrdenados.map(g => grupos[g].atrasadas);
  const cantidadResto = gruposOrdenados.map(g => grupos[g].total - grupos[g].atrasadas);
  const cantidadTotal = gruposOrdenados.map(g => grupos[g].total);

  if (chartBarras) chartBarras.dispose();

  chartBarras = echarts.init(document.getElementById("graficoBarras"));
  const maxY = Math.max(...cantidadTotal);
  const contenedorGrafico = document.getElementById("graficoBarras");
  const alturaUtilAprox = Math.max(1, contenedorGrafico.clientHeight * 0.75);
  const valorVisualMinimo = Math.max(1, Math.ceil((20 * Math.max(maxY, 1)) / alturaUtilAprox));

  const cantidadAtrasadasVisual = cantidadAtrasadas.map(valor => (valor > 0 ? Math.max(valor, valorVisualMinimo) : null));
  const cantidadRestoVisual = cantidadResto.map(valor => (valor > 0 ? Math.max(valor, valorVisualMinimo) : null));
  const cantidadTotalVisual = gruposOrdenados.map((_, index) => (
    Number(cantidadAtrasadasVisual[index] || 0) + Number(cantidadRestoVisual[index] || 0)
  ));
  const maxYVisual = Math.max(...cantidadTotalVisual);

  const duracionAnimacion = 1000;
  const retrasoAnimacion = 80;
  const easingAnimacion = "cubicOut";

  const option = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.05)" } },
        
        // 1. Hacemos el contenedor nativo de ECharts 100% invisible
        backgroundColor: "transparent",
        borderColor: "transparent",
        borderWidth: 0,
        padding: 0,
        confine: true,
        extraCssText: "box-shadow: none;", 
        appendToBody: true,
        transitionDuration: 0, 
        showDelay: 0,          
        hideDelay: 0,          

        // 2. Dibujamos tu tipIcono usando HTML puro para que los colores no se apaguen
        formatter: function(params) {
          if (!params || params.length === 0) return "";
          
          const grupoId = params[0].axisValue;
          const texto = grupoId === "Sin Grupo" ? "Sin Grupo" : `Grupo ${grupoId}`;
          
          return `
            <div style="
              background: rgba(15,15,15,0.95); 
              color: #fff; 
              font-size: 13px; 
              font-family: 'DM Sans', Inter, sans-serif; 
              padding: 5px 10px; 
              border-radius: 6px; 
              border: 1px solid rgba(25,127,102,0.5); 
              box-shadow: 0 4px 12px rgba(0,0,0,0.4); 
              white-space: nowrap;
            ">
              ${texto}
            </div>
          `;
        }
      },
      legend: {
        bottom: 0,
        textStyle: { color: "#ffffff", fontSize: 11, fontFamily: "'DM Sans', Inter, sans-serif" },
        data: ["Tareas Atrasadas", "Tareas No Atrasadas"],
        selected: {
          "Tareas Atrasadas":    estadosBarrasSeleccionados["Tareas Atrasadas"],
          "Tareas No Atrasadas": estadosBarrasSeleccionados["Tareas No Atrasadas"]
        }
      },
    grid: { top: "10%", left: "4%", right: "4%", bottom: "15%", containLabel: true },
    xAxis: {
      type: "category",
      data: gruposOrdenados,
      axisLabel: { 
        color: function(value) {
          const activo = grupoSeleccionado === "Todos" || value === grupoSeleccionado;
          return activo ? "#ffffff" : "rgba(255,255,255,0.25)";
        }, 
        interval: 0, 
        fontSize: 11,
        fontFamily: "'DM Sans', Inter, sans-serif"
      },
      axisLine: { lineStyle: { color: "#444" } },
      axisTick: { show: false }
    },
    yAxis: {
      type: "value",
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      min: 0,
      max: maxYVisual > 0 ? maxYVisual : 10
    },
    series: [
      {
        name: "Tareas Atrasadas",
        type: "bar",
        stack: "total",
        barWidth: "55%",
        z: 3,
        animation: true,
        animationDuration: duracionAnimacion,
        animationDurationUpdate: 300,
        animationEasing: easingAnimacion,
        animationEasingUpdate: easingAnimacion,
        animationDelay: function(params) { return params.dataIndex * retrasoAnimacion; },
        animationDelayUpdate: function(params) { return params.dataIndex * 30; },
        data: cantidadAtrasadas.map((valor, indice) => {
          const g = gruposOrdenados[indice];
          const activoPorGrupo  = grupoSeleccionado === "Todos" || g === grupoSeleccionado;
          const activoPorEstado = !gruposConEstadoActivo || gruposConEstadoActivo.has(g);
          const activo = activoPorGrupo && activoPorEstado;
          return { 
            value: valor > 0 ? cantidadAtrasadasVisual[indice] : null, 
            actual: valor,
            itemStyle: activo ? {} : { opacity: 0.25 },
            label: activo ? {} : { color: "rgba(255,255,255,0.25)" }
          };
        }),
        label: {
          show: true,
          position: "inside",
          color: "#ffffff",
          fontSize: 11,
          fontFamily: "'DM Sans', Inter, sans-serif",
          formatter: function(params) { return params.data?.actual == null || params.data.actual === 0 ? "" : params.data.actual; }
        },
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(239, 68, 68, 0.45)" },
            { offset: 1, color: "rgba(239, 68, 68, 0.05)" }
          ]),
          borderColor: "#EF4444",
          borderWidth: 2.5
        }
      },
      {
        name: "Tareas No Atrasadas",
        type: "bar",
        stack: "total",
        barWidth: "55%",
        z: 2,
        animation: true,
        animationDuration: duracionAnimacion,
        animationDurationUpdate: 300,
        animationEasing: easingAnimacion,
        animationEasingUpdate: easingAnimacion,
        animationDelay: function(params) { return params.dataIndex * retrasoAnimacion; },
        animationDelayUpdate: function(params) { return params.dataIndex * 30; },
        data: cantidadResto.map((valor, indice) => {
          const g = gruposOrdenados[indice];
          const activoPorGrupo  = grupoSeleccionado === "Todos" || g === grupoSeleccionado;
          const activoPorEstado = !gruposConEstadoActivo || gruposConEstadoActivo.has(g);
          const activo = activoPorGrupo && activoPorEstado;
          return { 
            value: valor > 0 ? cantidadRestoVisual[indice] : null, 
            actual: valor,
            itemStyle: activo ? {} : { opacity: 0.25 },
            label: activo ? {} : { color: "rgba(255,255,255,0.25)" }
          };
        }),
        label: {
          show: true,
          position: "inside",
          color: "#ffffff",
          fontSize: 11,
          fontFamily: "'DM Sans', Inter, sans-serif",
          formatter: function(params) { return params.data?.actual == null || params.data.actual === 0 ? "" : params.data.actual; }
        },
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(148,163,184,0.45)" },
            { offset: 1, color: "rgba(148,163,184,0.05)" }
          ]),
          borderColor: "#94A3B8",
          borderWidth: 2.5
        }
      }
    ]
  };

  chartBarras.off("legendselectchanged");
  chartBarras.on("legendselectchanged", function(params) {
    estadosBarrasSeleccionados = {
      "Tareas Atrasadas": params.selected["Tareas Atrasadas"] !== false,
      "Tareas No Atrasadas": params.selected["Tareas No Atrasadas"] !== false
    };
    renderTablasYGraficosConEstado(tareasFiltradas);
  });
  
  chartBarras.setOption(option);
  
  setTimeout(() => {
    chartBarras.off("click");
    chartBarras.on("click", function(params) {
      if (params.componentType !== "series") return;
      if (presentacionActiva) detenerPresentacion();
      const selectorGrupo = document.getElementById("selectorGrupo");
      const grupoClickeado = gruposOrdenados[params.dataIndex];
      if (!grupoClickeado) return;
      if (selectorGrupo.value === grupoClickeado) {
        selectorGrupo.value = "Todos";
      } else {
        selectorGrupo.value = grupoClickeado;
      }
      sincronizarCascadaGrupoResponsable();
      aplicarFiltros();
    });
  }, 300);
}

function obtenerTareasNoResumen(lista) {
  return lista.filter(t => String(t["Resumen"]).trim().toLowerCase() !== "true");
}

function ordenarPorGrupoYNombre(lista) {
  return [...lista].sort((a, b) => {
    const grupoA = normalizarGrupoId(a["Grupo_ID"]);
    const grupoB = normalizarGrupoId(b["Grupo_ID"]);

    if (grupoA === "Sin Grupo" && grupoB !== "Sin Grupo") return 1;
    if (grupoB === "Sin Grupo" && grupoA !== "Sin Grupo") return -1;

    const na = obtenerNumeroGrupo(grupoA), nb = obtenerNumeroGrupo(grupoB);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;

    const nombreA = String(a["Nombre de tarea"] || a["Nombre"] || "").trim();
    const nombreB = String(b["Nombre de tarea"] || b["Nombre"] || "").trim();

    return nombreA.localeCompare(nombreB, "es");
  });
}

function esTareaCritica(fechaFin, porcentajeCompletado) {
  if (!fechaFin) return false;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const limite = new Date(hoy);
  limite.setDate(limite.getDate() + 7);
  const fin = parseFechaLocal(fechaFin);
  if (!fin || isNaN(fin.getTime())) return false;
  fin.setHours(0, 0, 0, 0);
  return fin <= limite && Number(porcentajeCompletado) < 100;
}

function construirThOrdenable(col, label, claseExtra, claseSort, estadoOrden) {
  const activo = estadoOrden.col === col;
  const dir = activo ? estadoOrden.dir : "asc";
  const icon = dir === "asc" ? "▲" : "▼";
  const colorStyle = activo ? ' style="color:#00B095;"' : '';
  return `<th class="${claseExtra} ${claseSort}" data-col="${col}"${colorStyle}>${label} <span class="sort-icon">${icon}</span></th>`;
}

function renderTablaTareasPorGrupo(lista) {
  const contenedor = document.getElementById("tablaTareasGrupo");
  let tareasNoResumen = ordenarPorGrupoYNombre(obtenerTareasNoResumen(lista));

  if (!tareasNoResumen.length) {
    contenedor.innerHTML = `<div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding: 2vh;"><div style="width:64px; height:64px; border-radius:50%; background:rgba(107, 114, 128, 0.08); border:2px dashed #6B7280; display:flex; align-items:center; justify-content:center;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div><span style="color:#6B7280; font-size:1.5vh; font-weight:600; text-align:center;">No se encontraron tareas con los filtros actuales</span></div>`;
    return;
  }

  if (ordenTablaGrupo.col) {
    const { col, dir } = ordenTablaGrupo;
    tareasNoResumen = [...tareasNoResumen].sort((a, b) => {
      let valA, valB;

      if (col === "nombre") {
        valA = capitalizarPrimeraLetra(limpiarTexto(a["Nombre de tarea"] || a["Nombre"])).toLowerCase();
        valB = capitalizarPrimeraLetra(limpiarTexto(b["Nombre de tarea"] || b["Nombre"])).toLowerCase();
        return dir === "asc" ? valA.localeCompare(valB, "es") : valB.localeCompare(valA, "es");
      }
      if (col === "grupo") {
        valA = Number(normalizarGrupoId(a["Grupo_ID"])) || 0;
        valB = Number(normalizarGrupoId(b["Grupo_ID"])) || 0;
        return dir === "asc" ? valA - valB : valB - valA;
      }
      if (col === "avance") {
        valA = Number(a["% completado"] || 0);
        valB = Number(b["% completado"] || 0);
        return dir === "asc" ? valA - valB : valB - valA;
      }
      return 0;
    });
  }

  const filas = tareasNoResumen.map(t => {
    const nombre  = capitalizarPrimeraLetra(limpiarTexto(t["Nombre de tarea"] || t["Nombre"]));
    const grupo   = normalizarGrupoId(t["Grupo_ID"]);
    const pct     = Number(t["% completado"] || 0);

    // Color del punto según estado (igual que Gantt y torta)
    const colorPunto = colorEstado(pct).borde;

    const punto = `<span class="tabla-estado-dot" style="background:${colorPunto}; box-shadow: 0 0 5px ${colorPunto};"></span>`;

    return `
      <tr>
        <td class="col-nombre">
          <span class="col-nombre-inner">${punto}${nombre || "-"}</span>
        </td>
        <td class="col-grupo">${grupo}</td>
        <td class="col-avance">${pct.toFixed(0)}%</td>
      </tr>`;
  }).join("");

  contenedor.innerHTML = `
    <div class="tablaWrapper">
      <div class="tablaHeaderBox">
        <table class="tablaDashboard">
          <thead>
            <tr>
              ${construirThOrdenable("nombre", "Nombre", "col-nombre", "tabla-th-sort", ordenTablaGrupo)}
              ${construirThOrdenable("grupo", "Grupo", "col-grupo", "tabla-th-sort", ordenTablaGrupo)}
              ${construirThOrdenable("avance", "Avance", "col-avance", "tabla-th-sort", ordenTablaGrupo)}
            </tr>
          </thead>
        </table>
      </div>
      <div class="tablaScroll" style="border-top: none;">
        <table class="tablaDashboard" id="tablaGrupoBody">
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="tablaTotalBar">
        <span class="total">Total</span>
        <span class="total-valor">${tareasNoResumen.length}</span>
      </div>
    </div>
  `;

  // ── Ordenamiento por columna ──
  contenedor.querySelectorAll(".tabla-th-sort").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      const nuevaDir = (ordenTablaGrupo.col === col && ordenTablaGrupo.dir === "asc") ? "desc" : "asc";
      ordenTablaGrupo = { col, dir: nuevaDir };
      renderTablaTareasPorGrupo(lista);
      actualizarBotonLimpiarFiltros();
    });
  });
}

function renderTablaTareasCriticas(lista) {
  const contenedor = document.getElementById("tablaTareasCriticas");
  const tareasNoResumen = obtenerTareasNoResumen(lista);

  if (tareasNoResumen.length === 0) {
    contenedor.innerHTML = `<div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding: 2vh;"><div style="width:64px; height:64px; border-radius:50%; background:rgba(107, 114, 128, 0.08); border:2px dashed #6B7280; display:flex; align-items:center; justify-content:center;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div><span style="color:#6B7280; font-size:1.5vh; font-weight:600; text-align:center;">No se encontraron tareas con los filtros actuales</span></div>`;
    return;
  }

  const tareasCriticas = ordenarPorGrupoYNombre(
    tareasNoResumen.filter(t => esTareaCritica(t["Fin"], t["% completado"]))
  );

  if (!tareasCriticas.length) {
    contenedor.innerHTML = `
      <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;">
        <div style="width:80px; height:80px; border-radius:50%; background:rgba(0,176,149,0.10); border:3px solid #00B095; display:flex; align-items:center; justify-content:center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#00B095" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <span style="color:#00B095; font-size:1.8vh; font-weight:700;">Todo en orden</span>
        <span style="color:#888; font-size:1.6vh;">No hay tareas críticas y atrasadas pendientes</span>
      </div>
    `;
    return;
  }

  // Ordenar por días restantes ascendente (más urgente primero)
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let tareasConDias = tareasCriticas.map(t => {
    const fin = parseFechaLocal(t["Fin"]);
    fin.setHours(0, 0, 0, 0);
    const diasRestantes = Math.round((fin - hoy) / (1000 * 60 * 60 * 24));
    return { ...t, diasRestantes };
  }).sort((a, b) => a.diasRestantes - b.diasRestantes);

  if (ordenTablaCriticas.col) {
    const { col, dir } = ordenTablaCriticas;
    tareasConDias = [...tareasConDias].sort((a, b) => {
      if (col === "nombre") {
        const valA = capitalizarPrimeraLetra(limpiarTexto(a["Nombre de tarea"] || a["Nombre"])).toLowerCase();
        const valB = capitalizarPrimeraLetra(limpiarTexto(b["Nombre de tarea"] || b["Nombre"])).toLowerCase();
        return dir === "asc" ? valA.localeCompare(valB, "es") : valB.localeCompare(valA, "es");
      }
      if (col === "dias") {
        return dir === "asc" ? a.diasRestantes - b.diasRestantes : b.diasRestantes - a.diasRestantes;
      }
      return 0;
    });
  }

  const filas = tareasConDias.map(t => {
    const nombre = capitalizarPrimeraLetra(limpiarTexto(t["Nombre de tarea"] || t["Nombre"]));
    const pct    = Number(t["% completado"] || 0);

    const colorPunto = colorEstado(pct).borde;
    const punto = `<span class="tabla-estado-dot" style="background:${colorPunto}; box-shadow: 0 0 5px ${colorPunto};"></span>`;

    const colorDias = t.diasRestantes < 0 ? "#EF4444" : t.diasRestantes <= 2 ? "#f59e0b" : "var(--text-main)";

    return `
      <tr>
        <td class="col-nombre">
          <span class="col-nombre-inner">${punto}${nombre || "-"}</span>
        </td>
        <td class="col-critica" style="color:${colorDias}; font-weight:700;">${t.diasRestantes}d</td>
      </tr>`;
  }).join("");

  contenedor.innerHTML = `
    <div class="tablaWrapper">
      <div class="tablaHeaderBox">
        <table class="tablaDashboard">
          <thead><tr>${construirThOrdenable("nombre", "Nombre", "col-nombre", "tabla-th-sort-critica", ordenTablaCriticas)}${construirThOrdenable("dias", "Días", "col-critica", "tabla-th-sort-critica", ordenTablaCriticas)}</tr></thead>
        </table>
      </div>
      <div class="tablaScroll" style="border-top: none;">
        <table class="tablaDashboard">
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="tablaTotalBar">
        <span class="total">Total</span>
        <span class="total-valor">${tareasConDias.length}</span>
      </div>
    </div>
  `;

  contenedor.querySelectorAll(".tabla-th-sort-critica").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      const nuevaDir = (ordenTablaCriticas.col === col && ordenTablaCriticas.dir === "asc") ? "desc" : "asc";
      ordenTablaCriticas = { col, dir: nuevaDir };
      renderTablaTareasCriticas(lista);
      actualizarBotonLimpiarFiltros();
    });
  });
}

function filtrarTareasPorEstado(lista) {
  return lista.filter(t => {
    const porcentaje = Number(t["% completado"] || 0);

    let nombreEstado;
    if (porcentaje === 0) nombreEstado = "No iniciadas";
    else if (porcentaje > 0 && porcentaje < 100) nombreEstado = "En progreso";
    else nombreEstado = "Finalizadas";

    const pasaLeyenda  = estadosTortaSeleccionados[nombreEstado];
    const pasaClick    = !estadoTortaClickSeleccionado || estadoTortaClickSeleccionado === nombreEstado;

    const atrasada  = esTareaAtrasada(t["Fin"], porcentaje);
    const pasaBarras = atrasada
      ? estadosBarrasSeleccionados["Tareas Atrasadas"]
      : estadosBarrasSeleccionados["Tareas No Atrasadas"];

    return pasaLeyenda && pasaClick && pasaBarras;
  });
}

function renderTablasYGraficosConEstado(listaBase) {
  const listaFiltrada = filtrarTareasPorEstado(listaBase);
  renderTarjetasDinamicas(listaFiltrada, curvaDinamicaActual);
  renderTablaTareasPorGrupo(listaFiltrada);
  renderTablaTareasCriticas(listaFiltrada);
  renderGantt(listaFiltrada);
  renderGraficoBarras(tareasParaBarrasActual);

  actualizarBotonLimpiarFiltros(listaFiltrada);
}

// Comparamos contra el total de tareas del proyecto (sin filtrar) en vez de
// enumerar cada filtro individual: así cualquier forma de filtrar (grupo,
// responsable, búsqueda, click en una tabla) queda detectada automáticamente,
// sin depender de acordarse de sumarla acá. El orden manual de columnas
// (que no cambia la cantidad de filas) se sigue chequeando aparte, igual que
// el estado del Gantt (grupos colapsados / fila resaltada), que tampoco
// cambia la cantidad de tareas listadas.
function actualizarBotonLimpiarFiltros(listaFiltradaPreCalculada) {
  const btnFiltros = document.getElementById("btnLimpiarTodosFiltros");
  const btnFiltrosGanttFs = document.getElementById("gsBtnLimpiarFiltros");
  if (!btnFiltros && !btnFiltrosGanttFs) return;

  const listaFiltrada = listaFiltradaPreCalculada || filtrarTareasPorEstado(tareasFiltradas);
  const idProyectoSeleccionado = document.getElementById("selectorProyecto")?.value;
  const totalTareasProyecto = contarTareasNoResumen(
    tareas.filter(t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyectoSeleccionado))
  );
  const hayFiltroDatos = contarTareasNoResumen(listaFiltrada) < totalTareasProyecto;
  const hayOrdenActivo = ordenTablaGrupo.col !== null || ordenTablaCriticas.col !== null;
  const hayGanttActivo = gruposColapsados.size > 0 || ganttFilaSeleccionada;

  [btnFiltros, btnFiltrosGanttFs].forEach(btn => {
    if (!btn) return;
    if (hayFiltroDatos || hayOrdenActivo || hayGanttActivo) {
      btn.classList.add("filtro-activo");
      btn.disabled = false;
    } else {
      btn.classList.remove("filtro-activo");
      btn.disabled = true;
    }
  });
}

function contarTareasNoResumen(lista) {
  return lista.filter(t => String(t["Resumen"]).trim().toLowerCase() !== "true").length;
}

function normalizarGrupoId(valor) {
  const texto = limpiarTexto(valor);
  if (!texto) return "Sin Grupo";
  if (!isNaN(Number(texto))) return String(Number(texto));
  return texto;
}

function obtenerNumeroGrupo(grupoText) {
  if (grupoText === "Sin Grupo") return Infinity;
  const match = String(grupoText).match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : NaN;
}

function esTareaAtrasada(fechaFin, porcentajeCompletado) {
  if (!fechaFin) return false;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fin = parseFechaLocal(fechaFin);
  if (!fin || isNaN(fin.getTime())) return false;
  fin.setHours(0, 0, 0, 0);
  return fin < hoy && Number(porcentajeCompletado) < 100;
}

function convertirPorcentajeANumero(valor) {
  if (valor === null || valor === undefined) return 0;
  return Number(String(valor).replace("%", "").replace(",", ".").trim()) || 0;
}

function formatearPorcentaje(valor) {
  if (valor === null || valor === undefined || isNaN(valor)) return "-";
  return `${valor.toFixed(2)}%`;
}

function formatearFecha(fechaISO) {
  if (!fechaISO) return "-";
  const partes = fechaISO.split("-");
  if (partes.length !== 3) return fechaISO;
  const [anio, mes, dia] = partes;
  return `${dia}/${mes}/${anio}`;
}

function limpiarTexto(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

// El CSV puede exportar "Id" como float ("12.0") si pandas coaccionó la
// columna por algún NaN intermedio; normalizamos vía Number() para que
// coincida con los ids limpios ("12") que vienen en "Predecesoras".
function normalizarIdConector(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? String(n) : String(valor).trim();
}

// Cada .mpp numera sus tareas desde 1, así que el mismo "Id" se repite entre
// proyectos distintos en la vista unificada — hay que namespacear por
// "ID Proyecto" para no mezclar tareas de proyectos diferentes.
function claveTareaConector(idProyecto, id) {
  return `${limpiarTexto(idProyecto)}::${normalizarIdConector(id)}`;
}

function normalizarTextoBusqueda(texto) {
  if (!texto) return "";
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function capitalizarPrimeraLetra(valor) {
  const texto = limpiarTexto(valor);
  if (!texto) return "";
  const primeraLetra = texto.charAt(0).toLocaleUpperCase("es-AR");
  return primeraLetra + texto.slice(1);
}

function formatearFechaISO(fecha) {
  if (!fecha) return "-";
  const texto = String(fecha).trim();
  if (texto.includes("-")) {
    const partes = texto.split("-");
    if (partes.length === 3) {
      const [anio, mes, dia] = partes;
      return `${dia}/${mes}/${anio}`;
    }
  }
  const d = new Date(texto);
  if (isNaN(d.getTime())) return "-";
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const anio = d.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

function actualizarBadgeFecha() {
  const badge = document.getElementById("badgeUltimaActualizacion");
  const hora  = document.getElementById("badgeHora");
  if (!badge || !hora) return;
  const ahora = new Date();
  const dia  = String(ahora.getDate()).padStart(2, "0");
  const mes  = String(ahora.getMonth() + 1).padStart(2, "0");
  const anio = ahora.getFullYear();
  const hh   = String(ahora.getHours()).padStart(2, "0");
  const mm   = String(ahora.getMinutes()).padStart(2, "0");
  hora.textContent = `${dia}/${mes}/${anio} ${hh}:${mm}`;
  badge.classList.add("visible");
}

function mostrarToast(mensaje, tipo = "ok") {
  const toast = document.getElementById("toastActualizacion");
  if (!toast) return;
  toast.innerHTML = `<span class="toast-dot"></span><span>${mensaje}</span>`;
  toast.className = "toast-actualizacion mostrar";
  setTimeout(() => { toast.className = "toast-actualizacion"; }, 4000);
}

function mostrarConfirmacion(mensaje, titulo = "¿Confirmar?") {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modalConfirmacion");
    const tituloEl = document.getElementById("confirmacionTitulo");
    const mensajeEl = document.getElementById("confirmacionMensaje");
    const btnCancelar = document.getElementById("btnConfirmacionCancelar");
    const btnAceptar = document.getElementById("btnConfirmacionAceptar");

    tituloEl.textContent = titulo;
    mensajeEl.textContent = mensaje;
    overlay.style.display = "flex";

    function cerrar(resultado) {
      overlay.style.display = "none";
      btnCancelar.removeEventListener("click", onCancelar);
      btnAceptar.removeEventListener("click", onAceptar);
      overlay.removeEventListener("click", onOverlayClick);
      resolve(resultado);
    }
    function onCancelar() { cerrar(false); }
    function onAceptar() { cerrar(true); }
    function onOverlayClick(e) { if (e.target === overlay) cerrar(false); }

    btnCancelar.addEventListener("click", onCancelar);
    btnAceptar.addEventListener("click", onAceptar);
    overlay.addEventListener("click", onOverlayClick);
  });
}

function parseFechaLocal(texto) {
  if (!texto) return null;
  const partes = String(texto).trim().split("-");
  if (partes.length !== 3) return null;
  const [anio, mes, dia] = partes;
  return new Date(Number(anio), Number(mes) - 1, Number(dia));
}

function esDiaHabil(fecha) {
  const d = new Date(fecha);
  const dia = d.getDay();
  return dia !== 0 && dia !== 6;
}

function contarDiasHabilesEntre(inicio, fin) {
  if (!inicio || !fin || isNaN(inicio.getTime()) || isNaN(fin.getTime())) return 1;
  const desde = new Date(inicio);
  const hasta = new Date(fin);
  desde.setHours(0, 0, 0, 0);
  hasta.setHours(0, 0, 0, 0);
  let contador = 0;
  for (let d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) {
    if (esDiaHabil(d)) contador++;
  }
  return Math.max(1, contador);
}

function exportarTareasGrupoCSV() {
  // Sin reordenar: tareasFiltradas ya viene en el mismo orden que arma el
  // Gantt (orden original del .mpp), así el CSV coincide con lo que se ve
  // en pantalla en vez de quedar reagrupado/alfabetizado.
  const tareasNoResumen = obtenerTareasNoResumen(tareasFiltradas);
  if (!tareasNoResumen.length) { mostrarToast("No hay datos para exportar", "error"); return; }

  const datosMapeados = tareasNoResumen.map(t => ({
    "ID Proyecto": t["ID Proyecto"] || "",
    "Grupo ID": normalizarGrupoId(t["Grupo_ID"]),
    "Nombre de Tarea": capitalizarPrimeraLetra(limpiarTexto(t["Nombre de tarea"] || t["Nombre"])),
    "Responsable": normalizarResponsable(t["Responsable"]),
    "Comienzo": t["Comienzo"] || "",
    "Fin": t["Fin"] || "",
    "Progreso (%)": `${Number(t["% completado"] || 0)}%`,
    "Duración": t["Duración"] || ""
  }));

  descargarCSVConPapa(datosMapeados, "Detalle_Tareas_Grupo");
}

function exportarTareasCriticasCSV() {
  const tareasNoResumen = obtenerTareasNoResumen(tareasFiltradas);
  const tareasCriticas = ordenarPorGrupoYNombre(
    tareasNoResumen.filter(t => esTareaCritica(t["Fin"], t["% completado"]))
  );
  
  if (!tareasCriticas.length) { mostrarToast("No hay tareas críticas para exportar", "error"); return; }

  // Mismo cálculo que la columna "Días" de la tabla en pantalla: negativo =
  // días de atraso, positivo = días que quedan para finalizar.
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const datosMapeados = tareasCriticas.map(t => {
    const fin = parseFechaLocal(t["Fin"]);
    fin.setHours(0, 0, 0, 0);
    const diasRestantes = Math.round((fin - hoy) / (1000 * 60 * 60 * 24));
    return {
      "ID Proyecto": t["ID Proyecto"] || "",
      "Grupo ID": normalizarGrupoId(t["Grupo_ID"]),
      "Nombre de Tarea": capitalizarPrimeraLetra(limpiarTexto(t["Nombre de tarea"] || t["Nombre"])),
      "Responsable": normalizarResponsable(t["Responsable"]),
      "Comienzo": t["Comienzo"] || "",
      "Fin": t["Fin"] || "",
      "Progreso (%)": `${Number(t["% completado"] || 0)}%`,
      "Duración": t["Duración"] || "",
      "Días": diasRestantes
    };
  });

  descargarCSVConPapa(datosMapeados, "Tareas_Criticas_Pendientes");
}

function descargarCSVConPapa(datos, prefijoArchivo) {
  const csvTexto = Papa.unparse(datos, { delimiter: ";" });
  const blob = new Blob(["\uFEFF" + csvTexto], { type: "text/csv;charset=utf-8;" });
  const idProyecto = document.getElementById("selectorProyecto").value || "Dashboard";
  const nombreArchivo = `${prefijoArchivo}_${idProyecto}.csv`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", nombreArchivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  mostrarToast("CSV generado y descargado correctamente");
}

// ══════════════════════════════════════
//  COMENTARIOS POR TAREA
// ══════════════════════════════════════

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function formatearFechaHoraComentario(fechaIso) {
  const d = new Date(fechaIso);
  if (isNaN(d.getTime())) return fechaIso || "";
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const anio = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${anio} ${hh}:${mm}`;
}

// Demo publica sin backend: no hay API de comentarios que consultar.
async function cargarConteoComentarios() {
  comentariosConteo = {};
}

// Gente elegida en el buscador de "Asignar a" del comentario que se está
// redactando (se resetea al abrir el panel y al guardar con éxito).
let comentarioAsignadosSeleccionados = [];
// Índice del ítem resaltado por teclado (flechas) en el dropdown de asignados.
let indiceFocusadoAsignado = -1;

function renderChipsAsignados() {
  const cont = document.getElementById("comentarioAsignadoChips");
  cont.innerHTML = comentarioAsignadosSeleccionados.map(p => `
    <span class="comentario-chip">${escapeHtml(p.nombre)}<button type="button" class="comentario-chip-quitar" data-email="${escapeHtml(p.email)}" data-tooltip="Quitar">×</button></span>
  `).join("");
}

// El dropdown vive fuera del modal (portal al body, ver DOMContentLoaded)
// para no quedar recortado por el overflow:hidden de .comentarios-modal;
// por eso hay que recalcular su posición fixed contra el input cada vez
// que se abre o se re-renderiza.
function posicionarDropdownAsignados() {
  const input = document.getElementById("comentarioAsignadoInput");
  const dropdown = document.getElementById("comentarioAsignadoDropdown");
  const rect = input.getBoundingClientRect();
  dropdown.style.top   = `${rect.bottom + 4}px`;
  dropdown.style.left  = `${rect.left}px`;
  dropdown.style.width = `${rect.width}px`;
}

function renderDropdownAsignados(filtro) {
  const dropdown = document.getElementById("comentarioAsignadoDropdown");
  indiceFocusadoAsignado = -1;
  const disponibles = EQUIPO_DEMO
    .filter(p => !comentarioAsignadosSeleccionados.some(s => s.email === p.email))
    .filter(p => !filtro || normalizarTextoBusqueda(p.nombre).includes(normalizarTextoBusqueda(filtro)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  if (!disponibles.length) {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    return;
  }
  dropdown.innerHTML = disponibles.map(p =>
    `<li data-email="${escapeHtml(p.email)}" data-nombre="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</li>`
  ).join("");
  posicionarDropdownAsignados();
  dropdown.style.display = "block";
}

function agregarAsignado(nombre, email) {
  if (comentarioAsignadosSeleccionados.some(s => s.email === email)) return;
  comentarioAsignadosSeleccionados.push({ nombre, email });
  renderChipsAsignados();

  const input = document.getElementById("comentarioAsignadoInput");
  input.value = "";
  renderDropdownAsignados("");
  input.focus();

  document.getElementById("errorComentarioAsignado").textContent = "";
  document.getElementById("comentarioAsignadoBox").classList.remove("campo-comentario-invalido");
}

function quitarAsignado(email) {
  comentarioAsignadosSeleccionados = comentarioAsignadosSeleccionados.filter(s => s.email !== email);
  renderChipsAsignados();
}

function reiniciarAsignados() {
  comentarioAsignadosSeleccionados = [];
  renderChipsAsignados();
  document.getElementById("comentarioAsignadoInput").value = "";
  document.getElementById("comentarioAsignadoDropdown").style.display = "none";
}

function construirCuerpoNotificacion(autor, nombreTarea, texto) {
  const ctx = comentarioContextoActual || {};
  const lineasContexto = [
    ctx.proyecto ? `Proyecto: ${ctx.proyecto}` : null,
    ctx.grupo ? `Grupo: ${ctx.grupo}` : null,
    ctx.subgrupo ? `Subgrupo: ${ctx.subgrupo}` : null,
  ].filter(Boolean).join("\n");

  return `${autor} te asignó un comentario en la tarea "${nombreTarea}":\n\n`
    + (lineasContexto ? `${lineasContexto}\n\n` : "")
    + `"${texto}"\n\n— Enviado desde el Dashboard de Seguimiento de Proyectos`;
}

// "destinatarios" acepta un email o una lista de emails (separa a varios
// destinatarios con ";", formato que entiende el campo "Para" de OWA).
function construirUrlNotificacionOWA(destinatarios, asunto, cuerpo) {
  const to = Array.isArray(destinatarios) ? destinatarios.join(";") : destinatarios;
  const params = new URLSearchParams({
    path: "/mail/action/compose",
    to,
    subject: asunto,
    body: cuerpo,
  });
  return `${OWA_BASE_URL}?${params.toString()}`;
}

function abrirPanelComentarios(clave, nombreTarea) {
  comentarioTareaActual = clave;
  const separador = clave.lastIndexOf("::");
  const idProyecto = separador >= 0 ? clave.slice(0, separador) : "";
  const idTarea = separador >= 0 ? clave.slice(separador + 2) : "";
  comentarioContextoActual = obtenerContextoTarea(idProyecto, idTarea);

  document.getElementById("comentariosTituloTarea").textContent = nombreTarea || "Comentarios";
  document.getElementById("comentarioTextoInput").value = "";
  reiniciarAsignados();
  limpiarValidacionComentario();

  const autorGuardado = localStorage.getItem("comentarioAutor") || "";
  document.getElementById("comentarioAutorInput").value = autorGuardado;

  document.getElementById("modalComentarios").style.display = "flex";
  cargarComentariosTarea(clave);
}

function cerrarPanelComentarios() {
  const modal = document.getElementById("modalComentarios");
  if (modal) modal.style.display = "none";
  comentarioTareaActual = null;
}

async function cargarComentariosTarea(clave) {
  const contenedor = document.getElementById("comentariosLista");
  contenedor.innerHTML = `<div class="comentarios-vacio">Cargando...</div>`;
  try {
    const resp = await fetch(`/api/comentarios/${encodeURIComponent(clave)}`);
    if (!resp.ok) throw new Error(`No se pudo cargar comentarios: ${resp.status}`);
    const lista = await resp.json();
    renderComentariosLista(lista);
  } catch (error) {
    console.error("Error al cargar comentarios:", error);
    contenedor.innerHTML = `<div class="comentarios-vacio">No se pudieron cargar los comentarios.</div>`;
  }
}

function renderComentariosLista(lista) {
  const contenedor = document.getElementById("comentariosLista");
  comentariosPorId = {};
  lista.forEach(c => { comentariosPorId[c.id] = c; });

  if (!lista.length) {
    contenedor.innerHTML = `<div class="comentarios-vacio">Todavía no hay comentarios en esta tarea.</div>`;
    return;
  }
  contenedor.innerHTML = lista.map(c => `
    <div class="comentario-item">
      <div class="comentario-item-cabecera">
        <span class="comentario-autor">${escapeHtml(c.autor)}</span>
        <div class="comentario-item-meta">
          <span class="comentario-fecha">${formatearFechaHoraComentario(c.fecha)}${c.fecha_edicion ? " (editado)" : ""}</span>
          ${c.asignado_email ? `<button type="button" class="comentario-accion-btn" data-tooltip="Notificar por mail" onclick="notificarPorMailComentario(${c.id})">📧</button>` : ""}
          <button type="button" class="comentario-accion-btn" data-tooltip="Editar" onclick="activarEdicionComentario(${c.id})">✏️</button>
          <button type="button" class="comentario-accion-btn" data-tooltip="Eliminar" onclick="eliminarComentario(${c.id})">🗑️</button>
        </div>
      </div>
      <div class="comentario-texto" id="comentarioTexto-${c.id}">${escapeHtml(c.texto)}</div>
      ${c.asignado_email ? `<div class="comentario-asignado">Asignado a: ${escapeHtml(c.asignado_a || c.asignado_email)}</div>` : ""}
    </div>
  `).join("");
  contenedor.scrollTop = contenedor.scrollHeight;
}

function activarEdicionComentario(id) {
  const contenedorTexto = document.getElementById(`comentarioTexto-${id}`);
  const comentario = comentariosPorId[id];
  if (!contenedorTexto || !comentario) return;

  contenedorTexto.innerHTML = `
    <input type="text" class="comentario-autor-input comentario-edicion-autor" maxlength="80" placeholder="Tu nombre">
    <textarea class="comentario-texto-input comentario-edicion-input"></textarea>
    <div class="comentario-edicion-acciones">
      <button type="button" class="comentario-mini-btn comentario-mini-btn-secundario" onclick="cancelarEdicionComentario(${id})">Cancelar</button>
      <button type="button" class="comentario-mini-btn" onclick="guardarEdicionComentario(${id})">Guardar</button>
    </div>
  `;
  const inputAutor = contenedorTexto.querySelector(".comentario-edicion-autor");
  const textarea = contenedorTexto.querySelector("textarea");
  inputAutor.value = comentario.autor;
  textarea.value = comentario.texto;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function cancelarEdicionComentario(id) {
  const contenedorTexto = document.getElementById(`comentarioTexto-${id}`);
  const comentario = comentariosPorId[id];
  if (!contenedorTexto || !comentario) return;
  contenedorTexto.innerHTML = escapeHtml(comentario.texto);
}

async function guardarEdicionComentario(id) {
  const contenedorTexto = document.getElementById(`comentarioTexto-${id}`);
  if (!contenedorTexto) return;
  const inputAutor = contenedorTexto.querySelector(".comentario-edicion-autor");
  const textarea = contenedorTexto.querySelector("textarea");
  const nuevoAutor = inputAutor.value.trim();
  const nuevoTexto = textarea.value.trim();
  if (!nuevoTexto) { mostrarToast("El comentario no puede quedar vacío", "error"); return; }

  try {
    const resp = await fetch(`/api/comentario/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autor: nuevoAutor, texto: nuevoTexto })
    });
    if (!resp.ok) throw new Error(`No se pudo editar el comentario: ${resp.status}`);

    mostrarToast("Comentario editado");
    await cargarComentariosTarea(comentarioTareaActual);
  } catch (error) {
    console.error("Error al editar comentario:", error);
    mostrarToast("No se pudo editar el comentario", "error");
  }
}

async function eliminarComentario(id) {
  const confirmado = await mostrarConfirmacion(
    "¿Eliminar este comentario? Esta acción no se puede deshacer.",
    "Eliminar comentario"
  );
  if (!confirmado) return;

  try {
    const resp = await fetch(`/api/comentario/${id}`, { method: "DELETE" });
    if (!resp.ok) throw new Error(`No se pudo eliminar el comentario: ${resp.status}`);

    if (comentarioTareaActual && comentariosConteo[comentarioTareaActual]) {
      comentariosConteo[comentarioTareaActual] = Math.max(0, comentariosConteo[comentarioTareaActual] - 1);
      if (comentariosConteo[comentarioTareaActual] === 0) {
        document.querySelectorAll('[data-comentario]').forEach(el => {
          if (el.dataset.comentario !== comentarioTareaActual) return;
          el.classList.remove("tiene-comentarios");
          el.setAttribute("data-tooltip", "Agregar comentario");
        });
      }
    }

    mostrarToast("Comentario eliminado");
    await cargarComentariosTarea(comentarioTareaActual);
  } catch (error) {
    console.error("Error al eliminar comentario:", error);
    mostrarToast("No se pudo eliminar el comentario", "error");
  }
}

// Los 3 campos del formulario de comentario (nombre, texto, a quién se
// asigna) son obligatorios para las dos acciones del panel: guardar y
// notificar. Pinta de rojo los que falten y avisa cuáles son por toast.
function validarCamposComentario() {
  const camposTexto = [
    { el: document.getElementById("comentarioAutorInput"), error: document.getElementById("errorComentarioAutor"), mensaje: "Completar nombre" },
    { el: document.getElementById("comentarioTextoInput"), error: document.getElementById("errorComentarioTexto"), mensaje: "Completar comentario" },
  ];

  let valido = true;
  camposTexto.forEach(c => {
    const vacio = !c.el.value.trim();
    c.el.classList.toggle("campo-comentario-invalido", vacio);
    c.error.textContent = vacio ? c.mensaje : "";
    if (vacio) valido = false;
  });

  const sinAsignados = comentarioAsignadosSeleccionados.length === 0;
  document.getElementById("comentarioAsignadoBox").classList.toggle("campo-comentario-invalido", sinAsignados);
  document.getElementById("errorComentarioAsignado").textContent = sinAsignados ? "Completar asignación" : "";
  if (sinAsignados) valido = false;

  return valido;
}

function limpiarValidacionComentario() {
  [
    ["comentarioAutorInput", "errorComentarioAutor"],
    ["comentarioTextoInput", "errorComentarioTexto"],
  ].forEach(([campoId, errorId]) => {
    document.getElementById(campoId).classList.remove("campo-comentario-invalido");
    document.getElementById(errorId).textContent = "";
  });
  document.getElementById("comentarioAsignadoBox").classList.remove("campo-comentario-invalido");
  document.getElementById("errorComentarioAsignado").textContent = "";
}

async function guardarComentario(notificar) {
  if (!comentarioTareaActual) return;
  if (!validarCamposComentario()) return;

  const inputAutor = document.getElementById("comentarioAutorInput");
  const inputTexto = document.getElementById("comentarioTextoInput");
  const btnGuardar = document.getElementById("btnGuardarComentario");
  const btnNotificar = document.getElementById("btnNotificarMail");

  const autor = inputAutor.value.trim();
  const texto = inputTexto.value.trim();
  const asignados = [...comentarioAsignadosSeleccionados];
  const asignadoNombre = asignados.map(p => p.nombre).join(" / ");
  const asignadoEmail = asignados.map(p => p.email).join(",");

  const nombreTarea = document.getElementById("comentariosTituloTarea").textContent || "";

  btnGuardar.disabled = true;
  btnNotificar.disabled = true;
  try {
    const resp = await fetch("/api/comentarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tarea: comentarioTareaActual, autor, texto,
        asignado_a: asignadoNombre, asignado_email: asignadoEmail,
      })
    });
    if (!resp.ok) throw new Error(`No se pudo guardar el comentario: ${resp.status}`);

    localStorage.setItem("comentarioAutor", autor);
    inputTexto.value = "";
    reiniciarAsignados();
    limpiarValidacionComentario();

    comentariosConteo[comentarioTareaActual] = (comentariosConteo[comentarioTareaActual] || 0) + 1;
    document.querySelectorAll('[data-comentario]').forEach(el => {
      if (el.dataset.comentario !== comentarioTareaActual) return;
      el.classList.add("tiene-comentarios");
      el.setAttribute("data-tooltip", "Ver comentarios");
    });

    await cargarComentariosTarea(comentarioTareaActual);
    mostrarToast("Comentario guardado");

    if (notificar) {
      const asunto = `Comentario asignado: ${nombreTarea}`;
      const cuerpo = construirCuerpoNotificacion(autor, nombreTarea, texto);
      window.open(construirUrlNotificacionOWA(asignados.map(p => p.email), asunto, cuerpo), "_blank");
    }
  } catch (error) {
    console.error("Error al guardar comentario:", error);
    mostrarToast("No se pudo guardar el comentario", "error");
  } finally {
    btnGuardar.disabled = false;
    btnNotificar.disabled = false;
  }
}

function notificarPorMailComentario(id) {
  const c = comentariosPorId[id];
  if (!c || !c.asignado_email) return;
  const emails = c.asignado_email.split(",").map(e => e.trim()).filter(Boolean);
  const nombreTarea = document.getElementById("comentariosTituloTarea").textContent || "";
  const asunto = `Comentario asignado: ${nombreTarea}`;
  const cuerpo = construirCuerpoNotificacion(c.autor, nombreTarea, c.texto);
  window.open(construirUrlNotificacionOWA(emails, asunto, cuerpo), "_blank");
}

async function generarResumenEjecutivo() {
  if (MODO_DEMO) { mostrarToast("Requiere el backend interno: no disponible en la demo", "error"); return; }
  const boton = document.getElementById("btnResumenEjecutivo");
  const idProyecto = document.getElementById("selectorProyecto").value;

  if (!idProyecto || !tareasParaBarrasActual || !tareasParaBarrasActual.length) {
    mostrarToast("No hay datos de proyecto para generar el resumen", "error");
    return;
  }

  if (boton) { boton.disabled = true; boton.style.opacity = "0.5"; }

  try {
    const tareasNoResumen = obtenerTareasNoResumen(tareasParaBarrasActual);

    // ── Avance Real / Teórico HOY desde la curva S del proyecto completo ──
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let curvaProyecto = generarCurvaSDesdeTareas(tareasNoResumen);
    let puntoHoy = curvaProyecto.length
      ? curvaProyecto.reduce((prev, curr) =>
          Math.abs(new Date(curr.fecha).getTime() - hoy.getTime()) < Math.abs(new Date(prev.fecha).getTime() - hoy.getTime())
            ? curr : prev
        , curvaProyecto[0])
      : { real: 0, teorico: 0 };

    const avanceReal = Number(puntoHoy.real || 0);
    const avanceTeorico = Number(puntoHoy.teorico || 0);
    const desvio = avanceReal - avanceTeorico;
    const estado = colorPorDesvio(desvio).label;

    // ── Fecha fin y días restantes (igual criterio que renderTarjetasDinamicas) ──
    const fechasFin = tareasNoResumen
      .map(t => parseFechaLocal(t["Fin"]))
      .filter(f => f && !isNaN(f.getTime()));
    const fechaFinCalc = fechasFin.length ? new Date(Math.max(...fechasFin.map(f => f.getTime()))) : null;
    const fechaFinStr = fechaFinCalc ? formatearFechaISO(fechaFinCalc) : "-";
    const diasRestantes = fechaFinCalc
      ? Math.round((new Date(fechaFinCalc).setHours(0, 0, 0, 0) - hoy.getTime()) / 86400000)
      : 0;

    // ── Tareas completadas / total ──
    const totalTareas = tareasNoResumen.length;
    const tareasCompletadas = tareasNoResumen.filter(t => Number(t["% completado"] || 0) >= 100).length;

    // ── Grupos con al menos 1 tarea atrasada (mismo criterio que esTareaAtrasada) ──
    const gruposMap = {};
    tareasNoResumen.forEach(t => {
      const grupoId = normalizarGrupoId(t["Grupo_ID"]);
      if (!gruposMap[grupoId]) gruposMap[grupoId] = { total: 0, atrasadas: 0 };
      gruposMap[grupoId].total += 1;
      if (esTareaAtrasada(t["Fin"], t["% completado"])) gruposMap[grupoId].atrasadas += 1;
    });

    const gruposAtrasados = Object.keys(gruposMap)
      .filter(g => gruposMap[g].atrasadas > 0)
      .sort((a, b) => {
        const na = obtenerNumeroGrupo(a), nb = obtenerNumeroGrupo(b);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return String(a).localeCompare(String(b));
      })
      .map(g => ({
        grupo: g,
        cantidadAtrasadas: gruposMap[g].atrasadas,
        totalGrupo: gruposMap[g].total
      }));

    // ── Tareas críticas (mismo criterio que esTareaCritica), con días +/- ──
    const tareasCriticas = ordenarPorGrupoYNombre(
      tareasNoResumen.filter(t => esTareaCritica(t["Fin"], t["% completado"]))
    ).map(t => {
      const fin = parseFechaLocal(t["Fin"]);
      fin.setHours(0, 0, 0, 0);
      const dias = Math.round((fin - hoy) / (1000 * 60 * 60 * 24));
      return {
        nombre: capitalizarPrimeraLetra(limpiarTexto(t["Nombre de tarea"] || t["Nombre"])),
        responsable: limpiarTexto(t["Responsable"]) || "Sin Asignar",
        dias
      };
    }).sort((a, b) => a.dias - b.dias);

    const payload = {
      proyecto: idProyecto,
      fecha: formatearFechaISO(new Date()),
      estado,
      desvio,
      avanceReal,
      avanceTeorico,
      diasRestantes,
      fechaFin: fechaFinStr,
      totalTareas,
      tareasCompletadas,
      gruposAtrasados,
      tareasCriticas
    };

    const respuesta = await fetch("/generar_resumen_ejecutivo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!respuesta.ok) throw new Error(`Error del servidor: ${respuesta.status}`);

    const blob = await respuesta.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Resumen_Ejecutivo_${idProyecto}.docx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    mostrarToast("Resumen ejecutivo generado correctamente");

  } catch (error) {
    console.error("Error al generar el resumen ejecutivo:", error);
    mostrarToast("Error al generar el resumen ejecutivo", "error");
  } finally {
    if (boton) { boton.disabled = false; boton.style.opacity = ""; }
  }
}

function descargarProyecto() {
  const idProyecto = document.getElementById("selectorProyecto").value;
  if (!idProyecto) { mostrarToast("No hay proyecto seleccionado", "error"); return; }
  const nombreArchivo = `Proyecto ${idProyecto}.mpp`;
  const urlArchivo = `/scripts/${encodeURIComponent(nombreArchivo)}`;
  const a = document.createElement("a");
  a.href = urlArchivo;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  mostrarToast("Iniciando descarga del proyecto...");
}

function abrirVentanaGanttAjustado(modo) {
  if (typeof tareasFiltradas === "undefined" || !tareasFiltradas || !tareasFiltradas.length) {
    mostrarToast("No hay tareas para imprimir", "error");
    return;
  }

  const idProyecto = document.getElementById("selectorProyecto").value;

  // Rótulo estilo MS Project (Proyecto/Fecha) en el pie de página, con
  // Departamento y Creador fijos del rotulo de impresion.
  const DIAS_CORTOS_FOOTER = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const hoyFooter = new Date();
  const fechaFooterStr = `${DIAS_CORTOS_FOOTER[hoyFooter.getDay()]} ${hoyFooter.getDate()}/${hoyFooter.getMonth() + 1}/${String(hoyFooter.getFullYear()).slice(-2)}`;

  // ── Geometría objetivo: una hoja A4 apaisada ──
  const PX_MM = 96 / 25.4;
  const MARGEN_MM = 8, TITULO_MM = 10, FOOTER_MM = 6;
  const pageW = Math.round((297 - MARGEN_MM * 2) * PX_MM);                       // ~1064 px
  const pageH = Math.round((210 - MARGEN_MM * 2 - TITULO_MM - FOOTER_MM) * PX_MM); // ~665 px
  // Lienzo virtual más denso que la hoja: da más granularidad al calcular
  // ancho de día / alto de fila (enteros) y más nitidez al hacer zoom en
  // el PDF, que es vectorial y se reescala sin pixelar.
  const SUPER = 2;
  const target = { w: pageW * SUPER, h: pageH * SUPER, leftW: 320 };

  // ── Re-render del Gantt con esa geometría, clonar, y restaurar la vista ──
  //  Se recalcula la geometría en vez de escalar el render de pantalla:
  //  así el texto no se deforma. Equivale a "Ajustar a 1x1 páginas" de
  //  MS Project (de lejos no se lee, con zoom queda nítido).
  const rpPrevio = document.getElementById("ganttRP");
  const scrollPrevio = rpPrevio ? { left: rpPrevio.scrollLeft, top: rpPrevio.scrollTop } : null;

  let ganttClone = null;
  window._ganttPrintTarget = target;
  try {
    renderGantt(tareasFiltradas);
    const wrapImpreso = document.querySelector("#graficoLineaReal .gantt-wrap");
    if (wrapImpreso) ganttClone = wrapImpreso.cloneNode(true);
  } finally {
    window._ganttPrintTarget = null;
    renderGantt(tareasFiltradas);                       // restaurar pantalla
    const rp = document.getElementById("ganttRP");
    if (rp && scrollPrevio) { rp.scrollLeft = scrollPrevio.left; rp.scrollTop = scrollPrevio.top; }
  }

  if (!ganttClone) { mostrarToast("No se pudo preparar el Gantt para impresión", "error"); return; }

  ganttClone.querySelectorAll("*").forEach(el => {
    if (el.style && el.style.color) el.style.color = "#111111";
  });

  let estilosHTML = "";
  document.querySelectorAll("style, link[rel='stylesheet']").forEach(tag => { estilosHTML += tag.outerHTML; });

  const printWindow = window.open("", "_blank", "width=1280,height=860");
  if (!printWindow) { mostrarToast("El navegador bloqueó la ventana de impresión", "error"); return; }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>Diagrama de Gantt - ${idProyecto}</title>
      ${estilosHTML}
      <style>
        @page { size: A4 landscape; margin: ${MARGEN_MM}mm; }
        html, body { margin: 0; padding: 0; background: #ffffff !important; height: 100%; }
        body {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color: #111111 !important;
          /* Proyectos cortos no llenan la hoja aun a escala 1:1 (ver más
             abajo por qué la escala final es uniforme). En vez de dejar todo
             pegado arriba con un bloque de blanco abajo, se centra el título
             + gráfico como grupo en el alto disponible de la página. */
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

        /* ── Tema claro para papel ── */
        .gantt-wrap, .gantt-left, .gantt-right, .gantt-lb, .gantt-ba, .gantt-th { background: #ffffff !important; }
        .gantt-lh { background: #e6e6e6 !important; border-bottom: 1px solid #999 !important; }
        .gantt-lh span, .gantt-lh * { color: #111111 !important; }
        .gh-mes { background: #d0d0d0 !important; color: #111111 !important; }
        .gh-dia { background: #ececec !important; color: #111111 !important; }
        .gh-fds { background: #d6d6d6 !important; color: #555555 !important; }
        .gh-cell { color: #111111 !important; border-right-color: #bbbbbb !important; }
        /* La pantalla fija un piso de 36px por fila (.gantt-row min-height,
           en styles.css) para legibilidad interactiva. En impresión ROW_H
           puede bajar de eso (hasta 11px) para que proyectos largos entren
           en una sola hoja — si el navegador igual impone el piso de 36px,
           las filas quedan más altas que lo que asumió el cálculo de
           conectores (rowIndex * ROW_H) y las flechas se desalinean de las
           barras, con un desfasaje que crece fila tras fila. */
        /* La pantalla fija un piso de 36px por fila (.gantt-row min-height,
           en styles.css) para legibilidad interactiva. En impresión ROW_H
           puede bajar de eso (hasta 11px) para que proyectos largos entren
           en una sola hoja — si el navegador igual impone el piso de 36px,
           las filas quedan más altas que lo que asumió el cálculo de
           conectores (rowIndex * ROW_H) y las flechas se desalinean de las
           barras, con un desfasaje que crece fila tras fila. */
        .gantt-row { border-bottom-color: #dddddd !important; min-height: 0 !important; }
        .gantt-row-grupo { background: #e8f0ec !important; }
        .gantt-row-tarea { background: #ffffff !important; }
        .g-nombre, .g-dur { color: #111111 !important; }
        .gantt-bar-lbl { color: #ffffff !important; }
        .gantt-bar-responsable { color: #333333 !important; }
        .gantt-fds-stripe { background: #f1f1f1 !important; }
        .gantt-hoy-line::after { background: #c0392b !important; }
        .gantt-hoy-col { background: rgba(192, 57, 43, 0.06) !important; }
        .gantt-conector-linea { stroke: #888888 !important; }

        /* Controles interactivos: fuera del papel */
        .gantt-icon, .gantt-zoom-toggle, .gantt-resizer, .gantt-highlight-btn,
        .gantt-colapsar, .gantt-comentario-btn { display: none !important; }

        /* ── Sin scroll ni recortes: el contenido ya viene a tamaño de hoja ── */
        .gantt-wrap {
          display: flex !important;
          width: max-content !important;
          height: auto !important;
          overflow: visible !important;
          border: 1px solid #197F66 !important;
          border-radius: 4px;
          transform-origin: top left;
        }
        .gantt-left  { overflow: visible !important; height: auto !important; flex: 0 0 auto !important; }
        .gantt-lb    { overflow: visible !important; height: auto !important; min-height: 0 !important; }
        .gantt-right { overflow: visible !important; height: auto !important; flex: 0 0 auto !important;
                       display: flex; flex-direction: column; }
        .gantt-th    { position: static !important; box-shadow: none !important; }
        .gantt-ba    { height: auto !important; min-height: 0 !important; flex: 0 0 auto !important; }
        .gantt-lh    { box-shadow: none !important; }

        #ganttPrintTitulo {
          text-align: center;
          font-family: 'DM Sans', Inter, sans-serif;
          font-weight: 700;
          font-size: 15px;
          color: #111111;
          margin: 0 0 6px;
        }
        #ganttPrintCanvas { transform-origin: top left; }

        /* Rótulo estilo MS Project: position:fixed lo ancla al pie de CADA
           página impresa (acá solo hay una), sin robarle alto al cálculo de
           ROW_H/DIA_W — ya se le reservaron FOOTER_MM al alto de página. */
        #ganttPrintFooter {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          justify-content: center;
          gap: 18px;
          font-family: 'DM Sans', Inter, sans-serif;
          font-size: 8px;
          color: #666666;
        }
      </style>
    </head>
    <body>
      <h2 id="ganttPrintTitulo">Diagrama de Gantt — ${idProyecto}</h2>
      <div id="ganttPrintCanvas">${ganttClone.outerHTML}</div>
      <div id="ganttPrintFooter">
        <span>Proyecto: ${idProyecto}</span>
        <span>Fecha: ${fechaFooterStr}</span>
        <span>Departamento: Demo</span>
        <span>Creador: Ezequiel Manzur</span>
      </div>
    </body>
    </html>
  `);
  printWindow.document.close();

  // El contenido ya está maquetado a tamaño de hoja: solo falta escalarlo
  // para que entre en la caja de la página. La escala tiene que ser UNIFORME
  // (mismo factor en X e Y): DIA_W ya apunta a llenar el ancho objetivo con
  // precisión (queda sx ≈ 1/SUPER siempre), pero ROW_H tiene un tope de 40px
  // para que un proyecto corto no termine con filas gigantes — así, con
  // pocas filas, el alto real queda por debajo del objetivo y sy sale bien
  // distinto de sx. Escalar con sx≠sy (como hacía antes) estira el eje X
  // mucho más que el Y y deforma cada letra (se ve "aplastado"/comprimido).
  // Usando el mínimo de los dos como factor único nunca se deforma el texto;
  // lo que se pierde es no llenar 100% un eje en proyectos cortos, pero para
  // eso el body ya centra el bloque título+gráfico en la página (arriba).
  const ajustarEImprimir = () => {
    const doc = printWindow.document;
    const canvas = doc.getElementById("ganttPrintCanvas");
    const wrap   = doc.querySelector("#ganttPrintCanvas .gantt-wrap");
    if (!canvas || !wrap) { printWindow.focus(); printWindow.print(); return; }

    const SEG = 0.98;
    const cW = wrap.scrollWidth  || pageW;
    const cH = wrap.scrollHeight || pageH;
    const s = Math.min(1, (pageW * SEG) / cW, (pageH * SEG) / cH);
    wrap.style.transform = `scale(${s})`;
    canvas.style.width  = (cW * s) + "px";
    canvas.style.height = (cH * s) + "px";

    printWindow.focus();
    printWindow.print();
    if (modo !== "pdf") setTimeout(() => printWindow.close(), 400);
  };

  // Medir antes de que las webfonts (DM Sans/Inter) terminen de cargar deja
  // el cálculo de sx/sy corriendo sobre el ancho de la fuente de reemplazo:
  // el layout se reacomoda un instante después, ya con la ventana impresa
  // (o con la escala de otra medición), y el resultado varía de una
  // impresión a otra para el mismo Gantt. document.fonts.ready garantiza
  // medir sobre el layout ya estable.
  const dispararAjuste = () => {
    const fonts = printWindow.document.fonts;
    if (fonts && fonts.ready) fonts.ready.then(() => setTimeout(ajustarEImprimir, 50));
    else setTimeout(ajustarEImprimir, 200);
  };

  if (printWindow.document.readyState === "complete") dispararAjuste();
  else printWindow.addEventListener("load", dispararAjuste);
}

function imprimirGantt() {
  abrirVentanaGanttAjustado("imprimir");
}

let resizeTimeout;
window.addEventListener("resize", () => {
  [chartBarras, chartTorta, chartLineaComparacion].forEach(chart => {
    if (chart) chart.resize();
  });
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (tareasFiltradas && tareasFiltradas.length > 0) renderGantt(tareasFiltradas);
    window._actualizarLabelDesvio?.();
  }, 200);
});

async function actualizarDatos() {
  const boton = document.getElementById("btnActualizar");
  try {
    boton.disabled = true;
    boton.classList.add("actualizando");
    activarLoadingPaneles();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await cargarDashboard();
    mostrarToast("ACTUALIZADO CORRECTAMENTE");
    actualizarBadgeFecha();
  } catch (error) {
    console.error("Error al recargar datos:", error);
    mostrarToast("Error al recargar datos", "error");
  } finally {
    boton.classList.remove("actualizando");
    boton.disabled = false;
    desactivarLoadingPaneles();
  }
}

async function exportarPDF() {
  const btn = document.getElementById("btnExportarPDF");
  const iconOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = "0.4";

  const toast = document.getElementById("toastActualizacion");
  if (toast) toast.style.display = "none";

  if (tipIcono) tipIcono.style.display = 'none';

  const W = window.innerWidth;
  const H = window.innerHeight;

  try {
    const canvas = await html2canvas(document.body, {
      scale: 1.5,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#000000",
      scrollX: 0,
      scrollY: 0,
      windowWidth: W,
      windowHeight: H,
      width: W,
      height: H,
      logging: false,
      imageTimeout: 0,
      onclone: (clonedDoc) => {
        const ganttRight = clonedDoc.getElementById("ganttRP");
        const ganttLeft  = clonedDoc.getElementById("ganttLB");
        if (ganttRight) ganttRight.style.overflow = "visible";
        if (ganttLeft)  ganttLeft.style.overflow  = "visible";

        const splash  = clonedDoc.getElementById("splashScreen");
        const toastEl = clonedDoc.getElementById("toastActualizacion");
        const tooltip = clonedDoc.getElementById("ganttTooltip");
        const badge   = clonedDoc.getElementById("badgeUltimaActualizacion");
        if (splash)  splash.style.display  = "none";
        if (toastEl) toastEl.style.display = "none";
        if (tooltip) tooltip.style.display = "none";
        if (badge)   badge.style.display   = "none";

        // FIX: html2canvas no soporta el selector :has(), forzamos el ancho a mano
        const filtroProyectoClon    = clonedDoc.getElementById("selectorProyecto")?.closest(".filtroBox");
        const filtroGrupoClon       = clonedDoc.getElementById("selectorGrupo")?.closest(".filtroBox");
        const filtroResponsableClon = clonedDoc.getElementById("selectorResponsable")?.closest(".filtroBox");
        if (filtroProyectoClon)    filtroProyectoClon.style.minWidth = "9.5vw";
        if (filtroGrupoClon)       filtroGrupoClon.style.minWidth = "10.5vw";
        if (filtroResponsableClon) filtroResponsableClon.style.minWidth = "10.5vw";

        const selects = clonedDoc.querySelectorAll("select");
        selects.forEach(select => {
          // Los que ya tienen su propio botón+lista (ver crearSelectorEstilizado)
          // quedan ocultos a propósito: ese botón ya se ve solo, no hace falta
          // (ni conviene) reemplazarlos también por este div de respaldo.
          if (select.dataset.selectorEstilizado) return;
          const divTexto = clonedDoc.createElement("div");
          divTexto.textContent = select.options[select.selectedIndex]?.text || select.value;
          divTexto.style.color = "#f4f9ff";
          divTexto.style.fontSize = "1.7vh";
          divTexto.style.fontWeight = "700";
          divTexto.style.fontFamily = "'DM Sans', Inter, sans-serif";
          divTexto.style.padding = "0";
          divTexto.style.margin = "0";
          select.parentNode.replaceChild(divTexto, select);
        });

        const elementosConArtefactos = clonedDoc.querySelectorAll('.card, .panel, .bloque, .header-controls, .header h1');
        elementosConArtefactos.forEach(el => {
          el.style.boxShadow = 'none';
          el.style.border = 'none';
        });

        // FIX BUSCADOR: igual que los selects, reemplazar input por div plano
        const buscadorInput = clonedDoc.getElementById("buscadorTareas");
        const btnLimpiarClone = clonedDoc.getElementById("btnLimpiarFiltros");

        if (buscadorInput) {
          const divBuscador = clonedDoc.createElement("div");
          divBuscador.textContent = buscadorInput.value || buscadorInput.placeholder;
          divBuscador.style.color = buscadorInput.value ? "#f4f9ff" : "rgba(255,255,255,0.3)";
          divBuscador.style.fontSize = "1.7vh";
          divBuscador.style.fontWeight = buscadorInput.value ? "700" : "500";
          divBuscador.style.fontFamily = "'DM Sans', Inter, sans-serif";
          divBuscador.style.padding = "0";
          divBuscador.style.margin = "0";
          buscadorInput.parentNode.replaceChild(divBuscador, buscadorInput);
        }

        if (btnLimpiarClone) btnLimpiarClone.style.display = "none";

        const botonesYFiltros = clonedDoc.querySelectorAll('#btnActualizar, #btnExportarPDF, .filtroBox');
        botonesYFiltros.forEach(el => {
          el.style.boxShadow = 'none';
          el.style.border = '1px solid #115242';
        });
        // FIX FLIPCARD: mostrar frente correctamente
        clonedDoc.querySelectorAll('.card').forEach(card => {
          card.classList.remove('flipped');
          card.style.perspective = 'none';
        });
        clonedDoc.querySelectorAll('.card-inner').forEach(inner => {
          inner.style.transform = 'none';
          inner.style.transformStyle = 'flat';
        });
        clonedDoc.querySelectorAll('.card-back').forEach(back => {
          back.style.display = 'none';
        });
        clonedDoc.querySelectorAll('.card-front').forEach(front => {
          front.style.position = 'absolute';
          front.style.inset = '0';
          front.style.backfaceVisibility = 'visible';
        });

        clonedDoc.querySelectorAll('.card h3').forEach(h3 => {
          h3.style.cssText += `
            box-shadow: none !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            border: none !important;
            outline: none !important;
            margin: 0 !important;
            margin-bottom: 0 !important;
            padding-bottom: 0 !important;
            background: transparent !important;
            border-radius: 0 !important;
          `;
        });

        clonedDoc.querySelectorAll('.card').forEach(card => {
          card.style.backdropFilter = 'none';
          card.style.webkitBackdropFilter = 'none';
          card.style.boxShadow = 'none';
        });

        
      }
    });

    const imgData = canvas.toDataURL("image/png");
    const idProyecto = document.getElementById("selectorProyecto").value || "Dashboard";
    const fecha = new Date().toLocaleDateString("es-AR").replaceAll("/", "-");

    const link = document.createElement("a");
    link.href = imgData;
    link.download = `${idProyecto} - ${fecha}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    mostrarToast("PNG generado correctamente");

  } catch (error) {
    console.error("Error al generar PDF:", error);
    mostrarToast("Error al generar el PDF", "error");
  } finally {
    if (toast) toast.style.display = "";
    btn.disabled = false;
    btn.style.opacity = "";
    btn.innerHTML = iconOriginal;
  }
}

function sincronizarFiltrosGanttFs() {
  const selProy  = document.getElementById('selectorProyecto');
  const selGrupo = document.getElementById('selectorGrupo');
  const selResp  = document.getElementById('selectorResponsable');
  const busc     = document.getElementById('buscadorTareas');
  const gsProy   = document.getElementById('gsSelectProyecto');
  const gsGrupo  = document.getElementById('gsSelectGrupo');
  const gsResp   = document.getElementById('gsSelectResponsable');
  const gsBusc   = document.getElementById('gsBuscadorTareas');
  const gsBtnLimpiar = document.getElementById('gsBtnLimpiar');

  if (!gsProy || !gsGrupo || !gsResp || !gsBusc) return;

  gsProy.innerHTML = selProy.innerHTML;
  gsProy.value     = selProy.value;

  gsGrupo.innerHTML = selGrupo.innerHTML;
  gsGrupo.value     = selGrupo.value;

  gsResp.innerHTML = selResp.innerHTML;
  gsResp.value     = selResp.value;

  gsBusc.value = busc.value;
  if (gsBtnLimpiar) gsBtnLimpiar.classList.toggle('visible', busc.value.length > 0);
  refrescarSelectoresEstilizados();
}

function sincronizarFiltrosFs() {
  const selProy  = document.getElementById('selectorProyecto');
  const selGrupo = document.getElementById('selectorGrupo');
  const selResp  = document.getElementById('selectorResponsable');
  const busc     = document.getElementById('buscadorTareas');
  const fsProy   = document.getElementById('fsSelectorProyecto');
  const fsGrupo  = document.getElementById('fsSelectorGrupo');
  const fsResp   = document.getElementById('fsSelectorResponsable');
  const fsBusc   = document.getElementById('fsBuscadorTareas');

  if (!fsProy || !fsGrupo || !fsResp || !fsBusc) return;

  fsProy.innerHTML = selProy.innerHTML;
  fsProy.value     = selProy.value;

  fsGrupo.innerHTML = selGrupo.innerHTML;
  fsGrupo.value     = selGrupo.value;

  fsResp.innerHTML = selResp.innerHTML;
  fsResp.value     = selResp.value;

  fsBusc.value = busc.value;
  refrescarSelectoresEstilizados();
}

function toggleFullscreenLineaComparacion() {
  const panel     = document.querySelector('.panel-linea-comparacion');
  const iconoPath = document.querySelector('.fs-linea-path');
  const grafico   = document.getElementById('graficoLineaComparacion');
  if (!panel) return;

  if (grafico) grafico.style.opacity = '0';

  panel.classList.toggle('linea-comparacion-fullscreen');

  if (panel.classList.contains('linea-comparacion-fullscreen')) {
    iconoPath.setAttribute("d", "M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3");
    document.getElementById('btnFullscreenLinea').setAttribute("title", "Salir de Pantalla Completa");

    // Ocultar botones de días y separador del título
    document.querySelectorAll('.linea-h2 .grupo-ventana-linea').forEach(el => {
      el.style.display = 'none';
    });

    // Mover botones de ventana al cuadrante izquierdo
    const fsVentana = document.getElementById('fsVentanaLinea');
    if (fsVentana) {
      fsVentana.innerHTML = '';
      document.querySelectorAll('.btn-ventana-linea').forEach(btn => {
        const clone = btn.cloneNode(true);
        clone.style.fontSize = '13px';
        clone.style.padding = '4px 12px';
        fsVentana.appendChild(clone);
      });
      fsVentana.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-ventana-linea');
        if (!btn) return;
        const dias = btn.dataset.dias === 'null' ? null : Number(btn.dataset.dias);
        setVentanaLinea(dias);
      });
    }

    // Mover badge de desvío al cuadrante derecho
    const fsDesvio = document.getElementById('fsDesvioLinea');
    const labelDesvio = document.getElementById('desvioLineaLabel');
    if (fsDesvio && labelDesvio) {
      fsDesvio.appendChild(labelDesvio);
      labelDesvio.style.position = 'static';
      labelDesvio.style.transform = 'none';
      labelDesvio.style.display = 'flex';
      labelDesvio.style.fontSize = '11px';
      labelDesvio.style.padding = '2px 8px';
    }

    sincronizarFiltrosFs();
    document.getElementById('fsSelectorProyecto').onchange = function() {
      document.getElementById('selectorProyecto').value = this.value;
      inicializarSelectorGrupo();
      inicializarSelectorResponsable();
      sincronizarCascadaGrupoResponsable();
      sincronizarFiltrosFs();
      aplicarFiltros();
    };
    document.getElementById('fsSelectorGrupo').onchange = function() {
      document.getElementById('selectorGrupo').value = this.value;
      sincronizarCascadaGrupoResponsable();
      sincronizarFiltrosFs();
      aplicarFiltros();
    };
    document.getElementById('fsSelectorResponsable').onchange = function() {
      document.getElementById('selectorResponsable').value = this.value;
      sincronizarCascadaGrupoResponsable();
      sincronizarFiltrosFs();
      aplicarFiltros();
    };
    configurarBuscadorAutocomplete({
      buscadorId:           "fsBuscadorTareas",
      sugerenciasId:        "fsSugerencias",
      btnLimpiarId:         "fsBtnLimpiar",
      contadorId:           "fsContadorTareas",
      selectorProyectoId:   "fsSelectorProyecto",
      selectorGrupoId:      "fsSelectorGrupo",
      sincronizarConPrincipal: true,
      onSincronizar:        sincronizarFiltrosFs
    });
  } else {
    iconoPath.setAttribute("d", "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3");
    document.getElementById('btnFullscreenLinea').setAttribute("title", "Pantalla Completa");

    // Restaurar botones de días en el título
    document.querySelectorAll('.linea-h2 .grupo-ventana-linea').forEach(el => {
      el.style.display = '';
    });

    // Devolver badge de desvío al h2
    const h2 = document.getElementById("tituloGraficoComparacion")?.closest(".linea-h2");
    const labelDesvio = document.getElementById('desvioLineaLabel');
    if (h2 && labelDesvio) {
      h2.appendChild(labelDesvio);
      labelDesvio.style.position = 'absolute';
      labelDesvio.style.right = '8px';
      labelDesvio.style.top = '50%';
      labelDesvio.style.transform = 'translateY(-50%)';
      labelDesvio.style.fontSize = '9px';
      labelDesvio.style.padding = '1px 5px';
    }
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (chartLineaComparacion) chartLineaComparacion.resize();
      if (grafico) grafico.style.opacity = '1';
      setTimeout(() => window._actualizarLabelDesvio?.(), 150);
    });
  });
}



function toggleFullscreenGantt() {
  const panelGantt = document.querySelector('.panel-linea-real');
  const iconoPath  = document.querySelector('.fs-icon-path');
  if (!panelGantt) return;

  panelGantt.classList.toggle('gantt-fullscreen');

  if (panelGantt.classList.contains('gantt-fullscreen')) {
    iconoPath.setAttribute("d", "M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3");
    document.getElementById('btnFullscreenGantt').setAttribute("title", "Salir de Pantalla Completa");
    sincronizarFiltrosGanttFs();

    document.getElementById('gsSelectProyecto').onchange = function() {
      document.getElementById('selectorProyecto').value = this.value;
      inicializarSelectorGrupo();
      inicializarSelectorResponsable();
      sincronizarCascadaGrupoResponsable();
      sincronizarFiltrosGanttFs();
      aplicarFiltros();
    };

    document.getElementById('gsSelectGrupo').onchange = function() {
      document.getElementById('selectorGrupo').value = this.value;
      sincronizarCascadaGrupoResponsable();
      sincronizarFiltrosGanttFs();
      aplicarFiltros();
    };

    document.getElementById('gsSelectResponsable').onchange = function() {
      document.getElementById('selectorResponsable').value = this.value;
      sincronizarCascadaGrupoResponsable();
      sincronizarFiltrosGanttFs();
      aplicarFiltros();
    };

    configurarBuscadorAutocomplete({
      buscadorId:              "gsBuscadorTareas",
      sugerenciasId:           "gsSugerencias",
      btnLimpiarId:            "gsBtnLimpiar",
      contadorId:              "gsContadorTareas",
      selectorProyectoId:      "gsSelectProyecto",
      selectorGrupoId:         "gsSelectGrupo",
      sincronizarConPrincipal: true,
      onSincronizar:           sincronizarFiltrosGanttFs
    });

  } else {
    iconoPath.setAttribute("d", "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3");
    document.getElementById('btnFullscreenGantt').setAttribute("title", "Pantalla Completa");
  }

  setTimeout(() => { renderGantt(tareasFiltradas); }, 100);
}

function limpiarFiltrosGanttFs() {
  limpiarFiltros();
  sincronizarFiltrosGanttFs();
}

function limpiarFiltros() {
  // Si lo único "activo" es el estado visual del Gantt (fila resaltada y/o
  // grupos colapsados), sin ningún filtro real de datos ni orden manual,
  // evitamos correr todo el pipeline de recarga: alcanza con sacar el
  // resaltado y volver a desplegar los grupos, tal como haría un click
  // directo sobre la flechita, sin recomputar tablas/gráficos ni romper el
  // scroll/zoom del Gantt como pasaba antes (se sentía como una recarga
  // brusca de la página).
  if (ganttFilaSeleccionada || gruposColapsados.size > 0) {
    const idProyectoSeleccionado = document.getElementById("selectorProyecto")?.value;
    const totalTareasProyecto = contarTareasNoResumen(
      tareas.filter(t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProyectoSeleccionado))
    );
    const sinFiltroDatos = contarTareasNoResumen(filtrarTareasPorEstado(tareasFiltradas)) === totalTareasProyecto;
    const sinOrdenActivo = ordenTablaGrupo.col === null && ordenTablaCriticas.col === null;
    const buscadorVacio = !document.getElementById("buscadorTareas").value.trim();

    if (sinFiltroDatos && sinOrdenActivo && buscadorVacio) {
      document.querySelectorAll('.gantt-row-seleccionada').forEach(r => r.classList.remove('gantt-row-seleccionada'));
      ganttFilaSeleccionada = false;
      if (gruposColapsados.size > 0) {
        gruposColapsados.clear();
        window._ganttSkipScroll = true;
        renderGantt(tareasFiltradas);
      }
      actualizarBotonLimpiarFiltros();
      return;
    }
  }

  document.getElementById("buscadorTareas").value = "";
  localStorage.removeItem(STORAGE_KEY);
  estadosBarrasSeleccionados = { "Tareas Atrasadas": true, "Tareas No Atrasadas": true };
  ordenTablaGrupo    = { col: null, dir: "asc" };
  ordenTablaCriticas = { col: null, dir: "asc" };

  const btnLimpiar = document.getElementById("btnLimpiarFiltros");
  const listaSugerencias = document.getElementById("listaSugerencias");
  if (btnLimpiar) btnLimpiar.classList.remove("visible");
  if (listaSugerencias) listaSugerencias.style.display = "none";

  // Buscadores clonados de Gantt/Línea en pantalla completa: si alguno
  // quedó con texto o con los selectores de Proyecto/Grupo bloqueados
  // (búsqueda hecha desde ahí), "Limpiar filtros" tiene que soltarlos
  // también — no solo los controles principales.
  ["gsBuscadorTareas", "fsBuscadorTareas"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["gsBtnLimpiar", "fsBtnLimpiar"].forEach(id => {
    document.getElementById(id)?.classList.remove("visible");
  });
  ["gsSugerencias", "fsSugerencias"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  function habilitarPar(selProy, selGrupo) {
    if (!selProy || !selGrupo) return;
    selProy.disabled = false;
    selProy.closest('.filtroBox')?.classList.remove('filtro-bloqueado');
    selGrupo.closest('.filtroBox')?.classList.remove('filtro-bloqueado');
    Array.from(selGrupo.options).forEach(opt => { opt.disabled = false; });
  }

  const selectorProyecto    = document.getElementById("selectorProyecto");
  const selectorGrupo       = document.getElementById("selectorGrupo");
  const selectorResponsable = document.getElementById("selectorResponsable");

  habilitarPar(selectorProyecto, selectorGrupo);
  selectorGrupo.value = "Todos";
  habilitarPar(document.getElementById("gsSelectProyecto"), document.getElementById("gsSelectGrupo"));
  habilitarPar(document.getElementById("fsSelectorProyecto"), document.getElementById("fsSelectorGrupo"));

  if (selectorResponsable) selectorResponsable.value = "Todos";

  inicializarSelectorGrupo();
  inicializarSelectorResponsable();
  sincronizarCascadaGrupoResponsable();
  const contadorEl = document.getElementById("contadorTareas");
  if (contadorEl) contadorEl.style.display = "none";
  aplicarFiltros();
  // Volcar el estado ya limpio a los clones de pantalla completa (value +
  // opciones habilitadas), por si están abiertos en este momento.
  sincronizarFiltrosGanttFs();
  sincronizarFiltrosFs();
}

function filtrarPorTareaClick(nombreTarea) {
  const buscador         = document.getElementById("buscadorTareas");
  const btnLimpiar       = document.getElementById("btnLimpiarFiltros");
  const selectorProyecto = document.getElementById("selectorProyecto");
  const selectorGrupo    = document.getElementById("selectorGrupo");

  if (normalizarTextoBusqueda(buscador.value) === normalizarTextoBusqueda(nombreTarea)) {
    limpiarFiltros();
    return;
  }

  buscador.value = nombreTarea;
  if (btnLimpiar) btnLimpiar.classList.add("visible");

  const idProy     = selectorProyecto.value;
  const nombreNorm = normalizarTextoBusqueda(nombreTarea);
  const tareaEncontrada = tareas.find(t =>
    limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProy) &&
    normalizarTextoBusqueda(String(t["Nombre de tarea"] || t["Nombre"] || "")) === nombreNorm
  );

  if (tareaEncontrada) {
    const grupoTarea = normalizarGrupoId(tareaEncontrada["Grupo_ID"]);
    selectorGrupo.value = grupoTarea;
    Array.from(selectorGrupo.options).forEach(opt => { opt.disabled = opt.value !== grupoTarea; });
    selectorProyecto.disabled = true;
    selectorProyecto.closest('.filtroBox')?.classList.add('filtro-bloqueado');
    selectorGrupo.closest('.filtroBox')?.classList.add('filtro-bloqueado');

    const selectorResponsable = document.getElementById("selectorResponsable");
    if (selectorResponsable) selectorResponsable.value = "Todos";
  }

  aplicarFiltros();
}

function filtrarPorGrupoClick(grupoId) {
  const selectorGrupo = document.getElementById("selectorGrupo");
  if (selectorGrupo.value === grupoId) {
    selectorGrupo.value = "Todos";
  } else {
    selectorGrupo.value = grupoId;
  }
  sincronizarCascadaGrupoResponsable();
  aplicarFiltros();
}

function configurarBuscadorAutocomplete(config) {
  const {
    buscadorId,
    sugerenciasId,
    btnLimpiarId,
    contadorId = null,
    selectorProyectoId,
    selectorGrupoId,
    usarPortal = false,
    sincronizarConPrincipal = false,
    onSincronizar = null,
    usarClickFuera = false
  } = config;

  const buscador         = document.getElementById(buscadorId);
  const listaSugerencias = document.getElementById(sugerenciasId);
  const btnLimpiar       = btnLimpiarId ? document.getElementById(btnLimpiarId) : null;
  const contador         = contadorId   ? document.getElementById(contadorId)   : null;
  const selProy          = document.getElementById(selectorProyectoId);
  const selGrupo         = document.getElementById(selectorGrupoId);
  const buscadorPrincipal = sincronizarConPrincipal ? document.getElementById("buscadorTareas") : null;

  if (!buscador || !listaSugerencias) return;

  let indiceFocusado = -1;

  if (usarPortal) document.body.appendChild(listaSugerencias);

  function posicionarDropdown() {
    if (!usarPortal) return;
    const box = buscador.closest('.buscador-box') || buscador.parentElement;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    listaSugerencias.style.top   = `${rect.bottom + 2}px`;
    listaSugerencias.style.left  = `${rect.left}px`;
    listaSugerencias.style.width = `${rect.width}px`;
  }

  function abrirDropdown() {
    posicionarDropdown();
    listaSugerencias.style.display = "block";
  }

  function cerrarDropdown() {
    listaSugerencias.style.display = "none";
    indiceFocusado = -1;
  }

  function desbloquearFiltros() {
    selProy.disabled = false;
    selProy.closest('.filtroBox')?.classList.remove('filtro-bloqueado');
    selGrupo.closest('.filtroBox')?.classList.remove('filtro-bloqueado');
    const puedeSinGrupo = haySinGrupoReal(selProy.value);
    Array.from(selGrupo.options).forEach(opt => {
      opt.disabled = opt.value === "Sin Grupo" ? !puedeSinGrupo : false;
    });
    selGrupo.value = "Todos";

    if (sincronizarConPrincipal) {
      const selProyPrin  = document.getElementById("selectorProyecto");
      const selGrupoPrin = document.getElementById("selectorGrupo");
      selProyPrin.disabled = false;
      selProyPrin.closest('.filtroBox')?.classList.remove('filtro-bloqueado');
      selGrupoPrin.closest('.filtroBox')?.classList.remove('filtro-bloqueado');
      const puedeSinGrupoPrin = haySinGrupoReal(selProyPrin.value);
      Array.from(selGrupoPrin.options).forEach(opt => {
        opt.disabled = opt.value === "Sin Grupo" ? !puedeSinGrupoPrin : false;
      });
      selGrupoPrin.value = "Todos";
    }
  }

  function seleccionarSugerencia(li) {
    const valor = li.getAttribute("data-valor");
    cerrarDropdown();
    if (contador)   contador.style.display = "none";

    // Elegir una sugerencia navega y resalta la tarea en el Gantt — igual
    // que un click directo sobre su fila en el panel izquierdo — en vez de
    // usarla como texto de filtro. Si se dejara el nombre como filtro, el
    // dashboard se angostaría a esa única tarea (efecto "zoom") y, si la
    // tarea elegida es un grupo/resumen, sus hijas quedarían filtradas
    // afuera y el Gantt se quedaría sin fechas válidas.
    buscador.value = "";
    if (buscadorPrincipal) buscadorPrincipal.value = "";
    if (btnLimpiar) btnLimpiar.classList.remove("visible");

    const idProy = selProy.value;
    const tareaEncontrada = tareas.find(t =>
      limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProy) &&
      String(t["Nombre de tarea"] || t["Nombre"] || "").trim() === valor
    );

    if (tareaEncontrada) {
      // La sugerencia ya está scopeada al proyecto/grupo activos (ver
      // filtro de "oninput" más abajo), así que alcanza con soltar el
      // filtro de Responsable si estuviera activo, para garantizar que la
      // tarea elegida no quede oculta.
      const selectorResponsable = document.getElementById("selectorResponsable");
      if (selectorResponsable) selectorResponsable.value = "Todos";

      window._ganttClaveAResaltar = claveTareaConector(tareaEncontrada["ID Proyecto"], tareaEncontrada["Id"]);
      const fechaInicioTarea = parseFechaLocal(tareaEncontrada["Comienzo"]);
      if (fechaInicioTarea) {
        window._ganttScrollToDate = fechaInicioTarea;
        window._ganttSkipScroll = true;
      }
    }

    aplicarFiltros();
    if (onSincronizar) onSincronizar();
  }

  let debounceTimeout;
  buscador.oninput = function() {
    clearTimeout(debounceTimeout);
    const valorOriginal = this.value; // Capturamos la letra recién ingresada
    
    debounceTimeout = setTimeout(() => {
      const textoBuscado  = normalizarTextoBusqueda(valorOriginal);
      indiceFocusado = -1;
      if (btnLimpiar) btnLimpiar.classList.toggle("visible", valorOriginal.length > 0);

      if (textoBuscado.length > 0) {
        const idProy      = selProy.value;
        const grupoActivo = selGrupo.value;
        const coincidencias = [...new Set(tareas
          .filter(t => {
            const mismoProyecto = limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProy);
            const mismoGrupo    = grupoActivo === "Todos" || normalizarGrupoId(t["Grupo_ID"]) === grupoActivo;
            return mismoProyecto && mismoGrupo;
          })
          .map(t => String(t["Nombre de tarea"] || t["Nombre"] || "").trim())
          .filter(n => normalizarTextoBusqueda(n).includes(textoBuscado))
        )].sort((a, b) => a.localeCompare(b, "es"));

        if (coincidencias.length > 0) {
          listaSugerencias.innerHTML = coincidencias.map(n =>
            `<li data-valor="${n}">${resaltarTexto(n, valorOriginal)}</li>`
          ).join("");
          abrirDropdown();
          if (contador) {
            const totalCoincid = tareas.filter(t =>
              limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProy) &&
              String(t["Resumen"]).trim().toLowerCase() !== "true" &&
              normalizarTextoBusqueda(String(t["Nombre de tarea"] || t["Nombre"] || "")).includes(textoBuscado)
            ).length;
            const totalProyecto = tareas.filter(t =>
              limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProy) &&
              String(t["Resumen"]).trim().toLowerCase() !== "true"
            ).length;
            contador.textContent  = `${totalCoincid} / ${totalProyecto}`;
            contador.style.display = "block";
          }
        } else {
          cerrarDropdown();
          if (contador) contador.style.display = "none";
        }
      } else {
        cerrarDropdown();
        if (contador) contador.style.display = "none";
        if (!valorOriginal) {
          if (buscadorPrincipal) buscadorPrincipal.value = "";
          aplicarFiltros();
          if (onSincronizar) onSincronizar();
        }
      }
    }, 250); // <-- Retraso de 250 milisegundos.
  };

  buscador.onkeydown = function(e) {
    const items     = listaSugerencias.querySelectorAll("li");
    const abierto   = listaSugerencias.style.display !== "none";

    if (abierto && items.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        indiceFocusado = Math.min(indiceFocusado + 1, items.length - 1);
        items.forEach((li, i) => li.classList.toggle("sugerencia-focused", i === indiceFocusado));
        items[indiceFocusado]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        indiceFocusado = Math.max(indiceFocusado - 1, 0);
        items.forEach((li, i) => li.classList.toggle("sugerencia-focused", i === indiceFocusado));
        items[indiceFocusado]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter" && indiceFocusado >= 0) {
        e.preventDefault();
        seleccionarSugerencia(items[indiceFocusado]);
        return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (buscadorPrincipal) buscadorPrincipal.value = this.value;
      cerrarDropdown();
      aplicarFiltros();
      if (onSincronizar) onSincronizar();
    }
    if (e.key === "Escape") {
      this.value = "";
      if (buscadorPrincipal) buscadorPrincipal.value = "";
      cerrarDropdown();
      aplicarFiltros();
      if (onSincronizar) onSincronizar();
    }
  };

  listaSugerencias.onclick = function(e) {
    const li = e.target.closest("li");
    if (li) seleccionarSugerencia(li);
  };

  if (btnLimpiar) {
    btnLimpiar.onclick = function() {
      buscador.value = "";
      if (buscadorPrincipal) buscadorPrincipal.value = "";
      btnLimpiar.classList.remove("visible");
      cerrarDropdown();
      if (contador) contador.style.display = "none";
      desbloquearFiltros();
      aplicarFiltros();
      if (onSincronizar) onSincronizar();
    };
    // Estado inicial del botón limpiar al entrar
    btnLimpiar.classList.toggle("visible", buscador.value.length > 0);
  }

  if (usarClickFuera) {
    document.addEventListener("click", (e) => {
      if (!buscador.contains(e.target) && !listaSugerencias.contains(e.target)) {
        cerrarDropdown();
      }
    });
  }
}

function toggleVistaComparativa() {
  const overlay = document.getElementById("vistaComparativa");
  const abriendo = overlay.style.display === "none";

  if (!abriendo) {
    overlay.style.display = "none";
    return;
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const idsProyecto = [...new Set(
    tareas.map(t => limpiarTexto(t["ID Proyecto"])).filter(v => v !== "")
  )].sort((a, b) => a.localeCompare(b, "es"));

  document.getElementById("vcBadge").textContent = `${idsProyecto.length} proyectos`;

  const filas = idsProyecto.map(idProy => {
    const tareasProyecto = tareas.filter(
      t => limpiarTexto(t["ID Proyecto"]) === limpiarTexto(idProy) &&
           String(t["Resumen"]).trim().toLowerCase() !== "true"
    );

    if (!tareasProyecto.length) return null;

    const fechasFin = tareasProyecto.map(t => parseFechaLocal(t["Fin"])).filter(f => f);
    const fechaFinCalc = fechasFin.length ? new Date(Math.max(...fechasFin.map(f => f.getTime()))) : null;
    const diasRestantes = fechaFinCalc
      ? Math.round((new Date(fechaFinCalc).setHours(0,0,0,0) - hoy.getTime()) / 86400000)
      : null;

    let sumaPonderada = 0, sumaDuraciones = 0;
    tareasProyecto.forEach(t => {
      const ini = parseFechaLocal(t["Comienzo"]);
      const fin = parseFechaLocal(t["Fin"]);
      if (!ini || !fin) return;
      const dur = Math.max(1, Math.round((fin - ini) / 86400000) + 1);
      sumaPonderada += dur * Number(t["% completado"] || 0);
      sumaDuraciones += dur;
    });
    const avance = sumaDuraciones > 0 ? sumaPonderada / sumaDuraciones : 0;

    const curva = generarCurvaSDesdeTareas(tareasProyecto);
    const desvio = obtenerDesvioHoyDesdeCurva(curva);

    const atrasadas = tareasProyecto.filter(
      t => esTareaAtrasada(t["Fin"], t["% completado"])
    ).length;

    return { idProy, avance, desvio, fechaFinCalc, diasRestantes, atrasadas };
  }).filter(Boolean);

  const tbody = document.getElementById("vcTbody");
  tbody.innerHTML = "";

  function renderFilas(lista) {
    tbody.innerHTML = lista.map(r => {
      const col = colorPorDesvio(r.desvio);
      const signo = r.desvio >= 0 ? "+" : "";
      const desvioStr = `${signo}${r.desvio.toFixed(2)}%`;
      const desvioColor = r.desvio > 0 ? "#00e890" : r.desvio < 0 ? "#ff7777" : "#aad4cc";
      const finStr = r.fechaFinCalc ? formatearFechaISO(r.fechaFinCalc) : "-";
      const diasStr = r.diasRestantes !== null ? `${r.diasRestantes}d` : "-";
      const diasColor = r.diasRestantes !== null && r.diasRestantes < 0 ? "#EF4444"
        : r.diasRestantes !== null && r.diasRestantes <= 14 ? "#f59e0b"
        : "rgba(200,220,215,0.7)";
      const avancePct = Math.min(Math.max(r.avance, 0), 100);

      return `
        <tr>
          <td><span class="vc-id-pill" style="color:#f4f9ff;">${r.idProy}</span></td>
          <td class="centro">
            <span class="vc-semaforo" style="background:rgba(${col.rgb},0.15);border:1px solid ${col.borde};color:${col.texto};">
              ${col.label}
            </span>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:7px;">
              <div class="vc-barra-fondo">
                <div class="vc-barra-prog" style="width:${avancePct}%;background:linear-gradient(90deg,${col.ini},${col.fin});"></div>
              </div>
              <span style="font-size:11px;font-weight:700;color:#f4f9ff;min-width:32px;">${avancePct.toFixed(1)}%</span>
            </div>
          </td>
          <td style="text-align:right;padding-right:1.5vw;color:${desvioColor};font-weight:700;">${desvioStr}</td>
          <td class="centro" style="color:#f4f9ff;">${finStr}</td>
          <td style="text-align:right;padding-right:1.5vw;color:#f4f9ff;font-weight:700;">${diasStr}</td>
          <td style="text-align:right;padding-right:1.5vw;color:${r.atrasadas > 0 ? '#EF4444' : 'rgba(200,220,215,0.5)'};font-weight:700;">${r.atrasadas}</td>
          <td class="centro">
            <span class="vc-btn-detalle" onclick="irAProyecto('${r.idProy}')">Ver →</span>
          </td>
        </tr>`;
    }).join("");
  }

  renderFilas(filas);

  // Ordenamiento por columna
  let vcDirActual = {};
  document.querySelectorAll(".vc-th-sort").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      const dir = vcDirActual[col] === "asc" ? "desc" : "asc";
      vcDirActual = {};
      vcDirActual[col] = dir;

      document.querySelectorAll(".vc-th-sort").forEach(t => {
        t.querySelector(".sort-icon").textContent = "▲";
        t.style.color = "";
      });
      th.querySelector(".sort-icon").textContent = dir === "asc" ? "▲" : "▼";
      th.style.color = "#00B095";

      const sorted = [...filas].sort((a, b) => {
        let va, vb;
        if (col === "id")        { va = a.idProy;         vb = b.idProy; return dir === "asc" ? va.localeCompare(vb, "es") : vb.localeCompare(va, "es"); }
        if (col === "avance")    { va = a.avance;         vb = b.avance; }
        if (col === "desvio")    { va = a.desvio;         vb = b.desvio; }
        if (col === "dias")      { va = a.diasRestantes ?? Infinity; vb = b.diasRestantes ?? Infinity; }
        if (col === "atrasadas") { va = a.atrasadas;      vb = b.atrasadas; }
        if (col === "semaforo")  { va = a.desvio;         vb = b.desvio; }
        if (col === "fin")       { va = a.fechaFinCalc?.getTime() ?? Infinity; vb = b.fechaFinCalc?.getTime() ?? Infinity; }
        return dir === "asc" ? va - vb : vb - va;
      });

      renderFilas(sorted);
    });
  });

  overlay.style.display = "flex";
}

function irAProyecto(idProy) {
  const selector = document.getElementById("selectorProyecto");
  if (!selector) return;
  selector.value = idProy;
  inicializarSelectorGrupo();
  inicializarSelectorResponsable();
  sincronizarCascadaGrupoResponsable();
  aplicarFiltros();
  document.getElementById("vistaComparativa").style.display = "none";
}

function avanzarGrupoPresentacion() {
  const selectorGrupo = document.getElementById("selectorGrupo");
  if (!selectorGrupo || !selectorGrupo.options.length) return;

  presentacionIndice++;

  if (presentacionIndice >= selectorGrupo.options.length) {
    avanzarProyectoPresentacion();
    return;
  }

  selectorGrupo.value = selectorGrupo.options[presentacionIndice].value;
  aplicarFiltros();
}

function avanzarProyectoPresentacion() {
  const selectorProyecto = document.getElementById("selectorProyecto");
  if (!selectorProyecto || !selectorProyecto.options.length) return;

  presentacionIndiceProyecto = (presentacionIndiceProyecto + 1) % selectorProyecto.options.length;
  selectorProyecto.value = selectorProyecto.options[presentacionIndiceProyecto].value;

  inicializarSelectorGrupo();
  inicializarSelectorResponsable();
  presentacionIndice = 0;

  const selectorGrupo = document.getElementById("selectorGrupo");
  if (selectorGrupo && selectorGrupo.options.length) {
    selectorGrupo.value = selectorGrupo.options[0].value;
  }

  sincronizarCascadaGrupoResponsable();
  aplicarFiltros();
}

function detenerPresentacion() {
  if (presentacionTimer) {
    clearInterval(presentacionTimer);
    presentacionTimer = null;
  }
  presentacionActiva = false;
  const btn = document.getElementById("btnPresentacion");
  if (btn) btn.classList.remove("presentacion-activa");
}

function togglePresentacion() {
  if (presentacionActiva) {
    detenerPresentacion();
    return;
  }

  const selectorGrupo = document.getElementById("selectorGrupo");
  if (!selectorGrupo || selectorGrupo.options.length <= 1) {
    mostrarToast("Este proyecto no tiene grupos para rotar", "error");
    return;
  }

  const selectorProyecto = document.getElementById("selectorProyecto");
  if (selectorProyecto) {
    presentacionIndiceProyecto = Array.from(selectorProyecto.options)
      .findIndex(opt => opt.value === selectorProyecto.value);
    if (presentacionIndiceProyecto < 0) presentacionIndiceProyecto = 0;
  }

  presentacionActiva = true;
  presentacionIndice = 0;
  selectorGrupo.value = selectorGrupo.options[0].value;
  aplicarFiltros();

  const btn = document.getElementById("btnPresentacion");
  if (btn) btn.classList.add("presentacion-activa");

  presentacionTimer = setTimeout(function iniciarCiclo() {
    avanzarGrupoPresentacion();
    presentacionTimer = setInterval(avanzarGrupoPresentacion, PRESENTACION_INTERVALO_MS);
  }, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  const boton = document.getElementById("btnActualizar");
  if (boton) boton.addEventListener("click", actualizarDatos);

  // Título del header como selector de proyecto
  const tituloTrigger = document.getElementById("tituloTrigger");
  const tituloMenu = document.getElementById("tituloMenu");
  const selectorProyectoOculto = document.getElementById("selectorProyecto");
  if (tituloTrigger && tituloMenu) {
    tituloTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenuTituloProyecto();
    });
    tituloMenu.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-proyecto]");
      if (li) seleccionarProyectoDesdeTitulo(li.dataset.proyecto);
    });
    document.addEventListener("click", (e) => {
      if (!tituloMenu.hidden && !e.target.closest("h1")) cerrarMenuTituloProyecto();
    });
    tituloTrigger.addEventListener("keydown", (e) => {
      if (tituloMenu.hidden) {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
          e.preventDefault();
          abrirMenuTituloProyecto();
        }
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); moverResaltadoTitulo(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moverResaltadoTitulo(-1); }
      else if (e.key === "Home") { e.preventDefault(); resaltarItemTitulo(0); }
      else if (e.key === "End") { e.preventDefault(); resaltarItemTitulo(tituloMenu.children.length - 1); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegirResaltadoTitulo(); }
      else if (e.key === "Escape") { e.preventDefault(); cerrarMenuTituloProyecto(); }
      else if (e.key === "Tab") { cerrarMenuTituloProyecto(); }
    });
    if (selectorProyectoOculto) {
      const sincronizarBloqueoTitulo = () => { tituloTrigger.disabled = selectorProyectoOculto.disabled; };
      sincronizarBloqueoTitulo();
      new MutationObserver(sincronizarBloqueoTitulo)
        .observe(selectorProyectoOculto, { attributes: true, attributeFilter: ["disabled"] });
    }
  }

  [
    "selectorGrupo", "selectorResponsable",
    "gsSelectProyecto", "gsSelectGrupo", "gsSelectResponsable",
    "fsSelectorProyecto", "fsSelectorGrupo", "fsSelectorResponsable",
  ].forEach(id => crearSelectorEstilizado(document.getElementById(id)));

  registroCerrarMenusEstilizados.push(cerrarMenuTituloProyecto);

  const buscador = document.getElementById("buscadorTareas");
  const btnLimpiar = document.getElementById("btnLimpiarFiltros");
  const listaSugerencias = document.getElementById("listaSugerencias");

  buscador.addEventListener("input", () => {
    if (presentacionActiva) detenerPresentacion();
  });

  [
    ["comentarioAutorInput", "errorComentarioAutor"],
    ["comentarioTextoInput", "errorComentarioTexto"],
  ].forEach(([id, errorId]) => {
    const el = document.getElementById(id);
    const errorEl = document.getElementById(errorId);
    if (!el) return;
    el.addEventListener("input", () => {
      if (!el.value.trim()) return;
      el.classList.remove("campo-comentario-invalido");
      if (errorEl) errorEl.textContent = "";
    });
  });

  // Buscador de "Asignar a": filtra en vivo, agrega con click/Enter y
  // permite elegir a más de una persona (queda como chips arriba del input).
  const inputAsignado = document.getElementById("comentarioAsignadoInput");
  const dropdownAsignado = document.getElementById("comentarioAsignadoDropdown");
  const boxAsignado = document.getElementById("comentarioAsignadoBox");
  if (inputAsignado && dropdownAsignado && boxAsignado) {
    document.body.appendChild(dropdownAsignado);

    inputAsignado.addEventListener("focus", () => renderDropdownAsignados(inputAsignado.value));
    inputAsignado.addEventListener("input", () => renderDropdownAsignados(inputAsignado.value));

    inputAsignado.addEventListener("keydown", (e) => {
      const items = dropdownAsignado.querySelectorAll("li");
      const abierto = dropdownAsignado.style.display !== "none";
      if (!abierto || !items.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        indiceFocusadoAsignado = Math.min(indiceFocusadoAsignado + 1, items.length - 1);
        items.forEach((li, i) => li.classList.toggle("sugerencia-focused", i === indiceFocusadoAsignado));
        items[indiceFocusadoAsignado]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        indiceFocusadoAsignado = Math.max(indiceFocusadoAsignado - 1, 0);
        items.forEach((li, i) => li.classList.toggle("sugerencia-focused", i === indiceFocusadoAsignado));
        items[indiceFocusadoAsignado]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && indiceFocusadoAsignado >= 0) {
        e.preventDefault();
        const li = items[indiceFocusadoAsignado];
        agregarAsignado(li.dataset.nombre, li.dataset.email);
      }
    });

    dropdownAsignado.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-email]");
      if (!li) return;
      e.stopPropagation();
      agregarAsignado(li.dataset.nombre, li.dataset.email);
    });

    document.getElementById("comentarioAsignadoChips").addEventListener("click", (e) => {
      const btn = e.target.closest(".comentario-chip-quitar");
      if (!btn) return;
      quitarAsignado(btn.dataset.email);
    });

    window.addEventListener("resize", () => {
      if (dropdownAsignado.style.display === "block") posicionarDropdownAsignados();
    });

    document.addEventListener("click", (e) => {
      if (boxAsignado.contains(e.target) || dropdownAsignado.contains(e.target)) return;
      dropdownAsignado.style.display = "none";
    });
  }

  // Portal: mover el dropdown al body para escapar cualquier stacking context

  configurarBuscadorAutocomplete({
    buscadorId:          "buscadorTareas",
    sugerenciasId:       "listaSugerencias",
    btnLimpiarId:        "btnLimpiarFiltros",
    contadorId:          "contadorTareas",
    selectorProyectoId:  "selectorProyecto",
    selectorGrupoId:     "selectorGrupo",
    usarPortal:          true,
    usarClickFuera:      true
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const panelGantt = document.querySelector('.panel-linea-real');
    const panelLinea = document.querySelector('.panel-linea-comparacion');
    if (panelGantt && panelGantt.classList.contains('gantt-fullscreen')) toggleFullscreenGantt();
    if (panelLinea && panelLinea.classList.contains('linea-comparacion-fullscreen')) toggleFullscreenLineaComparacion();
    const vc = document.getElementById('vistaComparativa');
    if (vc && vc.style.display !== 'none') vc.style.display = 'none';
    cerrarPanelComentarios();
  });

  const splash = document.getElementById("splashScreen");
  const yaMostrado = sessionStorage.getItem("splashMostrado");

  function iniciarSplash() {
    if (!splash) return;
    sessionStorage.setItem("splashMostrado", "true");

    const logo = document.getElementById("splashLogo");
    splash.style.animation = "none";
    if (logo) logo.style.animation = "none";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        splash.style.animation = "";
        if (logo) logo.style.animation = "";
      });
    });

    setTimeout(() => { splash.classList.add("oculto"); }, 3500);
  }

  if (yaMostrado) {
    if (splash) splash.classList.add("oculto");
  } else if (document.visibilityState === "visible") {
    iniciarSplash();
  } else {
    document.addEventListener("visibilitychange", function handler() {
      if (document.visibilityState === "visible") {
        document.removeEventListener("visibilitychange", handler);
        iniciarSplash();
      }
    });
  }

  
  // ── Tooltip universal para íconos SVG ──
  tipIcono = document.createElement('div');
  tipIcono.style.cssText = `
    position: fixed; pointer-events: none; z-index: 999999;
    background: rgba(15,15,15,0.95); color: #fff;
    font-size: 13px; font-family: 'DM Sans', Inter, sans-serif;
    padding: 5px 10px; border-radius: 6px;
    border: 1px solid rgba(25,127,102,0.5);
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    display: none; white-space: nowrap;
  `;
  document.body.appendChild(tipIcono);

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('svg[title], [data-tooltip]');
    if (!el) return;
    tipIcono.textContent = el.getAttribute('title') || el.getAttribute('data-tooltip');
    tipIcono.style.display = 'block';
  });

  document.addEventListener('mousemove', (e) => {
    if (tipIcono.style.display === 'none') return;

    // Medimos el tamaño real del tooltip para saber si entra a la derecha/abajo del cursor
    const anchoTip = tipIcono.offsetWidth || 0;
    const altoTip = tipIcono.offsetHeight || 0;
    const margenSeguridad = 20;

    const cabeDerecha = (e.clientX + 14 + anchoTip + margenSeguridad) <= window.innerWidth;
    const cabeAbajo = (e.clientY + 14 + altoTip + margenSeguridad) <= window.innerHeight;

    if (cabeDerecha) {
      tipIcono.style.left = `${e.clientX + 14}px`;
    } else {
      tipIcono.style.left = `${e.clientX - anchoTip - 14}px`;
    }

    if (cabeAbajo) {
      tipIcono.style.top = `${e.clientY + 14}px`;
    } else {
      tipIcono.style.top = `${e.clientY - altoTip - 14}px`;
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('svg[title], [data-tooltip]')) tipIcono.style.display = 'none';
  });

  cargarDashboard();
});



