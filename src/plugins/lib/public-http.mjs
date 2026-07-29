import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    return isIP(mappedIpv4) !== 4 || isPrivateIpv4(mappedIpv4);
  }
  return (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff')
  );
}

function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
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
  if (isIP(hostname) && isPrivateAddress(hostname)) {
    throw new Error(`private IP address is not allowed: ${hostname}`);
  }
  return url;
}

async function resolvePublicHttpUrl(value) {
  const url = parsePublicHttpUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) return url;

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0
    || addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error(`hostname resolves to a private address: ${hostname}`);
  }
  return url;
}

export async function fetchPublicHttp(value, init = {}) {
  let current = await resolvePublicHttpUrl(value);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, { ...init, redirect: 'manual' });
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
    current = await resolvePublicHttpUrl(new URL(location, current).toString());
  }
  throw new Error(`too many redirects while fetching ${value}`);
}
