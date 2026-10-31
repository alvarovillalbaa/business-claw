import { call, choice, digest, email, fail, freeze, id, nullableTime, record, time } from './data.mjs';

export const roles = Object.freeze(['owner', 'administrator', 'member', 'viewer']);
const lifecycle = ['operation:request', 'operation:review', 'operation:confirm', 'operation:cancel'];
const capabilities = freeze({
  owner: ['org:read', 'chat:read', 'chat:write', 'intent:write', ...lifecycle, 'membership:write', 'credential:consent', 'instance:retire'],
  administrator: ['org:read', 'chat:read', 'chat:write', 'intent:write', ...lifecycle, 'credential:consent'],
  member: ['org:read', 'chat:read', 'chat:write'], viewer: ['org:read', 'chat:read'],
});
export function capabilitiesFor(role) { return capabilities[choice(role, roles)]; }
export function requireCapability(membership, capability) { if (!capabilitiesFor(membership.role).includes(capability)) fail(403, 'forbidden'); }
export function requireKind(membership, kind) {
  choice(kind, ['provision', 'configure', 'pause', 'resume', 'delete']);
  if (membership.role !== 'owner' && !(membership.role === 'administrator' && ['configure', 'pause', 'resume'].includes(kind))) fail(403, 'forbidden');
}
export async function verifiedPrincipal(identity, context, mutation) {
  const raw = await call(identity, 'verify', context);
  if (raw === null) fail(401, 'unauthenticated');
  const input = record(raw, ['userId', 'email', 'emailConfirmed', 'handleHash', 'supabaseSessionId']);
  if (input.emailConfirmed !== true) fail(401, 'email_unconfirmed');
  const principal = freeze({ userId: id(input.userId), email: email(input.email), handleHash: digest(input.handleHash), supabaseSessionId: id(input.supabaseSessionId) });
  if (mutation && await call(identity, 'verifyMutation', context, freeze({ handleHash: principal.handleHash })) !== true) fail(403, 'request_integrity');
  return principal;
}
export function sessionRow(value) {
  if (value === null) fail(401, 'session_inactive');
  const input = record(value, ['handleHash', 'userId', 'supabaseSessionId', 'authenticatedAt', 'expiresAt', 'revokedAt']);
  return freeze({ handleHash: digest(input.handleHash), userId: id(input.userId), supabaseSessionId: id(input.supabaseSessionId), authenticatedAt: time(input.authenticatedAt), expiresAt: time(input.expiresAt), revokedAt: nullableTime(input.revokedAt) });
}
export function currentSession(principal, session, now) {
  time(now);
  if (session.handleHash !== principal.handleHash || session.userId !== principal.userId || session.supabaseSessionId !== principal.supabaseSessionId) fail(401, 'session_binding');
  if (session.revokedAt !== null || session.authenticatedAt > now || session.expiresAt <= now || session.expiresAt <= session.authenticatedAt || Date.parse(session.expiresAt) - Date.parse(session.authenticatedAt) > 8 * 60 * 60 * 1000) fail(401, 'session_inactive');
}
export function freshAuthentication(session, now) { if (Date.parse(now) - Date.parse(session.authenticatedAt) > 5 * 60 * 1000 || session.authenticatedAt > now) fail(401, 'fresh_auth_required'); }
export function membershipRow(value) {
  if (value === null) return null;
  const input = record(value, ['orgId', 'userId', 'role', 'revokedAt']);
  return freeze({ orgId: id(input.orgId), userId: id(input.userId), role: choice(input.role, roles), revokedAt: nullableTime(input.revokedAt) });
}
export function activeMembership(value, orgId, userId) {
  const membership = membershipRow(value);
  if (!membership || membership.orgId !== orgId || membership.userId !== userId || membership.revokedAt !== null) fail(404, 'not_found');
  return membership;
}
