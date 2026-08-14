import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Tests run inside real workerd via @cloudflare/vitest-pool-workers, replacing the old
// scripts/test_system.js. That script could only hit a deployed environment, defaulted
// to the live dev worker, and — because it exercised the mail endpoint against whatever
// BREVO_API_KEY happened to be configured — could send real email as a side effect of
// running the test suite.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.json' },
      miniflare: {
        compatibilityDate: '2024-09-23',
        bindings: {
          // Cloudflare's documented always-passes Turnstile testing secret. Safe to
          // hardcode here because it only ever exists in the test isolate — the
          // application refuses to start without a real secret elsewhere.
          TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
          TURNSTILE_SITEKEY: '1x00000000000000000000AA',
          SUPERADMIN_DEFAULT_PASSWORD: 'test-only-bootstrap-password-9f3a',
          // No mail provider keys: the service falls back to simulation mode, so the
          // suite can never send real email.
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
