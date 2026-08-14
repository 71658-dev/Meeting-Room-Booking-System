import { Hono } from 'hono';
import { HonoEnv } from '../types';

const configApp = new Hono<HonoEnv>();

configApp.get('/', (c) => {
  // No hardcoded fallback: a wrong sitekey silently produces a widget whose tokens can
  // never verify, which is harder to diagnose than an explicit missing-config error.
  const siteKey = c.env.TURNSTILE_SITEKEY;
  if (!siteKey) {
    return c.json({ error: 'TURNSTILE_SITEKEY 尚未設定' }, 503);
  }
  return c.json({ TURNSTILE_SITEKEY: siteKey });
});

export default configApp;
