// =====================================================================
// Olimpiadas Matemáticas INEDEGUI 2026: servidor de la competencia
// Guarda en Netlify Blobs (el almacenamiento de datos de Netlify) los
// grupos, las preguntas, el estado de cada competencia, el ranking final
// y las fotos e imágenes. No pide inicio de sesión. Si en Netlify se crea
// la variable CLAVE_DOCENTE, las escrituras exigirán esa clave.
// =====================================================================
import { getStore } from "@netlify/blobs";

const DOCS = ["grupos_A", "grupos_B", "preg_A", "preg_B", "juego_A", "juego_B", "final_A", "final_B"];
const MAX_IMG = 4 * 1024 * 1024;   // 4 MB por imagen
const MAX_JSON = 3 * 1024 * 1024;  // 3 MB por documento
const TIPOS_IMG = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const leerClave = () => {
  try {
    if (typeof Netlify !== "undefined" && Netlify.env) return Netlify.env.get("CLAVE_DOCENTE") || "";
  } catch (e) { /* sin Netlify.env */ }
  return process.env.CLAVE_DOCENTE || "";
};

const iguales = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function valido(k, data) {
  if (data === null) return k.startsWith("preg_") || k.startsWith("juego_") || k.startsWith("final_");
  if (k.startsWith("grupos_") || k.startsWith("preg_")) return Array.isArray(data);
  return typeof data === "object" && !Array.isArray(data);
}

export default async (req, context) => {
  const recurso = context.params.recurso || "";
  const id = context.params.id || "";
  const metodo = req.method.toUpperCase();
  const datos = getStore({ name: "olimpiadas2026", consistency: "strong" });
  const imagenes = getStore({ name: "imagenes2026", consistency: "strong" });
  const clave = leerClave();
  const permitido = clave === "" || iguales(req.headers.get("x-clave") || "", clave);

  try {
    // ------------------------------ lectura ------------------------------
    if (metodo === "GET" && recurso === "estado") {
      return json({ ok: true, claveRequerida: clave !== "", hora: Date.now() });
    }
    if (metodo === "GET" && recurso === "datos") {
      const valores = await Promise.all(DOCS.map(k => datos.get(k, { type: "json" })));
      const docs = {};
      DOCS.forEach((k, i) => { if (valores[i]) docs[k] = valores[i]; });
      return json({ ok: true, docs, hora: Date.now() });
    }
    if (metodo === "GET" && recurso === "img" && id) {
      const res = await imagenes.getWithMetadata(id, { type: "arrayBuffer" });
      if (!res) return new Response("Imagen no encontrada", { status: 404 });
      return new Response(res.data, {
        headers: {
          "content-type": (res.metadata && res.metadata.tipo) || "image/jpeg",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }

    // ------------------------------ escritura ------------------------------
    if (metodo === "POST" && recurso === "verificar") {
      return permitido ? json({ ok: true }) : json({ ok: false, error: "Clave incorrecta." }, 401);
    }
    if (!permitido) return json({ error: "Clave incorrecta." }, 401);

    if (metodo === "PUT" && recurso === "doc" && DOCS.includes(id)) {
      const texto = await req.text();
      if (texto.length > MAX_JSON) return json({ error: "Los datos son demasiado grandes." }, 413);
      let cuerpo;
      try { cuerpo = JSON.parse(texto); } catch (e) { return json({ error: "Datos no válidos." }, 400); }
      if (!cuerpo || !("data" in cuerpo) || !valido(id, cuerpo.data)) return json({ error: "Datos no válidos." }, 400);
      const ts = Date.now();
      await datos.setJSON(id, { ts, data: cuerpo.data });
      return json({ ok: true, ts });
    }
    if (metodo === "POST" && recurso === "img") {
      const tipo = (req.headers.get("content-type") || "").split(";")[0].trim();
      if (!TIPOS_IMG.includes(tipo)) return json({ error: "Formato de imagen no permitido." }, 415);
      const buf = await req.arrayBuffer();
      if (buf.byteLength === 0) return json({ error: "La imagen está vacía." }, 400);
      if (buf.byteLength > MAX_IMG) return json({ error: "La imagen supera 4 MB." }, 413);
      const nuevo = nuevoId();
      await imagenes.set(nuevo, buf, { metadata: { tipo } });
      return json({ ok: true, id: nuevo, url: `/api/img/${nuevo}` });
    }
    if (metodo === "POST" && recurso === "reiniciar") {
      // Borra todo y deja la competencia como al inicio. Exige escribir "sí".
      let cuerpo = {};
      try { cuerpo = JSON.parse(await req.text() || "{}"); } catch (e) { cuerpo = {}; }
      const conf = String(cuerpo.confirmacion || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (conf !== "si") return json({ error: "Falta la confirmación." }, 400);
      const ts = Date.now();
      const vacios = { grupos_A: [], grupos_B: [], preg_A: null, preg_B: null, juego_A: null, juego_B: null, final_A: null, final_B: null };
      await Promise.all(DOCS.map(k => datos.setJSON(k, { ts, data: vacios[k] })));
      let borradas = 0;
      if (typeof imagenes.deleteAll === "function") {
        const r = await imagenes.deleteAll();
        borradas = (r && r.deletedBlobs) || 0;
      } else {
        const { blobs } = await imagenes.list();
        for (let i = 0; i < blobs.length; i += 20) await Promise.all(blobs.slice(i, i + 20).map(b => imagenes.delete(b.key)));
        borradas = blobs.length;
      }
      return json({ ok: true, ts, imagenesBorradas: borradas });
    }
    if (metodo === "DELETE" && recurso === "img" && id) {
      await imagenes.delete(id);
      return json({ ok: true });
    }
    return json({ error: "Ruta no encontrada." }, 404);
  } catch (e) {
    return json({ error: e.message || "Error del servidor." }, 500);
  }
};

export const config = {
  path: ["/api/:recurso", "/api/:recurso/:id"],
};
