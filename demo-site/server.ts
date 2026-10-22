import { createDemoSite, DEMO_CREDENTIALS } from './app.js';

const port = Number(process.env.DEMO_SITE_PORT ?? 4100);
const fixed = ['1', 'true'].includes(process.env.DEMO_SITE_FIXED ?? '');

createDemoSite({ fixed }).listen(port, () => {
  console.log(
    `Acme Store demo site (${fixed ? 'bugs fixed' : 'with planted bugs'}) → http://localhost:${port}`,
  );
  console.log(`Sign in with ${DEMO_CREDENTIALS.email} / ${DEMO_CREDENTIALS.password}`);
});
