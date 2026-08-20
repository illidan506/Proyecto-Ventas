/* ============================================================
   RAMY MOTORS — Sistema de Gestión
   Almacenamiento: Firebase Firestore (datos sincronizados en
   tiempo real entre todos los dispositivos)
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    deleteDoc,
    onSnapshot,
    runTransaction,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDCdxa4fVIJepqmwOsNBtdK43KiGIok-ps",
    authDomain: "sistemainventario-7b450.firebaseapp.com",
    projectId: "sistemainventario-7b450",
    storageBucket: "sistemainventario-7b450.firebasestorage.app",
    messagingSenderId: "821935872729",
    appId: "1:821935872729:web:27f77d81b9afc1846bbcc8",
    measurementId: "G-51K8FH9JHZ"
};

const firebaseApp = initializeApp(firebaseConfig);
const analytics = getAnalytics(firebaseApp);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

const refProductos = collection(db, "productos");
const refVentas = collection(db, "ventas");
const refContador = doc(db, "meta", "contadorVentas");

const EMPRESA = {
    nombre: "RAMY MOTORS",
    direccion: "Av. Principal",
    telefono: "63079445",
    whatsapp: "59163079445" // 591 = Bolivia + número
};

const STOCK_BAJO_LIMITE = 5;

/* ================= ESTADO ================= */
let productos = [];
let ventas = [];
let siguienteNumeroVenta = 1;
let carrito = []; // [{codigo, nombre, marca, precio, cantidad, subtotal}]
let productoSeleccionadoVenta = null;
let ultimaVentaGenerada = null;

/* ================= FOTOS DEL PRODUCTO (NUEVO) =================
   Cada producto admite hasta 2 fotos. Se comprimen en el propio
   teléfono y se guardan como texto (Base64) dentro del mismo
   documento de Firestore, en un arreglo "imagenesBase64". No se
   usa Firebase Storage: desde 2026 ese servicio exige el plan de
   pago Blaze (tarjeta), mientras que Firestore sigue siendo
   gratis. Con 2 fotos por producto, cada una debe pesar menos
   (para que ambas quepan bajo el límite de 1 MiB por documento). */
const IMAGEN_MAX_BASE64 = 450000; // por foto: deja margen para 2 fotos + los demás campos, bajo 1 MiB

// estado[1] y estado[2]: una entrada por cada uno de los 2 slots de foto
const estadoFotos = {
    1: { pendiente: null, quitada: false },
    2: { pendiente: null, quitada: false }
};

function comprimirImagenABase64(file, maxDim, calidad) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width >= height && width > maxDim) {
                height = Math.round(height * (maxDim / width));
                width = maxDim;
            } else if (height > width && height > maxDim) {
                width = Math.round(width * (maxDim / height));
                height = maxDim;
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            canvas.getContext("2d").drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", calidad));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("No se pudo leer la imagen"));
        };
        img.src = url;
    });
}

async function procesarImagenSeleccionada(file) {
    const intentos = [
        { maxDim: 900, calidad: 0.7 },
        { maxDim: 700, calidad: 0.5 },
        { maxDim: 500, calidad: 0.35 }
    ];

    for (const intento of intentos) {
        const base64 = await comprimirImagenABase64(file, intento.maxDim, intento.calidad);
        if (base64.length <= IMAGEN_MAX_BASE64) return base64;
    }

    throw new Error("La imagen es muy pesada incluso comprimida. Prueba con otra foto.");
}

function mostrarPreviewImagen(slot, base64) {
    const img = document.getElementById("imagenPreview" + slot);
    const placeholder = document.getElementById("imagenPreviewPlaceholder" + slot);
    const btnQuitar = document.getElementById("btnQuitarImagen" + slot);

    if (base64) {
        img.src = base64;
        img.style.display = "block";
        placeholder.style.display = "none";
        btnQuitar.classList.remove("hidden");
    } else {
        img.src = "";
        img.style.display = "none";
        placeholder.style.display = "block";
        placeholder.textContent = "Sin foto";
        btnQuitar.classList.add("hidden");
    }
}

