// Aviso al revelador cuando alguien pide que reabra un rollo.
//
// El transporte real depende de dónde corra la Pi, así que va por webhook:
// poniendo NOTIFY_WEBHOOK a una URL (ntfy, Gotify, un bot de Telegram, Slack…)
// el pedido llega al celular sin que la app tenga que saber de ningún proveedor.
// Sin variable configurada queda sólo el log, que es el default razonable.

const WEBHOOK = process.env.NOTIFY_WEBHOOK ?? '';
const BASE_URL = process.env.PUBLIC_URL ?? 'http://rollito.local';

export async function notifyReopenRequest({ album, pending, log }) {
  const link = `${BASE_URL}/admin`;
  const text =
    `${pending} ${pending === 1 ? 'amigo pidió' : 'amigos pidieron'} ` +
    `que revelés «${album.title}» de nuevo. Reabrilo en ${link}`;

  log?.info({ album: album.code, pending }, 'pedido de reapertura');

  if (!WEBHOOK) return { sent: false, reason: 'sin NOTIFY_WEBHOOK configurado' };

  try {
    // Timeout corto: el pedido del invitado no puede quedar colgado esperando al webhook.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Rollito',
        message: text,
        album: album.code,
        pending,
        url: link,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      log?.warn({ status: res.status }, 'el webhook rechazó el aviso');
      return { sent: false, reason: `webhook ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    log?.warn({ err: String(err?.message ?? err) }, 'no se pudo avisar al revelador');
    return { sent: false, reason: 'webhook inalcanzable' };
  }
}
