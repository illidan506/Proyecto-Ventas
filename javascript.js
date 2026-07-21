/* ============================================================
   RAMY MOTORS — Sistema de Gestión
   Almacenamiento: localStorage (sin servidor / sin base de datos)
   ============================================================ */

const EMPRESA = {
    nombre: "RAMY MOTORS",
    direccion: "Av. Principal",
    telefono: "63079445",
    whatsapp: "59163079445" // 591 = Bolivia + número
};

const STOCK_BAJO_LIMITE = 5;

const LS_KEYS = {
    productos: "rm_productos",
    ventas: "rm_ventas",
    ventaNum: "rm_venta_num"
};

/* ================= ESTADO ================= */
let productos = [];
let ventas = [];
let siguienteNumeroVenta = 1;
let carrito = []; // [{codigo, nombre, marca, precio, cantidad, subtotal}]
let productoSeleccionadoVenta = null;
let ultimaVentaGenerada = null;

/* ================= PERSISTENCIA ================= */
function cargarDatos() {
    productos = JSON.parse(localStorage.getItem(LS_KEYS.productos) || "[]");
    ventas = JSON.parse(localStorage.getItem(LS_KEYS.ventas) || "[]");
    siguienteNumeroVenta = parseInt(localStorage.getItem(LS_KEYS.ventaNum) || "1", 10);
}

function guardarProductos() {
    localStorage.setItem(LS_KEYS.productos, JSON.stringify(productos));
}

function guardarVentas() {
    localStorage.setItem(LS_KEYS.ventas, JSON.stringify(ventas));
}

function guardarNumeroVenta() {
    localStorage.setItem(LS_KEYS.ventaNum, String(siguienteNumeroVenta));
}

/* ================= UTILIDADES ================= */
function formatoMoneda(n) {
    return "Bs " + Number(n).toFixed(2);
}

function formatoFecha(iso) {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

const NOMBRES_MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function claveMes(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nombreMes(claveMesStr) {
    const [y, m] = claveMesStr.split("-");
    return `${NOMBRES_MES[parseInt(m, 10) - 1]} ${y}`;
}

function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ================= NAVEGACIÓN ================= */
function irAVista(nombre) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + nombre).classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === nombre));

    if (nombre === "inicio") renderInicio();
    if (nombre === "inventario") renderInventario();
    if (nombre === "ventas") renderVentaActual();
    if (nombre === "historial") renderHistorial();
}

document.querySelectorAll("[data-nav]").forEach(el => {
    el.addEventListener("click", () => irAVista(el.dataset.nav));
});

/* ================= MODALES ================= */
function abrirModal(id) {
    document.getElementById(id).classList.remove("hidden");
}
function cerrarModal(id) {
    document.getElementById(id).classList.add("hidden");
}
document.querySelectorAll("[data-close]").forEach(el => {
    el.addEventListener("click", () => cerrarModal(el.dataset.close));
});

/* ================= INVENTARIO: CRUD ================= */
function buscarPorCodigo(codigo) {
    return productos.find(p => p.codigo.toLowerCase() === codigo.toLowerCase());
}

function agregarOEditarProducto(datos, codigoOriginal) {
    if (codigoOriginal) {
        // edición
        const idx = productos.findIndex(p => p.codigo.toLowerCase() === codigoOriginal.toLowerCase());
        if (idx === -1) return { ok: false, msg: "Producto no encontrado." };

        // si cambiaron el código, verificar que el nuevo no exista ya (en otro producto)
        if (datos.codigo.toLowerCase() !== codigoOriginal.toLowerCase() && buscarPorCodigo(datos.codigo)) {
            return { ok: false, msg: "Ya existe un producto con ese código." };
        }
        productos[idx] = datos;
    } else {
        if (buscarPorCodigo(datos.codigo)) {
            return { ok: false, msg: "Ya existe un producto con ese código." };
        }
        productos.push(datos);
    }
    guardarProductos();
    return { ok: true };
}

function eliminarProducto(codigo) {
    const idx = productos.findIndex(p => p.codigo.toLowerCase() === codigo.toLowerCase());
    if (idx === -1) return false;
    productos.splice(idx, 1);
    guardarProductos();
    return true;
}

