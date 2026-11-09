/* App registry. Each app: { id, name, glyph, launch(opts) } and builds its UI inside a WM window. */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const download = (name, text, type = 'text/plain') => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
};
/* Save helper shared by editors: creates the file on first save, updates afterwards. */
async function saveFile(state, kind, content, defName) {
  if (!state.file) {
    const name = prompt('File name:', defName); if (!name) return;
    state.file = await api('/api/files', 'POST', { name, kind, content });
  } else await api('/api/files/' + state.file.id, 'PUT', { content });
  return state.file;
}
const APPS = {};

/* ---------- Picture layout (Word-style Layout Options) ---------- */
const IMG_ATTRS = ['alt', 'width', 'height', 'data-wrap', 'data-side', 'data-anchor', 'data-x', 'data-y'];
const OLD_WRAP = { left: ['square', 'left'], right: ['square', 'right'], center: ['topbottom'] };  // values from my earlier version
const isFree = img => img.dataset.wrap === 'behind' || img.dataset.wrap === 'front';
const syncImg = img => {
  const o = OLD_WRAP[img.dataset.wrap];
  if (o) { img.dataset.wrap = o[0]; if (o[1]) img.dataset.side = o[1]; }
  img.style.setProperty('--x', (img.dataset.x || 0) + 'px');
  img.style.setProperty('--y', (img.dataset.y || 0) + 'px');
};
const BaseImage = Quill.import('formats/image');
class LayoutImage extends BaseImage {
  static formats(dom) {
    return IMG_ATTRS.reduce((o, k) => (dom.hasAttribute(k) && (o[k] = dom.getAttribute(k)), o), {});
  }
  format(name, value) {
    if (IMG_ATTRS.includes(name)) {
      value ? this.domNode.setAttribute(name, value) : this.domNode.removeAttribute(name);
      syncImg(this.domNode);
    } else super.format(name, value);
  }
}
Quill.register(LayoutImage, true);

/* CSS for the wrap modes (also reused by Export Word / PDF) */
const IMG_CSS = `
  img:is([data-wrap=square],[data-wrap=tight],[data-wrap=through]){float:left;margin:4px var(--gap,14px) 8px 0}
  img:is([data-wrap=tight],[data-wrap=through]){--gap:5px}
  img:is([data-wrap=square],[data-wrap=tight],[data-wrap=through])[data-side=right]{float:right;margin:4px 0 8px var(--gap,14px)}
  img[data-wrap=topbottom]{display:block;margin:8px auto;clear:both}
  img:is([data-wrap=behind],[data-wrap=front]){position:absolute;left:var(--x,0px);top:var(--y,0px);max-width:none;margin:0}
  img[data-wrap=behind]{z-index:-1}
  img[data-wrap=front]{z-index:3}
  p:has(> img:is([data-wrap=behind],[data-wrap=front])){min-height:1.5em}
  p:has(> img[data-anchor=text]:is([data-wrap=behind],[data-wrap=front])){position:relative}`;

/* Icons for the Layout Options panel */
const LAYOUT_ICON = (() => {
  const row = (y, a = 3, b = 37) => `<path class="ln" d="M${a} ${y}H${b}"/>`;
  const arch = (cx, base, cls = 'ar') => `<path class="${cls}" d="M${cx - 6} ${base}v-5a6 6 0 0 1 12 0v5h-3.5v-5a2.5 2.5 0 0 0-5 0v5z"/>`;
  const svg = body => `<svg viewBox="0 0 40 40" aria-hidden="true">${body}</svg>`;
  const split = (ys, l, r) => ys.map(y => row(y, 3, l) + row(y, r, 37)).join('');
  const all = [6, 13, 20, 27, 34].map(y => row(y)).join('');
  return {
    inline: svg(row(6) + row(13) + arch(10, 28) + row(24, 19) + row(34)),
    square: svg(row(6) + row(13) + split([20, 27], 13, 27) + arch(20, 28) + row(34)),
    tight: svg(row(6) + row(13) + split([20, 27], 15, 25) + arch(20, 28) + row(34)),
    through: svg(row(6) + row(13) + split([20, 27], 15, 25) + row(25.5, 18.3, 21.7) + arch(20, 28) + row(34)),
    topbottom: svg(row(4) + row(10) + arch(20, 28) + row(33) + row(39)),
    behind: svg(arch(20, 29, 'ar faint') + all),
    front: svg(all + arch(20, 29)) };
})();

(() => {
  const s = document.createElement('style');
  s.textContent = IMG_CSS + `
    .ql-editor{position:relative;isolation:isolate}
    .ql-editor img{max-width:100%;cursor:pointer}
    .img-frame{position:absolute;z-index:6;border:2px solid var(--accent);pointer-events:none;border-radius:2px}
    .img-open,.img-move{position:absolute;z-index:7;width:30px;height:30px;padding:3px;border-radius:8px;background:var(--surface);box-shadow:var(--sh-sm)}
    .img-open svg{width:100%;height:100%}
    .img-move{cursor:move;padding:0;font-size:16px;line-height:1}
    .lo-panel{position:absolute;z-index:8;width:232px;padding:12px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:var(--sh-lg);font-size:13px}
    .lo-panel[hidden],.lo-extra[hidden],.img-frame[hidden],.img-open[hidden],.img-move[hidden]{display:none}
    .lo-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:15px;color:var(--accent)}
    .lo-x{border:0;background:none;padding:2px 6px}
    .lo-h{font-weight:600;margin:10px 0 6px}
    .lo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
    .lo-grid button{height:48px;padding:4px;display:grid;place-items:center}
    .lo-grid button.on{background:var(--accent-soft);border-color:var(--accent)}
    .lo-grid svg{width:36px;height:36px}
    .lo-r{display:flex;gap:8px;align-items:center;margin-top:8px}
    .lo-r.dis{opacity:.45}
    .lo-more{display:inline-block;margin-top:12px;color:var(--accent);cursor:pointer}
    .lo-extra{margin-top:10px;display:grid;gap:8px}
    .lo-extra label{display:grid;gap:3px}
    .lo-tip{margin:10px 0 0;color:var(--muted);font-size:12px}
    .lo-panel .ln{stroke:var(--accent);stroke-width:1.6;stroke-linecap:round;fill:none}
    .lo-panel .ar,.img-open .ar{fill:var(--text)} .lo-panel .ar.faint{opacity:.3}
    .img-open .ln{stroke:var(--accent);stroke-width:1.6;stroke-linecap:round;fill:none}
    .img-grip{position:absolute;z-index:7;width:14px;height:14px;background:var(--accent);border:2px solid var(--surface);border-radius:4px;cursor:nwse-resize;touch-action:none}
    .img-grip[hidden]{display:none}`;
  document.head.appendChild(s);
})();

/* ---------------- Word processor (Quill) ---------------- */
/* CSS for Quill's class-based formats, so alignment/fonts/sizes/indents survive Export and Print. */
const DOC_CSS = `
  .ql-align-center{text-align:center}.ql-align-right{text-align:right}.ql-align-justify{text-align:justify}
  .ql-indent-1{padding-left:3em}.ql-indent-2{padding-left:6em}.ql-indent-3{padding-left:9em}.ql-indent-4{padding-left:12em}
  .ql-direction-rtl{direction:rtl;text-align:inherit}
  .ql-size-small{font-size:.75em}.ql-size-large{font-size:1.5em}.ql-size-huge{font-size:2.5em}
  .ql-font-arial{font-family:Arial,Helvetica,sans-serif}.ql-font-times{font-family:'Times New Roman',Times,serif}
  .ql-font-georgia{font-family:Georgia,serif}.ql-font-courier{font-family:'Courier New',monospace}
  .ql-font-verdana{font-family:Verdana,sans-serif}
  blockquote{border-left:4px solid #ccc;margin:0;padding-left:12px;color:#555}
  pre{background:#f4f4f4;padding:8px;font-family:'Courier New',monospace}
  img{max-width:100%}
  ${IMG_CSS}
  body{position:relative}`;

/* Register extra fonts (once) and show their names in the toolbar dropdown. */
(() => {
  const Font = Quill.import('formats/font');
  Font.whitelist = ['arial', 'times', 'georgia', 'courier', 'verdana'];
  Quill.register(Font, true);
  const st = document.createElement('style');
  st.textContent = ['arial:Arial', 'times:Times New Roman', 'georgia:Georgia', 'courier:Courier New', 'verdana:Verdana']
    .map(s => { const [k, n] = s.split(':');
      return `.ql-snow .ql-picker.ql-font .ql-picker-label[data-value=${k}]::before,.ql-snow .ql-picker.ql-font .ql-picker-item[data-value=${k}]::before{content:'${n}'}`; }).join('')
    + `.ql-editor .ql-font-arial{font-family:Arial,Helvetica,sans-serif}.ql-editor .ql-font-times{font-family:'Times New Roman',Times,serif}
    .ql-editor .ql-font-georgia{font-family:Georgia,serif}.ql-editor .ql-font-courier{font-family:'Courier New',monospace}
    .ql-editor .ql-font-verdana{font-family:Verdana,sans-serif}.ql-snow .ql-picker.ql-font{width:120px}`;
  document.head.appendChild(st);
})();

/* Word-style paper page (injected from JS so it never depends on a cached style.css) */
(() => {
  const s = document.createElement('style');
  s.textContent = `
    .docpage.ql-container.ql-snow{background:var(--surface-3);container-type:inline-size}
    .docpage .ql-editor{box-sizing:border-box;width:816px;max-width:calc(100% - 32px);height:auto;overflow:visible;
      min-height:1056px;margin:24px auto;padding:72px 96px;background:#fff;color:#111;
      border:1px solid var(--border);box-shadow:var(--sh-sm);font:15px/1.5 Calibri,Carlito,Arial,sans-serif}
    .docpage .ql-editor.ql-blank::before{left:96px;right:96px;color:#9aa3b2}
    .docpage .ql-editor blockquote{border-left-color:#ccc;color:#555}
    .docpage .ql-editor pre.ql-syntax{background:#f4f4f4;color:#111}
    @container (max-width:760px){.docpage .ql-editor{padding:40px 32px}.docpage .ql-editor.ql-blank::before{left:32px;right:32px}}`;
  document.head.appendChild(s);
})();
const PAGE_SIZES = { Letter: [816, 1056], A4: [794, 1123], Legal: [816, 1344], A3: [1123, 1587],
                     A5: [559, 794], Executive: [696, 1008], Tabloid: [1056, 1632] };
