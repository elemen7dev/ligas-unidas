// Ligas Unidas — panel de administración (se carga solo al entrar a /panel).
// La seguridad real la dan las políticas RLS de la base: acá solo se oculta lo que el rol no puede usar.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lu-panel-auth' } });
const TZ = 'America/Argentina/Buenos_Aires';
const ROL_TXT = { superadmin: 'Superadmin', admin_liga: 'Administrador', cargador: 'Cargador' };
const ESTADOS = [['pendiente', 'Pendiente'], ['jugado', 'Jugado'], ['suspendido', 'Suspendido'], ['postergado', 'Postergado']];
const TIPOS = [['gol', 'Gol'], ['gol_en_contra', 'Gol en contra'], ['amarilla', 'Tarjeta amarilla'], ['roja', 'Tarjeta roja']];

/* ---------- utilidades ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, ra = document) => ra.querySelector(sel);
const aInput = (iso) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: TZ, hour12: false }).replace(' ', 'T').slice(0, 16) : '');
const deInput = (v) => (v ? `${v}:00-03:00` : null);
const slugDe = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function partirNombre(t) {
  const p = String(t || '').trim().split(/\s+/).filter(Boolean);
  if (p.length < 2) return null;
  if (p.length >= 3 && /^[A-ZÁÉÍÓÚÑ]\.$/.test(p[1])) return { nombre: p[0] + ' ' + p[1], apellido: p.slice(2).join(' ') };
  return { nombre: p[0], apellido: p.slice(1).join(' ') };
}
function msg(el, texto, tipo = '') {
  if (!el) return;
  el.textContent = texto || '';
  el.className = 'msg' + (tipo ? ' ' + tipo : '');
}
function errTexto(e) {
  const m = String(e?.message || e || '');
  if (e?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'No tenés permiso para hacer esto.';
  if (/torneo está finalizado/i.test(m)) return 'El torneo está finalizado: solo el superadmin puede modificarlo.';
  if (e?.code === '23505') return 'Ya existe un registro con esos datos.';
  return m || 'Ocurrió un error. Intentá de nuevo.';
}
function confirmar(texto, etiqueta = 'Confirmar') {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<div class="dlg-cab">Confirmá</div><div class="dlg-cuerpo"><p style="margin:0">${esc(texto)}</p>
      <div class="acciones"><button class="btn peligro" data-ok>${esc(etiqueta)}</button><button class="btn sec" data-no>Cancelar</button></div></div>`;
    document.body.appendChild(d);
    const fin = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelector('[data-ok]').addEventListener('click', () => fin(true));
    d.querySelector('[data-no]').addEventListener('click', () => fin(false));
    d.addEventListener('cancel', (e) => { e.preventDefault(); fin(false); });
    d.showModal();
  });
}

/* ---------- sesión y permisos ---------- */
async function cargarPerfil(ses) {
  const { data, error } = await sb.from('membresias').select('rol,liga_id').eq('usuario_id', ses.user.id);
  if (error) throw error;
  const roles = data || [];
  const esSuper = roles.some((r) => r.rol === 'superadmin');
  const rolEn = (ligaId) => (esSuper ? 'superadmin' : (roles.find((r) => r.liga_id === ligaId && r.rol === 'admin_liga') || roles.find((r) => r.liga_id === ligaId))?.rol || null);
  return { roles, esSuper, rolEn };
}
const puedeAdmin = (rol) => rol === 'superadmin' || rol === 'admin_liga';

export async function vistaPanel(seg, q, ctx) {
  const { data } = await sb.auth.getSession();
  const ses = data.session;
  if (!ses) return vistaLogin(ctx);
  // La bandera vive en app_metadata (el usuario no puede editarla); user_metadata es la marca vieja de cuentas anteriores.
  if (ses.user.app_metadata?.debe_cambiar_clave || ses.user.user_metadata?.debe_cambiar_clave) return vistaCambiarClave(ctx, ses);
  const perfil = await cargarPerfil(ses);
  if (!perfil.roles.length) return vistaSinPermisos(ctx, ses);
  if (seg.length === 0) return vistaPanelInicio(ctx, ses, perfil);
  if (seg[0] === 'usuarios' && perfil.esSuper) return vistaUsuarios(ctx, ses, perfil);
  return vistaPanelLiga(ctx, ses, perfil, seg[0], q.get('t') || 'resultados');
}

function marcoPanel(ctx, ses, perfil, titulo, cuerpo, migas = '') {
  const rolTxt = perfil ? (perfil.esSuper ? 'Superadmin' : 'Panel') : '';
  return `<div class="pagina">
    <div class="barra"><div class="contenedor"><span>${ses ? esc(ses.user.email) + ' · ' + esc(rolTxt) : 'Panel de administración'}</span>
      <span>${ses ? '<button class="btn sec chico" id="cuenta">Cambiar contraseña</button> <button class="btn sec chico" id="salir">Cerrar sesión</button>' : '<a href="/ligas" data-link>Ver las ligas</a>'}</span></div></div>
    <header class="cabecera"><div class="contenedor"><a class="marca" href="/panel" data-link><span class="marca-logo">LU</span><span class="marca-nombre">Panel</span></a>${migas}</div></header>
    <main class="principal"><div class="contenedor"><h1 class="titulo-seccion">${esc(titulo)}</h1>${cuerpo}</div></main>
    <footer class="pie"><div class="contenedor"><span>Panel de administración</span><span>Ligas Unidas · by Elemen7</span></div></footer></div>`;
}
function engancharSalir(ctx) {
  const b = $('#salir');
  if (b) b.addEventListener('click', async () => { await sb.auth.signOut(); ctx.ir('/panel'); });
  const c = $('#cuenta');
  if (c) c.addEventListener('click', () => abrirCambioClave());
}

/* ---------- contraseña propia ---------- */
const CLAVE_MIN = 10;
function validarClave(nueva, repetir, email) {
  if (nueva.length < CLAVE_MIN) return `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`;
  if (nueva !== repetir) return 'Las dos contraseñas no coinciden.';
  if (email && nueva.toLowerCase() === email.toLowerCase()) return 'La contraseña no puede ser igual a tu email.';
  if (/^(.)\1+$/.test(nueva)) return 'Elegí una contraseña menos obvia.';
  return null;
}
const camposClave = `<label class="campo">Contraseña nueva<input id="cc-nueva" type="password" autocomplete="new-password" minlength="${CLAVE_MIN}"><small>Al menos ${CLAVE_MIN} caracteres. Mejor si es una frase larga que solo vos conocés.</small></label>
  <label class="campo">Repetí la contraseña<input id="cc-repetir" type="password" autocomplete="new-password"></label>`;
function abrirCambioClave() {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-cab">Cambiar contraseña</div><div class="dlg-cuerpo"><form id="cc-form" novalidate style="display:flex;flex-direction:column;gap:14px">${camposClave}
    <div class="acciones"><button class="btn" type="submit">Guardar</button><button class="btn sec" type="button" id="cc-cancel">Cancelar</button></div><p class="msg" id="cc-msg" role="alert"></p></form></div>`;
  document.body.appendChild(d);
  const cerrar = () => { d.close(); d.remove(); };
  $('#cc-cancel', d).addEventListener('click', cerrar);
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  $('#cc-form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#cc-msg', d), { data } = await sb.auth.getUser();
    const err = validarClave($('#cc-nueva', d).value, $('#cc-repetir', d).value, data?.user?.email);
    if (err) return msg(m, err, 'error');
    msg(m, 'Guardando…');
    const { error } = await sb.auth.updateUser({ password: $('#cc-nueva', d).value });
    if (error) return msg(m, /same|different/i.test(error.message) ? 'La contraseña nueva debe ser distinta de la actual.' : 'No se pudo cambiar la contraseña. Probá de nuevo.', 'error');
    msg(m, 'Contraseña cambiada ✓', 'ok');
    setTimeout(cerrar, 1200);
  });
  d.showModal();
}
// Primer ingreso (o clave reiniciada): obliga a elegir una contraseña propia antes de usar el panel.
function vistaCambiarClave(ctx, ses) {
  const cuerpo = `<form class="form-tarjeta panel-ancho" id="cc-form" novalidate>
      <p style="margin:0;font-size:14px">Entraste con una clave temporal. Elegí una contraseña propia para seguir.</p>${camposClave}
      <div class="acciones"><button class="btn" type="submit" id="cc-btn">Guardar y entrar</button></div><p class="msg" id="cc-msg" role="alert"></p></form>`;
  return {
    titulo: 'Elegí tu contraseña · Panel',
    html: marcoPanel(ctx, ses, null, 'Elegí tu contraseña', cuerpo),
    despues() {
      engancharSalir(ctx);
      $('#cc-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#cc-msg'), err = validarClave($('#cc-nueva').value, $('#cc-repetir').value, ses.user.email);
        if (err) return msg(m, err, 'error');
        $('#cc-btn').disabled = true; msg(m, 'Guardando…');
        // El cambio lo hace la función "usuarios" (clave_inicial): solo ella puede bajar la bandera, y lo hace junto con la clave nueva.
        let falla = null;
        try { await llamarUsuarios({ accion: 'clave_inicial', nueva: $('#cc-nueva').value }); } catch (err) { falla = err.message; }
        $('#cc-btn').disabled = false;
        if (falla) return msg(m, falla, 'error');
        await sb.auth.refreshSession();
        ctx.redibujar();
      });
    },
  };
}

/* ---------- usuarios (solo superadmin; las cuentas se gestionan en la función "usuarios") ---------- */
async function llamarUsuarios(body) {
  const { data, error } = await sb.functions.invoke('usuarios', { body });
  if (error) {
    let m = 'No se pudo completar la acción.';
    try { const j = await error.context.json(); m = j.error || m; } catch { /* sin detalle */ }
    throw new Error(m);
  }
  return data;
}
function mostrarClave({ email, clave, titulo }) {
  return new Promise((resolve) => {
    const mensaje = `Hola. Ya tenés tu cuenta para el panel de Ligas Unidas.\n1) Entrá a ${location.origin}/panel\n2) Email: ${email}\n3) Clave temporal: ${clave}\nAl ingresar te va a pedir que elijas una contraseña propia.`;
    const d = document.createElement('dialog');
    d.innerHTML = `<div class="dlg-cab">${esc(titulo)}</div><div class="dlg-cuerpo">
      <p style="margin:0;font-size:14px"><strong>Copiá estos datos ahora: la clave se muestra una sola vez.</strong> Pasáselos a la persona; al ingresar tendrá que elegir una contraseña propia.</p>
      <label class="campo">Email<input readonly value="${esc(email)}"></label>
      <label class="campo">Clave temporal<input readonly value="${esc(clave)}" style="font-family:ui-monospace,Consolas,monospace;font-size:18px;letter-spacing:.04em"></label>
      <label class="campo">Mensaje listo para enviar<textarea readonly rows="6" style="font-size:13px">${esc(mensaje)}</textarea></label>
      <div class="acciones"><button class="btn" data-copiar>Copiar mensaje</button><button class="btn sec" data-listo>Ya los guardé</button></div><p class="msg" role="status"></p></div>`;
    document.body.appendChild(d);
    const cerrar = () => { d.close(); d.remove(); resolve(); };
    $('[data-listo]', d).addEventListener('click', cerrar);
    d.addEventListener('cancel', (e) => { e.preventDefault(); });   // no se cierra con Escape: evita perder la clave sin querer
    $('[data-copiar]', d).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(mensaje); msg($('.msg', d), 'Mensaje copiado ✓', 'ok'); }
      catch { $('textarea', d).select(); msg($('.msg', d), 'Seleccioné el mensaje: copialo con Ctrl+C.', ''); }
    });
    d.showModal();
  });
}

async function vistaUsuarios(ctx, ses, perfil) {
  const d = await llamarUsuarios({ accion: 'listar' });
  const ligas = d.ligas || [];
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : 'Nunca ingresó');
  const opcionesLigas = ligas.map((l) => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('');
  const opcionesRol = '<option value="admin_liga">Administrador (configura su liga)</option><option value="cargador">Cargador (solo resultados, goles y suspensiones)</option>';

  const fila = (u) => {
    const esSuperU = u.roles.some((r) => r.rol === 'superadmin');
    const roles = u.roles.map((r) => `<span class="chip ${r.rol === 'superadmin' ? 'oro' : r.rol === 'admin_liga' ? 'verde' : ''}">${esc(ROL_TXT[r.rol])}${r.liga ? ' · ' + esc(r.liga) : ''}${r.rol !== 'superadmin'
      ? ` <button type="button" data-quitar-rol="${r.id}" aria-label="Quitar el rol ${esc(ROL_TXT[r.rol])} de ${esc(r.liga || '')} a ${esc(u.email)}" style="border:0;background:transparent;cursor:pointer;font-weight:700;padding:0 2px">×</button>` : ''}</span>`).join('');
    return `<div class="panel-liga" data-uid="${u.id}" data-email="${esc(u.email)}">
      <div style="flex:1 1 300px;min-width:0"><h3 style="font-size:20px;text-transform:none;word-break:break-all">${esc(u.email)}</h3>
        <div class="chips">${roles || '<span class="chip">Sin rol</span>'}${u.debe_cambiar ? '<span class="chip oro">Clave temporal pendiente</span>' : ''}${u.id === ses.user.id ? '<span class="chip">Sos vos</span>' : ''}</div>
        <p style="margin:4px 0 0;font-size:12px;color:var(--muted)">Último ingreso: ${fmt(u.ultimo_ingreso)}</p><p class="msg" role="status"></p></div>
      <div class="acciones">${esSuperU ? '' : '<button class="btn sec" data-agregar-rol>Agregar rol</button><button class="btn sec" data-reiniciar>Reiniciar clave</button><button class="btn sec" data-eliminar>Eliminar cuenta</button>'}</div></div>`;
  };

  const cuerpo = `<p style="margin:0 0 16px"><a href="/panel" data-link style="font-weight:600;color:var(--c1)">← Volver a mis ligas</a></p>
    <details class="acordeon" style="margin-bottom:20px"><summary>Nuevo usuario</summary><div class="cuerpo" style="white-space:normal">
      <form id="u-form" class="form-tarjeta" novalidate style="border:0;padding:0">
        <label class="campo">Email<input id="u-email" type="email" maxlength="120" autocomplete="off" placeholder="nombre@ejemplo.com"></label>
        <div class="form-fila"><label class="campo">Liga<select id="u-liga">${opcionesLigas}</select></label><label class="campo">Rol<select id="u-rol">${opcionesRol}</select></label></div>
        <small style="color:var(--muted)">Se crea la cuenta con una clave temporal que te mostramos una sola vez para que se la pases. No se envía ningún email.</small>
        <div class="acciones"><button class="btn" type="submit" id="u-btn">Crear usuario</button></div><p class="msg" id="u-msg" role="alert"></p></form></div></details>
    <div class="tarjeta" id="u-lista">${d.usuarios.map(fila).join('') || '<div class="vacio" style="border:0">No hay usuarios.</div>'}</div>
    <p style="font-size:13px;color:var(--muted)">Reiniciar la clave genera una temporal nueva. Las sesiones ya abiertas de esa persona pueden seguir activas unos minutos. Eliminar una cuenta borra también sus permisos.</p>`;

  return {
    titulo: 'Usuarios · Panel',
    html: marcoPanel(ctx, ses, perfil, 'Usuarios', cuerpo),
    despues() {
      engancharSalir(ctx);
      $('#u-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#u-msg'), btn = $('#u-btn'), email = $('#u-email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return msg(m, 'Ingresá un email válido.', 'error');
        if (!$('#u-liga').value) return msg(m, 'Primero creá una liga.', 'error');
        btn.disabled = true; msg(m, 'Creando la cuenta…');
        try {
          const r = await llamarUsuarios({ accion: 'crear', email, liga_id: $('#u-liga').value, rol: $('#u-rol').value });
          msg(m, '');
          await mostrarClave({ email: r.email, clave: r.clave, titulo: 'Cuenta creada' });
          ctx.redibujar();
        } catch (err) { msg(m, err.message, 'error'); btn.disabled = false; }
      });

      $('#u-lista').addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const fila = b.closest('[data-uid]'), id = fila.dataset.uid, email = fila.dataset.email, m = $('.msg', fila);
        try {
          if (b.hasAttribute('data-quitar-rol')) {
            if (!(await confirmar(`¿Quitar ese rol a ${email}?`, 'Quitar rol'))) return;
            const { data, error } = await sb.from('membresias').delete().eq('id', b.dataset.quitarRol).select('id');
            if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No se pudo quitar el rol.', 'error');
            ctx.redibujar();
          } else if (b.hasAttribute('data-agregar-rol')) {
            agregarRol(id, email, opcionesLigas, opcionesRol, () => ctx.redibujar());
          } else if (b.hasAttribute('data-reiniciar')) {
            if (!(await confirmar(`¿Reiniciar la clave de ${email}? La clave actual deja de servir y se genera una temporal nueva.`, 'Reiniciar'))) return;
            b.disabled = true;
            const r = await llamarUsuarios({ accion: 'reiniciar', usuario_id: id });
            await mostrarClave({ email: r.email, clave: r.clave, titulo: 'Clave reiniciada' });
            ctx.redibujar();
          } else if (b.hasAttribute('data-eliminar')) {
            if (!(await confirmar(`¿Eliminar la cuenta de ${email}? Se borra la cuenta y todos sus permisos. No se puede deshacer.`, 'Eliminar cuenta'))) return;
            b.disabled = true;
            await llamarUsuarios({ accion: 'eliminar', usuario_id: id });
            ctx.redibujar();
          }
        } catch (err) { msg(m, err.message, 'error'); b.disabled = false; }
      });
    },
  };
}

function agregarRol(usuarioId, email, opcionesLigas, opcionesRol, alGuardar) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-cab">Agregar rol</div><div class="dlg-cuerpo"><p style="margin:0;font-weight:600;word-break:break-all">${esc(email)}</p>
    <form id="ar-form" novalidate style="display:flex;flex-direction:column;gap:14px">
      <label class="campo">Liga<select id="ar-liga">${opcionesLigas}</select></label><label class="campo">Rol<select id="ar-rol">${opcionesRol}</select></label>
      <div class="acciones"><button class="btn" type="submit">Agregar</button><button class="btn sec" type="button" id="ar-cancel">Cancelar</button></div><p class="msg" id="ar-msg" role="alert"></p></form></div>`;
  document.body.appendChild(d);
  const cerrar = () => { d.close(); d.remove(); };
  $('#ar-cancel', d).addEventListener('click', cerrar);
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  $('#ar-form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#ar-msg', d);
    const { error } = await sb.from('membresias').insert({ usuario_id: usuarioId, liga_id: $('#ar-liga', d).value, rol: $('#ar-rol', d).value });
    if (error) return msg(m, error.code === '23505' ? 'Esa persona ya tiene ese rol en esa liga.' : errTexto(error), 'error');
    cerrar(); alGuardar();
  });
  d.showModal();
}

