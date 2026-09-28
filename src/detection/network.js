// IP and MAC addresses.

import { Collector, before } from "./util.js";

const IPV4 = /(?<![\w.:-])((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})(?![\w-]|\.\d)(\/\d{1,2})?/g;
const IPV6_CANDIDATE = /(?<![\w:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])/g;
const MAC = /(?<![\w:-])(?:[0-9A-Fa-f]{2}([:-]))(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}(?![\w:-])/g;

/**
 * @param {string} text
 * @returns {import("./util.js").Candidate[]}
 */
export function detectNetwork(text) {
  const out = new Collector(text);

  for (const match of text.matchAll(IPV4)) {
    const ip = match[1];
    const index = /** @type {number} */ (match.index);
    if (match[2] || isNonIdentifyingIpv4(ip) || /\b(?:v|version|ver\.?)\s*$/i.test(before(text, index, 10))) {
      continue;
    }
    out.add(index, index + ip.length, "IP_ADDRESS", "network");
  }

  for (const match of text.matchAll(IPV6_CANDIDATE)) {
    const value = match[0];
    if (isIpv6(value) && !/^::1?$/.test(value)) {
      const index = /** @type {number} */ (match.index);
      out.add(index, index + value.length, "IPV6_ADDRESS", "network");
    }
  }

  for (const match of text.matchAll(MAC)) {
    const index = /** @type {number} */ (match.index);
    const hasHexLetter = /[a-f]/i.test(match[0]);
    if (hasHexLetter || /mac|ether|hwaddr|bssid|hardware|adapter|nic\b/.test(before(text, index, 40))) {
      out.add(index, index + match[0].length, "MAC_ADDRESS", "network");
    }
  }

  collectInternalUrls(text, out);
  return out.items;
}

// Subdomain labels and private TLDs that mark a host as internal.
const INTERNAL_LABEL = /^(?:corp|internal|intranet|intra|staging|stage|stg|preprod|uat|qa|dev|admin|vpn|private|priv|lan|ops|backoffice|jenkins|grafana|kibana|vault)$/;
const INTERNAL_TLD = /\.(?:local|internal|corp|lan|intranet|home|localdomain)$/;

/**
 * URLs of private infrastructure (wiki.corp.example.io, jenkins.internal).
 * Public URLs are only redacted when the optional URL category is on.
 * @param {string} text
 * @param {Collector} out
 */
function collectInternalUrls(text, out) {
  for (const match of text.matchAll(/\bhttps?:\/\/([^\s/:?#<>"'`]+)[^\s<>"'`]*/gi)) {
    const host = match[1].toLowerCase().replace(/^[^@]*@/, "");
    const labels = host.split(".");
    // Only subdomains count: "dev.to" is a public site, "api.dev.example.com" is not.
    const subdomains = labels.slice(0, -2);
    if (INTERNAL_TLD.test(host) || subdomains.some((label) => INTERNAL_LABEL.test(label))) {
      const index = /** @type {number} */ (match.index);
      const url = match[0].replace(/[.,;:!?)\]}]+$/, "");
      out.add(index, index + url.length, "INTERNAL_URL", "network", "medium");
    }
  }
}

/**
 * Addresses that say nothing about real infrastructure.
 * @param {string} ip
 */
function isNonIdentifyingIpv4(ip) {
  const [a, b, , d] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 127 ||
    a === 255 ||
    (a === 255 && b === 255) ||
    ip === "1.1.1.1" ||
    ip === "8.8.8.8" ||
    ip === "8.8.4.4" ||
    // Network and broadcast addresses: 10.0.0.0, 192.168.1.255.
    d === 0 ||
    d === 255
  );
}

/**
 * Strict IPv6 check. Rejects clock times and ratios such as 10:14:22.
 * @param {string} value
 */
function isIpv6(value) {
  const doubleColons = value.split("::").length - 1;
  if (doubleColons > 1) {
    return false;
  }
  const groups = value.split(":").filter((group) => group !== "");
  if (groups.some((group) => !/^[0-9A-Fa-f]{1,4}$/.test(group))) {
    return false;
  }
  if (doubleColons === 0 && groups.length !== 8) {
    return false;
  }
  if (doubleColons === 1 && (groups.length > 7 || groups.length < 2)) {
    return false;
  }
  // Must contain a hex letter or a 3-4 digit group; all short decimal groups
  // look like times or scores.
  return groups.some((group) => /[a-f]/i.test(group) || group.length >= 3);
}
