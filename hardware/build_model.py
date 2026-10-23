"""SARAB-1 1U CubeSat prototype: single source of truth for the 3D model.

Writes:
  parts.json            part list used by the web viewer and dashboard
  stl/*.stl             one file per colour group for Tinkercad (shared bounding box so they line up)
  stl/sarab1-assembly.stl   everything merged into one file
Units: millimetres. Origin: centre of the base, z up.
"""
import json, math, os, struct, sys, zipfile

OUT = os.path.dirname(os.path.abspath(__file__))
P = []

def box(pid, name, group, c, s, color, layer, info="", sub=None, tex=None):
    P.append(dict(id=pid, name=name, group=group, shape="box", c=c, s=s, color=color,
                  layer=layer, info=info, sub=sub or pid, tex=tex))

# ---- Colours ----
FOAM, DECK, PILLAR = "#1E2226", "#2B3036", "#3A4048"
RAIL, METAL, BLACK = "#B8C0C6", "#C7CCD1", "#121417"
PCB_BLUE, PCB_BLACK = "#2459A6", "#1D1F24"
BATT, CERAMIC, TERM = "#8FA3B5", "#D8CBA8", "#2E7D5B"
SOLAR_BACK, SOLAR_CELL, GLASS, PORT = "#1B2A40", "#173B6E", "#08090B", "#0B0D10"

# ---- Structure: 5 mm black foam board, outer 100 x 100 x 113.5 mm ----
box("base", "Base panel", "structure", [0, 0, 2.5], [100, 100, 5], FOAM, "base")
box("top_plate", "Top panel", "structure", [0, 0, 111], [100, 100, 5], FOAM, "top")
box("wall_xp", "Side panel +X (charge port)", "structure", [47.5, 0, 56.75], [5, 83, 103.5], FOAM, "wall_xp", tex="label")
box("wall_xn", "Side panel −X (USB port)", "structure", [-47.5, 0, 56.75], [5, 83, 103.5], FOAM, "wall_xn")
box("wall_yp", "Side panel +Y", "structure", [0, 47.5, 56.75], [83, 5, 103.5], FOAM, "wall_yp")
box("wall_yn", "Front panel −Y (status screen)", "structure", [0, -47.5, 56.75], [83, 5, 103.5], FOAM, "wall_yn")
box("port_usb", "USB access port", "structure", [-50.15, 14, 54], [0.4, 12, 8], PORT, "wall_xn")
box("port_chg", "Charge access port", "structure", [50.15, -21, 8.5], [0.4, 10, 5], PORT, "wall_xp")
for sx, sy, tag in [(1, 1, "pp"), (1, -1, "pn"), (-1, 1, "np"), (-1, -1, "nn")]:
    box(f"rail_{tag}", "Corner rail", "rails", [45.75 * sx, 45.75 * sy, 56.75], [8.5, 8.5, 113.5], RAIL, f"rail_{tag}",
        info="8.5 mm foam strip on each vertical edge, wrapped in aluminium tape", sub="rails")

# ---- Decks and supports ----
box("deck1", "Avionics deck 1", "structure", [0, 0, 40.5], [83, 83, 5], DECK, "deck1",
    info="Foam deck carrying the flight computer, power sensor and motion sensor")
box("deck2", "Payload deck 2", "structure", [0, 0, 77.5], [83, 83, 5], DECK, "deck2",
    info="Foam deck carrying the GPS receiver")
for sx in (1, -1):
    for sy in (1, -1):
        box(f"pillar_lo_{sx}{sy}", "Deck pillar", "structure", [35 * sx, 35 * sy, 21.5], [6, 6, 33], PILLAR, "base",
            info="Foam pillar between base and deck 1", sub="pillars")
        box(f"pillar_hi_{sx}{sy}", "Deck pillar", "structure", [35 * sx, 35 * sy, 59], [6, 6, 32], PILLAR, "deck1",
            info="Foam pillar between deck 1 and deck 2", sub="pillars")

# ---- Power (base and top) ----
box("battery", "LiPo battery", "power", [-12, 8, 10], [50, 34, 10], BATT, "base",
    info="3.7 V 1000 mAh, 50 × 34 × 10 mm. Lowest point, to keep the centre of mass low")
box("chg_pcb", "Charger + 5 V boost", "power", [15, -21, 5.8], [33, 23, 1.6], PCB_BLUE, "base",
    info="Charges the battery and outputs a fixed 5 V. USB-C reachable through the +X panel", sub="charger")