/* ---------- login ---------- */
function vistaLogin(ctx) {
  const cuerpo = `<form class="form-tarjeta panel-ancho" id="form-login" novalidate>
      <label class="campo">Email<input type="email" id="l-email" autocomplete="username" required></label>
      <label class="campo">Contraseña<input type="password" id="l-clave" autocomplete="current-password" required></label>
      <div class="acciones"><button class="btn" type="submit" id="l-btn">Ingresar</button></div>
      <p class="msg" id="l-msg" role="alert"></p>
      <p style="margin:0;font-size:13px;color:var(--muted)">Las cuentas las crea el administrador de la plataforma.</p></form>`;
  return {
    titulo: 'Ingresar · Panel',
    html: marcoPanel(ctx, null, null, 'Ingresar al panel', cuerpo),
    despues() {
      $('#form-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = $('#l-email').value.trim(), clave = $('#l-clave').value;
        const m = $('#l-msg'), b = $('#l-btn');
        if (!email || !clave) return msg(m, 'Ingresá tu email y contraseña.', 'error');
        b.disabled = true; msg(m, 'Ingresando…');
        const { error } = await sb.auth.signInWithPassword({ email, password: clave });
        b.disabled = false;
        if (error) return msg(m, 'Email o contraseña incorrectos.', 'error');
        ctx.redibujar();
      });
    },
  };
}
function vistaSinPermisos(ctx, ses) {
  return {
    titulo: 'Sin permisos · Panel',
    html: marcoPanel(ctx, ses, null, 'Tu cuenta todavía no tiene permisos', '<div class="vacio">Pedile al administrador de la plataforma que te asigne una liga y un rol.</div>'),
    despues() { engancharSalir(ctx); },
  };
}

/* ---------- inicio del panel: ligas ---------- */
async function vistaPanelInicio(ctx, ses, perfil) {
  const { data, error } = await sb.from('ligas').select('id,slug,nombre,zona,estado,torneos(id,nombre,estado)').order('nombre');
  if (error) throw error;
  const ligas = (data || []).filter((l) => perfil.rolEn(l.id));
  const tarjetas = ligas.map((l) => {
    const rol = perfil.rolEn(l.id);
    const tor = (l.torneos || []).find((t) => t.estado === 'en_curso') || (l.torneos || [])[0];
    return `<div class="panel-liga" data-liga="${l.id}">
      <div><h3>${esc(l.nombre)}</h3><div class="chips"><span class="chip ${l.estado === 'publicada' ? 'verde' : 'oro'}">${l.estado === 'publicada' ? 'Publicada' : 'No publicada'}</span>
        <span class="chip">${esc(ROL_TXT[rol] || rol)}</span>${tor ? `<span class="chip">${esc(tor.nombre)}</span>` : ''}</div></div>
      <div class="acciones"><a class="btn" href="/panel/${encodeURIComponent(l.slug)}" data-link>Administrar</a>
        <a class="btn sec" href="/${encodeURIComponent(l.slug)}" data-link>Ver sitio</a>
        ${perfil.esSuper ? `<button class="btn sec" data-publicar="${l.estado === 'publicada' ? 'no_publicada' : 'publicada'}">${l.estado === 'publicada' ? 'Despublicar' : 'Publicar'}</button>` : ''}</div></div>`;
  }).join('');
  const nueva = perfil.esSuper ? `<details class="acordeon" style="margin-top:20px"><summary>Nueva liga</summary><div class="cuerpo" style="white-space:normal">
      <form id="form-liga" class="form-tarjeta" novalidate style="border:0;padding:0">
        <label class="campo">Nombre<input id="n-nombre" required maxlength="80"></label>
        <label class="campo">Dirección web (slug)<input id="n-slug" required maxlength="40" pattern="[a-z0-9-]+"><small>Solo minúsculas, números y guiones. Será ligasunidas…/<b id="n-prev">mi-liga</b></small></label>
        <label class="campo">Zona<input id="n-zona" maxlength="80"></label>
        <label class="campo">Contacto<input id="n-contacto" maxlength="120"></label>
        <div class="acciones"><button class="btn" type="submit">Crear liga</button></div><p class="msg" id="n-msg" role="alert"></p></form></div></details>` : '';
  const usuariosBtn = perfil.esSuper ? '<div class="acciones" style="margin-bottom:16px"><a class="btn lima" href="/panel/usuarios" data-link>Usuarios</a></div>' : '';
  const cuerpo = `${usuariosBtn}<div class="tarjeta">${tarjetas || '<div class="vacio" style="border:0">Todavía no tenés ligas asignadas.</div>'}</div>${nueva}`;
  return {
    titulo: 'Panel · Ligas Unidas',
    html: marcoPanel(ctx, ses, perfil, 'Mis ligas', cuerpo),
    despues() {
      engancharSalir(ctx);
      document.querySelectorAll('[data-publicar]').forEach((b) => b.addEventListener('click', async () => {
        const id = b.closest('[data-liga]').dataset.liga;
        const nuevo = b.dataset.publicar;
        if (!(await confirmar(nuevo === 'publicada' ? '¿Publicar esta liga? Será visible para todo el público.' : '¿Despublicar esta liga? Dejará de verse en el sitio.', nuevo === 'publicada' ? 'Publicar' : 'Despublicar'))) return;
        const { error: e } = await sb.from('ligas').update({ estado: nuevo }).eq('id', id);
        if (e) alert(errTexto(e)); else ctx.redibujar();
      }));
      const f = $('#form-liga');
      if (f) {
        const nom = $('#n-nombre'), slug = $('#n-slug'), prev = $('#n-prev');
        let manual = false;
        slug.addEventListener('input', () => { manual = true; prev.textContent = slug.value || 'mi-liga'; });
        nom.addEventListener('input', () => { if (!manual) { slug.value = slugDe(nom.value); prev.textContent = slug.value || 'mi-liga'; } });
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const m = $('#n-msg');
          const fila = { nombre: nom.value.trim(), slug: slug.value.trim(), zona: $('#n-zona').value.trim() || null, contacto: $('#n-contacto').value.trim() || null };
          if (!fila.nombre) return msg(m, 'Ingresá el nombre de la liga.', 'error');
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fila.slug)) return msg(m, 'La dirección web solo admite minúsculas, números y guiones.', 'error');
          const { error: e2 } = await sb.from('ligas').insert(fila);
          if (e2) return msg(m, e2.code === '23505' ? 'Ya existe una liga con esa dirección web.' : e2.code === '23514' ? 'Esa dirección web está reservada o no es válida.' : errTexto(e2), 'error');
          ctx.redibujar();
        });
      }
    },
  };
}

/* ---------- panel de una liga ---------- */
async function vistaPanelLiga(ctx, ses, perfil, slug, tab) {
  const { data: liga, error } = await sb.from('ligas').select('id,slug,nombre,estado').eq('slug', slug).maybeSingle();
  if (error) throw error;
  const rol = liga ? perfil.rolEn(liga.id) : null;
  if (!liga || !rol) {
    return { titulo: 'No encontrada · Panel', html: marcoPanel(ctx, ses, perfil, 'No encontrada', '<div class="vacio">La liga no existe o no tenés permisos sobre ella.<br><a href="/panel" data-link>Volver al panel</a></div>'), despues() { engancharSalir(ctx); } };
  }
  const admin = puedeAdmin(rol);
  const tabs = [['resultados', 'Resultados'], ['suspendidos', 'Suspendidos']].concat(admin ? [['torneos', 'Torneos'], ['fixture', 'Fixture'], ['portada', 'Portada'], ['clubes', 'Clubes'], ['jugadores', 'Jugadores'], ['institucional', 'Institucional'], ['sponsors', 'Sponsors'], ['liga', 'Mi liga']] : []);
  const t = tab === 'nuevo' && admin ? 'nuevo' : tabs.some(([k]) => k === tab) ? tab : 'resultados';
  const base = `/panel/${encodeURIComponent(slug)}`;
  const nav = `<nav class="nav" aria-label="Secciones del panel">${tabs.map(([k, n]) => `<a href="${base}?t=${k}" data-link${t === k || (t === 'nuevo' && k === 'torneos') ? ' aria-current="page"' : ''}>${n}</a>`).join('')}</nav>`;
  const migas = `<p style="margin:0 0 8px;font-size:14px"><a href="/panel" data-link style="color:#fff">← Mis ligas</a> · <strong>${esc(liga.nombre)}</strong> · ${esc(ROL_TXT[rol] || rol)}</p>${nav}`;
  const ct = { ctx, ses, perfil, liga, rol, admin };
  const v = t === 'portada' ? await tabPortada(ct) : t === 'jugadores' ? await tabJugadores(ct) : t === 'sponsors' ? await tabSponsors(ct) : t === 'institucional' ? await tabInstitucional(ct) : t === 'suspendidos' ? await tabSuspendidos(ct) : t === 'nuevo' ? await tabNuevoTorneo(ct) : t === 'torneos' ? await tabTorneos(ct) : t === 'fixture' ? await tabFixture(ct) : t === 'clubes' ? await tabClubes(ct) : t === 'liga' ? await tabLiga(ct) : await tabResultados(ct);
  return {
    titulo: `${v.titulo} · ${liga.nombre} · Panel`,
    html: marcoPanel(ctx, ses, perfil, v.titulo, v.html, migas),
    despues() { engancharSalir(ctx); v.despues && v.despues(); },
  };
}

