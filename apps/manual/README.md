# WraithWalker Manual App

Standalone Next.js + Fumadocs manual for the WraithWalker monorepo.

## Local development

```bash
npm ci
npm run dev --workspace=@wraithwalker/manual
```

Then open http://localhost:3000.

## Verification

```bash
npm run lint --workspace=@wraithwalker/manual
npm run typecheck --workspace=@wraithwalker/manual
npm run test --workspace=@wraithwalker/manual
npm run build --workspace=@wraithwalker/manual
```

## Vercel

- Root Directory: `apps/manual`
- Framework: Next.js
- Install Command: `npm ci`
- Build Command: `npm run build`
- Set `NEXT_PUBLIC_SITE_URL` only when you know the deployed URL.

## Documentation source of truth

Edit the MDX files in `../../docs/`. The manual app reads from that directory directly.
