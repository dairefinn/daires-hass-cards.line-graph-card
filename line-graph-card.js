class LineGraphCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._history = [];
    this._refreshTimer = null;
    this._lastEntity = null;
  }

  set hass(hass) {
    this._hass = hass;
    const entity = this._config?.entity;
    if (entity && entity !== this._lastEntity) {
      this._lastEntity = entity;
      this._fetchHistory();
    }
    this._render();
  }

  setConfig(config) {
    if (!config.entity && !config.points) {
      throw new Error("You must define either 'entity' or 'points'");
    }
    this._config = config;
    this._history = [];
    this._lastEntity = null;
    this._render();
  }

  getCardSize() {
    return 3;
  }

  disconnectedCallback() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
  }

  async _fetchHistory() {
    if (!this._hass || !this._config?.entity) return;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);

    const hours = this._config.hours ?? 24;
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);

    try {
      const result = await this._hass.callApi(
        "GET",
        `history/period/${start.toISOString()}?filter_entity_id=${this._config.entity}` +
          `&end_time=${end.toISOString()}&minimal_response=true&no_attributes=true`
      );
      if (result?.[0]) {
        this._history = result[0]
          .filter((s) => !isNaN(parseFloat(s.state)))
          .map((s) => ({ x: new Date(s.last_changed).getTime(), y: parseFloat(s.state) }));
        this._render();
      }
    } catch (e) {
      console.error("LineGraphCard: history fetch failed", e);
    }

    this._refreshTimer = setTimeout(() => this._fetchHistory(), 5 * 60 * 1000);
  }

  _getPoints() {
    let pts;
    if (this._config.points) {
      const labels = this._config.x_labels;
      pts = this._config.points.map((y, i) => ({ x: i, y, label: labels?.[i] ?? null }));
    } else {
      pts = this._history.map((s) => ({ x: s.x, y: s.y, label: this._formatTime(s.x) }));
    }
    const max = this._config.max_points;

    if (max && pts.length > max) {
      return this._downsample(pts, max);
    }

    // Guarantee a minimum of 2 points for rendering
    if (pts.length === 1) {
      pts = [pts[0], { ...pts[0], x: pts[0].x + 1 }];
    }

    return pts;
  }

  _formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  _downsample(pts, max) {
    const result = [];
    const step = (pts.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) {
      result.push(pts[Math.round(i * step)]);
    }
    return result;
  }

  _buildPath(coords, graphW, graphH, pad) {
    if (coords.length < 2) return { line: "", fill: "" };

    let d = `M ${coords[0].sx} ${coords[0].sy}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      const cpX = (prev.sx + curr.sx) / 2;
      d += ` C ${cpX} ${prev.sy}, ${cpX} ${curr.sy}, ${curr.sx} ${curr.sy}`;
    }

    const last = coords[coords.length - 1];
    const first = coords[0];
    const baseline = graphH - pad;
    const fill = `${d} L ${last.sx} ${baseline} L ${first.sx} ${baseline} Z`;

    return { line: d, fill };
  }

  _primaryEntity() {
    return this._config.entity ?? null;
  }

  _handleInteraction(trigger) {
    const interaction = (this._config.interactions ?? []).find(
      (i) => (i.trigger ?? "tap") === trigger
    );
    if (!interaction) return;
    const { action } = interaction;
    if (action === "more-info") {
      const entityId = interaction.entity ?? this._primaryEntity();
      if (!entityId) return;
      this.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      }));
    } else if (action === "toggle") {
      const entityId = interaction.entity ?? this._primaryEntity();
      if (!entityId || !this._hass) return;
      this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
    } else if (action === "call-service") {
      if (!interaction.service || !this._hass) return;
      const [domain, service] = interaction.service.split(".");
      this._hass.callService(domain, service, interaction.service_data ?? {});
    } else if (action === "navigate") {
      if (!interaction.path) return;
      try { window.history.pushState(null, "", interaction.path); } catch (_) {}
      this.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
    } else if (action === "url") {
      if (!interaction.url) return;
      window.open(interaction.url, interaction.target ?? "_blank");
    }
  }

  _attachInteractionListeners() {
    const interactions = this._config?.interactions;
    if (!interactions?.length) return;

    if (this._tapTimer) {
      clearTimeout(this._tapTimer);
      this._tapTimer = null;
      this._tapCount = 0;
    }

    const card = this.shadowRoot.querySelector(".card");
    if (!card) return;

    const triggers = new Set(interactions.map((i) => i.trigger ?? "tap"));
    card.style.cursor = "pointer";

    if (triggers.has("tap") || triggers.has("double_tap")) {
      card.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        this._tapCount = (this._tapCount ?? 0) + 1;
        if (this._tapCount === 1) {
          this._tapTimer = setTimeout(() => {
            this._tapCount = 0;
            this._tapTimer = null;
            this._handleInteraction("tap");
          }, 250);
        } else {
          clearTimeout(this._tapTimer);
          this._tapTimer = null;
          this._tapCount = 0;
          this._handleInteraction("double_tap");
        }
      });
    }

    if (triggers.has("hold")) {
      let holdTimer;
      const startHold = () => { holdTimer = setTimeout(() => this._handleInteraction("hold"), 500); };
      const cancelHold = () => clearTimeout(holdTimer);
      card.addEventListener("mousedown", startHold);
      card.addEventListener("mouseup", cancelHold);
      card.addEventListener("mouseleave", cancelHold);
      card.addEventListener("touchstart", startHold, { passive: true });
      card.addEventListener("touchend", cancelHold);
      card.addEventListener("touchcancel", cancelHold);
    }
  }

  static getConfigElement() {
    return document.createElement("daires-hass-cards-line-graph-card-editor");
  }

  static getStubConfig() {
    return { points: [10, 30, 20, 50, 40, 70] };
  }

  _render() {
    const config = this._config;
    if (!config) return;

    const points = this._getPoints();
    const background = config.background ?? "var(--card-background-color, #fff)";
    const color = config.color ?? "var(--primary-color, #03a9f4)";
    const strokeWidth = config.stroke_width ?? 2;
    const showFill = config.fill !== false;
    const showDots = config.show_dots === true;
    const unit = config.unit ?? "";

    const GW = 300;
    const GH = 100;
    const PAD = 6;
    const LABEL_H = 14;
    const showXLabels = config.show_x_labels !== false;
    const showYLabels = config.show_y_labels !== false;

    let svgContent;
    let currentDisplay = "—";
    let totalH = GH;

    if (points.length >= 2) {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const dataMinY = Math.min(...ys);
      const dataMaxY = Math.max(...ys);
      const minY = config.min ?? dataMinY;
      const maxY = config.max ?? dataMaxY;
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;

      const toX = (x) => PAD + ((x - minX) / rangeX) * (GW - PAD * 2);
      const toY = (y) => GH - PAD - ((Math.min(Math.max(y, minY), maxY) - minY) / rangeY) * (GH - PAD * 2);

      const coords = points.map((p) => ({ sx: toX(p.x), sy: toY(p.y) }));
      const { line, fill } = this._buildPath(coords, GW, GH, PAD);
      const last = coords[coords.length - 1];
      const lastVal = points[points.length - 1].y;

      const nearRight = last.sx > GW * 0.6;
      const labelX = nearRight ? last.sx - 6 : last.sx + 6;
      const textAnchor = nearRight ? "end" : "start";
      const displayVal = +lastVal.toFixed(1);
      currentDisplay = `${displayVal}${unit}`;

      this._renderedCoords = coords;
      this._renderedPoints = points;

      // X-axis labels (rendered below the graph)
      const hasXLabels = points.some((p) => p.label);
      let xAxisSvg = "";
      if (showXLabels && hasXLabels) {
        totalH = GH + LABEL_H;
        const xCount = Math.max(2, Math.min(config.x_label_count ?? 4, points.length));
        const xIndices = Array.from({ length: xCount }, (_, i) =>
          Math.round((i * (points.length - 1)) / (xCount - 1))
        );
        xAxisSvg = xIndices.map((idx, i) => {
          const lbl = points[idx].label;
          if (!lbl) return "";
          const cx = coords[idx].sx;
          const anchor = i === 0 ? "start" : i === xIndices.length - 1 ? "end" : "middle";
          return `<text x="${cx}" y="${GH + LABEL_H / 2}" text-anchor="${anchor}" fill="var(--secondary-text-color, #727272)" font-size="7" dominant-baseline="middle" pointer-events="none">${lbl}</text>`;
        }).join("");
      }

      // Y-axis labels (overlaid on the left of the graph)
      let yAxisSvg = "";
      if (showYLabels) {
        const yCount = Math.max(2, config.y_label_count ?? 3);
        yAxisSvg = Array.from({ length: yCount }, (_, i) => {
          const val = minY + (i / (yCount - 1)) * (maxY - minY);
          const cy = toY(val);
          return `<text x="${PAD + 2}" y="${cy}" text-anchor="start" fill="var(--secondary-text-color, #727272)" font-size="7" dominant-baseline="middle" opacity="0.7" pointer-events="none">${+val.toFixed(1)}${unit}</text>`;
        }).join("");
      }

      svgContent = `
        ${showFill ? `<path d="${fill}" fill="${color}" opacity="0.12" />` : ""}
        <path d="${line}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" style="transition:stroke-dashoffset 0.6s ease" />
        ${showDots ? coords.map((c) => `<circle cx="${c.sx}" cy="${c.sy}" r="2.5" fill="${color}" />`).join("") : ""}
        <circle cx="${last.sx}" cy="${last.sy}" r="3.5" fill="${color}" />
        ${config.show_end_label !== false ? `<text x="${labelX}" y="${last.sy + 4}" text-anchor="${textAnchor}" fill="${color}" font-size="9" font-weight="600">${displayVal}</text>` : ""}
        ${yAxisSvg}
        <rect id="tip-overlay" x="${PAD}" y="0" width="${GW - PAD * 2}" height="${GH}" fill="transparent" style="cursor:crosshair"/>
        <g id="tip" style="display:none;pointer-events:none;">
          <line x1="0" y1="${PAD}" x2="0" y2="${GH - PAD}" stroke="${color}" stroke-width="1" opacity="0.4" vector-effect="non-scaling-stroke"/>
          <circle id="tip-dot" cx="0" cy="0" r="4" fill="${color}"/>
          <rect id="tip-bg" rx="3" fill="${color}" opacity="0.9"/>
          <text id="tip-lbl" fill="white" font-size="7" text-anchor="middle" dominant-baseline="middle" opacity="0.85"/>
          <text id="tip-txt" fill="white" font-size="8" font-weight="600" text-anchor="middle" dominant-baseline="middle"/>
        </g>
        ${xAxisSvg}
      `;
    } else {
      this._renderedCoords = null;
      svgContent = `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="var(--secondary-text-color, #727272)" font-size="11">No data</text>`;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          background: ${background};
          border-radius: 12px;
          padding: 16px;
          box-sizing: border-box;
        }
        .header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .header-left {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .title {
          font-size: 14px;
          font-weight: 500;
          color: var(--secondary-text-color, #727272);
        }
        .label {
          font-size: 13px;
          color: var(--secondary-text-color, #727272);
        }
        .current-value {
          font-size: 22px;
          font-weight: 600;
          color: var(--primary-text-color, #212121);
        }
        svg {
          width: 100%;
          display: block;
          overflow: visible;
        }
        #tip { transition: transform 0.08s ease; }
      </style>
      <ha-card>
        <div class="card">
          <div class="header">
            <div class="header-left">
              ${config.title ? `<div class="title">${config.title}</div>` : ""}
              ${config.label ? `<div class="label">${config.label}</div>` : ""}
            </div>
            <div class="current-value">${currentDisplay}</div>
          </div>
          <svg viewBox="0 0 ${GW} ${totalH}">
            ${svgContent}
          </svg>
        </div>
      </ha-card>
    `;
    this._attachInteractionListeners();
    this._attachChartListeners();
  }

  _attachChartListeners() {
    const coords = this._renderedCoords;
    if (!coords?.length) return;

    const shadow = this.shadowRoot;
    const overlay = shadow.getElementById("tip-overlay");
    const tipGroup = shadow.getElementById("tip");
    const tipDot = shadow.getElementById("tip-dot");
    const tipBg = shadow.getElementById("tip-bg");
    const tipLbl = shadow.getElementById("tip-lbl");
    const tipTxt = shadow.getElementById("tip-txt");
    const svg = shadow.querySelector("svg");
    if (!overlay || !svg) return;

    const GW = 300, GH = 100, PAD = 6;
    const pts = this._renderedPoints;
    const unit = this._config.unit ?? "";

    overlay.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (GW / rect.width);

      let nearestIdx = 0, minDist = Infinity;
      for (let i = 0; i < coords.length; i++) {
        const d = Math.abs(coords[i].sx - mx);
        if (d < minDist) { minDist = d; nearestIdx = i; }
      }

      const c = coords[nearestIdx];
      const val = +pts[nearestIdx].y.toFixed(1);
      const valLabel = `${val}${unit}`;
      const xLabel = pts[nearestIdx].label;
      const hasLabel = Boolean(xLabel);

      const tipW = Math.max(valLabel.length * 5 + 10, hasLabel ? xLabel.length * 4 + 10 : 0);
      const tipH = hasLabel ? 24 : 14;
      // bubble x offset relative to the group origin so it stays in bounds
      const bubbleX = Math.min(Math.max(c.sx, tipW / 2 + PAD), GW - PAD - tipW / 2) - c.sx;
      const tipY = c.sy > GH / 2 ? c.sy - tipH - 5 : c.sy + 5;

      tipGroup.setAttribute("transform", `translate(${c.sx}, 0)`);
      tipDot.setAttribute("cy", c.sy);
      tipBg.setAttribute("x", bubbleX - tipW / 2);
      tipBg.setAttribute("y", tipY);
      tipBg.setAttribute("width", tipW);
      tipBg.setAttribute("height", tipH);

      if (hasLabel) {
        tipLbl.textContent = xLabel;
        tipLbl.setAttribute("x", bubbleX);
        tipLbl.setAttribute("y", tipY + 7);
        tipLbl.style.display = "";
        tipTxt.setAttribute("x", bubbleX);
        tipTxt.setAttribute("y", tipY + 17);
      } else {
        tipLbl.style.display = "none";
        tipTxt.setAttribute("x", bubbleX);
        tipTxt.setAttribute("y", tipY + tipH / 2);
      }
      tipTxt.textContent = valLabel;

      tipGroup.style.display = "";
    });

    overlay.addEventListener("mouseleave", () => {
      tipGroup.style.display = "none";
    });
  }
}

