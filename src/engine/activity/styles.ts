export const ACTIVITY_CSS = `
.nc-glass{background:rgba(10,14,22,.82);backdrop-filter:blur(10px);color:#e6edf3;border:1px solid rgba(255,255,255,.08);
  box-shadow:0 8px 30px rgba(0,0,0,.35);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

.nc-act{position:absolute;top:12px;right:12px;width:380px;max-height:calc(100vh - 120px);display:flex;flex-direction:column;border-radius:10px;overflow:hidden}
.nc-act-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.07);cursor:pointer;user-select:none}
.nc-act-body{overflow-y:auto;padding:6px 0}
.nc-section{padding:4px 12px 2px;color:#7d8590;font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.nc-run{margin:2px 8px 8px;border-radius:8px;background:rgba(255,255,255,.03)}
.nc-run-head{display:flex;gap:8px;align-items:center;padding:7px 8px;cursor:pointer}
.nc-run-title{flex:1;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-row{display:grid;grid-template-columns:16px 1fr;gap:6px;padding:3px 10px 3px 8px;animation:nc-in .18s ease-out}
.nc-row.agent .nc-msg{color:#d2b8ff}
.nc-row.editor .nc-msg{color:#9fd8ff}
.nc-row.user .nc-msg{color:#fff;font-weight:700}
.nc-msg{word-break:break-word}
.nc-meta{color:#7d8590;font-size:11px}
.nc-bar{height:3px;background:rgba(255,255,255,.1);border-radius:2px;margin-top:4px;overflow:hidden}
.nc-bar>div{height:100%;background:#58a6ff;transition:width .3s ease}
.nc-imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:5px}
.nc-imgs img{width:100%;height:64px;object-fit:cover;border-radius:4px;background:#111;display:block}
.nc-diff{margin:5px 0 0;padding:6px;background:rgba(0,0,0,.35);border-radius:4px;white-space:pre-wrap;font-size:11px;max-height:180px;overflow:auto}
.nc-diff .a{color:#7ee787}.nc-diff .d{color:#ff7b72}
.nc-spin{width:10px;height:10px;margin-top:3px;border:2px solid rgba(88,166,255,.3);border-top-color:#58a6ff;border-radius:50%;animation:nc-spin .8s linear infinite}
.nc-dot{width:8px;height:8px;border-radius:50%;flex:none}
.nc-empty{padding:10px 12px;color:#7d8590}

.nc-chatbar{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:min(680px,calc(100vw - 32px));border-radius:14px;padding:8px 8px 6px 14px}
.nc-chatbar-row{display:flex;align-items:flex-end;gap:10px}
.nc-chatbar textarea{flex:1;resize:none;background:transparent;color:#e6edf3;border:0;outline:none;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  padding:6px 0;max-height:120px}
.nc-chatbar textarea::placeholder{color:#6e7681}
.nc-send{width:32px;height:32px;border-radius:9px;border:0;background:#238636;color:#fff;font-size:16px;font-weight:700;cursor:pointer;flex:none;
  transition:transform .12s ease,opacity .12s ease}
.nc-send:active{transform:scale(.94)}
.nc-send:disabled{opacity:.35;cursor:default}
.nc-send.stop{background:#da3633}
.nc-chatbar-status{display:flex;align-items:center;gap:6px;margin-top:2px;padding-bottom:2px}
.nc-link{background:none;border:0;color:#7d8590;font:inherit;font-size:11px;cursor:pointer;padding:0;text-decoration:underline}

@keyframes nc-spin{to{transform:rotate(360deg)}}
@keyframes nc-in{from{opacity:0;transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){.nc-row{animation:none}.nc-spin{animation-duration:2s}}
`
