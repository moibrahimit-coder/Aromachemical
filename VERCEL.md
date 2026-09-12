# Vercel preparation guide

This repository is **prepared**, not deployed. It still runs on Replit with its
existing managed Clerk, connector-proxied Stripe, Postgres, and private object
storage behavior. No account, service, secret, data migration, database schema
change, or Vercel project has been created by this change.

## GitHub import settings

1. Push this repository to GitHub and import it as a Vercel project with the
   repository root as the Root Directory.
2. Keep the detected package manager as **pnpm**. The checked-in lockfile is
   required.
3. The project uses `vercel.json`: install command
   `pnpm install --frozen-lockfile`, build command `pnpm run build:vercel`,
   output directory `artifacts/aroma-book/dist/public`, and Express Function
   entry `api/index.ts`.
4. `/api/*` is rewritten to that Function. All non-API routes rewrite to the
   Vite SPA entry, so client-side routes such as `/checkout` continue to work
   without masking API requests.

The Function has a 60-second maximum duration configured. It is request-driven,
not a process started with `app.listen`; Replit continues to start
`artifacts/api-server/src/index.ts` normally.

## Vercel environment variables

Add variables in the appropriate Vercel Environment (Production and Preview as
needed). Copy names from `.env.example`; do not commit values.

| Variable | Visibility | Required on Vercel | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Server-only | Yes | Existing external PostgreSQL connection string. |
| `APP_URL` | Server-only | Yes | Canonical production origin, `https://domain.example`, no path. It is used for Stripe return URLs and the allowed credentialed CORS origin. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Public build-time | Yes | External Clerk browser publishable key. |
| `CLERK_PUBLISHABLE_KEY` | Server-only | Yes | Same external Clerk publishable key for Express verification. |
| `CLERK_SECRET_KEY` | Server-only | Yes | External Clerk server key. |
| `STRIPE_SECRET_KEY` | Server-only | Required before card sales | Standard Stripe secret key used only by the Vercel adapter. |
| `S3_ENDPOINT` | Server-only | Required before uploads/downloads | HTTPS S3-compatible endpoint. |
| `S3_REGION` | Server-only | Required before uploads/downloads | S3 signing region; use `auto` for Cloudflare R2. |
| `S3_BUCKET` | Server-only | Required before uploads/downloads | Private bucket name. |
| `S3_ACCESS_KEY_ID` | Server-only | Required before uploads/downloads | S3-compatible access key ID. |
| `S3_SECRET_ACCESS_KEY` | Server-only | Required before uploads/downloads | S3-compatible secret access key. |
| `S3_PREFIX` | Server-only | Optional | Prefix inside the private bucket. |
| `S3_FORCE_PATH_STYLE` | Server-only | Optional | Defaults to `true`; set `false` only for providers that require virtual-hosted buckets. |
| `LOG_LEVEL` | Server-only | Optional | API logging level. |

Never add a secret to `VITE_*`: Vite embeds those values in the browser build.
Set public and server values separately in Vercel. The application does not
trust request `Host` or forwarded-host headers to generate payment return URLs;
Vercel requires a valid `APP_URL` and fails explicitly when it is absent.

### External providers

- **Clerk:** create/select an external production Clerk instance, set its
  production allowed origins/redirect URLs to `APP_URL`, then set the three
  Clerk variables above. The Vercel build removes the Replit Clerk proxy; it
  does not attempt to use Replit-managed keys or proxy routes.
- **Stripe:** configure the external Stripe account and `STRIPE_SECRET_KEY`.
  Server-side session verification remains required before a paid download is
  granted. Stripe webhooks are not introduced by this preparation.
- **Postgres:** provide the already-authorized provider's `DATABASE_URL`
  (for example, a pooled Neon connection if the owner later chooses Neon).
  This project neither replaces the database provider nor transfers data.
  Run any database migration manually and separately, only after review and
  explicit authorization; do not treat a Vercel deploy as a schema migration.
- **Private storage (optional code path):** create a private S3-compatible
  bucket and credentials with object read/write permission limited to that
  bucket/prefix. Cloudflare R2 works with its S3 endpoint, `S3_REGION=auto`,
  bucket name, and path-style URLs. Configure bucket CORS to allow browser
  `PUT` from the exact application origin and permit the upload request headers
  your browser sends. The server issues short-lived PUT URLs and validates
  metadata plus JPEG/PNG/PDF magic bytes before use. After the protected API
  route has completed its authorization and validation checks, Vercel redirects
  to a short-lived signed S3 `GET`; its signed attachment disposition supplies
  the download filename. Objects must remain private.

## Readiness before enabling sales

Sales start disabled in the database and should remain disabled until all of
the following are independently verified by the owner:

1. External Clerk sign-in works and the intended administrator has
   `privateMetadata.role` set to `admin` in the **production** Clerk instance.
2. The exact production `APP_URL` is configured in Vercel, Clerk, and Stripe
   return/allowed-origin settings.
3. The external Postgres database contains the authorized schema and expected
   data; no migration is performed by this repository.
4. Private storage is configured, the production PDF has been uploaded by an
   administrator, and an authorized paid-order download has been checked.
5. Stripe card checkout is configured and server-side payment reconciliation
   has been checked. Manual-transfer recipients and review procedures are
   configured separately where applicable.

The book PDF is not assumed to be ready by this preparation. Do not enable
sales merely because Vercel builds successfully.

## Upload and serverless caveats

The API accepts only upload **metadata**. File bytes travel directly from the
browser to a short-lived signed private-storage URL, avoiding Vercel Function
body limits. The current request schema allows a book upload up to 50 MB and
the route limits receipts to 5 MB; storage-provider bucket CORS, object-size
policies, and browser network behavior still need production testing. On
Vercel, large downloads are not streamed through the Function: the browser's
normal download link follows the authorized 302 redirect to the short-lived
private S3 GET URL. Presigned upload and download URLs are intentionally
temporary. Never make the bucket public or issue a signed download URL before
the protected route checks authorization and object validation.

## Local and CI verification

Run from the repository root:

```sh
pnpm run typecheck
pnpm run test:vercel
pnpm run build:vercel
```

`build:vercel` is also the Vercel build command. It validates all workspace
typechecks, bundles the API for parity, and creates the SPA output used by
`vercel.json`; Vercel then bundles the `api/index.ts` Express default export as
a Function. The Replit-only mockup artifact is typechecked but intentionally
not built for the production site.