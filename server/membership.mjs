import { timingSafeEqual } from 'node:crypto';
import { activeMembership, currentSession, freshAuthentication, membershipRow, requireCapability, sessionRow } from './access.mjs';
import { call, choice, digest, email, fail, freeze, hash, id, nullableTime, record, revision, rows, time } from './data.mjs';

const nonOwner = ['administrator', 'member', 'viewer'];
const week = 7 * 24 * 60 * 60 * 1000, freshness = 5 * 60 * 1000;
const inviteFields = ['id', 'orgId', 'email', 'role', 'invitedBy', 'requestHash', 'tokenHash', 'createdAt', 'expiresAt', 'revokedAt', 'acceptedBy', 'acceptedAt', 'acceptedRevision'];
const transferFields = ['id', 'orgId', 'fromUserId', 'toUserId', 'fromSessionHash', 'fromSupabaseSessionId', 'fromAuthenticatedAt', 'requestHash', 'createdAt', 'expiresAt', 'acceptedBy', 'acceptedAt', 'acceptedRevision'];
const inviteHash = row => hash({ orgId: row.orgId, inviteId: row.id, email: row.email, role: row.role, invitedBy: row.invitedBy });
const transferHash = row => hash({ orgId: row.orgId, transferId: row.id, fromUserId: row.fromUserId, toUserId: row.toUserId,
  fromSessionHash: row.fromSessionHash, fromSupabaseSessionId: row.fromSupabaseSessionId, fromAuthenticatedAt: row.fromAuthenticatedAt });

function accepted(input) {
  const result = { acceptedBy: input.acceptedBy === null ? null : id(input.acceptedBy), acceptedAt: nullableTime(input.acceptedAt),
    acceptedRevision: input.acceptedRevision === null ? null : revision(input.acceptedRevision, 1) };
  if ([result.acceptedBy, result.acceptedAt, result.acceptedRevision].filter(value => value !== null).length % 3 !== 0) fail(503, 'store_invalid');
  return result;
}
function inviteRow(value, expectedId) {
  if (value === null) fail(404, 'not_found');
  const input = record(value, inviteFields);
  const row = { id: id(input.id), orgId: id(input.orgId), email: email(input.email), role: choice(input.role, nonOwner), invitedBy: id(input.invitedBy),
    requestHash: digest(input.requestHash), tokenHash: digest(input.tokenHash), createdAt: time(input.createdAt), expiresAt: time(input.expiresAt),
    revokedAt: nullableTime(input.revokedAt), ...accepted(input) };
  if (row.id !== expectedId) fail(404, 'not_found');
  if (Date.parse(row.expiresAt) - Date.parse(row.createdAt) !== week || row.requestHash !== inviteHash(row)
    || (row.revokedAt !== null && row.revokedAt < row.createdAt)
    || (row.acceptedAt !== null && (row.acceptedAt < row.createdAt || row.acceptedAt >= row.expiresAt || row.revokedAt !== null))) fail(503, 'store_invalid');
  return freeze(row);
}
function transferRow(value, expectedId) {
  if (value === null) fail(404, 'not_found');
  const input = record(value, transferFields);
  const row = { id: id(input.id), orgId: id(input.orgId), fromUserId: id(input.fromUserId), toUserId: id(input.toUserId),
    fromSessionHash: digest(input.fromSessionHash), fromSupabaseSessionId: id(input.fromSupabaseSessionId), fromAuthenticatedAt: time(input.fromAuthenticatedAt),
    requestHash: digest(input.requestHash), createdAt: time(input.createdAt), expiresAt: time(input.expiresAt), ...accepted(input) };
  if (row.id !== expectedId) fail(404, 'not_found');
  if (row.fromUserId === row.toUserId || row.fromAuthenticatedAt > row.createdAt || row.createdAt >= row.expiresAt
    || Date.parse(row.expiresAt) - Date.parse(row.fromAuthenticatedAt) !== freshness || row.requestHash !== transferHash(row)
    || (row.acceptedBy !== null && (row.acceptedBy !== row.toUserId || row.acceptedAt < row.createdAt || row.acceptedAt >= row.expiresAt))) fail(503, 'store_invalid');
  return freeze(row);
}
function history(row, org) {
  if (row.orgId !== org.id) fail(404, 'not_found');
  if (row.createdAt < org.createdAt || row.createdAt > org.updatedAt || (row.revokedAt !== undefined && row.revokedAt !== null && row.revokedAt > org.updatedAt)
    || (row.acceptedAt !== null && (row.acceptedAt > org.updatedAt || row.acceptedRevision > org.revision))) fail(503, 'store_invalid');
}
function checkToken(value, expectedHash) {
  const actual = Buffer.from(hash(digest(value)), 'hex'), expected = Buffer.from(expectedHash, 'hex');
  if (!timingSafeEqual(actual, expected)) fail(404, 'not_found');
}
function inviteAck(row, serverRevision, replayed, at) {
  return freeze({ orgId: row.orgId, inviteId: row.id, role: row.role, expiresAt: row.expiresAt,
    state: row.acceptedBy !== null ? 'accepted' : row.revokedAt !== null ? 'revoked' : row.expiresAt <= at ? 'expired' : 'pending',
    acceptedBy: row.acceptedBy, acceptedAt: row.acceptedAt, serverRevision, replayed });
}
const transferAck = (row, serverRevision, replayed) => freeze({ orgId: row.orgId, transferId: row.id, fromUserId: row.fromUserId,
  toUserId: row.toUserId, expiresAt: row.expiresAt, acceptedAt: row.acceptedAt, serverRevision, replayed });
