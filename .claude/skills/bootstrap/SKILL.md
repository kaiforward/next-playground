# Bootstrap — Environment Check

Run the following checks and report a summary. Only flag items that need attention.

## Checks

1. **Runtime:** Verify `node` and `npm` are installed. Show versions.
2. **Dependencies:** Check if `node_modules/` exists. If not, suggest `npm install`.
3. **Database:** Check if `dev.db` exists. If not, suggest `npx prisma db push && npx prisma db seed`.
4. **Env file:** Check if `.env` exists with `AUTH_SECRET` and `AUTH_URL`. If not, show what to create.
5. **Outdated packages:** Run `npm outdated` and report any major version bumps. Minor/patch updates are informational only.
6. **Build check:** Run `npm run build` to verify everything compiles.

## Output

Print a short pass/fail summary for each check. Only provide fix instructions for failures.
