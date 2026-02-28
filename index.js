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
// HTTP CLIENT con cookies persistentes
// ════════════════════════════════════════════════════════════

const BASE_URL = 'https://servicioselectorales.tse.go.cr';

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CR,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
};

// Extraer cookies de response headers
function parseCookies(setCookieHeaders, existing = {}) {
  if (!setCookieHeaders) return existing;
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const c of arr) {
    const part = c.split(';')[0];
    const [name, ...rest] = part.split('=');
    existing[name.trim()] = rest.join('=').trim();
  }
  return existing;
}

function cookieString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ════════════════════════════════════════════════════════════
// EXTRAER VIEWSTATE + EVENTVALIDATION del HTML
// ════════════════════════════════════════════════════════════

function extractViewState(html) {
  const $ = cheerio.load(html);
  return {
    __VIEWSTATE:          $('#__VIEWSTATE').val()          || $('input[name="__VIEWSTATE"]').val()          || '',
    __VIEWSTATEGENERATOR: $('#__VIEWSTATEGENERATOR').val() || $('input[name="__VIEWSTATEGENERATOR"]').val() || '',
    __EVENTVALIDATION:    $('#__EVENTVALIDATION').val()    || $('input[name="__EVENTVALIDATION"]').val()    || '',
  };
}

// ════════════════════════════════════════════════════════════
// EXTRAER DATOS DE SPANS del HTML
// ════════════════════════════════════════════════════════════

function extractSpanData($) {
  const data = {};
  $('span').each((_, el) => {
    const text = $(el).text().trim();
    const id   = $(el).attr('id') || '';
    if (text && text.length > 1 && !/^[\s\u00a0]+$/.test(text)) {
      if (id) {
        data[id] = text;
      }
    }
  });
  return data;
}

function extractTableData($, tableId) {
  const rows = [];
  const table = tableId ? $(`#${tableId}`) : $('table').first();
  table.find('tr').each((_, tr) => {
    const cells = [];
    $(tr).find('td, th').each((_, td) => {
      const text = $(td).text().replace(/\s+/g, ' ').trim();
      if (text) cells.push(text);
    });
    if (cells.length > 0) rows.push(cells);
  });
  return rows;
}

// ════════════════════════════════════════════════════════════
// PARSEAR RESPUESTA ASYNCPOST (formato especial de ASP.NET)
// El response tiene formato: length|type|id|content|...
// ════════════════════════════════════════════════════════════

function parseAsyncPostResponse(text) {
  // Extraer ViewState actualizado del response asyncpost
  const vsMatch  = text.match(/__VIEWSTATE\|([^|]+)\|/);
  const vsgMatch = text.match(/__VIEWSTATEGENERATOR\|([^|]+)\|/);
  const evMatch  = text.match(/__EVENTVALIDATION\|([^|]+)\|/);

  // Extraer bloques HTML del response
  // Formato: longitudBloque|updatePanel|id|htmlContent|
  const htmlBlocks = [];
  const blockRegex = /\d+\|updatePanel\|[^|]+\|([\s\S]*?)(?=\d+\|(?:updatePanel|hiddenField|formAction|asyncPostBackControlIDs|pageTitle|focus|scriptBlock|expando|error|pageRedirect)|$)/g;
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    if (m[1] && m[1].trim().length > 5) htmlBlocks.push(m[1]);
  }

  return {
    viewState:          vsMatch  ? vsMatch[1]  : null,
    viewStateGenerator: vsgMatch ? vsgMatch[1] : null,
    eventValidation:    evMatch  ? evMatch[1]  : null,
    htmlBlocks,
    raw: text,
  };
}

// ════════════════════════════════════════════════════════════
// PARSEAR DATOS PERSONA del HTML resultado_persona
// ════════════════════════════════════════════════════════════