const memberAck = (row, serverRevision, replayed) => freeze({ ...row, serverRevision, replayed });

export function createMembershipMethods(core) {
  const { run, live, loadOrganization, expected, commit, newToken } = core;
  async function owner(tx, auth, input) {
    const result = await loadOrganization(tx, auth, id(input.orgId));
    expected(result.org, input); requireCapability(result.membership, 'membership:write'); return result;
  }
  async function targetMember(tx, orgId, userId) {
    const row = membershipRow(await call(tx, 'readMembership', orgId, userId));
    if (!row || row.orgId !== orgId || row.userId !== userId) fail(404, 'not_found');
    return row;
  }
  async function preserveOwner(tx, org, target) {
    if (target.role !== 'owner' || target.revokedAt !== null) return;
    const all = rows(await call(tx, 'listMemberships', org.id)).map(membershipRow);
    if (all.some(row => !row || row.orgId !== org.id) || new Set(all.map(row => row.userId)).size !== all.length
      || !all.some(row => row.userId === target.userId && row.role === target.role && row.revokedAt === target.revokedAt)) fail(503, 'store_invalid');
    if (all.filter(row => row.role === 'owner' && row.revokedAt === null).length < 2) fail(409, 'last_owner');
  }
  async function memberChange(context, value, revoke) {
    return run(context, true, async (tx, auth) => {
      const input = record(value, revoke ? ['orgId', 'expectedRevision', 'userId'] : ['orgId', 'expectedRevision', 'userId', 'role']);
      const { org } = await owner(tx, auth, input), userId = id(input.userId), target = await targetMember(tx, org.id, userId);
      live(auth, org);
      const role = revoke ? target.role : choice(input.role, nonOwner);
      if ((revoke && target.revokedAt !== null) || (!revoke && target.revokedAt === null && target.role === role)) return memberAck(target, org.revision, true);
      if (!revoke && target.revokedAt !== null) fail(404, 'not_found');
      await preserveOwner(tx, org, target);
      const nextMember = freeze({ ...target, role, revokedAt: revoke ? live(auth, org) : null });
      const next = await commit(tx, auth, org, revoke ? 'membership.revoke' : 'membership.role', { userId, role }, { effect: async () => {
        if (await call(tx, 'writeMembership', nextMember) !== true) fail(503, 'membership_failed');
      } });
      return memberAck(nextMember, next.revision, false);
    });
  }
  return Object.freeze({
    createInvite(context, value) {
      return run(context, true, async (tx, auth) => {
        const input = record(value, ['orgId', 'expectedRevision', 'inviteId', 'email', 'role']);
        const { org } = await owner(tx, auth, input);
        const intent = { id: id(input.inviteId), orgId: org.id, email: email(input.email), role: choice(input.role, nonOwner), invitedBy: auth.principal.userId };
        const requestHash = inviteHash(intent), old = await call(tx, 'readInvite', intent.id), at = live(auth, org);
        if (old !== null) {
          const row = inviteRow(old, intent.id); history(row, org);
          if (row.requestHash !== requestHash) fail(409, 'request_conflict');
          return freeze({ ack: inviteAck(row, org.revision, true, at), delivery: null });
        }
        const secret = newToken(), row = freeze({ ...intent, requestHash, tokenHash: secret.tokenHash, createdAt: at,
          expiresAt: time(new Date(Date.parse(at) + week).toISOString()), revokedAt: null, acceptedBy: null, acceptedAt: null, acceptedRevision: null });
        const next = await commit(tx, auth, org, 'invite.create', { inviteId: row.id, role: row.role, recipientHash: hash(row.email) }, { effect: async () => {
          if (await call(tx, 'insertInvite', row) !== true) fail(409, 'request_conflict');
        } });
        return freeze({ ack: inviteAck(row, next.revision, false, at), delivery: { delivery: 'unbound', inviteId: row.id, email: row.email, token: secret.token } });
      });
    },
    acceptInvite(context, value) {
      return run(context, true, async (tx, auth) => {
        const input = record(value, ['inviteId', 'token']), row = inviteRow(await call(tx, 'readInvite', id(input.inviteId)), input.inviteId);
        checkToken(input.token, row.tokenHash); if (row.email !== auth.principal.email) fail(404, 'not_found');
        const { org } = await loadOrganization(tx, auth, row.orgId, false); history(row, org);
        if (row.acceptedBy !== null) {
          if (row.acceptedBy !== auth.principal.userId) fail(404, 'not_found');
          return inviteAck(row, row.acceptedRevision, true, live(auth, org));
        }
        const issuer = activeMembership(await call(tx, 'readMembership', org.id, row.invitedBy), org.id, row.invitedBy);
        if (issuer.role !== 'owner') fail(403, 'forbidden');
        const member = membershipRow(await call(tx, 'readMembership', org.id, auth.principal.userId)), at = live(auth, org);
        if (row.revokedAt !== null || row.expiresAt <= at) fail(409, 'invite_inactive');
        if (member && (member.orgId !== org.id || member.userId !== auth.principal.userId)) fail(503, 'store_invalid');
        if (member && member.revokedAt === null && member.role !== row.role) fail(409, 'membership_conflict');
        if (member && member.revokedAt !== null && row.createdAt <= member.revokedAt) fail(409, 'invite_predates_revocation');
        const acceptedRow = freeze({ ...row, acceptedBy: auth.principal.userId, acceptedAt: at, acceptedRevision: org.revision + 1 });
        const nextMember = freeze({ orgId: org.id, userId: auth.principal.userId, role: row.role, revokedAt: null });
        await commit(tx, auth, org, 'invite.accept', { inviteId: row.id, role: row.role, invitedBy: row.invitedBy }, { effect: async () => {
          if (row.expiresAt <= live(auth, org)) fail(409, 'invite_inactive');
          if ((!member || member.revokedAt !== null) && await call(tx, 'writeMembership', nextMember) !== true) fail(503, 'membership_failed');
          if (await call(tx, 'writeInvite', acceptedRow) !== true) fail(503, 'invite_failed');
        } });
        return inviteAck(acceptedRow, acceptedRow.acceptedRevision, false, at);
      });
    },
    revokeInvite(context, value) {
      return run(context, true, async (tx, auth) => {
        const input = record(value, ['orgId', 'expectedRevision', 'inviteId']), { org } = await owner(tx, auth, input);
        const row = inviteRow(await call(tx, 'readInvite', id(input.inviteId)), input.inviteId); history(row, org);
        if (row.acceptedBy !== null) fail(409, 'invite_used');
        const at = live(auth, org); if (row.revokedAt !== null) return inviteAck(row, org.revision, true, at);
        const nextRow = freeze({ ...row, revokedAt: at });
        const next = await commit(tx, auth, org, 'invite.revoke', { inviteId: row.id }, { effect: async () => {
          if (await call(tx, 'writeInvite', nextRow) !== true) fail(503, 'invite_failed');
        } });
        return inviteAck(nextRow, next.revision, false, at);
      });
    },
    changeMemberRole: (context, value) => memberChange(context, value, false),
    revokeMember: (context, value) => memberChange(context, value, true),
    requestOwnerTransfer(context, value) {
      return run(context, true, async (tx, auth) => {
        const input = record(value, ['orgId', 'expectedRevision', 'transferId', 'toUserId']), { org } = await owner(tx, auth, input);
        const toUserId = id(input.toUserId); if (toUserId === auth.principal.userId) fail(409, 'transfer_self');
        activeMembership(await call(tx, 'readMembership', org.id, toUserId), org.id, toUserId);
        const at = live(auth, org); freshAuthentication(auth.session, at);
        const expiresAt = time(new Date(Date.parse(auth.session.authenticatedAt) + freshness).toISOString());
        if (expiresAt <= at) fail(401, 'fresh_auth_required');
        const intent = { id: id(input.transferId), orgId: org.id, fromUserId: auth.principal.userId, toUserId,
          fromSessionHash: auth.principal.handleHash, fromSupabaseSessionId: auth.principal.supabaseSessionId, fromAuthenticatedAt: auth.session.authenticatedAt };
        const requestHash = transferHash(intent), old = await call(tx, 'readTransfer', intent.id);
        if (old !== null) {
          const row = transferRow(old, intent.id); history(row, org); if (row.requestHash !== requestHash) fail(409, 'request_conflict');
          const checkedAt = live(auth, org); freshAuthentication(auth.session, checkedAt);
          if (row.expiresAt <= checkedAt) fail(401, 'fresh_auth_required');
          return transferAck(row, org.revision, true);
        }
        const row = freeze({ ...intent, requestHash, createdAt: at, expiresAt, acceptedBy: null, acceptedAt: null, acceptedRevision: null });
        const next = await commit(tx, auth, org, 'ownership.request', { transferId: row.id, toUserId }, { effect: async () => {
          if (row.expiresAt <= live(auth, org)) fail(401, 'fresh_auth_required');
          if (await call(tx, 'insertTransfer', row) !== true) fail(409, 'request_conflict');
        } });
        return transferAck(row, next.revision, false);
      });
    },
    acceptOwnerTransfer(context, value) {
      return run(context, true, async (tx, auth) => {
        const input = record(value, ['orgId', 'expectedRevision', 'transferId']);
        const { org, membership } = await loadOrganization(tx, auth, id(input.orgId)); expected(org, input);
        const row = transferRow(await call(tx, 'readTransfer', id(input.transferId)), input.transferId); history(row, org); live(auth, org);
        if (row.toUserId !== auth.principal.userId) fail(404, 'not_found');
        if (row.acceptedBy !== null) return transferAck(row, row.acceptedRevision, true);
        const issuer = activeMembership(await call(tx, 'readMembership', org.id, row.fromUserId), org.id, row.fromUserId);
        if (issuer.role !== 'owner') fail(403, 'forbidden');
        const issuerSession = sessionRow(await call(tx, 'readSession', row.fromSessionHash));
        const issuerPrincipal = { userId: row.fromUserId, handleHash: row.fromSessionHash, supabaseSessionId: row.fromSupabaseSessionId };
        const at = live(auth, org); currentSession(issuerPrincipal, issuerSession, at); freshAuthentication(issuerSession, at);
        if (issuerSession.authenticatedAt !== row.fromAuthenticatedAt || row.expiresAt <= at) fail(409, 'transfer_inactive');
        const acceptedRow = freeze({ ...row, acceptedBy: auth.principal.userId, acceptedAt: at, acceptedRevision: org.revision + 1 });
        await commit(tx, auth, org, 'ownership.accept', { transferId: row.id, fromUserId: row.fromUserId }, { effect: async () => {
          const checkedAt = live(auth, org); currentSession(issuerPrincipal, issuerSession, checkedAt); freshAuthentication(issuerSession, checkedAt);
          if (row.expiresAt <= checkedAt) fail(409, 'transfer_inactive');
          if (await call(tx, 'writeMembership', freeze({ ...membership, role: 'owner' })) !== true
            || await call(tx, 'writeMembership', freeze({ ...issuer, role: 'administrator' })) !== true) fail(503, 'membership_failed');
          if (await call(tx, 'writeTransfer', acceptedRow) !== true) fail(503, 'transfer_failed');
        } });
        return transferAck(acceptedRow, acceptedRow.acceptedRevision, false);
      });
    },
  });
}
