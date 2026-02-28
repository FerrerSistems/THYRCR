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
const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

function s($, id) {
  const v = $(`#${id}`).text().trim();
  return v || null;
}

// ════════════════════════════════════════════════════════════
// PARSERS
// ════════════════════════════════════════════════════════════

function parsePersona(html) {
  const $ = cheerio.load(html);
  return {
    cedula:       s($, 'lblcedula'),
    nombre:       s($, 'lblnombrecompleto'),
    fecha_nac:    s($, 'lblfechaNacimiento'),
    edad:         s($, 'lbledad'),
    nacionalidad: s($, 'lblnacionalidad'),
    estado_civil: s($, 'lblestadocivil') || s($, 'lblEstadoCivil'),
    sexo:         s($, 'lblsexo')        || s($, 'lblSexo'),
    marginal:     s($, 'lblLeyendaMarginal'),
    padre_nombre: s($, 'lblnombrepadre'),
    padre_id:     s($, 'lblid_padre'),
    madre_nombre: s($, 'lblnombremadre'),
    madre_id:     s($, 'lblid_madre'),
  };
}

function parseVotacion(html) {
  const $ = cheerio.load(html);
  return {
    provincia:          s($, 'lblprovincia'),
    canton:             s($, 'lblcanton'),
    distrito_admin:     s($, 'lbldistrito_administrativo'),
    distrito_electoral: s($, 'lbldistrito_electoral'),
    centro_votacion:    s($, 'lblcentro_votacion'),
    numero_junta:       s($, 'lblnumero_junta'),
    numero_elector:     s($, 'lblnumero_elector'),
    vencimiento_cedula: s($, 'lblvencimiento_cedula'),
    inscrito_canton:    s($, 'lblfecha_inscrito'),
    inscrito_dist:      s($, 'lblfecha_inscrito_distrito'),
  };
}

function parseMatrimonio(html) {
  const $ = cheerio.load(html);
  return {
    cita:            s($, 'lblcita'),
    nombre_conyugue: s($, 'lblnombreconyugue'),
    nombre:          s($, 'lblnombre'),
    padre_conyugue:  s($, 'lblpadreconyugue'),
    madre_conyugue:  s($, 'lblmadreconyugue'),
    padre:           s($, 'lblnombrepadre'),
    madre:           s($, 'lblnombremadre'),
    fecha_suceso:    s($, 'lblfechasuceso'),
    lugar_suceso:    s($, 'lbllugarsuceso'),
    tipo_relacion:   s($, 'lbltiporelacion'),
    marginal:        s($, 'lblLeyendaMarginal'),
  };
}

function parseNacimiento(html) {
  const $ = cheerio.load(html);
  return {
    cedula:           s($, 'lblcedula'),
    nombre:           s($, 'lblnombre'),
    primer_apellido:  s($, 'lblprimer_apellido'),
    segundo_apellido: s($, 'lblsegundo_apellido'),
    conocido_como:    s($, 'lblconocido_como'),
    fecha_nacimiento: s($, 'lblfecha_nacimiento'),
    lugar_nacimiento: s($, 'lbllugar_nacimiento'),
    nacionalidad:     s($, 'lblnacionalidad'),
    sexo:             s($, 'lblgenero'),
    padre_nombre:     s($, 'lblnombre_padre'),
    padre_id:         s($, 'lblid_padre'),
    madre_nombre:     s($, 'lblnombre_madre'),
    madre_id:         s($, 'lblid_madre'),
    empadronado:      s($, 'lblempadronado'),
    fallecido:        s($, 'lblfallecido'),
    marginal:         s($, 'lblLeyendaMarginal'),
  };
}

// ── Parser para detalle_defuncion.aspx ───────────────────────────────────────
function parseDefuncion(html) {
  const $ = cheerio.load(html);
  return {
    cita:             s($, 'lblcita'),
    fecha_defuncion:  s($, 'lblfecha_defuncion'),
    nombre:           s($, 'lblnombre'),
    conocido_como:    s($, 'lblconocido_como'),
    lugar_suceso:     s($, 'lblLugar_suceso'),
    marginal:         s($, 'lblLeyendaMarginal'),
  };
}

function parseHijosGrid(html) {
  const $ = cheerio.load(html);
  const hijos = [];
  $('#Gridhijos tr').each((i, tr) => {
    if (i === 0) return;
    const cols = $(tr).find('td').map((_, td) => $(td).text().trim()).get()
                      .filter(c => c && c !== 'Detalles');
    if (cols.length >= 2) {
      hijos.push({ cedula: cols[0] || null, fecha_nac: cols[1] || null, nombre: cols[2] || null });
    }
  });
  return hijos;
}