const MARGINS = { Normal: [72, 96], Narrow: [48, 48], Wide: [96, 120] };   // [top/bottom, left/right]
const PAGE_GAP = 24;



const wrapDoc = (inner, word, pageCss = '') => `<html ${word ? 'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"' : ''}>
  <head><meta charset="utf-8"><style>${pageCss}body{font:14px/1.6 Calibri,Arial,sans-serif;color:#111}${DOC_CSS}</style></head><body>${inner}</body></html>`;

APPS.word = { id: 'word', name: 'Documents', glyph: 'Dc', launch(file) {
  const st = { file }, w = WM.open({ title: file ? file.name : 'Untitled document', width: 900, height: 600 });
  w.body.innerHTML = `<div class="toolbar">
    <button data-a="save" class="primary" title="Save document (Ctrl+S)">Save</button>
    <button data-a="open" title="Open a Word (.docx) file">Open .docx</button>
    <button data-a="find" title="Find and replace text">Find &amp; Replace</button>
    <select data-pg="size" title="Page size">${Object.keys(PAGE_SIZES).map(s => `<option>${s}</option>`).join('')}</select>
    <select data-pg="orient" title="Orientation"><option value="p">Portrait</option><option value="l">Landscape</option></select>
    <select data-pg="margin" title="Margins">${Object.keys(MARGINS).map(s => `<option>${s}</option>`).join('')}</select>
    <button data-a="txt" title="Download as plain text">Export TXT</button>
    <button data-a="word" title="Download as a Word document">Export Word</button>
    <button data-a="pdf" title="Print or save as PDF">Export PDF</button>
    <span class="sp"></span><span class="muted" data-wc>0 words</span>
    <input type="file" accept=".docx" hidden></div><div id="q-${w.id}" class="fill docpage"></div>`;

  const q = new Quill(`#q-${w.id}`, { theme: 'snow', modules: {
    history: { delay: 800, maxStack: 200, userOnly: true },          // Ctrl+Z / Ctrl+Y
    toolbar: [
      [{ font: ['arial', 'times', 'georgia', 'courier', 'verdana'] }, { size: ['small', false, 'large', 'huge'] }],
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ script: 'sub' }, { script: 'super' }],
      [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
      [{ align: [] }, { direction: 'rtl' }],
      ['blockquote', 'code-block', 'link', 'image'],
      ['clean'] ] } });
  
  /* ---- Pagination ---- */
  const pg = { size: 'Letter', land: false, margin: 'Normal' };
  let busy = false, queued = false;

  const paginate = () => {
    const [bw, bh] = PAGE_SIZES[pg.size], W = pg.land ? bh : bw, H = pg.land ? bw : bh;
    const [mv, mh] = MARGINS[pg.margin], P = H + PAGE_GAP, C = H - 2 * mv, ed = q.root, S = ed.style;
    busy = true;
    Object.assign(S, { width: W + 'px', maxWidth: 'none', padding: `${mv}px ${mh}px`, minHeight: H + 'px',
      border: '0', boxShadow: 'none',
      background: `repeating-linear-gradient(to bottom,#fff 0,#fff ${H}px,var(--surface-3) ${H}px,var(--surface-3) ${P}px)` });

    const units = [...ed.children].flatMap(el => /^(UL|OL)$/.test(el.tagName) ? [...el.children] : [el]);
    units.forEach(u => { if (u.dataset.pb) { u.style.marginTop = ''; delete u.dataset.pb; } });

    const e0 = ed.getBoundingClientRect().top;
    const m = units.map(u => { const r = u.getBoundingClientRect();
      return { t: r.top - e0, h: r.height, mt: parseFloat(getComputedStyle(u).marginTop) || 0 }; });

    let extra = 0;
    units.forEach((u, i) => {
      const t = m[i].t + extra, h = m[i].h;
      if (h <= C) {
        const p = Math.floor(t / P), end = p * P + H - mv;
        if (t + h > end + 0.5) {
          const add = (p + 1) * P + mv - t;
          u.dataset.pb = '1'; u.style.marginTop = (m[i].mt + add) + 'px'; extra += add;
        }
      }
    });
    const last = units[units.length - 1];
    const lastBottom = last ? last.getBoundingClientRect().bottom - e0 : 0;
    const pages = Math.max(1, Math.floor((lastBottom - 1) / P) + 1);
    S.minHeight = (pages * H + (pages - 1) * PAGE_GAP) + 'px';
    setTimeout(() => busy = false);
  };
  const schedulePaginate = () => { if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; paginate(); }); };

  q.on('text-change', () => { if (!busy) schedulePaginate(); });
  q.root.addEventListener('load', schedulePaginate, true);
  document.fonts?.ready.then(schedulePaginate);
  w.body.querySelectorAll('[data-pg]').forEach(s => s.onchange = () => {
    const v = k => w.body.querySelector(`[data-pg=${k}]`).value;
    pg.size = v('size'); pg.land = v('orient') === 'l'; pg.margin = v('margin'); paginate();
  });
  paginate();

  const cleanHTML = () => {
    const c = q.root.cloneNode(true);
    c.querySelectorAll('[data-pb]').forEach(n => { n.removeAttribute('data-pb'); n.style.marginTop = '';
      if (!n.getAttribute('style')) n.removeAttribute('style'); });
    return c.innerHTML;
  };
  const pageCss = () => { const [bw, bh] = PAGE_SIZES[pg.size], [mv, mh] = MARGINS[pg.margin];
    return `@page{size:${pg.land ? bh : bw}px ${pg.land ? bw : bh}px;margin:${mv}px ${mh}px}`; };

    // Hover tooltips on the editor toolbar (like MS Word)
  const TIPS = { bold: 'Bold (Ctrl+B)', italic: 'Italic (Ctrl+I)', underline: 'Underline (Ctrl+U)', strike: 'Strikethrough',
    'script:sub': 'Subscript', 'script:super': 'Superscript', 'list:ordered': 'Numbered list', 'list:bullet': 'Bullet list',
    'indent:-1': 'Decrease indent', 'indent:+1': 'Increase indent', 'direction:rtl': 'Right-to-left text',
    blockquote: 'Quote', 'code-block': 'Code block', link: 'Insert link (Ctrl+K)', image: 'Insert image', clean: 'Clear formatting',
    font: 'Font', size: 'Font size', header: 'Heading style', color: 'Font color', background: 'Highlight color', align: 'Alignment' };
  q.getModule('toolbar').container.querySelectorAll('button, .ql-picker').forEach(el => {
    const kind = [...el.classList].find(c => c.startsWith('ql-') && c !== 'ql-picker' && c !== 'ql-formats')?.slice(3);
    const tip = TIPS[el.value ? `${kind}:${el.value}` : kind] || TIPS[kind];
    if (tip) (el.querySelector('.ql-picker-label') || el).title = tip;
  });

   if (file) api('/api/files/' + file.id).then(f => {
    q.root.innerHTML = f.content; q.root.querySelectorAll('img').forEach(syncImg); paginate(); });

  /* ---- Picture "Layout Options" panel (like Word) ---- */
  const WRAPS = [['square', 'Square'], ['tight', 'Tight'], ['through', 'Through'],
                 ['topbottom', 'Top and Bottom'], ['behind', 'Behind Text'], ['front', 'In Front of Text']];
  const freeW = k => k === 'behind' || k === 'front';
  const rid = 'anc' + w.id;
  const frame = document.createElement('div'); frame.className = 'img-frame'; frame.hidden = true;
  const opener = document.createElement('button'); opener.className = 'img-open'; opener.hidden = true;
  opener.title = 'Layout Options'; opener.innerHTML = LAYOUT_ICON.square;
  const mover = document.createElement('button'); mover.className = 'img-move'; mover.hidden = true;
  mover.title = 'Drag to move'; mover.innerHTML = '&#10021;';
  const panel = document.createElement('div'); panel.className = 'lo-panel'; panel.hidden = true;
  panel.innerHTML = `
    <div class="lo-head"><b>Layout Options</b><button class="lo-x" data-c="close" title="Close">&#10005;</button></div>
    <div class="lo-h">In Line with Text</div>
    <div class="lo-grid"><button data-w="inline" title="In Line with Text">${LAYOUT_ICON.inline}</button></div>
    <div class="lo-h">With Text Wrapping</div>
    <div class="lo-grid">${WRAPS.map(([k, t]) => `<button data-w="${k}" title="${t}">${LAYOUT_ICON[k]}</button>`).join('')}</div>
    <label class="lo-r"><input type="radio" name="${rid}" value="text"> Move with text</label>
    <label class="lo-r"><input type="radio" name="${rid}" value="page"> Fix position on page</label>
    <a class="lo-more" data-c="more">See more&hellip;</a>
    <div class="lo-extra" hidden>
      <label>Picture side <select data-f="side"><option value="left">Left</option><option value="right">Right</option></select></label>
      <label>Width (px) <input data-f="width" type="number" min="16"></label>
      <label>Alt text <input data-f="alt" type="text"></label>
    </div>
    <p class="lo-tip">Behind Text: Ctrl+click the picture to select it, drag the &#10021; handle to move it.</p>`;
  const grip = document.createElement('div'); grip.className = 'img-grip'; grip.hidden = true; grip.title = 'Drag to resize';
  w.body.append(frame, opener, mover, grip, panel);

  let pic = null;
   const hideUI = () => { pic = null; frame.hidden = opener.hidden = mover.hidden = grip.hidden = panel.hidden = true; };
   const scroller = () => {
    for (let n = q.root.parentElement; n && n !== w.el; n = n.parentElement)
      if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) return n;
    return w.body;
  };

  const showUI = () => {
    if (!pic || !pic.isConnected) return hideUI();
    const b = w.body.getBoundingClientRect(), r = pic.getBoundingClientRect(), v = scroller().getBoundingClientRect(),
          ox = w.body.scrollLeft - b.left, oy = w.body.scrollTop - b.top,
          top = Math.max(v.top, b.top), bottom = Math.min(v.bottom, b.bottom),   // visible part of the page area
          out = r.bottom < top || r.top > bottom;                                 // picture fully scrolled out of view
    frame.hidden = opener.hidden = out; mover.hidden = out || !isFree(pic);
    grip.hidden = out || r.bottom > bottom || r.bottom < top;   // only show when the corner is visible
    if (!out) {
      const vt = Math.max(r.top, top), vb = Math.min(r.bottom, bottom);
      Object.assign(frame.style, { left: r.left + ox + 'px', top: r.top + oy + 'px', width: r.width + 'px', height: r.height + 'px',
        clipPath: `inset(${vt - r.top}px 0 ${r.bottom - vb}px 0)` });             // cut off the part outside the page area
            Object.assign(grip.style, { left: r.right + ox - 7 + 'px', top: r.bottom + oy - 7 + 'px' });
      Object.assign(opener.style, { left: r.right + ox + 6 + 'px', top: vt + oy + 'px' });
      Object.assign(mover.style, { left: r.left + ox + r.width / 2 - 15 + 'px', top: (vt + vb) / 2 + oy - 15 + 'px' });
    }
    if (!panel.hidden) {
      panel.style.left = Math.max(4, Math.min(r.right + ox + 44, w.body.scrollLeft + b.width - panel.offsetWidth - 8)) + 'px';
      panel.style.top = Math.max(w.body.scrollTop + 4, Math.min(r.top + oy, w.body.scrollTop + b.height - panel.offsetHeight - 8)) + 'px';
    }
  };
  const syncPanel = () => {
    if (!pic) return;
    const wr = pic.dataset.wrap || 'inline', free = isFree(pic), f = k => panel.querySelector(`[data-f=${k}]`);
    panel.querySelectorAll('[data-w]').forEach(b => b.classList.toggle('on', b.dataset.w === wr));
    panel.querySelectorAll(`input[name="${rid}"]`).forEach(i => {
      i.checked = i.value === (pic.dataset.anchor || 'text'); i.disabled = !free; i.parentElement.classList.toggle('dis', !free); });
    f('side').value = pic.dataset.side || 'left'; f('side').disabled = !['square', 'tight', 'through'].includes(wr);
    f('width').value = Math.round(pic.getBoundingClientRect().width); f('alt').value = pic.alt || '';
  };
  // Apply format changes through Quill so Undo/Redo and Save keep working
  const fmt = f => {
    const b = Quill.find(pic); if (!b) return;
    q.formatText(q.getIndex(b), 1, f, 'user'); syncImg(pic); showUI();
  };
  const placeAt = r => {       // keep a picture where it is when it becomes free-floating
    const c = pic.dataset.anchor === 'page' ? q.root : pic.parentElement, cr = c.getBoundingClientRect();
    fmt({ 'data-x': String(Math.round(r.left - cr.left)), 'data-y': String(Math.round(r.top - cr.top)) });
  };
  const setWrap = wrap => {
    const was = pic.dataset.wrap || 'inline', r = pic.getBoundingClientRect();
    fmt({ 'data-wrap': wrap === 'inline' ? false : wrap,
          'data-anchor': freeW(wrap) ? (pic.dataset.anchor || 'text') : false,
          'data-side': ['square', 'tight', 'through'].includes(wrap) ? (pic.dataset.side || 'left') : false,
          ...(freeW(wrap) ? {} : { 'data-x': false, 'data-y': false }) });
    if (freeW(wrap) && !freeW(was)) placeAt(r);
  };
  const startDrag = e => {
    e.preventDefault();
    const x0 = +pic.dataset.x || 0, y0 = +pic.dataset.y || 0, sx = e.clientX, sy = e.clientY; let nx = x0, ny = y0;
    const move = m => { nx = Math.round(x0 + m.clientX - sx); ny = Math.round(y0 + m.clientY - sy);
      pic.style.setProperty('--x', nx + 'px'); pic.style.setProperty('--y', ny + 'px'); showUI(); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (nx !== x0 || ny !== y0) fmt({ 'data-x': String(nx), 'data-y': String(ny) }); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  q.root.addEventListener('pointerdown', e => {
    let img = e.target.tagName === 'IMG' ? e.target : null;
    if (!img && (e.ctrlKey || e.metaKey))       // Behind Text pictures sit under the text: Ctrl+click selects them
      img = [...q.root.querySelectorAll('img[data-wrap=behind]')].find(i => { const r = i.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; }) || null;
    if (!img) return hideUI();
    pic = img; syncImg(pic); panel.hidden = true; showUI();
    if (pic.dataset.wrap === 'front') startDrag(e);
  });
  q.root.addEventListener('dragstart', e => { if (e.target.tagName === 'IMG' && isFree(e.target)) e.preventDefault(); });
  q.on('text-change', () => { if (pic) showUI(); });
  w.body.addEventListener('scroll', () => { if (pic) showUI(); }, true);   // true = also catches inner scroll areas
  new ResizeObserver(() => { if (pic) showUI(); }).observe(w.body);       // window resize / maximize
  
  mover.onpointerdown = e => { if (pic) startDrag(e); };
    grip.onpointerdown = e => {
    if (!pic) return;
    e.preventDefault(); e.stopPropagation();
    const w0 = pic.getBoundingClientRect().width, sx = e.clientX; let nw = w0;
    const move = m => { nw = Math.max(24, Math.round(w0 + m.clientX - sx));
      pic.style.width = nw + 'px'; pic.style.height = 'auto'; showUI(); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      pic.style.width = ''; pic.style.height = '';
      fmt({ width: String(nw), height: false }); syncPanel(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  opener.onclick = () => { panel.hidden = !panel.hidden; syncPanel(); showUI(); };
  panel.onclick = e => {
    const b = e.target.closest('button, a'); if (!b || !pic) return;
    if (b.dataset.w) setWrap(b.dataset.w);
    if (b.dataset.c === 'close') panel.hidden = true;
    if (b.dataset.c === 'more') panel.querySelector('.lo-extra').hidden = !panel.querySelector('.lo-extra').hidden;
    syncPanel(); showUI();
  };
  panel.onchange = e => {
    const t = e.target; if (!pic) return;
    if (t.name === rid) { const r = pic.getBoundingClientRect(); fmt({ 'data-anchor': t.value }); placeAt(r); }
    const k = t.dataset.f;
    if (k === 'side') fmt({ 'data-side': t.value });
    if (k === 'alt') fmt({ alt: t.value || false });
    if (k === 'width' && +t.value >= 16) fmt({ width: String(Math.round(+t.value)), height: false });
    syncPanel();
  };

    
  // Live word / character count
  const wc = w.body.querySelector('[data-wc]');
  const count = () => { const t = q.getText().trim(); wc.textContent = `${t ? t.split(/\s+/).length : 0} words · ${t.length} chars`; };
  q.on('text-change', count); count();

  const save = async () => { const f = await saveFile(st, 'doc', cleanHTML(), 'Untitled.doc'); f && w.setTitle(f.name); };
  q.root.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });

  const input = w.body.querySelector('input[type=file]');
  input.onchange = async () => {              // import a real Word file (uses mammoth, already loaded)
    const f = input.files[0]; if (!f) return;
    try { const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
      q.clipboard.dangerouslyPasteHTML(0, r.value); paginate(); }
    catch (err) { alert('Could not open that Word file: ' + err.message); }
    input.value = '';
  };

  const findReplace = () => {
    const needle = prompt('Find:'); if (!needle) return;
    const text = q.getText(), hits = []; let i = -1;
    while ((i = text.toLowerCase().indexOf(needle.toLowerCase(), i + 1)) !== -1) hits.push(i);
    if (!hits.length) return alert('No matches found.');
    const rep = prompt(`${hits.length} match(es) found. Replace all with (Cancel to just highlight):`);
    if (rep === null) { hits.forEach(h => q.formatText(h, needle.length, 'background', '#ffe066')); return; }
    for (const h of hits.reverse()) { q.deleteText(h, needle.length); q.insertText(h, rep); }
  };

  w.body.querySelector('.toolbar').onclick = async e => {
    const a = e.target.dataset.a; if (!a) return;
    const name = st.file?.name?.replace(/\.[^.]+$/, '') || 'document';
    if (a === 'save') save();
    if (a === 'open') input.click();
    if (a === 'find') findReplace();
    if (a === 'txt') download(name + '.txt', q.getText());
    if (a === 'word') download(name + '.doc', wrapDoc(cleanHTML(), true, pageCss()), 'application/msword');   // opens in MS Word
    if (a === 'pdf') { const p = open('', '_blank'); p.document.write(wrapDoc(cleanHTML(), false, pageCss())); p.document.close(); p.print(); }
  };
} };

/* ---------------- Spreadsheet (Handsontable + HyperFormula) ---------------- */
const SHEET_FMT = {
  int: n => Math.round(n).toLocaleString('en-US'),
  num: n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  usd: n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
  php: n => '₱' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: n => (n * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%' };
const SHEET_XLSX_FMT = { int: '#,##0', num: '#,##0.00', usd: '"$"#,##0.00', php: '"₱"#,##0.00', pct: '0.00%' };
const sheetColName = c => { let s = ''; for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s; return s; };
const sheetColIdx = s => s.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const sheetAddr = (r, c) => sheetColName(c) + (r + 1);
const sheetIsNum = v => typeof v === 'number' ? !isNaN(v) : (typeof v === 'string' && v.trim() !== '' && !isNaN(+v));
/* Moves relative row numbers in a formula by d rows (used when sorting, like Excel does) */
const shiftRefs = (f, d) => f.replace(/(?<![A-Za-z0-9_.$])(\$?[A-Za-z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g,
  (m, c, abs, n) => abs || +n + d < 1 ? m : c + (+n + d));
/* Filter conditions: plain text = "contains"; or  >50  <=10  =Pass  <>Absent */
const sheetMatcher = txt => {
  const m = txt.match(/^(>=|<=|<>|>|<|=)\s*(.*)$/);
  if (!m) { const t = txt.toLowerCase(); return v => String(v ?? '').toLowerCase().includes(t); }
  const op = m[1], rhs = m[2].trim(), n = parseFloat(rhs), numeric = rhs !== '' && !isNaN(+rhs);
  return v => {
    if (numeric && sheetIsNum(v)) { const a = +v;
      return op === '>' ? a > n : op === '<' ? a < n : op === '>=' ? a >= n : op === '<=' ? a <= n : op === '=' ? a === n : a !== n; }
    const s = String(v ?? '').toLowerCase(), t = rhs.toLowerCase();
    return op === '=' ? s === t : op === '<>' ? s !== t : false; };
};
(() => {
  const s = document.createElement('style');
  s.textContent = `
    .sheet-tb{gap:4px;padding:5px 8px;align-items:center}
    .sheet-tb button{padding:4px 9px}
    .sheet-tb button.tb-on{background:var(--accent-soft);border-color:var(--accent)}
    .tb-sep{width:1px;align-self:stretch;margin:2px 4px;background:var(--border)}
    .tb-color{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:var(--surface-2)}
    .tb-color input{width:22px;height:20px;padding:0;border:0;background:none;cursor:pointer}
    .tb-chk{display:inline-flex;gap:4px;align-items:center;color:var(--muted);font-size:12.5px}
    .fbar{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--border);flex:none}
    .fbar .namebox{width:92px;text-align:center}
    .fbar .fx{color:var(--muted);font-style:italic;padding:0 2px}
    .fbar .fxinput{flex:1;min-width:0;font-family:Consolas,monospace}
    .sbar{display:flex;gap:16px;align-items:center;padding:4px 10px;border-top:1px solid var(--border);flex:none;font-size:12.5px;color:var(--muted)}
    .sbar .sp{flex:1}
    .sheet-grid{position:relative;overflow:hidden}
    .sheet-grid>[data-hot]{position:absolute;left:0;top:0}`;
  document.head.appendChild(s);
})();

APPS.sheet = { id: 'sheet', name: 'Spreadsheet', glyph: 'Sp', launch(file) {
  const st = { file }, w = WM.open({ title: file ? file.name : 'Untitled sheet', width: 1000, height: 640 });
  const DEF_W = 100, ROW_H = 26, widths = {}, baseRenderer = Handsontable.renderers.getRenderer('text');
  w.body.innerHTML = `
    <div class="toolbar sheet-tb">
      <button data-a="save" class="primary" title="Save (Ctrl+S)">Save</button>
      <button data-a="open" title="Open an .xlsx or .csv file">Open file</button>
      <button data-a="csv">Export CSV</button><button data-a="xlsx">Export XLSX</button>
      <span class="tb-sep"></span>
      <button data-a="undo" title="Undo (Ctrl+Z)">Undo</button><button data-a="redo" title="Redo (Ctrl+Y)">Redo</button>
      <span class="tb-sep"></span>
      <button data-a="b" title="Bold"><b>B</b></button><button data-a="i" title="Italic"><i>I</i></button><button data-a="u" title="Underline"><u>U</u></button>
      <label class="tb-color" title="Text color">A<input type="color" value="#000000" data-c="color"></label>
      <label class="tb-color" title="Fill color">Fill<input type="color" value="#ffff00" data-c="bg"></label>
      <button data-a="bd" title="Borders on the selection">Borders</button>
      <button data-a="merge" title="Merge or unmerge the selected cells">Merge</button>
      <span class="tb-sep"></span>
      <button data-a="left">Left</button><button data-a="center">Center</button><button data-a="right">Right</button>
      <select data-fmt title="Number format"><option value="">General</option><option value="int">Integer</option>
        <option value="num">Number 1,234.56</option><option value="usd">$ Currency</option><option value="php">₱ Currency</option><option value="pct">Percent</option></select>
      <button data-a="clearfmt">Clear format</button>
    </div>
    <div class="toolbar sheet-tb">
      <button data-a="sum" title="Add up the numbers above or beside the cursor">&Sigma; AutoSum</button>
      <button data-a="asc" title="Sort by the selected column">Sort A&rarr;Z</button><button data-a="desc">Sort Z&rarr;A</button>
      <label class="tb-chk"><input type="checkbox" data-hdr checked> First row is a header</label>
      <button data-a="filter" title="Show only rows that match a condition">Filter</button>
      <select data-freeze title="Freeze panes"><option value="0,0">No freeze</option><option value="1,0">Freeze top row</option>
        <option value="0,1">Freeze first column</option><option value="1,1">Freeze row + column</option></select>
      <button data-a="chart" title="Make a chart from the selected cells">Chart</button>
      <button data-a="find">Find &amp; Replace</button>
    </div>
    <div class="fbar"><input class="namebox" data-name spellcheck="false" title="Cell reference">
      <span class="fx">fx</span><input class="fxinput" data-fx spellcheck="false" placeholder="Type a value or a formula, for example =SUM(A1:A5)"></div>
    <div class="fill sheet-grid"><div data-hot></div></div>
    <div class="sbar"><span data-stat></span><span class="sp"></span><span data-dirty>Saved</span></div>
    <input type="file" accept=".csv,.xlsx,.xls" hidden>`;
  const $q = s => w.body.querySelector(s);
  const host = $q('.sheet-grid'), cont = $q('[data-hot]'), nameBox = $q('[data-name]'), fx = $q('[data-fx]'), stat = $q('[data-stat]'),
        dirtyEl = $q('[data-dirty]'), fmtSel = $q('[data-fmt]'), freezeSel = $q('[data-freeze]'), hdr = $q('[data-hdr]'), fileIn = $q('input[type=file]');
  const blank = () => Array.from({ length: 100 }, () => Array(26).fill(''));
  let hidden = [], ready = false;                         // hidden = rows hidden by the filter
  const setDirty = d => { dirtyEl.textContent = d ? '● Unsaved changes' : 'Saved'; };

  /* Draws each cell with its saved formatting (bold, colors, number format, borders...) */
  function styledRenderer(inst, td, row, col, prop, value, cp) {
    baseRenderer.apply(this, arguments);
    const s = cp.sty || {}, num = sheetIsNum(value) ? +value : null;
    if (num !== null && SHEET_FMT[s.fmt]) td.textContent = SHEET_FMT[s.fmt](num);
    td.style.textAlign = s.align || (num !== null ? 'right' : '');
    td.style.fontWeight = s.b ? '700' : ''; td.style.fontStyle = s.i ? 'italic' : '';
    td.style.textDecoration = s.u ? 'underline' : '';
    td.style.color = s.color || ''; td.style.backgroundColor = s.bg || '';
    td.style.boxShadow = s.bd ? 'inset 0 0 0 1px #333' : '';
  }

  /* The grid lives in its own box (cont) that is sized from the outer box (host), so it can grow with the window */
  cont.style.width = host.clientWidth + 'px'; cont.style.height = host.clientHeight + 'px';
  const hot = new Handsontable(cont, {
    data: blank(), renderer: styledRenderer,
    rowHeaders: true, colHeaders: true, rowHeights: ROW_H, colWidths: c => widths[c] || DEF_W,
    width: host.clientWidth || 900, height: host.clientHeight || 400, minRows: 100, minCols: 26,
    contextMenu: true, manualColumnResize: true, manualRowResize: true, mergeCells: true,
    hiddenRows: { indicators: true }, outsideClickDeselects: false, fillHandle: true,
    formulas: { engine: HyperFormula }, licenseKey: 'non-commercial-and-evaluation',
    afterSelection: () => { if (ready) updateBars(); },
    afterChange: (ch, src) => { if (src === 'loadData') return; setDirty(true); if (ready) updateBars(); },
    afterColumnResize: (size, col) => { widths[col] = Math.round(size); setDirty(true); },
    afterMergeCells: () => setDirty(true), afterUnmergeCells: () => setDirty(true) });

  /* Make the grid fill the whole window: add columns/rows until the screen is covered */
  const fit = () => {
    const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return;
    cont.style.width = W + 'px'; cont.style.height = H + 'px';
    hot.updateSettings({ width: W, height: H,
      minCols: Math.max(26, Math.ceil((W - 60) / DEF_W) + 1), minRows: Math.max(100, Math.ceil(H / ROW_H) + 2) });
    hot.refreshDimensions();
  };
  const ro = new ResizeObserver(fit); ro.observe(host); fit();
  w.onClose = () => { ro.disconnect(); hot.destroy(); };

  /* ---- selection helpers ---- */
  const sel = () => { const s = hot.getSelectedLast();
    return s ? { r1: Math.max(0, Math.min(s[0], s[2])), r2: Math.max(0, s[0], s[2]), c1: Math.max(0, Math.min(s[1], s[3])), c2: Math.max(0, s[1], s[3]) } : null; };
  const active = () => { const rg = hot.getSelectedRangeLast();
    return rg ? { row: Math.max(0, rg.highlight.row), col: Math.max(0, rg.highlight.col) } : null; };
  const eachCell = fn => (hot.getSelected() || []).forEach(([a, b, c, d]) => {
    for (let r = Math.max(0, Math.min(a, c)); r <= Math.max(a, c); r++)
      for (let k = Math.max(0, Math.min(b, d)); k <= Math.max(b, d); k++) fn(r, k); });

  /* ---- name box, formula bar, status bar ---- */
  const updateBars = () => {
    const a = active(), r = sel(); if (!a || !r) return;
    if (document.activeElement !== nameBox)
      nameBox.value = (r.r1 === r.r2 && r.c1 === r.c2) ? sheetAddr(a.row, a.col) : sheetAddr(r.r1, r.c1) + ':' + sheetAddr(r.r2, r.c2);
    if (document.activeElement !== fx) {
      const raw = hot.getSourceDataAtCell(hot.toPhysicalRow(a.row), hot.toPhysicalColumn(a.col)); fx.value = raw ?? ''; }
    const s = hot.getCellMeta(a.row, a.col).sty || {};
    ['b', 'i', 'u', 'bd'].forEach(k => $q(`[data-a=${k}]`).classList.toggle('tb-on', !!s[k]));
    ['left', 'center', 'right'].forEach(k => $q(`[data-a=${k}]`).classList.toggle('tb-on', s.align === k));
    fmtSel.value = s.fmt || '';
    const cnt = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
    if (cnt > 1 && cnt <= 50000) {
      const nums = []; hot.getData(r.r1, r.c1, r.r2, r.c2).forEach(row => row.forEach(v => { if (sheetIsNum(v)) nums.push(+v); }));
      const f = n => n.toLocaleString('en-US', { maximumFractionDigits: 4 }), sum = nums.reduce((x, y) => x + y, 0);
      stat.textContent = nums.length
        ? `Count: ${nums.length}    Sum: ${f(sum)}    Average: ${f(sum / nums.length)}    Min: ${f(nums.reduce((m, x) => Math.min(m, x), Infinity))}    Max: ${f(nums.reduce((m, x) => Math.max(m, x), -Infinity))}`
        : `${cnt} cells selected`;
    } else stat.textContent = '';
  };
  nameBox.onkeydown = e => {
    if (e.key !== 'Enter') return;
    const m = nameBox.value.trim().match(/^([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?$/);
    if (m) { const r1 = +m[2] - 1, c1 = sheetColIdx(m[1]), r2 = m[4] ? +m[4] - 1 : r1, c2 = m[3] ? sheetColIdx(m[3]) : c1;
      hot.selectCell(r1, c1, r2, c2, true); }
    nameBox.blur(); hot.listen(); updateBars();
  };
  fx.onkeydown = e => {
    const a = active(); if (!a) return;
    if (e.key === 'Enter') { hot.setDataAtCell(a.row, a.col, fx.value); fx.blur();
      hot.selectCell(Math.min(a.row + 1, hot.countRows() - 1), a.col); hot.listen(); }
    if (e.key === 'Escape') { fx.blur(); updateBars(); hot.listen(); }
  };

  /* ---- formatting ---- */
  const style = patch => {
    eachCell((r, c) => {
      const s = Object.assign({}, hot.getCellMeta(r, c).sty, patch);
      Object.keys(s).forEach(k => { if (s[k] === false || s[k] === '' || s[k] == null) delete s[k]; });
      hot.setCellMeta(r, c, 'sty', Object.keys(s).length ? s : undefined);
    });
    hot.render(); setDirty(true); updateBars();
  };
  const toggle = k => { const a = active(); if (a) style({ [k]: !(hot.getCellMeta(a.row, a.col).sty || {})[k] }); };
  const clearFmt = () => { eachCell((r, c) => hot.setCellMeta(r, c, 'sty', undefined)); hot.render(); setDirty(true); updateBars(); };
  const merge = () => { const rg = hot.getSelectedRangeLast(); if (!rg) return;
    hot.getPlugin('mergeCells').toggleMerge(rg); hot.render(); setDirty(true); };

  /* ---- AutoSum ---- */
  const autosum = () => {
    const s = sel(); if (!s) return;
    const set = list => hot.setDataAtCell(list);
    if (s.r1 === s.r2 && s.c1 === s.c2) {
      let r = s.r1 - 1; while (r >= 0 && sheetIsNum(hot.getDataAtCell(r, s.c1))) r--;
      if (r < s.r1 - 1) return set([[s.r1, s.c1, `=SUM(${sheetAddr(r + 1, s.c1)}:${sheetAddr(s.r1 - 1, s.c1)})`]]);
      let c = s.c1 - 1; while (c >= 0 && sheetIsNum(hot.getDataAtCell(s.r1, c))) c--;
      if (c < s.c1 - 1) return set([[s.r1, s.c1, `=SUM(${sheetAddr(s.r1, c + 1)}:${sheetAddr(s.r1, s.c1 - 1)})`]]);
      return alert('Click the cell under (or to the right of) a run of numbers, or select the numbers first.');
    }
    if (s.r2 > s.r1) set(Array.from({ length: s.c2 - s.c1 + 1 }, (_, i) =>
      [s.r2 + 1, s.c1 + i, `=SUM(${sheetAddr(s.r1, s.c1 + i)}:${sheetAddr(s.r2, s.c1 + i)})`]));
    else set([[s.r1, s.c2 + 1, `=SUM(${sheetAddr(s.r1, s.c1)}:${sheetAddr(s.r1, s.c2)})`]]);
  };

  /* ---- Sort (changes the data, moves formatting with it, adjusts formulas in moved rows) ---- */
  const sortRows = asc => {
    const hl = active(), s = sel(); if (!hl) return alert('Click a cell in the column you want to sort by.');
    if (hidden.length) return alert('Clear the filter before sorting.');
    const src = hot.getSourceData().map(r => r.slice()), val = hot.getData();
    let last = -1; src.forEach((row, r) => { if (row.some(v => v !== '' && v != null)) last = r; });
    const multi = s.r2 > s.r1, a = multi ? s.r1 : (hdr.checked ? 1 : 0), b = multi ? Math.min(s.r2, last) : last;
    if (b <= a) return;
    const idx = Array.from({ length: b - a + 1 }, (_, i) => a + i), col = hl.col, isBlank = v => v === '' || v == null;
    idx.sort((x, y) => {
      const p = val[x][col], q = val[y][col];
      if (isBlank(p) || isBlank(q)) return isBlank(p) && isBlank(q) ? x - y : isBlank(p) ? 1 : -1;
      const np = typeof p === 'number', nq = typeof q === 'number';
      const d = np && nq ? p - q : np ? -1 : nq ? 1 : String(p).localeCompare(String(q), undefined, { numeric: true, sensitivity: 'base' });
      return d === 0 ? x - y : asc ? d : -d; });
    const cols = hot.countCols(), changes = [];
    const stys = idx.map(from => Array.from({ length: cols }, (_, c) => hot.getCellMeta(from, c).sty));
    idx.forEach((from, i) => src[from].forEach((cell, c) => {
      const nv = typeof cell === 'string' && cell[0] === '=' ? shiftRefs(cell, a + i - from) : cell;
      if (nv !== src[a + i][c]) changes.push([a + i, c, nv]); }));
    if (changes.length) hot.setDataAtCell(changes);
    stys.forEach((row, i) => row.forEach((s2, c) => hot.setCellMeta(a + i, c, 'sty', s2)));
    hot.render(); setDirty(true);
  };

  /* ---- Filter (hides rows; a view only, not saved) ---- */
  const filterRows = () => {
    const a = active(); if (!a) return alert('Click a cell in the column you want to filter first.');
    const txt = prompt(`Filter column ${sheetColName(a.col)}.\nType text to match, or a condition such as  >50   <=10   =Pass   <>Absent\nLeave empty to show all rows.`);
    if (txt === null) return;
    const hr = hot.getPlugin('hiddenRows');
    if (hidden.length) hr.showRows(hidden);
    hidden = [];
    if (txt.trim()) {
      const ok = sheetMatcher(txt.trim()), val = hot.getData(), src = hot.getSourceData();
      let last = -1; src.forEach((row, r) => { if (row.some(v => v !== '' && v != null)) last = r; });
      for (let r = hdr.checked ? 1 : 0; r <= last; r++) if (!ok(val[r][a.col])) hidden.push(r);
      if (hidden.length) hr.hideRows(hidden);
    }
    $q('[data-a=filter]').classList.toggle('tb-on', hidden.length > 0);
    hot.render();
  };

  /* ---- Find & Replace ---- */
  const findReplace = () => {
    const needle = prompt('Find:'); if (!needle) return;
    const src = hot.getSourceData(), low = needle.toLowerCase(), hits = [];
    src.forEach((row, r) => row.forEach((raw, c) => { if (raw !== '' && raw != null && String(raw).toLowerCase().includes(low)) hits.push([r, c]); }));
    if (!hits.length) return alert('No matches found.');
    hot.selectCell(hits[0][0], hits[0][1], hits[0][0], hits[0][1], true);
    const rep = prompt(`${hits.length} cell(s) match. Replace all with (Cancel to just jump to the first match):`);
    if (rep === null) return;
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    hot.setDataAtCell(hits.map(([r, c]) => [r, c, String(src[r][c]).replace(re, () => rep)]));
  };

  /* ---- Chart (opens in its own window) ---- */
  const openChart = () => {
    const r = sel(); if (!r) return alert('Select the cells to chart first: labels in the first column, numbers in the other columns.');
    if (typeof Chart === 'undefined') return alert('The chart library did not load. Check your internet connection and refresh the page.');
    const cw = WM.open({ title: 'Chart', width: 640, height: 440 });
    cw.body.innerHTML = `<div class="toolbar"><select><option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option></select>
      <label class="tb-chk"><input type="checkbox" checked> First row is a header</label><button data-a="ref">Refresh from sheet</button></div>
      <div class="fill" style="position:relative;padding:12px"><canvas></canvas></div>`;
    const typeSel = cw.body.querySelector('select'), head = cw.body.querySelector('input'), cv = cw.body.querySelector('canvas');
    const COLORS = ['#3b6cf5', '#1f9d6b', '#e0912f', '#7a5af8', '#d64545', '#0f9fb5', '#8a8f98', '#c2569e'];
    let chart;
    const draw = () => {
      const rows = hot.getData(r.r1, r.c1, r.r2, r.c2), hasH = head.checked && rows.length > 1, body = hasH ? rows.slice(1) : rows;
      const multi = r.c2 > r.c1, first = multi ? 1 : 0, labels = body.map((row, i) => multi ? String(row[0] ?? '') : String(i + 1));
      const sets = [];
      for (let c = first; c <= r.c2 - r.c1; c++)
        sets.push({ label: hasH ? String(rows[0][c] ?? '') : `Series ${c - first + 1}`, data: body.map(row => sheetIsNum(row[c]) ? +row[c] : 0) });
      const pie = typeSel.value === 'pie';
      if (chart) chart.destroy();
      chart = new Chart(cv, { type: typeSel.value,
        data: { labels, datasets: sets.map((s, i) => ({ ...s,
          backgroundColor: pie ? labels.map((_, k) => COLORS[k % COLORS.length]) : COLORS[i % COLORS.length], borderColor: COLORS[i % COLORS.length] })) },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: sets.length > 1 || pie } } } });
    };
    typeSel.onchange = draw; head.onchange = draw; cw.body.querySelector('[data-a=ref]').onclick = draw;
    cw.onClose = () => chart && chart.destroy();
    draw();
  };

  /* ---- Save / load (keeps values, formulas, formatting, widths, merges, freeze) ---- */
  const serialize = () => {
    const src = hot.getSourceData(); let lr = -1, lc = -1;
    src.forEach((row, r) => row.forEach((v, c) => { if (v !== '' && v != null) { lr = Math.max(lr, r); lc = Math.max(lc, c); } }));
    const sty = {};
    for (let r = 0; r < hot.countRows(); r++) for (let c = 0; c < hot.countCols(); c++) {
      const s = hot.getCellMeta(r, c).sty; if (s) sty[r + ',' + c] = s; }
    const merges = hot.getPlugin('mergeCells').mergedCellsCollection.mergedCells
      .map(m => ({ row: m.row, col: m.col, rowspan: m.rowspan, colspan: m.colspan }));
    return JSON.stringify({ v: 2, data: src.slice(0, lr + 1).map(row => row.slice(0, lc + 1).map(x => x == null ? '' : x)),
      sty, widths, freeze: freezeSel.value, merges });
  };
  const load = o => {
    if (hidden.length) { hot.getPlugin('hiddenRows').showRows(hidden); hidden = []; $q('[data-a=filter]').classList.remove('tb-on'); }
    for (let r = 0; r < hot.countRows(); r++) for (let c = 0; c < hot.countCols(); c++)
      if (hot.getCellMeta(r, c).sty) hot.setCellMeta(r, c, 'sty', undefined);
    Object.keys(widths).forEach(k => delete widths[k]); Object.assign(widths, o.widths || {});
    hot.loadData(o.data && o.data.length ? o.data : blank());
    freezeSel.value = o.freeze || '0,0';
    const [fr, fc] = freezeSel.value.split(',').map(Number);
    hot.updateSettings({ colWidths: c => widths[c] || DEF_W, fixedRowsTop: fr, fixedColumnsStart: fc, mergeCells: o.merges || [] });
    Object.entries(o.sty || {}).forEach(([k, s]) => { const [r, c] = k.split(',').map(Number); hot.setCellMeta(r, c, 'sty', s); });
    hot.render(); updateBars();
  };
  const save = async () => { const f = await saveFile(st, 'sheet', serialize(), 'Untitled.sheet'); if (f) { w.setTitle(f.name); setDirty(false); } };
  if (file) api('/api/files/' + file.id).then(f => {
    let o; try { o = JSON.parse(f.content || '[]'); } catch { o = []; }
    load(Array.isArray(o) ? { data: o } : o); setDirty(false); });

  /* ---- Open / export files ---- */
  const parseCSV = t => t.trim().split(/\r?\n/).map(l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || [])
    .filter((_, i, a) => i < a.length - 1 || _ !== '').map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
  const wsToRows = ws => {
    if (!ws || !ws['!ref']) return [];
    const rg = XLSX.utils.decode_range(ws['!ref']), rows = [];
    for (let r = 0; r <= rg.e.r; r++) { const row = [];
      for (let c = 0; c <= rg.e.c; c++) { const cell = ws[XLSX.utils.encode_cell({ r, c })];
        row.push(!cell ? '' : cell.f ? '=' + cell.f : cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : cell.v ?? ''); }
      rows.push(row); }
    return rows;
  };
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try {
      if (f.name.toLowerCase().endsWith('.csv')) load({ data: parseCSV(await f.text()) });
      else { if (typeof XLSX === 'undefined') throw new Error('the Excel library did not load (check your internet connection)');
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
        load({ data: wsToRows(wb.Sheets[wb.SheetNames[0]]) }); }
      setDirty(true);
    } catch (err) { alert('Could not open that file: ' + err.message); }
  };
  const baseName = () => (st.file?.name || 'sheet').replace(/\.[^.]+$/, '');
  const exportCsv = () => hot.getPlugin('exportFile').downloadFile('csv', { filename: baseName(), columnHeaders: false });
  const exportXlsx = () => {
    if (typeof XLSX === 'undefined') return alert('The Excel library did not load. Check your internet connection and refresh the page.');
    const src = hot.getSourceData(), val = hot.getData(), ws = {}; let maxR = -1, maxC = -1;
    src.forEach((row, r) => row.forEach((raw, c) => {
      if (raw === '' || raw == null) return;
      const v = val[r][c], isF = typeof raw === 'string' && raw[0] === '=';
      const cell = typeof v === 'boolean' ? { t: 'b', v } : sheetIsNum(v) ? { t: 'n', v: +v } : { t: 's', v: String(v ?? '') };
      if (isF) cell.f = raw.slice(1);
      const z = SHEET_XLSX_FMT[(hot.getCellMeta(r, c).sty || {}).fmt]; if (z && cell.t === 'n') cell.z = z;
      ws[XLSX.utils.encode_cell({ r, c })] = cell; maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
    }));
    ws['!ref'] = maxR < 0 ? 'A1' : XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); XLSX.writeFile(wb, baseName() + '.xlsx');
  };

  /* ---- wire up the toolbar ---- */
  const ACTIONS = { save, open: () => fileIn.click(), csv: exportCsv, xlsx: exportXlsx,
    undo: () => hot.undo(), redo: () => hot.redo(),
    b: () => toggle('b'), i: () => toggle('i'), u: () => toggle('u'), bd: () => toggle('bd'),
    left: () => style({ align: 'left' }), center: () => style({ align: 'center' }), right: () => style({ align: 'right' }),
    clearfmt: clearFmt, merge, sum: autosum, asc: () => sortRows(true), desc: () => sortRows(false),
    filter: filterRows, chart: openChart, find: findReplace };
  w.body.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a && ACTIONS[a]) ACTIONS[a](); });
  w.body.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.c) style({ [t.dataset.c]: t.value });
    if (t.matches('[data-fmt]')) style({ fmt: t.value });
    if (t.matches('[data-freeze]')) { const [r, c] = t.value.split(',').map(Number);
      hot.updateSettings({ fixedRowsTop: r, fixedColumnsStart: c }); setDirty(true); }
  });
  w.body.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
  ready = true; hot.selectCell(0, 0); updateBars();
} };