function parseDatosPersona(html) {
  const $ = cheerio.load(html);
  const spans = extractSpanData($);

  // Mapear IDs conocidos a nombres legibles
  // (los IDs reales los descubrimos del HTML)
  const resultado = {};

  // Buscar todos los labels + spans adyacentes (patrón típico de WebForms)
  $('td').each((_, td) => {
    const label = $(td).find('label, span.etiqueta, b').first().text().trim();
    const value = $(td).find('span:not(.etiqueta)').last().text().trim();
    if (label && value && label !== value) {
      const key = label.replace(/[:\s]+$/, '').trim();
      resultado[key] = value;
    }
  });

  // También guardar todos los spans con ID directamente
  for (const [id, val] of Object.entries(spans)) {
    if (!id.includes('ScriptManager') && !id.includes('Update')) {
      resultado[id] = val;
    }
  }

  // Extraer tabla de matrimonios si existe
  const matrimonios = extractTableData($, 'Gridmatrimonios');
  if (matrimonios.length > 0) resultado.matrimonios = matrimonios;

  // Extraer tabla de hijos si existe
  const hijos = extractTableData($, 'Gridhijos');
  if (hijos.length > 0) resultado.hijos = hijos;

  // Extraer tabla de votación si existe
  const votacion = extractTableData($, 'Gridvotacion');
  if (votacion.length > 0) resultado.votacion = votacion;

  return resultado;
}

// ════════════════════════════════════════════════════════════
// PARSEAR DATOS VOTACIÓN del detalle_votacion
// ════════════════════════════════════════════════════════════

function parseDatosVotacion(html) {
  const $      = cheerio.load(html);
  const spans  = extractSpanData($);
  const tables = [];

  $('table').each((_, table) => {
    const rows = extractTableData($, $(table).attr('id'));
    if (rows.length > 0) tables.push(rows);
  });

  return { spans, tables };
}

// ════════════════════════════════════════════════════════════
// FLUJO COMPLETO DE CONSULTA
// ════════════════════════════════════════════════════════════

