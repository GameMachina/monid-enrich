import { verifyWebhook } from '@clerk/nextjs/webhooks';
import type { NextRequest } from 'next/server';
import { SELF_HOSTED_ISSUER } from '@/lib/auth-identity';
import { withDatabase } from '@/lib/server/database';
import { managedAuthEnabled } from '@/lib/server/deployment';
import { appendWorkspaceAuditEvent, type WorkspaceAuditAction } from '@/lib/server/workspace-audit';

export const maxDuration = 15;

const ACTIONS: Record<string, WorkspaceAuditAction> = {
	'organization_membership.created': 'workspace.member.added',
	'organization_membership.updated': 'workspace.member.updated',
	'organization_membership.deleted': 'workspace.member.removed',
	'organization_invitation.created': 'workspace.invitation.created',
	'organization_invitation.accepted': 'workspace.invitation.accepted',
	'organization_invitation.revoked': 'workspace.invitation.revoked',
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : undefined;

function auditDetails(type: string, data: Record<string, unknown>) {
	const details: Record<string, string | number | boolean | null> = {};
	const member = text(data.user_id) ?? text(object(data.public_user_data).user_id);
	const membershipId = text(data.organization_membership_id) ?? text(data.id);
	const invitationId = text(data.organization_invitation_id) ?? text(data.id);
	const role = text(data.role);
	if (member) details.memberId = member;
	if (role) details.role = role;
	if (type.startsWith('organization_membership.') && membershipId) details.membershipId = membershipId;
	if (type.startsWith('organization_invitation.') && invitationId) details.invitationId = invitationId;
	return details;
}

function actorFor(type: string, data: Record<string, unknown>) {
	if (type === 'organization_invitation.created') return text(data.inviter_user_id) ?? 'clerk';
	if (type === 'organization_invitation.revoked') return text(data.requesting_user_id) ?? 'clerk';
	if (type === 'organization_invitation.accepted') return text(data.user_id) ?? 'clerk';
	return 'clerk';
}

export async function POST(request: Request) {
	if (!managedAuthEnabled()) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
	if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.startsWith('whsec_')) return Response.json({ error: 'Clerk webhook is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
	const deliveryId = request.headers.get('svix-id')?.trim() ?? '';
	if (!deliveryId || deliveryId.length > 200) return Response.json({ error: 'Invalid webhook delivery.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
	const body = await request.clone().text();
	if (Buffer.byteLength(body) > 128_000) return Response.json({ error: 'Webhook payload too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
	let event: { type?: string; data?: unknown };
	try {
		event = await verifyWebhook(request as unknown as NextRequest) as { type?: string; data?: unknown };
	} catch {
		return Response.json({ error: 'Webhook signature verification failed.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
	}
	const type = text(event.type) ?? '';
	const action = ACTIONS[type];
	if (!action) return Response.json({ received: true, recorded: false }, { headers: { 'Cache-Control': 'no-store' } });
	const data = object(event.data);
	const organizationId = text(data.organization_id);
	if (!organizationId) return Response.json({ error: 'Organization event is missing its organization ID.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
	try {
		const recorded = await withDatabase((database) => database.transaction(async (sql) => {
			const inserted = await sql.query('INSERT INTO enrichable.clerk_webhook_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id', [deliveryId, type]);
			if (!inserted.rows.length) return false;
			const workspaces = await sql.query('SELECT id FROM enrichable.workspaces WHERE organization_id=$1 AND issuer<>$2 AND deleted_at IS NULL', [organizationId, SELF_HOSTED_ISSUER]);
			const actorId = actorFor(type, data), details = auditDetails(type, data);
			for (const workspace of workspaces.rows) await appendWorkspaceAuditEvent(sql, String(workspace.id), actorId, action, details);
			return true;
		}));
		return Response.json({ received: true, recorded }, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return Response.json({ error: 'Webhook processing failed; Clerk may retry this event.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
	}
}