/* ---------- pestaña Resultados ---------- */
async function tabResultados(ct) {
  const { liga } = ct;
  const { data: torneos, error } = await sb.from('torneos').select('id,nombre,anio,estado,categorias(id,nombre,orden)').eq('liga_id', liga.id).order('anio', { ascending: false });
  if (error) throw error;
  if (!torneos.length) return { titulo: 'Resultados', html: '<div class="vacio">Esta liga todavía no tiene torneos.</div>' };
  const orden = (a) => (a.estado === 'en_curso' ? 0 : a.estado === 'borrador' ? 1 : 2);
  torneos.sort((a, b) => orden(a) - orden(b) || b.anio - a.anio);

  const html = `<div class="controles">
      <label class="solo-lectores" for="r-torneo">Torneo</label><select id="r-torneo">${torneos.map((t) => `<option value="${t.id}">${esc(t.nombre)} ${t.anio}${t.estado === 'finalizado' ? ' (finalizado)' : ''}</option>`).join('')}</select>
      <label class="solo-lectores" for="r-cat">Categoría</label><select id="r-cat"></select>
      <label class="solo-lectores" for="r-ronda">Ronda</label><select id="r-ronda"></select>
      <label class="solo-lectores" for="r-fecha">Fecha</label><select id="r-fecha"></select></div>
    <div id="r-aviso"></div><div id="r-lista"><p class="cargando">Cargando partidos…</p></div>`;

  return {
    titulo: 'Resultados',
    html,
    despues() {
      const sT = $('#r-torneo'), sC = $('#r-cat'), sR = $('#r-ronda'), sF = $('#r-fecha'), lista = $('#r-lista'), aviso = $('#r-aviso');
      let partidos = [];
      const torneoSel = () => torneos.find((t) => t.id === sT.value);
      const llenarCats = () => {
        const cats = torneoSel().categorias.slice().sort((a, b) => a.orden - b.orden);
        sC.innerHTML = cats.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
      };
      const claveR = (p) => (p.tipo === 'copa' ? 'copa' : String(p.ronda));
      const llenarFechas = (porDefecto) => {
        const rondas = [...new Set(partidos.filter((p) => p.tipo !== 'copa').map((p) => p.ronda))].sort();
        const hayCopa = partidos.some((p) => p.tipo === 'copa');
        sR.innerHTML = '<option value="todas">Todas las rondas</option>' + rondas.map((r) => `<option value="${r}">Ronda ${r}</option>`).join('') + (hayCopa ? '<option value="copa">Copa Desafío</option>' : '');
        const pend = partidos.filter((p) => p.estado === 'pendiente' && p.tipo !== 'copa');
        const sig = pend.length ? pend.reduce((m, p) => (p.ronda * 1000 + p.jornada < m.ronda * 1000 + m.jornada ? p : m)) : null;
        if (porDefecto && sig) sR.value = String(sig.ronda);
        opcionesFecha();
        if (porDefecto && sig) sF.value = String(sig.jornada);
      };
      const opcionesFecha = () => {
        const js = [...new Set(partidos.filter((p) => sR.value === 'todas' || claveR(p) === sR.value).map((p) => p.jornada))].sort((a, b) => a - b);
        sF.innerHTML = '<option value="todas">Todas las fechas</option>' + js.map((j) => `<option value="${j}">Fecha ${j}</option>`).join('');
      };
      const pintar = () => {
        const t = torneoSel();
        aviso.innerHTML = t.estado === 'finalizado' ? '<p class="aviso">Este torneo está finalizado: solo el superadmin puede modificar sus resultados.</p>' : '';
        const ps = partidos.filter((p) => (sR.value === 'todas' || claveR(p) === sR.value) && (sF.value === 'todas' || String(p.jornada) === sF.value));
        if (!ps.length) { lista.innerHTML = '<div class="vacio">No hay partidos para ese filtro.</div>'; return; }
        const grupos = new Map();
        ps.forEach((p) => { const k = `${p.tipo}-${p.ronda}-${p.jornada}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(p); });
        lista.innerHTML = [...grupos.values()].map((g) => `<section class="tarjeta grupo"><div class="grupo-titulo${g[0].tipo === 'copa' || g[0].ronda === 2 ? ' r2' : ''}"><span>${g[0].tipo === 'copa' ? `Copa Desafío · ${g[0].ronda === 2 ? 'La final' : 'Semifinal ' + g[0].jornada}` :`Ronda ${g[0].ronda} · Fecha ${g[0].jornada}`}</span></div>
          ${g.map((p) => filaPartido(p)).join('')}</section>`).join('');
      };
      const cargar = async (porDefecto) => {
        lista.innerHTML = '<p class="cargando">Cargando partidos…</p>';
        const { data, error: e } = await sb.from('partidos')
          .select('id,categoria_id,tipo,ronda,jornada,fecha_hora,estado,goles_local,goles_visitante,nota,ajuste_ganador_equipo_id,local_equipo_id,visitante_equipo_id,local:local_equipo_id(club_id,clubes(nombre)),visita:visitante_equipo_id(club_id,clubes(nombre))')
          .eq('torneo_id', sT.value).eq('categoria_id', sC.value).order('ronda').order('jornada').range(0, 999);
        if (e) { lista.innerHTML = `<div class="vacio">${esc(errTexto(e))}</div>`; return; }
        partidos = data.slice().sort((a, b) => (a.tipo === 'copa') - (b.tipo === 'copa'));   // la final de la Copa va al final
        llenarFechas(porDefecto);
        pintar();
      };
      llenarCats();
      sT.addEventListener('change', () => { llenarCats(); cargar(true); });
      sC.addEventListener('change', () => cargar(true));
      sR.addEventListener('change', () => { opcionesFecha(); pintar(); });
      sF.addEventListener('change', pintar);

      lista.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const fila = btn.closest('.p-row');
        const p = partidos.find((x) => x.id === fila.dataset.id);
        if (btn.classList.contains('guardar')) await guardarPartido(fila, p, torneoSel());
        if (btn.classList.contains('eventos')) abrirEventos(ct, p, torneoSel());
      });
      cargar(true);
    },
  };
}

function filaPartido(p) {
  const l = p.local?.clubes?.nombre || '', v = p.visita?.clubes?.nombre || '';
  return `<div class="p-row" data-id="${p.id}">
    <div class="p-eq"><span class="nombre-l">${esc(l)}</span>
      <input type="number" min="0" max="99" class="gl" aria-label="Goles de ${esc(l)}" value="${p.goles_local ?? ''}"><span>-</span>
      <input type="number" min="0" max="99" class="gv" aria-label="Goles de ${esc(v)}" value="${p.goles_visitante ?? ''}"><span class="nombre-v">${esc(v)}</span></div>
    <div class="p-ctl">
      <select class="est" aria-label="Estado">${ESTADOS.map(([k, n]) => `<option value="${k}"${p.estado === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <input type="datetime-local" class="fh" aria-label="Fecha y hora" value="${aInput(p.fecha_hora)}">
      <input type="text" class="nota" aria-label="Nota" placeholder="Nota (opcional)" maxlength="300" value="${esc(p.nota || '')}"></div>
    ${p.tipo === 'copa' ? `<div class="p-ctl"><label style="font-size:13px;font-weight:600" for="pen-${p.id}">Si empata, ganó por penales:</label>
      <select class="pen" id="pen-${p.id}"><option value="">— (no hubo penales)</option><option value="${p.local_equipo_id}"${p.ajuste_ganador_equipo_id === p.local_equipo_id ? ' selected' : ''}>${esc(l)}</option><option value="${p.visitante_equipo_id}"${p.ajuste_ganador_equipo_id === p.visitante_equipo_id ? ' selected' : ''}>${esc(v)}</option></select></div>` : ''}
    <div class="p-ctl"><button class="btn guardar">Guardar</button><button class="btn sec eventos">Goles y tarjetas</button><span class="msg" role="status"></span></div></div>`;
}

async function guardarPartido(fila, p, torneo) {
  const m = $('.msg', fila);
  const est = $('.est', fila).value;
  const glv = $('.gl', fila).value, gvv = $('.gv', fila).value;
  const cambios = { estado: est, fecha_hora: deInput($('.fh', fila).value), nota: $('.nota', fila).value.trim() || null };
  if (est === 'jugado') {
    if (glv === '' || gvv === '') return msg(m, 'Cargá los goles de los dos equipos.', 'error');
    cambios.goles_local = parseInt(glv, 10); cambios.goles_visitante = parseInt(gvv, 10);
    if (!(cambios.goles_local >= 0 && cambios.goles_visitante >= 0)) return msg(m, 'Los goles deben ser números de 0 en adelante.', 'error');
  } else { cambios.goles_local = null; cambios.goles_visitante = null; }
  if (p.tipo === 'copa') {
    // En la final, el ajuste administrativo se usa solo para el ganador por penales cuando el partido termina empatado.
    const empate = est === 'jugado' && cambios.goles_local === cambios.goles_visitante;
    const pen = est === 'jugado' ? ($('.pen', fila).value || null) : null;      // si no está jugada, se limpian los penales
    if (empate && !pen) return msg(m, 'Terminó empatado: elegí quién ganó por penales.', 'error');
    if (pen && !empate) return msg(m, 'Los penales solo se cargan si la final terminó empatada.', 'error');
    cambios.ajuste_ganador_equipo_id = pen; cambios.ajuste_motivo = pen ? 'Definición por penales' : null; cambios.ajuste_anula_goles = false;
  }
  msg(m, 'Guardando…');
  const { data, error } = await sb.from('partidos').update(cambios).eq('id', p.id).select('id');
  if (error) return msg(m, errTexto(error), 'error');
  if (!data || !data.length) return msg(m, torneo.estado === 'finalizado' ? 'El torneo está finalizado.' : 'No tenés permiso para modificar este partido.', 'error');
  Object.assign(p, cambios);
  if (est !== 'jugado') { $('.gl', fila).value = ''; $('.gv', fila).value = ''; }
  msg(m, 'Guardado ✓', 'ok');
}

/* ---------- pestaña Fixture: agregar, mover y quitar partidos de un torneo existente ---------- */
async function tabFixture(ct) {
  const { liga } = ct;
  const { data: torneos, error } = await sb.from('torneos').select('id,nombre,anio,estado,copa_desafio,categorias(id,nombre,orden)').eq('liga_id', liga.id).order('anio', { ascending: false });
  if (error) throw error;
  if (!torneos.length) return { titulo: 'Fixture', html: '<div class="vacio">Esta liga todavía no tiene torneos.</div>' };
  const orden = (a) => (a.estado === 'en_curso' ? 0 : a.estado === 'borrador' ? 1 : 2);
  torneos.sort((a, b) => orden(a) - orden(b) || b.anio - a.anio);
  const html = `<div class="controles">
      <label class="solo-lectores" for="f-torneo">Torneo</label><select id="f-torneo">${torneos.map((t) => `<option value="${t.id}">${esc(t.nombre)} ${t.anio}${t.estado === 'finalizado' ? ' (finalizado)' : ''}</option>`).join('')}</select>
      <label class="solo-lectores" for="f-cat">Categoría</label><select id="f-cat"></select></div>
    <div id="f-aviso"></div>
    <form id="f-form" class="form-tarjeta" novalidate style="margin-bottom:16px">
      <h3 class="sub-titulo" style="font-size:22px" id="f-titulo-form">Agregar partido</h3>
      <div class="form-fila">
        <label class="campo">Ronda<input id="f-ronda" type="number" min="1" max="9" value="1"></label>
        <label class="campo">Fecha<input id="f-jornada" type="number" min="1" max="99" value="1"></label>
        <label class="campo">Local<select id="f-local"></select></label>
        <label class="campo">Visitante<select id="f-visita"></select></label></div>
      <div class="acciones"><button class="btn" type="submit" id="f-guardar">Agregar partido</button><button class="btn sec" type="button" id="f-cancelar" hidden>Cancelar edición</button></div>
      <p class="msg" id="f-msg" role="status"></p></form>
    <div id="f-lista"><p class="cargando">Cargando fixture…</p></div>
    <div class="form-tarjeta" id="c-bloque" style="margin-top:20px" hidden>
      <h3 class="sub-titulo" style="font-size:22px">Copa Desafío</h3>
      <p style="margin:0;font-size:13px;color:var(--muted)">Se carga a mano cuando termina el torneo. Hasta entonces el sitio muestra los duelos "a confirmar". El resultado y los penales se cargan en Resultados.</p>
      <form id="c-form" novalidate><div class="form-fila">
        <label class="campo">Fase<select id="c-fase"><option value="1">Semifinal</option><option value="2">Final</option></select></label>
        <label class="campo">Local<select id="c-local"></select></label>
        <label class="campo">Visitante<select id="c-visita"></select></label></div>
        <div class="acciones"><button class="btn" type="submit" id="c-agregar">Agregar partido de Copa</button></div>
        <p class="msg" id="c-msg" role="status"></p></form>
      <div id="c-lista"></div></div>`;
  return {
    titulo: 'Fixture',
    html,
    despues() {
      const sT = $('#f-torneo'), sC = $('#f-cat'), sL = $('#f-local'), sV = $('#f-visita'), lista = $('#f-lista'), aviso = $('#f-aviso'), m = $('#f-msg');
      let equipos = [], partidos = [], editando = null;
      const torneoSel = () => torneos.find((t) => t.id === sT.value);
      const nombreEq = (id) => equipos.find((e) => e.id === id)?.nombre || '—';
      const llenarCats = () => { sC.innerHTML = torneoSel().categorias.slice().sort((a, b) => a.orden - b.orden).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join(''); };
      const reiniciarForm = () => {
        editando = null;
        $('#f-titulo-form').textContent = 'Agregar partido'; $('#f-guardar').textContent = 'Agregar partido'; $('#f-cancelar').hidden = true;
        sL.disabled = false; sV.disabled = false;
        const ult = partidos.filter((p) => p.tipo !== 'copa').reduce((a, p) => (!a || p.ronda * 1000 + p.jornada > a.ronda * 1000 + a.jornada ? p : a), null);
        $('#f-ronda').value = ult ? ult.ronda : 1; $('#f-jornada').value = ult ? ult.jornada : 1;
        sL.value = ''; sV.value = '';
      };
      const FASES = { 1: 'Semifinal', 2: 'Final' };
      const pintarCopa = () => {
        const t = torneoSel();
        $('#c-bloque').hidden = !t.copa_desafio;
        if (!t.copa_desafio) return;
        const cs = partidos.filter((p) => p.tipo === 'copa').sort((a, b) => a.ronda - b.ronda || a.jornada - b.jornada);
        $('#c-lista').innerHTML = cs.length ? cs.map((p) => `<div class="evento" data-copa="${p.id}"><span><strong>${FASES[p.ronda] || 'Copa'}</strong> — ${esc(nombreEq(p.local_equipo_id))} vs ${esc(nombreEq(p.visitante_equipo_id))}${p.estado === 'jugado' ? ` <em>(${p.goles_local}-${p.goles_visitante})</em>` : ''}</span>
          <button class="btn sec chico" data-quitar-copa>Quitar</button></div>`).join('') : '<p style="margin:8px 0 0;color:var(--muted)">Todavía no hay partidos de Copa cargados.</p>';
      };
      const pintar = () => {
        const t = torneoSel();
        aviso.innerHTML = t.estado === 'finalizado' ? '<p class="aviso">Este torneo está finalizado: solo el superadmin puede modificar su fixture.</p>' : '';
        pintarCopa();
        const liga_ = partidos.filter((p) => p.tipo !== 'copa');
        if (!liga_.length) { lista.innerHTML = '<div class="vacio">Esta categoría todavía no tiene partidos. Agregalos con el formulario de arriba.</div>'; return; }
        const grupos = new Map();
        liga_.forEach((p) => { const k = `${p.ronda}-${p.jornada}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(p); });
        lista.innerHTML = [...grupos.values()].map((g) => `<section class="tarjeta grupo"><div class="grupo-titulo${g[0].ronda === 2 ? ' r2' : ''}"><span>Ronda ${g[0].ronda} · Fecha ${g[0].jornada}</span></div>
          ${g.map((p) => `<div class="evento" data-id="${p.id}"><span><strong>${esc(nombreEq(p.local_equipo_id))}</strong> vs <strong>${esc(nombreEq(p.visitante_equipo_id))}</strong>
            ${p.estado === 'jugado' ? `<em>(${p.goles_local}-${p.goles_visitante})</em>` : `<em>(${p.estado})</em>`}</span>
            <span class="acciones"><button class="btn sec chico" data-editar>Editar</button><button class="btn sec chico" data-quitar>Quitar</button></span></div>`).join('')}</section>`).join('');
      };
      const cargar = async () => {
        lista.innerHTML = '<p class="cargando">Cargando fixture…</p>';
        const [re, rp] = await Promise.all([
          sb.from('equipos').select('id,clubes(nombre)').eq('categoria_id', sC.value),
          sb.from('partidos').select('id,tipo,ronda,jornada,estado,goles_local,goles_visitante,local_equipo_id,visitante_equipo_id').eq('categoria_id', sC.value).order('ronda').order('jornada').range(0, 999)]);
        if (re.error || rp.error) { lista.innerHTML = `<div class="vacio">${esc(errTexto(re.error || rp.error))}</div>`; return; }
        equipos = re.data.map((e) => ({ id: e.id, nombre: e.clubes?.nombre || '—' })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        partidos = rp.data;
        const ops = '<option value="">Elegí un club…</option>' + equipos.map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('');
        sL.innerHTML = ops; sV.innerHTML = ops; $('#c-local').innerHTML = ops; $('#c-visita').innerHTML = ops;
        reiniciarForm(); pintar();
      };
      sT.addEventListener('change', async () => { llenarCats(); await cargar(); });
      sC.addEventListener('change', cargar);
      $('#f-cancelar').addEventListener('click', () => { reiniciarForm(); msg(m, ''); });

      $('#f-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const ronda = parseInt($('#f-ronda').value, 10), jornada = parseInt($('#f-jornada').value, 10);
        const orig = editando ? partidos.find((p) => p.id === editando) : null;
        const local = orig && orig.estado !== 'pendiente' ? orig.local_equipo_id : sL.value;
        const visita = orig && orig.estado !== 'pendiente' ? orig.visitante_equipo_id : sV.value;
        if (!(ronda >= 1) || !(jornada >= 1)) return msg(m, 'Indicá la ronda y la fecha (números desde 1).', 'error');
        if (!local || !visita) return msg(m, 'Elegí los dos clubes.', 'error');
        if (local === visita) return msg(m, 'El local y el visitante deben ser clubes distintos.', 'error');
        const ocupado = partidos.find((p) => p.id !== editando && p.tipo !== 'copa' && p.ronda === ronda && p.jornada === jornada
          && [p.local_equipo_id, p.visitante_equipo_id].some((x) => x === local || x === visita));
        if (ocupado) {
          const quien = [ocupado.local_equipo_id, ocupado.visitante_equipo_id].find((x) => x === local || x === visita);
          return msg(m, `${nombreEq(quien)} ya juega en la Ronda ${ronda}, Fecha ${jornada}.`, 'error');
        }
        const btn = $('#f-guardar'); btn.disabled = true;
        try {
          msg(m, 'Guardando…');
          if (editando) {
            const cambios = { ronda, jornada };
            if (orig.estado === 'pendiente') { cambios.local_equipo_id = local; cambios.visitante_equipo_id = visita; }
            const r = await sb.from('partidos').update(cambios).eq('id', editando).select('id');
            if (r.error) return msg(m, errTexto(r.error), 'error');
            if (!r.data?.length) return msg(m, 'No tenés permiso para modificar este partido.', 'error');
          } else {
            const r = await sb.from('partidos').insert({ liga_id: liga.id, torneo_id: sT.value, categoria_id: sC.value, tipo: 'liga', ronda, jornada, local_equipo_id: local, visitante_equipo_id: visita }).select('id');
            if (r.error) return msg(m, errTexto(r.error), 'error');
          }
          await cargar();
          msg(m, editando ? 'Cambios guardados ✓' : 'Partido agregado ✓', 'ok');
        } finally { btn.disabled = false; }
      });

      // Copa: partidos cargados a mano (ronda 1 = semifinal, ronda 2 = final)
      $('#c-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const mc = $('#c-msg'), fase = parseInt($('#c-fase').value, 10), local = $('#c-local').value, visita = $('#c-visita').value;
        if (!local || !visita) return msg(mc, 'Elegí los dos clubes.', 'error');
        if (local === visita) return msg(mc, 'El local y el visitante deben ser clubes distintos.', 'error');
        const previos = partidos.filter((p) => p.tipo === 'copa' && p.ronda === fase);
        if (fase === 2 && previos.length) return msg(mc, 'Ya hay una final cargada en esta categoría.', 'error');
        if (fase === 1 && previos.length >= 2) return msg(mc, 'Ya hay dos semifinales cargadas en esta categoría.', 'error');
        const btn = $('#c-agregar'); btn.disabled = true;
        try {
          msg(mc, 'Guardando…');
          const r = await sb.from('partidos').insert({ liga_id: liga.id, torneo_id: sT.value, categoria_id: sC.value, tipo: 'copa', ronda: fase, jornada: previos.length + 1, local_equipo_id: local, visitante_equipo_id: visita }).select('id');
          if (r.error) return msg(mc, errTexto(r.error), 'error');
          await cargar();
          msg($('#c-msg'), 'Partido de Copa agregado ✓', 'ok');
        } finally { btn.disabled = false; }
      });
      $('#c-lista').addEventListener('click', async (e) => {
        const fila = e.target.closest('[data-copa]');
        if (!fila || !e.target.closest('[data-quitar-copa]')) return;
        const p = partidos.find((x) => x.id === fila.dataset.copa);
        if (!(await confirmar(`¿Quitar ${nombreEq(p.local_equipo_id)} vs ${nombreEq(p.visitante_equipo_id)} de la Copa?${p.estado === 'jugado' ? ' Ya tiene resultado: se borran también su marcador, goles y tarjetas.' : ''} No se puede deshacer.`, 'Quitar partido'))) return;
        const r = await sb.from('partidos').delete().eq('id', p.id).select('id');
        if (r.error || !r.data?.length) return msg($('#c-msg'), r.error ? errTexto(r.error) : 'No tenés permiso para quitar este partido.', 'error');
        await cargar(); msg($('#c-msg'), 'Partido quitado ✓', 'ok');
      });

      lista.addEventListener('click', async (e) => {
        const fila = e.target.closest('[data-id]');
        if (!fila) return;
        const p = partidos.find((x) => x.id === fila.dataset.id);
        if (e.target.closest('[data-editar]')) {
          editando = p.id;
          $('#f-titulo-form').textContent = 'Editar partido'; $('#f-guardar').textContent = 'Guardar cambios'; $('#f-cancelar').hidden = false;
          $('#f-ronda').value = p.ronda; $('#f-jornada').value = p.jornada; sL.value = p.local_equipo_id; sV.value = p.visitante_equipo_id;
          const bloq = p.estado !== 'pendiente';   // con resultado cargado solo se puede mover de fecha
          sL.disabled = bloq; sV.disabled = bloq;
          msg(m, bloq ? 'Este partido ya tiene resultado o estado: solo se puede cambiar la ronda y la fecha.' : '');
          $('#f-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (e.target.closest('[data-quitar]')) {
          const aviso2 = p.estado === 'jugado' ? ' Ya tiene resultado: se borran también su marcador, goles y tarjetas.' : '';
          if (!(await confirmar(`¿Quitar ${nombreEq(p.local_equipo_id)} vs ${nombreEq(p.visitante_equipo_id)} (Ronda ${p.ronda}, Fecha ${p.jornada})?${aviso2} No se puede deshacer.`, 'Quitar partido'))) return;
          const r = await sb.from('partidos').delete().eq('id', p.id).select('id');
          if (r.error || !r.data?.length) return msg(m, r.error ? errTexto(r.error) : 'No tenés permiso para quitar este partido.', 'error');
          await cargar(); msg(m, 'Partido quitado ✓', 'ok');
        }
      });
      llenarCats(); cargar();
    },
  };
}

/* ---------- goles y tarjetas de un partido ---------- */
async function abrirEventos(ct, p, torneo) {
  const l = p.local?.clubes?.nombre || 'Local', v = p.visita?.clubes?.nombre || 'Visitante';
  const clubes = { [p.local_equipo_id]: { equipo: p.local_equipo_id, club: p.local?.club_id, nombre: l }, [p.visitante_equipo_id]: { equipo: p.visitante_equipo_id, club: p.visita?.club_id, nombre: v } };
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-cab">${esc(l)} vs ${esc(v)}</div><div class="dlg-cuerpo">
    <div id="ev-resumen" class="aviso" hidden></div><div id="ev-lista" aria-live="polite"></div>
    <form id="ev-form" novalidate><div class="form-fila">
      <label class="campo">Tipo<select id="ev-tipo">${TIPOS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      <label class="campo"><span id="ev-eq-rot">Equipo que suma el gol</span><select id="ev-equipo">${Object.values(clubes).map((c) => `<option value="${c.equipo}">${esc(c.nombre)}</option>`).join('')}</select></label>
      <label class="campo">Jugador<select id="ev-jug"></select></label>
      <label class="campo" id="ev-nuevo-w" hidden>Nombre y apellido<input id="ev-nuevo" maxlength="80" autocomplete="off"></label>
      <label class="campo">Minuto (opcional)<input id="ev-min" type="number" min="0" max="130"></label></div>
      <div class="acciones" style="margin-top:12px"><button class="btn" type="submit">Agregar</button><button class="btn sec" type="button" id="ev-cerrar">Cerrar</button></div>
      <p class="msg" id="ev-msg" role="alert"></p></form></div>`;
  document.body.appendChild(d);
  const lista = $('#ev-lista', d), resumen = $('#ev-resumen', d), sTipo = $('#ev-tipo', d), sEq = $('#ev-equipo', d), sJug = $('#ev-jug', d), nuevoW = $('#ev-nuevo-w', d), m = $('#ev-msg', d);
  let plantel = [];
  const cargados = {};   // goles ya cargados por equipo (el que suma el gol)

  const cerrar = () => { d.close(); d.remove(); };
  $('#ev-cerrar', d).addEventListener('click', cerrar);
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });

  const clubDelJugador = () => {
    const eq = clubes[sEq.value];
    if (sTipo.value === 'gol_en_contra') return Object.values(clubes).find((c) => c.equipo !== eq.equipo);
    return eq;
  };
  const llenarJugadores = () => {
    const c = clubDelJugador();
    const js = plantel.filter((x) => x.club_id === c.club).sort((a, b) => (a.jugadores.apellido || '').localeCompare(b.jugadores.apellido || '', 'es'));
    sJug.innerHTML = '<option value="">Sin jugador</option>' + js.map((x) => `<option value="${x.jugador_id}">${esc(x.jugadores.apellido)}, ${esc(x.jugadores.nombre)}</option>`).join('')
      + (ct.admin ? '<option value="__nuevo">+ Jugador nuevo…</option>' : '');
    nuevoW.hidden = true;
  };
  const rotulos = () => {
    const t = sTipo.value;
    $('#ev-eq-rot', d).textContent = t === 'gol' ? 'Equipo que suma el gol' : t === 'gol_en_contra' ? 'Equipo al que se le suma el gol' : 'Equipo del jugador';
    llenarJugadores();
  };
  sTipo.addEventListener('change', rotulos);
  sEq.addEventListener('change', llenarJugadores);
  sJug.addEventListener('change', () => { nuevoW.hidden = sJug.value !== '__nuevo'; });

  const refrescar = async () => {
    const { data, error } = await sb.from('eventos_partido').select('id,tipo,minuto,equipo_id,jugadores(nombre,apellido)').eq('partido_id', p.id);
    if (error) { lista.innerHTML = `<p class="msg error">${esc(errTexto(error))}</p>`; return; }
    const tn = Object.fromEntries(TIPOS);
    const orden = data.slice().sort((a, b) => (a.minuto ?? 999) - (b.minuto ?? 999));
    lista.innerHTML = orden.length ? orden.map((e) => `<div class="evento"><span>${e.minuto != null ? e.minuto + "' · " : ''}<strong>${esc(tn[e.tipo])}</strong> — ${e.jugadores ? esc(e.jugadores.nombre + ' ' + e.jugadores.apellido) : 'sin jugador'} <em>(${esc(clubes[e.equipo_id]?.nombre || '')})</em></span>
      <button class="btn sec chico" data-quitar="${e.id}" aria-label="Quitar evento">Quitar</button></div>`).join('') : '<p style="margin:0;color:var(--muted)">Todavía no hay goles ni tarjetas cargados.</p>';
    const goles = (eq) => data.filter((e) => (e.tipo === 'gol' || e.tipo === 'gol_en_contra') && e.equipo_id === eq).length;
    const gl = goles(p.local_equipo_id), gv = goles(p.visitante_equipo_id);
    cargados[p.local_equipo_id] = gl; cargados[p.visitante_equipo_id] = gv;
    if (p.estado === 'jugado' && (gl !== p.goles_local || gv !== p.goles_visitante)) {
      resumen.hidden = false;
      resumen.textContent = `Los goles cargados (${gl}-${gv}) no coinciden con el marcador (${p.goles_local}-${p.goles_visitante}).`;
    } else { resumen.hidden = true; }
  };
  lista.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    const { data, error } = await sb.from('eventos_partido').delete().eq('id', b.dataset.quitar).select('id');
    if (error) return msg(m, errTexto(error), 'error');
    if (!data.length) return msg(m, 'No tenés permiso para quitar este evento.', 'error');
    msg(m, ''); refrescar();
  });

  $('#ev-form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sTipo.value === 'gol' || sTipo.value === 'gol_en_contra') {
      // El marcador manda: no se cargan más goles que los del resultado (la base también lo exige).
      if (p.estado !== 'jugado' || p.goles_local == null || p.goles_visitante == null) return msg(m, 'Primero guardá el resultado del partido como Jugado y después cargá los goles.', 'error');
      const max = sEq.value === p.local_equipo_id ? p.goles_local : p.goles_visitante;
      if ((cargados[sEq.value] || 0) + 1 > max) return msg(m, `El marcador le asigna ${max} gol(es) a ${clubes[sEq.value].nombre} y ya están cargados. Corregí el resultado o quitá un gol antes de agregar otro.`, 'error');
    }
    msg(m, 'Guardando…');
    let jugadorId = sJug.value || null;
    const club = clubDelJugador();
    if (jugadorId === '__nuevo') {
      const n = partirNombre($('#ev-nuevo', d).value);
      if (!n) return msg(m, 'Ingresá nombre y apellido del jugador.', 'error');
      const j = await sb.from('jugadores').insert({ liga_id: ct.liga.id, nombre: n.nombre, apellido: n.apellido }).select('id').single();
      if (j.error) return msg(m, errTexto(j.error), 'error');
      const pl = await sb.from('planteles').insert({ liga_id: ct.liga.id, jugador_id: j.data.id, club_id: club.club, torneo_id: torneo.id, categoria_id: p.categoria_id });
      if (pl.error) return msg(m, errTexto(pl.error), 'error');
      jugadorId = j.data.id;
      plantel.push({ jugador_id: jugadorId, club_id: club.club, categoria_id: p.categoria_id, jugadores: { nombre: n.nombre, apellido: n.apellido } });
    }
    const minuto = $('#ev-min', d).value === '' ? null : parseInt($('#ev-min', d).value, 10);
    const { error } = await sb.from('eventos_partido').insert({ liga_id: ct.liga.id, partido_id: p.id, equipo_id: sEq.value, jugador_id: jugadorId, tipo: sTipo.value, minuto });
    if (error) return msg(m, errTexto(error), 'error');
    msg(m, 'Agregado ✓', 'ok');
    $('#ev-min', d).value = '';
    llenarJugadores();
    refrescar();
  });

  d.showModal();
  const pl = await sb.from('planteles').select('jugador_id,club_id,categoria_id,jugadores(nombre,apellido)').eq('torneo_id', torneo.id).eq('activo', true).in('club_id', [clubes[p.local_equipo_id].club, clubes[p.visitante_equipo_id].club]);
  plantel = (pl.data || []).filter((x) => x.categoria_id === null || x.categoria_id === p.categoria_id);
  rotulos();
  refrescar();
}

/* ---------- imágenes (escudos y logos) ---------- */
const IMG_TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MARCA_URL = '/object/public/escudos/';
// Ajuste de logos al subirlos: recorta los márgenes vacíos, centra el logo y entrega un PNG cuadrado con aire alrededor.
// (Los archivos recortados a mano suelen traer márgenes desparejos y el escudo se ve corrido.)
const AJ_LADO = 160;
async function leerPixeles(file) {
  const bmp = await createImageBitmap(file);
  const esc = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * esc)), h = Math.max(1, Math.round(bmp.height * esc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return { cv, cx, w, h };
}
function cajaContenido(cx, w, h, recortar) {
  if (!recortar) return { x: 0, y: 0, w, h };
  const d = cx.getImageData(0, 0, w, h).data;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const vacio = d[i + 3] < 16 || (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245);   // transparente o casi blanco
      if (!vacio) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function dibujarLogo(destino, origen, caja, zoom, dx, dy, encajar) {
  const L = AJ_LADO;
  destino.width = L; destino.height = L;
  const cx = destino.getContext('2d');
  cx.clearRect(0, 0, L, L);
  cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
  const lado = L * zoom;
  let esc = Math.min(lado / caja.w, lado / caja.h);
  if (encajar) esc = Math.min(esc, (L * 0.94) / Math.hypot(caja.w, caja.h));   // ninguna esquina del logo sale del círculo
  const w = caja.w * esc, h = caja.h * esc;
  cx.drawImage(origen, caja.x, caja.y, caja.w, caja.h, (L - w) / 2 + (dx * L) / 100, (L - h) / 2 + (dy * L) / 100, w, h);
}
function ajustarImagen(file, forma = 'circulo') {
  if (/^ajustado-/i.test(file.name)) return Promise.resolve(file);                      // ya viene ajustado
  if (file.size > 10 * 1048576) return Promise.reject(new Error('La imagen pesa más de 10 MB.'));
  return new Promise((resolve, reject) => {
    leerPixeles(file).then((px) => {
      const d = document.createElement('dialog');
      d.innerHTML = `<div class="dlg-cab">Ajustar logo</div><div class="dlg-cuerpo">
        <p style="margin:0;font-size:13px;color:var(--muted)">Así se va a ver. Se recortan los márgenes vacíos y el logo queda centrado.</p>
        <div style="display:flex;gap:20px;align-items:center;justify-content:center;flex-wrap:wrap">
          <canvas id="aj-cuadro" style="width:160px;height:160px;border:1px dashed #B9C4BD;border-radius:8px;background:#fff" aria-label="Vista previa del logo"></canvas>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:center"><canvas id="aj-circulo" style="width:56px;height:56px;border-radius:50%;background:#fff;border:1px solid var(--linea)" aria-hidden="true"></canvas><small style="color:var(--muted)">Vista en círculo</small></div></div>
        <label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="aj-recortar" checked> Recortar márgenes vacíos (blancos o transparentes)</label>
        ${forma === 'circulo' ? '<label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="aj-encajar" checked> Encajar dentro del círculo (que no se corte)</label>' : ''}
        <label class="campo">Tamaño<input id="aj-zoom" type="range" min="50" max="100" value="${forma === 'circulo' || forma === 'liga' ? 100 : 84}"></label>
        <label class="campo">Posición horizontal<input id="aj-dx" type="range" min="-25" max="25" value="0"></label>
        <label class="campo">Posición vertical<input id="aj-dy" type="range" min="-25" max="25" value="0"></label>
        <div class="acciones"><button class="btn" id="aj-ok" type="button">Usar este logo</button><button class="btn sec" id="aj-tal" type="button">Subir tal cual</button><button class="btn sec" id="aj-no" type="button">Cancelar</button></div></div>`;
      document.body.appendChild(d);
      const cuadro = $('#aj-cuadro', d), circulo = $('#aj-circulo', d);
      const pintar = () => {
        const caja = cajaContenido(px.cx, px.w, px.h, $('#aj-recortar', d).checked);
        dibujarLogo(cuadro, px.cv, caja, +$('#aj-zoom', d).value / 100, +$('#aj-dx', d).value, +$('#aj-dy', d).value, !!$('#aj-encajar', d)?.checked);
        circulo.width = 112; circulo.height = 112;
        circulo.getContext('2d').drawImage(cuadro, 0, 0, 112, 112);
      };
      ['#aj-recortar', '#aj-encajar', '#aj-zoom', '#aj-dx', '#aj-dy'].forEach((s) => { const el = $(s, d); if (el) el.addEventListener('input', pintar); });
      const cerrar = () => { d.close(); d.remove(); };
      $('#aj-ok', d).addEventListener('click', () => {
        cuadro.toBlob((blob) => {
          cerrar();
          if (!blob) return resolve(file);
          resolve(new File([blob], 'ajustado-' + (file.name.replace(/\.[^.]+$/, '') || 'logo') + '.png', { type: 'image/png' }));
        }, 'image/png');
      });
      // "Subir tal cual": mismo archivo, marcado como ya revisado para que no vuelva a preguntar al guardar.
      $('#aj-tal', d).addEventListener('click', () => { cerrar(); resolve(new File([file], 'ajustado-' + file.name, { type: file.type })); });
      $('#aj-no', d).addEventListener('click', () => { cerrar(); reject(new Error('Subida cancelada.')); });
      d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); reject(new Error('Subida cancelada.')); });
      pintar();
      d.showModal();
    }).catch(() => resolve(file));                                                        // si no se puede leer la imagen, se sube tal cual
  });
}
// Vista previa apenas se elige el archivo (antes de guardar): el diálogo de ajuste se abre en cuanto cambia el campo
// y el archivo ajustado reemplaza al elegido. Los campos de logos de sponsors se muestran en cuadrado; el resto, en círculo.
document.addEventListener('change', async (e) => {
  const inp = e.target;
  if (!(inp instanceof HTMLInputElement) || inp.type !== 'file' || inp.accept !== 'image/png,image/jpeg,image/webp') return;
  const f = inp.files && inp.files[0];
  if (!f || /^ajustado-/i.test(f.name) || !IMG_TIPOS[f.type]) return;
  try {
    const ajustado = await ajustarImagen(f, /^(sp|es)-logo$/.test(inp.id) ? 'cuadrado' : inp.id === 'm-logo' ? 'liga' : 'circulo');
    const dt = new DataTransfer(); dt.items.add(ajustado); inp.files = dt.files;
  } catch (err) { inp.value = ''; }                                                       // cancelado: se vacía el campo
});
async function subirImagen(ligaId, file, forma = 'circulo') {
  if (!IMG_TIPOS[file.type]) throw new Error('La imagen debe ser PNG, JPG o WebP.');
  file = await ajustarImagen(file, forma);
  if (file.size > 1048576) throw new Error('La imagen pesa más de 1 MB. Probá con una más liviana.');
  const path = `${ligaId}/${crypto.randomUUID()}.${IMG_TIPOS[file.type]}`;
  const { error } = await sb.storage.from('escudos').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
  if (error) throw error;
  return { path, url: sb.storage.from('escudos').getPublicUrl(path).data.publicUrl };
}
function rutaDeUrl(url) {
  const i = String(url || '').indexOf(MARCA_URL);
  return i < 0 ? null : decodeURIComponent(url.slice(i + MARCA_URL.length).split('?')[0]);
}
async function borrarImagen(url) {
  const ruta = rutaDeUrl(url);
  if (!ruta) return;
  const r = await sb.storage.from('escudos').remove([ruta]).catch((e) => ({ error: e }));
  // El almacenamiento devuelve lista vacía (sin error) si no pudo borrar: lo dejamos en consola para detectarlo.
  if (r.error || !r.data?.length) console.warn('No se pudo borrar la imagen anterior:', ruta, r.error?.message || '');
}
const urlOk = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
function siglaClub(nombre) {
  const STOP = ['de', 'del', 'la', 'el', 'los', 'las', 'y'];
  const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 3).toUpperCase();
  const u = p.length > 2 ? p.filter((w) => !STOP.includes(w.toLowerCase())) : p;
  return u.map((w) => (/^\d/.test(w) ? w : w[0])).join('').slice(0, 3).toUpperCase();
}
const miniatura = (c) => `<span class="escudo g" aria-hidden="true">${urlOk(c.escudo_url) ? `<img src="${esc(c.escudo_url)}" alt="">` : esc(siglaClub(c.nombre))}</span>`;
const ACEPTA = 'image/png,image/jpeg,image/webp';

/* ---------- pestaña Clubes ---------- */
async function tabClubes(ct) {
  const { liga, ctx } = ct;
  const { data: clubes, error } = await sb.from('clubes').select('id,nombre,nombre_corto,localidad,escudo_url').eq('liga_id', liga.id).order('nombre');
  if (error) throw error;
  const fila = (c) => `<div class="panel-liga" data-club="${c.id}"><div style="display:flex;align-items:center;gap:12px">${miniatura(c)}
      <div><h3 style="font-size:22px">${esc(c.nombre)}</h3><div class="chips">${c.localidad ? `<span class="chip verde">${esc(c.localidad)}</span>` : ''}${c.nombre_corto ? `<span class="chip">${esc(c.nombre_corto)}</span>` : ''}</div></div></div>
      <div class="acciones"><button class="btn sec" data-ed>Editar</button><button class="btn sec" data-del>Quitar</button></div></div>`;
  const html = `<details class="acordeon" style="margin-bottom:20px"><summary>Nuevo club</summary><div class="cuerpo" style="white-space:normal">
      <form id="form-club" class="form-tarjeta" novalidate style="border:0;padding:0">
        <label class="campo">Nombre<input id="c-nombre" required maxlength="80"></label>
        <label class="campo">Nombre corto (opcional)<input id="c-corto" maxlength="30"></label>
        <label class="campo">Localidad (opcional)<input id="c-localidad" maxlength="60" placeholder="Ej.: Pehuajó"></label>
        <label class="campo">Escudo (opcional)<input id="c-escudo" type="file" accept="${ACEPTA}"><small>PNG, JPG o WebP, hasta 1 MB. Mejor si es cuadrado.</small></label>
        <div class="acciones"><button class="btn" type="submit">Agregar club</button></div><p class="msg" id="c-msg" role="alert"></p></form></div></details>
    <div class="tarjeta" id="c-lista">${clubes.map(fila).join('') || '<div class="vacio" style="border:0">Esta liga todavía no tiene clubes.</div>'}</div>`;

  return {
    titulo: 'Clubes',
    html,
    despues() {
      $('#form-club').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#c-msg'), nombre = $('#c-nombre').value.trim(), file = $('#c-escudo').files[0];
        if (!nombre) return msg(m, 'Ingresá el nombre del club.', 'error');
        msg(m, 'Guardando…');
        let img = null;
        try {
          if (file) img = await subirImagen(liga.id, file);
          const { error: e2 } = await sb.from('clubes').insert({ liga_id: liga.id, nombre, nombre_corto: $('#c-corto').value.trim() || null, localidad: $('#c-localidad').value.trim() || null, escudo_url: img?.url || null });
          if (e2) { if (img) await borrarImagen(img.url); return msg(m, e2.code === '23505' ? 'Ya existe un club con ese nombre.' : errTexto(e2), 'error'); }
          ctx.redibujar();
        } catch (err) { msg(m, errTexto(err), 'error'); }
      });
      $('#c-lista').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const c = clubes.find((x) => x.id === b.closest('[data-club]').dataset.club);
        if (b.hasAttribute('data-ed')) editarClub(ct, c);
        if (b.hasAttribute('data-del')) quitarClub(ct, c);
      });
    },
  };
}

