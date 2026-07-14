/** Renderer-owned custom elements injected before bundle-authored HTML runs. */
export const webComponentsSource = `  const escapeHtml=(text)=>String(text).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const highlight=(text)=>escapeHtml(text).replace(
    /(\\/\\/.*$)|(&quot;[^&]*?&quot;|'[^']*?'|\\x60[^\\x60]*?\\x60)|\\b(const|let|var|function|return|if|else|for|while|class|export|import|from|async|await|type|interface|extends|new|throw|try|catch)\\b/gm,
    (match,comment,string,keyword)=>comment?'<span class="comment">'+comment+'</span>':string?'<span class="string">'+string+'</span>':'<span class="keyword">'+keyword+'</span>');
  class ShowtellCode extends HTMLElement{
    constructor(){super();this.attachShadow({mode:"open"});this.update=this.update.bind(this)}
    connectedCallback(){document.addEventListener("showtell:frame",this.update);this.update()}
    disconnectedCallback(){document.removeEventListener("showtell:frame",this.update)}
    update(){
      const input=st.inputs[this.getAttribute("input")||""];
      if(!input||input.kind!=="code"){this.shadowRoot.textContent="Missing declared code input.";return}
      const all=String(input.text).split("\\n");
      const max=boundedInteger(this.getAttribute("max-lines"),22);
      const focus=Array.isArray(input.focus)&&input.focus.length?input.focus[0]-Number(input.lineStart||1):0;
      const start=Math.max(0,Math.min(Math.max(0,all.length-max),focus-Math.floor(max/3)));
      const lines=all.slice(start,start+max);
      const revealName=this.getAttribute("reveal-range");
      const progress=revealName?st.range(revealName).progress:1;
      const visible=Math.max(1,Math.ceil(lines.length*progress));
      const numberStart=Number(input.lineStart||1)+start;
      this.shadowRoot.innerHTML='<style>:host{display:block;width:100%;height:100%;min-height:0;color:var(--st-fg);font-family:var(--st-font-mono,"JetBrains Mono"),monospace}.shell{height:100%;overflow:hidden;border:1px solid color-mix(in srgb,var(--st-border) 78%,transparent);border-radius:18px;background:color-mix(in srgb,var(--st-surface) 92%,transparent);box-shadow:0 28px 80px rgba(0,0,0,.28)}.bar{height:46px;display:flex;align-items:center;gap:8px;padding:0 18px;border-bottom:1px solid color-mix(in srgb,var(--st-border) 68%,transparent);color:var(--st-subtle);font:600 12px var(--st-font-body,Inter),sans-serif;letter-spacing:.04em}.dot{width:8px;height:8px;border-radius:50%;background:var(--st-accent);box-shadow:0 0 16px color-mix(in srgb,var(--st-accent) 75%,transparent)}.file{margin-left:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.code{padding:16px 0;font-size:clamp(14px,1.2vmax,18px);line-height:1.55}.line{display:grid;grid-template-columns:64px minmax(0,1fr);padding:0 20px;opacity:.16;transform:translateX(-8px);transition:none}.line.on{opacity:1;transform:none}.n{padding-right:18px;color:color-mix(in srgb,var(--st-subtle) 65%,transparent);text-align:right;user-select:none}.t{white-space:pre;overflow:hidden;text-overflow:clip}.keyword{color:var(--st-accent)}.string{color:var(--st-success)}.comment{color:var(--st-subtle);font-style:italic}</style><div class="shell" part="shell"><div class="bar"><span class="dot"></span><span class="file">'+escapeHtml(input.file)+'</span></div><div class="code">'+lines.map((line,index)=>'<div class="line '+(index<visible?'on':'')+'"><span class="n">'+(numberStart+index)+'</span><span class="t">'+highlight(line)+'</span></div>').join("")+'</div></div>';
    }
  }
  customElements.define("st-code",ShowtellCode);

  const boundedInteger=(value,fallback)=>{if(value===null||value==="")return fallback;const number=Number(value);return Number.isFinite(number)?Math.max(1,Math.floor(number)):fallback};
  class ShowtellDiff extends HTMLElement{
    constructor(){super();this.attachShadow({mode:"open"});this.update=this.update.bind(this)}
    connectedCallback(){document.addEventListener("showtell:frame",this.update);this.update()}
    disconnectedCallback(){document.removeEventListener("showtell:frame",this.update)}
    update(){
      const input=st.inputs[this.getAttribute("input")||""];
      if(!input||input.kind!=="diff"){this.shadowRoot.textContent="Missing declared diff input.";return}
      const all=Array.isArray(input.lines)?input.lines:[];
      const max=boundedInteger(this.getAttribute("max-lines"),22);
      const firstChange=all.findIndex((line)=>line.kind==="add"||line.kind==="del");
      const anchor=firstChange<0?0:firstChange;
      const start=Math.max(0,Math.min(Math.max(0,all.length-max),anchor-Math.floor(max/3)));
      const lines=all.slice(start,start+max);
      const revealName=this.getAttribute("reveal-range");
      const progress=revealName?st.range(revealName).progress:1;
      const visible=Math.max(1,Math.ceil(lines.length*progress));
      const shown=lines.slice(0,visible);
      const hidden=all.length-shown.length;
      const row=(line)=>{
        const kind=line.kind==="add"||line.kind==="del"||line.kind==="hunk"?line.kind:"context";
        const marker=kind==="add"?"+":kind==="del"?"−":kind==="hunk"?"@@":"";
        const oldNo=line.oldNo===undefined?"":String(line.oldNo);
        const newNo=line.newNo===undefined?"":String(line.newNo);
        const content=kind==="hunk"?(line.content?"@@ "+line.content:"@@"):line.content;
        return '<div class="line '+kind+'"><span class="no">'+oldNo+'</span><span class="no">'+newNo+'</span><span class="marker">'+marker+'</span><span class="text">'+highlight(content||"")+'</span></div>';
      };
      const body=shown.length?shown.map(row).join(""):'<div class="empty">No changes in the declared diff.</div>';
      const more=hidden>0?'<div class="more">+'+hidden+' more line'+(hidden===1?'':'s')+'</div>':"";
      this.shadowRoot.innerHTML='<style>:host{display:block;width:100%;height:100%;min-height:0;color:var(--st-fg);font-family:var(--st-font-mono,"JetBrains Mono"),monospace}.shell{height:100%;overflow:hidden;border:1px solid color-mix(in srgb,var(--st-border) 78%,transparent);border-radius:18px;background:color-mix(in srgb,var(--st-surface) 92%,transparent);box-shadow:0 28px 80px rgba(0,0,0,.28)}.bar{height:46px;display:flex;align-items:center;gap:10px;padding:0 18px;border-bottom:1px solid color-mix(in srgb,var(--st-border) 68%,transparent);color:var(--st-subtle);font:600 12px var(--st-font-body,Inter),sans-serif;letter-spacing:.04em}.dot{width:8px;height:8px;border-radius:50%;background:var(--st-accent);box-shadow:0 0 16px color-mix(in srgb,var(--st-accent) 75%,transparent)}.file{margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stat{font-family:var(--st-font-mono,"JetBrains Mono"),monospace}.stat.add{color:var(--st-success)}.stat.del{color:var(--st-warning)}.diff{padding:16px 0;font-size:clamp(14px,1.15vmax,18px);line-height:1.5}.line{display:grid;grid-template-columns:54px 54px 34px minmax(0,1fr);min-height:1.5em;padding:0 20px}.line.add{color:var(--st-success);background:color-mix(in srgb,var(--st-success) 14%,transparent)}.line.del{color:var(--st-warning);background:color-mix(in srgb,var(--st-warning) 14%,transparent)}.line.hunk{margin:7px 0;color:var(--st-accent);background:color-mix(in srgb,var(--st-accent) 10%,transparent)}.line.context{color:color-mix(in srgb,var(--st-fg) 78%,var(--st-subtle))}.no{padding-right:12px;color:color-mix(in srgb,var(--st-subtle) 62%,transparent);text-align:right;user-select:none}.marker{text-align:center;font-weight:700}.text{white-space:pre;overflow:hidden;text-overflow:clip}.keyword{color:var(--st-accent)}.string{color:var(--st-success)}.comment{color:var(--st-subtle);font-style:italic}.more{padding:8px 24px 0;color:var(--st-subtle);font:500 12px var(--st-font-body,Inter),sans-serif;text-align:right}.empty{height:100%;display:grid;place-items:center;color:var(--st-subtle);font-family:var(--st-font-body,Inter),sans-serif}</style><div class="shell" part="shell"><div class="bar"><span class="dot"></span><span class="file">'+escapeHtml(input.file)+'</span><span class="stat add">+'+Number(input.added||0)+'</span><span class="stat del">−'+Number(input.removed||0)+'</span></div><div class="diff">'+body+more+'</div></div>';
    }
  }
  customElements.define("st-diff",ShowtellDiff);

  const chartNumber=(value)=>{const number=Number(value);return Number.isFinite(number)?number:0};
  const chartRows=(data)=>Array.isArray(data)?data:Array.isArray(data?.data)?data.data:Array.isArray(data?.rows)?data.rows:[];
  const chartColor=(index)=>'var(--st-chart-'+((index%10)+1)+',var(--st-accent))';
  const chartPoint=(value)=>Number(value.toFixed(3));
  class ShowtellChart extends HTMLElement{
    constructor(){super();this.attachShadow({mode:"open"});this.update=this.update.bind(this)}
    connectedCallback(){document.addEventListener("showtell:frame",this.update);this.update()}
    disconnectedCallback(){document.removeEventListener("showtell:frame",this.update)}
    message(text){this.shadowRoot.innerHTML='<style>:host{display:grid;width:100%;height:100%;place-items:center;color:var(--st-subtle);font:500 18px var(--st-font-body,Inter),sans-serif}</style>'+escapeHtml(text)}
    update(){
      const input=st.inputs[this.getAttribute("input")||""];
      if(!input||input.kind!=="data"){this.message("Missing declared data input.");return}
      const type=(this.getAttribute("type")||"bar").toLowerCase();
      if(type!=="bar"&&type!=="line"&&type!=="pie"){this.message('Unsupported chart type "'+type+'".');return}
      const max=boundedInteger(this.getAttribute("max-items"),12);
      const rows=chartRows(input.data).filter((row)=>row&&typeof row==="object"&&!Array.isArray(row)).slice(0,max);
      if(!rows.length){this.message("The declared data input has no chart rows.");return}
      const keys=Object.keys(rows[0]);
      const requestedX=this.getAttribute("x");
      const labelKey=requestedX&&keys.includes(requestedX)?requestedX:keys.find((key)=>typeof rows[0][key]==="string")||keys[0];
      const requestedY=(this.getAttribute("y")||"").split(",").map((key)=>key.trim()).filter(Boolean);
      const valueKeys=(requestedY.length?requestedY:keys.filter((key)=>key!==labelKey&&rows.some((row)=>Number.isFinite(Number(row[key]))))).filter((key)=>keys.includes(key));
      if(!labelKey||!valueKeys.length){this.message("The declared data input has no numeric chart series.");return}
      const labels=rows.map((row)=>String(row[labelKey]??""));
      const series=valueKeys.map((name)=>({name,values:rows.map((row)=>chartNumber(row[name]))}));
      const revealName=this.getAttribute("reveal-range");
      const progress=revealName?st.range(revealName).progress:1;
      const title=this.getAttribute("title")||"";
      const plot=type==="pie"?this.pie(labels,series[0].values,progress):this.cartesian(type,labels,series,progress);
      const legend=this.legend(type,labels,series);
      this.shadowRoot.innerHTML='<style>:host{display:block;width:100%;height:100%;min-height:0;color:var(--st-fg);font-family:var(--st-font-body,Inter),sans-serif}.shell{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;border:1px solid color-mix(in srgb,var(--st-border) 78%,transparent);border-radius:18px;background:color-mix(in srgb,var(--st-surface) 92%,transparent);box-shadow:0 28px 80px rgba(0,0,0,.28);padding:clamp(18px,2.4vw,34px)}.title{min-height:1em;margin:0 0 8px;color:var(--st-fg);font:700 clamp(18px,2vw,32px) var(--st-font-display,Inter),sans-serif;letter-spacing:-.02em}.plot{width:100%;height:100%;min-height:0;overflow:visible}.grid{stroke:color-mix(in srgb,var(--st-border) 44%,transparent);stroke-width:1}.axis{stroke:var(--st-border);stroke-width:2}.label{fill:var(--st-subtle);font:500 18px var(--st-font-body,Inter),sans-serif}.value{fill:var(--st-fg);font:600 17px var(--st-font-body,Inter),sans-serif}.legend{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 20px;min-height:24px;padding-top:8px;color:var(--st-subtle);font:500 14px var(--st-font-body,Inter),sans-serif}.legend-item{display:flex;align-items:center;gap:8px}.swatch{width:10px;height:10px;border-radius:3px}</style><div class="shell" part="shell">'+(title?'<h2 class="title">'+escapeHtml(title)+'</h2>':'<div></div>')+plot+legend+'</div>';
    }
    cartesian(type,labels,series,progress){
      const width=1000,height=560,left=76,right=30,top=28,bottom=72;
      const plotW=width-left-right,plotH=height-top-bottom;
      const values=series.flatMap((item)=>item.values);
      const min=Math.min(0,...values),max=Math.max(0,...values);
      const span=Math.max(1,max-min);
      const yFor=(value)=>top+((max-value)/span)*plotH;
      const baseY=yFor(0);
      const groupW=plotW/Math.max(1,labels.length);
      const grid=[0,.25,.5,.75,1].map((step)=>'<line class="grid" x1="'+left+'" y1="'+chartPoint(top+plotH*step)+'" x2="'+(left+plotW)+'" y2="'+chartPoint(top+plotH*step)+'"></line>').join("");
      const axis='<line class="axis" x1="'+left+'" y1="'+chartPoint(baseY)+'" x2="'+(left+plotW)+'" y2="'+chartPoint(baseY)+'"></line>';
      const xLabels=labels.map((label,index)=>'<text class="label" text-anchor="middle" x="'+chartPoint(left+groupW*(index+.5))+'" y="'+(height-34)+'">'+escapeHtml(label)+'</text>').join("");
      let marks="";
      if(type==="bar"){
        const slotW=groupW/Math.max(1,series.length);
        const barW=Math.max(4,slotW*.66);
        marks=series.flatMap((item,seriesIndex)=>item.values.map((value,index)=>{
          const targetY=yFor(value);
          const animatedY=baseY+(targetY-baseY)*progress;
          const barY=Math.min(baseY,animatedY);
          const barH=Math.abs(baseY-animatedY);
          const x=left+groupW*index+slotW*seriesIndex+(slotW-barW)/2;
          const valueY=value>=0?barY-10:barY+barH+22;
          return '<g><rect x="'+chartPoint(x)+'" y="'+chartPoint(barY)+'" width="'+chartPoint(barW)+'" height="'+chartPoint(barH)+'" rx="8" fill="'+chartColor(seriesIndex)+'"></rect><text class="value" text-anchor="middle" opacity="'+chartPoint(progress)+'" x="'+chartPoint(x+barW/2)+'" y="'+chartPoint(valueY)+'">'+escapeHtml(value)+'</text></g>';
        })).join("");
      }else{
        const paths=series.map((item,seriesIndex)=>{
          const positions=item.values.map((value,index)=>({x:left+groupW*(index+.5),y:yFor(value)}));
          const scaled=progress*Math.max(0,positions.length-1);
          const whole=Math.floor(scaled);
          const visible=positions.slice(0,whole+1);
          const next=positions[whole+1];
          if(next&&visible.length){const previous=visible[visible.length-1];const fraction=scaled-whole;visible.push({x:previous.x+(next.x-previous.x)*fraction,y:previous.y+(next.y-previous.y)*fraction})}
          const points=visible.map((point)=>chartPoint(point.x)+","+chartPoint(point.y)).join(" ");
          const dots=positions.map((point,index)=>{const shown=positions.length===1?progress>=1:index/Math.max(1,positions.length-1)<=progress;return shown?'<circle cx="'+chartPoint(point.x)+'" cy="'+chartPoint(point.y)+'" r="7" fill="'+chartColor(seriesIndex)+'" stroke="var(--st-surface)" stroke-width="3"></circle>':""}).join("");
          return '<g><polyline points="'+points+'" fill="none" stroke="'+chartColor(seriesIndex)+'" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"></polyline>'+dots+'</g>';
        }).join("");
        marks=paths;
      }
      return '<svg class="plot" viewBox="0 0 '+width+' '+height+'" role="img">'+grid+axis+xLabels+marks+'</svg>';
    }
    pie(labels,values,progress){
      const width=1000,height=560,cx=500,cy=275,r=214,tau=Math.PI*2;
      const positive=values.map((value)=>Math.max(0,value));
      const total=positive.reduce((sum,value)=>sum+value,0);
      if(total<=0)return '<div style="display:grid;place-items:center;color:var(--st-subtle)">The declared data input has no positive pie values.</div>';
      let cursor=-Math.PI/2,remaining=tau*progress;
      const sectors=positive.map((value,index)=>{
        const sweep=value/total*tau;
        const shown=Math.max(0,Math.min(sweep,remaining));
        remaining-=shown;
        const start=cursor;
        cursor+=sweep;
        if(shown<=0)return "";
        const end=start+shown;
        const x1=cx+r*Math.cos(start),y1=cy+r*Math.sin(start);
        const x2=cx+r*Math.cos(end),y2=cy+r*Math.sin(end);
        if(shown>=tau-.000001){
          const oppositeX=cx+r*Math.cos(start+Math.PI),oppositeY=cy+r*Math.sin(start+Math.PI);
          return '<path d="M '+cx+' '+cy+' L '+chartPoint(x1)+' '+chartPoint(y1)+' A '+r+' '+r+' 0 1 1 '+chartPoint(oppositeX)+' '+chartPoint(oppositeY)+' A '+r+' '+r+' 0 1 1 '+chartPoint(x1)+' '+chartPoint(y1)+' Z" fill="'+chartColor(index)+'" stroke="var(--st-surface)" stroke-width="5"></path>';
        }
        return '<path d="M '+cx+' '+cy+' L '+chartPoint(x1)+' '+chartPoint(y1)+' A '+r+' '+r+' 0 '+(shown>Math.PI?1:0)+' 1 '+chartPoint(x2)+' '+chartPoint(y2)+' Z" fill="'+chartColor(index)+'" stroke="var(--st-surface)" stroke-width="5"></path>';
      }).join("");
      return '<svg class="plot" viewBox="0 0 '+width+' '+height+'" role="img">'+sectors+'</svg>';
    }
    legend(type,labels,series){
      const items=type==="pie"?labels.map((label,index)=>({label,color:index})):series.length>1?series.map((item,index)=>({label:item.name,color:index})):[];
      if(!items.length)return '<div></div>';
      return '<div class="legend">'+items.map((item)=>'<span class="legend-item"><span class="swatch" style="background:'+chartColor(item.color)+'"></span>'+escapeHtml(item.label)+'</span>').join("")+'</div>';
    }
  }
  customElements.define("st-chart",ShowtellChart);`;