/* ---------------- Developer suite (Monaco + backend runner) ---------------- */
const LANG_BY_EXT = { py: 'python', c: 'c', cpp: 'cpp', java: 'java', html: 'html', css: 'css', js: 'javascript' };
const STARTERS = {
  python: 'print("Hello, Lab!")\n', c: '#include <stdio.h>\nint main(){ printf("Hello, Lab!\\n"); return 0; }\n',
  cpp: '#include <iostream>\nint main(){ std::cout << "Hello, Lab!\\n"; }\n',
  java: 'public class Main {\n  public static void main(String[] a){ System.out.println("Hello, Lab!"); }\n}\n',
  html: '<!doctype html>\n<h1>Hello, Lab!</h1>\n<style>h1{font-family:sans-serif}</style>\n<script>console.log("hi")<\/script>\n' };
let monacoReady;
const loadMonaco = () => monacoReady ||= new Promise(res => {
  require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
  require(['vs/editor/editor.main'], () => res(window.monaco));
});
const PLAIN_LANG = { json: 'json', md: 'markdown', xml: 'xml', sql: 'sql', yml: 'yaml', yaml: 'yaml' };

const SERVER_LANGS = ['python', 'c', 'cpp', 'java', 'javascript'];   // languages that print to the output panel

/* JavaScript runs in a background Worker: console.log prints to the output panel, and it is stopped if it runs too long. */
function runJS(code, out) {
  const lines = []; let wk, stopT, ended = false, finished = false, gotErr = false, url;
  const render = () => { out.textContent = lines.length ? lines.join('\n') : (finished ? '(no output)' : 'Running…'); out.scrollTop = out.scrollHeight; };
  const stop = () => { ended = true; clearTimeout(stopT); wk && wk.terminate(); url && URL.revokeObjectURL(url); };
  const hint = m => /\b(document|window|alert|prompt|localStorage)\b/.test(m) && /not defined/.test(m)
    ? '\n(Browser features such as document and alert need HTML mode: choose "html" and put your code inside <script> tags.)' : '';
  const pre = "const __f=v=>typeof v==='string'?v:(()=>{try{return JSON.stringify(v,null,2)??String(v)}catch(e){return String(v)}})();"
    + "for(const k of['log','info','warn','error','debug'])console[k]=(...a)=>postMessage({k,m:a.map(__f).join(' ')});"
    + "addEventListener('error',e=>{e.preventDefault();postMessage({k:'err',m:e.message,l:e.lineno})});"
    + "addEventListener('unhandledrejection',e=>{e.preventDefault();postMessage({k:'err',m:'Unhandled promise rejection: '+e.reason})});\n";
  url = URL.createObjectURL(new Blob([pre, code, '\n;postMessage({k:"done"});'], { type: 'text/javascript' }));
  render();
  wk = new Worker(url);
  stopT = setTimeout(() => { if (ended) return; lines.push('[stopped: the program ran longer than 8 seconds]'); finished = true; render(); stop(); }, 8000);
  wk.onmessage = e => {
    if (ended) return; const d = e.data;
    if (d.k === 'done') { finished = true; clearTimeout(stopT); stopT = setTimeout(stop, 3000); }   // allow timers a few more seconds
    else if (d.k === 'err') { gotErr = true; lines.push('Error: ' + d.m + (d.l > 1 ? ` (line ${d.l - 1})` : '') + hint(d.m)); finished = true; }
    else lines.push(d.m);
    if (lines.length > 2000) { lines.push('[output limit reached]'); stop(); }
    render();
  };
  wk.onerror = e => {            // syntax errors are reported here
    e.preventDefault(); if (ended || gotErr) return;
    lines.push('Error: ' + e.message + (e.lineno > 1 ? ` (line ${e.lineno - 1})` : '')); finished = true; render(); stop();
  };
}