/* ---- búsqueda general (código / nombre / marca) ---- */
function buscarGeneral(texto) {
    const q = texto.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter(p =>
        p.codigo.toLowerCase().includes(q) ||
        p.nombre.toLowerCase().includes(q) ||
        p.marca.toLowerCase().includes(q)
    );
}

/* ---- búsqueda por motor / compatibilidad ----
   El campo "compatibilidad" guarda motores separados por coma.
   Se busca el motor ingresado y se listan los productos donde aparece. */
function buscarPorMotor(texto) {
    const q = texto.trim().toLowerCase();
    if (!q) return [];
    return productos.filter(p => {
        const motores = (p.compatibilidad || "").split(",").map(m => m.trim().toLowerCase());
        return motores.some(m => m.includes(q));
    });
}

/* ================= RENDER: INVENTARIO ================= */
let modoBusqueda = "general";

document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        modoBusqueda = btn.dataset.searchmode;
        document.getElementById("searchGeneral").classList.toggle("hidden", modoBusqueda !== "general");
        document.getElementById("searchMotor").classList.toggle("hidden", modoBusqueda !== "motor");
        renderInventario();
    });
});

document.getElementById("inputBuscarGeneral").addEventListener("input", renderInventario);
document.getElementById("inputBuscarMotor").addEventListener("input", renderInventario);

function renderInventario() {
    const cont = document.getElementById("listaInventario");
    let lista;

    if (modoBusqueda === "motor") {
        const q = document.getElementById("inputBuscarMotor").value;
        lista = q.trim() ? buscarPorMotor(q) : [];
        if (!q.trim()) {
            cont.innerHTML = `<p class="empty-msg">Escribe el nombre de un motor para ver los productos compatibles.</p>`;
            return;
        }
    } else {
        const q = document.getElementById("inputBuscarGeneral").value;
        lista = buscarGeneral(q);
    }

    if (lista.length === 0) {
        cont.innerHTML = `<p class="empty-msg">No se encontraron productos.</p>`;
        return;
    }

    cont.innerHTML = lista.map(p => tarjetaProducto(p)).join("");

    cont.querySelectorAll(".product-card").forEach(card => {
        const codigo = card.dataset.codigo;
        card.querySelector(".product-card-top").addEventListener("click", () => {
            card.querySelector(".product-details").classList.toggle("open");
        });
        const btnEdit = card.querySelector(".btn-editar");
        const btnDel = card.querySelector(".btn-eliminar");
        if (btnEdit) btnEdit.addEventListener("click", (e) => { e.stopPropagation(); abrirFormularioEdicion(codigo); });
        if (btnDel) btnDel.addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`¿Eliminar el producto "${codigo}"? Esta acción no se puede deshacer.`)) {
                eliminarProducto(codigo);
                toast("Producto eliminado");
                renderInventario();
                renderInicio();
            }
        });
    });
}

