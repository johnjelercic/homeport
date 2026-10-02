#!/usr/bin/env python3
"""Homeport Wi-Fi setup: a temporary hotspot + setup page for joining home Wi-Fi.

Runs as homeport-wifi-setup.service (installed by install.sh). Behaviour:

  * Boot: if Ethernet or a saved Wi-Fi network connects within BOOT_GRACE
    seconds, do nothing.
  * Otherwise (or if the network is lost for LOST_GRACE seconds later on),
    scan for nearby networks, then broadcast an open "Homeport-Setup-XXXX"
    network. Phones that join get a captive-portal page listing the networks.
  * The customer picks their network and enters the password. The hotspot
    shuts down and the Pi joins that network. If that fails, the hotspot
    comes back with an error message so they can try again.
  * While in setup mode it periodically retries saved networks (e.g. the
    router was just rebooting), and leaves setup mode as soon as Ethernet
    or Wi-Fi comes back.

Uses NetworkManager (nmcli) for all networking. Python standard library only.
Settings: /etc/homeport/wifi-setup.conf (KEY=value lines, all optional).

Test mode (for development, over an SSH session on Ethernet):
    sudo python3 /usr/local/lib/homeport/wifi-setup.py --test
Pauses the service, starts the hotspot right away while ignoring Ethernet,
and exits (restarting the service) once the Pi joins a Wi-Fi network or on Ctrl+C.
"""

import html
import os
import queue
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

CONF_FILE = "/etc/homeport/wifi-setup.conf"
AP_CON = "homeport-setup"

DEFAULTS = {
    "IFACE": "",                # Wi-Fi adapter; empty = automatic (wlan0, else first found)
    "SSID_PREFIX": "Homeport-Setup",
    "AP_PASSWORD": "",          # empty = open setup network
    "AP_ADDR": "10.42.0.1",
    "BOOT_GRACE": "90",         # seconds to wait for a network at boot
    "LOST_GRACE": "120",        # seconds offline before re-entering setup
    "RETRY_SAVED_EVERY": "300", # seconds between retries of saved networks in setup mode
    "HOMEPORT_PORT": "19156",
}


def log(msg):
    print(msg, flush=True)


