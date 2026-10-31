import { createHash } from 'node:crypto';

export class PolicyError extends Error {
  constructor(status, code) { super(`business_claw_server_${code}`); this.name = 'PolicyError'; this.status = status; this.code = code; }
}
export const fail = (status, code) => { throw new PolicyError(status, code); };
const own = (value, key) => Object.hasOwn(value, key);
export function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(400, 'record_invalid');
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !fields.includes(key) || !field.enumerable || !own(field, 'value')) fail(400, 'field_invalid');
  }
  for (const key of fields) if (!own(value, key)) fail(400, 'field_invalid');
  return value;
}
export function text(value, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !value.trim() || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) fail(400, 'text_invalid');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(400, 'text_invalid'); }
    else if (code >= 0xdc00 && code <= 0xdfff) fail(400, 'text_invalid');
  }
  return value;
}
export function id(value) { if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value)) fail(400, 'identity_invalid'); return value; }
export function revision(value, minimum = 0) { if (!Number.isSafeInteger(value) || value < minimum || value > 1_000_000) fail(400, 'revision_invalid'); return value; }
export function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail(400, 'timestamp_invalid');
  const date = new Date(value); if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail(400, 'timestamp_invalid'); return value;
}
export const nullableTime = value => value === null ? null : time(value);
export function choice(value, values) { if (!values.includes(value)) fail(400, 'field_invalid'); return value; }
export function digest(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(400, 'hash_invalid'); return value; }
export const hash = value => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
export function email(value) {
  const result = text(value, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result)) fail(400, 'email_invalid');
  return result.toLowerCase();
}
export function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
export function port(value, name) { if (!value || typeof value[name] !== 'function') fail(503, 'ports_unbound'); return value[name].bind(value); }
export const call = (value, name, ...args) => port(value, name)(...args);
export function rows(value, maximum = 1000) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail(503, 'store_invalid');
  for (const key of Reflect.ownKeys(value)) if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail(503, 'store_invalid');
  const result = [];
  for (let index = 0; index < value.length; index++) { const item = Object.getOwnPropertyDescriptor(value, String(index)); if (!item || !own(item, 'value') || !item.enumerable) fail(503, 'store_invalid'); result.push(item.value); }
  return result;
}