async function consultaTSE(cedula) {
  let cookies = {};
  let vs      = {};

  // ── PASO 1: GET página inicial — obtener ViewState y cookies ──────────────
  console.log(`[TSE] PASO 1: GET consulta_cedula cedula=${cedula}`);
  const resp1 = await axios.get(`${BASE_URL}/chc/consulta_cedula.aspx`, {
    headers:          { ...HEADERS },
    timeout:          20000,
    validateStatus:   s => s < 500,
  });

  cookies = parseCookies(resp1.headers['set-cookie'], cookies);
  vs      = extractViewState(resp1.data);
  console.log(`[TSE] PASO 1: cookies=${Object.keys(cookies)} vs=${!!vs.__VIEWSTATE}`);

  if (!vs.__VIEWSTATE) throw new Error('No se pudo obtener ViewState inicial');

  // ── PASO 2: POST consulta con cédula ─────────────────────────────────────
  console.log(`[TSE] PASO 2: POST consulta cedula`);

  const body2 = new URLSearchParams({
    'ScriptManager1':      'UpdatePanel1|btnConsultaCedula',
    '__LASTFOCUS':         '',
    '__EVENTTARGET':       '',
    '__EVENTARGUMENT':     '',
    '__VIEWSTATE':          vs.__VIEWSTATE,
    '__VIEWSTATEGENERATOR': vs.__VIEWSTATEGENERATOR,
    '__EVENTVALIDATION':    vs.__EVENTVALIDATION,
    'txtcedula':            cedula,
    'grupo':                '',
    'comentario':           '',
    '__ASYNCPOST':          'true',
    'btnConsultaCedula':    'Consultar',
  });

  const resp2 = await axios.post(`${BASE_URL}/chc/consulta_cedula.aspx`, body2.toString(), {
    headers: {
      ...HEADERS,
      'Content-Type':    'application/x-www-form-urlencoded; charset=UTF-8',
      'X-MicrosoftAjax': 'Delta=true',
      'X-Requested-With':'XMLHttpRequest',
      'Referer':         `${BASE_URL}/chc/consulta_cedula.aspx`,
      'Cookie':          cookieString(cookies),
    },
    timeout:        20000,
    validateStatus: s => s < 500,
  });

  cookies = parseCookies(resp2.headers['set-cookie'], cookies);
  const parsed2 = parseAsyncPostResponse(resp2.data);
  console.log(`[TSE] PASO 2: blocks=${parsed2.htmlBlocks.length} redirect=${resp2.data.includes('resultado_persona')}`);

  // Actualizar ViewState si viene en el asyncpost response
  if (parsed2.viewState)          vs.__VIEWSTATE          = parsed2.viewState;
  if (parsed2.viewStateGenerator) vs.__VIEWSTATEGENERATOR = parsed2.viewStateGenerator;
  if (parsed2.eventValidation)    vs.__EVENTVALIDATION    = parsed2.eventValidation;

  // ── PASO 3: GET resultado_persona ─────────────────────────────────────────
  console.log(`[TSE] PASO 3: GET resultado_persona`);
  const resp3 = await axios.get(`${BASE_URL}/chc/resultado_persona.aspx`, {
    headers: {
      ...HEADERS,
      'Referer': `${BASE_URL}/chc/consulta_cedula.aspx`,
      'Cookie':  cookieString(cookies),
    },
    timeout:        20000,
    validateStatus: s => s < 500,
  });

  cookies = parseCookies(resp3.headers['set-cookie'], cookies);
  vs      = extractViewState(resp3.data);
  console.log(`[TSE] PASO 3: status=${resp3.status} vs=${!!vs.__VIEWSTATE}`);

  if (!vs.__VIEWSTATE) throw new Error('No se pudo obtener ViewState de resultado_persona');

  // Parsear datos persona del HTML
  const datosPersona = parseDatosPersona(resp3.data);
  console.log(`[TSE] PASO 3: datosPersona keys=${Object.keys(datosPersona).length}`);

  // ── PASO 4: POST mostrar votacion ─────────────────────────────────────────
  console.log(`[TSE] PASO 4: POST mostrar votacion`);

  const body4 = new URLSearchParams({
    'ScriptManager1':         'ctl11|btnMostrarVotacion',
    '__LASTFOCUS':            '',
    '__EVENTTARGET':          '',
    '__EVENTARGUMENT':        '',
    '__VIEWSTATE':             vs.__VIEWSTATE,
    '__VIEWSTATEGENERATOR':    vs.__VIEWSTATEGENERATOR,
    '__EVENTVALIDATION':       vs.__EVENTVALIDATION,
    'hdnCodigoAccionMarginal': '1',
    'hdnFechaSucesoMatrimonio':'',
    '__ASYNCPOST':             'true',
    'btnMostrarVotacion':      'Mostrar',
  });

  const resp4 = await axios.post(`${BASE_URL}/chc/resultado_persona.aspx`, body4.toString(), {
    headers: {
      ...HEADERS,
      'Content-Type':    'application/x-www-form-urlencoded; charset=UTF-8',
      'X-MicrosoftAjax': 'Delta=true',
      'X-Requested-With':'XMLHttpRequest',
      'Referer':         `${BASE_URL}/chc/resultado_persona.aspx`,
      'Cookie':          cookieString(cookies),
    },
    timeout:        20000,
    validateStatus: s => s < 500,
  });

  cookies = parseCookies(resp4.headers['set-cookie'], cookies);
  const parsed4 = parseAsyncPostResponse(resp4.data);
  console.log(`[TSE] PASO 4: blocks=${parsed4.htmlBlocks.length}`);

  if (parsed4.viewState)          vs.__VIEWSTATE          = parsed4.viewState;
  if (parsed4.viewStateGenerator) vs.__VIEWSTATEGENERATOR = parsed4.viewStateGenerator;
  if (parsed4.eventValidation)    vs.__EVENTVALIDATION    = parsed4.eventValidation;

  // Parsear datos de votación del bloque HTML del asyncpost
  let datosVotacionGrid = [];
  for (const block of parsed4.htmlBlocks) {
    const $b = cheerio.load(block);
    const rows = extractTableData($b);
    if (rows.length > 0) datosVotacionGrid.push(...rows);
  }

  // ── PASO 5: POST abrir detalle votacion (Select$0) ────────────────────────
  console.log(`[TSE] PASO 5: POST abrir detalle votacion`);

  const body5 = new URLSearchParams({
    'ScriptManager1':         'UpdatePanel3|Gridvotacion',
    'hdnCodigoAccionMarginal': '1',
    'hdnFechaSucesoMatrimonio':'',
    '__LASTFOCUS':            '',
    '__EVENTTARGET':          'Gridvotacion',
    '__EVENTARGUMENT':        'Select$0',
    '__VIEWSTATE':             vs.__VIEWSTATE,
    '__VIEWSTATEGENERATOR':    vs.__VIEWSTATEGENERATOR,
    '__EVENTVALIDATION':       vs.__EVENTVALIDATION,
    '__ASYNCPOST':             'true',
  });

  const resp5 = await axios.post(`${BASE_URL}/chc/resultado_persona.aspx`, body5.toString(), {
    headers: {
      ...HEADERS,
      'Content-Type':    'application/x-www-form-urlencoded; charset=UTF-8',
      'X-MicrosoftAjax': 'Delta=true',
      'X-Requested-With':'XMLHttpRequest',
      'Referer':         `${BASE_URL}/chc/resultado_persona.aspx`,
      'Cookie':          cookieString(cookies),
    },
    timeout:        20000,
    validateStatus: s => s < 500,
    maxRedirects:   5,
  });

  cookies = parseCookies(resp5.headers['set-cookie'], cookies);
  console.log(`[TSE] PASO 5: status=${resp5.status}`);

  // ── PASO 6: GET detalle_votacion ──────────────────────────────────────────
  console.log(`[TSE] PASO 6: GET detalle_votacion`);
  const resp6 = await axios.get(`${BASE_URL}/chc/detalle_votacion.aspx`, {
    headers: {
      ...HEADERS,
      'Referer': `${BASE_URL}/chc/resultado_persona.aspx`,
      'Cookie':  cookieString(cookies),
    },
    timeout:        20000,
    validateStatus: s => s < 500,
  });

  console.log(`[TSE] PASO 6: status=${resp6.status}`);
  const datosVotacion = parseDatosVotacion(resp6.data);

  // ── Consolidar resultado ──────────────────────────────────────────────────
  return {
    cedula,
    persona:         datosPersona,
    votacion_grid:   datosVotacionGrid,
    votacion_detalle: {
      spans:  datosVotacion.spans,
      tablas: datosVotacion.tables,
    },
  };
}

// ════════════════════════════════════════════════════════════
// RUTAS
// ════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.json({
    estado: true,
    mensaje: 'TSE Costa Rica API online',
    uso: [
      'GET /api/tse/:cedula',
      'GET /api/tse/:cedula?apikey=KEY (si tienes API_KEY)',
    ],
  });
});

app.get('/api/tse/:cedula', async (req, res) => {
  const { cedula } = req.params;

  if (!/^\d{9,12}$/.test(cedula)) {
    return res.json({ estado: false, mensaje: 'Cédula inválida. Debe tener entre 9 y 12 dígitos.' });
  }

  console.log(`\n[API] GET /api/tse/${cedula}`);
  const start = Date.now();

  try {
    const datos = await consultaTSE(cedula);
    res.json({
      estado:    true,
      tiempo_ms: Date.now() - start,
      cedula,
      ...datos,
    });
  } catch (err) {
    console.error('[API] ❌', err.message);
    res.status(500).json({
      estado:  false,
      mensaje: 'Error interno: ' + err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 TSE API corriendo en puerto ${PORT}`);
  console.log(`   http://localhost:${PORT}/api/tse/115260363`);
});