function tarjetaProducto(p) {
    const bajo = p.cantidad <= STOCK_BAJO_LIMITE;
    return `
  <div class="product-card" data-codigo="${escapeHtml(p.codigo)}">
    <div class="product-card-top">
      <div>
        <div class="product-name">${escapeHtml(p.nombre)}</div>
        <div class="product-meta">${escapeHtml(p.codigo)} · ${escapeHtml(p.marca)} · ${escapeHtml(p.categoria)}</div>
        <span class="product-stock ${bajo ? "low" : ""}">Stock: ${p.cantidad}</span>
      </div>
      <div class="product-price">${formatoMoneda(p.precio)}</div>
    </div>
    <div class="product-details">
      <p><b>Compatibilidad:</b> ${escapeHtml(p.compatibilidad || "—")}</p>
      <p><b>Cilindrada:</b> ${escapeHtml(p.cilindrada || "—")}</p>
      <p><b>Detalles:</b> ${escapeHtml(p.detalles || "—")}</p>
      <div class="card-actions">
        <button class="btn btn-outline btn-sm btn-editar">Editar</button>
        <button class="btn btn-danger btn-sm btn-eliminar">Eliminar</button>
      </div>
    </div>
  </div>`;
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

/* ---- formulario nuevo / editar producto ---- */
document.getElementById("btnAbrirNuevoProducto").addEventListener("click", () => {
    document.getElementById("modalProductoTitulo").textContent = "Nuevo Producto";
    document.getElementById("formProducto").reset();
    document.getElementById("fCodigoOriginal").value = "";
    document.getElementById("fCodigo").disabled = false;
    abrirModal("modalProducto");
});

function abrirFormularioEdicion(codigo) {
    const p = buscarPorCodigo(codigo);
    if (!p) return;
    document.getElementById("modalProductoTitulo").textContent = "Editar Producto";
    document.getElementById("fCodigoOriginal").value = p.codigo;
    document.getElementById("fCodigo").value = p.codigo;
    document.getElementById("fNombre").value = p.nombre;
    document.getElementById("fMarca").value = p.marca;
    document.getElementById("fCategoria").value = p.categoria;
    document.getElementById("fCompatibilidad").value = p.compatibilidad;
    document.getElementById("fCilindrada").value = p.cilindrada || "";
    document.getElementById("fDetalles").value = p.detalles || "";
    document.getElementById("fCantidad").value = p.cantidad;
    document.getElementById("fPrecio").value = p.precio;
    abrirModal("modalProducto");
}

document.getElementById("formProducto").addEventListener("submit", (e) => {
    e.preventDefault();

    const datos = {
        codigo: document.getElementById("fCodigo").value.trim(),
        nombre: document.getElementById("fNombre").value.trim(),
        marca: document.getElementById("fMarca").value.trim(),
        categoria: document.getElementById("fCategoria").value.trim(),
        compatibilidad: document.getElementById("fCompatibilidad").value.trim(),
        cilindrada: document.getElementById("fCilindrada").value.trim(),
        detalles: document.getElementById("fDetalles").value.trim(),
        cantidad: parseInt(document.getElementById("fCantidad").value, 10),
        precio: parseFloat(document.getElementById("fPrecio").value)
    };

    if (!datos.codigo || !datos.nombre || isNaN(datos.cantidad) || isNaN(datos.precio)) {
        toast("Revisa los datos ingresados");
        return;
    }

    const codigoOriginal = document.getElementById("fCodigoOriginal").value;
    const resultado = agregarOEditarProducto(datos, codigoOriginal || null);

    if (!resultado.ok) {
        toast(resultado.msg);
        return;
    }

    cerrarModal("modalProducto");
    toast(codigoOriginal ? "Producto actualizado" : "Producto agregado");
    renderInventario();
    renderInicio();
});

/* ================= VENTAS ================= */
function actualizarNumeroVentaLabel() {
    document.getElementById("ventaNumeroLabel").textContent = "N° " + siguienteNumeroVenta;
}

function renderVentaActual() {
    actualizarNumeroVentaLabel();
    const cont = document.getElementById("carritoLista");

    if (carrito.length === 0) {
        cont.innerHTML = `<p class="empty-msg">El carrito está vacío. Agrega productos para iniciar la venta.</p>`;
    } else {
        cont.innerHTML = carrito.map((item, i) => `
      <div class="carrito-item">
        <div class="ci-info">
          <div class="ci-nombre">${escapeHtml(item.nombre)}</div>
          <div class="ci-sub">${escapeHtml(item.codigo)} · ${item.cantidad} x ${formatoMoneda(item.precio)}</div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="ci-sub-total">${formatoMoneda(item.subtotal)}</div>
          <button data-idx="${i}" class="btn-quitar-item" title="Quitar">✕</button>
        </div>
      </div>`).join("");

        cont.querySelectorAll(".btn-quitar-item").forEach(btn => {
            btn.addEventListener("click", () => {
                carrito.splice(parseInt(btn.dataset.idx, 10), 1);
                renderVentaActual();
            });
        });
    }

    const total = carrito.reduce((acc, i) => acc + i.subtotal, 0);
    document.getElementById("carritoTotal").textContent = formatoMoneda(total);
}

/* ---- modal agregar producto a la venta ---- */
document.getElementById("btnAgregarAlCarrito").addEventListener("click", () => {
    document.getElementById("inputBuscarVenta").value = "";
    document.getElementById("cantidadPanel").classList.add("hidden");
    productoSeleccionadoVenta = null;
    renderResultadosVenta("");
    abrirModal("modalAgregarVenta");
    setTimeout(() => document.getElementById("inputBuscarVenta").focus(), 150);
});

document.getElementById("inputBuscarVenta").addEventListener("input", (e) => {
    renderResultadosVenta(e.target.value);
});

function renderResultadosVenta(texto) {
    const cont = document.getElementById("resultadosVenta");
    const lista = buscarGeneral(texto).filter(p => p.cantidad > 0);

    if (lista.length === 0) {
        cont.innerHTML = `<p class="empty-msg">Sin resultados o sin stock disponible.</p>`;
        return;
    }

    cont.innerHTML = lista.map(p => `
    <div class="product-card" data-codigo="${escapeHtml(p.codigo)}">
      <div class="product-card-top">
        <div>
          <div class="product-name">${escapeHtml(p.nombre)}</div>
          <div class="product-meta">${escapeHtml(p.codigo)} · Stock: ${p.cantidad}</div>
        </div>
        <div class="product-price">${formatoMoneda(p.precio)}</div>
      </div>
    </div>`).join("");

    cont.querySelectorAll(".product-card").forEach(card => {
        card.addEventListener("click", () => seleccionarProductoVenta(card.dataset.codigo));
    });
}

function seleccionarProductoVenta(codigo) {
    const p = buscarPorCodigo(codigo);
    if (!p) return;
    productoSeleccionadoVenta = p;

    const yaEnCarrito = carrito.find(i => i.codigo === p.codigo);
    const disponible = p.cantidad - (yaEnCarrito ? yaEnCarrito.cantidad : 0);

    document.getElementById("productoSeleccionadoNombre").textContent =
        `${p.nombre} — Disponible: ${Math.max(disponible, 0)}`;
    document.getElementById("cantidadVenta").value = disponible > 0 ? 1 : 0;
    document.getElementById("cantidadVenta").max = Math.max(disponible, 0);
    document.getElementById("cantidadPanel").classList.remove("hidden");
}

document.getElementById("btnMenos").addEventListener("click", () => {
    const input = document.getElementById("cantidadVenta");
    input.value = Math.max(1, parseInt(input.value || "1", 10) - 1);
});
document.getElementById("btnMas").addEventListener("click", () => {
    const input = document.getElementById("cantidadVenta");
    const max = parseInt(input.max || "0", 10);
    input.value = Math.min(max, parseInt(input.value || "1", 10) + 1);
});

document.getElementById("btnConfirmarAgregar").addEventListener("click", () => {
    if (!productoSeleccionadoVenta) return;
    const cantidad = parseInt(document.getElementById("cantidadVenta").value, 10);

    if (!cantidad || cantidad <= 0) { toast("Cantidad inválida"); return; }
    if (cantidad > productoSeleccionadoVenta.cantidad) { toast("Stock insuficiente"); return; }

    const existente = carrito.find(i => i.codigo === productoSeleccionadoVenta.codigo);
    if (existente) {
        if (existente.cantidad + cantidad > productoSeleccionadoVenta.cantidad) {
            toast("Stock insuficiente");
            return;
        }
        existente.cantidad += cantidad;
        existente.subtotal = existente.cantidad * existente.precio;
    } else {
        carrito.push({
            codigo: productoSeleccionadoVenta.codigo,
            nombre: productoSeleccionadoVenta.nombre,
            marca: productoSeleccionadoVenta.marca,
            precio: productoSeleccionadoVenta.precio,
            cantidad: cantidad,
            subtotal: cantidad * productoSeleccionadoVenta.precio
        });
    }

    cerrarModal("modalAgregarVenta");
    renderVentaActual();
    toast("Producto agregado al carrito");
});

/* ---- confirmar venta ---- */
document.getElementById("btnConfirmarVenta").addEventListener("click", () => {
    if (carrito.length === 0) {
        toast("No hay productos en la venta");
        return;
    }

    // validar y descontar stock
    for (const item of carrito) {
        const p = buscarPorCodigo(item.codigo);
        if (!p || p.cantidad < item.cantidad) {
            toast(`Stock insuficiente para ${item.nombre}`);
            return;
        }
    }
    carrito.forEach(item => {
        const p = buscarPorCodigo(item.codigo);
        p.cantidad -= item.cantidad;
    });
    guardarProductos();

    const total = carrito.reduce((acc, i) => acc + i.subtotal, 0);
    const venta = {
        numero: siguienteNumeroVenta,
        fecha: new Date().toISOString(),
        detalles: carrito.map(i => ({ ...i })),
        total: total
    };

    ventas.push(venta);
    guardarVentas();

    siguienteNumeroVenta += 1;
    guardarNumeroVenta();

    ultimaVentaGenerada = venta;
    mostrarFactura(venta);

    carrito = [];
    renderVentaActual();
    renderInicio();
});

/* ================= FACTURA ================= */
function textoFactura(venta) {
    let t = "";
    t += "====================================\n";
    t += `        ${EMPRESA.nombre}\n`;
    t += "====================================\n";
    t += `Direccion: ${EMPRESA.direccion}\n`;
    t += `Telefono : ${EMPRESA.telefono}\n`;
    t += "====================================\n";
    t += `FACTURA N°: ${venta.numero}\n`;
    t += `FECHA     : ${formatoFecha(venta.fecha)}\n`;
    t += "====================================\n";
    t += "DETALLE DE PRODUCTOS\n";
    t += "====================================\n";

    venta.detalles.forEach(d => {
        t += `Codigo: ${d.codigo}\n`;
        t += `Producto: ${d.nombre}\n`;
        t += `Cantidad: ${d.cantidad}\n`;
        t += `Precio U.: ${formatoMoneda(d.precio)}\n`;
        t += `Subtotal: ${formatoMoneda(d.subtotal)}\n`;
        t += "------------------------------------\n";
    });

    t += `TOTAL A PAGAR: ${formatoMoneda(venta.total)}\n`;
    t += "====================================\n";
    t += "Gracias por confiar en nosotros\n";
    t += "Vuelva pronto\n";
    t += "====================================\n";
    return t;
}

function mostrarFactura(venta) {
    document.getElementById("ticketContenido").textContent = textoFactura(venta);
    abrirModal("modalFactura");
}

document.getElementById("btnEnviarWhatsapp").addEventListener("click", () => {
    if (!ultimaVentaGenerada) return;
    const texto = encodeURIComponent(textoFactura(ultimaVentaGenerada));
    const url = `https://wa.me/${EMPRESA.whatsapp}?text=${texto}`;
    window.open(url, "_blank");
});

/* ================= HISTORIAL ================= */
function renderHistorial() {
    const select = document.getElementById("selectMes");
    const meses = [...new Set(ventas.map(v => claveMes(v.fecha)))].sort().reverse();

    const seleccionActual = select.value;
    select.innerHTML = `<option value="todos">Todos los meses</option>` +
        meses.map(m => `<option value="${m}">${nombreMes(m)}</option>`).join("");
    if (meses.includes(seleccionActual)) select.value = seleccionActual;

    pintarHistorial();
}

document.getElementById("selectMes").addEventListener("change", pintarHistorial);

function ventasFiltradas() {
    const filtro = document.getElementById("selectMes").value;
    if (!filtro || filtro === "todos") return [...ventas].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    return ventas.filter(v => claveMes(v.fecha) === filtro).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function pintarHistorial() {
    const lista = ventasFiltradas();
    const cont = document.getElementById("listaHistorial");
    const resumen = document.getElementById("resumenMes");

    const totalMonto = lista.reduce((acc, v) => acc + v.total, 0);
    resumen.innerHTML = `<span>${lista.length} venta(s)</span><b>${formatoMoneda(totalMonto)}</b>`;

    if (lista.length === 0) {
        cont.innerHTML = `<p class="empty-msg">No existen ventas registradas.</p>`;
        return;
    }

    cont.innerHTML = lista.map(v => `
    <div class="venta-card" data-num="${v.numero}">
      <div class="venta-card-top">
        <span class="vn">VENTA N° ${v.numero}</span>
        <span class="vt">${formatoMoneda(v.total)}</span>
      </div>
      <div class="venta-fecha">${formatoFecha(v.fecha)}</div>
      <div class="venta-detalle">
        ${v.detalles.map(d => `
          <div class="vd-row"><span>${escapeHtml(d.nombre)} (x${d.cantidad})</span><span>${formatoMoneda(d.subtotal)}</span></div>
        `).join("")}
      </div>
    </div>`).join("");

    cont.querySelectorAll(".venta-card").forEach(card => {
        card.addEventListener("click", (e) => {
            card.querySelector(".venta-detalle").classList.toggle("open");
        });
    });
}

/* ---- exportar a Excel (agrupado por mes) ---- */
document.getElementById("btnExportarExcel").addEventListener("click", () => {
    if (ventas.length === 0) {
        toast("No hay ventas para exportar");
        return;
    }

    if (typeof XLSX === "undefined") {
        toast("Sin conexión: no se pudo cargar el módulo de Excel");
        return;
    }

    try {
        exportarExcel();
    } catch (err) {
        console.error(err);
        toast("No se pudo generar el Excel. Intenta de nuevo.");
    }
});

function exportarExcel() {
    const wb = XLSX.utils.book_new();

    // Hoja resumen por mes
    const mesesUnicos = [...new Set(ventas.map(v => claveMes(v.fecha)))].sort();
    const filasResumen = mesesUnicos.map(m => {
        const vs = ventas.filter(v => claveMes(v.fecha) === m);
        return {
            "Mes": nombreMes(m),
            "N° de Ventas": vs.length,
            "Total Vendido (Bs)": Number(vs.reduce((a, v) => a + v.total, 0).toFixed(2))
        };
    });
    const hojaResumen = XLSX.utils.json_to_sheet(filasResumen);
    XLSX.utils.book_append_sheet(wb, hojaResumen, "Resumen");

    // Una hoja por mes con el detalle
    mesesUnicos.forEach(m => {
        const vs = ventas.filter(v => claveMes(v.fecha) === m).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
        const filas = [];
        vs.forEach(v => {
            v.detalles.forEach(d => {
                filas.push({
                    "Fecha": formatoFecha(v.fecha),
                    "N° Venta": v.numero,
                    "Código": d.codigo,
                    "Producto": d.nombre,
                    "Marca": d.marca || "",
                    "Cantidad": d.cantidad,
                    "Precio Unitario (Bs)": d.precio,
                    "Subtotal (Bs)": Number(d.subtotal.toFixed(2)),
                    "Total Venta (Bs)": Number(v.total.toFixed(2))
                });
            });
        });
        const hoja = XLSX.utils.json_to_sheet(filas);
        const nombreHoja = nombreMes(m).substring(0, 31); // límite de Excel
        XLSX.utils.book_append_sheet(wb, hoja, nombreHoja);
    });

    const nombreArchivo = `Ventas_RamyMotors_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, nombreArchivo);
    toast("Excel exportado");
}

/* ================= DASHBOARD / INICIO ================= */
function renderInicio() {
    document.getElementById("statProductos").textContent = productos.length;

    const stockBajo = productos.filter(p => p.cantidad <= STOCK_BAJO_LIMITE);
    document.getElementById("statStockBajo").textContent = stockBajo.length;

    const hoy = new Date();
    const esHoy = (iso) => {
        const d = new Date(iso);
        return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
    };
    const esMesActual = (iso) => {
        const d = new Date(iso);
        return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth();
    };

    const ventasHoy = ventas.filter(v => esHoy(v.fecha));
    const ventasMes = ventas.filter(v => esMesActual(v.fecha));

    document.getElementById("statVentasHoy").textContent = ventasHoy.length;
    document.getElementById("statMontoHoy").textContent = ventasHoy.reduce((a, v) => a + v.total, 0).toFixed(2);
    document.getElementById("statVentasMes").textContent = ventasMes.length;
    document.getElementById("statMontoMes").textContent = ventasMes.reduce((a, v) => a + v.total, 0).toFixed(2);

    const badge = document.getElementById("stockBadge");
    badge.textContent = stockBajo.length > 0 ? stockBajo.length : "";

    const listaBajo = document.getElementById("listaStockBajo");
    if (stockBajo.length === 0) {
        listaBajo.innerHTML = `<p class="empty-msg">Todo el stock está en niveles saludables.</p>`;
    } else {
        listaBajo.innerHTML = stockBajo.map(p => `
      <div class="mini-item">
        <span>${escapeHtml(p.nombre)} <span style="color:var(--text-dim); font-family:var(--font-mono); font-size:11px;">(${escapeHtml(p.codigo)})</span></span>
        <span class="qty">${p.cantidad} u.</span>
      </div>`).join("");
    }
}

/* ================= INICIALIZACIÓN ================= */
cargarDatos();
renderInicio();
renderInventario();
renderVentaActual();
renderHistorial();