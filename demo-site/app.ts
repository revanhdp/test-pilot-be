import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

/**
 * "Acme Store": a tiny target website for trying TestPilot locally and for the
 * browser engine's integration tests.
 *
 * It ships with planted bugs, each one a different way for a test to fail:
 *
 * | Where              | Bug                                                         |
 * | ------------------ | ----------------------------------------------------------- |
 * | /checkout          | invalid card number → API answers HTTP 500, generic error   |
 * | /deals             | linked from the nav, but the page does not exist (404)     |
 * | /  (Add to cart)   | says "Added to cart" but the cart count never changes       |
 * | /  (search field)  | its id was renamed, so tests that use the old id break      |
 * | /  (product image) | no alt text                                                 |
 * | /newsletter        | accepts any text as an email address                        |
 * | /orders            | server error (HTTP 500)                                     |
 * | /reports           | takes 12 s to load                                          |
 * | /admin             | reachable without signing in                                |
 *
 * With `{ fixed: true }` every bug is fixed, which is how the tests that catch
 * them are proven to fail only because of the bug.
 */

export const DEMO_CREDENTIALS = { email: 'demo@acme.test', password: 'password123' };

export interface DemoSiteOptions {
  /** Serve the corrected site: every planted bug is fixed. */
  fixed?: boolean;
}

const SESSION_COOKIE = 'acme_session=demo';

const PRODUCT_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' rx='12' fill='%234f46e5'/%3E%3C/svg%3E";

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
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 20px; }
  .product { background: #fff; border: 1px solid #e3e5e8; border-radius: 10px; padding: 18px; }
  .product span { color: #57606a; }
  .product img { display: block; margin-bottom: 10px; }
  .product button { margin-top: 12px; padding: 6px; }
</style>
</head>
<body>
<header><strong>Acme Store</strong><nav><a href="/">Home</a><a href="/deals">Deals</a><a href="/checkout">Checkout</a><a href="/login">Sign in</a><span>Cart (<span id="cart-count">0</span>)</span></nav></header>
<main>${body}</main>
</body>
</html>`;

function buildPages(fixed: boolean) {
  return {
    home: layout(
      'Home',
      `<h1>Featured products</h1>
<input id="${fixed ? 'search-box' : 'search-input'}" type="search" placeholder="Search products" aria-label="Search products">
<div class="grid">
  <div class="product">
    <img src="${PRODUCT_IMAGE}" ${fixed ? 'alt="Trail Backpack"' : ''} width="64" height="64">
    <strong>Trail Backpack</strong><br><span>$49.00</span>
    <button class="add" type="button" aria-label="Add Trail Backpack to cart">Add to cart</button>
  </div>
  <div class="product"><strong>Water Bottle</strong><br><span>$18.00</span>
    <button class="add" type="button" aria-label="Add Water Bottle to cart">Add to cart</button>
  </div>
  <div class="product"><strong>Camp Lantern</strong><br><span>$32.00</span>
    <button class="add" type="button" aria-label="Add Camp Lantern to cart">Add to cart</button>
  </div>
</div>
<p id="cart-status" role="status"></p>
<script>
var count = 0;
document.querySelectorAll('.add').forEach(function (button) {
  button.addEventListener('click', function () {
    document.getElementById('cart-status').textContent = 'Added to cart ✓';
    if (${fixed}) document.getElementById('cart-count').textContent = String(++count);
  });
});
</script>`,
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

    deals: layout(
      'Deals',
      `<h1>Summer Deals</h1><p>Up to 30% off camping gear.</p>`,
    ),

    newsletter: layout(
      'Newsletter',
      `<div class="card narrow">
<h1>Newsletter</h1>
<form id="newsletter-form" novalidate>
  <label for="news-email">Email</label>
  <input id="news-email" type="email" autocomplete="email">
  <button type="submit">Subscribe</button>
  <div id="newsletter-message" role="status" hidden></div>
</form>
</div>
<script>
document.getElementById('newsletter-form').addEventListener('submit', function (event) {
  event.preventDefault();
  var value = document.getElementById('news-email').value;
  var message = document.getElementById('newsletter-message');
  var valid = /^\\S+@\\S+\\.\\S+$/.test(value);
  if (${fixed} && !valid) {
    message.className = 'alert';
    message.textContent = 'Enter a valid email address';
  } else {
    message.className = 'success';
    message.textContent = 'Thanks for subscribing!';
  }
  message.hidden = false;
});
</script>`,
    ),

    orders: layout('Orders', `<h1>Your orders</h1><p>You have not placed any orders yet.</p>`),

    serverError: layout('Server error', '<h1>Internal Server Error</h1><p>Please try again later.</p>'),

    reports: layout(
      'Reports',
      `<div class="card">
<h1>Sales report</h1>
<p id="report-status" role="status">Loading report…</p>
</div>
<script>
setTimeout(function () {
  document.getElementById('report-status').textContent = 'Report ready';
}, ${fixed ? 200 : 12000});
</script>`,
    ),

    admin: layout(
      'Admin',
      `<div class="card"><h1>Admin panel</h1><p>Registered users: demo@acme.test, sam@acme.test, lee@acme.test</p></div>`,
    ),
  };
}

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

const redirect = (res: ServerResponse, location: string) => send(res, 302, '', { Location: location });

function createHandler(fixed: boolean) {
  const pages = buildPages(fixed);

  return async (req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const signedIn = req.headers.cookie?.includes(SESSION_COOKIE) ?? false;

    if (req.method === 'GET') {
      switch (pathname) {
        case '/':
          return send(res, 200, pages.home);
        case '/login':
          return send(res, 200, pages.login);
        case '/checkout':
          return send(res, 200, pages.checkout);
        case '/newsletter':
          return send(res, 200, pages.newsletter);
        case '/reports':
          return send(res, 200, pages.reports);
        case '/account':
          return signedIn ? send(res, 200, pages.account) : redirect(res, '/login');
        case '/deals':
          // BUG: linked from the navigation, but the page was never built.
          if (fixed) return send(res, 200, pages.deals);
          break;
        case '/orders':
          // BUG: the orders page crashes on the server.
          return fixed ? send(res, 200, pages.orders) : send(res, 500, pages.serverError);
        case '/admin':
          // BUG: no authentication check on the admin panel.
          return fixed && !signedIn ? redirect(res, '/login') : send(res, 200, pages.admin);
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
      // BUG: invalid input is not validated and crashes the handler.
      return fixed
        ? json(res, 422, { error: 'Card number is invalid' })
        : json(res, 500, { error: 'Internal Server Error' });
    }

    return send(res, 404, layout('Not found', '<h1>Page not found</h1>'));
  };
}

export function createDemoSite(options: DemoSiteOptions = {}): Server {
  const handle = createHandler(options.fixed ?? false);
  return createServer((req, res) => {
    handle(req, res).catch(() => json(res, 500, { error: 'Internal Server Error' }));
  });
}
