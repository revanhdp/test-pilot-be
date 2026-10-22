import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

/**
 * "Acme Store": a tiny target website for trying TestPilot locally and for the
 * browser engine's integration tests. It has one deliberate bug: submitting an
 * invalid card number makes the payment API return HTTP 500, so the checkout
 * page shows a generic error instead of a validation message.
 */

export const DEMO_CREDENTIALS = { email: 'demo@acme.test', password: 'password123' };

const SESSION_COOKIE = 'acme_session=demo';

const layout = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Acme Store</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #1f2328; background: #f6f7f9; }
  header { display: flex; align-items: center; gap: 24px; padding: 14px 32px; background: #fff; border-bottom: 1px solid #e3e5e8; }
  header strong { font-size: 17px; }
  header nav { display: flex; gap: 16px; margin-left: auto; }
  a { color: #4f46e5; text-decoration: none; }
  main { max-width: 880px; margin: 40px auto; padding: 0 24px; }
  .card { background: #fff; border: 1px solid #e3e5e8; border-radius: 10px; padding: 28px; }
  .narrow { max-width: 400px; margin: 0 auto; }
  label { display: block; font-weight: 600; margin: 14px 0 6px; }
  input { width: 100%; padding: 9px 11px; border: 1px solid #cdd1d6; border-radius: 6px; font: inherit; }
  button { margin-top: 20px; width: 100%; padding: 10px; border: 0; border-radius: 6px; background: #4f46e5; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  .alert { margin-top: 16px; padding: 10px 12px; border-radius: 6px; background: #fdecec; color: #a4161a; }
  .success { margin-top: 16px; padding: 10px 12px; border-radius: 6px; background: #e8f6ee; color: #146c43; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .product { background: #fff; border: 1px solid #e3e5e8; border-radius: 10px; padding: 18px; }
  .product span { color: #57606a; }
</style>
</head>
<body>
<header><strong>Acme Store</strong><nav><a href="/">Home</a><a href="/checkout">Checkout</a><a href="/login">Sign in</a></nav></header>
<main>${body}</main>
</body>
</html>`;

const pages = {
  home: layout(
    'Home',
    `<h1>Featured products</h1>
<div class="grid">
  <div class="product"><strong>Trail Backpack</strong><br><span>$49.00</span></div>
  <div class="product"><strong>Water Bottle</strong><br><span>$18.00</span></div>
  <div class="product"><strong>Camp Lantern</strong><br><span>$32.00</span></div>
</div>`,
  ),

  login: layout(
    'Sign in',
    `<div class="card narrow">
<h1>Sign in</h1>
<form id="login-form" novalidate>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password">
  <button type="submit">Sign in</button>
  <div id="form-error" class="alert" role="alert" hidden></div>
</form>
</div>
<script>
document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('form-error');
  error.hidden = true;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.value, password: password.value }),
  });
  if (res.ok) { location.href = '/account'; return; }
  error.textContent = (await res.json()).error;
  error.hidden = false;
});
</script>`,
  ),

  account: layout(
    'Account',
    `<div class="card"><h1>Welcome back, Demo User</h1><p>You have no recent orders.</p></div>`,
  ),

  checkout: layout(
    'Checkout',
    `<div class="card narrow">
<h1>Checkout</h1>
<p>Trail Backpack — <strong>$49.00</strong></p>
<form id="payment-form" novalidate>
  <label for="card">Card number</label>
  <input id="card" name="card" inputmode="numeric" placeholder="1234 5678 9012 3456">
  <label for="expiry">Expiry</label>
  <input id="expiry" name="expiry" placeholder="MM/YY">
  <button type="submit">Pay $49.00</button>
  <div id="payment-message" role="alert" hidden></div>
</form>
</div>
<script>
document.getElementById('payment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.getElementById('payment-message');
  const res = await fetch('/api/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: card.value, expiry: expiry.value }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    message.className = 'success';
    message.textContent = 'Payment successful. Order #' + data.orderId;
  } else if (res.status === 422) {
    message.className = 'alert';
    message.textContent = data.error;
  } else {
    message.className = 'alert';
    message.textContent = 'Something went wrong. Please try again.';
  }
  message.hidden = false;
});
</script>`,
  ),
};

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown, headers = {}) {
  send(res, status, JSON.stringify(body), {
    'Content-Type': 'application/json',
    ...headers,
  });
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const signedIn = req.headers.cookie?.includes(SESSION_COOKIE) ?? false;

  if (req.method === 'GET') {
    if (pathname === '/') return send(res, 200, pages.home);
    if (pathname === '/login') return send(res, 200, pages.login);
    if (pathname === '/checkout') return send(res, 200, pages.checkout);
    if (pathname === '/account') {
      return signedIn
        ? send(res, 200, pages.account)
        : send(res, 302, '', { Location: '/login' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    const { email, password } = await readJson(req);
    if (email === DEMO_CREDENTIALS.email && password === DEMO_CREDENTIALS.password) {
      return json(res, 200, { name: 'Demo User' }, {
        'Set-Cookie': `${SESSION_COOKIE}; Path=/; HttpOnly; SameSite=Lax`,
      });
    }
    return json(res, 401, { error: 'Invalid email or password' });
  }

  if (req.method === 'POST' && pathname === '/api/pay') {
    const { card } = await readJson(req);
    const digits = typeof card === 'string' ? card.replace(/\s+/g, '') : '';
    if (/^\d{16}$/.test(digits)) {
      return json(res, 200, { orderId: 1042 });
    }
    // BUG (deliberate): invalid input is not validated and crashes the handler.
    return json(res, 500, { error: 'Internal Server Error' });
  }

  return send(res, 404, layout('Not found', '<h1>Page not found</h1>'));
}

export function createDemoSite(): Server {
  return createServer((req, res) => {
    handle(req, res).catch(() => json(res, 500, { error: 'Internal Server Error' }));
  });
}