function conectarSelectorDeFoto(slot) {
    document.getElementById("fImagen" + slot).addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const placeholder = document.getElementById("imagenPreviewPlaceholder" + slot);
        const btnGuardar = document.querySelector("#formProducto button[type=submit]");
        placeholder.style.display = "block";
        placeholder.textContent = "Procesando foto...";
        btnGuardar.disabled = true;

        try {
            const base64 = await procesarImagenSeleccionada(file);
            estadoFotos[slot].pendiente = base64;
            estadoFotos[slot].quitada = false;
            mostrarPreviewImagen(slot, base64);
        } catch (error) {
            console.error(error);
            toast(error.message || "No se pudo procesar la foto");
            mostrarPreviewImagen(slot, estadoFotos[slot].pendiente);
        } finally {
            btnGuardar.disabled = false;
            e.target.value = "";
        }
    });

    document.getElementById("btnQuitarImagen" + slot).addEventListener("click", () => {
        estadoFotos[slot].pendiente = null;
        estadoFotos[slot].quitada = true;
        mostrarPreviewImagen(slot, null);
    });
}

conectarSelectorDeFoto(1);
conectarSelectorDeFoto(2);

function resetearEstadoFotos() {
    estadoFotos[1] = { pendiente: null, quitada: false };
    estadoFotos[2] = { pendiente: null, quitada: false };
    mostrarPreviewImagen(1, null);
    mostrarPreviewImagen(2, null);
}

function cargarFotosExistentes(imagenesBase64) {
    const lista = imagenesBase64 || [];
    estadoFotos[1] = { pendiente: null, quitada: false };
    estadoFotos[2] = { pendiente: null, quitada: false };
    mostrarPreviewImagen(1, lista[0] || null);
    mostrarPreviewImagen(2, lista[1] || null);
}

function construirArregloDeFotos(codigoOriginal, imagenesExistentesOriginal) {
    const resultado = [];
    for (const slot of [1, 2]) {
        let valor = null;
        if (estadoFotos[slot].pendiente) {
            valor = estadoFotos[slot].pendiente;
        } else if (estadoFotos[slot].quitada) {
            valor = null;
        } else if (codigoOriginal) {
            valor = (imagenesExistentesOriginal || [])[slot - 1] || null;
        }
        if (valor) resultado.push(valor);
    }
    return resultado;
}

/* ---- visor: ver foto(s) ampliada(s), con flechas si hay más de una ---- */
let fotosVisorActual = [];
let indiceFotoVisor = 0;

function abrirImagenAmpliada(fotos, indiceInicial) {
    fotosVisorActual = (fotos || []).filter(Boolean);
    if (fotosVisorActual.length === 0) return;
    indiceFotoVisor = indiceInicial || 0;
    pintarFotoVisor();
    document.getElementById("modalImagen").classList.remove("hidden");
}

function pintarFotoVisor() {
    document.getElementById("lightboxImg").src = fotosVisorActual[indiceFotoVisor];
    document.getElementById("lightboxScroll").classList.remove("zoomed");

    const haySVarias = fotosVisorActual.length > 1;
    document.getElementById("btnFotoAnterior").classList.toggle("hidden", !haySVarias);
    document.getElementById("btnFotoSiguiente").classList.toggle("hidden", !haySVarias);

    const dots = document.getElementById("lightboxDots");
    dots.classList.toggle("hidden", !haySVarias);
    dots.innerHTML = fotosVisorActual.map((_, i) =>
        `<span class="${i === indiceFotoVisor ? "activo" : ""}"></span>`
    ).join("");
}

document.getElementById("btnCerrarImagen").addEventListener("click", () => {
    document.getElementById("modalImagen").classList.add("hidden");
});

document.getElementById("lightboxImg").addEventListener("click", () => {
    document.getElementById("lightboxScroll").classList.toggle("zoomed");
});

document.getElementById("btnFotoAnterior").addEventListener("click", () => {
    indiceFotoVisor = (indiceFotoVisor - 1 + fotosVisorActual.length) % fotosVisorActual.length;
    pintarFotoVisor();
});

document.getElementById("btnFotoSiguiente").addEventListener("click", () => {
    indiceFotoVisor = (indiceFotoVisor + 1) % fotosVisorActual.length;
    pintarFotoVisor();
});

