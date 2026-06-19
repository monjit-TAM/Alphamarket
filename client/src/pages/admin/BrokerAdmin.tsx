import { useState, useEffect, useCallback } from "react";
interface BrokerConnection { id:string;name:string;broker_type:string;base_url:string;vendor_code:string;vendor_key:string;is_enabled:boolean;token:string|null;token_issued_at:string|null;last_ping_at:string|null;last_ping_status:string|null;last_ping_error:string|null;notes:string|null;advisor_count:number;strategy_count:number;total_published:number;total_errors:number;published_24h:number; }
interface AdvisorMapping { id:string;email:string;username:string;companyName:string;isApproved:boolean;mapping_id:string|null;mapping_enabled:boolean|null;push_equity_calls:boolean|null;push_fno_positions:boolean|null;push_basket:boolean|null; }
interface StrategyMapping { id:string;name:string;type:string;advisor_name:string;mapping_id:string|null;mapping_enabled:boolean|null;custom_strategy_name:string|null; }
interface PublishLog { id:string;event_type:string;symbol:string;advisor_name:string;strategy_name:string;status:string;error_message:string|null;retry_count:number;published_at:string; }
async function api(method:string,path:string,body?:any){const res=await fetch(path,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});if(!res.ok)throw new Error(await res.text());return res.json();}
const C={brand:"#CC2936",dark:"#1A1A2E",bg:"#F8F9FA",panel:"#FFFFFF",border:"#E2E8F0",text:"#1A202C",muted:"#718096",green:"#38A169",red:"#E53E3E",amber:"#D97706",blue:"#3182CE",blueBg:"#EBF8FF",greenBg:"#F0FFF4",redBg:"#FFF5F5",amberBg:"#FFFBEB"};
function Badge({label,color,bg}:{label:string;color:string;bg:string}){return <span style={{background:bg,color,padding:"2px 8px",borderRadius:4,fontSize:11,fontWeight:600}}>{label}</span>;}
function Toggle({checked,onChange}:{checked:boolean;onChange:(v:boolean)=>void}){return(<div onClick={()=>onChange(!checked)} style={{width:40,height:22,borderRadius:11,cursor:"pointer",position:"relative",background:checked?C.green:"#CBD5E0",transition:"background 0.2s"}}><div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:checked?20:2,transition:"left 0.2s"}}/></div>);}
function Stat({label,value,color}:{label:string;value:string|number;color?:string}){return(<div style={{textAlign:"center",padding:"12px 16px",background:C.bg,borderRadius:8}}><div style={{fontSize:22,fontWeight:700,color:color||C.text}}>{value}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>{label}</div></div>);}

function CustomDownload(){
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");
  const [fmt,setFmt]=useState("csv");
  const C2={blue:"#3182CE",border:"#E2E8F0",panel:"#FFFFFF",text:"#1A202C"};
  const go=()=>{if(!from||!to)return;window.location.href=`/api/admin/xts-call-log/download?format=${fmt}&period=custom&from=${from}T00:00:00Z&to=${to}T23:59:59Z`;};
  return(<div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" as any}}>
    <span style={{fontSize:11,fontWeight:600,color:"#718096"}}>Custom:</span>
    <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{padding:"3px 6px",border:`1px solid ${C2.border}`,borderRadius:4,fontSize:11}}/>
    <span style={{fontSize:11,color:"#718096"}}>to</span>
    <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{padding:"3px 6px",border:`1px solid ${C2.border}`,borderRadius:4,fontSize:11}}/>
    <select value={fmt} onChange={e=>setFmt(e.target.value)} style={{padding:"3px 6px",border:`1px solid ${C2.border}`,borderRadius:4,fontSize:11}}>
      {["csv","xlsx","pdf"].map(f=><option key={f} value={f}>{f.toUpperCase()}</option>)}
    </select>
    <button onClick={go} disabled={!from||!to} style={{padding:"4px 10px",borderRadius:5,border:`1px solid ${C2.blue}`,background:C2.blue,color:"#fff",fontSize:11,fontWeight:600,cursor:from&&to?"pointer":"default",opacity:from&&to?1:0.5}}>Download</button>
  </div>);
}

