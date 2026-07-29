import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch } from 'undici';

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

// Deny every non-public address range that can route to the build host,
// infrastructure metadata, or another non-Internet destination. Documentation
// and other reserved ranges are denied too: allowing only globally routable
// unicast addresses is safer than trying to predict how a CI network routes
// special-purpose space.
const NON_PUBLIC_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC_ADDRESSES.check(address, 'ipv4');
  if (family === 6) return !NON_PUBLIC_ADDRESSES.check(address, 'ipv6');
  return false;
}

function isLocalHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.home.arpa')
  );
}

function privateAddressError(hostname, address) {
  const err = new Error(`hostname resolves to a non-public address: ${hostname} (${address})`);
  err.code = 'ERR_NON_PUBLIC_ADDRESS';
  return err;
}

export function parsePublicHttpUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error('URL credentials are not allowed');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname || isLocalHostname(hostname)) {
    throw new Error(`local hostname is not allowed: ${hostname || '<empty>'}`);
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw privateAddressError(hostname, hostname);
  }
  return url;
}

// Exported for the dependency-free regression check. The same validation is
// applied inside Undici's connection-time DNS callback below, so the addresses
// that pass the check are exactly the addresses the socket may use.
export function validateResolvedAddresses(hostname, addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error(`hostname did not resolve: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (!isPublicAddress(address)) throw privateAddressError(hostname, address);
  }
  return addresses;
}

function publicLookup(hostname, options, callback) {
  const lookupOptions = { all: true, verbatim: true };
  if (options?.family === 4 || options?.family === 6) {
    lookupOptions.family = options.family;
  }
  if (Number.isInteger(options?.hints) && options.hints !== 0) {
    lookupOptions.hints = options.hints;
  }

  dnsLookup(hostname, lookupOptions, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }
    try {
      const safe = validateResolvedAddresses(hostname, addresses);
      if (options?.all) {
        callback(null, safe);
        return;
      }
      const selected = safe[0];
      callback(null, selected.address, selected.family);
    } catch (validationError) {
      callback(validationError);
    }
  });
}

// DNS validation happens in the lookup callback used by the actual socket.
// This closes the DNS-rebinding/TOCTOU gap created by resolving once and then
// letting fetch perform an unrelated second lookup during connection.
const PUBLIC_HTTP_DISPATCHER = new Agent({
  connect: { lookup: publicLookup },
});

function withoutCrossOriginCredentials(init, from, to) {
  if (from.origin === to.origin) return init;
  const headers = new Headers(init.headers);
  headers.delete('authorization');
  headers.delete('cookie');
  headers.delete('proxy-authorization');
  return { ...init, headers };
}

export async function fetchPublicHttp(value, init = {}) {
  let current = parsePublicHttpUrl(value);
  let requestInit = init;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response;
    try {
      response = await fetch(current, {
        ...requestInit,
        redirect: 'manual',
        dispatcher: PUBLIC_HTTP_DISPATCHER,
      });
    } catch (err) {
      // Undici wraps connection errors in TypeError. Surface the policy error
      // itself so callers and regression tests receive an actionable reason.
      if (err?.cause?.code === 'ERR_NON_PUBLIC_ADDRESS') throw err.cause;
      throw err;
    }
    const location = response.headers.get('location');
    if (!REDIRECT_STATUS.has(response.status) || !location) return response;

    try {
      await response.body?.cancel();
    } catch {
      // The next request does not depend on draining a failed redirect body.
    }
    if (redirectCount === MAX_REDIRECTS) {
      throw new Error(`too many redirects while fetching ${value}`);
    }
    const next = parsePublicHttpUrl(new URL(location, current).toString());
    requestInit = withoutCrossOriginCredentials(requestInit, current, next);
    current = next;
  }
  throw new Error(`too many redirects while fetching ${value}`);
}