APPS.ide = { id: 'ide', name: 'Code Editor', glyph: '</>', async launch(file) {
  const st = { file }, w = WM.open({ title: file ? file.name : 'Code Editor', width: 860, height: 580 });
  const ext = file ? file.name.split('.').pop().toLowerCase() : '';
  const plain = !!file && !LANG_BY_EXT[ext];
  w.body.innerHTML = `<div class="toolbar"><select>${['python', 'c', 'cpp', 'java', 'html', 'css', 'javascript']
    .map(l => `<option>${l}</option>`).join('')}</select>
    <button data-a="run" class="primary">Run</button><button data-a="save">Save</button>
    <span class="sp"></span><input class="stdin" placeholder="stdin (optional)" style="width:180px"></div>
    <div class="fill"></div><pre class="output">Output appears here.</pre>`;
  const sel = w.body.querySelector('select'), out = w.body.querySelector('.output'),
        runBtn = w.body.querySelector('[data-a=run]'), stdin = w.body.querySelector('.stdin');
  sel.value = LANG_BY_EXT[ext] || 'python';
  const sync = () => {                       // show only what makes sense for this file
    sel.hidden = runBtn.hidden = plain;
    stdin.hidden = out.hidden = plain || !SERVER_LANGS.includes(sel.value);
  };
  sync();
  const m = await loadMonaco();
  const ed = m.editor.create(w.body.querySelector('.fill'), { value: plain ? '' : (STARTERS[sel.value] || ''),
    language: plain ? (PLAIN_LANG[ext] || 'plaintext') : sel.value,
    automaticLayout: true, minimap: { enabled: false }, fontSize: 14, theme: document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs' });
  if (file) api('/api/files/' + file.id).then(f => ed.setValue(f.content));
  sel.onchange = () => { m.editor.setModelLanguage(ed.getModel(), sel.value); if (!st.file) ed.setValue(STARTERS[sel.value] || ''); sync(); };
  w.onClose = () => ed.dispose();
  w.body.querySelector('.toolbar').onclick = async e => {
    const a = e.target.dataset.a;
    if (a === 'save') { const f = await saveFile(st, 'code', ed.getValue(), 'main.' + ({ python: 'py', javascript: 'js' }[sel.value] || sel.value)); f && w.setTitle(f.name); }
    if (a === 'run') {
      const lang = sel.value;
      if (lang === 'javascript') { runJS(ed.getValue(), out); return; }
      if (lang === 'html' || lang === 'css') {   // web pages open in a sandboxed preview window
        const code = ed.getValue(), src = lang === 'html' ? code : `<style>${code}</style><p>CSS applied</p>`;
        const pw = WM.open({ title: 'Preview', width: 560, height: 380 });
        pw.body.innerHTML = `<iframe sandbox="allow-scripts" style="border:0;flex:1;background:#fff" srcdoc="${esc(src)}"></iframe>`;
        return; }
      out.textContent = 'Running…';
      try { const r = await api('/api/run', 'POST', { lang, code: ed.getValue(), stdin: stdin.value + '\n' });
        out.textContent = (r.output || '(no output)') + `\n[exit ${r.code}]`; } catch (err) { out.textContent = err.message; }
    }
  };
} };

/* ---------------- Terminal ---------------- */
APPS.term = { id: 'term', name: 'Terminal', glyph: '>_', launch() {
  const w = WM.open({ title: 'Terminal', width: 640, height: 400 });
  w.body.innerHTML = `<div class="term"><pre>Lab Web-OS shell. Type 'help'.</pre><div>$ <input autocomplete="off" spellcheck="false"></div></div>`;
  const box = w.body.querySelector('.term'), pre = box.querySelector('pre'), inp = box.querySelector('input');
  const hist = []; let hi = 0;
  box.onclick = () => inp.focus(); inp.focus();
  inp.onkeydown = async e => {
    if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); inp.value = hist[hi] || ''; return; }
    if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] || ''; return; }
    if (e.key !== 'Enter') return;
    const cmd = inp.value; inp.value = ''; hist.push(cmd); hi = hist.length;
    pre.textContent += `\n$ ${cmd}`;
    if (cmd.trim() === 'clear') { pre.textContent = ''; return; }
    try { const r = await api('/api/terminal', 'POST', { cmd }); if (r.out) pre.textContent += '\n' + r.out; }
    catch (err) { pre.textContent += '\n' + err.message; }
    box.scrollTop = box.scrollHeight;
  };
} };