async function quitarClub(ct, c) {
  if (!(await confirmar(`¿Quitar el club "${c.nombre}"? Solo se puede si no tiene partidos cargados.`, 'Quitar club'))) return;
  const { data, error } = await sb.from('clubes').delete().eq('id', c.id).select('id');
  if (error) return alert(error.code === '23503' ? 'Este club tiene partidos cargados y no se puede quitar.' : errTexto(error));
  if (!data.length) return alert('No tenés permiso para quitar este club.');
  await borrarImagen(c.escudo_url);
  ct.ctx.redibujar();
}

function editarClub(ct, c) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-cab">Editar club</div><div class="dlg-cuerpo"><form id="ed-form" novalidate style="display:flex;flex-direction:column;gap:14px">
    <div style="display:flex;align-items:center;gap:12px">${miniatura(c)}<span style="font-size:13px;color:var(--muted)">Escudo actual</span></div>
    <label class="campo">Nombre<input id="ed-nombre" required maxlength="80" value="${esc(c.nombre)}"></label>
    <label class="campo">Nombre corto<input id="ed-corto" maxlength="30" value="${esc(c.nombre_corto || '')}"></label>
    <label class="campo">Localidad<input id="ed-localidad" maxlength="60" value="${esc(c.localidad || '')}"></label>
    <label class="campo">Nuevo escudo<input id="ed-escudo" type="file" accept="${ACEPTA}"><small>PNG, JPG o WebP, hasta 1 MB.</small></label>
    ${urlOk(c.escudo_url) ? '<label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="ed-quitar"> Quitar el escudo actual</label>' : ''}
    <div class="acciones"><button class="btn" type="submit">Guardar</button><button class="btn sec" type="button" id="ed-cancel">Cancelar</button></div>
    <p class="msg" id="ed-msg" role="alert"></p></form></div>`;
  document.body.appendChild(d);
  const cerrar = () => { d.close(); d.remove(); };
  $('#ed-cancel', d).addEventListener('click', cerrar);
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  $('#ed-form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#ed-msg', d), nombre = $('#ed-nombre', d).value.trim(), file = $('#ed-escudo', d).files[0];
    if (!nombre) return msg(m, 'Ingresá el nombre del club.', 'error');
    msg(m, 'Guardando…');
    let img = null;
    try {
      if (file) img = await subirImagen(ct.liga.id, file);
      const cambios = { nombre, nombre_corto: $('#ed-corto', d).value.trim() || null, localidad: $('#ed-localidad', d).value.trim() || null };
      if (img) cambios.escudo_url = img.url;
      else if ($('#ed-quitar', d)?.checked) cambios.escudo_url = null;
      const { data, error } = await sb.from('clubes').update(cambios).eq('id', c.id).select('id');
      if (error || !data?.length) {
        if (img) await borrarImagen(img.url);
        return msg(m, error ? (error.code === '23505' ? 'Ya existe un club con ese nombre.' : errTexto(error)) : 'No tenés permiso para editar este club.', 'error');
      }
      if ('escudo_url' in cambios && c.escudo_url) await borrarImagen(c.escudo_url);
      cerrar();
      ct.ctx.redibujar();
    } catch (err) { msg(m, errTexto(err), 'error'); }
  });
  d.showModal();
}

/* ---------- pestaña Mi liga ---------- */
const SECCIONES_OPC = [['fixture', 'Fixture'], ['posiciones', 'Posiciones'], ['goleadores', 'Goleadores'], ['suspendidos', 'Suspendidos'], ['institucional', 'Institucional']];
async function tabLiga(ct) {
  const { ctx } = ct;
  const { data: l, error } = await sb.from('ligas').select('id,slug,nombre,zona,contacto,logo_url,color_primario,color_secundario,secciones_activas').eq('id', ct.liga.id).single();
  if (error) throw error;
  const act = l.secciones_activas || [];
  const html = `<form id="form-mi-liga" class="form-tarjeta panel-ancho" novalidate>
    <label class="campo">Nombre de la liga<input id="m-nombre" required maxlength="80" value="${esc(l.nombre)}"></label>
    <label class="campo">Zona<input id="m-zona" maxlength="80" value="${esc(l.zona || '')}"></label>
    <label class="campo">Contacto<input id="m-contacto" maxlength="120" value="${esc(l.contacto || '')}"></label>
    <div class="form-fila">
      <label class="campo">Color principal<input id="m-c1" type="color" value="${esc(l.color_primario || '#0A7F4F')}"></label>
      <label class="campo">Color secundario<input id="m-c2" type="color" value="${esc(l.color_secundario || '#0B3D2A')}"></label></div>
    <div class="campo"><span>Logo</span><div style="display:flex;align-items:center;gap:12px"><span class="marca-logo" style="background:var(--c1);color:#fff;width:56px;height:56px">${urlOk(l.logo_url) ? `<img src="${esc(l.logo_url)}" alt="">` : 'LOGO'}</span>
      <input id="m-logo" type="file" accept="${ACEPTA}"></div><small>PNG, JPG o WebP, hasta 1 MB.</small>
      ${urlOk(l.logo_url) ? '<label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="m-logo-quitar"> Quitar el logo actual</label>' : ''}</div>
    <fieldset style="border:1px solid var(--linea);border-radius:8px;padding:12px 16px"><legend style="font-size:14px;font-weight:600">Secciones visibles en el sitio</legend>
      ${SECCIONES_OPC.map(([k, n]) => `<label style="display:flex;gap:8px;align-items:center;min-height:36px;font-size:14px"><input type="checkbox" data-sec="${k}"${act.includes(k) ? ' checked' : ''}> ${n}</label>`).join('')}
      <small style="color:var(--muted)">El archivo de torneos aparece solo cuando hay torneos finalizados.</small></fieldset>
    <p style="margin:0;font-size:13px;color:var(--muted)">Dirección web: <strong>/${esc(l.slug)}</strong>. Solo el superadmin puede cambiarla.</p>
    <div class="acciones"><button class="btn" type="submit">Guardar cambios</button></div><p class="msg" id="m-msg" role="status"></p></form>`;
  return {
    titulo: 'Mi liga',
    html,
    despues() {
      $('#form-mi-liga').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#m-msg'), nombre = $('#m-nombre').value.trim(), file = $('#m-logo').files[0];
        if (!nombre) return msg(m, 'Ingresá el nombre de la liga.', 'error');
        msg(m, 'Guardando…');
        let img = null;
        try {
          if (file) img = await subirImagen(l.id, file, 'liga');
          const cambios = {
            nombre, zona: $('#m-zona').value.trim() || null, contacto: $('#m-contacto').value.trim() || null,
            color_primario: $('#m-c1').value, color_secundario: $('#m-c2').value,
            secciones_activas: [...document.querySelectorAll('[data-sec]')].filter((x) => x.checked).map((x) => x.dataset.sec),
          };
          if (img) cambios.logo_url = img.url;
          else if ($('#m-logo-quitar')?.checked) cambios.logo_url = null;
          const { data, error: e2 } = await sb.from('ligas').update(cambios).eq('id', l.id).select('id');
          if (e2 || !data?.length) {
            if (img) await borrarImagen(img.url);
            return msg(m, e2 ? errTexto(e2) : 'No tenés permiso para editar esta liga.', 'error');
          }
          if ('logo_url' in cambios && l.logo_url) await borrarImagen(l.logo_url);
          ctx.redibujar();
        } catch (err) { msg(m, errTexto(err), 'error'); }
      });
    },
  };
}

/* ---------- pestaña Jugadores (planteles) ---------- */
// El DNI y la fecha de nacimiento viven en una tabla privada (jugadores_datos): solo el administrador de la liga los lee.
const dniLimpio = (s) => String(s || '').replace(/[.\s-]/g, '');
function fechaISO(s) {
  s = String(s || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/), iso = null;
  if (m) iso = s;
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}
const edadDe = (iso) => { if (!iso) return null; const h = new Date(), n = new Date(iso + 'T12:00:00Z'); let e = h.getFullYear() - n.getUTCFullYear(); if (h.getMonth() < n.getUTCMonth() || (h.getMonth() === n.getUTCMonth() && h.getDate() < n.getUTCDate())) e--; return e; };
const unoDe = (x) => (Array.isArray(x) ? x[0] : x) || null;

// Una línea por jugador: "Nombre Apellido", "Apellido, Nombre" o columnas con tab / punto y coma: Nombre; Apellido; DNI; Nacimiento
function parsearLista(texto) {
  const filas = [], errores = [], dnis = new Set();
  String(texto || '').split(/\r?\n/).forEach((linea, i) => {
    const l = linea.trim();
    if (!l) return;
    let nombre, apellido, dni = '', nac = '';
    if (/[\t;]/.test(l)) {
      const c = l.split(/[\t;]/).map((x) => x.trim());
      [nombre, apellido, dni = '', nac = ''] = c;
    } else if (l.includes(',')) {
      const m = l.match(/^([^,]+),\s*(.+)$/);
      if (m) { apellido = m[1].trim(); nombre = m[2].trim(); }
    } else {
      const p = partirNombre(l);
      if (p) { nombre = p.nombre; apellido = p.apellido; }
    }
    if (!nombre || !apellido) return errores.push(`Línea ${i + 1}: falta el nombre o el apellido ("${l.slice(0, 40)}")`);
    if (nombre.length > 60 || apellido.length > 60) return errores.push(`Línea ${i + 1}: el nombre o apellido es demasiado largo`);
    dni = dniLimpio(dni);
    if (dni && !/^\d{6,9}$/.test(dni)) return errores.push(`Línea ${i + 1}: el DNI debe tener entre 6 y 9 números`);
    if (dni && dnis.has(dni)) return errores.push(`Línea ${i + 1}: el DNI ${dni} está repetido en la lista`);
    if (dni) dnis.add(dni);
    const f = fechaISO(nac);
    if (f === null) return errores.push(`Línea ${i + 1}: la fecha de nacimiento no es válida (usá AAAA-MM-DD o DD/MM/AAAA)`);
    filas.push({ nombre, apellido, dni, nacimiento: f });
  });
  return { filas, errores };
}

async function tabJugadores(ct) {
  const { liga, ctx } = ct;
  const [t, c] = await Promise.all([
    sb.from('torneos').select('id,nombre,anio,estado,categorias(id,nombre,orden)').eq('liga_id', liga.id).order('anio', { ascending: false }),
    sb.from('clubes').select('id,nombre').eq('liga_id', liga.id).order('nombre'),
  ]);
  if (t.error) throw t.error;
  if (c.error) throw c.error;
  const torneos = t.data, clubes = c.data;
  if (!torneos.length || !clubes.length) return { titulo: 'Jugadores', html: '<div class="vacio">Para cargar jugadores la liga necesita al menos un club y un torneo.</div>' };
  const orden = (a) => (a.estado === 'en_curso' ? 0 : a.estado === 'borrador' ? 1 : 2);
  torneos.sort((a, b) => orden(a) - orden(b) || b.anio - a.anio);

  const html = `<div class="controles">
      <label class="solo-lectores" for="j-torneo">Torneo</label><select id="j-torneo">${torneos.map((x) => `<option value="${x.id}">${esc(x.nombre)} ${x.anio}${x.estado === 'finalizado' ? ' (finalizado)' : ''}</option>`).join('')}</select>
      <label class="solo-lectores" for="j-club">Club</label><select id="j-club">${clubes.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select>
      <label class="solo-lectores" for="j-buscar">Buscar jugador</label><input id="j-buscar" type="search" placeholder="Buscar por nombre o DNI" autocomplete="off" style="min-height:44px;border:1px solid var(--linea);border-radius:8px;padding:0 12px;font:inherit"></div>
    <div id="j-aviso"></div>
    <h2 class="sub-titulo" style="margin:0 0 10px"><span id="j-titulo">Plantel</span></h2>
    <div class="tarjeta" id="j-lista"><p class="cargando">Cargando…</p></div>
    <details class="acordeon" style="margin-top:20px"><summary>Agregar jugador</summary><div class="cuerpo" style="white-space:normal">
      <form id="j-form" class="form-tarjeta" novalidate style="border:0;padding:0">
        <div class="form-fila"><label class="campo">Nombre<input id="j-nombre" maxlength="60"></label><label class="campo">Apellido<input id="j-apellido" maxlength="60"></label></div>
        <div class="form-fila"><label class="campo">DNI (opcional)<input id="j-dni" inputmode="numeric" maxlength="12" placeholder="Solo números"></label><label class="campo">Fecha de nacimiento (opcional)<input id="j-nac" type="date"></label></div>
        <label class="campo">Categoría<select id="j-cat"></select><small>"Todas" significa que puede jugar en cualquier categoría del torneo.</small></label>
        <div class="acciones"><button class="btn" type="submit">Agregar jugador</button></div><p class="msg" id="j-msg" role="alert"></p></form></div></details>
    <details class="acordeon"><summary>Cargar una lista (pegar desde Excel o un documento)</summary><div class="cuerpo" style="white-space:normal">
      <form id="jl-form" class="form-tarjeta" novalidate style="border:0;padding:0">
        <label class="campo">Lista de jugadores<textarea id="jl-texto" rows="8" placeholder="Juan Pérez&#10;Gómez, Matías&#10;Lucas; Ríos; 30111222; 2001-05-04"></textarea>
          <small>Una línea por jugador: "Nombre Apellido", "Apellido, Nombre", o columnas separadas por tab o punto y coma: Nombre; Apellido; DNI; Nacimiento. Hasta 300 por vez.</small></label>
        <label class="campo">Categoría<select id="jl-cat"></select></label>
        <div class="acciones"><button class="btn sec" type="button" id="jl-revisar">Revisar lista</button><button class="btn" type="submit" id="jl-cargar" disabled>Cargar jugadores</button></div><p class="msg" id="jl-msg" role="alert"></p><div id="jl-previa"></div></form></div></details>
    <p style="font-size:13px;color:var(--muted)">El DNI y la fecha de nacimiento no se muestran en el sitio público: solo los ve el administrador de la liga. Cargá solo los datos que realmente necesites.</p>`;

  return {
    titulo: 'Jugadores',
    html,
    despues() {
      const sT = $('#j-torneo'), sC = $('#j-club'), lista = $('#j-lista'), buscar = $('#j-buscar');
      let filas = [];
      const torneoSel = () => torneos.find((x) => x.id === sT.value);
      const cats = () => (torneoSel().categorias || []).slice().sort((a, b) => a.orden - b.orden);
      const llenarCats = () => { const o = '<option value="">Todas las categorías</option>' + cats().map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join(''); $('#j-cat').innerHTML = o; $('#jl-cat').innerHTML = o; };
      const nombreCat = (id) => cats().find((x) => x.id === id)?.nombre || 'Todas las categorías';
      const nombreClub = (id) => clubes.find((x) => x.id === id)?.nombre || '';

      const pintar = () => {
        const q = buscar.value.trim().toLowerCase();
        const vis = filas.filter((f) => !q || `${f.nombre} ${f.apellido} ${f.dni || ''}`.toLowerCase().includes(q));
        $('#j-titulo').textContent = `${nombreClub(sC.value)} · ${filas.length} ${filas.length === 1 ? 'jugador' : 'jugadores'}`;
        $('#j-aviso').innerHTML = torneoSel().estado === 'finalizado' ? '<p class="aviso">Este torneo está finalizado: solo el superadmin puede modificar sus planteles.</p>' : '';
        lista.innerHTML = vis.length ? vis.map((f) => {
          const edad = edadDe(f.nacimiento);
          return `<div class="panel-liga" data-id="${f.plantel}"><div style="flex:1 1 260px;min-width:0"><h3 style="font-size:22px">${esc(f.apellido)}, ${esc(f.nombre)}</h3>
            <div class="chips"><span class="chip">${esc(nombreCat(f.categoria_id))}</span>${f.dni ? `<span class="chip">DNI ${esc(f.dni)}</span>` : ''}${edad != null ? `<span class="chip${edad < 18 ? ' oro' : ''}">${edad} años</span>` : ''}${f.activo ? '' : '<span class="chip oro">De baja</span>'}</div><p class="msg" role="status"></p></div>
            <div class="acciones"><button class="btn sec" data-editar>Editar</button><button class="btn sec" data-club>Cambiar de club</button><button class="btn sec" data-baja>${f.activo ? 'Dar de baja' : 'Dar de alta'}</button><button class="btn sec" data-quitar>Quitar</button></div></div>`;
        }).join('') : `<div class="vacio" style="border:0">${filas.length ? 'Ningún jugador coincide con la búsqueda.' : 'Este club todavía no tiene jugadores en este torneo.'}</div>`;
      };
      const cargar = async () => {
        lista.innerHTML = '<p class="cargando">Cargando…</p>';
        const { data, error } = await sb.from('planteles').select('id,categoria_id,activo,jugador_id,jugadores(nombre,apellido,jugadores_datos(dni,nacimiento))')
          .eq('torneo_id', sT.value).eq('club_id', sC.value).range(0, 999);
        if (error) { lista.innerHTML = `<div class="vacio" style="border:0">${esc(errTexto(error))}</div>`; return; }
        filas = data.map((x) => { const d = unoDe(x.jugadores?.jugadores_datos); return { plantel: x.id, jugador: x.jugador_id, categoria_id: x.categoria_id, activo: x.activo, nombre: x.jugadores?.nombre || '', apellido: x.jugadores?.apellido || '', dni: d?.dni || '', nacimiento: d?.nacimiento || '' }; })
          .sort((a, b) => a.apellido.localeCompare(b.apellido, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
        pintar();
      };
      llenarCats();
      sT.addEventListener('change', () => { llenarCats(); cargar(); });
      sC.addEventListener('change', cargar);
      buscar.addEventListener('input', pintar);

      const cargarEnBloque = (lote, categoria) => sb.rpc('cargar_jugadores', { p_liga: liga.id, p_torneo: sT.value, p_club: sC.value, p_categoria: categoria || null, p_jugadores: lote });

      $('#j-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#j-msg'), nombre = $('#j-nombre').value.trim(), apellido = $('#j-apellido').value.trim(), dni = dniLimpio($('#j-dni').value), nac = $('#j-nac').value;
        if (!nombre || !apellido) return msg(m, 'Ingresá nombre y apellido.', 'error');
        if (dni && !/^\d{6,9}$/.test(dni)) return msg(m, 'El DNI debe tener entre 6 y 9 números.', 'error');
        msg(m, 'Guardando…');
        const { error } = await cargarEnBloque([{ nombre, apellido, dni, nacimiento: nac }], $('#j-cat').value);
        if (error) return msg(m, errTexto(error), 'error');
        msg(m, 'Jugador agregado ✓', 'ok');
        ['#j-nombre', '#j-apellido', '#j-dni', '#j-nac'].forEach((s) => { $(s).value = ''; });
        cargar();
      });

      let previa = null;
      $('#jl-revisar').addEventListener('click', () => {
        const r = parsearLista($('#jl-texto').value), m = $('#jl-msg');
        previa = r.errores.length ? null : r.filas;
        $('#jl-cargar').disabled = !previa || !previa.length || previa.length > 300;
        if (!r.filas.length && !r.errores.length) return msg(m, 'Pegá primero la lista.', 'error');
        if (r.filas.length > 300) { $('#jl-cargar').disabled = true; return msg(m, 'Hay más de 300 jugadores: cargá la lista en partes.', 'error'); }
        msg(m, r.errores.length ? `Hay ${r.errores.length} línea(s) con problemas. Corregilas y volvé a revisar.` : `Lista lista: ${r.filas.length} jugadores para ${nombreClub(sC.value)} en ${nombreCat($('#jl-cat').value)}.`, r.errores.length ? 'error' : 'ok');
        $('#jl-previa').innerHTML = r.errores.length
          ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#B42318">${r.errores.slice(0, 12).map((x) => `<li>${esc(x)}</li>`).join('')}${r.errores.length > 12 ? '<li>…y más</li>' : ''}</ul>`
          : `<p style="margin:8px 0 0;font-size:13px;color:var(--muted)">Primeros: ${esc(r.filas.slice(0, 5).map((x) => `${x.apellido}, ${x.nombre}`).join(' · '))}${r.filas.length > 5 ? '…' : ''}</p>`;
      });
      $('#jl-texto').addEventListener('input', () => { previa = null; $('#jl-cargar').disabled = true; });
      $('#jl-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#jl-msg');
        if (!previa || !previa.length) return msg(m, 'Primero revisá la lista.', 'error');
        $('#jl-cargar').disabled = true; msg(m, `Cargando ${previa.length} jugadores…`);
        const { data, error } = await cargarEnBloque(previa, $('#jl-cat').value);
        if (error) { $('#jl-cargar').disabled = false; return msg(m, errTexto(error), 'error'); }
        msg(m, `Se cargaron ${data} jugadores ✓`, 'ok');
        $('#jl-texto').value = ''; $('#jl-previa').innerHTML = ''; previa = null;
        cargar();
      });

      lista.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const fila = b.closest('[data-id]'), f = filas.find((x) => x.plantel === fila.dataset.id), m = $('.msg', fila);
        if (b.hasAttribute('data-editar')) editarJugador(ct, f, cats(), cargar);
        else if (b.hasAttribute('data-club')) cambiarClub(f, clubes.filter((x) => x.id !== sC.value), cargar);
        else if (b.hasAttribute('data-baja')) {
          const { data, error } = await sb.from('planteles').update({ activo: !f.activo }).eq('id', f.plantel).select('id');
          if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No tenés permiso para modificar este plantel.', 'error');
          cargar();
        } else if (b.hasAttribute('data-quitar')) {
          if (!(await confirmar(`¿Quitar a ${f.nombre} ${f.apellido} del plantel de ${nombreClub(sC.value)}? El jugador no se borra: queda sin club en este torneo.`, 'Quitar del plantel'))) return;
          const { data, error } = await sb.from('planteles').delete().eq('id', f.plantel).select('id');
          if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No tenés permiso para modificar este plantel.', 'error');
          cargar();
        }
      });
      cargar();
    },
  };
}