/* ================= CÓDIGO AUTOMÁTICO DE PRODUCTO (NUEVO) =================
   Cada producto nuevo recibe un código consecutivo (0001, 0002...)
   generado solo. Se reserva mediante una transacción de Firestore
   -igual que el número de venta- para que dos teléfonos nunca
   puedan generar el mismo código al mismo tiempo. */
const refContadorProductos = doc(db, "meta", "contadorProductos");
let siguienteCodigoProductoPreview = 1;

async function crearProductoConCodigoAutomatico(datos) {
    return await runTransaction(db, async (transaction) => {
        const contadorSnap = await transaction.get(refContadorProductos);
        let siguiente = contadorSnap.exists() ? contadorSnap.data().siguiente : 1;

        // Normalmente el código generado está libre. Pero si alguien renombró
        // manualmente otro producto para que coincida con un número futuro del
        // contador (p. ej. al editar), este bucle salta ese código ocupado en
        // vez de quedar atascado para siempre pidiendo el mismo número.
        let codigo = String(siguiente).padStart(4, "0");
        let productoRef = doc(refProductos, codigo);
        let productoSnap = await transaction.get(productoRef);
        let intentos = 0;

        while (productoSnap.exists() && intentos < 50) {
            siguiente++;
            codigo = String(siguiente).padStart(4, "0");
            productoRef = doc(refProductos, codigo);
            productoSnap = await transaction.get(productoRef);
            intentos++;
        }

        if (productoSnap.exists()) {
            throw new Error("No se pudo generar un código disponible. Intenta de nuevo.");
        }

        transaction.set(productoRef, { ...datos, codigo });
        transaction.set(refContadorProductos, { siguiente: siguiente + 1 });

        return codigo;
    });
}

/* ================= AUTENTICACIÓN (NUEVO) =================
   Firebase avisó que las reglas de "modo de prueba" (abiertas a
   cualquiera en Internet) vencen a los 30 días del proyecto. Para
   que la app siga funcionando SIN dejar la base de datos abierta
   para siempre, cada teléfono inicia una sesión anónima de Firebase
   de forma automática (sin pedir nada al usuario, la contraseña de
   la app sigue igual). Las reglas de Firestore deben cambiar a
   "allow read, write: if request.auth != null;" para que solo
   quien pasó por esta autenticación pueda entrar. */
async function iniciarAutenticacion() {
    try {
        await signInAnonymously(auth);
        iniciarSincronizacion();
    } catch (error) {
        console.error("Error de autenticación con Firebase:", error);
        if (error.code === "auth/operation-not-allowed") {
            toast("Falta activar el inicio de sesión anónimo en Firebase");
        } else {
            toast("No se pudo conectar de forma segura. Revisa tu conexión.");
        }
    }
}

/* ================= SINCRONIZACIÓN CON FIRESTORE =================
   Reemplaza el antiguo localStorage. "productos" y "ventas" se
   mantienen actualizados en tiempo real: si otro dispositivo
   agrega o edita algo, esta pantalla se refresca sola. */
function iniciarSincronizacion() {
    onSnapshot(refProductos, (snapshot) => {
        productos = snapshot.docs.map(d => d.data());
        renderVistaActual();
    }, (error) => {
        console.error("Error al sincronizar productos:", error);
        toast("Sin conexión con la base de datos");
    });

    onSnapshot(refVentas, (snapshot) => {
        ventas = snapshot.docs.map(d => d.data()).sort((a, b) => a.numero - b.numero);
        renderVistaActual();
    }, (error) => {
        console.error("Error al sincronizar ventas:", error);
        toast("Sin conexión con la base de datos");
    });

    onSnapshot(refContador, (snap) => {
        siguienteNumeroVenta = snap.exists() ? snap.data().siguiente : 1;
        actualizarNumeroVentaLabel();
    }, (error) => {
        console.error("Error al sincronizar contador de ventas:", error);
    });

    onSnapshot(refContadorProductos, (snap) => {
        siguienteCodigoProductoPreview = snap.exists() ? snap.data().siguiente : 1;
    }, (error) => {
        console.error("Error leyendo contador de productos:", error);
    });
}

