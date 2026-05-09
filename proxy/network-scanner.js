const { execFile } = require("child_process");
const net = require("net");

const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
];

const SCAN_PROFILES = {
  ping: ["-sn"],
  quick: ["-T3", "-F"],
  service: ["-sV", "--version-light", "-T3", "-F"],
};

const NMAP_CANDIDATES = [
  process.env.NMAP_PATH,
  "nmap",
  "C:\\Program Files (x86)\\Nmap\\nmap.exe",
  "C:\\Program Files\\Nmap\\nmap.exe",
].filter(Boolean);

function normalizeTarget(target) {
  return String(target || "").trim();
}

function isPrivateIpv4(ip) {
  return PRIVATE_IPV4_RANGES.some((range) => range.test(ip));
}

function getBaseAddress(target) {
  return target.split("/")[0];
}

function isAllowedTarget(target) {
  if (!target || target.length > 253) return false;
  if (target === "localhost") return true;

  const baseAddress = getBaseAddress(target);
  const cidrMatch = target.match(/^(.+)\/(\d{1,2})$/);
  if (cidrMatch) {
    const prefix = Number(cidrMatch[2]);
    if (prefix < 24 || prefix > 32) return false;
  }

  if (net.isIP(baseAddress) === 4) {
    return isPrivateIpv4(baseAddress) || process.env.NMAP_ALLOW_PUBLIC === "true";
  }

  if (net.isIP(baseAddress) === 6) {
    return baseAddress === "::1" || process.env.NMAP_ALLOW_PUBLIC === "true";
  }

  return /^[a-zA-Z0-9.-]+$/.test(target) && process.env.NMAP_ALLOW_PUBLIC === "true";
}

function textFromXml(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readAttrs(tag) {
  const attrs = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(tag)) !== null) {
    attrs[match[1]] = textFromXml(match[2]);
  }
  return attrs;
}

function parseNmapXml(xml) {
  const hosts = [];
  const hostRegex = /<host\b[\s\S]*?<\/host>/g;
  let hostMatch;

  while ((hostMatch = hostRegex.exec(xml)) !== null) {
    const hostXml = hostMatch[0];
    const statusTag = hostXml.match(/<status\b[^>]*>/);
    const addressTag = hostXml.match(/<address\b[^>]*addr="[^"]+"[^>]*>/);
    const hostnameTag = hostXml.match(/<hostname\b[^>]*name="[^"]+"[^>]*>/);
    const host = {
      address: addressTag ? readAttrs(addressTag[0]).addr : "unknown",
      hostname: hostnameTag ? readAttrs(hostnameTag[0]).name : "",
      status: statusTag ? readAttrs(statusTag[0]).state : "unknown",
      ports: [],
    };

    const portRegex = /<port\b[^>]*>[\s\S]*?<\/port>/g;
    let portMatch;
    while ((portMatch = portRegex.exec(hostXml)) !== null) {
      const portXml = portMatch[0];
      const portTag = portXml.match(/<port\b[^>]*>/);
      const stateTag = portXml.match(/<state\b[^>]*>/);
      const serviceTag = portXml.match(/<service\b[^>]*>/);
      const portAttrs = portTag ? readAttrs(portTag[0]) : {};
      const stateAttrs = stateTag ? readAttrs(stateTag[0]) : {};
      const serviceAttrs = serviceTag ? readAttrs(serviceTag[0]) : {};

      host.ports.push({
        port: portAttrs.portid || "",
        protocol: portAttrs.protocol || "",
        state: stateAttrs.state || "unknown",
        service: serviceAttrs.name || "",
        product: serviceAttrs.product || "",
        version: serviceAttrs.version || "",
      });
    }

    hosts.push(host);
  }

  return hosts;
}

function scanNetwork({ target, profile }) {
  const normalizedTarget = normalizeTarget(target);
  const selectedProfile = SCAN_PROFILES[profile] ? profile : "quick";

  if (!isAllowedTarget(normalizedTarget)) {
    const err = new Error(
      "Target must be localhost or a private IPv4/CIDR range. Set NMAP_ALLOW_PUBLIC=true to permit public targets."
    );
    err.statusCode = 400;
    throw err;
  }

  const args = [...SCAN_PROFILES[selectedProfile], "-oX", "-", normalizedTarget];

  return new Promise((resolve, reject) => {
    const tryRun = (index) => {
      const command = NMAP_CANDIDATES[index];

      execFile(command, args, { timeout: 60000, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
        if (error?.code === "ENOENT" && index < NMAP_CANDIDATES.length - 1) {
          tryRun(index + 1);
          return;
        }

      if (error) {
        const err = new Error(
          error.code === "ENOENT"
            ? "Nmap is not installed or not available in PATH. Set NMAP_PATH to the full nmap.exe path if it is installed elsewhere."
            : stderr || error.message
        );
        err.statusCode = error.code === "ENOENT" ? 503 : 500;
        reject(err);
        return;
      }

      resolve({
        target: normalizedTarget,
        profile: selectedProfile,
        scannedAt: new Date().toISOString(),
        hosts: parseNmapXml(stdout),
      });
    });
    };

    tryRun(0);
  });
}

module.exports = { scanNetwork };