/* ---------------- File explorer ---------------- */
/* ---------------- File viewer (PDF, Word .docx, images, other binaries) ----------------
   Not in APPS on purpose: it has no desktop icon and is only opened from the File Explorer. */
const BINARY_KINDS = ['pdf', 'docx', 'image', 'binary'];
const Viewer = { async launch(file) {
  const w = WM.open({ title: file.name, width: 820, height: 600 }), raw = `/api/files/${file.id}/raw`;
  const isDocx = file.kind === 'docx';
  w.body.innerHTML = `<div class="toolbar"><button data-a="dl" class="primary">Download</button>
    ${isDocx ? '<button data-a="edit">Edit copy in Documents</button>' : ''}</div><div class="fill viewer"></div>`;
  const host = w.body.querySelector('.viewer'); let html = '';
  const fail = msg => host.innerHTML = `<p class="pad muted">${esc(msg)}</p>`;
  w.body.querySelector('.toolbar').onclick = async e => {
    const a = e.target.dataset.a;
    if (a === 'dl') { const l = document.createElement('a'); l.href = raw + '?download=1'; l.download = file.name; l.click(); }
    if (a === 'edit' && html) {
      const nf = await api('/api/files', 'POST', { name: file.name.replace(/\.docx$/i, '') + '.doc', kind: 'doc', content: html });
      APPS.word.launch(nf);
    }
  };
  if (file.kind === 'pdf') {
    host.innerHTML = `<iframe src="${raw}" title="${esc(file.name)}" style="border:0;width:100%;height:100%"></iframe>`;
  } else if (file.kind === 'image') {
    host.innerHTML = `<div class="pad" style="overflow:auto;height:100%;text-align:center"><img src="${raw}" alt="${esc(file.name)}" style="max-width:100%"></div>`;
  } else if (isDocx) {
    host.innerHTML = '<p class="pad muted">Loading document…</p>';
    try {
      const r = await fetch(raw); if (!r.ok) throw new Error('Could not load the file.');
      html = (await mammoth.convertToHtml({ arrayBuffer: await r.arrayBuffer() })).value;
      // Sandboxed iframe (no scripts) so a shared document can never run code in the lab session.
      const page = `<!doctype html><meta charset="utf-8"><style>body{font:15px/1.6 Georgia,serif;color:#222;background:#fff;max-width:720px;margin:24px auto;padding:0 20px}
        img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}</style>${html || '<p><i>This document is empty.</i></p>'}`;
      host.innerHTML = `<iframe sandbox="" style="border:0;width:100%;height:100%;background:#fff" srcdoc="${esc(page)}"></iframe>`;
    } catch (err) { fail('Could not display this Word file: ' + err.message); }
  } else {
    fail('A preview is not available for this file type. Use Download to open it on your computer.');
  }
} };
const openFile = f => {
  if (f.kind === 'doc') return APPS.word.launch(f);
  if (f.kind === 'sheet') return APPS.sheet.launch(f);
  if (BINARY_KINDS.includes(f.kind)) return Viewer.launch(f);
  return APPS.ide.launch(f);
};
APPS.files = { id: 'files', name: 'Files', glyph: 'Fl', launch() {
  const w = WM.open({ title: 'File Explorer', width: 640, height: 420 });
  w.body.innerHTML = `<div class="toolbar"><button data-a="new">New file</button><button data-a="up">Upload</button>
    <button data-a="ref">Refresh</button><input type="file" hidden multiple></div><div class="fill" style="overflow:auto"></div>`;
  const list = w.body.querySelector('.fill'), up = w.body.querySelector('input[type=file]');
  let files = [];
  const render = async () => {
    files = await api('/api/files');
    list.innerHTML = files.length ? `<table class="flist"><tr><th>Name</th><th>Type</th><th>Modified</th><th></th></tr>` +
      files.map(f => `<tr class="row" data-id="${f.id}"><td>${esc(f.name)} ${f.shared ? '<span class="badge">shared</span>' : ''}</td>
      <td class="muted">${f.kind}</td><td class="muted">${new Date(f.updated_at + 'Z').toLocaleString()}</td>
      <td><button class="danger" data-del="${f.id}">Delete</button></td></tr>`).join('') + '</table>'
      : '<p class="pad muted">No files yet. Create one or upload from your computer.</p>';
  };
  list.ondblclick = e => { const r = e.target.closest('.row'); if (r) openFile(files.find(f => f.id == r.dataset.id)); };
  list.onclick = async e => { const id = e.target.dataset.del;
    if (id && confirm('Delete this file?')) { await api('/api/files/' + id, 'DELETE'); render(); } };
  const toB64 = buf => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(new Blob([buf])); });
  const sniff = (buf, name) => {
    const b = new Uint8Array(buf.slice(0, 12)), ext = name.split('.').pop().toLowerCase();
    const starts = s => [...s].every((c, i) => b[i] === c.charCodeAt(0));
    if (starts('%PDF')) return 'pdf';
    if (starts('PK') && ext === 'docx') return 'docx';
    if (starts('\x89PNG') || starts('GIF8') || (b[0] === 0xFF && b[1] === 0xD8) || (starts('RIFF') && ext === 'webp')) return 'image';
    return null;
  };
  up.onchange = async () => {
    for (const f of up.files) {
      if (f.size > 10 * 1024 * 1024) { alert(`${f.name} is larger than 10 MB.`); continue; }
      try {
        const buf = await f.arrayBuffer(), kind = sniff(buf, f.name);
        if (kind) { await api('/api/files', 'POST', { name: f.name, kind, content: await toB64(buf) }); continue; }
        let text = null;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not text */ }
        await api('/api/files', 'POST', text !== null ? { name: f.name, content: text }
                                                      : { name: f.name, kind: 'binary', content: await toB64(buf) });
      } catch (err) { alert(`Could not upload ${f.name}: ${err.message}`); }
    }
    up.value = ''; render();
  };
  w.body.querySelector('.toolbar').onclick = async e => { const a = e.target.dataset.a;
    if (a === 'new') { const n = prompt('File name (e.g. notes.txt, main.py, report.doc, data.sheet):'); if (n) { await api('/api/files', 'POST', { name: n }); render(); } }
    if (a === 'up') up.click(); if (a === 'ref') render(); };
  render();
} };

