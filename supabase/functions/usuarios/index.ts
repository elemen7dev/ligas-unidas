// Ligas Unidas — función "usuarios": gestión de cuentas. SOLO el superadmin puede usarla.
// Usa la clave de servicio (que nunca sale del servidor) para crear, reiniciar y eliminar cuentas.
// Acciones: listar | crear | reiniciar | eliminar (solo superadmin) y clave_inicial (cualquier usuario con sesión, solo para sí mismo).
// Los roles se asignan desde el panel con la RLS normal.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Orígenes desde los que se puede llamar. Sumar el dominio definitivo cuando exista.
const ORIGENES = ["http://localhost:8080", "https://ligasunidas.vercel.app"];

const cors = (req: Request) => {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENES.includes(o) ? o : ORIGENES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
};
const json = (req: Request, cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

// Clave temporal de 14 caracteres sin letras ambiguas (sin 0/O, 1/l/I).
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function claveTemporal(n = 14) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALFABETO[x % ALFABETO.length]).join("");
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Método no permitido" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(req, { error: "Sin sesión" }, 401);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: quien, error: errSesion } = await admin.auth.getUser(token);
  if (errSesion || !quien?.user) return json(req, { error: "Sesión inválida" }, 401);
  const yo = quien.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "Datos inválidos" }, 400); }

  // Primer ingreso: cualquier usuario con sesión elige su contraseña propia. La bandera "debe cambiar la clave" vive en
  // app_metadata, que el usuario NO puede editar: solo se baja acá, y únicamente junto con un cambio real de contraseña.
  if (body.accion === "clave_inicial") {
    const nueva = String(body.nueva ?? "");
    const email = String(quien.user.email ?? "");
    if (nueva.length < 10 || nueva.length > 72) return json(req, { error: "La contraseña debe tener entre 10 y 72 caracteres." }, 400);
    if (nueva.toLowerCase() === email.toLowerCase()) return json(req, { error: "La contraseña no puede ser igual a tu email." }, 400);
    if (/^(.)\1+$/.test(nueva)) return json(req, { error: "Elegí una contraseña menos obvia." }, 400);
    // La nueva clave debe ser distinta de la actual (la temporal): si con ella se puede iniciar sesión, es la misma.
    const anon = createClient(URL, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: igual } = await anon.auth.signInWithPassword({ email, password: nueva });
    if (igual?.session) return json(req, { error: "La contraseña nueva debe ser distinta de la temporal." }, 400);
    const { error } = await admin.auth.admin.updateUserById(yo, {
      password: nueva,
      app_metadata: { ...(quien.user.app_metadata ?? {}), debe_cambiar_clave: false },
      user_metadata: { ...(quien.user.user_metadata ?? {}), debe_cambiar_clave: false },   // limpia la marca vieja
    });
    if (error) return json(req, { error: "No se pudo guardar la contraseña. Probá de nuevo." }, 400);
    return json(req, { ok: true });
  }

  const { data: esSuper } = await admin.from("membresias").select("id").eq("usuario_id", yo).eq("rol", "superadmin").limit(1);
  if (!esSuper?.length) return json(req, { error: "Solo el superadmin puede gestionar usuarios" }, 403);

  // El objetivo de reiniciar/eliminar: nunca uno mismo ni otro superadmin.
  const objetivoPermitido = async (id: unknown) => {
    if (typeof id !== "string" || !UUID.test(id)) return "Usuario inválido";
    if (id === yo) return "No podés hacer esto con tu propia cuenta. Cambiá tu contraseña desde el panel.";
    const { data } = await admin.from("membresias").select("id").eq("usuario_id", id).eq("rol", "superadmin").limit(1);
    if (data?.length) return "No se puede hacer esto con una cuenta de superadmin.";
    return null;
  };

  switch (body.accion) {
    case "listar": {
      const usuarios = [];
      for (let page = 1; page <= 25; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return json(req, { error: "No se pudo leer la lista de usuarios" }, 500);
        usuarios.push(...data.users);
        if (data.users.length < 200) break;
      }
      const { data: mem } = await admin.from("membresias").select("id,usuario_id,liga_id,rol");
      const { data: ligas } = await admin.from("ligas").select("id,nombre").order("nombre");
      const nombreLiga = Object.fromEntries((ligas ?? []).map((l) => [l.id, l.nombre]));
      return json(req, {
        usuarios: usuarios.map((u) => ({
          id: u.id, email: u.email, creado: u.created_at, ultimo_ingreso: u.last_sign_in_at,
          debe_cambiar: !!(u.app_metadata?.debe_cambiar_clave || u.user_metadata?.debe_cambiar_clave),
          roles: (mem ?? []).filter((m) => m.usuario_id === u.id)
            .map((m) => ({ id: m.id, liga_id: m.liga_id, liga: m.liga_id ? nombreLiga[m.liga_id] ?? null : null, rol: m.rol })),
        })).sort((a, b) => String(a.email).localeCompare(String(b.email))),
        ligas: ligas ?? [],
      });
    }

    case "crear": {
      const email = String(body.email ?? "").trim().toLowerCase();
      const rol = body.rol;
      const ligaId = body.liga_id;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return json(req, { error: "Ingresá un email válido." }, 400);
      if (rol !== "admin_liga" && rol !== "cargador") return json(req, { error: "El rol debe ser administrador o cargador." }, 400);
      if (typeof ligaId !== "string" || !UUID.test(ligaId)) return json(req, { error: "Elegí una liga." }, 400);
      const { data: liga } = await admin.from("ligas").select("id").eq("id", ligaId).maybeSingle();
      if (!liga) return json(req, { error: "La liga no existe." }, 400);

      const clave = claveTemporal();
      const { data, error } = await admin.auth.admin.createUser({
        email, password: clave, email_confirm: true, app_metadata: { debe_cambiar_clave: true },
      });
      if (error || !data?.user) {
        const dup = /already|registered|exists/i.test(error?.message ?? "");
        return json(req, {
          error: dup ? "Ya existe una cuenta con ese email. Agregale el rol desde la lista de usuarios." : "No se pudo crear la cuenta.",
          codigo: dup ? "existe" : "error",
        }, dup ? 409 : 400);
      }
      const { error: errMem } = await admin.from("membresias").insert({ usuario_id: data.user.id, liga_id: ligaId, rol });
      if (errMem) {
        await admin.auth.admin.deleteUser(data.user.id);
        return json(req, { error: "No se pudo asignar el rol. No se creó la cuenta." }, 400);
      }
      return json(req, { ok: true, usuario_id: data.user.id, email, clave });
    }

    case "reiniciar": {
      const motivo = await objetivoPermitido(body.usuario_id);
      if (motivo) return json(req, { error: motivo }, 400);
      const id = body.usuario_id as string;
      const { data: actual, error: e1 } = await admin.auth.admin.getUserById(id);
      if (e1 || !actual?.user) return json(req, { error: "El usuario no existe." }, 404);
      const clave = claveTemporal();
      const { error } = await admin.auth.admin.updateUserById(id, {
        password: clave, app_metadata: { ...(actual.user.app_metadata ?? {}), debe_cambiar_clave: true },
      });
      if (error) return json(req, { error: "No se pudo reiniciar la clave." }, 400);
      return json(req, { ok: true, email: actual.user.email, clave });
    }

    case "eliminar": {
      const motivo = await objetivoPermitido(body.usuario_id);
      if (motivo) return json(req, { error: motivo }, 400);
      const { error } = await admin.auth.admin.deleteUser(body.usuario_id as string);
      if (error) return json(req, { error: "No se pudo eliminar la cuenta." }, 400);
      return json(req, { ok: true });
    }

    default:
      return json(req, { error: "Acción desconocida" }, 400);
  }
});
