import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { resolveTenant } from '@/lib/tenant.ts';
import { provisionOrgBucket } from '@/lib/storage.ts';

export const dynamic = 'force-dynamic';

/**
 * Clerk webhooks (Svix-signed; public in middleware — auth is the signature).
 * On `organization.created` we create the org's tenant and provision its
 * dedicated S3 bucket (one bucket per org), so capture is ready the moment the
 * partner installs. Set CLERK_WEBHOOK_SIGNING_SECRET in the dashboard env.
 */
export async function POST(req: Request) {
  let evt;
  try {
    // verifyWebhook wants Clerk's RequestLike; a standard Request is compatible.
    evt = await verifyWebhook(req as Parameters<typeof verifyWebhook>[0]);
  } catch {
    return new Response('webhook verification failed', { status: 400 });
  }

  if (evt.type === 'organization.created') {
    const orgId = evt.data.id;
    const createdBy = (evt.data as { created_by?: string }).created_by ?? '';
    try {
      const tenantId = await resolveTenant({ userId: createdBy, orgId });
      const provisioned = await provisionOrgBucket(tenantId);
      console.log(`[clerk-webhook] org.created ${orgId} → tenant ${tenantId} provisioned=${provisioned}`);
    } catch (err) {
      // Don't 5xx into a Svix retry storm — bucket creation is idempotent and an
      // org admin can also provision via Storage settings. Log for follow-up.
      console.error(`[clerk-webhook] provisioning failed for org ${orgId}:`, err);
    }
  }

  return new Response('ok', { status: 200 });
}
