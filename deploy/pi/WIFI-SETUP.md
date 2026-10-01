# Wi-Fi setup hotspot

How a Homeport appliance gets onto a household's Wi-Fi without a cable, keyboard or app.
Installed by `install.sh` (step 9) as `homeport-wifi-setup.service`, running
`/usr/local/lib/homeport/wifi-setup.py`. Skip it with `--no-wifi-setup`.

## What the customer sees

1. They plug Homeport in. If it's on Ethernet, or already knows their Wi-Fi, it just connects.
2. Otherwise, after about 90 seconds a new Wi-Fi network appears: **`Homeport-Setup-XXXX`**
   (`XXXX` = last 4 characters of the Pi's Wi-Fi MAC address, so neighbouring units differ).
3. They join it from their phone. A setup page pops up automatically, the same way hotel
   Wi-Fi sign-in pages do. If it doesn't, they open any web page, or `http://10.42.0.1`.
4. The page lists nearby networks, strongest first, with a lock icon on secured ones, plus
   **Other network…** for hidden or unlisted networks. They pick theirs, enter the password
   and tap **Connect**.
5. The page says: *reconnect your phone to your Wi-Fi, then open
   `http://homeport.local:19156`*. A few seconds later the setup network disappears and the
   Pi joins theirs.
6. If joining fails (wrong password, out of range), `Homeport-Setup-XXXX` comes back within
   about a minute. Rejoining it shows the reason at the top of the page.

## How it works

The service checks the network every 5 seconds through NetworkManager (`nmcli`).

| Situation | What happens |
|---|---|
| Boot, network connects within `BOOT_GRACE` (90s) | Nothing. The Pi runs normally. |
| Boot, no network after 90s | Setup mode |
| Was online, offline for `LOST_GRACE` (120s) | Setup mode (new router, moved house, Wi-Fi password changed) |
| Ethernet plugged in during setup mode | Hotspot closes; the Pi stays on Ethernet |
| Saved network comes back during setup mode | Retried every `RETRY_SAVED_EVERY` (300s), but only when nobody has used the page for 2 minutes |

Only **physical** network ports count as "online", meaning the built-in Ethernet port and
the Wi-Fi chip. Docker's virtual links (`veth…`, `docker0`, `br-…`) also report as
"ethernet, connected", and the first version mistook them for a working network.

**Setup mode, step by step:**

1. Scan for nearby networks. The Pi has a single Wi-Fi radio and can't scan properly while
   it's broadcasting, so the list is captured first.
2. Start the hotspot as a NetworkManager `shared` connection named `homeport-setup`:
   2.4 GHz, address `10.42.0.1/24`, DHCP for phones. It's open by default, or WPA2 if
   `AP_PASSWORD` is set.
3. Captive portal: `/etc/NetworkManager/dnsmasq-shared.d/homeport-captive.conf`
   (`address=/#/10.42.0.1`) answers every DNS lookup from hotspot clients with the Pi. The
   setup page redirects every unknown address to `http://10.42.0.1/`, so the phone's
   "is there internet?" check (Apple, Android, Windows) gets redirected and the phone opens
   the page by itself. This only affects devices on the hotspot, never the Pi's own DNS.
4. Serve the setup page on `10.42.0.1:80`. It's a small web server built into
   `wifi-setup.py`, running on the Pi itself rather than in Docker, so it works even if
   Docker or Homeport is down. Homeport keeps running on port 19156 throughout.
5. On **Connect**: send the "Connecting…" page, wait 3 seconds so it reaches the phone, close
   the hotspot, then run `nmcli device wifi connect <ssid> password <pw>` (45s timeout) and
   wait up to 20s to be online.
   - **Success:** the new network is saved, so it reconnects by itself after power cuts, and
     setup mode ends.
   - **Failure:** any network profile this attempt created is deleted, the network list is
     rescanned, the hotspot restarts, and the page shows the error.

The Pi can't confirm the password while the hotspot is up (single radio), which is why a
failed attempt needs the customer to rejoin `Homeport-Setup-XXXX`.

## Settings

`/etc/homeport/wifi-setup.conf`, created on first install and never overwritten after.
All settings are optional; uncomment one to change it, then
`sudo systemctl restart homeport-wifi-setup`.

| Setting | Default | Meaning |
|---|---|---|
| `SSID_PREFIX` | `Homeport-Setup` | Hotspot name before the `-XXXX` suffix |
| `AP_PASSWORD` | *(empty)* | Empty = open setup network. 8+ characters = WPA2 |
| `BOOT_GRACE` | `90` | Seconds to wait for a network at boot |
| `LOST_GRACE` | `120` | Seconds offline (after being online) before broadcasting |
| `RETRY_SAVED_EVERY` | `300` | Seconds between retries of saved networks while broadcasting |

Keep comments on their own lines: anything after the `=` is part of the value.

The Wi-Fi country (radio regulations) must be set or Pi OS keeps Wi-Fi switched off.
`install.sh` sets it to `US` if none is set; use `--wifi-country CC` to choose another.

## Testing and troubleshooting

**Test over SSH (Ethernet connected):**

```bash
sudo python3 /usr/local/lib/homeport/wifi-setup.py --test
```

This pauses the service, starts the hotspot immediately while ignoring Ethernet, and prints
each step. It exits once the Pi joins Wi-Fi (or on Ctrl+C) and restarts the service.

**Test the real path:** forget the Wi-Fi network (`nmcli connection show` to find the name,
then `sudo nmcli connection delete "<name>"`), unplug Ethernet, and the hotspot appears about
2 minutes later.

**Useful commands:**

```bash
systemctl status homeport-wifi-setup         # running?
journalctl -u homeport-wifi-setup -f         # live log: "Network lost", "Entering setup mode", join results
nmcli device                                 # what's connected
nmcli connection show                        # saved networks
rfkill list wifi                             # "Soft blocked: yes" = Wi-Fi switched off
sudo raspi-config nonint get_wifi_country    # blank = Wi-Fi off until a country is set
```

**Known limits:**

- The setup page can't show the Pi's new IP address. The Pi only gets one after closing the
  hotspot, by which time the phone has disconnected. The page points to
  `homeport.local:19156` instead, which works on iPhone, Mac and current Android when the
  phone and Pi are on the same network.
- If Homeport joins a guest or IoT network that isolates devices, or a different network
  segment from the phone, `homeport.local` won't resolve. Find it by name (`homeport`) in
  the router's DHCP lease list.
- The hotspot runs on 2.4 GHz for compatibility. The home network the Pi joins can be
  2.4 or 5 GHz.
- The setup network is open by default. Anyone in range during setup could reach the page.
  Set `AP_PASSWORD` and print it on the box if that matters.

## Removing it

`sudo homeport-install --no-wifi-setup` removes the service and the captive-portal DNS file
but keeps your settings in `/etc/homeport/`. `sudo homeport-uninstall` also removes
`/etc/homeport/`. Neither touches the saved Wi-Fi networks.