customElements.define("daires-hass-cards-line-graph-card", LineGraphCard);

class LineGraphCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    const p = this.shadowRoot.getElementById("entity");
    if (p) p.hass = hass;
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  _fire() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: { ...this._config } },
      bubbles: true,
      composed: true,
    }));
  }

  _set(key, value) {
    if (value === "" || value === undefined || value === null) {
      delete this._config[key];
    } else {
      this._config[key] = value;
    }
    this._fire();
  }

  _render() {
    const c = this._config ?? {};
    this.shadowRoot.innerHTML = `
      <style>
        .form { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; }
        .section { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--secondary-text-color, #727272); padding-bottom: 4px; border-bottom: 1px solid var(--divider-color, #e0e0e0); margin-top: 8px; }
        .row { display: flex; flex-direction: column; gap: 4px; }
        .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        label { font-size: 12px; color: var(--secondary-text-color, #727272); }
        input[type=text], input[type=number] { padding: 8px 10px; border: 1px solid var(--divider-color, #e0e0e0); border-radius: 6px; font-size: 14px; color: var(--primary-text-color, #212121); background: var(--card-background-color, #fff); box-sizing: border-box; width: 100%; }
        ha-entity-picker { display: block; }
        .checkbox-row { display: flex; align-items: center; gap: 8px; }
        .checkbox-row input[type=checkbox] { width: 16px; height: 16px; cursor: pointer; flex-shrink: 0; }
        .checkbox-row label { font-size: 13px; cursor: pointer; color: var(--primary-text-color, #212121); margin: 0; }
      </style>
      <div class="form">
        <div class="section">Entity</div>
        <ha-entity-picker id="entity" allow-custom-entity></ha-entity-picker>

        <div class="section">Labels</div>
        <div class="row"><label>Title</label><input id="title" type="text" placeholder="Card title" /></div>
        <div class="row-2">
          <div class="row"><label>Label</label><input id="label" type="text" placeholder="e.g. Last 24h" /></div>
          <div class="row"><label>Unit</label><input id="unit" type="text" placeholder="e.g. °C" /></div>
        </div>
        <div class="row-2">
          <div class="row"><label>X label count</label><input id="x_label_count" type="number" placeholder="4 (min 2)" min="2" /></div>
          <div class="row"><label>Y label count</label><input id="y_label_count" type="number" placeholder="3 (min 2)" min="2" /></div>
        </div>
        <div class="checkbox-row"><input id="show_x_labels" type="checkbox" /><label for="show_x_labels">Show X axis labels</label></div>
        <div class="checkbox-row"><input id="show_y_labels" type="checkbox" /><label for="show_y_labels">Show Y axis labels</label></div>

        <div class="section">Data</div>
        <div class="row-2">
          <div class="row"><label>History (hours)</label><input id="hours" type="number" placeholder="24" /></div>
          <div class="row"><label>Max points</label><input id="max_points" type="number" placeholder="unlimited" /></div>
        </div>
        <div class="row-2">
          <div class="row"><label>Y min</label><input id="min" type="number" placeholder="auto" /></div>
          <div class="row"><label>Y max</label><input id="max" type="number" placeholder="auto" /></div>
        </div>

        <div class="section">Appearance</div>
        <div class="row-2">
          <div class="row"><label>Line color</label><input id="color" type="text" placeholder="var(--primary-color)" /></div>
          <div class="row"><label>Stroke width</label><input id="stroke_width" type="number" step="0.5" placeholder="2" /></div>
        </div>
        <div class="checkbox-row"><input id="fill" type="checkbox" /><label for="fill">Fill under line</label></div>
        <div class="checkbox-row"><input id="show_dots" type="checkbox" /><label for="show_dots">Show dots</label></div>
        <div class="checkbox-row"><input id="show_end_label" type="checkbox" /><label for="show_end_label">Show value label on end dot</label></div>
      </div>
    `;

    const get = (id) => this.shadowRoot.getElementById(id);

    const picker = get("entity");
    picker.value = c.entity ?? "";
    if (this._hass) picker.hass = this._hass;
    picker.addEventListener("value-changed", (e) => this._set("entity", e.detail.value));

    for (const id of ["title", "label", "unit", "color"]) {
      const el = get(id);
      el.value = c[id] ?? "";
      el.addEventListener("change", (e) => this._set(id, e.target.value));
    }
    for (const id of ["hours", "max_points", "min", "max", "stroke_width"]) {
      const el = get(id);
      el.value = c[id] ?? "";
      el.addEventListener("change", (e) => {
        const v = e.target.value;
        this._set(id, v === "" ? undefined : parseFloat(v));
      });
    }
    for (const id of ["x_label_count", "y_label_count"]) {
      const el = get(id);
      el.value = c[id] ?? "";
      el.addEventListener("change", (e) => {
        const v = e.target.value;
        this._set(id, v === "" ? undefined : Math.max(2, parseInt(v, 10)));
      });
    }

    const fillEl = get("fill");
    fillEl.checked = c.fill !== false;
    fillEl.addEventListener("change", (e) => {
      if (e.target.checked) {
        delete this._config.fill;
      } else {
        this._config.fill = false;
      }
      this._fire();
    });

    const dotsEl = get("show_dots");
    dotsEl.checked = c.show_dots === true;
    dotsEl.addEventListener("change", (e) => {
      if (e.target.checked) {
        this._config.show_dots = true;
      } else {
        delete this._config.show_dots;
      }
      this._fire();
    });

    const endLabelEl = get("show_end_label");
    endLabelEl.checked = c.show_end_label !== false;
    endLabelEl.addEventListener("change", (e) => {
      if (e.target.checked) {
        delete this._config.show_end_label;
      } else {
        this._config.show_end_label = false;
      }
      this._fire();
    });

    const showXLabelsEl = get("show_x_labels");
    showXLabelsEl.checked = c.show_x_labels !== false;
    showXLabelsEl.addEventListener("change", (e) => {
      if (e.target.checked) { delete this._config.show_x_labels; }
      else { this._config.show_x_labels = false; }
      this._fire();
    });

    const showYLabelsEl = get("show_y_labels");
    showYLabelsEl.checked = c.show_y_labels !== false;
    showYLabelsEl.addEventListener("change", (e) => {
      if (e.target.checked) { delete this._config.show_y_labels; }
      else { this._config.show_y_labels = false; }
      this._fire();
    });
  }
}

customElements.define("daires-hass-cards-line-graph-card-editor", LineGraphCardEditor);