def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(CONF_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    cfg[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return cfg


CFG = load_config()
TEST_MODE = "--test" in sys.argv[1:]
IFACE = None  # chosen at startup by find_wifi_iface()
AP_ADDR = CFG["AP_ADDR"]


# ------------------------------------------------------------------ nmcli helpers

def sh(args, timeout=60):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, "", "timed out")


def split_terse(line):
    """Split one line of `nmcli -t` output; fields escape ':' and '\\' with '\\'."""
    fields, cur, i = [], [], 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            cur.append(line[i + 1])
            i += 2
            continue
        if c == ":":
            fields.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    fields.append("".join(cur))
    return fields


def is_physical(dev):
    """Real network hardware has a /sys/class/net/<dev>/device link. Docker's
    veth links and bridges also report as "ethernet"/"connected", so they
    must not count as being online."""
    return os.path.exists(f"/sys/class/net/{dev}/device")


def find_wifi_iface():
    """The Wi-Fi adapter to use: IFACE from the config if set, otherwise the
    first real (physical) Wi-Fi adapter NetworkManager knows about, preferring
    wlan0 (the Pi's built-in Wi-Fi). None if there isn't one."""
    if CFG["IFACE"]:
        return CFG["IFACE"]
    r = sh(["nmcli", "-t", "-f", "DEVICE,TYPE", "device"])
    found = []
    for line in r.stdout.splitlines():
        f = split_terse(line)
        if len(f) >= 2 and f[1] == "wifi" and is_physical(f[0]):
            found.append(f[0])
    if "wlan0" in found:
        return "wlan0"
    return found[0] if found else None


def ensure_radio_on():
    """Make sure Wi-Fi is switched on. It can be off in two places: the kernel's
    rfkill soft block, and NetworkManager's own (saved) Wi-Fi switch. Both
    were found off on the first boot of a card flashed from a sealed image.
    Either one alone stops scanning and the hotspot ("Found 0 networks",
    "No suitable device found"), so switch both on regardless of the cause."""
    r = sh(["nmcli", "radio", "wifi"])
    if r.stdout.strip() != "enabled":
        log("Wi-Fi was switched off; switching it on")
    sh(["rfkill", "unblock", "wifi"])
    sh(["nmcli", "radio", "wifi", "on"])
    time.sleep(2)  # give the adapter a moment to become available


def wait_for_wifi_iface():
    """Set IFACE, waiting (and checking once a minute) if no adapter exists yet."""
    global IFACE
    warned = False
    while True:
        IFACE = find_wifi_iface()
        if IFACE:
            log(f"Using Wi-Fi adapter {IFACE}")
            return
        if not warned:
            log("No Wi-Fi adapter found; checking again every minute")
            warned = True
        time.sleep(60)


def online():
    """True if a physical Ethernet port or the Wi-Fi is connected (not via the setup hotspot)."""
    r = sh(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"])
    for line in r.stdout.splitlines():
        f = split_terse(line)
        if len(f) < 4:
            continue
        dev, typ, state, con = f[:4]
        if typ not in ("ethernet", "wifi") or not state.startswith("connected") or con == AP_CON:
            continue
        if TEST_MODE and typ == "ethernet":
            continue  # test mode: pretend the cable isn't there
        if is_physical(dev):
            return True
    return False


def wifi_profiles():
    """Names of saved Wi-Fi connection profiles (excluding the setup hotspot)."""
    r = sh(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"])
    names = []
    for line in r.stdout.splitlines():
        f = split_terse(line)
        if len(f) >= 2 and f[1] == "802-11-wireless" and f[0] != AP_CON:
            names.append(f[0])
    return names


def scan():
    """Nearby networks as [{ssid, signal, secure, security}], strongest first, de-duplicated."""
    sh(["nmcli", "device", "wifi", "rescan", "ifname", IFACE], timeout=20)
    time.sleep(4)
    return list_networks()


def list_networks():
    """Networks from NetworkManager's current scan results (no new scan)."""
    r = sh(["nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list", "ifname", IFACE])
    best = {}
    for line in r.stdout.splitlines():
        f = split_terse(line)
        if len(f) < 3 or not f[0]:
            continue
        ssid, sec = f[0], f[2]
        try:
            signal = int(f[1])
        except ValueError:
            signal = 0
        if ssid not in best or signal > best[ssid]["signal"]:
            best[ssid] = {"ssid": ssid, "signal": signal, "secure": sec not in ("", "--"),
                          "security": sec}
    return sorted(best.values(), key=lambda n: -n["signal"])


def setup_ssid():
    try:
        with open(f"/sys/class/net/{IFACE}/address") as f:
            suffix = f.read().strip().replace(":", "")[-4:].upper()
    except OSError:
        suffix = "0000"
    return f"{CFG['SSID_PREFIX']}-{suffix}"


def start_ap():
    sh(["nmcli", "connection", "delete", AP_CON])
    args = [
        "nmcli", "connection", "add", "type", "wifi", "ifname", IFACE,
        "con-name", AP_CON, "autoconnect", "no", "ssid", setup_ssid(),
        "802-11-wireless.mode", "ap", "802-11-wireless.band", "bg",
        "ipv4.method", "shared", "ipv4.addresses", f"{AP_ADDR}/24",
        "ipv6.method", "disabled",
    ]
    if CFG["AP_PASSWORD"]:
        args += ["wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", CFG["AP_PASSWORD"]]
    r = sh(args)
    if r.returncode != 0:
        log(f"Could not create hotspot profile: {r.stderr.strip()}")
        return False
    r = sh(["nmcli", "connection", "up", AP_CON], timeout=45)
    if r.returncode != 0:
        log(f"Could not start hotspot: {r.stderr.strip()}")
        return False
    log(f"Hotspot '{setup_ssid()}' up at {AP_ADDR}")
    return True


def stop_ap():
    sh(["nmcli", "connection", "down", AP_CON], timeout=20)
    sh(["nmcli", "connection", "delete", AP_CON], timeout=20)


def wait_online(seconds):
    end = time.time() + seconds
    while time.time() < end:
        if online():
            return True
        time.sleep(2)
    return online()


def wait_until_visible(ssid, seconds=20):
    """Right after the hotspot closes, NetworkManager's scan list is often empty
    (the radio was busy being the hotspot). Rescan until the network shows up,
    so NetworkManager knows its security type. Returns the network or None."""
    end = time.time() + seconds
    while time.time() < end:
        sh(["nmcli", "device", "wifi", "rescan", "ifname", IFACE], timeout=20)
        time.sleep(3)
        for n in list_networks():
            if n["ssid"] == ssid:
                return n
    return None


def key_mgmt_for(net, password):
    """NetworkManager key-mgmt value for a network from the scan's SECURITY field."""
    if not password:
        return None  # open network
    sec = (net or {}).get("security", "")
    if "WPA3" in sec and "WPA2" not in sec and "WPA1" not in sec:
        return "sae"  # WPA3-only
    return "wpa-psk"  # WPA2, WPA1/WPA2, WPA2/WPA3 transition, or unknown (hidden)


def saved_profiles_for(ssid):
    """Saved Wi-Fi profiles for this network name (excluding the setup hotspot)."""
    names = []
    for name in wifi_profiles():
        r = sh(["nmcli", "-g", "802-11-wireless.ssid", "connection", "show", name])
        if r.stdout.strip() == ssid or name in (ssid, f"{ssid} (Homeport)"):
            names.append(name)
    return names


def try_join(ssid, password, hidden, known=None):
    """Join a network with the hotspot already stopped. Returns (ok, message).
    `known` is the network as seen in the setup page's scan, if it was listed."""
    # What's entered on the setup page replaces any saved copy of this network
    # (e.g. after the router's password changed). Joining with a password while
    # an old profile for the same network exists fails in NetworkManager with
    # "802-11-wireless-security.key-mgmt: property is missing".
    for name in saved_profiles_for(ssid):
        log(f"Replacing saved network '{name}'")
        sh(["nmcli", "connection", "delete", name])
    before = set(wifi_profiles())
    net = None if hidden else wait_until_visible(ssid)
    args = ["nmcli", "--wait", "45", "device", "wifi", "connect", ssid, "ifname", IFACE]
    if password:
        args += ["password", password]
    if hidden:
        args += ["hidden", "yes"]
    r = sh(args, timeout=70)
    err = (r.stderr or r.stdout).strip()
    if r.returncode != 0 and ("key-mgmt" in err or "property is missing" in err):
        # NetworkManager couldn't tell the security type: set it explicitly,
        # from this scan or the one the setup page showed.
        for name in set(wifi_profiles()) - before:
            sh(["nmcli", "connection", "delete", name])
        name = ssid
        add = ["nmcli", "connection", "add", "type", "wifi", "ifname", IFACE,
               "con-name", name, "ssid", ssid]
        if hidden:
            add += ["802-11-wireless.hidden", "yes"]
        km = key_mgmt_for(net or known, password)
        if km:
            add += ["wifi-sec.key-mgmt", km, "wifi-sec.psk", password]
        log(f"Retrying with an explicit profile ({km or 'open'})")
        r = sh(add)
        if r.returncode == 0:
            r = sh(["nmcli", "--wait", "45", "connection", "up", name], timeout=70)
        err = (r.stderr or r.stdout).strip()
    if r.returncode == 0 and wait_online(20):
        unbind_profile()
        return True, ""
    # Don't leave a broken profile behind (only remove what this attempt created).
    for name in set(wifi_profiles()) - before:
        sh(["nmcli", "connection", "delete", name])
    log(f"Join failed: {err or 'no response'}")
    if "Secrets were required" in err or "password" in err.lower() or "psk" in err.lower():
        return False, f"Couldn't join “{ssid}”. Check the password and try again."
    if "No network with SSID" in err or (not hidden and net is None and known is None):
        return False, f"Couldn't find “{ssid}”. Check the name, or move Homeport closer to the router."
    return False, f"Couldn't join “{ssid}”. Check the password, make sure the router is on, and try again."


def unbind_profile():
    """Let the just-joined network's saved profile work on any Wi-Fi adapter.
    `nmcli device wifi connect ... ifname X` ties the profile to adapter X;
    clearing that means a replaced or USB adapter can still use it. A profile
    is only ever active on one adapter at a time, so this never doubles up."""
    r = sh(["nmcli", "-t", "-f", "GENERAL.CONNECTION", "device", "show", IFACE])
    name = ""
    for line in r.stdout.splitlines():
        f = split_terse(line)
        if len(f) >= 2 and f[0] == "GENERAL.CONNECTION":
            name = ":".join(f[1:])  # rejoin in case a ':' in the name wasn't escaped
    if name and name not in ("--", AP_CON):
        sh(["nmcli", "connection", "modify", name, "connection.interface-name", ""])


def retry_saved():
    """Try each saved Wi-Fi profile briefly. Returns True if one connected."""
    for name in wifi_profiles():
        r = sh(["nmcli", "--wait", "25", "connection", "up", name], timeout=40)
        if r.returncode == 0 and wait_online(10):
            log(f"Reconnected to saved network '{name}'")
            return True
    return False


# ------------------------------------------------------------------ setup page

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Homeport setup</title>
<style>
  :root {{ --bg:#f6f4ef; --card:#fff; --ink:#1d2433; --muted:#6b7280; --accent:#1f6f8b; --err:#b42318; --line:#e5e1d8; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--ink); }}
  main {{ max-width:440px; margin:0 auto; padding:24px 16px 40px; }}
  h1 {{ font-size:1.5rem; margin:0 0 4px; }}
  p.lead {{ color:var(--muted); margin:0 0 20px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:16px; }}
  .err {{ border-color:var(--err); color:var(--err); }}
  label.net {{ display:flex; align-items:center; gap:10px; padding:12px 4px; border-bottom:1px solid var(--line); cursor:pointer; }}
  label.net:last-of-type {{ border-bottom:0; }}
  label.net span.name {{ flex:1; word-break:break-word; }}
  label.net span.meta {{ color:var(--muted); font-size:.85rem; white-space:nowrap; }}
  input[type=text], input[type=password] {{ width:100%; padding:12px; font-size:16px; border:1px solid var(--line); border-radius:10px; margin-top:6px; }}
  .field {{ margin-top:14px; }}
  .small {{ color:var(--muted); font-size:.9rem; }}
  button {{ width:100%; padding:14px; font-size:17px; font-weight:600; color:#fff; background:var(--accent); border:0; border-radius:12px; margin-top:18px; }}
  code {{ font-size:.95rem; }}
</style></head>
<body><main>
<h1>Set up Homeport</h1>
<p class="lead">Choose your home Wi-Fi network so Homeport can connect.</p>
{error}
<form method="post" action="/connect">
<div class="card">
{networks}
<label class="net"><input type="radio" name="ssid" value="__other__" {other_checked}><span class="name">Other network…</span></label>
<div class="field" id="otherbox">
  <input type="text" name="other_ssid" placeholder="Network name (if not listed)" autocapitalize="none" autocorrect="off">
  <label class="small"><input type="checkbox" name="hidden" value="1"> This is a hidden network</label>
</div>
</div>
<div class="card">
  <label for="pw">Wi-Fi password</label>
  <input type="password" id="pw" name="password" autocomplete="off" autocapitalize="none" autocorrect="off">
  <label class="small"><input type="checkbox" onclick="pw.type=this.checked?'text':'password'"> Show password</label>
</div>
<button type="submit">Connect</button>
</form>
<p class="small">If your phone or computer shows a <b>Cancel</b> button on this window, don't
tap it: that disconnects from {setup}. Tap <b>Connect</b> above instead.</p>
<p class="small">After connecting, reconnect your phone to your home Wi-Fi and open
<code>http://{host}.local:{port}</code></p>
</main></body></html>"""

DONE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connecting…</title>
<style>
  body {{ margin:0; font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#f6f4ef; color:#1d2433; }}
  main {{ max-width:440px; margin:0 auto; padding:24px 16px; }}
  .card {{ background:#fff; border:1px solid #e5e1d8; border-radius:14px; padding:16px; margin:16px 0; }}
  code {{ font-size:1rem; }}
</style></head>
<body><main>
<h1>Connecting to {ssid}…</h1>
<div class="card">
<p><b>1.</b> Tap <b>Done</b> (or close this window). Homeport is already joining {ssid}.</p>
<p><b>2.</b> Your phone will drop off <b>{setup}</b> in a few seconds. Reconnect it to <b>{ssid}</b>.</p>
<p><b>3.</b> Open <code>http://{host}.local:{port}</code></p>
</div>
<p>If Homeport can't connect, <b>{setup}</b> will appear again in about a minute.
Join it again and this page will tell you what went wrong.</p>
</main></body></html>"""


class Portal:
    """Shared state between the web server and the setup loop."""

    def __init__(self):
        self.networks = []
        self.error = ""
        self.requests = queue.Queue()
        self.last_seen = 0.0
        # Set once Connect is tapped: from then on, phones' "am I online?" checks
        # get the answer they expect, so the OS turns the sign-in window's
        # "Cancel" button into "Done".
        self.submitted = False


PORTAL = Portal()


class Handler(BaseHTTPRequestHandler):
    server_version = "Homeport"

    def log_message(self, fmt, *args):
        pass  # keep the journal quiet; phones probe constantly

    def _send(self, code, body, ctype="text/html; charset=utf-8", headers=None):
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        PORTAL.last_seen = time.time()
        host = (self.headers.get("Host") or "").split(":")[0]
        if PORTAL.submitted and self._answer_connectivity_check(host):
            return
        if self.path.split("?")[0] != "/" or host not in (AP_ADDR, ""):
            # Anything else (incl. phones' captive-portal checks) -> setup page,
            # which makes iOS/Android/macOS pop the page up automatically.
            self._send(302, "", headers={"Location": f"http://{AP_ADDR}/"})
            return
        self._send(200, render_page())

    def _answer_connectivity_check(self, host):
        """After Connect: reply to the OS connectivity checks as if online, so
        the sign-in window offers "Done" instead of "Cancel". True if handled."""
        path = self.path.split("?")[0].lower()
        if path in ("/hotspot-detect.html", "/library/test/success.html") or host.endswith("apple.com"):
            self._send(200, "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>")
        elif path in ("/generate_204", "/gen_204"):
            self._send(204, "")
        elif path == "/connecttest.txt":
            self._send(200, "Microsoft Connect Test", "text/plain")
        elif path == "/ncsi.txt":
            self._send(200, "Microsoft NCSI", "text/plain")
        elif path == "/success.txt":
            self._send(200, "success\n", "text/plain")
        else:
            return False
        return True

    def do_POST(self):
        PORTAL.last_seen = time.time()
        if self.path != "/connect":
            self._send(404, "Not found", "text/plain")
            return
        length = min(int(self.headers.get("Content-Length") or 0), 8192)
        form = parse_qs(self.rfile.read(length).decode("utf-8", "replace"))
        ssid = (form.get("ssid") or [""])[0]
        hidden = bool(form.get("hidden"))
        if ssid == "__other__" or not ssid:
            ssid = (form.get("other_ssid") or [""])[0].strip()
            hidden = hidden or bool(ssid)  # unlisted networks may be hidden
        password = (form.get("password") or [""])[0]
        if not ssid:
            PORTAL.error = "Choose a network, or type its name under “Other network”."
            self._send(303, "", headers={"Location": "/"})
            return
        PORTAL.submitted = True
        self._send(200, DONE.format(
            ssid=html.escape(ssid), setup=html.escape(setup_ssid()),
            host=html.escape(socket.gethostname()), port=CFG["HOMEPORT_PORT"]))
        PORTAL.requests.put((ssid, password, hidden))


def render_page():
    rows = []
    for i, n in enumerate(PORTAL.networks):
        bars = "▂▄▆█"[: max(1, min(4, n["signal"] // 25 + 1))]
        lock = " 🔒" if n["secure"] else ""
        checked = "checked" if i == 0 else ""
        rows.append(
            f'<label class="net"><input type="radio" name="ssid" value="{html.escape(n["ssid"], quote=True)}" {checked}>'
            f'<span class="name">{html.escape(n["ssid"])}</span><span class="meta">{bars}{lock}</span></label>')
    if not rows:
        rows.append('<p class="small">No networks found nearby. Type your network name below.</p>')
    error = f'<div class="card err">{html.escape(PORTAL.error)}</div>' if PORTAL.error else ""
    return PAGE.format(
        error=error, networks="\n".join(rows), setup=html.escape(setup_ssid()),
        other_checked="" if PORTAL.networks else "checked",
        host=html.escape(socket.gethostname()), port=CFG["HOMEPORT_PORT"])


class QuietServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Phones drop connections mid-request all the time (captive checks,
        # leaving the network); that's not worth a traceback in the journal.
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def start_http():
    """Serve the setup page on the hotspot address (port 80). Retries while the AP comes up."""
    for _ in range(15):
        try:
            srv = QuietServer((AP_ADDR, 80), Handler)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            return srv
        except OSError:
            time.sleep(1)
    log("Could not start the setup page on port 80")
    return None


# ------------------------------------------------------------------ main loop

def setup_mode():
    """Run the hotspot until the Pi is online again."""
    log("Entering setup mode")
    ensure_radio_on()
    PORTAL.networks = scan()
    log(f"Found {len(PORTAL.networks)} networks")
    PORTAL.error = ""
    last_saved_try = time.time()
    while True:
        PORTAL.submitted = False
        if not start_ap():
            ensure_radio_on()  # in case something switched Wi-Fi off meanwhile
            time.sleep(30)
            if online():
                return
            continue
        srv = start_http()
        joined = False
        try:
            while True:
                try:
                    ssid, password, hidden = PORTAL.requests.get(timeout=5)
                except queue.Empty:
                    ssid = None
                if ssid is not None:
                    time.sleep(3)  # let the "Connecting…" page reach the phone
                    if srv:
                        srv.shutdown()
                        srv.server_close()
                        srv = None
                    stop_ap()
                    log(f"Trying to join '{ssid}'")
                    known = next((n for n in PORTAL.networks if n["ssid"] == ssid), None)
                    ok, msg = try_join(ssid, password, hidden, known)
                    if ok:
                        log(f"Joined '{ssid}'")
                        joined = True
                    else:
                        log(msg)
                        PORTAL.error = msg
                    break
                # Ethernet plugged in, or a saved network came back on its own?
                if online():
                    joined = True
                    break
                # Periodically try saved networks, unless someone is using the page.
                idle = time.time() - PORTAL.last_seen > 120
                if (wifi_profiles() and idle
                        and time.time() - last_saved_try > int(CFG["RETRY_SAVED_EVERY"])):
                    last_saved_try = time.time()
                    if srv:
                        srv.shutdown()
                        srv.server_close()
                        srv = None
                    stop_ap()
                    joined = retry_saved()
                    break
        finally:
            if srv:
                srv.shutdown()
                srv.server_close()
        if joined:
            stop_ap()
            log("Leaving setup mode")
            return
        PORTAL.networks = scan() or PORTAL.networks  # refresh the list while the radio is free


def main():
    boot_grace = int(CFG["BOOT_GRACE"])
    lost_grace = int(CFG["LOST_GRACE"])
    wait_for_wifi_iface()
    stop_ap()  # clean up a hotspot left over from a crash or power loss
    log(f"Waiting up to {boot_grace}s for a network")
    offline_since = time.time()
    grace = boot_grace
    while True:
        if online():
            offline_since = None
            grace = lost_grace
        elif offline_since is None:
            offline_since = time.time()
            log("Network lost")
        elif time.time() - offline_since >= grace:
            setup_mode()
            offline_since = None if online() else time.time()
        time.sleep(5)


def test_main():
    """Run one setup session now, ignoring Ethernet, with the service paused."""
    if os.geteuid() != 0:
        sys.exit("Run with sudo.")
    sh(["systemctl", "stop", "homeport-wifi-setup.service"])
    global IFACE
    IFACE = find_wifi_iface()
    if not IFACE:
        sh(["systemctl", "start", "homeport-wifi-setup.service"])
        sys.exit("No Wi-Fi adapter found.")
    log(f"TEST MODE: using Wi-Fi adapter {IFACE}")
    log("TEST MODE: service paused; starting the hotspot now (Ethernet ignored). Ctrl+C to stop.")
    try:
        setup_mode()
        log("TEST MODE: joined Wi-Fi.")
    finally:
        stop_ap()
        sh(["systemctl", "start", "homeport-wifi-setup.service"])
        log("TEST MODE: done; service restarted.")


if __name__ == "__main__":
    try:
        test_main() if TEST_MODE else main()
    except KeyboardInterrupt:
        stop_ap()
        sys.exit(0)
