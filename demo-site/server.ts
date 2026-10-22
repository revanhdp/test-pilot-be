import { createDemoSite, DEMO_CREDENTIALS } from './app.js';

const port = Number(process.env.DEMO_SITE_PORT ?? 4100);

createDemoSite().listen(port, () => {
  console.log(`Acme Store demo site → http://localhost:${port}`);
  console.log(`Sign in with ${DEMO_CREDENTIALS.email} / ${DEMO_CREDENTIALS.password}`);
});