function parseMatrimoniosGrid(html) {
  const $ = cheerio.load(html);
  const mat = [];
  $('#Gridmatrimonios tr').each((i, tr) => {
    if (i === 0) return;
    const cols = $(tr).find('td').map((_, td) => $(td).text().trim()).get()
                      .filter(c => c && c !== 'Detalles');
    if (cols.length >= 1) {
      mat.push({ cita: cols[0] || null, fecha: cols[1] || null, tipo: cols[2] || null });
    }
  });
  return mat;
}

// ════════════════════════════════════════════════════════════
// HTTP CLIENT
// ════════════════════════════════════════════════════════════

function makeClient(jar) {
  const h = (extra = {}) => ({
    'User-Agent':      UA,
    'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'es-CR,es;q=0.9',
    'Cookie':          cookieStr(jar),
    ...extra,
  });
  const hAsync = (referer) => h({
    'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
    'X-MicrosoftAjax':  'Delta=true',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer':          referer,
  });
  return { h, hAsync };
}

async function get(url, headers) {
  return axios.get(url, { headers, timeout: 25000, validateStatus: s => s < 500 });
}
async function post(url, body, headers) {
  return axios.post(url, body.toString(), { headers, timeout: 25000, validateStatus: s => s < 500 });
}

// ════════════════════════════════════════════════════════════
// FLUJO COMPLETO
// ════════════════════════════════════════════════════════════