function renderVistaActual() {
    const vistaActiva = document.querySelector(".view.active");
    if (!vistaActiva) return;
    const nombre = vistaActiva.id.replace("view-", "");
    if (nombre === "inicio") renderInicio();
    if (nombre === "inventario") renderInventario();
    if (nombre === "historial") renderHistorial();
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
    const modal = document.getElementById(id);
    modal.classList.remove("hidden");
    const sheet = modal.querySelector(".modal-sheet");
    if (sheet) sheet.scrollTop = 0;
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

async function agregarOEditarProducto(datos, codigoOriginal) {
    try {
        if (codigoOriginal) {
            // edición
            const existente = buscarPorCodigo(codigoOriginal);
            if (!existente) return { ok: false, msg: "Producto no encontrado." };

            // si cambiaron el código, verificar que el nuevo no exista ya (en otro producto)
            if (datos.codigo.toLowerCase() !== codigoOriginal.toLowerCase() && buscarPorCodigo(datos.codigo)) {
                return { ok: false, msg: "Ya existe un producto con ese código." };
            }

            if (datos.codigo.toLowerCase() !== codigoOriginal.toLowerCase()) {
                // el código cambió: crear el documento nuevo y borrar el anterior, de forma atómica
                const lote = writeBatch(db);
                lote.set(doc(refProductos, datos.codigo), datos);
                lote.delete(doc(refProductos, codigoOriginal));
                await lote.commit();
            } else {
                await setDoc(doc(refProductos, datos.codigo), datos);
            }
        } else {
            if (buscarPorCodigo(datos.codigo)) {
                return { ok: false, msg: "Ya existe un producto con ese código." };
            }
            await setDoc(doc(refProductos, datos.codigo), datos);
        }
        return { ok: true };
    } catch (error) {
        console.error(error);
        return { ok: false, msg: "No se pudo guardar el producto. Revisa tu conexión." };
    }
}

async function eliminarProducto(codigo) {
    try {
        await deleteDoc(doc(refProductos, codigo));
        return true;
    } catch (error) {
        console.error(error);
        toast("No se pudo eliminar el producto");
        return false;
    }
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

/* ---- ver compatibilidad (motor -> productos compatibles) ----
   El campo "compatibilidad" guarda motores separados por coma.
   Dado el nombre de un motor, se listan los PRODUCTOS cuya
   compatibilidad lo incluye, usando la misma tarjeta que el
   inventario normal (con foto, stock, precio, editar/eliminar). */
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

/* ---- conecta los eventos (ver detalles, foto, editar, eliminar) de
   un grupo de tarjetas de producto. Se reutiliza en ambos modos de
   búsqueda (general y por motor) para no duplicar lógica. ---- */
function conectarEventosTarjetas(cont) {
    cont.querySelectorAll(".product-card").forEach(card => {
        const codigo = card.dataset.codigo;
        card.querySelector(".product-card-top").addEventListener("click", () => {
            card.querySelector(".product-details").classList.toggle("open");
        });
        const miniatura = card.querySelector(".product-thumb");
        if (miniatura) {
            miniatura.addEventListener("click", (e) => {
                e.stopPropagation();
                const p = buscarPorCodigo(codigo);
                abrirImagenAmpliada(p ? p.imagenesBase64 : [], 0);
            });
        }
        const btnEdit = card.querySelector(".btn-editar");
        const btnDel = card.querySelector(".btn-eliminar");
        if (btnEdit) btnEdit.addEventListener("click", (e) => { e.stopPropagation(); abrirFormularioEdicion(codigo); });
        if (btnDel) btnDel.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (confirm(`¿Eliminar el producto "${codigo}"? Esta acción no se puede deshacer.`)) {
                const ok = await eliminarProducto(codigo);
                if (ok) toast("Producto eliminado");
            }
        });
    });
}

function renderInventario() {
    if (modoBusqueda === "motor") {
        renderResultadosMotor(document.getElementById("inputBuscarMotor").value);
        return;
    }

    const cont = document.getElementById("listaInventario");
    const q = document.getElementById("inputBuscarGeneral").value;
    const lista = buscarGeneral(q);

    if (lista.length === 0) {
        cont.innerHTML = `<p class="empty-msg">No se encontraron productos.</p>`;
        return;
    }

    cont.innerHTML = lista.map(p => tarjetaProducto(p)).join("");
    conectarEventosTarjetas(cont);
}

