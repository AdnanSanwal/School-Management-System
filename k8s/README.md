# Kubernetes manifests: not maintained

These files predate the move to MySQL (they still define PostgreSQL) and are **not a
supported way to deploy**. Use `docker-compose.prod.yml` (see `docs/DEPLOY.md`).

If you revive them:
- copy `secrets.example.yml` to `secrets.yml` (git-ignored) or, better, use sealed/external secrets;
- switch the database to MySQL 8.4 and set every variable `backend/src/config/env.ts` requires;
- set `TRUST_PROXY: "1"` on the backend (behind the ingress) so rate limits see real client IPs;
- don't enable ingress-level CORS: the API has its own origin allow-list;
- add a `securityContext` (runAsNonRoot, readOnlyRootFilesystem where possible) and NetworkPolicies.