async function consultaTSE(cedula) {
  let jar = {};
  let vs  = {};

  // ── P1: GET consulta_cedula ───────────────────────────────────────────────
  console.log(`[TSE] P1 GET consulta_cedula`);
  const { h, hAsync } = makeClient(jar);
  const r1 = await get(`${BASE}/chc/consulta_cedula.aspx`, h());
  jar = parseCookies(r1.headers['set-cookie'], jar);
  vs  = extractVS(r1.data);
  if (!vs.__VIEWSTATE) throw new Error('No se obtuvo ViewState inicial');

  // ── P2: POST cédula ───────────────────────────────────────────────────────
  console.log(`[TSE] P2 POST cedula=${cedula}`);
  const b2 = new URLSearchParams({
    'ScriptManager1':'UpdatePanel1|btnConsultaCedula',
    '__LASTFOCUS':'','__EVENTTARGET':'','__EVENTARGUMENT':'',
    '__VIEWSTATE':vs.__VIEWSTATE,'__VIEWSTATEGENERATOR':vs.__VIEWSTATEGENERATOR,
    '__EVENTVALIDATION':vs.__EVENTVALIDATION,
    'txtcedula':cedula,'grupo':'','comentario':'',
    '__ASYNCPOST':'true','btnConsultaCedula':'Consultar',
  });
  const r2 = await post(`${BASE}/chc/consulta_cedula.aspx`, b2, makeClient(jar).hAsync(`${BASE}/chc/consulta_cedula.aspx`));
  jar = parseCookies(r2.headers['set-cookie'], jar);
  vs  = updateVSFromAsync(r2.data, vs);

  // ── P3: GET resultado_persona ─────────────────────────────────────────────
  console.log(`[TSE] P3 GET resultado_persona`);
  const r3 = await get(`${BASE}/chc/resultado_persona.aspx`, makeClient(jar).h({ 'Referer': `${BASE}/chc/consulta_cedula.aspx` }));
  jar = parseCookies(r3.headers['set-cookie'], jar);
  vs  = extractVS(r3.data);
  if (!vs.__VIEWSTATE) throw new Error('No se obtuvo ViewState de resultado_persona');

  const persona = parsePersona(r3.data);
  if (!persona.nombre && !persona.cedula) throw new Error('Cédula no encontrada en el TSE');

  // ── Detectar si la persona está registrada como fallecida ─────────────────
  const esDefuncion = r3.data.includes('small;">Fecha de Defunci\u00f3n:</span>') ||
                      r3.data.includes('Fecha de Defunci&oacute;n:') ||
                      r3.data.includes('>Fecha de Defunción:<');

  // Si es defunción, ejecutar flujo especial y retornar
  if (esDefuncion) {
    console.log(`[TSE] Defunción detectada — ejecutando flujo defuncion`);
    let defuncion = null;
    try {
      // POST cmbdefuncion como __EVENTTARGET para activar el panel
      const bdef = new URLSearchParams({
        'ScriptManager1':        'UpdatePanel4|cmbdefuncion',
        '__LASTFOCUS':           '',
        '__EVENTTARGET':         'cmbdefuncion',
        '__EVENTARGUMENT':       '',
        '__VIEWSTATE':           vs.__VIEWSTATE,
        '__VIEWSTATEGENERATOR':  vs.__VIEWSTATEGENERATOR,
        '__EVENTVALIDATION':     vs.__EVENTVALIDATION,
        'hdnCodigoAccionMarginal': '1',
        'hdnFechaSucesoMatrimonio': '',
        '__ASYNCPOST':           'true',
      });
      const rdef = await post(
        `${BASE}/chc/resultado_persona.aspx`,
        bdef,
        makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`)
      );
      jar = parseCookies(rdef.headers['set-cookie'], jar);

      // GET detalle_defuncion
      console.log(`[TSE] GET detalle_defuncion`);
      const rdetdef = await get(
        `${BASE}/chc/detalle_defuncion.aspx`,
        makeClient(jar).h({ 'Referer': `${BASE}/chc/resultado_persona.aspx` })
      );
      defuncion = parseDefuncion(rdetdef.data);
    } catch (e) {
      console.log(`[TSE] ⚠️ defuncion detalle falló: ${e.message}`);
    }

    return {
      persona,
      defuncion,
      nacimiento:  null,
      votacion:    null,
      hijos:       [],
      matrimonios: { lista: [], detalle: null },
    };
  }

  // Helper para POST async desde resultado_persona
  const postRP = async (bodyParams) => {
    const body = new URLSearchParams({
      '__LASTFOCUS':'','__EVENTTARGET':'','__EVENTARGUMENT':'',
      '__VIEWSTATE':vs.__VIEWSTATE,
      '__VIEWSTATEGENERATOR':vs.__VIEWSTATEGENERATOR,
      '__EVENTVALIDATION':vs.__EVENTVALIDATION,
      'hdnCodigoAccionMarginal':'1','hdnFechaSucesoMatrimonio':'',
      '__ASYNCPOST':'true',
      ...bodyParams,
    });
    const r = await post(`${BASE}/chc/resultado_persona.aspx`, body,
      makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`));
    jar = parseCookies(r.headers['set-cookie'], jar);
    vs  = updateVSFromAsync(r.data, vs);
    return r;
  };

  // ── P4: POST mostrar hijos ────────────────────────────────────────────────
  console.log(`[TSE] P4 mostrar hijos`);
  const r4 = await postRP({ 'ScriptManager1':'ctl07|btnMostrarNacimiento', 'btnMostrarNacimiento':'Mostrar' });
  const hijos = parseHijosGrid(r4.data);

  // ── P5: POST mostrar matrimonios ──────────────────────────────────────────
  console.log(`[TSE] P5 mostrar matrimonios`);
  const r5 = await postRP({ 'ScriptManager1':'ctl09|btnMostrarMatrimonios', 'btnMostrarMatrimonios':'Mostrar' });
  const matrimoniosGrid = parseMatrimoniosGrid(r5.data);

  // ── P6: POST mostrar votación ─────────────────────────────────────────────
  console.log(`[TSE] P6 mostrar votacion`);
  await postRP({ 'ScriptManager1':'ctl11|btnMostrarVotacion', 'btnMostrarVotacion':'Mostrar' });

  // ── P7: POST Select$0 Gridvotacion ────────────────────────────────────────
  console.log(`[TSE] P7 select votacion`);
  await postRP({ 'ScriptManager1':'UpdatePanel3|Gridvotacion', '__EVENTTARGET':'Gridvotacion', '__EVENTARGUMENT':'Select$0' });

  // ── P8: GET detalle_votacion ──────────────────────────────────────────────
  console.log(`[TSE] P8 GET detalle_votacion`);
  const r8 = await get(`${BASE}/chc/detalle_votacion.aspx`,
    makeClient(jar).h({ 'Referer': `${BASE}/chc/resultado_persona.aspx` }));
  const votacion = parseVotacion(r8.data);

  // ── P9: POST LinkButton11 → detalle_nacimiento propia persona ────────────
  console.log(`[TSE] P9 GET resultado_persona (refrescar para nacimiento)`);
  const r9a = await get(`${BASE}/chc/resultado_persona.aspx`,
    makeClient(jar).h({ 'Referer': `${BASE}/chc/detalle_votacion.aspx` }));
  jar = parseCookies(r9a.headers['set-cookie'], jar);
  const vs9 = extractVS(r9a.data);
  let nacimiento = null;

  if (vs9.__VIEWSTATE) {
    console.log(`[TSE] P9b POST LinkButton11`);
    const b9 = new URLSearchParams({
      'ScriptManager1':'UpdatePanel4|LinkButton11',
      '__LASTFOCUS':'','__EVENTTARGET':'LinkButton11','__EVENTARGUMENT':'',
      '__VIEWSTATE':vs9.__VIEWSTATE,
      '__VIEWSTATEGENERATOR':vs9.__VIEWSTATEGENERATOR,
      '__EVENTVALIDATION':vs9.__EVENTVALIDATION,
      'hdnCodigoAccionMarginal':'1','hdnFechaSucesoMatrimonio':'',
      '__ASYNCPOST':'true',
    });
    const r9b = await post(`${BASE}/chc/resultado_persona.aspx`, b9,
      makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`));
    jar = parseCookies(r9b.headers['set-cookie'], jar);

    console.log(`[TSE] P9c GET detalle_nacimiento`);
    const r9c = await get(`${BASE}/chc/detalle_nacimiento.aspx`,
      makeClient(jar).h({ 'Referer': `${BASE}/chc/resultado_persona.aspx` }));
    nacimiento = parseNacimiento(r9c.data);
  }

  // ── P10: detalle matrimonio (si hay) ──────────────────────────────────────
  let matrimonioDetalle = null;
  if (matrimoniosGrid.length > 0) {
    console.log(`[TSE] P10 detalle matrimonio`);
    try {
      const r10a = await get(`${BASE}/chc/resultado_persona.aspx`,
        makeClient(jar).h({ 'Referer': `${BASE}/chc/detalle_nacimiento.aspx` }));
      jar = parseCookies(r10a.headers['set-cookie'], jar);
      const vs10 = extractVS(r10a.data);

      if (vs10.__VIEWSTATE) {
        const bm = new URLSearchParams({
          'ScriptManager1':'ctl09|btnMostrarMatrimonios',
          '__LASTFOCUS':'','__EVENTTARGET':'','__EVENTARGUMENT':'',
          '__VIEWSTATE':vs10.__VIEWSTATE,'__VIEWSTATEGENERATOR':vs10.__VIEWSTATEGENERATOR,
          '__EVENTVALIDATION':vs10.__EVENTVALIDATION,
          'hdnCodigoAccionMarginal':'1','hdnFechaSucesoMatrimonio':'',
          '__ASYNCPOST':'true','btnMostrarMatrimonios':'Mostrar',
        });
        const rm = await post(`${BASE}/chc/resultado_persona.aspx`, bm,
          makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`));
        jar = parseCookies(rm.headers['set-cookie'], jar);
        const vsm = updateVSFromAsync(rm.data, { ...vs10 });

        const bs = new URLSearchParams({
          'ScriptManager1':'UpdatePanel2|Gridmatrimonios',
          '__LASTFOCUS':'','__EVENTTARGET':'Gridmatrimonios','__EVENTARGUMENT':'Select$0',
          '__VIEWSTATE':vsm.__VIEWSTATE,'__VIEWSTATEGENERATOR':vsm.__VIEWSTATEGENERATOR,
          '__EVENTVALIDATION':vsm.__EVENTVALIDATION,
          'hdnCodigoAccionMarginal':'1','hdnFechaSucesoMatrimonio':'',
          '__ASYNCPOST':'true',
        });
        const rs = await post(`${BASE}/chc/resultado_persona.aspx`, bs,
          makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`));
        jar = parseCookies(rs.headers['set-cookie'], jar);

        const rmat = await get(`${BASE}/chc/detalle_matrimonio_extranjero.aspx`,
          makeClient(jar).h({ 'Referer': `${BASE}/chc/resultado_persona.aspx` }));
        matrimonioDetalle = parseMatrimonio(rmat.data);
      }
    } catch (e) {
      console.log(`[TSE] P10 ⚠️ matrimonio detalle falló: ${e.message}`);
    }
  }

  return {
    persona,
    defuncion:   null,
    nacimiento,
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
  res.json({ estado: true, mensaje: 'TSE Costa Rica API v3', uso: '/api/tse/:cedula' });
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
  console.log(`🚀 TSE API v3 en puerto ${PORT}`);
  console.log(`   http://localhost:${PORT}/api/tse/115260363`);
});