export default function BrokerAdmin(){
  const [brokers,setBrokers]=useState<BrokerConnection[]>([]);
  const [selected,setSelected]=useState<BrokerConnection|null>(null);
  const [tab,setTab]=useState<"advisors"|"strategies"|"log"|"settings">("advisors");
  const [advisorMappings,setAdvisorMappings]=useState<AdvisorMapping[]>([]);
  const [strategyMappings,setStrategyMappings]=useState<StrategyMapping[]>([]);
  const [publishLog,setPublishLog]=useState<PublishLog[]>([]);
  const [logFilter,setLogFilter]=useState("");
  const [loading,setLoading]=useState(false);
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState<any>(null);
  const [showAdd,setShowAdd]=useState(false);
  const [saving,setSaving]=useState(false);
  const [toast,setToast]=useState<{msg:string;ok:boolean}|null>(null);
  const [dashboard,setDashboard]=useState<any>(null);
  const [newB,setNewB]=useState({name:"",brokerType:"XTS",baseUrl:"",vendorCode:"",vendorKey:"",notes:""});
  const [editS,setEditS]=useState<Partial<BrokerConnection>>({});
  const showToast=(msg:string,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast(null),3500);};
  const loadBrokers=useCallback(async()=>{try{const[data,dash]=await Promise.all([api("GET","/api/admin/broker-connections"),api("GET","/api/admin/xts-dashboard")]);setBrokers(data);setDashboard(dash);if(selected){const u=data.find((b:BrokerConnection)=>b.id===selected.id);if(u)setSelected(u);}}catch(e:any){showToast(e.message,false);}},[selected]);
  useEffect(()=>{loadBrokers();},[]);
  const loadTab=useCallback(async()=>{if(!selected)return;setLoading(true);try{if(tab==="advisors")setAdvisorMappings(await api("GET",`/api/admin/broker-connections/${selected.id}/advisor-mappings`));else if(tab==="strategies")setStrategyMappings(await api("GET",`/api/admin/broker-connections/${selected.id}/strategy-mappings`));else if(tab==="log")setPublishLog(await api("GET",`/api/admin/broker-connections/${selected.id}/publish-log${logFilter?`?status=${logFilter}`:""}`));else if(tab==="settings")setEditS({...selected});}catch(e:any){showToast(e.message,false);}setLoading(false);},[selected,tab,logFilter]);
  useEffect(()=>{loadTab();},[loadTab]);
  const testConn=async()=>{if(!selected)return;setTesting(true);setTestResult(null);try{const r=await api("POST",`/api/admin/broker-connections/${selected.id}/test`);setTestResult(r);loadBrokers();r.status==="ok"?showToast("Connected — JWT received ✓"):showToast(`Failed: ${r.error}`,false);}catch(e:any){showToast(e.message,false);setTestResult({status:"error",error:(e as Error).message});}setTesting(false);};
  const toggleBroker=async(b:BrokerConnection)=>{try{await api("PATCH",`/api/admin/broker-connections/${b.id}`,{isEnabled:!b.is_enabled});showToast(`${b.name} ${!b.is_enabled?"enabled":"disabled"}`);loadBrokers();}catch(e:any){showToast(e.message,false);}};
  const toggleAdvisor=async(a:AdvisorMapping)=>{if(!selected)return;try{await api("POST",`/api/admin/broker-connections/${selected.id}/advisor-mappings`,{advisorId:a.id,isEnabled:a.mapping_id?!a.mapping_enabled:true,pushEquityCalls:a.push_equity_calls??true,pushFnoPositions:a.push_fno_positions??true,pushBasket:a.push_basket??false});loadTab();}catch(e:any){showToast(e.message,false);}};
  const toggleCallType=async(a:AdvisorMapping,field:string,value:boolean)=>{if(!selected||!a.mapping_id)return;try{await api("POST",`/api/admin/broker-connections/${selected.id}/advisor-mappings`,{advisorId:a.id,isEnabled:a.mapping_enabled??true,pushEquityCalls:field==="push_equity_calls"?value:(a.push_equity_calls??true),pushFnoPositions:field==="push_fno_positions"?value:(a.push_fno_positions??true),pushBasket:field==="push_basket"?value:(a.push_basket??false)});loadTab();}catch(e:any){showToast(e.message,false);}};
  const toggleStrategy=async(s:StrategyMapping)=>{if(!selected)return;try{await api("POST",`/api/admin/broker-connections/${selected.id}/strategy-mappings`,{strategyId:s.id,isEnabled:s.mapping_id?!s.mapping_enabled:true,customStrategyName:s.custom_strategy_name});loadTab();}catch(e:any){showToast(e.message,false);}};
  const saveSettings=async()=>{if(!selected)return;setSaving(true);try{await api("PATCH",`/api/admin/broker-connections/${selected.id}`,{name:editS.name,baseUrl:editS.base_url,vendorCode:editS.vendor_code,vendorKey:editS.vendor_key,notes:editS.notes});showToast("Saved");loadBrokers();}catch(e:any){showToast(e.message,false);}setSaving(false);};
  const addBroker=async()=>{setSaving(true);try{await api("POST","/api/admin/broker-connections",newB);showToast("Added");setShowAdd(false);setNewB({name:"",brokerType:"XTS",baseUrl:"",vendorCode:"",vendorKey:"",notes:""});loadBrokers();}catch(e:any){showToast(e.message,false);}setSaving(false);};
  const fmt=(s:string|null)=>s?new Date(s).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
  const inp=(label:string,val:string,set:(v:string)=>void,type="text",ph="")=>(<div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:C.muted,marginBottom:4}}>{label}</label><input type={type} value={val} onChange={e=>set(e.target.value)} placeholder={ph} style={{width:"100%",padding:"8px 10px",border:`1px solid ${C.border}`,borderRadius:6,fontSize:13,outline:"none",boxSizing:"border-box" as any}}/></div>);
  const btn=(label:string,onClick:()=>void,v:"primary"|"secondary"|"ghost"="primary",disabled=false)=>{const s={primary:{background:C.brand,color:"#fff",border:"none"},secondary:{background:C.blue,color:"#fff",border:"none"},ghost:{background:"transparent",color:C.text,border:`1px solid ${C.border}`}};return <button onClick={onClick} disabled={disabled} style={{...s[v],padding:"7px 14px",borderRadius:6,fontSize:13,fontWeight:600,cursor:disabled?"default":"pointer",opacity:disabled?0.6:1}}>{label}</button>;};
  return(
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"'Inter',sans-serif",color:C.text}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');*{box-sizing:border-box}`}</style>
      {toast&&<div style={{position:"fixed",top:20,right:20,zIndex:1000,background:toast.ok?C.green:C.red,color:"#fff",padding:"10px 18px",borderRadius:8,fontSize:13,fontWeight:500,boxShadow:"0 4px 12px rgba(0,0,0,0.15)"}}>{toast.msg}</div>}
      <div style={{background:C.dark,padding:"14px 28px",display:"flex",alignItems:"center",gap:16}}>
        <div style={{flex:1}}><div style={{fontSize:16,fontWeight:700,color:"#fff"}}>Broker Integrations</div><div style={{fontSize:11,color:"#9CA3AF",marginTop:2}}>XTS Symphony · Advisory Publishing Control</div></div>
        {dashboard&&<div style={{display:"flex",gap:20}}>{[["Active",`${dashboard.brokers?.enabled||0}/${dashboard.brokers?.total||0}`,C.green],["Published 24h",dashboard.publishing?.success_24h||0,C.green],["Errors 24h",dashboard.publishing?.error_24h||0,(dashboard.publishing?.error_24h||0)>0?C.red:C.green]].map(([l,v,c])=>(<div key={l as string} style={{textAlign:"center"}}><div style={{fontSize:18,fontWeight:700,color:c as string}}>{v as string}</div><div style={{fontSize:10,color:"#9CA3AF"}}>{l as string}</div></div>))}</div>}
        {btn("+ Add Broker",()=>setShowAdd(true),"secondary")}
      </div>
      {showAdd&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:C.panel,borderRadius:12,padding:28,width:480}}><div style={{fontSize:16,fontWeight:700,marginBottom:20}}>Add Broker Connection</div>{inp("Name",newB.name,v=>setNewB(p=>({...p,name:v})),"text","XTS Symphony Fintech")}{inp("Base URL",newB.baseUrl,v=>setNewB(p=>({...p,baseUrl:v})),"text","https://api.symphonyfintech.in")}{inp("Vendor Code",newB.vendorCode,v=>setNewB(p=>({...p,vendorCode:v})))}{inp("Vendor Key",newB.vendorKey,v=>setNewB(p=>({...p,vendorKey:v})),"password")}{inp("Notes",newB.notes,v=>setNewB(p=>({...p,notes:v})))}<div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:8}}>{btn("Cancel",()=>setShowAdd(false),"ghost")}{btn("Add",addBroker,"primary",saving||!newB.name||!newB.baseUrl)}</div></div></div>}
      <div style={{display:"flex",height:"calc(100vh - 57px)"}}>
        <div style={{width:280,background:C.panel,borderRight:`1px solid ${C.border}`,overflowY:"auto"}}>
          <div style={{padding:"14px 16px",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1,borderBottom:`1px solid ${C.border}`}}>BROKER CONNECTIONS</div>
          {brokers.length===0&&<div style={{padding:24,textAlign:"center",color:C.muted,fontSize:13}}>No connections yet</div>}
          {brokers.map(b=>(<div key={b.id} onClick={()=>{setSelected(b);setTab("advisors");setTestResult(null);}} style={{padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`,background:selected?.id===b.id?C.blueBg:"transparent",borderLeft:selected?.id===b.id?`3px solid ${C.blue}`:"3px solid transparent"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><div style={{flex:1,fontWeight:600,fontSize:13}}>{b.name}</div><Toggle checked={b.is_enabled} onChange={()=>toggleBroker(b)}/></div>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>{b.vendor_code} · {b.broker_type}</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap" as any}}><Badge label={b.is_enabled?"Live":"Off"} color={b.is_enabled?C.green:C.muted} bg={b.is_enabled?C.greenBg:C.bg}/>{b.last_ping_status&&<Badge label={b.last_ping_status==="ok"?"✓ OK":"✗ Error"} color={b.last_ping_status==="ok"?C.green:C.red} bg={b.last_ping_status==="ok"?C.greenBg:C.redBg}/>}</div>
            <div style={{display:"flex",gap:12,marginTop:8,fontSize:11,color:C.muted}}><span>{b.advisor_count} advisors</span><span>{b.strategy_count} strategies</span><span>{b.published_24h} today</span></div>
          </div>))}
        </div>
        {!selected?(<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:14}}>Select a broker connection</div>):(
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{background:C.panel,borderBottom:`1px solid ${C.border}`,padding:"16px 24px"}}>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                <div style={{flex:1}}><div style={{fontSize:16,fontWeight:700}}>{selected.name}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{selected.base_url} · {selected.vendor_code}</div></div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {testResult&&<Badge label={testResult.status==="ok"?"✓ JWT Received":`✗ ${testResult.error?.slice(0,40)}`} color={testResult.status==="ok"?C.green:C.red} bg={testResult.status==="ok"?C.greenBg:C.redBg}/>}
                  {btn(testing?"Testing...":"Test Connection",testConn,"ghost",testing)}
                  <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:12,color:C.muted}}>Master</span><Toggle checked={selected.is_enabled} onChange={()=>toggleBroker(selected)}/></div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginTop:16}}>
                <Stat label="Total Published" value={selected.total_published} color={C.green}/>
                <Stat label="Total Errors" value={selected.total_errors} color={selected.total_errors>0?C.red:C.muted}/>
                <Stat label="Today" value={selected.published_24h}/>
                <Stat label="Advisors" value={selected.advisor_count}/>
                <Stat label="Strategies" value={selected.strategy_count}/>
              </div>
              {selected.last_ping_at&&<div style={{marginTop:10,fontSize:11,color:C.muted}}>Last test: {fmt(selected.last_ping_at)} · <span style={{color:selected.last_ping_status==="ok"?C.green:C.red,fontWeight:600}}>{selected.last_ping_status}</span>{selected.last_ping_error&&` · ${selected.last_ping_error.slice(0,80)}`}</div>}
            </div>
            <div style={{background:C.panel,borderBottom:`1px solid ${C.border}`,display:"flex",padding:"0 24px"}}>
              {(["advisors","strategies","log","settings"] as const).map(t=>(<div key={t} onClick={()=>setTab(t)} style={{padding:"12px 16px",fontSize:13,fontWeight:tab===t?600:400,color:tab===t?C.blue:C.muted,borderBottom:tab===t?`2px solid ${C.blue}`:"2px solid transparent",cursor:"pointer",textTransform:"capitalize" as any}}>{t==="log"?"Publish Log":t.charAt(0).toUpperCase()+t.slice(1)}</div>))}
            </div>
            <div style={{flex:1,overflowY:"auto",padding:24}}>
              {loading&&<div style={{color:C.muted,fontSize:13}}>Loading...</div>}
              {!loading&&tab==="advisors"&&(<div>
                <div style={{marginBottom:16,fontSize:13,color:C.muted}}>Enable advisors to allow their calls to publish to {selected.name}.</div>
                {advisorMappings.map(a=>{const on=a.mapping_id!==null&&a.mapping_enabled===true;return(<div key={a.id} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:"14px 16px",marginBottom:10,opacity:on?1:0.7}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}><Toggle checked={on} onChange={()=>toggleAdvisor(a)}/><div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{a.companyName||a.username}</div><div style={{fontSize:11,color:C.muted}}>{a.email}</div></div>{a.isApproved&&<Badge label="SEBI Approved" color={C.green} bg={C.greenBg}/>}</div>
                  {on&&<div style={{display:"flex",gap:20,marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>{[["Equity Calls","push_equity_calls",a.push_equity_calls],["F&O Positions","push_fno_positions",a.push_fno_positions],["Basket","push_basket",a.push_basket]].map(([l,f,v])=>(<label key={f as string} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,cursor:"pointer"}}><input type="checkbox" checked={v===true} onChange={e=>toggleCallType(a,f as string,e.target.checked)}/>{l as string}</label>))}</div>}
                </div>);})}
              </div>)}
              {!loading&&tab==="strategies"&&(<div>
                <div style={{marginBottom:16,fontSize:13,color:C.muted}}>Enable strategies for publishing to {selected.name}. Only published strategies shown.</div>
                {strategyMappings.map(s=>{const on=s.mapping_id!==null&&s.mapping_enabled===true;return(<div key={s.id} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:12,opacity:on?1:0.7}}><Toggle checked={on} onChange={()=>toggleStrategy(s)}/><div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{s.name}</div><div style={{fontSize:11,color:C.muted}}>{s.advisor_name} · {s.type}</div>{s.custom_strategy_name&&<div style={{fontSize:11,color:C.blue}}>XTS: {s.custom_strategy_name}</div>}</div><Badge label={s.type} color={C.blue} bg={C.blueBg}/></div>);})}
              </div>)}
              {!loading&&tab==="log"&&(<div>
                <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:12,fontWeight:600,color:C.muted}}>Download:</span>
                  {(["daily","weekly","monthly"] as const).map(p=>(
                    <div key={p} style={{display:"flex",gap:4}}>
                      {(["csv","xlsx","pdf"] as const).map(fmt=>(
                        <a key={fmt} href={`/api/admin/xts-call-log/download?format=${fmt}&period=${p}`} download style={{padding:"4px 10px",borderRadius:5,border:`1px solid ${C.border}`,background:C.panel,color:C.text,fontSize:11,fontWeight:500,textDecoration:"none",cursor:"pointer"}}>
                          {p.charAt(0).toUpperCase()+p.slice(1)} {fmt.toUpperCase()}
                        </a>
                      ))}
                      <span style={{fontSize:11,color:C.border,alignSelf:"center"}}>|</span>
                    </div>
                  ))}
                  <CustomDownload />
                </div>
                <div style={{display:"flex",gap:8,marginBottom:16}}>{["","success","error","skipped"].map(f=>(<button key={f} onClick={()=>setLogFilter(f)} style={{padding:"5px 12px",borderRadius:5,border:`1px solid ${logFilter===f?C.blue:C.border}`,background:logFilter===f?C.blueBg:"transparent",color:logFilter===f?C.blue:C.text,fontSize:12,cursor:"pointer"}}>{f===''?'All':f.charAt(0).toUpperCase()+f.slice(1)}</button>))}<div style={{flex:1}}/><div style={{fontSize:12,color:C.muted,alignSelf:"center"}}>Last 50 entries</div></div>
                {publishLog.length===0?(<div style={{color:C.muted,fontSize:13,textAlign:"center",padding:40}}>No publish events yet</div>):(
                  <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead><tr style={{background:C.bg}}>{["Time","Event","Symbol","Advisor","Strategy","Status","Retries"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:600,color:C.muted,fontSize:11,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}</tr></thead>
                      <tbody>{publishLog.map((l,i)=>(<tr key={l.id} style={{background:i%2===0?C.panel:C.bg}}><td style={{padding:"9px 12px",color:C.muted,whiteSpace:"nowrap" as any}}>{fmt(l.published_at)}</td><td style={{padding:"9px 12px",fontWeight:500}}>{l.event_type}</td><td style={{padding:"9px 12px",fontFamily:"monospace"}}>{l.symbol}</td><td style={{padding:"9px 12px",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis"}}>{l.advisor_name}</td><td style={{padding:"9px 12px",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis"}}>{l.strategy_name}</td><td style={{padding:"9px 12px"}}><Badge label={l.status} color={l.status==="success"?C.green:l.status==="error"?C.red:C.amber} bg={l.status==="success"?C.greenBg:l.status==="error"?C.redBg:C.amberBg}/>{l.error_message&&<div style={{fontSize:10,color:C.red,marginTop:2}}>{l.error_message.slice(0,50)}</div>}</td><td style={{padding:"9px 12px",textAlign:"center" as any}}>{l.retry_count}</td></tr>))}</tbody>
                    </table>
                  </div>
                )}
              </div>)}
              {!loading&&tab==="settings"&&(<div style={{maxWidth:520}}>
                <div style={{marginBottom:20}}><div style={{fontSize:13,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase" as any,marginBottom:12}}>Connection Details</div>
                {inp("Display Name",editS.name||"",v=>setEditS(p=>({...p,name:v})))}{inp("Base URL",editS.base_url||"",v=>setEditS(p=>({...p,base_url:v})),"text","https://api.symphonyfintech.in")}{inp("Vendor Code",editS.vendor_code||"",v=>setEditS(p=>({...p,vendor_code:v})))}{inp("Vendor Key",editS.vendor_key||"",v=>setEditS(p=>({...p,vendor_key:v})),"password")}
                <div style={{marginBottom:14}}><label style={{display:"block",fontSize:12,fontWeight:600,color:C.muted,marginBottom:4}}>Notes</label><textarea value={editS.notes||""} onChange={e=>setEditS(p=>({...p,notes:e.target.value}))} rows={3} style={{width:"100%",padding:"8px 10px",border:`1px solid ${C.border}`,borderRadius:6,fontSize:13,resize:"vertical" as any,fontFamily:"inherit",boxSizing:"border-box" as any}}/></div></div>
                {selected.token&&<div style={{background:C.bg,borderRadius:6,padding:12,fontSize:11,fontFamily:"monospace",color:C.muted,wordBreak:"break-all" as any,marginBottom:20}}><span style={{color:C.green}}>✓ Token cached</span> — issued {fmt(selected.token_issued_at)}<br/>{selected.token?.slice(0,60)}...</div>}
                <div style={{display:"flex",gap:10}}>{btn(saving?"Saving...":"Save Settings",saveSettings,"primary",saving)}{btn("Test Connection",testConn,"ghost",testing)}</div>
              </div>)}
            </div>
          </div>
        )}
      </div>
    {mode==="partner"&&(<div style={{display:"flex",flex:1,overflow:"hidden"}}>
      <div style={{width:280,background:C.panel,borderRight:"1px solid "+C.border,overflowY:"auto"}}>
        <div style={{padding:"14px 16px",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1,borderBottom:"1px solid "+C.border}}>PARTNER INTEGRATIONS</div>
        {partners.length===0&&<div style={{padding:24,textAlign:"center",color:C.muted,fontSize:13}}>No partners configured</div>}
        {partners.map((p:any)=>(<div key={p.id} onClick={()=>{setPartnerSelected(p);setPartnerTab("config");}} style={{padding:"14px 16px",cursor:"pointer",borderBottom:"1px solid "+C.border,background:partnerSelected?.id===p.id?C.blueBg:"transparent",borderLeft:partnerSelected?.id===p.id?"3px solid "+C.blue:"3px solid transparent"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><div style={{flex:1,fontWeight:600,fontSize:13}}>{p.partner_name}</div></div>
          <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{p.contact_email||""}</div>
          <div style={{display:"flex",gap:6}}><Badge label={p.sso_enabled?"SSO":"No SSO"} color={p.sso_enabled?C.green:C.muted} bg={p.sso_enabled?C.greenBg:C.bg}/><Badge label={p.sso_provider||"--"} color={C.blue} bg={C.blueBg}/><Badge label={p.access_mode||"marketplace"} color={C.muted} bg={C.bg}/></div>
          <div style={{display:"flex",gap:10,marginTop:6,fontSize:11,color:C.muted}}><span>{p.total_users||0} users</span><span>{p.active_sessions||0} sessions</span></div>
        </div>))}
      </div>
      {!partnerSelected&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:14}}>Select a partner to manage</div>}
      {partnerSelected&&(<div style={{flex:1,display:"flex",flexDirection:"column" as any,overflow:"hidden"}}>
        <div style={{background:C.panel,padding:"16px 24px",borderBottom:"1px solid "+C.border}}>
          <div style={{fontSize:16,fontWeight:700}}>{partnerSelected.partner_name}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:4}}>Provider: {partnerSelected.sso_provider} | Client ID: {partnerSelected.sso_client_id}</div>
          {partnerStats&&<div style={{display:"flex",gap:20,marginTop:10}}>{[["Total Users",partnerStats.total_users],["Active 24h",partnerStats.active_24h],["Live Sessions",partnerStats.live_sessions],["Logins 24h",partnerStats.logins_24h],["Brokers",partnerStats.unique_brokers]].map(([l,v]:any)=>(<div key={l} style={{textAlign:"center"}}><div style={{fontSize:18,fontWeight:700,color:C.green}}>{v||0}</div><div style={{fontSize:10,color:C.muted}}>{l}</div></div>))}</div>}
        </div>
        <div style={{background:C.panel,borderBottom:"1px solid "+C.border,display:"flex",padding:"0 24px"}}>{(["config","users","sessions","brokers"] as const).map(t=>(<div key={t} onClick={()=>setPartnerTab(t)} style={{padding:"12px 16px",fontSize:13,fontWeight:partnerTab===t?600:400,color:partnerTab===t?C.blue:C.muted,borderBottom:partnerTab===t?"2px solid "+C.blue:"2px solid transparent",cursor:"pointer"}}>{t==="config"?"Configuration":t==="users"?"Shadow Users":t==="sessions"?"Session Logs":"Broker Configs"}</div>))}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:24}}>
          {partnerLoading&&<div style={{textAlign:"center",padding:40,color:C.muted}}>Loading...</div>}
          {!partnerLoading&&partnerTab==="config"&&partnerEdit&&(<div style={{maxWidth:600}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:16}}>SSO Configuration</div>
            {inp("Partner Name",partnerEdit.partner_name,(v:string)=>setPartnerEdit((p:any)=>({...p,partner_name:v})))}
            {inp("Contact Email",partnerEdit.contact_email||"",(v:string)=>setPartnerEdit((p:any)=>({...p,contact_email:v})),"email")}
            {inp("SSO Client ID",partnerEdit.sso_client_id||"",(v:string)=>setPartnerEdit((p:any)=>({...p,sso_client_id:v})))}
            {inp("SSO Client Secret",partnerEdit.sso_client_secret||"",(v:string)=>setPartnerEdit((p:any)=>({...p,sso_client_secret:v})),"password")}
            {inp("SSO API URL",partnerEdit.sso_api_url||"",(v:string)=>setPartnerEdit((p:any)=>({...p,sso_api_url:v})))}
            {inp("Redirect URL",partnerEdit.sso_redirect_url||"",(v:string)=>setPartnerEdit((p:any)=>({...p,sso_redirect_url:v})))}
            <div style={{marginTop:16,fontSize:14,fontWeight:700,marginBottom:12}}>Access Settings</div>
            <div style={{marginBottom:12}}><div style={{fontSize:12,color:C.muted,marginBottom:4}}>Access Mode</div><select value={partnerEdit.access_mode||"marketplace"} onChange={(e:any)=>setPartnerEdit((p:any)=>({...p,access_mode:e.target.value}))} style={{width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid "+C.border,background:C.bg,color:C.text,fontSize:13}}><option value="marketplace">Marketplace (Full catalog)</option><option value="curated">Curated (Selected advisors)</option><option value="open_access">Open Access (Broker-funded)</option></select></div>
            <div style={{marginBottom:12}}><div style={{fontSize:12,color:C.muted,marginBottom:4}}>Payment Mode</div><select value={partnerEdit.payment_mode||"user_pays"} onChange={(e:any)=>setPartnerEdit((p:any)=>({...p,payment_mode:e.target.value}))} style={{width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid "+C.border,background:C.bg,color:C.text,fontSize:13}}><option value="user_pays">User Pays (Subscription)</option><option value="broker_pays">Broker Pays</option><option value="free">Free Access</option></select></div>
            {inp("Landing Page",partnerEdit.landing_page||"/dashboard/strategies",(v:string)=>setPartnerEdit((p:any)=>({...p,landing_page:v})))}
            <div style={{display:"flex",gap:10,marginTop:16}}>{btn(partnerSaving?"Saving...":"Save Configuration",savePartner,"primary",partnerSaving)}</div>
            <div style={{marginTop:24,padding:16,background:C.bg,borderRadius:8,border:"1px solid "+C.border}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Integration Details</div>
              <div style={{fontSize:11,fontFamily:"monospace",color:C.muted,lineHeight:1.8}}>
                <div>Partner Key: {partnerSelected.partner_key}</div>
                <div>Callback URL: {partnerSelected.sso_redirect_url}</div>
              </div>
            </div>
          </div>)}
          {!partnerLoading&&partnerTab==="users"&&(<div>
            <div style={{fontSize:13,color:C.muted,marginBottom:12}}>{partnerUsers.length} shadow users</div>
            <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}><thead><tr style={{borderBottom:"2px solid "+C.border,textAlign:"left" as any}}><th style={{padding:"8px 12px"}}>UID</th><th style={{padding:"8px 12px"}}>Email</th><th style={{padding:"8px 12px"}}>Name</th><th style={{padding:"8px 12px"}}>Broker</th><th style={{padding:"8px 12px"}}>Sessions</th><th style={{padding:"8px 12px"}}>Last Seen</th></tr></thead><tbody>{partnerUsers.map((u:any)=>(<tr key={u.id} style={{borderBottom:"1px solid "+C.border}}><td style={{padding:"8px 12px",fontFamily:"monospace"}}>{u.uid||"--"}</td><td style={{padding:"8px 12px"}}>{u.email||"--"}</td><td style={{padding:"8px 12px"}}>{u.display_name||"--"}</td><td style={{padding:"8px 12px"}}>{u.broker_name||u.broker_id||"--"}</td><td style={{padding:"8px 12px"}}>{u.active_sessions||0}</td><td style={{padding:"8px 12px",color:C.muted}}>{u.last_seen?new Date(u.last_seen).toLocaleString():"--"}</td></tr>))}</tbody></table>
          </div>)}
          {!partnerLoading&&partnerTab==="sessions"&&(<div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><div style={{fontSize:13,color:C.muted}}>{partnerSessions.length} recent sessions</div></div>
            <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}><thead><tr style={{borderBottom:"2px solid "+C.border,textAlign:"left" as any}}><th style={{padding:"8px 12px"}}>UID</th><th style={{padding:"8px 12px"}}>Email</th><th style={{padding:"8px 12px"}}>Broker</th><th style={{padding:"8px 12px"}}>Product</th><th style={{padding:"8px 12px"}}>Login</th><th style={{padding:"8px 12px"}}>Status</th></tr></thead><tbody>{partnerSessions.map((s:any)=>(<tr key={s.id} style={{borderBottom:"1px solid "+C.border}}><td style={{padding:"8px 12px",fontFamily:"monospace"}}>{s.uid||"--"}</td><td style={{padding:"8px 12px"}}>{s.email||"--"}</td><td style={{padding:"8px 12px"}}>{s.broker_name||s.broker_id||"--"}</td><td style={{padding:"8px 12px"}}><Badge label={s.product} color={C.blue} bg={C.blueBg}/></td><td style={{padding:"8px 12px",color:C.muted}}>{new Date(s.created_at).toLocaleString()}</td><td style={{padding:"8px 12px"}}>{new Date(s.expires_at)>new Date()?<Badge label="Active" color={C.green} bg={C.greenBg}/>:<Badge label="Expired" color={C.muted} bg={C.bg}/>}</td></tr>))}</tbody></table>
          </div>)}
          {!partnerLoading&&partnerTab==="brokers"&&(<div>
            <div style={{fontSize:13,color:C.muted,marginBottom:12}}>{partnerBrokers.length} broker configurations</div>
            {partnerBrokers.length===0&&<div style={{padding:24,textAlign:"center",color:C.muted}}>No broker-specific configs yet.</div>}
            {partnerBrokers.map((b:any)=>(<div key={b.id} style={{background:C.panel,border:"1px solid "+C.border,borderRadius:8,padding:"12px 16px",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><div style={{fontWeight:600,fontSize:13}}>{b.broker_name||b.broker_id}</div><Badge label={b.is_active?"Active":"Off"} color={b.is_active?C.green:C.muted} bg={b.is_active?C.greenBg:C.bg}/></div>
              <div style={{fontSize:11,color:C.muted,marginTop:4}}>Products: {(b.products_enabled||[]).join(", ")} | Users: {b.user_count||0}</div>
            </div>))}
          </div>)}
        </div>
      </div>)}
    </div>)}
    </div>
  );
}
