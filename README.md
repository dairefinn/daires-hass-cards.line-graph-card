# Line graph card

A historical line graph card for Home Assistant. Fetches entity history via the HA API and renders a smooth SVG curve with an optional area fill.

<img width="1023" height="875" alt="image" src="https://github.com/user-attachments/assets/5097d18a-502c-43b9-8aa8-8a5934210624" />

## Installation

### HACS (recommended)

1. In Home Assistant, go to **HACS → Frontend → ⋮ → Custom repositories**
2. Add this repository URL and set the category to **Lovelace**
3. Click **Download** on the line-graph-card entry
4. Restart Home Assistant

### Manual

1. Copy `line-graph-card.js` to your Home Assistant `config/www/` folder.
2. Add the resource in your Lovelace dashboard:
   - **Settings → Dashboards → Resources → Add Resource**
   - URL: `/local/line-graph-card.js`
   - Type: `JavaScript module`

## Configuration

Either `entity` or `points` is required.

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | — | HA entity ID to pull history for |
| `points` | list | — | Static list of numeric values (use instead of `entity`) |
| `hours` | number | `24` | How many hours of history to fetch |
| `max_points` | number | — | Downsample to at most this many points before rendering |
| `title` | string | — | Card title |
| `label` | string | — | Label shown below the graph |
| `unit` | string | — | Unit appended to the current value display |
| `color` | string | `var(--primary-color)` | Line and fill color |
| `stroke_width` | number | `2` | Line thickness in screen pixels (fractional values like `0.5` are supported) |
| `fill` | boolean | `true` | Show area fill below the line |
| `show_dots` | boolean | `false` | Show dots at each data point |
| `show_end_label` | boolean | `true` | Show the value number next to the end dot |
| `min` | number | auto | Y-axis minimum |
| `max` | number | auto | Y-axis maximum |
| `background` | string | `var(--card-background-color)` | Card background color |
| `interactions` | list | — | Tap/hold/double-tap actions (see below) |

## Interactions

Attach actions to `tap`, `hold` (500 ms), or `double_tap` events by adding an `interactions` list.

```yaml
interactions:
  - trigger: tap        # tap | hold | double_tap  (default: tap)
    action: more-info   # see action reference below
```

| Action | Extra fields | Description |
|---|---|---|
| `more-info` | `entity` (optional) | Open the HA more-info dialog. Defaults to the card's entity. |
| `toggle` | `entity` (optional) | Toggle the entity. |
| `call-service` | `service`, `service_data` | Call any HA service. `service` is `domain.service` format. |
| `navigate` | `path` | Navigate to a Lovelace path. |
| `url` | `url`, `target` | Open a URL. `target` defaults to `_blank`. |
| `none` | — | Explicit no-op. |

## Examples

**Temperature over 24 hours:**
```yaml
type: custom:daires-hass-cards-line-graph-card
title: Temperature
entity: sensor.living_room_temperature
unit: "°C"
color: "#ff7043"
label: Living Room · Last 24 h
```

**Energy usage, anchored to zero:**
```yaml
type: custom:daires-hass-cards-line-graph-card
title: Energy Usage
entity: sensor.power_consumption
unit: " kW"
min: 0
color: "#ff9800"
label: Whole home · Last 24 h
```

**With interactions:**
```yaml
type: custom:daires-hass-cards-line-graph-card
title: Temperature
entity: sensor.living_room_temperature
unit: "°C"
interactions:
  - trigger: tap
    action: more-info
  - trigger: hold
    action: navigate
    path: /lovelace/climate
```

## Demo

Open `demo.html` in a browser to preview the card without Home Assistant.