/* ---------------- Settings ---------------- */
(() => {
  const s = document.createElement('style');
  s.textContent = `
    .set-scroll{flex:1;min-height:0;overflow:auto;padding:2px 22px 14px}
    .set-h{margin:22px 0 10px;font-size:11.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
    .set-row{display:grid;gap:7px;margin-bottom:14px}
    .set-lab{font-weight:500}
    .set-row input,.set-row select{width:100%}
    .seg{display:inline-flex;gap:2px;padding:3px;width:max-content;max-width:100%;background:var(--surface-3);border-radius:10px}
    .seg button{border:0;background:none;padding:6px 14px;border-radius:8px;color:var(--muted)}
    .seg button:hover{background:none;color:var(--text)}
    .seg button.on{background:var(--surface);color:var(--text);box-shadow:var(--sh-sm)}
    .sw-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .sw{width:30px;height:30px;padding:0;border-radius:50%;border:2px solid var(--surface);box-shadow:0 0 0 1px var(--border)}
    .sw:hover{border-color:var(--surface)}
    .sw.on{box-shadow:0 0 0 2px var(--text)}
    .set-row input[type=color]{width:42px;height:30px;padding:2px;border-radius:8px;cursor:pointer}
    .wp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
    .wp{padding:0;overflow:hidden;border-radius:10px;border:2px solid var(--border);text-align:left;background:var(--surface)}
    .wp i{display:block;height:46px}
    .wp span{display:block;padding:5px 9px;font-size:12px}
    .wp.on{border-color:var(--accent)}
    .set-foot{flex:none;display:flex;align-items:center;gap:12px;padding:12px 22px;border-top:1px solid var(--border);background:var(--surface-2)}
    .set-msg{color:var(--muted);font-size:13px}.set-msg.err{color:var(--danger)}.set-msg.ok{color:var(--ok)}`;
  document.head.appendChild(s);
})();