function editarJugador(ct, f, cats, alGuardar) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-cab">Editar jugador</div><div class="dlg-cuerpo"><form id="ej-form" novalidate style="display:flex;flex-direction:column;gap:14px">
    <div class="form-fila"><label class="campo">Nombre<input id="ej-nombre" maxlength="60" value="${esc(f.nombre)}"></label><label class="campo">Apellido<input id="ej-apellido" maxlength="60" value="${esc(f.apellido)}"></label></div>
    <div class="form-fila"><label class="campo">DNI<input id="ej-dni" inputmode="numeric" maxlength="12" value="${esc(f.dni)}"></label><label class="campo">Nacimiento<input id="ej-nac" type="date" value="${esc(f.nacimiento)}"></label></div>
    <label class="campo">Categoría<select id="ej-cat"><option value="">Todas las categorías</option>${cats.map((c) => `<option value="${c.id}"${c.id === f.categoria_id ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
    <div class="acciones"><button class="btn" type="submit">Guardar</button><button class="btn sec" type="button" id="ej-cancel">Cancelar</button><button class="btn peligro chico" type="button" id="ej-borrar">Eliminar jugador</button></div><p class="msg" id="ej-msg" role="alert"></p></form></div>`;
  document.body.appendChild(d);
  const cerrar = () => { d.close(); d.remove(); };
  $('#ej-cancel', d).addEventListener('click', cerrar);
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  $('#ej-form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#ej-msg', d), nombre = $('#ej-nombre', d).value.trim(), apellido = $('#ej-apellido', d).value.trim(), dni = dniLimpio($('#ej-dni', d).value), nac = $('#ej-nac', d).value;
    if (!nombre || !apellido) return msg(m, 'Ingresá nombre y apellido.', 'error');
    if (dni && !/^\d{6,9}$/.test(dni)) return msg(m, 'El DNI debe tener entre 6 y 9 números.', 'error');
    msg(m, 'Guardando…');
    const a = await sb.from('jugadores').update({ nombre, apellido }).eq('id', f.jugador).select('id');
    if (a.error || !a.data?.length) return msg(m, a.error ? errTexto(a.error) : 'No tenés permiso para editar este jugador.', 'error');
    const b = dni || nac
      ? await sb.from('jugadores_datos').upsert({ jugador_id: f.jugador, liga_id: ct.liga.id, dni: dni || null, nacimiento: nac || null })
      : await sb.from('jugadores_datos').delete().eq('jugador_id', f.jugador);
    if (b.error) return msg(m, b.error.code === '23505' ? 'Ese DNI ya está cargado en otro jugador de la liga.' : errTexto(b.error), 'error');
    const c = await sb.from('planteles').update({ categoria_id: $('#ej-cat', d).value || null }).eq('id', f.plantel).select('id');
    if (c.error || !c.data?.length) return msg(m, c.error ? errTexto(c.error) : 'No tenés permiso para modificar el plantel.', 'error');
    cerrar(); alGuardar();
  });
  $('#ej-borrar', d).addEventListener('click', async () => {
    if (!(await confirmar(`¿Eliminar a ${f.nombre} ${f.apellido} de la liga? Se borra el jugador y sus datos. Si tiene goles o tarjetas cargados, no se puede: usá "Dar de baja".`, 'Eliminar jugador'))) return;
    const m = $('#ej-msg', d);
    const { data, error } = await sb.from('jugadores').delete().eq('id', f.jugador).select('id');
    if (error) return msg(m, error.code === '23503' ? 'Tiene goles, tarjetas o suspensiones cargados y no se puede eliminar. Usá "Dar de baja".' : errTexto(error), 'error');
    if (!data?.length) return msg(m, 'No tenés permiso para eliminar este jugador.', 'error');
    cerrar(); alGuardar();
  });
  d.showModal();
}