box("chg_usb", "Charger + 5 V boost", "power", [28, -21, 8.2], [7, 9, 3.2], METAL, "base", sub="charger")
box("solar_back", "Solar panel", "power", [0, -15.5, 114.25], [99, 69, 1.5], SOLAR_BACK, "top",
    info="6 V, 99 × 69 mm, on the top face", sub="solar")
box("solar_cells", "Solar panel", "power", [0, -15.5, 115.75], [95, 65, 1.5], SOLAR_CELL, "top", sub="solar", tex="solar")

# ---- Flight computer (deck 1) ----
for i, y in enumerate((1.45, 26.55)):
    box(f"esp_hdr{i}", "ESP32 flight computer", "avionics", [-14, y, 47], [38, 2.5, 8], BLACK, "deck1", sub="esp32")
box("esp_pcb", "ESP32 flight computer", "avionics", [-14, 14, 51.8], [51.5, 28.3, 1.6], PCB_BLACK, "deck1",
    info="Runs detection, packs telemetry and sends it over Wi-Fi. USB faces the −X port", sub="esp32")
box("esp_mod", "ESP32 flight computer", "avionics", [-1, 14, 54.15], [25.5, 18, 3.1], METAL, "deck1", sub="esp32")
box("esp_usb", "ESP32 flight computer", "avionics", [-37.5, 14, 54.1], [5.5, 8, 3], METAL, "deck1", sub="esp32")

box("ina_hdr", "INA219 power sensor", "avionics", [25, 4, 46], [15, 2.5, 6], BLACK, "deck1", sub="ina219")
box("ina_pcb", "INA219 power sensor", "avionics", [25, 15, 49.8], [22.3, 25.5, 1.6], PCB_BLUE, "deck1",
    info="Measures solar-panel voltage and current; the current doubles as a sun sensor", sub="ina219")
box("ina_term", "INA219 power sensor", "avionics", [25, 24, 54.6], [10, 7.5, 8], TERM, "deck1", sub="ina219")

box("mpu_hdr", "MPU6050 motion sensor", "avionics", [0, -28.75, 46], [15, 2.5, 6], BLACK, "deck1", sub="mpu6050")
box("mpu_pcb", "MPU6050 motion sensor", "avionics", [0, -22, 49.8], [21, 16, 1.6], PCB_BLUE, "deck1",
    info="Tilt, rotation, vibration and temperature. Sits at the deck centre, near the centre of mass", sub="mpu6050")
box("mpu_chip", "MPU6050 motion sensor", "avionics", [0, -22, 51.05], [4, 4, 0.9], BLACK, "deck1", sub="mpu6050")

# ---- Payload (deck 2 and top face) ----
box("gps_hdr", "NEO-6M GPS receiver", "payload", [-26, 0, 83.5], [2.5, 10, 7], BLACK, "deck2", sub="gps")
box("gps_pad", "NEO-6M GPS receiver", "payload", [-2, 0, 83.5], [14, 14, 7], PILLAR, "deck2", sub="gps")
box("gps_pcb", "NEO-6M GPS receiver", "payload", [-10, 0, 87.8], [36, 25, 1.6], PCB_BLUE, "deck2",
    info="The payload. Reports signal strength per satellite, the noise level and the jamming indicator", sub="gps")
box("gps_mod", "NEO-6M GPS receiver", "payload", [-6, 0, 89.8], [16, 12.2, 2.4], METAL, "deck2", sub="gps")
box("ant_base", "GPS patch antenna", "payload", [0, 34.5, 114.25], [25, 25, 1.5], METAL, "top",
    info="25 × 25 mm ceramic patch on the top face, pointing at the sky", sub="antenna")
box("ant_cer", "GPS patch antenna", "payload", [0, 34.5, 117], [25, 25, 4], CERAMIC, "top", sub="antenna")
box("ant_patch", "GPS patch antenna", "payload", [0, 34.5, 119.2], [16, 16, 0.4], METAL, "top", sub="antenna")

# ---- Housekeeping display (front face) ----
box("oled_pcb", "OLED status screen", "avionics", [0, -50.8, 72], [27, 1.6, 27.5], PCB_BLUE, "wall_yn",
    info="0.96 inch screen on the front panel showing live status", sub="oled")
box("oled_glass", "OLED status screen", "avionics", [0, -52.3, 73.5], [26, 1.4, 16], GLASS, "wall_yn", sub="oled", tex="oled")

