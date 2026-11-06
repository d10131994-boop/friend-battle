# Supabase database backups

The repository workflow `.github/workflows/weekly-supabase-backup.yml` creates an encrypted logical database backup every Sunday at 04:00 UTC. It can also be started manually with GitHub Actions → Weekly Supabase database backup → Run workflow.

## One-time setup

Add these **repository Actions secrets** in GitHub:

- `SUPABASE_DB_URL` — the Production PostgreSQL connection string from Supabase Dashboard → Connect. Prefer the Session pooler connection string. Percent-encode special characters in the connection URL as required by the Supabase CLI.
- `BACKUP_ENCRYPTION_PASSPHRASE` — a long, randomly generated passphrase used for GPG AES-256 symmetric encryption.

Keep a separate copy of the encryption passphrase in a secure password manager or offline recovery location. The repository is public; backup artifacts are therefore encrypted before upload. Losing the passphrase makes retained backups unrecoverable.

The workflow exports roles, schema and data using the Supabase CLI. Because the CLI excludes Supabase-managed schemas such as `realtime`, the workflow also exports custom RLS policies from `realtime` into `realtime-policies.sql`; this preserves the room broadcast policy. It uploads only the encrypted archive and checksum, then deletes older matching artifacts so that only the newest two backups remain. Artifacts have a 90-day maximum retention setting; the two-copy retention rule is the effective limit during normal weekly operation.

## Restore outline

1. Download the desired `supabase-db-backup-<run-id>` artifact from GitHub Actions.
2. Decrypt it using the same passphrase:
   ```sh
   gpg --output supabase-db-backup.tar.gz --decrypt supabase-db-backup.tar.gz.gpg
   ```
3. Verify the archive before extraction:
   ```sh
   sha256sum -c supabase-db-backup.sha256
   tar -xzf supabase-db-backup.tar.gz
   ```
4. Restore into a deliberately selected target Supabase project, not Production by default. Review the SQL and the target project's existing roles/schema first. The standard Supabase CLI restore flow uses `psql --single-transaction --variable ON_ERROR_STOP=1` with the role, schema and data dump files.

This is a logical database backup, not a full Supabase project image. Supabase documents that Storage API file objects are not included in database backups; only database metadata is present. Edge Function secrets, JWT signing keys, Telegram bot tokens, project settings and other dashboard configuration must be backed up separately and securely.

## Limits and verification

- The repository owner has configured both required repository secrets. The first workflow run is still pending.
- A successful workflow run proves that the logical dump was created, encrypted and uploaded; it does not prove that a restore has been tested. Restore testing is deferred to the repository owner and is outside this audit task.
- GitHub artifact storage usage/quota is account-level and was not exposed by the repository connector during this audit. Check it in GitHub billing/settings after the first run. The workflow limits retained backup artifacts to two to reduce storage use.
- Do not upload plaintext SQL dumps or the encryption passphrase to the repository, issues, logs or artifacts.