function cambiarClub(f, otros, alGuardar) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-cab">Cambiar de club</div><div class="dlg-cuerpo"><p style="margin:0;font-weight:600">${esc(f.nombre)} ${esc(f.apellido)}</p>
    <form id="cc2-form" novalidate style="display:flex;flex-direction:column;gap:14px"><label class="campo">Nuevo club<select id="cc2-club">${otros.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></label>
    <div class="acciones"><button class="btn" type="submit">Cambiar</button><button class="btn sec" type="button" id="cc2-cancel">Cancelar</button></div><p class="msg" id="cc2-msg" role="alert"></p></form></div>`;
  document.body.appendChild(d);
  const cerrar = () => { d.close(); d.remove(); };
  $('#cc2-cancel', d).addEventListener('click', cerrar);
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  $('#cc2-form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#cc2-msg', d);
    const { data, error } = await sb.from('planteles').update({ club_id: $('#cc2-club', d).value }).eq('id', f.plantel).select('id');
    if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No tenés permiso para modificar el plantel.', 'error');
    cerrar(); alGuardar();
  });
  d.showModal();
}

/* ---------- pestaña Sponsors ---------- */
const NIVELES = { presentador: 'Presentador', oficial: 'Oficial', colaborador: 'Colaborador' };
const NIVEL_AYUDA = 'Presentador: junto a la tabla de posiciones (1 por torneo). Oficial: franja de logos en todo el sitio. Colaborador: tarjeta lateral.';
const hoyAR = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });          // 'AAAA-MM-DD'
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtISO = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
function estadoSponsor(s) {
  const hoy = hoyAR();
  if (!s.activo) return 'Pausado';
  if (s.vigente_hasta && s.vigente_hasta < hoy) return 'Vencido';
  if (s.vigente_desde && s.vigente_desde > hoy) return 'Programado';
  if (s.vigente_hasta && s.vigente_hasta <= sumarDias(hoy, 30)) return 'Por vencer';
  return 'Activo';
}
const ESTADO_CHIP = { Activo: 'verde', 'Por vencer': 'oro', Programado: '', Pausado: '', Vencido: '' };
const campoSponsor = (p, s = {}) => `
  <label class="campo">Nombre del comercio<input id="${p}-nombre" maxlength="80" value="${esc(s.nombre || '')}" placeholder="Ej.: Ferretería Rossi"></label>
  <label class="campo">Enlace (web, Instagram o WhatsApp)<input id="${p}-link" type="url" maxlength="300" value="${esc(s.link || '')}" placeholder="https://"></label>
  <label class="campo">Nivel<select id="${p}-nivel">${Object.entries(NIVELES).map(([k, n]) => `<option value="${k}"${(s.nivel || 'colaborador') === k ? ' selected' : ''}>${n}</option>`).join('')}</select><small>${NIVEL_AYUDA}</small></label>
  <div class="form-fila"><label class="campo">Desde (opcional)<input id="${p}-desde" type="date" value="${esc(s.vigente_desde || '')}"></label>
    <label class="campo">Hasta (opcional)<input id="${p}-hasta" type="date" value="${esc(s.vigente_hasta || '')}"></label></div>
  <label class="campo">Logo${s.nombre ? ' (subí uno nuevo para reemplazarlo)' : ''}<input id="${p}-logo" type="file" accept="${ACEPTA}"><small>PNG, JPG o WebP, hasta 1 MB. Mejor con fondo transparente y cuadrado.</small></label>`;
function leerSponsor(p) {
  const nombre = $(`#${p}-nombre`).value.trim(), link = $(`#${p}-link`).value.trim();
  const desde = $(`#${p}-desde`).value || null, hasta = $(`#${p}-hasta`).value || null;
  if (!nombre) return { error: 'Ingresá el nombre del comercio.' };
  if (link && !/^https?:\/\//i.test(link)) return { error: 'El enlace debe empezar con http:// o https://' };
  if (desde && hasta && hasta < desde) return { error: 'La fecha "Hasta" no puede ser anterior a "Desde".' };
  return { datos: { nombre, link: link || null, nivel: $(`#${p}-nivel`).value, vigente_desde: desde, vigente_hasta: hasta }, archivo: $(`#${p}-logo`).files[0] || null };
}

async function tabSponsors(ct) {
  const { liga, ctx } = ct;
  const [a, b] = await Promise.all([
    sb.from('sponsors').select('id,nombre,logo_url,link,nivel,orden,activo,vigente_desde,vigente_hasta').eq('liga_id', liga.id).order('orden'),
    sb.from('sponsors_estadisticas').select('sponsor_id,clics_mes,clics_total').eq('liga_id', liga.id),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  const stats = Object.fromEntries(b.data.map((x) => [x.sponsor_id, x]));
  const orden = { presentador: 0, oficial: 1, colaborador: 2 };
  const lista = a.data.slice().sort((x, y) => orden[x.nivel] - orden[y.nivel] || x.orden - y.orden);
  const vigentes = lista.filter((s) => ['Activo', 'Por vencer'].includes(estadoSponsor(s)));
  const porVencer = lista.filter((s) => estadoSponsor(s) === 'Por vencer').length;
  const clicsMes = lista.reduce((n, s) => n + (stats[s.id]?.clics_mes || 0), 0);

  const fila = (s) => {
    const est = estadoSponsor(s), st = stats[s.id] || {};
    const gris = est === 'Vencido' || est === 'Pausado';
    return `<div class="panel-liga" data-id="${s.id}"><div style="display:flex;align-items:center;gap:12px;flex:1 1 280px;min-width:0">${miniatura({ nombre: s.nombre, escudo_url: s.logo_url })}
        <div style="min-width:0"><h3 style="font-size:22px">${esc(s.nombre)}</h3>
          <div class="chips"><span class="chip ${s.nivel === 'presentador' ? 'oro' : s.nivel === 'oficial' ? 'verde' : ''}">${NIVELES[s.nivel]}</span><span class="chip ${ESTADO_CHIP[est]}"${gris ? ' style="opacity:.7"' : ''}>${est}</span>
            ${s.vigente_desde || s.vigente_hasta ? `<span class="chip">${fmtISO(s.vigente_desde) || '…'} al ${fmtISO(s.vigente_hasta) || '…'}</span>` : '<span class="chip">Sin vencimiento</span>'}
            <span class="chip">${st.clics_mes ?? 0} clics este mes · ${st.clics_total ?? 0} en total</span></div>
          ${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:var(--muted);word-break:break-all">${esc(s.link)}</a>` : '<span style="font-size:12px;color:var(--muted)">Sin enlace</span>'}
          <p class="msg" role="status"></p></div></div>
      <div class="acciones"><button class="btn sec chico" data-subir aria-label="Subir ${esc(s.nombre)}">↑</button><button class="btn sec chico" data-bajar aria-label="Bajar ${esc(s.nombre)}">↓</button>
        <button class="btn sec" data-editar>Editar</button><button class="btn sec" data-pausa>${s.activo ? 'Pausar' : 'Activar'}</button><button class="btn sec" data-quitar>Quitar</button></div></div>`;
  };

  const html = `<div class="datos" style="margin-bottom:20px">
      <div class="tarjeta pad"><span class="dato-rotulo">Activos</span><span class="dato-grande" style="color:var(--c1)">${vigentes.length}</span></div>
      <div class="tarjeta pad"><span class="dato-rotulo">Vencen en 30 días</span><span class="dato-grande" style="color:#7A5200">${porVencer}</span></div>
      <div class="tarjeta pad"><span class="dato-rotulo">Clics este mes</span><span class="dato-grande" style="color:var(--c1)">${clicsMes}</span></div></div>
    <details class="acordeon" style="margin-bottom:20px"><summary>Nuevo sponsor</summary><div class="cuerpo" style="white-space:normal">
      <form id="sp-form" class="form-tarjeta" novalidate style="border:0;padding:0">${campoSponsor('sp')}
        <div class="acciones"><button class="btn" type="submit">Agregar sponsor</button></div><p class="msg" id="sp-msg" role="alert"></p></form></div></details>
    <div class="tarjeta" id="sp-lista">${lista.map(fila).join('') || '<div class="vacio" style="border:0">Todavía no hay sponsors. Agregá el primero.</div>'}</div>
    <p style="font-size:13px;color:var(--muted)">Al vencer la fecha "Hasta", el sponsor se oculta del sitio solo. Los clics se cuentan sin cookies ni datos personales y son orientativos.</p>`;

  const hayPresentador = (excluir) => lista.some((s) => s.nivel === 'presentador' && s.id !== excluir && ['Activo', 'Por vencer', 'Programado'].includes(estadoSponsor(s)));
  return {
    titulo: 'Sponsors',
    html,
    despues() {
      $('#sp-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#sp-msg'), r = leerSponsor('sp');
        if (r.error) return msg(m, r.error, 'error');
        if (r.datos.nivel === 'presentador' && hayPresentador(null) && !(await confirmar('Ya hay un presentador activo. ¿Agregar otro igual? En el sitio se muestra el primero de la lista.', 'Agregar igual'))) return;
        msg(m, 'Guardando…');
        let img = null;
        try {
          if (r.archivo) img = await subirImagen(liga.id, r.archivo, 'cuadrado');
          const mismos = lista.filter((s) => s.nivel === r.datos.nivel);
          const ord = mismos.reduce((mx, s) => Math.max(mx, s.orden), 0) + 1;
          const { error } = await sb.from('sponsors').insert({ liga_id: liga.id, ...r.datos, orden: ord, logo_url: img?.url || null, activo: true });
          if (error) { if (img) await borrarImagen(img.url); return msg(m, errTexto(error), 'error'); }
          ctx.redibujar();
        } catch (err) { msg(m, errTexto(err), 'error'); }
      });

      $('#sp-lista').addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const fila = btn.closest('[data-id]'), s = lista.find((x) => x.id === fila.dataset.id), m = $('.msg', fila);
        if (btn.hasAttribute('data-subir') || btn.hasAttribute('data-bajar')) {
          const mismos = lista.filter((x) => x.nivel === s.nivel), i = mismos.findIndex((x) => x.id === s.id);
          const j = i + (btn.hasAttribute('data-subir') ? -1 : 1);
          if (j < 0 || j >= mismos.length) return;
          const nuevo = mismos.slice(); [nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]];
          const res = await Promise.all(nuevo.map((x, k) => (x.orden !== k + 1 ? sb.from('sponsors').update({ orden: k + 1 }).eq('id', x.id).select('id') : null)).filter(Boolean));
          const mal = res.find((r) => r.error || !r.data?.length);
          if (mal) return msg(m, mal.error ? errTexto(mal.error) : 'No tenés permiso para reordenar.', 'error');
          ctx.redibujar();
        } else if (btn.hasAttribute('data-pausa')) {
          const { data, error } = await sb.from('sponsors').update({ activo: !s.activo }).eq('id', s.id).select('id');
          if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No tenés permiso para modificar este sponsor.', 'error');
          ctx.redibujar();
        } else if (btn.hasAttribute('data-quitar')) {
          if (!(await confirmar(`¿Quitar a "${s.nombre}"? Se borran también sus clics. Si solo querés ocultarlo, usá Pausar.`, 'Quitar'))) return;
          const { data, error } = await sb.from('sponsors').delete().eq('id', s.id).select('id');
          if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No tenés permiso para quitar este sponsor.', 'error');
          await borrarImagen(s.logo_url);
          ctx.redibujar();
        } else if (btn.hasAttribute('data-editar')) {
          editarSponsor(ct, s, hayPresentador(s.id));
        }
      });
    },
  };
}

function editarSponsor(ct, s, hayOtroPresentador) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-cab">Editar sponsor</div><div class="dlg-cuerpo"><form id="es-form" novalidate style="display:flex;flex-direction:column;gap:14px">
    <div style="display:flex;align-items:center;gap:12px">${miniatura({ nombre: s.nombre, escudo_url: s.logo_url })}<span style="font-size:13px;color:var(--muted)">Logo actual</span></div>
    ${campoSponsor('es', s)}
    ${urlOk(s.logo_url) ? '<label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="es-quitar-logo"> Quitar el logo actual</label>' : ''}
    <div class="acciones"><button class="btn" type="submit">Guardar</button><button class="btn sec" type="button" id="es-cancel">Cancelar</button></div><p class="msg" id="es-msg" role="alert"></p></form></div>`;
  document.body.appendChild(d);
  const cerrar = () => { d.close(); d.remove(); };
  $('#es-cancel', d).addEventListener('click', cerrar);
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  $('#es-form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#es-msg', d), r = leerSponsor('es');
    if (r.error) return msg(m, r.error, 'error');
    if (r.datos.nivel === 'presentador' && s.nivel !== 'presentador' && hayOtroPresentador && !(await confirmar('Ya hay un presentador activo. ¿Pasarlo a presentador igual?', 'Pasar igual'))) return;
    msg(m, 'Guardando…');
    let img = null;
    try {
      if (r.archivo) img = await subirImagen(ct.liga.id, r.archivo, 'cuadrado');
      const cambios = { ...r.datos };
      if (img) cambios.logo_url = img.url; else if ($('#es-quitar-logo', d)?.checked) cambios.logo_url = null;
      const { data, error } = await sb.from('sponsors').update(cambios).eq('id', s.id).select('id');
      if (error || !data?.length) {
        if (img) await borrarImagen(img.url);
        return msg(m, error ? errTexto(error) : 'No tenés permiso para editar este sponsor.', 'error');
      }
      if ('logo_url' in cambios && s.logo_url) await borrarImagen(s.logo_url);
      cerrar(); ct.ctx.redibujar();
    } catch (err) { msg(m, errTexto(err), 'error'); }
  });
  d.showModal();
}

/* ---------- pestaña Institucional (textos y documentos) ---------- */
const DOC_TIPOS = {
  'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
};
const DOC_ACEPTA = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp';
const DOC_TITULOS = { buena_fe: 'Lista de Buena Fe', fichajes: 'Fichajes' };
async function subirDocumento(ligaId, file) {
  const ext = DOC_TIPOS[file.type];
  if (!ext) throw new Error('El archivo debe ser PDF, Word, Excel o una imagen (PNG, JPG, WebP).');
  if (file.size > 5242880) throw new Error('El archivo pesa más de 5 MB.');
  const path = `${ligaId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('documentos').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
  if (error) throw error;
  return sb.storage.from('documentos').getPublicUrl(path).data.publicUrl;
}
async function borrarDocumento(url) {
  const i = String(url || '').indexOf('/object/public/documentos/');
  if (i < 0) return;
  const ruta = decodeURIComponent(url.slice(i + '/object/public/documentos/'.length).split('?')[0]);
  const r = await sb.storage.from('documentos').remove([ruta]).catch((e) => ({ error: e }));
  if (r.error || !r.data?.length) console.warn('No se pudo borrar el archivo:', ruta, r.error?.message || '');
}
const fmtDia = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });

async function tabInstitucional(ct) {
  const { liga, ctx } = ct;
  const [a, b] = await Promise.all([
    sb.from('institucional').select('id,orden,titulo,contenido').eq('liga_id', liga.id).order('orden'),
    sb.from('documentos').select('id,tipo,archivo_url,nombre,subido_en').eq('liga_id', liga.id).order('subido_en', { ascending: false }),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  const textos = a.data, docs = b.data;

  const filaTexto = (t, i) => `<div class="panel-liga" data-id="${t.id}"><div style="flex:1 1 260px;min-width:0"><h3 style="font-size:22px">${esc(t.titulo)}</h3>
      <p style="margin:4px 0 0;font-size:13px;color:var(--muted);white-space:pre-line">${esc(t.contenido.slice(0, 140))}${t.contenido.length > 140 ? '…' : ''}</p><p class="msg" role="status"></p></div>
      <div class="acciones"><button class="btn sec chico" data-subir aria-label="Subir ${esc(t.titulo)}"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="btn sec chico" data-bajar aria-label="Bajar ${esc(t.titulo)}"${i === textos.length - 1 ? ' disabled' : ''}>↓</button>
        <button class="btn sec" data-editar>Editar</button><button class="btn sec" data-quitar>Quitar</button></div></div>`;
  const bloqueDocs = (tipo) => {
    const lista = docs.filter((d) => d.tipo === tipo);
    return `<div class="form-tarjeta" data-tipo="${tipo}"><h3 class="sub-titulo" style="font-size:22px">${DOC_TITULOS[tipo]}</h3>
      ${lista.length ? lista.map((d, i) => `<div class="evento" data-doc="${d.id}"><span><a href="${esc(d.archivo_url)}" target="_blank" rel="noopener">${esc(d.nombre || 'Documento')}</a>
          <em style="color:var(--muted)"> · ${fmtDia(d.subido_en)}${i === 0 ? ' · el que ve el público' : ''}</em></span><button class="btn sec chico" data-quitar-doc>Quitar</button></div>`).join('')
        : '<p style="margin:0;color:var(--muted)">Todavía no subiste ninguno.</p>'}
      <label class="campo">Subir uno nuevo<input type="file" data-archivo accept="${DOC_ACEPTA}"><small>PDF, Word, Excel o imagen, hasta 5 MB. El más reciente es el que se muestra en el sitio.</small></label>
      <div class="acciones"><button class="btn" data-subir-doc>Subir ${DOC_TITULOS[tipo]}</button></div><p class="msg" role="alert"></p></div>`;
  };

  const html = `<h2 class="sub-titulo" style="margin:0 0 10px">Textos de la liga</h2>
    <div class="tarjeta" id="i-lista">${textos.map(filaTexto).join('') || '<div class="vacio" style="border:0">Todavía no hay secciones. Agregá la primera.</div>'}</div>
    <details class="acordeon" style="margin-top:16px"><summary>Agregar sección</summary><div class="cuerpo" style="white-space:normal">
      <form id="i-form" class="form-tarjeta" novalidate style="border:0;padding:0">
        <label class="campo">Título<input id="i-titulo" maxlength="120" placeholder="Ej.: Autoridades"></label>
        <label class="campo">Contenido<textarea id="i-contenido" maxlength="20000" rows="5"></textarea></label>
        <div class="acciones"><button class="btn" type="submit">Agregar sección</button></div><p class="msg" id="i-msg" role="alert"></p></form></div></details>
    <h2 class="sub-titulo" style="margin:28px 0 10px">Documentos descargables</h2>
    <div style="display:flex;flex-direction:column;gap:16px">${bloqueDocs('buena_fe')}${bloqueDocs('fichajes')}</div>`;

  return {
    titulo: 'Institucional',
    html,
    despues() {
      const alt = () => ctx.redibujar();
      $('#i-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#i-msg'), titulo = $('#i-titulo').value.trim();
        if (!titulo) return msg(m, 'Ingresá un título.', 'error');
        msg(m, 'Guardando…');
        const orden = (textos.reduce((mx, t) => Math.max(mx, t.orden), 0)) + 1;
        const { error } = await sb.from('institucional').insert({ liga_id: liga.id, orden, titulo, contenido: $('#i-contenido').value });
        if (error) return msg(m, errTexto(error), 'error');
        alt();
      });

      $('#i-lista').addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn || btn.disabled) return;
        const fila = btn.closest('[data-id]'), idx = textos.findIndex((t) => t.id === fila.dataset.id), m = $('.msg', fila);
        if (btn.hasAttribute('data-subir') || btn.hasAttribute('data-bajar')) {
          const j = idx + (btn.hasAttribute('data-subir') ? -1 : 1);
          const nuevo = textos.slice(); [nuevo[idx], nuevo[j]] = [nuevo[j], nuevo[idx]];
          const cambios = nuevo.map((t, k) => ({ t, orden: k + 1 })).filter((x) => x.t.orden !== x.orden);
          const res = await Promise.all(cambios.map((x) => sb.from('institucional').update({ orden: x.orden }).eq('id', x.t.id).select('id')));
          const mal = res.find((r) => r.error || !r.data?.length);
          if (mal) return msg(m, mal.error ? errTexto(mal.error) : 'No tenés permiso para reordenar.', 'error');
          alt();
        } else if (btn.hasAttribute('data-quitar')) {
          if (!(await confirmar(`¿Quitar la sección "${textos[idx].titulo}"?`, 'Quitar'))) return;
          const { data, error } = await sb.from('institucional').delete().eq('id', textos[idx].id).select('id');
          if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No tenés permiso para quitar esta sección.', 'error');
          alt();
        } else if (btn.hasAttribute('data-editar')) {
          editarTexto(textos[idx], alt);
        }
      });

      document.querySelectorAll('[data-tipo]').forEach((bloque) => {
        const tipo = bloque.dataset.tipo, m = $('.msg', bloque);
        $('[data-subir-doc]', bloque).addEventListener('click', async () => {
          const file = $('[data-archivo]', bloque).files[0];
          if (!file) return msg(m, 'Elegí un archivo primero.', 'error');
          msg(m, 'Subiendo…');
          let url = null;
          try {
            url = await subirDocumento(liga.id, file);
            const { error } = await sb.from('documentos').insert({ liga_id: liga.id, tipo, archivo_url: url, nombre: file.name.slice(0, 200) });
            if (error) { await borrarDocumento(url); return msg(m, errTexto(error), 'error'); }
            alt();
          } catch (err) { msg(m, errTexto(err), 'error'); }
        });
        bloque.addEventListener('click', async (e) => {
          const q = e.target.closest('[data-quitar-doc]');
          if (!q) return;
          const d = docs.find((x) => x.id === q.closest('[data-doc]').dataset.doc);
          if (!(await confirmar(`¿Quitar "${d.nombre || 'el documento'}"?`, 'Quitar'))) return;
          const { data, error } = await sb.from('documentos').delete().eq('id', d.id).select('id');
          if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No tenés permiso para quitar este documento.', 'error');
          await borrarDocumento(d.archivo_url);
          alt();
        });
      });
    },
  };
}

function editarTexto(t, alGuardar) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-cab">Editar sección</div><div class="dlg-cuerpo"><form id="et-form" novalidate style="display:flex;flex-direction:column;gap:14px">
    <label class="campo">Título<input id="et-titulo" maxlength="120" value="${esc(t.titulo)}"></label>
    <label class="campo">Contenido<textarea id="et-contenido" maxlength="20000" rows="8">${esc(t.contenido)}</textarea></label>
    <div class="acciones"><button class="btn" type="submit">Guardar</button><button class="btn sec" type="button" id="et-cancel">Cancelar</button></div><p class="msg" id="et-msg" role="alert"></p></form></div>`;
  document.body.appendChild(d);
  const cerrar = () => { d.close(); d.remove(); };
  $('#et-cancel', d).addEventListener('click', cerrar);
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  $('#et-form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#et-msg', d), titulo = $('#et-titulo', d).value.trim();
    if (!titulo) return msg(m, 'Ingresá un título.', 'error');
    const { data, error } = await sb.from('institucional').update({ titulo, contenido: $('#et-contenido', d).value }).eq('id', t.id).select('id');
    if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No tenés permiso para editar esta sección.', 'error');
    cerrar(); alGuardar();
  });
  d.showModal();
}