APPS.settings = { id: 'settings', name: 'Settings', glyph: 'St', launch() {
  const w = WM.open({ title: 'Settings', width: 540, height: 680 });
  const q = s => w.body.querySelector(s);
  w.body.innerHTML = `
    <div class="set-scroll">
      <div class="set-h">Appearance</div>
      <div class="set-row"><span class="set-lab">Theme</span>
        <div class="seg"><button data-t="light">Light</button><button data-t="dark">Dark</button><button data-t="system">Match system</button></div></div>
      <div class="set-row"><span class="set-lab">Accent color</span>
        <div class="sw-row">${ACCENTS.map((c, i) => `<button class="sw" data-accent="${i ? c : ''}" style="background:${c}" title="${i ? c : 'Cobalt (default)'}" aria-label="Accent color ${c}"></button>`).join('')}
          <input type="color" data-custom value="#2f5bea" title="Custom color"></div></div>
      <div class="set-row"><span class="set-lab">Wallpaper</span><div class="wp-grid" data-wp></div></div>

      <div class="set-h">Account</div>
      <label class="set-row"><span class="set-lab">Display name</span><input data-fn></label>

      <div class="set-h">Security</div>
      <label class="set-row"><span class="set-lab">Sign out automatically when idle</span>
        <select data-idle><option value="0">Never</option><option value="5">After 5 minutes</option>
          <option value="10">After 10 minutes</option><option value="30">After 30 minutes</option></select></label>
      <div class="set-row"><span class="set-lab">Change password</span>
        <input type="password" data-pw0 placeholder="Current password" autocomplete="current-password">
        <input type="password" data-pw1 placeholder="New password (6+ characters)" autocomplete="new-password">
        <input type="password" data-pw2 placeholder="Confirm new password" autocomplete="new-password">
        <div><button data-a="pw">Change password</button> <span class="set-msg" data-pwmsg></span></div></div>

      <div class="set-h">Storage</div>
      <div class="set-row"><span class="muted" data-store>Calculating&hellip;</span>
        <div><button data-a="export">Download all my files (.zip)</button></div>
        <small class="muted">Documents are saved as .html, spreadsheets as .csv, and other files keep their own format.</small></div>
    </div>
    <div class="set-foot"><button class="primary" data-a="save">Save changes</button><span class="set-msg" data-msg></span></div>`;

  const saved = { theme: LAB.theme || 'light', prefs: Object.assign({}, LAB.prefs) };
  const cur = { theme: saved.theme, prefs: Object.assign({}, saved.prefs) };
  let dirty = false;
  const say = (el, text, cls = '') => { el.textContent = text; el.className = 'set-msg ' + cls; };

  const render = () => {
    const acc = (cur.prefs.accent || '').toLowerCase(), wp = cur.prefs.wallpaper || 'aurora';
    w.body.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === cur.theme));
    w.body.querySelectorAll('[data-accent]').forEach(b => b.classList.toggle('on', b.dataset.accent === acc));
    w.body.querySelectorAll('[data-wp-id]').forEach(b => b.classList.toggle('on', b.dataset.wpId === wp));
    if (/^#[0-9a-f]{6}$/.test(acc)) q('[data-custom]').value = acc;
    q('[data-idle]').value = String(cur.prefs.idle || 0);
  };
  const drawWp = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    q('[data-wp]').innerHTML = Object.entries(WALLPAPERS).map(([k, v]) => { const c = dark ? v.d : v.l;
      return `<button class="wp" data-wp-id="${k}"><i style="background:linear-gradient(135deg,${c[0]},${c[1]})"></i><span>${v.name}</span></button>`; }).join('');
    render();
  };
  const preview = () => { applyTheme(cur.theme); applyPrefs(cur.prefs); dirty = true; drawWp(); };

  const save = async () => {
    const m = q('[data-msg]');
    try {
      const r = await api('/api/settings', 'POST', { theme: cur.theme, full_name: q('[data-fn]').value, prefs: cur.prefs });
      saved.theme = cur.theme; saved.prefs = Object.assign({}, r.prefs || cur.prefs); dirty = false;
      LAB.theme = saved.theme; LAB.prefs = Object.assign({}, saved.prefs);
      startIdle(); say(m, 'Saved.', 'ok');
    } catch (err) { say(m, err.message, 'err'); }
  };
  const changePw = async () => {
    const m = q('[data-pwmsg]'), cu = q('[data-pw0]').value, nw = q('[data-pw1]').value, cf = q('[data-pw2]').value;
    if (!cu) return say(m, 'Enter your current password.', 'err');
    if (nw.length < 6) return say(m, 'New password must be 6+ characters.', 'err');
    if (nw !== cf) return say(m, 'New passwords do not match.', 'err');
    try {
      await api('/api/password', 'POST', { current: cu, new: nw, confirm: cf });
      ['[data-pw0]', '[data-pw1]', '[data-pw2]'].forEach(s => q(s).value = '');
      say(m, 'Password changed.', 'ok');
    } catch (err) { say(m, err.message, 'err'); }
  };

  w.body.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) { cur.theme = b.dataset.t; preview(); }
    else if (b.dataset.accent !== undefined) { cur.prefs.accent = b.dataset.accent; preview(); }
    else if (b.dataset.wpId) { cur.prefs.wallpaper = b.dataset.wpId; preview(); }
    else if (b.dataset.a === 'save') save();
    else if (b.dataset.a === 'pw') changePw();
    else if (b.dataset.a === 'export') { const l = document.createElement('a'); l.href = '/api/export'; l.click(); }
  });
  w.body.addEventListener('input', e => {
    if (e.target.matches('[data-custom]')) { cur.prefs.accent = e.target.value; preview(); } });
  w.body.addEventListener('change', e => {
    if (e.target.matches('[data-idle]')) { cur.prefs.idle = +e.target.value; dirty = true; } });
  w.onClose = () => { if (dirty) { applyTheme(saved.theme); applyPrefs(saved.prefs); } };   // undo unsaved previews

  const fmtB = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  api('/api/storage').then(d => {
    q('[data-store]').textContent = `${d.files} file${d.files === 1 ? '' : 's'} · ${fmtB(d.bytes)} used`;
    if (!d.files) q('[data-a=export]').disabled = true;
  }).catch(() => { q('[data-store]').textContent = 'Could not read storage usage.'; });
  api('/api/me').then(d => { q('[data-fn]').value = d.user.full_name || ''; });
  drawWp();
} };
