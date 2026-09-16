# Security and privacy

## Repository boundary

This template intentionally excludes:

- document, spreadsheet, folder, deployment, and account identifiers;
- links to private Google resources;
- source paragraphs and real correction rows;
- reviewer names, email addresses, notes, or audit history;
- API keys, OAuth tokens, cookies, and Script Properties;
- source-specific prompts, approved-domain lists, or institutional policy;
- backups and exported production data.

Run `npm test` before every public or shared release.

## Deployment secrets

Keep document IDs and access controls in the live `Settings` sheet or Script Properties. Keep external API keys only in Script Properties or a secret manager. `.clasp.json` is gitignored because it contains a project identifier.

## Least privilege

Use a dedicated Sheet and a restricted web-app audience. Set `allowed_email`. Keep both application gates false except during deliberate application. Use a disposable pilot document before live operation.

## Data retention

The queue may contain complete source paragraphs, reviewer decisions, and audit notes. Treat the production Sheet and backups as sensitive. Configure Drive sharing and retention accordingly. Sanitizing this repository does not sanitize a copied Sheet or exported CSV.

## Pre-release checklist

- Run the privacy scanner.
- Inspect `git diff --cached`.
- Search for `docs.google.com`, `drive.google.com`, email addresses, long tokens, and private names.
- Confirm examples are fictional.
- Confirm settings contain placeholders or blanks.
- Confirm no exported Sheet, source Doc, log, or continuity artifact is present.
- Confirm automated preparation remains disabled and no path autoaccepts findings.