/* ---------- pestaña Suspendidos ---------- */
async function tabSuspendidos(ct) {
  const { liga } = ct;
  const { data: torneos, error } = await sb.from('torneos').select('id,nombre,anio,estado,reglas').eq('liga_id', liga.id).order('anio', { ascending: false });
  if (error) throw error;
  if (!torneos.length) return { titulo: 'Suspendidos', html: '<div class="vacio">Esta liga todavía no tiene torneos.</div>' };
  const orden = (a) => (a.estado === 'en_curso' ? 0 : a.estado === 'borrador' ? 1 : 2);
  torneos.sort((a, b) => orden(a) - orden(b) || b.anio - a.anio);

  const html = `<div class="controles"><label class="solo-lectores" for="s-torneo">Torneo</label>
      <select id="s-torneo">${torneos.map((t) => `<option value="${t.id}">${esc(t.nombre)} ${t.anio}${t.estado === 'finalizado' ? ' (finalizado)' : ''}</option>`).join('')}</select></div>
    <div id="s-aviso"></div>
    <h2 class="sub-titulo" style="margin:0 0 10px">Suspendidos vigentes</h2><div id="s-vigentes" class="tarjeta"></div>
    <details class="acordeon" style="margin-top:20px"><summary>Agregar suspensión</summary><div class="cuerpo" style="white-space:normal">
      <form id="s-form" class="form-tarjeta" novalidate style="border:0;padding:0">
        <div class="form-fila"><label class="campo">Club<select id="s-club"></select></label><label class="campo">Jugador<select id="s-jug"></select></label></div>
        <div class="form-fila"><label class="campo">Fechas de suspensión<input id="s-fechas" type="number" min="1" max="99" value="1"></label>
          <label class="campo">Motivo (opcional)<input id="s-motivo" maxlength="120" placeholder="Ej.: Tarjeta roja"></label></div>
        <div class="acciones"><button class="btn" type="submit">Agregar suspensión</button></div><p class="msg" id="s-msg" role="alert"></p></form></div></details>
    <h2 class="sub-titulo" style="margin:24px 0 10px">Amarillas acumuladas <small id="s-umbral"></small></h2><div id="s-tarjetas" class="tarjeta"></div>
    <details class="acordeon" style="margin-top:20px"><summary>Suspensiones cumplidas</summary><div class="cuerpo" id="s-cumplidas" style="white-space:normal"></div></details>`;

  return {
    titulo: 'Suspendidos',
    html,
    despues() {
      const sT = $('#s-torneo'), vig = $('#s-vigentes'), tarj = $('#s-tarjetas'), cum = $('#s-cumplidas'), aviso = $('#s-aviso');
      const sClub = $('#s-club'), sJug = $('#s-jug');
      let sus = [], plantel = [];
      const torneoSel = () => torneos.find((t) => t.id === sT.value);
      const umbral = () => parseInt(torneoSel().reglas?.amarillas_para_suspension, 10) || 0;
      const infoJugador = (id) => {
        const p = plantel.find((x) => x.jugador_id === id);
        return p ? `${p.clubes?.nombre || ''}${p.categorias?.nombre ? ' · ' + p.categorias.nombre : ''}` : '';
      };
      const nombreJ = (j) => (j ? `${j.nombre} ${j.apellido}`.replace(/^\(s\/d\)\s*/, '') : 'Jugador');

      const pintar = (tarjetas) => {
        const t = torneoSel(), u = umbral();
        aviso.innerHTML = t.estado === 'finalizado' ? '<p class="aviso">Este torneo está finalizado: solo el superadmin puede modificar sus suspensiones.</p>' : '';
        $('#s-umbral').textContent = u ? `(cada ${u} amarillas = 1 fecha de suspensión)` : '(suspensión automática desactivada)';
        const activas = sus.filter((s) => s.fechas > s.cumplidas), cumplidas = sus.filter((s) => s.fechas <= s.cumplidas);
        vig.innerHTML = activas.length ? activas.map((s) => `<div class="panel-liga" data-id="${s.id}"><div><h3 style="font-size:22px">${esc(nombreJ(s.jugadores))}</h3>
            <div class="chips"><span class="chip oro">${s.fechas - s.cumplidas} de ${s.fechas} ${s.fechas === 1 ? 'fecha pendiente' : 'fechas pendientes'}</span>
            <span class="chip">${esc(infoJugador(s.jugador_id))}</span><span class="chip ${s.origen === 'automatica' ? 'verde' : ''}">${s.origen === 'automatica' ? 'Automática' : 'Manual'}</span>${s.motivo ? `<span class="chip">${esc(s.motivo)}</span>` : ''}</div><p class="msg" role="status"></p></div>
          <div class="acciones"><button class="btn" data-cumplio>Cumplió una fecha</button>
            ${s.origen === 'manual' ? '<button class="btn sec" data-editar>Editar</button><button class="btn sec" data-quitar>Quitar</button>' : ''}</div></div>`).join('')
          : '<div class="vacio" style="border:0">No hay jugadores suspendidos.</div>';
        cum.innerHTML = cumplidas.length ? cumplidas.map((s) => `<p style="margin:0 0 6px">${esc(nombreJ(s.jugadores))} — ${s.fechas} ${s.fechas === 1 ? 'fecha' : 'fechas'} · ${esc(s.motivo || '')}</p>`).join('') : 'Todavía no hay suspensiones cumplidas.';
        const filas = tarjetas.filter((x) => x.amarillas > 0 || x.rojas > 0).sort((a, b) => b.amarillas - a.amarillas || b.rojas - a.rojas);
        tarj.innerHTML = filas.length ? `<div class="tabla-scroll"><table class="tabla"><caption class="solo-lectores">Amarillas y rojas por jugador</caption>
          <thead><tr><th scope="col" class="izq">Jugador</th><th scope="col" class="izq">Equipo</th><th scope="col">Amarillas</th><th scope="col">Rojas</th><th scope="col" class="izq">Estado</th></tr></thead>
          <tbody>${filas.map((x) => {
            const falta = u ? u - (x.amarillas % u) : null;
            const est = !u ? '' : falta === 1 ? 'A 1 amarilla de la próxima suspensión' : `Faltan ${falta} para la próxima suspensión`;
            return `<tr><td class="club izq">${esc(nombreJ(x))}</td><td class="izq">${esc(x.club)} · ${esc(x.categoria)}</td><td class="pts">${x.amarillas}</td><td>${x.rojas}</td><td class="izq" style="font-size:12px;${falta === 1 ? 'font-weight:700;color:#7A5200' : 'color:var(--muted)'}">${esc(est)}</td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="vacio" style="border:0">Todavía no hay tarjetas cargadas.</div>';
      };
      const llenarJugadores = () => {
        const js = plantel.filter((p) => p.club_id === sClub.value).sort((a, b) => (a.jugadores.apellido || '').localeCompare(b.jugadores.apellido || '', 'es'));
        sJug.innerHTML = js.map((p) => `<option value="${p.jugador_id}">${esc(p.jugadores.apellido)}, ${esc(p.jugadores.nombre)}${p.categorias?.nombre ? ' (' + esc(p.categorias.nombre) + ')' : ''}</option>`).join('') || '<option value="">Sin jugadores en este club</option>';
      };
      const cargar = async () => {
        vig.innerHTML = tarj.innerHTML = '<p class="cargando">Cargando…</p>';
        const id = sT.value;
        const [a, b, c] = await Promise.all([
          sb.from('suspensiones').select('id,fechas,cumplidas,motivo,origen,jugador_id,jugadores(nombre,apellido)').eq('torneo_id', id).order('fechas', { ascending: false }),
          sb.from('tarjetas').select('nombre,apellido,club,categoria,amarillas,rojas').eq('torneo_id', id),
          sb.from('planteles').select('jugador_id,club_id,categoria_id,clubes(nombre),jugadores(nombre,apellido),categorias(nombre)').eq('torneo_id', id).range(0, 4999),
        ]);
        const fallo = a.error || b.error || c.error;
        if (fallo) { vig.innerHTML = `<div class="vacio" style="border:0">${esc(errTexto(fallo))}</div>`; return; }
        sus = a.data; plantel = c.data;
        const clubes = [...new Map(plantel.map((p) => [p.club_id, p.clubes?.nombre || ''])).entries()].sort((x, y) => x[1].localeCompare(y[1], 'es'));
        sClub.innerHTML = clubes.map(([cid, n]) => `<option value="${cid}">${esc(n)}</option>`).join('') || '<option value="">Sin clubes con plantel</option>';
        llenarJugadores();
        pintar(b.data);
        ultimasTarjetas = b.data;
      };
      let ultimasTarjetas = [];
      sT.addEventListener('change', cargar);
      sClub.addEventListener('change', llenarJugadores);

      $('#s-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#s-msg'), jugador = sJug.value, fechas = parseInt($('#s-fechas').value, 10);
        if (!jugador) return msg(m, 'Elegí un jugador.', 'error');
        if (!(fechas >= 1 && fechas <= 99)) return msg(m, 'Las fechas deben ser un número entre 1 y 99.', 'error');
        msg(m, 'Guardando…');
        const { error: err } = await sb.from('suspensiones').insert({ liga_id: liga.id, torneo_id: sT.value, jugador_id: jugador, fechas, motivo: $('#s-motivo').value.trim() || null, origen: 'manual' });
        if (err) return msg(m, errTexto(err), 'error');
        msg(m, 'Suspensión agregada ✓', 'ok'); $('#s-motivo').value = '';
        cargar();
      });

      vig.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const fila = b.closest('[data-id]'), s = sus.find((x) => x.id === fila.dataset.id), m = $('.msg', fila);
        if (b.hasAttribute('data-cumplio')) {
          const { data, error: err } = await sb.from('suspensiones').update({ cumplidas: s.cumplidas + 1 }).eq('id', s.id).select('id');
          if (err || !data?.length) return msg(m, err ? errTexto(err) : 'No tenés permiso para modificar esta suspensión.', 'error');
          cargar();
        } else if (b.hasAttribute('data-quitar')) {
          if (!(await confirmar(`¿Quitar la suspensión de ${nombreJ(s.jugadores)}?`, 'Quitar'))) return;
          const { data, error: err } = await sb.from('suspensiones').delete().eq('id', s.id).select('id');
          if (err || !data?.length) return msg(m, err ? errTexto(err) : 'No tenés permiso para quitar esta suspensión.', 'error');
          cargar();
        } else if (b.hasAttribute('data-editar')) {
          editarSuspension(s, nombreJ(s.jugadores), cargar);
        }
      });
      cargar();
    },
  };
}