function renderResultadosMotor(texto) {
    const cont = document.getElementById("listaInventario");

    if (!texto.trim()) {
        cont.innerHTML = `<p class="empty-msg">Escribe el nombre de un motor para ver los productos compatibles.</p>`;
        return;
    }

    const lista = buscarPorMotor(texto);

    if (lista.length === 0) {
        cont.innerHTML = `<p class="empty-msg">No se encontraron productos compatibles con ese motor.</p>`;
        return;
    }

    cont.innerHTML = lista.map(p => tarjetaProducto(p)).join("");
    conectarEventosTarjetas(cont);
}

function tarjetaProducto(p) {
    const bajo = p.cantidad <= STOCK_BAJO_LIMITE;
    const fotos = p.imagenesBase64 || [];
    const miniatura = fotos[0]
        ? `<img src="${fotos[0]}" class="product-thumb" alt="Foto de ${escapeHtml(p.nombre)}">`
        : `<div class="product-thumb-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 16-5-4-4 3-3-2-6 5"/></svg></div>`;

    return `
  <div class="product-card" data-codigo="${escapeHtml(p.codigo)}">
    <div class="product-card-top">
      <div class="product-card-top-row">
        ${miniatura}
        <div>
          <div class="product-name">${escapeHtml(p.nombre)}</div>
          <div class="product-meta">${escapeHtml(p.codigo)} · ${escapeHtml(p.marca)} · ${escapeHtml(p.categoria)}</div>
          <span class="product-stock ${bajo ? "low" : ""}">Stock: ${p.cantidad}</span>
        </div>
      </div>
      <div class="product-price">${formatoMoneda(p.precio)}</div>
    </div>
    <div class="product-details">
      <p><b>Compatibilidad:</b> ${escapeHtml(p.compatibilidad || "—")}</p>
      <p><b>Modelo de auto:</b> ${escapeHtml(p.modeloAuto || "—")}</p>
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
    document.getElementById("fCodigo").value = String(siguienteCodigoProductoPreview).padStart(4, "0");
    document.getElementById("fCodigo").disabled = true;
    resetearEstadoFotos();
    abrirModal("modalProducto");
});

function abrirFormularioEdicion(codigo) {
    const p = buscarPorCodigo(codigo);
    if (!p) return;
    document.getElementById("modalProductoTitulo").textContent = "Editar Producto";
    document.getElementById("fCodigoOriginal").value = p.codigo;
    document.getElementById("fCodigo").value = p.codigo;
    document.getElementById("fCodigo").disabled = false;
    document.getElementById("fNombre").value = p.nombre;
    document.getElementById("fMarca").value = p.marca;
    document.getElementById("fCategoria").value = p.categoria;
    document.getElementById("fCompatibilidad").value = p.compatibilidad;
    document.getElementById("fModeloAuto").value = p.modeloAuto || "";
    document.getElementById("fCilindrada").value = p.cilindrada || "";
    document.getElementById("fDetalles").value = p.detalles || "";
    document.getElementById("fCantidad").value = p.cantidad;
    document.getElementById("fPrecio").value = p.precio;
    cargarFotosExistentes(p.imagenesBase64);
    abrirModal("modalProducto");
}

document.getElementById("formProducto").addEventListener("submit", async (e) => {
    e.preventDefault();

    const datos = {
        codigo: document.getElementById("fCodigo").value.trim(),
        nombre: document.getElementById("fNombre").value.trim(),
        marca: document.getElementById("fMarca").value.trim(),
        categoria: document.getElementById("fCategoria").value.trim(),
        compatibilidad: document.getElementById("fCompatibilidad").value.trim(),
        modeloAuto: document.getElementById("fModeloAuto").value.trim(),
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
    datos.imagenesBase64 = construirArregloDeFotos(codigoOriginal, codigoOriginal ? buscarPorCodigo(codigoOriginal)?.imagenesBase64 : null);

    const btnGuardar = document.querySelector("#formProducto button[type=submit]");
    btnGuardar.disabled = true;

    if (codigoOriginal) {
        // ---- editar producto existente: comportamiento sin cambios ----
        const resultado = await agregarOEditarProducto(datos, codigoOriginal);
        btnGuardar.disabled = false;

        if (!resultado.ok) {
            toast(resultado.msg);
            return;
        }

        cerrarModal("modalProducto");
        toast("Producto actualizado");
    } else {
        // ---- producto nuevo: código automático y consecutivo (0001, 0002...) ----
        delete datos.codigo; // lo asigna la transacción, para que nunca se repita entre teléfonos

        try {
            await crearProductoConCodigoAutomatico(datos);
            btnGuardar.disabled = false;
            cerrarModal("modalProducto");
            toast("Producto agregado");
        } catch (error) {
            btnGuardar.disabled = false;
            console.error(error);
            toast(error.message || "No se pudo guardar el producto. Revisa tu conexión.");
        }
    }
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
    document.getElementById("montoACobrar").value = total.toFixed(2);
    actualizarHintDescuento();
}

/* ---- monto a cobrar (permite rebaja): muestra la diferencia
   entre el total calculado y lo que el usuario decide cobrar ---- */
function actualizarHintDescuento() {
    const total = carrito.reduce((acc, i) => acc + i.subtotal, 0);
    const monto = parseFloat(document.getElementById("montoACobrar").value);
    const hint = document.getElementById("descuentoHint");

    if (isNaN(monto)) {
        hint.textContent = "";
        return;
    }

    const diferencia = Math.round((total - monto) * 100) / 100;

    if (Math.abs(diferencia) < 0.01) {
        hint.textContent = "";
    } else if (diferencia > 0) {
        hint.textContent = `Rebaja aplicada: ${formatoMoneda(diferencia)}`;
    } else {
        hint.textContent = `Recargo: ${formatoMoneda(-diferencia)}`;
    }
}

document.getElementById("montoACobrar").addEventListener("input", actualizarHintDescuento);

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

    cont.innerHTML = lista.map(p => {
        const fotos = p.imagenesBase64 || [];
        const miniatura = fotos[0]
            ? `<img src="${fotos[0]}" class="product-thumb" alt="Foto de ${escapeHtml(p.nombre)}">`
            : `<div class="product-thumb-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 16-5-4-4 3-3-2-6 5"/></svg></div>`;
        return `
    <div class="product-card" data-codigo="${escapeHtml(p.codigo)}">
      <div class="product-card-top">
        <div class="product-card-top-row">
          ${miniatura}
          <div>
            <div class="product-name">${escapeHtml(p.nombre)}</div>
            <div class="product-meta">${escapeHtml(p.codigo)} · Stock: ${p.cantidad}</div>
          </div>
        </div>
        <div class="product-price">${formatoMoneda(p.precio)}</div>
      </div>
    </div>`;
    }).join("");

    cont.querySelectorAll(".product-card").forEach(card => {
        card.addEventListener("click", (e) => {
            const miniatura = e.target.closest(".product-thumb");
            if (miniatura) {
                e.stopPropagation();
                const p = buscarPorCodigo(card.dataset.codigo);
                abrirImagenAmpliada(p ? p.imagenesBase64 : [], 0);
                return;
            }
            seleccionarProductoVenta(card.dataset.codigo);
        });
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

/* ---- confirmar venta ----
   Se ejecuta como una transacción de Firestore: lee el contador y el
   stock, valida, y recién entonces escribe. Así, si dos dispositivos
   confirman una venta al mismo tiempo, nunca se pisan ni repiten
   número de venta.
   "montoFinal" es lo que realmente se cobra (puede ser menor al
   subtotal calculado si hubo una rebaja); si no se especifica o no
   es un número válido, se usa el subtotal calculado tal cual. */
async function confirmarVentaEnFirestore(itemsCarrito, montoFinal) {
    return await runTransaction(db, async (transaction) => {
        const refsProductosCarrito = itemsCarrito.map(i => doc(refProductos, i.codigo));

        const contadorSnap = await transaction.get(refContador);
        const snapsProductos = await Promise.all(refsProductosCarrito.map(r => transaction.get(r)));

        for (let idx = 0; idx < itemsCarrito.length; idx++) {
            const snap = snapsProductos[idx];
            const item = itemsCarrito[idx];
            if (!snap.exists() || snap.data().cantidad < item.cantidad) {
                throw new Error(`Stock insuficiente para ${item.nombre}`);
            }
        }

        const numero = contadorSnap.exists() ? contadorSnap.data().siguiente : 1;
        const subtotal = itemsCarrito.reduce((acc, i) => acc + i.subtotal, 0);
        const total = (typeof montoFinal === "number" && !isNaN(montoFinal)) ? montoFinal : subtotal;
        const descuento = Math.round((subtotal - total) * 100) / 100;

        const venta = {
            numero,
            fecha: new Date().toISOString(),
            detalles: itemsCarrito.map(i => ({ ...i })),
            subtotal,
            descuento,
            total
        };

        snapsProductos.forEach((snap, idx) => {
            const item = itemsCarrito[idx];
            transaction.update(refsProductosCarrito[idx], { cantidad: snap.data().cantidad - item.cantidad });
        });

        transaction.set(doc(refVentas, String(numero)), venta);
        transaction.set(refContador, { siguiente: numero + 1 });

        return venta;
    });
}

document.getElementById("btnConfirmarVenta").addEventListener("click", async () => {
    if (carrito.length === 0) {
        toast("No hay productos en la venta");
        return;
    }

    const montoFinal = parseFloat(document.getElementById("montoACobrar").value);
    if (isNaN(montoFinal) || montoFinal < 0) {
        toast("Revisa el monto a cobrar");
        return;
    }

    const btn = document.getElementById("btnConfirmarVenta");
    btn.disabled = true;

    try {
        const venta = await confirmarVentaEnFirestore(carrito, montoFinal);
        ultimaVentaGenerada = venta;
        mostrarFactura(venta);
        carrito = [];
        renderVentaActual();
    } catch (error) {
        console.error(error);
        toast(error.message || "No se pudo registrar la venta");
    } finally {
        btn.disabled = false;
    }
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

    if (venta.descuento && Math.abs(venta.descuento) > 0.001) {
        t += `Subtotal:  ${formatoMoneda(venta.subtotal)}\n`;
        t += venta.descuento > 0
            ? `Rebaja:    ${formatoMoneda(venta.descuento)}\n`
            : `Recargo:   ${formatoMoneda(-venta.descuento)}\n`;
        t += "------------------------------------\n";
    }
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
        ${(v.descuento && Math.abs(v.descuento) > 0.001) ? `
          <div class="vd-row"><span>${v.descuento > 0 ? "Rebaja aplicada" : "Recargo"}</span><span>${formatoMoneda(Math.abs(v.descuento))}</span></div>
        ` : ""}
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
            "Rebajas Aplicadas (Bs)": Number(vs.reduce((a, v) => a + (v.descuento > 0 ? v.descuento : 0), 0).toFixed(2)),
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
                    "Rebaja de la Venta (Bs)": Number((v.descuento > 0 ? v.descuento : 0).toFixed(2)),
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

/* ================= LOGIN =================
   La contraseña no se guarda en texto plano en el código: se
   compara el hash SHA-256 de lo que la persona escribe contra
   este hash guardado. */
const CLAVE_HASH = "06bab52133ca9d8d527cdcd73b191c418653413d0d1ca0c95c6b381690872d14";
const AUTH_KEY = "rm_auth_ok";

async function sha256Hex(texto) {
    const datos = new TextEncoder().encode(texto);
    const hashBuffer = await crypto.subtle.digest("SHA-256", datos);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function ocultarLogin() {
    document.getElementById("loginOverlay").classList.add("hidden");
}

if (sessionStorage.getItem(AUTH_KEY) === "1") {
    ocultarLogin();
}

document.getElementById("formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("fClave");
    const error = document.getElementById("loginError");
    const btn = e.target.querySelector("button[type=submit]");

    btn.disabled = true;
    const hash = await sha256Hex(input.value);
    btn.disabled = false;

    if (hash === CLAVE_HASH) {
        sessionStorage.setItem(AUTH_KEY, "1");
        error.textContent = "";
        input.value = "";
        ocultarLogin();
    } else {
        error.textContent = "Contraseña incorrecta";
        input.value = "";
        input.focus();
    }
});

/* ================= INICIALIZACIÓN ================= */
iniciarAutenticacion();
renderInicio();
renderInventario();
renderVentaActual();
renderHistorial();