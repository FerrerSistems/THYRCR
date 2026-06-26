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

const BASE = 'https://servicioselectorales.tse.go.cr';
const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// ════════════════════════════════════════════════════════════
// COOKIES BASE — copiar de tu navegador cuando expiren
// ════════════════════════════════════════════════════════════
const COOKIES_BASE = '__ssds=0; __ssuzjsr0=a9be0cd8e; __uzmbj0=1761508748; __uzmlj0=aXessLrBHZU39rtdriuUI7+S+LgMlsZhWGAfQqpKF6g=; _ga=GA1.1.1881706855.1727492922; __uzma=7c359469-dc71-4e9d-95d0-7f3edcbcf362; __uzmb=1782439676; __uzme=6585; __uzmaj0=7c359469-dc71-4e9d-95d0-7f3edcbcf362; __utmc=258596104; __utmz=258596104.1782439716.7.1.utmccn=(direct)|utmcsr=(direct)|utmcmd=(none); _ga_EMVSBHTSQQ=GS2.1.s1782439664$o2$g0$t1782441432$j60$l0$h0; __uzmcj0=352902244551; __uzmdj0=1782441699; __uzmfj0=7f90007c359469-dc71-4e9d-95d0-7f3edcbcf3628-176150874817520932951662-003b7fb4e731591c51522; uzmxj=7f900037bceb0b-8599-4365-87d3-2c18ff08e3d08-176150874817520932951662-fd6902b55cd0b209790';

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
  // Merge base cookies + session cookies
  const base = {};
  for (const part of COOKIES_BASE.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) base[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  const merged = { ...base, ...jar };
  return Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ');
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

function parseDefuncion(html) {
  const $ = cheerio.load(html);
  return {
    cita:            s($, 'lblcita'),
    fecha_defuncion: s($, 'lblfecha_defuncion'),
    nombre:          s($, 'lblnombre'),
    conocido_como:   s($, 'lblconocido_como'),
    lugar_suceso:    s($, 'lblLugar_suceso'),
    marginal:        s($, 'lblLeyendaMarginal'),
  };
}

function parseHijosGrid(html) {
  const $ = cheerio.load(html);
  const hijos = [];
  $('#Gridhijos tr').each((i, tr) => {
    if (i === 0) return;
    const cols = $(tr).find('td').map((_, td) => $(td).text().trim()).get().filter(c => c && c !== 'Detalles');
    if (cols.length >= 2) hijos.push({ cedula: cols[0]||null, fecha_nac: cols[1]||null, nombre: cols[2]||null });
  });
  return hijos;
}

function parseMatrimoniosGrid(html) {
  const $ = cheerio.load(html);
  const mat = [];
  $('#Gridmatrimonios tr').each((i, tr) => {
    if (i === 0) return;
    const cols = $(tr).find('td').map((_, td) => $(td).text().trim()).get().filter(c => c && c !== 'Detalles');
    if (cols.length >= 1) mat.push({ cita: cols[0]||null, fecha: cols[1]||null, tipo: cols[2]||null });
  });
  return mat;
}

// ════════════════════════════════════════════════════════════
// HTTP CLIENT con headers completos de navegador real
// ════════════════════════════════════════════════════════════
function makeClient(jar) {
  const h = (extra = {}) => ({
    'User-Agent':              UA,
    'Accept':                  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language':         'es-PE,es-419;q=0.9,es;q=0.8',
    'Accept-Encoding':         'gzip, deflate, br, zstd',
    'Connection':              'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua':               '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile':        '?0',
    'sec-ch-ua-platform':      '"Windows"',
    'sec-fetch-dest':          'document',
    'sec-fetch-mode':          'navigate',
    'sec-fetch-site':          'same-origin',
    'sec-fetch-user':          '?1',
    'priority':                'u=0, i',
    'Cookie':                  cookieStr(jar),
    ...extra,
  });

  const hAsync = (referer) => ({
    'User-Agent':              UA,
    'Accept':                  '*/*',
    'Accept-Language':         'es-PE,es-419;q=0.9,es;q=0.8',
    'Accept-Encoding':         'gzip, deflate, br, zstd',
    'Content-Type':            'application/x-www-form-urlencoded;charset=UTF-8',
    'X-MicrosoftAjax':         'Delta=true',
    'X-Requested-With':        'XMLHttpRequest',
    'sec-ch-ua':               '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile':        '?0',
    'sec-ch-ua-platform':      '"Windows"',
    'sec-fetch-dest':          'empty',
    'sec-fetch-mode':          'cors',
    'sec-fetch-site':          'same-origin',
    'priority':                'u=1, i',
    'Origin':                  BASE,
    'Referer':                 referer,
    'Cookie':                  cookieStr(jar),
  });

  return { h, hAsync };
}

async function get(url, headers) {
  const r = await axios.get(url, { headers, timeout: 25000, validateStatus: s => s < 600, decompress: true });
  return r;
}

async function post(url, body, headers) {
  const r = await axios.post(url, body.toString(), { headers, timeout: 25000, validateStatus: s => s < 600, decompress: true });
  return r;
}

// ════════════════════════════════════════════════════════════
// FLUJO COMPLETO
// ════════════════════════════════════════════════════════════
async function consultaTSE(cedula) {
  let jar = {};
  let vs  = {};

  // P1: GET consulta_cedula
  const { h, hAsync } = makeClient(jar);
  const r1 = await get(`${BASE}/chc/consulta_cedula.aspx`, h({ 'Referer': 'https://www.google.com/', 'sec-fetch-site': 'cross-site' }));
  jar = parseCookies(r1.headers['set-cookie'], jar);
  vs  = extractVS(r1.data);
  if (!vs.__VIEWSTATE) throw new Error('No se obtuvo ViewState inicial — posible bloqueo bot');

  // P2: POST cédula
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

  // P3: GET resultado_persona
  const r3 = await get(`${BASE}/chc/resultado_persona.aspx`, makeClient(jar).h({ 'Referer': `${BASE}/chc/consulta_cedula.aspx` }));
  jar = parseCookies(r3.headers['set-cookie'], jar);
  vs  = extractVS(r3.data);
  if (!vs.__VIEWSTATE) throw new Error('No se obtuvo ViewState de resultado_persona');

  const persona = parsePersona(r3.data);
  if (!persona.nombre && !persona.cedula) throw new Error('Cédula no encontrada en el TSE');

  const esDefuncion = r3.data.includes('small;">Fecha de Defunci\u00f3n:</span>') ||
                      r3.data.includes('Fecha de Defunci&oacute;n:') ||
                      r3.data.includes('>Fecha de Defunción:<');

  let defuncion = null;
  if (esDefuncion) {
    try {
      const bdef = new URLSearchParams({
        'ScriptManager1':'UpdatePanel4|cmbdefuncion','__LASTFOCUS':'',
        '__EVENTTARGET':'cmbdefuncion','__EVENTARGUMENT':'',
        '__VIEWSTATE':vs.__VIEWSTATE,'__VIEWSTATEGENERATOR':vs.__VIEWSTATEGENERATOR,
        '__EVENTVALIDATION':vs.__EVENTVALIDATION,
        'hdnCodigoAccionMarginal':'1','hdnFechaSucesoMatrimonio':'','__ASYNCPOST':'true',
      });
      const rdef = await post(`${BASE}/chc/resultado_persona.aspx`, bdef, makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`));
      jar = parseCookies(rdef.headers['set-cookie'], jar);
      vs  = updateVSFromAsync(rdef.data, vs);
      const rdetdef = await get(`${BASE}/chc/detalle_defuncion.aspx`, makeClient(jar).h({ 'Referer': `${BASE}/chc/resultado_persona.aspx` }));
      defuncion = parseDefuncion(rdetdef.data);
      const rref = await get(`${BASE}/chc/resultado_persona.aspx`, makeClient(jar).h({ 'Referer': `${BASE}/chc/detalle_defuncion.aspx` }));
      jar = parseCookies(rref.headers['set-cookie'], jar);
      vs  = extractVS(rref.data);
    } catch (e) {
      console.log(`[TSE] defuncion detalle falló: ${e.message}`);
    }
  }

  const postRP = async (bodyParams) => {
    const body = new URLSearchParams({
      '__LASTFOCUS':'','__EVENTTARGET':'','__EVENTARGUMENT':'',
      '__VIEWSTATE':vs.__VIEWSTATE,'__VIEWSTATEGENERATOR':vs.__VIEWSTATEGENERATOR,
      '__EVENTVALIDATION':vs.__EVENTVALIDATION,
      'hdnCodigoAccionMarginal':'1','hdnFechaSucesoMatrimonio':'','__ASYNCPOST':'true',
      ...bodyParams,
    });
    const r = await post(`${BASE}/chc/resultado_persona.aspx`, body, makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`));
    jar = parseCookies(r.headers['set-cookie'], jar);
    vs  = updateVSFromAsync(r.data, vs);
    return r;
  };

  const r4 = await postRP({ 'ScriptManager1':'ctl07|btnMostrarNacimiento', 'btnMostrarNacimiento':'Mostrar' });
  const hijos = parseHijosGrid(r4.data);

  const r5 = await postRP({ 'ScriptManager1':'ctl09|btnMostrarMatrimonios', 'btnMostrarMatrimonios':'Mostrar' });
  const matrimoniosGrid = parseMatrimoniosGrid(r5.data);

  await postRP({ 'ScriptManager1':'ctl11|btnMostrarVotacion', 'btnMostrarVotacion':'Mostrar' });
  await postRP({ 'ScriptManager1':'UpdatePanel3|Gridvotacion', '__EVENTTARGET':'Gridvotacion', '__EVENTARGUMENT':'Select$0' });

  const r8 = await get(`${BASE}/chc/detalle_votacion.aspx`, makeClient(jar).h({ 'Referer': `${BASE}/chc/resultado_persona.aspx` }));
  const votacion = parseVotacion(r8.data);

  const r9a = await get(`${BASE}/chc/resultado_persona.aspx`, makeClient(jar).h({ 'Referer': `${BASE}/chc/detalle_votacion.aspx` }));
  jar = parseCookies(r9a.headers['set-cookie'], jar);
  const vs9 = extractVS(r9a.data);
  let nacimiento = null;

  if (vs9.__VIEWSTATE) {
    const b9 = new URLSearchParams({
      'ScriptManager1':'UpdatePanel4|LinkButton11',
      '__LASTFOCUS':'','__EVENTTARGET':'LinkButton11','__EVENTARGUMENT':'',
      '__VIEWSTATE':vs9.__VIEWSTATE,'__VIEWSTATEGENERATOR':vs9.__VIEWSTATEGENERATOR,
      '__EVENTVALIDATION':vs9.__EVENTVALIDATION,
      'hdnCodigoAccionMarginal':'1','hdnFechaSucesoMatrimonio':'','__ASYNCPOST':'true',
    });
    const r9b = await post(`${BASE}/chc/resultado_persona.aspx`, b9, makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`));
    jar = parseCookies(r9b.headers['set-cookie'], jar);
    const r9c = await get(`${BASE}/chc/detalle_nacimiento.aspx`, makeClient(jar).h({ 'Referer': `${BASE}/chc/resultado_persona.aspx` }));
    nacimiento = parseNacimiento(r9c.data);
  }

  let matrimonioDetalle = null;
  if (matrimoniosGrid.length > 0) {
    try {
      const r10a = await get(`${BASE}/chc/resultado_persona.aspx`, makeClient(jar).h({ 'Referer': `${BASE}/chc/detalle_nacimiento.aspx` }));
      jar = parseCookies(r10a.headers['set-cookie'], jar);
      const vs10 = extractVS(r10a.data);
      if (vs10.__VIEWSTATE) {
        const bm = new URLSearchParams({
          'ScriptManager1':'ctl09|btnMostrarMatrimonios','__LASTFOCUS':'',
          '__EVENTTARGET':'','__EVENTARGUMENT':'',
          '__VIEWSTATE':vs10.__VIEWSTATE,'__VIEWSTATEGENERATOR':vs10.__VIEWSTATEGENERATOR,
          '__EVENTVALIDATION':vs10.__EVENTVALIDATION,
          'hdnCodigoAccionMarginal':'1','hdnFechaSucesoMatrimonio':'','__ASYNCPOST':'true','btnMostrarMatrimonios':'Mostrar',
        });
        const rm = await post(`${BASE}/chc/resultado_persona.aspx`, bm, makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`));
        jar = parseCookies(rm.headers['set-cookie'], jar);
        const vsm = updateVSFromAsync(rm.data, { ...vs10 });
        const bs = new URLSearchParams({
          'ScriptManager1':'UpdatePanel2|Gridmatrimonios',
          '__LASTFOCUS':'','__EVENTTARGET':'Gridmatrimonios','__EVENTARGUMENT':'Select$0',
          '__VIEWSTATE':vsm.__VIEWSTATE,'__VIEWSTATEGENERATOR':vsm.__VIEWSTATEGENERATOR,
          '__EVENTVALIDATION':vsm.__EVENTVALIDATION,
          'hdnCodigoAccionMarginal':'1','hdnFechaSucesoMatrimonio':'','__ASYNCPOST':'true',
        });
        const rs = await post(`${BASE}/chc/resultado_persona.aspx`, bs, makeClient(jar).hAsync(`${BASE}/chc/resultado_persona.aspx`));
        jar = parseCookies(rs.headers['set-cookie'], jar);
        const rmat = await get(`${BASE}/chc/detalle_matrimonio_extranjero.aspx`, makeClient(jar).h({ 'Referer': `${BASE}/chc/resultado_persona.aspx` }));
        matrimonioDetalle = parseMatrimonio(rmat.data);
      }
    } catch (e) {
      console.log(`[TSE] matrimonio detalle falló: ${e.message}`);
    }
  }

  return { persona, defuncion, nacimiento, votacion, hijos, matrimonios: { lista: matrimoniosGrid, detalle: matrimonioDetalle } };
}

// ════════════════════════════════════════════════════════════
// RUTAS
// ════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ estado: true, mensaje: 'TSE Costa Rica API v3', uso: '/api/tse/:cedula' });
});

app.get('/api/tse/:cedula', async (req, res) => {
  const { cedula } = req.params;
  if (!/^\d{9,12}$/.test(cedula)) return res.json({ estado: false, mensaje: 'Cédula inválida. Entre 9 y 12 dígitos.' });
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
