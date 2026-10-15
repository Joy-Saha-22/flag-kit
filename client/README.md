# FlagKit Dashboard

This is the browser dashboard for FlagKit. It is a Vite React application with a quiet internal-console UI and the design tokens required by the design rules.

## Setup

- Install workspace dependencies from the repo root: `npm install`
- Start the app: `npm run dev --workspace @flagkit/client`
- Build the app: `npm run build --workspace @flagkit/client`
- Run tests: `npm test --workspace @flagkit/client`

## Dev proxy

The Vite server proxies `/api` and `/sdk` to `http://localhost:3000` in `vite.config.js`. This keeps browser requests on the same origin, so the secure httpOnly session cookie works as expected.

## Design rules

The app uses IBM Plex Sans and IBM Plex Mono from `@fontsource`, a low-noise neutral palette, 2px borders and corners, and no gradients, shadows, or motion. The design enforcement test in `tests/design.test.js` checks the source tree and fails on any violation.

## Dashboard data flow

Route loaders read API resources through `src/lib/api.js`. Route actions and `useFetcher` submit writes as JSON; React Router revalidates the affected loaders after successful writes. Unexpected errors reach the route error screen, while expected API errors are displayed as action data with their request IDs. Local form state is used only for unsaved edits, and `useBlocker` protects targeting and settings edits from accidental navigation.

Flag targeting edits are initialized from the selected environment's loaded version. Saves send that version as `expectedVersion`; a conflict remains on screen until the user reloads the loader data. The evaluation panel calls the test-evaluation action and does not change or preview unsaved configuration.

## Project pages

- Flag Results loads the selected environment's experiment statistics and compares each variation with the first variation, which is the control. The chart and table use the values returned by the API.
- Flag History reuses the project audit table filtered to the selected flag.
- SDK Keys lists the selected environment's keys. Revocation uses a route action. Key creation is sent directly from the page, so the one-time full key is kept only in component memory and cleared when its dialog closes.
- Audit Log filters by flag and environment in the URL. Older entries load through a fetcher and are appended in the page.
- SDK Demo evaluates flags locally using the browser SDK. `VITE_DEMO_CLIENT_SDK_KEY` must be a client SDK key. The SDK local evaluation API records experiment exposure events; `track` records matching metric conversions.

## Demo environment

Copy `.env.example` to `.env.local` and set `VITE_DEMO_CLIENT_SDK_KEY` to a client SDK key. `VITE_API_URL` is optional and defaults to the current browser origin, which uses the Vite `/sdk` proxy during development. Never use a server SDK key in the browser. The SDK key is public, and client keys expose full targeting rules.

## Extended data flow

Results, audit entries, and SDK key lists are read by route loaders through `src/lib/api.js`. Audit pagination uses a fetcher loader request with the server cursor. SDK key revocation is a JSON route action. Key creation is the only direct API mutation because the returned secret must not enter router action state; after creation the list loader is revalidated. The Demo page has no API loader and creates/closes its SDK client as a component resource.
