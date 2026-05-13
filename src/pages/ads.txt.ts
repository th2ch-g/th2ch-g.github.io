import type { APIRoute } from 'astro';
import { getProfileMeta } from '@/lib/content';

// `/ads.txt` ownership/authorisation file required by Google AdSense
// (and the wider IAB ads.txt standard). When no AdSense `clientId` is
// set in profile.yaml the file ships with only a comment line — which
// is a valid empty ads.txt: zero publisher records means "no ad system
// is authorised here", i.e. this site shows no third-party ads. Astro's
// static-API-routes are always built, so we can't skip the file
// outright; serving a benign comment is the cleanest substitute.
// `lang` is irrelevant for integration config; the JA flatten is reused.
//
// Format: <ad-system-domain>, <publisher-id>, <relationship>, <cert-id>
// Reference: https://iabtechlab.com/ads-txt/
export const GET: APIRoute = async () => {
  const adsense = (await getProfileMeta('ja')).integrations.adsense;
  const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
  if (!adsense?.clientId) {
    return new Response(
      '# No advertising system is authorised on this site.\n'
      + '# See https://iabtechlab.com/ads-txt/ for the spec.\n',
      { headers },
    );
  }
  // AdSense's ads.txt entry uses the publisher ID without the `ca-`
  // prefix; the certification authority ID is Google's fixed value.
  const pubId = adsense.clientId.replace(/^ca-/, '');
  return new Response(
    `google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`,
    { headers },
  );
};