# ---------- STL export ----------
def box_tris(c, s):
    x0, x1 = c[0] - s[0] / 2, c[0] + s[0] / 2
    y0, y1 = c[1] - s[1] / 2, c[1] + s[1] / 2
    z0, z1 = c[2] - s[2] / 2, c[2] + s[2] / 2
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [((0, 3, 2, 1), (0, 0, -1)), ((4, 5, 6, 7), (0, 0, 1)), ((0, 1, 5, 4), (0, -1, 0)),
             ((2, 3, 7, 6), (0, 1, 0)), ((1, 2, 6, 5), (1, 0, 0)), ((0, 4, 7, 3), (-1, 0, 0))]
    out = []
    for (a, b, cc, d), n in faces:
        out.append((n, v[a], v[b], v[cc]))
        out.append((n, v[a], v[cc], v[d]))
    return out

def write_stl(path, tris):
    with open(path, "wb") as f:
        f.write(b"SARAB-1 CubeSat model, units mm".ljust(80, b" "))
        f.write(struct.pack("<I", len(tris)))
        for n, a, b, c in tris:
            f.write(struct.pack("<12fH", *n, *a, *b, *c, 0))

xs = [p["c"][0] + k * p["s"][0] / 2 for p in P for k in (-1, 1)]
ys = [p["c"][1] + k * p["s"][1] / 2 for p in P for k in (-1, 1)]
zs = [p["c"][2] + k * p["s"][2] / 2 for p in P for k in (-1, 1)]
lo, hi = (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))
A = 0.2  # tiny anchor cubes at the shared bounding-box corners keep imports aligned
anchors = box_tris([lo[0] + A / 2, lo[1] + A / 2, lo[2] + A / 2], [A, A, A]) + \
          box_tris([hi[0] - A / 2, hi[1] - A / 2, hi[2] - A / 2], [A, A, A])

GROUPS = {  # file name -> (label, colour to set in Tinkercad, part ids)
    "1-structure-black": ("Panels, decks and pillars", "Black", lambda p: (p["group"] == "structure" and not p["id"].startswith("port")) or p["color"] == PILLAR),
    "2-rails-silver": ("Corner rails", "Light grey", lambda p: p["group"] == "rails"),
    "3-solar-panel-blue": ("Solar panel", "Dark blue", lambda p: p["sub"] == "solar"),
    "4-battery-grey": ("LiPo battery", "Grey", lambda p: p["id"] == "battery"),
    "5-circuit-boards-blue": ("Circuit boards", "Blue", lambda p: p["color"] == PCB_BLUE),
    "6-chips-and-ports-silver": ("Metal shields and ports", "Silver", lambda p: p["color"] == METAL),
    "7-headers-and-screen-black": ("Headers, ESP32 board, screen, port openings", "Black", lambda p: p["color"] in (BLACK, PCB_BLACK, GLASS, PORT)),
    "8-antenna-ceramic-beige": ("GPS patch antenna ceramic", "Beige", lambda p: p["color"] == CERAMIC),
    "9-terminal-green": ("INA219 terminal block", "Green", lambda p: p["color"] == TERM),
}
os.makedirs(os.path.join(OUT, "stl"), exist_ok=True)
used = set()
summary = []
for fname, (label, colour, pick) in GROUPS.items():
    parts = [p for p in P if pick(p) and p["id"] not in used]
    used.update(p["id"] for p in parts)
    tris = [t for p in parts for t in box_tris(p["c"], p["s"])] + anchors
    write_stl(os.path.join(OUT, "stl", fname + ".stl"), tris)
    summary.append((fname, label, colour, len(parts)))
missing = [p["id"] for p in P if p["id"] not in used]
if missing:
    sys.exit("parts not exported: " + ", ".join(missing))
write_stl(os.path.join(OUT, "stl", "sarab1-assembly.stl"), [t for p in P for t in box_tris(p["c"], p["s"])])

with open(os.path.join(OUT, "parts.json"), "w") as f:
    json.dump(P, f, separators=(",", ":"))

with zipfile.ZipFile(os.path.join(OUT, "SARAB-1-tinkercad-stl.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    for fname in list(GROUPS) + ["sarab1-assembly"]:
        z.write(os.path.join(OUT, "stl", fname + ".stl"), fname + ".stl")

print(f"{len(P)} parts, bbox {lo} to {hi}")
for row in summary:
    print(row)
