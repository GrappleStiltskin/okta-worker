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
    const modifiedRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body
    });

    let response = await fetch(modifiedRequest);
    
    // Only rewrite HTML content, not assets
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("text/html")) {
        response = await rewriteResponse(response, effectivePrefix);
    }

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
    if (!targetHost) {
        throw new Error(`No target host found for prefix: ${effectivePrefix}`);
    }
    
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
    const originalText = await response.text();
    
    // Only rewrite URLs that actually need to go through the worker
    // Focus on form actions, redirects, and navigation - not assets
    const rewrittenText = originalText.replace(
        /https:\/\/(okta|cdn|login)\.applogin-thrivent\.com(\/[^"\s'<>]*)?/g,
        (match, subdomain, path = "") => {
            // Only rewrite if it's a navigation URL, not an asset
            if (path.includes('/assets/') || 
                path.includes('.js') || 
                path.includes('.css') || 
                path.includes('.png') || 
                path.includes('.jpg') || 
                path.includes('.gif') ||
                path.includes('.woff') ||
                path.includes('.svg')) {
                return match; // Don't rewrite asset URLs
            }
            return `https://${WORKER_HOST}/${subdomain}${path}`;
        }
    );
    
    const newHeaders = new Headers(response.headers);
    newHeaders.delete("Content-Length");
    
    return new Response(rewrittenText, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}
