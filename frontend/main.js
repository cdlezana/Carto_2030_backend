// frontend/main.js (versión final con satélite y colores correctos)

// --- Map init ---
const map = L.map("map").setView([-26.1, -60.5], 7);
L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
        maxZoom: 24,
        attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics"
    }
).addTo(map);


// --- Globals ---
let capasMap = {};
let chartEstado = null;
let chartMunicipio = null;
let chartDepartamento = null;

// Colors (ajustables)

const estadoColor = {
    1: "#125e08ff", // verde más vivo
    2: "#eeff07f5", // amarillo más brillante
    3: "#eb0c22ff"  // rojo más intenso
};

const estilosCapa = {
    dpto_chaco: { color: "#3388ff", weight: 3, fillOpacity: 0.15 },
    gob_locales_2022: { color: "#ff7800", weight: 2, fillOpacity: 0.15 },
    loc_censal_2022: { color: "#00cc44", weight: 2, fillOpacity: 0.15 },
    pjes_censal_2022: { color: "#cc0000", weight: 1, fillOpacity: 0.6 }
};

// --- Helpers ---
function safeArrayFromCapasResponse(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.capas)) return data.capas;
    for (const k of Object.keys(data)) {
        if (Array.isArray(data[k])) return data[k];
    }
    return [];
}

function destroyChart(chartVar) {
    try {
        if (chartVar && typeof chartVar.destroy === "function") chartVar.destroy();
    } catch (e) { /* noop */ }
}

// --- Load capas selector ---
async function cargarSelectorCapas() {
    try {
        const resp = await fetch("/api/capas");
        const data = await resp.json();
        const capas = safeArrayFromCapasResponse(data);

        const sel = document.getElementById("selectorCapas");
        if (!sel) {
            console.error("No existe #selectorCapas en el DOM");
            return;
        }
        sel.innerHTML = "";

        capas.forEach(capa => {
            const opt = document.createElement("option");
            if (typeof capa === "string") {
                opt.value = capa;
                opt.textContent = capa;
            } else {
                opt.value = capa.id || capa.nombre || JSON.stringify(capa);
                opt.textContent = capa.nombre || capa.id || opt.value;
            }
            sel.appendChild(opt);
        });

        sel.addEventListener("change", () => {
            const depto = document.getElementById("selectorDepartamento")?.value || "todos";
            cargarCapaDesdeAPI(sel.value, depto);
        });

        if (sel.options.length > 0) {
            sel.selectedIndex = 0;
            const depto = document.getElementById("selectorDepartamento")?.value || "todos";
            cargarCapaDesdeAPI(sel.value, depto);
        }
    } catch (err) {
        console.error("Error en cargarSelectorCapas:", err);
    }
}

// --- Load departamentos selector ---
async function cargarSelectorDepartamentos() {
    try {
        const sel = document.getElementById("selectorDepartamento");
        if (!sel) {
            console.error("No existe #selectorDepartamento en el DOM");
            return;
        }

        sel.innerHTML = "";
        const optTodos = document.createElement("option");
        optTodos.value = "todos";
        optTodos.textContent = "Todos";
        sel.appendChild(optTodos);

        const resp = await fetch("/api/departamentos");
        if (!resp.ok) {
            console.warn("/api/departamentos respondió", resp.status);
            return;
        }
        const data = await resp.json();
        const deps = data && data.departamentos ? data.departamentos : (Array.isArray(data) ? data : []);

        deps.forEach(d => {
            const opt = document.createElement("option");
            opt.value = d;
            opt.textContent = d;
            sel.appendChild(opt);
        });

        sel.addEventListener("change", () => {
            const capa = document.getElementById("selectorCapas")?.value;
            const depto = sel.value || "todos";
            if (capa) cargarCapaDesdeAPI(capa, depto);
            cargarKPIs(depto);
        });

    } catch (err) {
        console.error("Error en cargarSelectorDepartamentos:", err);
    }
}

