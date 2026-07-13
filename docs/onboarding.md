# Onboarding a design partner (secure, per-org storage)

Effigent captures an org's agent runs and stores the run content **only in that
org's own S3 bucket** (S3-only residency). Effigent's database keeps just
metadata (cost, models, step count, timestamps) and a pointer — never raw
payloads. Capture is **refused until an org's bucket is configured**, so no data
lands before the workspace is deliberately provisioned.

## One-time AWS / Vercel setup (Effigent side)

1. **CMK (optional but recommended):** create a KMS key for run buckets; note its ARN.
2. **Dashboard IAM principal** (the identity the Vercel app runs as) — scope it to:
   - `s3:PutObject`, `s3:GetObject` on `arn:aws:s3:::effigent-runs-*/*`
   - `s3:CreateBucket` is **not** needed by the app (buckets are created by the
     owner-run script below).
   - `kms:GenerateDataKey`, `kms:Decrypt` on the CMK (if used)
   - `sts:AssumeRole` on partner BYO role ARNs (for the BYO path)
   The dashboard IAM also needs `s3:CreateBucket`, `s3:PutPublicAccessBlock`,
   `s3:PutBucketEncryption` for auto-provisioning, and `kms:GenerateDataKey`/
   `kms:Decrypt` on the CMK.
3. **Vercel env** (dashboard project): `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY` (or Vercel OIDC), `EFFIGENT_S3_KMS_KEY` (the run-data
   CMK ARN), `EFFIGENT_S3_BUCKET_PREFIX` (optional), and
   `CLERK_WEBHOOK_SIGNING_SECRET` (for the org.created webhook).
4. **Clerk webhook:** add an `organization.created` webhook pointing at
   `https://<dashboard>/api/v1/webhooks/clerk`; put its signing secret in the env
   var above.
5. **Schema:** once, `PROD_DATABASE_URL=… node scripts/apply-org-storage.mjs`.

## Per-partner onboarding

1. **Create the workspace (Clerk):** create a Clerk **Organization** for the
   partner and invite their users (Clerk owns invites/SSO). A Clerk org = an
   Effigent tenant; only that org's members can see its data.
2. **Provision storage — pick one:**
   - **Effigent-hosted bucket (default) — AUTOMATIC:** when the Clerk org is
     created, the `organization.created` webhook (`/api/v1/webhooks/clerk`)
     provisions `effigent-runs-<id>` (block-public-access + SSE-KMS with the
     Effigent CMK) and records it on the tenant. Nothing to run per org.
     Manual fallback (re-provision / pre-webhook orgs):
     ```
     AWS_REGION=us-east-1 PROD_DATABASE_URL=… \
       node scripts/provision-org-bucket.mjs --ref <clerk_org_id> [--kms <cmk-arn>]
     ```
   - **BYO bucket (partner's own AWS account):** hand the partner
     **`docs/byo-s3-setup.md`** — it walks their cloud team through the bucket +
     cross-account role (trust + permissions JSON, external id). They return
     bucket/region/roleArn/externalId (+ kmsKey if used); an org admin saves it
     under the dashboard **Storage** settings (or `PUT /api/v1/storage`). The PUT
     runs a write→read probe and only reports success if access works.
3. **Issue a capture key:** in the dashboard **Keys** view, mint a scoped `eff_`
   key for the partner's agent (shown once). Prefer a per-agent scoped key over
   the tenant owner key.
4. **Partner installs capture** (insights-only — no injection):
   ```
   npm i -g effigent
   effigent login --key eff_…
   effigent agent add <agent>
   effigent install claude --agent <agent>     # or: install codex --agent <agent>
   ```
5. **Verify:** after the partner's next session, a run appears under the agent in
   the dashboard; the object exists in the org's bucket; the `runs` row has an
   `s3://` `blob_path` and `parsed IS NULL`.

## Notes
- Before step 2, capture returns **409 "workspace storage not provisioned"** — a
  feature, not a bug: no bucket ⇒ no data.
- Tool **injection** is off in the POC (`EFFIGENT_ENABLE_INJECTION`); onboarding
  wires capture + read-only insights only.
