# System 11 in VALOR

System 11 is deployed with the existing VALOR web service. Sign in as a Creator or admin, then open `/system11/console`. Its authenticated JSON interfaces are `GET /system11` and `POST /system11/advance`.

This is an isolated scratch workspace. It does not replace the saved-life clock, execute player actions in a campaign, or connect another numbered system. All domain and persistence adapters remain dummy JSON functions. Each account has a separate scratch branch. Scratch state expires after 30 minutes of inactivity or a server restart. The console currently exposes bounded waits; the complete isolated module remains available through its Python API.

The gateway supplies authorization and trusted snapshots internally. Clients cannot upload snapshots, receipts, arbitrary clock writes, actor identities, or adapter credentials. Existing authentication, CSRF, origin checks and rate limits apply. Each account has one in-flight request, with two Python workers globally and bounded memory, input, output, duration, and runtime. Child processes receive no game database or provider credentials.

## Runtime

Python 3.12+ must be available as `python3` or `python`, or through the optional server setting `VALOR_SYSTEM11_PYTHON`. `npm ci` runs a build-time probe and fails if the runtime or pinned timezone pack cannot load. The vendored `tzdata` package is 2026.4, IANA 2026d; its license files are included. No external Python download is required during deployment.

## Verification

```sh
npm run check
npm run test:system11
node tests/run.ts tests/system11-console.test.ts
npm test
```

`GET /healthz` exposes the deployed commit through `X-VALOR-Commit` and returns `X-VALOR-System11: system11/1` on the deployed build. Anonymous requests to `/system11` must remain unauthorized. Production clock replacement requires a separate explicitly authorized integration of real owner adapters and durable coordination.