// --- Cargar capa ---
async function cargarCapaDesdeAPI(nombreCapa, depto = "todos") {
    try {
        let url = `/api/${nombreCapa}`;
        if (nombreCapa === "pjes_censal_2022" && depto && depto !== "todos") {
            url += `?depto=${encodeURIComponent(depto)}`;
        }

        const resp = await fetch(url);
        if (!resp.ok) {
            console.error(`Error al pedir ${url}:`, resp.status, await resp.text());
            if (capasMap[nombreCapa]) { map.removeLayer(capasMap[nombreCapa]); delete capasMap[nombreCapa]; }
            return;
        }

        const geojson = await resp.json();
        if (!geojson || !geojson.features) {
            console.warn("GeoJSON inválido o sin features para", nombreCapa, geojson);
            if (capasMap[nombreCapa]) { map.removeLayer(capasMap[nombreCapa]); delete capasMap[nombreCapa]; }
            return;
        }

        if (capasMap[nombreCapa]) {
            map.removeLayer(capasMap[nombreCapa]);
            delete capasMap[nombreCapa];
        }

        const layer = L.geoJSON(geojson, {
            style: feature => estilosCapa[nombreCapa] || { color: "#3388ff" },
            pointToLayer: (feature, latlng) => {
                if (nombreCapa === "pjes_censal_2022") {
                    const idestado = feature.properties.id_estado ?? feature.properties.estado ?? 2;
                    return L.circleMarker(latlng, {
                        radius: 5,
                        fillColor: estadoColor[idestado] || "#999",
                        color: "#000",
                        weight: 0.6,
                        fillOpacity: 0.9
                    });
                }
                return L.marker(latlng);
            },
            onEachFeature: (feature, layer) => {
                const props = feature.properties || {};
                const propsHTML = Object.entries(props).map(([k, v]) => `<b>${k}</b>: ${v}`).join("<br>");
                if (nombreCapa === "pjes_censal_2022") {
                    const id = feature.properties.id ?? feature.properties.ID ?? null;
                    layer.bindPopup(`
            <div style="max-width:260px;">
              ${propsHTML}<br>
              Estado actual: ${feature.properties.id_estado ?? feature.properties.estado ?? 2}<br>
              <div style="margin-top:8px;">
                <button onclick="window.__cambiarEstado(${id},1)">Corresponde</button>
                <button onclick="window.__cambiarEstado(${id},2)">No Revisado</button>
                <button onclick="window.__cambiarEstado(${id},3)">No Corresponde</button>
              </div>
            </div>
          `);
                } else {
                    layer.bindPopup(propsHTML);
                }
            }
        }).addTo(map);

        capasMap[nombreCapa] = layer;

        if (nombreCapa === "pjes_censal_2022") {
            cargarKPIs(depto);
        }

    } catch (err) {
        console.error("Error en cargarCapaDesdeAPI:", err);
    }
}

// --- Cambiar estado ---
window.__cambiarEstado = async function (id, nuevoEstado) {
    if (!id && id !== 0) { alert("ID inválido para cambio de estado"); return; }
    try {
        const resp = await fetch("/api/estado", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, estado: nuevoEstado })
        });
        if (!resp.ok) {
            const txt = await resp.text();
            console.error("Error update estado:", resp.status, txt);
            alert("Error actualizando estado. Mirá la consola.");
            return;
        }

        const layer = capasMap["pjes_censal_2022"];
        if (layer) {
            layer.eachLayer(l => {
                const fid = l.feature && (l.feature.properties.id ?? l.feature.properties.ID);
                if (fid == id) {
                    if ("id_estado" in l.feature.properties) l.feature.properties.id_estado = nuevoEstado;
                    else l.feature.properties.estado = nuevoEstado;
                    if (l.setStyle) l.setStyle({ fillColor: estadoColor[nuevoEstado], color: estadoColor[nuevoEstado] });
                }
            });
            const depto = document.getElementById("selectorDepartamento")?.value || "todos";
            cargarKPIs(depto);
        }
        map.closePopup();
    } catch (err) {
        console.error("Error en __cambiarEstado:", err);
    }
};