function editarSuspension(s, nombre, alGuardar) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-cab">Editar suspensión</div><div class="dlg-cuerpo"><p style="margin:0;font-weight:600">${esc(nombre)}</p>
    <form id="es-form" novalidate style="display:flex;flex-direction:column;gap:14px">
      <label class="campo">Fechas de suspensión<input id="es-fechas" type="number" min="${Math.max(1, s.cumplidas)}" max="99" value="${s.fechas}"><small>Ya cumplió ${s.cumplidas}.</small></label>
      <label class="campo">Motivo<input id="es-motivo" maxlength="120" value="${esc(s.motivo || '')}"></label>
      <div class="acciones"><button class="btn" type="submit">Guardar</button><button class="btn sec" type="button" id="es-cancel">Cancelar</button></div><p class="msg" id="es-msg" role="alert"></p></form></div>`;
  document.body.appendChild(d);
  const cerrar = () => { d.close(); d.remove(); };
  $('#es-cancel', d).addEventListener('click', cerrar);
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  $('#es-form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#es-msg', d), fechas = parseInt($('#es-fechas', d).value, 10);
    if (!(fechas >= Math.max(1, s.cumplidas) && fechas <= 99)) return msg(m, `Las fechas deben ser entre ${Math.max(1, s.cumplidas)} y 99.`, 'error');
    const { data, error } = await sb.from('suspensiones').update({ fechas, motivo: $('#es-motivo', d).value.trim() || null }).eq('id', s.id).select('id');
    if (error || !data?.length) return msg(m, error ? errTexto(error) : 'No tenés permiso para editar esta suspensión.', 'error');
    cerrar(); alGuardar();
  });
  d.showModal();
}

/* ---------- Nuevo torneo (datos, categorías, clubes y fixture a mano) ---------- */
const mezclar = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
// Sorteo todos contra todos (método del círculo): devuelve fechas[f][k] = {l, v}
function sortearFixture(ids) {
  let t = mezclar(ids);
  if (t.length % 2 === 1) t.push(null);
  const m = t.length, fechas = [];
  for (let r = 0; r < m - 1; r++) {
    const fecha = [];
    for (let k = 0; k < m / 2; k++) {
      const a = t[k], b = t[m - 1 - k];
      if (a === null || b === null) continue;
      fecha.push((r + k) % 2 === 0 ? { l: a, v: b } : { l: b, v: a });
    }
    fechas.push(mezclar(fecha));
    t = [t[0], t[m - 1], ...t.slice(1, m - 1)];
  }
  return mezclar(fechas);
}
const nFechas = (n) => (n % 2 === 0 ? n - 1 : n);   // todos contra todos: n-1 fechas si n es par, n si es impar (uno libre)
const nPartidos = (n) => Math.floor(n / 2);
const mismosClubes = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

async function tabNuevoTorneo(ct) {
  const { liga, ctx } = ct;
  const base = `/panel/${encodeURIComponent(liga.slug)}`;
  const { data: clubes, error } = await sb.from('clubes').select('id,nombre').eq('liga_id', liga.id).order('nombre');
  if (error) throw error;
  if (clubes.length < 2) {
    return { titulo: 'Nuevo torneo', html: `<div class="vacio">Para crear un torneo la liga necesita al menos 2 clubes.<br><a href="${base}?t=clubes" data-link>Ir a Clubes</a></div>` };
  }
  const nombreClub = Object.fromEntries(clubes.map((c) => [c.id, c.nombre]));
  const st = { cats: [{ nombre: 'Primera', clubes: new Set(clubes.map((c) => c.id)) }], fix: null };
  const anio = new Date().getFullYear();
  const numCampo = (id, rot, val) => `<label class="campo">${rot}<input id="${id}" type="number" min="0" max="20" value="${val}"></label>`;

  const html = `<form id="nt" novalidate style="display:flex;flex-direction:column;gap:20px">
    <section class="form-tarjeta"><h2 class="sub-titulo">1. Datos del torneo</h2>
      <label class="campo">Nombre<input id="nt-nombre" maxlength="80" required placeholder="Ej.: Torneo Apertura"></label>
      <div class="form-fila">
        <label class="campo">Año<input id="nt-anio" type="number" min="2000" max="2100" value="${anio}"></label>
        <label class="campo">Estado inicial<select id="nt-estado"><option value="borrador">Borrador (no se ve en el sitio)</option><option value="en_curso">En curso</option></select></label></div>
      <label style="display:flex;gap:8px;align-items:flex-start;font-size:14px"><input type="checkbox" id="nt-vueltas" checked style="margin-top:4px"> <span>Ida y vuelta. La Ronda 2 se genera sola con local y visitante invertidos.</span></label>
      <label style="display:flex;gap:8px;align-items:flex-start;font-size:14px"><input type="checkbox" id="nt-copa" style="margin-top:4px"> <span>Copa Desafío (final entre los ganadores de cada ronda)</span></label>
      <div class="form-fila">${numCampo('nt-pv', 'Puntos por victoria', 3)}${numCampo('nt-pe', 'Puntos por empate', 1)}${numCampo('nt-pd', 'Puntos por derrota', 0)}${numCampo('nt-am', 'Amarillas para suspensión', 4)}</div></section>
    <section class="form-tarjeta"><h2 class="sub-titulo">2. Categorías y clubes</h2>
      <div id="nt-cats"></div><div class="acciones"><button type="button" class="btn sec" id="nt-add-cat">Agregar categoría</button></div></section>
    <section class="form-tarjeta"><h2 class="sub-titulo">3. Fixture</h2>
      <p style="margin:0;font-size:14px;color:#33423A">Podés sortearlo al azar o cargarlo a mano, fecha por fecha (y retocar lo sorteado). Cada club juega una vez por fecha y cada cruce se juega una sola vez por ronda. Si dos categorías tienen los mismos clubes, podés copiar el fixture de una a la otra.</p>
      <div class="acciones"><button type="button" class="btn" id="nt-sortear">Armar y sortear al azar</button><button type="button" class="btn sec" id="nt-armar">Armar vacío (a mano)</button></div>
      <p class="msg" id="nt-resumen" role="status"></p><div id="nt-fix"></div></section>
    <div class="acciones"><button class="btn lima" id="nt-crear" type="submit" disabled>Crear torneo</button><a class="btn sec" href="${base}?t=torneos" data-link>Cancelar</a></div>
    <p class="msg" id="nt-msg" role="alert"></p></form>`;

  return {
    titulo: 'Nuevo torneo',
    html,
    despues() {
      const pintarCats = () => {
        $('#nt-cats').innerHTML = st.cats.map((c, i) => `<fieldset data-i="${i}" style="border:1px solid var(--linea);border-radius:8px;padding:12px 16px;margin:0 0 12px">
          <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap"><label class="campo" style="flex:1 1 200px">Nombre de la categoría<input data-cat-nombre maxlength="40" value="${esc(c.nombre)}"></label>
            ${st.cats.length > 1 ? '<button type="button" class="btn sec chico" data-quitar-cat>Quitar categoría</button>' : ''}</div>
          <div style="margin:10px 0 4px;font-size:13px;font-weight:600">Clubes que participan <span data-cuenta>(${c.clubes.size})</span></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:2px 12px">${clubes.map((k) => `<label style="display:flex;gap:8px;align-items:center;min-height:36px;font-size:14px"><input type="checkbox" data-club="${k.id}"${c.clubes.has(k.id) ? ' checked' : ''}> ${esc(k.nombre)}</label>`).join('')}</div></fieldset>`).join('');
      };
      const invalidarFix = () => {
        if (st.fix) { st.fix = null; $('#nt-fix').innerHTML = '<div class="aviso">Cambiaste las categorías o los clubes: volvé a armar el fixture.</div>'; }
        revisar();
      };
      const opciones = (c, sel) => '<option value="">Elegí…</option>' + [...c.clubes].sort((a, b) => nombreClub[a].localeCompare(nombreClub[b], 'es'))
        .map((id) => `<option value="${id}"${sel === id ? ' selected' : ''}>${esc(nombreClub[id])}</option>`).join('');
      const pintarFix = () => {
        $('#nt-fix').innerHTML = st.cats.map((c, i) => {
          const n = c.clubes.size;
          const copiar = st.cats.map((o, j) => (j !== i && mismosClubes(c.clubes, o.clubes) ? `<button type="button" class="btn sec chico" data-copiar="${i}:${j}">Copiar el fixture de ${esc(o.nombre)}</button>` : '')).join('');
          return `<div class="fx-cat" data-i="${i}"><h3 class="sub-titulo" style="font-size:22px">${esc(c.nombre)}<small>${n} equipos · ${nFechas(n)} fechas · ${nPartidos(n)} partidos por fecha</small></h3>
            <div class="acciones" style="margin:8px 0"><button type="button" class="btn sec chico" data-resortear="${i}">Volver a sortear</button>${copiar}</div>
            ${st.fix[i].map((fecha, f) => `<div class="fx-fecha" data-f="${f}"><div class="fx-tit"><span>Fecha ${f + 1}</span><span class="fx-libre"></span></div>
              ${fecha.map((p, k) => `<div class="fx-row"><select data-i="${i}" data-f="${f}" data-k="${k}" data-lado="l" aria-label="Local, fecha ${f + 1}, partido ${k + 1}">${opciones(c, p.l)}</select><span>vs</span>
                <select data-i="${i}" data-f="${f}" data-k="${k}" data-lado="v" aria-label="Visitante, fecha ${f + 1}, partido ${k + 1}">${opciones(c, p.v)}</select></div>`).join('')}
              <p class="msg error fx-msg" aria-live="polite"></p></div>`).join('')}</div>`;
        }).join('');
      };
      const revisar = () => {
        const btn = $('#nt-crear'), res = $('#nt-resumen');
        if (!st.fix) { btn.disabled = true; msg(res, ''); return; }
        let todoOk = true;
        const partes = [];
        st.cats.forEach((c, i) => {
          const pares = new Map();
          let faltan = 0, errores = 0;
          st.fix[i].forEach((fecha, f) => {
            const cont = document.querySelector(`.fx-cat[data-i="${i}"] .fx-fecha[data-f="${f}"]`);
            if (!cont) return;
            const usados = new Set();
            fecha.forEach((p) => { if (p.l) usados.add(p.l); if (p.v) usados.add(p.v); });
            cont.querySelectorAll('select').forEach((s) => [...s.options].forEach((o) => { o.disabled = !!o.value && usados.has(o.value) && s.value !== o.value; }));
            const mensajes = [];
            fecha.forEach((p) => {
              if (!p.l || !p.v) { faltan++; return; }
              const clave = [p.l, p.v].sort().join('|');
              if (pares.has(clave)) { mensajes.push(`${nombreClub[p.l]} vs ${nombreClub[p.v]} ya está en la fecha ${pares.get(clave)}.`); errores++; } else pares.set(clave, f + 1);
            });
            cont.querySelector('.fx-msg').textContent = mensajes.join(' ');
            const libre = $('.fx-libre', cont);
            const completa = fecha.every((p) => p.l && p.v);
            libre.textContent = completa && c.clubes.size % 2 === 1 ? 'Libre: ' + [...c.clubes].filter((id) => !usados.has(id)).map((id) => nombreClub[id]).join(', ') : '';
          });
          if (faltan || errores) todoOk = false;
          partes.push(`${c.nombre}: ${errores ? errores + ' cruce(s) repetido(s)' : faltan ? 'faltan ' + faltan + ' partidos' : 'fixture completo ✓'}`);
        });
        msg(res, partes.join(' · '), todoOk ? 'ok' : '');
        btn.disabled = !todoOk;
      };

      pintarCats();
      $('#nt-cats').addEventListener('input', (e) => {
        const inp = e.target.closest('[data-cat-nombre]');
        if (inp) st.cats[+inp.closest('fieldset').dataset.i].nombre = inp.value;
      });
      $('#nt-cats').addEventListener('change', (e) => {
        const cb = e.target.closest('[data-club]');
        if (!cb) return;
        const fs = cb.closest('fieldset'), c = st.cats[+fs.dataset.i];
        if (cb.checked) c.clubes.add(cb.dataset.club); else c.clubes.delete(cb.dataset.club);
        $('[data-cuenta]', fs).textContent = `(${c.clubes.size})`;
        invalidarFix();
      });
      $('#nt-cats').addEventListener('click', (e) => {
        if (!e.target.closest('[data-quitar-cat]')) return;
        st.cats.splice(+e.target.closest('fieldset').dataset.i, 1);
        pintarCats(); invalidarFix();
      });
      $('#nt-add-cat').addEventListener('click', () => {
        st.cats.push({ nombre: st.cats.length === 1 ? 'Segunda' : '', clubes: new Set(clubes.map((c) => c.id)) });
        pintarCats(); invalidarFix();
      });
      const armar = async (alAzar) => {
        const m = $('#nt-msg'); msg(m, '');
        const nombres = st.cats.map((c) => c.nombre.trim());
        if (nombres.some((n) => !n)) return msg(m, 'Todas las categorías necesitan nombre.', 'error');
        if (new Set(nombres.map((n) => n.toLowerCase())).size !== nombres.length) return msg(m, 'Los nombres de las categorías no pueden repetirse.', 'error');
        if (st.cats.some((c) => c.clubes.size < 2)) return msg(m, 'Cada categoría necesita al menos 2 clubes.', 'error');
        if (st.fix && st.fix.some((cat) => cat.some((fe) => fe.some((p) => p.l || p.v))) && !(await confirmar('Ya cargaste partidos. Si volvés a armar el fixture se borran. ¿Seguir?', 'Armar de nuevo'))) return;
        st.fix = st.cats.map((c) => (alAzar ? sortearFixture([...c.clubes]) : Array.from({ length: nFechas(c.clubes.size) }, () => Array.from({ length: nPartidos(c.clubes.size) }, () => ({ l: '', v: '' })))));
        pintarFix(); revisar();
      };
      $('#nt-armar').addEventListener('click', () => armar(false));
      $('#nt-sortear').addEventListener('click', () => armar(true));
      $('#nt-fix').addEventListener('change', (e) => {
        const s = e.target.closest('select');
        if (!s || !st.fix) return;
        st.fix[+s.dataset.i][+s.dataset.f][+s.dataset.k][s.dataset.lado] = s.value;
        revisar();
      });
      $('#nt-fix').addEventListener('click', (e) => {
        const r = e.target.closest('[data-resortear]');
        if (r) {
          const i = +r.dataset.resortear;
          st.fix[i] = sortearFixture([...st.cats[i].clubes]);
          pintarFix(); revisar();
          return;
        }
        const b = e.target.closest('[data-copiar]');
        if (!b) return;
        const [i, j] = b.dataset.copiar.split(':').map(Number);
        st.fix[i] = JSON.parse(JSON.stringify(st.fix[j]));
        pintarFix(); revisar();
      });

      $('#nt').addEventListener('submit', async (e) => {
        e.preventDefault();
        const m = $('#nt-msg'), btn = $('#nt-crear');
        const nombre = $('#nt-nombre').value.trim();
        if (!nombre) return msg(m, 'Ingresá el nombre del torneo.', 'error');
        const anioV = parseInt($('#nt-anio').value, 10);
        if (!(anioV >= 2000 && anioV <= 2100)) return msg(m, 'Ingresá un año válido.', 'error');
        if (!st.fix) return msg(m, 'Armá el fixture primero.', 'error');
        const num = (id) => parseInt($(id).value, 10);
        const pts = [num('#nt-pv'), num('#nt-pe'), num('#nt-pd'), num('#nt-am')];
        if (pts.some((x) => !(x >= 0 && x <= 20))) return msg(m, 'Los puntos y las amarillas deben ser números entre 0 y 20.', 'error');
        const vueltas = $('#nt-vueltas').checked ? 2 : 1;
        const cats = st.cats.map((c, i) => {
          const partidos = [];
          for (let r = 1; r <= vueltas; r++) {
            st.fix[i].forEach((fecha, f) => fecha.forEach((p) => partidos.push({ ronda: r, jornada: f + 1, local: r === 1 ? p.l : p.v, visitante: r === 1 ? p.v : p.l })));
          }
          return { nombre: c.nombre.trim(), clubes: [...c.clubes], partidos };
        });
        btn.disabled = true; msg(m, 'Creando el torneo…');
        const { error: err } = await sb.rpc('crear_torneo', {
          p_liga: liga.id,
          p_torneo: { nombre, anio: anioV, vueltas, estado: $('#nt-estado').value, copa_desafio: $('#nt-copa').checked,
            puntos_victoria: pts[0], puntos_empate: pts[1], puntos_derrota: pts[2], amarillas_para_suspension: pts[3] },
          p_categorias: cats,
        });
        if (err) { btn.disabled = false; return msg(m, errTexto(err), 'error'); }
        ctx.ir(`${base}?t=torneos`);
      });
    },
  };
}

/* ---------- pestaña Torneos ---------- */
/* ---------- pestaña Portada (solo admin) ---------- */
async function tabPortada(ct) {
  const { liga } = ct;
  const { data: torneos, error } = await sb.from('torneos').select('id,nombre,anio,estado,categorias(id,nombre,orden)').eq('liga_id', liga.id).order('anio', { ascending: false });
  if (error) throw error;
  if (!torneos.length) return { titulo: 'Portada', html: '<div class="vacio">Esta liga todavía no tiene torneos.</div>' };
  const orden = (a) => (a.estado === 'en_curso' ? 0 : a.estado === 'finalizado' ? 1 : 2);
  torneos.sort((a, b) => orden(a) - orden(b) || b.anio - a.anio);

  const html = `<p style="margin:0 0 12px;color:var(--muted);font-size:14px">Es el bloque grande del Inicio de la liga. Si lo dejás sin editar, el sitio arma solo el titular (quién lidera, el campeón, etc.). Cambialo fecha a fecha con tus propias palabras; con "Volver a automática" se borra tu texto.</p>
    <div class="controles">
      <label class="solo-lectores" for="po-torneo">Torneo</label><select id="po-torneo">${torneos.map((t) => `<option value="${t.id}">${esc(t.nombre)} ${t.anio}</option>`).join('')}</select>
      <label class="solo-lectores" for="po-cat">Categoría</label><select id="po-cat"></select></div>
    <form id="po-form" class="form-tarjeta" novalidate>
      <p id="po-estado" style="margin:0;font-size:13px;color:var(--muted)"></p>
      <label class="campo">Etiqueta (arriba, sobre el titular)<input id="po-etiqueta" maxlength="60" placeholder="Ej.: Primera · Fecha 10"></label>
      <label class="campo">Titular (Enter = salto de línea)<textarea id="po-titular" maxlength="120" rows="3" placeholder="Ej.: La 14 lidera&#10;con 25 puntos"></textarea></label>
      <label class="campo">Bajada (opcional)<textarea id="po-bajada" maxlength="300" rows="3"></textarea></label>
      <div class="acciones"><button class="btn" type="submit">Guardar portada</button><button class="btn sec" type="button" id="po-auto">Volver a automática</button></div>
      <p class="msg" id="po-msg" role="alert"></p></form>`;

  return {
    titulo: 'Portada',
    html,
    despues() {
      const sT = $('#po-torneo'), sC = $('#po-cat'), m = $('#po-msg');
      let fila = null;
      const llenarCats = () => {
        const t = torneos.find((x) => x.id === sT.value);
        sC.innerHTML = t.categorias.slice().sort((a, b) => a.orden - b.orden).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
      };
      const cargar = async () => {
        msg(m, '');
        const { data, error: e } = await sb.from('portadas').select('id,etiqueta,titular,bajada').eq('torneo_id', sT.value).eq('categoria_id', sC.value).maybeSingle();
        if (e) return msg(m, errTexto(e), 'error');
        fila = data;
        $('#po-etiqueta').value = data?.etiqueta || '';
        $('#po-titular').value = data?.titular || '';
        $('#po-bajada').value = data?.bajada || '';
        $('#po-estado').textContent = data ? 'Se muestra tu portada personalizada.' : 'Hoy se muestra la portada automática.';
        $('#po-auto').disabled = !data;
      };
      llenarCats();
      sT.addEventListener('change', () => { llenarCats(); cargar(); });
      sC.addEventListener('change', cargar);
      $('#po-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const titular = $('#po-titular').value.trim();
        if (!titular) return msg(m, 'Escribí el titular.', 'error');
        const campos = { etiqueta: $('#po-etiqueta').value.trim() || null, titular, bajada: $('#po-bajada').value.trim() || null };
        msg(m, 'Guardando…');
        const q = fila
          ? sb.from('portadas').update(campos).eq('id', fila.id).select('id')
          : sb.from('portadas').insert({ ...campos, liga_id: liga.id, torneo_id: sT.value, categoria_id: sC.value }).select('id');
        const { data, error: er } = await q;
        if (er || !data?.length) return msg(m, er ? errTexto(er) : 'No tenés permiso para editar la portada.', 'error');
        await cargar();
        msg(m, 'Guardado. El sitio puede tardar hasta un minuto en mostrarlo.', 'ok');
      });
      $('#po-auto').addEventListener('click', async () => {
        if (!fila || !(await confirmar('¿Borrar tu texto y volver a la portada automática?', 'Volver a automática'))) return;
        const { data, error: er } = await sb.from('portadas').delete().eq('id', fila.id).select('id');
        if (er || !data?.length) return msg(m, er ? errTexto(er) : 'No tenés permiso.', 'error');
        await cargar();
        msg(m, 'Listo: la portada vuelve a ser automática.', 'ok');
      });
      cargar();
    },
  };
}

async function tabTorneos(ct) {
  const { liga, perfil, ctx } = ct;
  const { data: torneos, error } = await sb.from('torneos').select('id,nombre,anio,estado,cerrado_en,resumen,copa_desafio').eq('liga_id', liga.id).order('anio', { ascending: false });
  if (error) throw error;
  // La Copa Desafío se carga a mano (semifinales y final), al terminar el torneo, en la pestaña Fixture.
  const bloqueCopa = (t) => (!t.copa_desafio || t.estado === 'borrador' ? '' : `<div class="form-tarjeta" style="margin-top:16px"><h3 class="sub-titulo" style="font-size:22px">Copa Desafío · ${esc(t.nombre)}</h3>
      <p style="margin:0;font-size:13px;color:var(--muted)">Los cruces de la Copa se cargan a mano cuando termina el torneo, desde la pestaña <a href="/panel/${encodeURIComponent(liga.slug)}?t=fixture" data-link>Fixture</a> (semifinales y final). Hasta entonces el sitio muestra los duelos "a confirmar".</p></div>`);
  const tarjeta = (t) => {
    const camp = (t.resumen?.categorias || []).filter((c) => c.campeon).map((c) => `<span class="chip verde">${esc(c.nombre)}: ${esc(c.campeon.club)}</span>`).join('');
    const estado = { borrador: 'Borrador', en_curso: 'En curso', finalizado: 'Finalizado' }[t.estado];
    return `<div class="panel-liga" data-torneo="${t.id}"><div><h3>${esc(t.nombre)} · ${t.anio}</h3>
      <div class="chips"><span class="chip ${t.estado === 'finalizado' ? 'oro' : 'verde'}">${estado}</span>${camp}</div><p class="msg" role="status"></p></div>
      <div class="acciones">${t.estado === 'borrador' ? '<button class="btn" data-accion="iniciar">Iniciar torneo</button>' : ''}
      ${t.estado === 'en_curso' ? '<button class="btn" data-accion="cerrar">Cerrar torneo</button>' : ''}
      ${t.estado === 'borrador' ? '<button class="btn sec" data-accion="eliminar">Eliminar</button>' : ''}
      ${t.estado === 'finalizado' && perfil.esSuper ? '<button class="btn sec" data-accion="reabrir">Reabrir</button>' : ''}</div></div>`;
  };
  return {
    titulo: 'Torneos',
    html: `<div class="acciones" style="margin-bottom:16px"><a class="btn lima" href="/panel/${encodeURIComponent(liga.slug)}?t=nuevo" data-link>Nuevo torneo</a></div>
      <div class="tarjeta">${torneos.map(tarjeta).join('') || '<div class="vacio" style="border:0">Esta liga todavía no tiene torneos.</div>'}</div>
      <div id="copa-admin">${torneos.map(bloqueCopa).join('')}</div>
      <p style="font-size:13px;color:var(--muted)">Al cerrar un torneo se guarda el campeón, la tabla final, los goleadores y el resultado de la Copa en el archivo público. Después solo el superadmin puede modificarlo.</p>`,
    despues() {
      document.querySelectorAll('[data-accion]').forEach((b) => b.addEventListener('click', async () => {
        const fila = b.closest('[data-torneo]'), id = fila.dataset.torneo, m = $('.msg', fila);
        b.disabled = true;
        try {
          if (b.dataset.accion === 'cerrar') {
            if (!(await confirmar('¿Cerrar el torneo? Después solo el superadmin podrá modificarlo.', 'Cerrar torneo'))) return;
            let r = await sb.rpc('cerrar_torneo', { p_torneo: id, p_forzar: false });
            if (r.error && /sin jugar/i.test(r.error.message)) {
              if (!(await confirmar(r.error.message.replace(/ Para cerrar igual.*$/, '') + ' ¿Querés cerrarlo igual?', 'Cerrar igual'))) return;
              r = await sb.rpc('cerrar_torneo', { p_torneo: id, p_forzar: true });
            }
            if (r.error) return msg(m, errTexto(r.error), 'error');
          } else if (b.dataset.accion === 'iniciar') {
            if (!(await confirmar('¿Iniciar el torneo? Pasa a "En curso" y se muestra en el sitio de la liga.', 'Iniciar'))) return;
            const r = await sb.from('torneos').update({ estado: 'en_curso' }).eq('id', id).select('id');
            if (r.error || !r.data?.length) return msg(m, r.error ? errTexto(r.error) : 'No tenés permiso para iniciar este torneo.', 'error');
          } else if (b.dataset.accion === 'eliminar') {
            if (!(await confirmar('¿Eliminar este torneo borrador? Se borran sus categorías, equipos y fixture. No se puede deshacer.', 'Eliminar'))) return;
            const r = await sb.from('torneos').delete().eq('id', id).select('id');
            if (r.error || !r.data?.length) return msg(m, r.error ? errTexto(r.error) : 'No tenés permiso para eliminar este torneo.', 'error');
          } else {
            if (!(await confirmar('¿Reabrir el torneo? Se borra el resumen guardado y vuelve a quedar en curso.', 'Reabrir'))) return;
            const r = await sb.rpc('reabrir_torneo', { p_torneo: id });
            if (r.error) return msg(m, errTexto(r.error), 'error');
          }
          ctx.redibujar();
        } finally { b.disabled = false; }
      }));
    },
  };
}
