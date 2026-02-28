const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');

const app  = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.API_KEY || null;

app.use((req, res, next) => {
  if (!API_KEY) return next();
  if (req.path === '/') return next();
  const key = req.query.apikey || req.headers['x-api-key'];
  if (key !== API_KEY) return res.status(401).json({ estado: false, mensaje: 'API key inválida' });
  next();
});

// ════════════════════════════════════════════════════════════
// HTTP HELPERS
// ════════════════════════════════════════════════════════════

const BASE = 'https://servicioselectorales.tse.go.cr';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function parseCookies(header, jar = {}) {
  const arr = Array.isArray(header) ? header : header ? [header] : [];
  for (const c of arr) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}

function cookieStr(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function extractVS(html) {
  const $ = cheerio.load(html);
  return {
    __VIEWSTATE:          $('input[name="__VIEWSTATE"]').val()          || '',
    __VIEWSTATEGENERATOR: $('input[name="__VIEWSTATEGENERATOR"]').val() || '',
    __EVENTVALIDATION:    $('input[name="__EVENTVALIDATION"]').val()    || '',
  };
}

function updateVSFromAsync(text, vs) {
  const m1 = text.match(/\d+\|hiddenField\|__VIEWSTATE\|([^|]+)\|/);
  const m2 = text.match(/\d+\|hiddenField\|__VIEWSTATEGENERATOR\|([^|]+)\|/);
  const m3 = text.match(/\d+\|hiddenField\|__EVENTVALIDATION\|([^|]+)\|/);
  if (m1) vs.__VIEWSTATE          = m1[1];
  if (m2) vs.__VIEWSTATEGENERATOR = m2[1];
  if (m3) vs.__EVENTVALIDATION    = m3[1];
  return vs;
}

function spanById($, id) {
  return $(`#${id}`).text().trim() || null;
}

// ════════════════════════════════════════════════════════════
// PARSERS POR IDs CONOCIDOS
// ════════════════════════════════════════════════════════════

function parsePersona(html) {
  const $ = cheerio.load(html);
  return {
    cedula:        spanById($, 'lblcedula'),
    nombre:        spanById($, 'lblnombrecompleto'),
    fecha_nac:     spanById($, 'lblfechaNacimiento'),
    edad:          spanById($, 'lbledad'),
    nacionalidad:  spanById($, 'lblnacionalidad'),
    estado_civil:  spanById($, 'lblestadocivil') || spanById($, 'lblEstadoCivil'),
    marginal:      spanById($, 'lblLeyendaMarginal'),
    padre_nombre:  spanById($, 'lblnombrepadre'),
    padre_id:      spanById($, 'lblid_padre'),
    madre_nombre:  spanById($, 'lblnombremadre'),
    madre_id:      spanById($, 'lblid_madre'),
    sexo:          spanById($, 'lblsexo') || spanById($, 'lblSexo'),
  };
}

function parseVotacion(html) {
  const $ = cheerio.load(html);
  return {
    provincia:             spanById($, 'lblprovincia'),
    canton:                spanById($, 'lblcanton'),
    distrito_admin:        spanById($, 'lbldistrito_administrativo'),
    distrito_electoral:    spanById($, 'lbldistrito_electoral'),
    centro_votacion:       spanById($, 'lblcentro_votacion'),
    numero_junta:          spanById($, 'lblnumero_junta'),
    numero_elector:        spanById($, 'lblnumero_elector'),
    vencimiento_cedula:    spanById($, 'lblvencimiento_cedula'),
    inscrito_canton_desde: spanById($, 'lblfecha_inscrito'),
    inscrito_dist_desde:   spanById($, 'lblfecha_inscrito_distrito'),
  };
}

function parseMatrimonio(html) {
  const $ = cheerio.load(html);
  return {
    cita:              spanById($, 'lblcita'),
    nombre_conyugue:   spanById($, 'lblnombreconyugue'),
    nombre:            spanById($, 'lblnombre'),
    padre_conyugue:    spanById($, 'lblpadreconyugue'),
    padre:             spanById($, 'lblnombrepadre'),
    madre_conyugue:    spanById($, 'lblmadreconyugue'),
    madre:             spanById($, 'lblnombremadre'),
    fecha_suceso:      spanById($, 'lblfechasuceso'),
    lugar_suceso:      spanById($, 'lbllugarsuceso'),
    tipo_relacion:     spanById($, 'lbltiporelacion'),
    marginal:          spanById($, 'lblLeyendaMarginal'),
    nota:              spanById($, 'lblNota') || null,
  };
}

// Parsear tabla de hijos del bloque asyncpost
function parseHijosGrid(html) {
  const $ = cheerio.load(html);
  const hijos = [];
  // Gridhijos: columnas = Detalles | Cédula | Fecha Nac | Nombre
  $('#Gridhijos tr, table tr').each((i, tr) => {
    if (i === 0) return; // skip header
    const cols = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    if (cols.length >= 3) {
      // quitar columna "Detalles" si está
      const data = cols.filter(c => c && c !== 'Detalles');
      if (data.length >= 2) {
        hijos.push({
          cedula:   data[0] || null,
          fecha_nac:data[1] || null,
          nombre:   data[2] || null,
        });
      }
    }
  });
  return hijos;
}

// Parsear tabla de matrimonios del bloque asyncpost
function parseMatrimoniosGrid(html) {
  const $ = cheerio.load(html);
  const mat = [];
  $('#Gridmatrimonios tr, table tr').each((i, tr) => {
    if (i === 0) return;
    const cols = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    const data = cols.filter(c => c && c !== 'Detalles');
    if (data.length >= 2) {
      mat.push({
        cita:         data[0] || null,
        fecha:        data[1] || null,
        tipo:         data[2] || null,
      });
    }
  });
  return mat;
}

// ════════════════════════════════════════════════════════════
// FLUJO COMPLETO
// ════════════════════════════════════════════════════════════

async function consultaTSE(cedula) {
  let jar = {};
  let vs  = {};

  const headers = (extra = {}) => ({
    'User-Agent':      UA,
    'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'es-CR,es;q=0.9',
    'Cookie':          cookieStr(jar),
    ...extra,
  });

  const headersAsync = (referer) => headers({
    'Content-Type':    'application/x-www-form-urlencoded; charset=UTF-8',
    'X-MicrosoftAjax': 'Delta=true',
    'X-Requested-With':'XMLHttpRequest',
    'Referer':         referer,
  });

  // ── PASO 1: GET consulta_cedula → ViewState inicial ──────────────────────
  console.log(`[TSE] P1 GET consulta_cedula`);
  const r1 = await axios.get(`${BASE}/chc/consulta_cedula.aspx`, { headers: headers(), timeout: 20000, validateStatus: s => s < 500 });
  jar = parseCookies(r1.headers['set-cookie'], jar);
  vs  = extractVS(r1.data);
  if (!vs.__VIEWSTATE) throw new Error('No se obtuvo ViewState inicial');

  // ── PASO 2: POST cédula → redirige a resultado_persona ──────────────────
  console.log(`[TSE] P2 POST cedula=${cedula}`);
  const body2 = new URLSearchParams({
    'ScriptManager1': 'UpdatePanel1|btnConsultaCedula',
    '__LASTFOCUS': '', '__EVENTTARGET': '', '__EVENTARGUMENT': '',
    '__VIEWSTATE': vs.__VIEWSTATE,
    '__VIEWSTATEGENERATOR': vs.__VIEWSTATEGENERATOR,
    '__EVENTVALIDATION': vs.__EVENTVALIDATION,
    'txtcedula': cedula, 'grupo': '', 'comentario': '',
    '__ASYNCPOST': 'true', 'btnConsultaCedula': 'Consultar',
  });
  const r2 = await axios.post(`${BASE}/chc/consulta_cedula.aspx`, body2.toString(), {
    headers: headersAsync(`${BASE}/chc/consulta_cedula.aspx`),
    timeout: 20000, validateStatus: s => s < 500,
  });
  jar = parseCookies(r2.headers['set-cookie'], jar);
  vs  = updateVSFromAsync(r2.data, vs);

  // ── PASO 3: GET resultado_persona → datos persona + ViewState ────────────
  console.log(`[TSE] P3 GET resultado_persona`);
  const r3 = await axios.get(`${BASE}/chc/resultado_persona.aspx`, {
    headers: headers({ 'Referer': `${BASE}/chc/consulta_cedula.aspx` }),
    timeout: 20000, validateStatus: s => s < 500,
  });
  jar = parseCookies(r3.headers['set-cookie'], jar);
  vs  = extractVS(r3.data);
  if (!vs.__VIEWSTATE) throw new Error('No se obtuvo ViewState de resultado_persona');

  const persona = parsePersona(r3.data);
  if (!persona.nombre && !persona.cedula) throw new Error('Cédula no encontrada');

  // ── PASO 4: POST mostrar hijos ───────────────────────────────────────────
  console.log(`[TSE] P4 POST mostrar hijos`);
  const body4 = new URLSearchParams({
    'ScriptManager1': 'ctl07|btnMostrarNacimiento',
    '__LASTFOCUS': '', '__EVENTTARGET': '', '__EVENTARGUMENT': '',
    '__VIEWSTATE': vs.__VIEWSTATE,
    '__VIEWSTATEGENERATOR': vs.__VIEWSTATEGENERATOR,
    '__EVENTVALIDATION': vs.__EVENTVALIDATION,
    'hdnCodigoAccionMarginal': '1', 'hdnFechaSucesoMatrimonio': '',
    '__ASYNCPOST': 'true', 'btnMostrarNacimiento': 'Mostrar',
  });
  const r4 = await axios.post(`${BASE}/chc/resultado_persona.aspx`, body4.toString(), {
    headers: headersAsync(`${BASE}/chc/resultado_persona.aspx`),
    timeout: 20000, validateStatus: s => s < 500,
  });
  jar = parseCookies(r4.headers['set-cookie'], jar);
  vs  = updateVSFromAsync(r4.data, vs);
  const hijos = parseHijosGrid(r4.data);

  // ── PASO 5: POST mostrar matrimonios ─────────────────────────────────────
  console.log(`[TSE] P5 POST mostrar matrimonios`);
  const body5 = new URLSearchParams({
    'ScriptManager1': 'ctl09|btnMostrarMatrimonios',
    'hdnCodigoAccionMarginal': '1', 'hdnFechaSucesoMatrimonio': '',
    '__LASTFOCUS': '', '__EVENTTARGET': '', '__EVENTARGUMENT': '',
    '__VIEWSTATE': vs.__VIEWSTATE,
    '__VIEWSTATEGENERATOR': vs.__VIEWSTATEGENERATOR,
    '__EVENTVALIDATION': vs.__EVENTVALIDATION,
    '__ASYNCPOST': 'true', 'btnMostrarMatrimonios': 'Mostrar',
  });
  const r5 = await axios.post(`${BASE}/chc/resultado_persona.aspx`, body5.toString(), {
    headers: headersAsync(`${BASE}/chc/resultado_persona.aspx`),
    timeout: 20000, validateStatus: s => s < 500,
  });
  jar = parseCookies(r5.headers['set-cookie'], jar);
  vs  = updateVSFromAsync(r5.data, vs);
  const matrimoniosGrid = parseMatrimoniosGrid(r5.data);

  // ── PASO 6: POST mostrar votación ─────────────────────────────────────────
  console.log(`[TSE] P6 POST mostrar votacion`);
  const body6 = new URLSearchParams({
    'ScriptManager1': 'ctl11|btnMostrarVotacion',
    '__LASTFOCUS': '', '__EVENTTARGET': '', '__EVENTARGUMENT': '',
    '__VIEWSTATE': vs.__VIEWSTATE,
    '__VIEWSTATEGENERATOR': vs.__VIEWSTATEGENERATOR,
    '__EVENTVALIDATION': vs.__EVENTVALIDATION,
    'hdnCodigoAccionMarginal': '1', 'hdnFechaSucesoMatrimonio': '',
    '__ASYNCPOST': 'true', 'btnMostrarVotacion': 'Mostrar',
  });
  const r6 = await axios.post(`${BASE}/chc/resultado_persona.aspx`, body6.toString(), {
    headers: headersAsync(`${BASE}/chc/resultado_persona.aspx`),
    timeout: 20000, validateStatus: s => s < 500,
  });
  jar = parseCookies(r6.headers['set-cookie'], jar);
  vs  = updateVSFromAsync(r6.data, vs);

  // ── PASO 7: POST Select$0 en Gridvotacion ─────────────────────────────────
  console.log(`[TSE] P7 POST select votacion`);
  const body7 = new URLSearchParams({
    'ScriptManager1': 'UpdatePanel3|Gridvotacion',
    'hdnCodigoAccionMarginal': '1', 'hdnFechaSucesoMatrimonio': '',
    '__LASTFOCUS': '', '__EVENTTARGET': 'Gridvotacion', '__EVENTARGUMENT': 'Select$0',
    '__VIEWSTATE': vs.__VIEWSTATE,
    '__VIEWSTATEGENERATOR': vs.__VIEWSTATEGENERATOR,
    '__EVENTVALIDATION': vs.__EVENTVALIDATION,
    '__ASYNCPOST': 'true',
  });
  const r7 = await axios.post(`${BASE}/chc/resultado_persona.aspx`, body7.toString(), {
    headers: headersAsync(`${BASE}/chc/resultado_persona.aspx`),
    timeout: 20000, validateStatus: s => s < 500,
  });
  jar = parseCookies(r7.headers['set-cookie'], jar);

  // ── PASO 8: GET detalle_votacion ──────────────────────────────────────────
  console.log(`[TSE] P8 GET detalle_votacion`);
  const r8 = await axios.get(`${BASE}/chc/detalle_votacion.aspx`, {
    headers: headers({ 'Referer': `${BASE}/chc/resultado_persona.aspx` }),
    timeout: 20000, validateStatus: s => s < 500,
  });
  const votacion = parseVotacion(r8.data);

  // ── PASO 9: POST Select$0 en Gridmatrimonios → detalle matrimonio ─────────
  let matrimonioDetalle = null;
  if (matrimoniosGrid.length > 0) {
    console.log(`[TSE] P9 POST select matrimonio`);

    // Necesitamos el VS fresco de resultado_persona (antes del select)
    // Volvemos a cargar resultado_persona para obtener VS actualizado
    const r9a = await axios.get(`${BASE}/chc/resultado_persona.aspx`, {
      headers: headers({ 'Referer': `${BASE}/chc/detalle_votacion.aspx` }),
      timeout: 20000, validateStatus: s => s < 500,
    });
    jar = parseCookies(r9a.headers['set-cookie'], jar);
    const vs9 = extractVS(r9a.data);

    if (vs9.__VIEWSTATE) {
      // Re-cargar hijos y matrimonios para tener VS correcto con tablas visibles
      // POST matrimonios
      const bodyM = new URLSearchParams({
        'ScriptManager1': 'ctl09|btnMostrarMatrimonios',
        'hdnCodigoAccionMarginal': '1', 'hdnFechaSucesoMatrimonio': '',
        '__LASTFOCUS': '', '__EVENTTARGET': '', '__EVENTARGUMENT': '',
        '__VIEWSTATE': vs9.__VIEWSTATE,
        '__VIEWSTATEGENERATOR': vs9.__VIEWSTATEGENERATOR,
        '__EVENTVALIDATION': vs9.__EVENTVALIDATION,
        '__ASYNCPOST': 'true', 'btnMostrarMatrimonios': 'Mostrar',
      });
      const rM = await axios.post(`${BASE}/chc/resultado_persona.aspx`, bodyM.toString(), {
        headers: headersAsync(`${BASE}/chc/resultado_persona.aspx`),
        timeout: 20000, validateStatus: s => s < 500,
      });
      jar = parseCookies(rM.headers['set-cookie'], jar);
      const vsM = updateVSFromAsync(rM.data, { ...vs9 });

      // POST Select$0 Gridmatrimonios
      const bodyS = new URLSearchParams({
        'ScriptManager1': 'UpdatePanel2|Gridmatrimonios',
        'hdnCodigoAccionMarginal': '1', 'hdnFechaSucesoMatrimonio': '',
        '__LASTFOCUS': '', '__EVENTTARGET': 'Gridmatrimonios', '__EVENTARGUMENT': 'Select$0',
        '__VIEWSTATE': vsM.__VIEWSTATE,
        '__VIEWSTATEGENERATOR': vsM.__VIEWSTATEGENERATOR,
        '__EVENTVALIDATION': vsM.__EVENTVALIDATION,
        '__ASYNCPOST': 'true',
      });
      const rS = await axios.post(`${BASE}/chc/resultado_persona.aspx`, bodyS.toString(), {
        headers: headersAsync(`${BASE}/chc/resultado_persona.aspx`),
        timeout: 20000, validateStatus: s => s < 500,
      });
      jar = parseCookies(rS.headers['set-cookie'], jar);

      // GET detalle matrimonio
      const r9b = await axios.get(`${BASE}/chc/detalle_matrimonio_extranjero.aspx`, {
        headers: headers({ 'Referer': `${BASE}/chc/resultado_persona.aspx` }),
        timeout: 20000, validateStatus: s => s < 500,
      });
      matrimonioDetalle = parseMatrimonio(r9b.data);
    }
  }

  // ── Resultado limpio ──────────────────────────────────────────────────────
  return {
    persona,
    votacion,
    hijos,
    matrimonios: {
      lista:   matrimoniosGrid,
      detalle: matrimonioDetalle,
    },
  };
}

// ════════════════════════════════════════════════════════════
// RUTAS
// ════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.json({ estado: true, mensaje: 'TSE Costa Rica API', uso: '/api/tse/:cedula' });
});

app.get('/api/tse/:cedula', async (req, res) => {
  const { cedula } = req.params;
  if (!/^\d{9,12}$/.test(cedula)) {
    return res.json({ estado: false, mensaje: 'Cédula inválida. Entre 9 y 12 dígitos.' });
  }

  console.log(`\n[API] /api/tse/${cedula}`);
  const t = Date.now();

  try {
    const datos = await consultaTSE(cedula);
    res.json({ estado: true, tiempo_ms: Date.now() - t, cedula, ...datos });
  } catch (e) {
    console.error('[API] ❌', e.message);
    res.status(500).json({ estado: false, mensaje: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 TSE API en puerto ${PORT}`);
  console.log(`   Prueba: http://localhost:${PORT}/api/tse/115260363`);
});