// --- Cargar KPIs ---
async function cargarKPIs(depto = "todos") {
    try {
        const url = `/api/kpis${depto && depto !== "todos" ? `?depto=${encodeURIComponent(depto)}` : ""}`;
        const resp = await fetch(url);
        if (!resp.ok) { console.error("Error cargando KPIs:", resp.status, await resp.text()); return; }
        const data = await resp.json();

        const estadosArr = data.total_por_estado ?? data.estados ?? [];
        const municipiosArr = data.por_municipio ?? data.municipios ?? [];
        const departamentosArr = data.por_departamento ?? data.departamentos ?? [];

        const labelsEstado = estadosArr.map(r => r.estado ?? r.label ?? String(r[0] ?? "No Asignado"));
        const valuesEstado = estadosArr.map(r => r.cantidad ?? r.value ?? r[1] ?? 0);

        const labelsMun = municipiosArr.map(r => r.municipio ?? r.label ?? String(r[0] ?? "Sin Municipio"));
        const valuesMun = municipiosArr.map(r => r.cantidad ?? r.value ?? r[1] ?? 0);

        const labelsDep = departamentosArr.map(r => r.departamento ?? r.label ?? String(r[0] ?? "Sin Departamento"));
        const valuesDep = departamentosArr.map(r => r.cantidad ?? r.value ?? r[1] ?? 0);

        /*  destroyChart(chartEstado);
          const ctxE = document.getElementById("kpiEstado")?.getContext("2d");
          if (ctxE) {
              chartEstado = new Chart(ctxE, {
                  type: "doughnut",
                  data: { labels: labelsEstado, datasets: [{ data: valuesEstado, backgroundColor: [estadoColor[1], estadoColor[2], estadoColor[3]] }] },
                  
                  
                  
                  
                  options: { responsive: true, plugins: { legend: { position: "bottom" } } }
              });
          }*/

        destroyChart(chartEstado);
        const ctxE = document.getElementById("kpiEstado")?.getContext("2d");
        if (ctxE) {
            const backgroundColorsEstado = labelsEstado.map(label => {
                const lbl = String(label).toLowerCase().trim();
                if (lbl === 'corresponde') return estadoColor[1];     // verde
                if (lbl === 'no revisado') return estadoColor[2];     // amarillo
                if (lbl === 'no corresponde') return estadoColor[3];  // rojo
                return "#999"; // fallback
            });


            chartEstado = new Chart(ctxE, {
                type: "doughnut",
                data: { labels: labelsEstado, datasets: [{ data: valuesEstado, backgroundColor: backgroundColorsEstado }] },
                options: { responsive: true, plugins: { legend: { position: "bottom" } } }
            });
        }


        destroyChart(chartMunicipio);
        const ctxM = document.getElementById("kpiMunicipio")?.getContext("2d");
        if (ctxM) {
            chartMunicipio = new Chart(ctxM, {
                type: "bar",
                data: { labels: labelsMun, datasets: [{ label: "Parajes", data: valuesMun }] },
                options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });
        }

        destroyChart(chartDepartamento);
        const ctxD = document.getElementById("kpiDepartamento")?.getContext("2d");
        if (ctxD) {
            chartDepartamento = new Chart(ctxD, {
                type: "bar",
                data: { labels: labelsDep, datasets: [{ label: "Parajes", data: valuesDep }] },
                options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });
        }
    } catch (err) {
        console.error("Error en cargarKPIs:", err);
    }
}

// --- Init on DOM ready ---
document.addEventListener("DOMContentLoaded", async () => {
    await cargarSelectorDepartamentos();
    await cargarSelectorCapas();
    cargarKPIs("todos");
});        